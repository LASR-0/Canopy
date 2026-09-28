/**
 * Journal entries: where an entry sits in the grow, and what the tent was doing
 * when it was written.
 *
 * Both are stamped once, at write time, and never recomputed. The day is stored
 * so the activity graph and the history stay put if the grow's start date is
 * later corrected; the environment is stored because it is the whole point — a
 * note that says "tips burning" is only useful next to the conditions it was
 * written under, and those conditions are gone a minute later.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../store/index.js";
import { readingsRaw, roleAssignments } from "../store/schema.js";
import { computeVpd } from "../device-manager/derived.js";
import type { JournalEntry, JournalEntryType } from "@canopy/shared-types";

export const JOURNAL_TYPES: readonly JournalEntryType[] = [
  "observation",
  "experiment",
  "technique",
  "measurement",
  "photo",
];

/** Longest title stored; the notebook shows one line of it. */
export const MAX_TITLE_LENGTH = 120;

/**
 * Oldest reading an entry will be stamped with.
 *
 * A sensor that went offline an hour ago still has a "latest" reading, and
 * stamping it would put a confident, wrong number beside the note. Past this
 * the field is left empty, which the UI shows as unknown rather than as a value.
 */
export const ENV_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Day and week of the grow at a moment, 1-based.
 *
 * The same arithmetic as `calcGrowStage`'s `totalDay`, so an entry written today
 * carries the day the Grow Cycle page shows. Clamped to day 1: a start date set
 * in the future would otherwise put the entry on day 0 or earlier.
 */
export function growDayAt(startedAt: string, at: Date): { growDay: number; growWeek: number } {
  const startMs = new Date(startedAt).getTime();
  const growDay = Math.max(1, Math.floor((at.getTime() - startMs) / 86_400_000) + 1);
  return { growDay, growWeek: Math.ceil(growDay / 7) };
}

/** A title from the first line of the body, when the caller gave none. */
export function titleFrom(body: string): string {
  const firstLine = body.trim().split("\n")[0]?.trim() ?? "";
  return firstLine.length > MAX_TITLE_LENGTH
    ? `${firstLine.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : firstLine;
}

/** The writable fields of an entry, trimmed and validated. */
export interface EntryContent {
  type: JournalEntryType;
  title: string;
  body: string | null;
  hypothesis: string | null;
  result: string | null;
  measurements: [string, string][] | null;
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Validate the content of a new entry.
 *
 * Returns a message instead of throwing, so the route can answer 400 with it.
 * An entry needs *something* in it: a title, a body, a hypothesis or a
 * measurement. The composer sends a body and lets the title be derived.
 */
export function parseNewEntry(input: Partial<JournalEntry>): EntryContent | string {
  const type = input.type ?? "observation";
  if (!JOURNAL_TYPES.includes(type)) return `Unknown entry type "${String(type)}"`;

  const measurements = parseMeasurements(input.measurements);
  if (typeof measurements === "string") return measurements;

  const body = text(input.body);
  const hypothesis = text(input.hypothesis);
  // An experiment is named by what it tests; anything else by its first line.
  const source = type === "experiment" ? hypothesis ?? body : body ?? hypothesis;
  const title = text(input.title) ?? titleFrom(source ?? "");

  if (!title && !measurements) return "An entry needs a title, a body or a measurement";

  return {
    type,
    // A measurement-only entry is legitimate — a weekly pH/EC check — and still
    // needs a title for the notebook to list it under.
    title: (title || "Measurements").slice(0, MAX_TITLE_LENGTH),
    body,
    hypothesis,
    result: text(input.result),
    measurements,
  };
}

/** `[["pH","6.2"], …]` with blank pairs dropped. Null when there are none. */
export function parseMeasurements(input: unknown): [string, string][] | null | string {
  if (input == null) return null;
  if (!Array.isArray(input)) return "measurements must be a list of [name, value] pairs";

  const pairs: [string, string][] = [];
  for (const pair of input) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((p) => typeof p !== "string")) {
      return "measurements must be a list of [name, value] pairs";
    }
    const [name, value] = [String(pair[0]).trim(), String(pair[1]).trim()];
    if (name || value) pairs.push([name, value]);
  }
  return pairs.length ? pairs : null;
}

/** Canopy temperature, humidity and the VPD they imply. Missing halves are omitted. */
export interface EnvSnapshot {
  envTempC?: number;
  envRhPct?: number;
  envVpdKpa?: number;
}

/**
 * What the canopy sensors read at the time of writing.
 *
 * Resolved by role, as VPD derivation is, so a reservoir probe is never stamped
 * as the air temperature. VPD is computed from the stamped pair rather than read
 * from the stored derived series, so the three numbers on an entry always agree
 * with each other.
 */
export async function envSnapshot(workspaceId: string, now: Date = new Date()): Promise<EnvSnapshot> {
  const roles = await db
    .select({ deviceId: roleAssignments.deviceId, channel: roleAssignments.channel, role: roleAssignments.role })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.workspaceId, workspaceId),
        inArray(roleAssignments.role, ["canopy_temp", "canopy_rh"]),
      ),
    );

  const since = new Date(now.getTime() - ENV_MAX_AGE_MS).toISOString();
  const latest = async (deviceId: string, channel: string, metric: string) => {
    const [row] = await db
      .select({ value: readingsRaw.value })
      .from(readingsRaw)
      .where(
        and(
          eq(readingsRaw.workspaceId, workspaceId),
          eq(readingsRaw.metric, metric),
          eq(readingsRaw.deviceId, deviceId),
          eq(readingsRaw.channel, channel),
          gte(readingsRaw.recordedAt, since),
        ),
      )
      .orderBy(desc(readingsRaw.recordedAt))
      .limit(1);
    return row?.value;
  };

  let tempC: number | undefined;
  let rhPct: number | undefined;
  for (const role of roles) {
    if (role.role === "canopy_temp" && tempC === undefined) {
      tempC = await latest(role.deviceId, role.channel, "temperature");
    }
    if (role.role === "canopy_rh" && rhPct === undefined) {
      rhPct = await latest(role.deviceId, role.channel, "humidity");
    }
  }

  return composeSnapshot(tempC, rhPct);
}

/** Round and assemble a snapshot; VPD only when both halves are known. */
export function composeSnapshot(tempC: number | undefined, rhPct: number | undefined): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  if (tempC !== undefined) snapshot.envTempC = Math.round(tempC * 10) / 10;
  if (rhPct !== undefined) snapshot.envRhPct = Math.round(rhPct * 10) / 10;
  if (tempC !== undefined && rhPct !== undefined) {
    const vpd = computeVpd(tempC, rhPct);
    if (vpd !== null) snapshot.envVpdKpa = Math.round(vpd * 100) / 100;
  }
  return snapshot;
}
