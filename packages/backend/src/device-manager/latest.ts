/**
 * The latest reading per channel, kept in memory.
 *
 * `GET /readings/latest` used to ask the database for the newest row of every
 * channel, a GROUP BY over every raw reading in the workspace: 2.2 s against
 * 1.7 million rows. better-sqlite3 is synchronous, so for those seconds the
 * controller answered nothing else, ingest included, and a page that asked
 * twice stalled for several seconds. Every reading already passes through the
 * two insert sites (ingest and derived VPD), so they note it here, and the
 * database is read once per workspace to seed what arrived before startup.
 */
import { sql } from "drizzle-orm";
import { db } from "../store/index.js";
import { readingsRaw } from "../store/schema.js";
import type { Reading } from "@canopy/shared-types";

const latest = new Map<string, Map<string, Reading>>();
const seeded = new Set<string>();

const keyOf = (r: Pick<Reading, "deviceId" | "channel">) => `${r.deviceId}:${r.channel}`;

function channelsOf(workspaceId: string): Map<string, Reading> {
  let channels = latest.get(workspaceId);
  if (!channels) latest.set(workspaceId, (channels = new Map()));
  return channels;
}

/** Note a reading as it is stored. Kept only if it is newer than what is held. */
export function rememberReading(reading: Reading): void {
  const channels = channelsOf(reading.workspaceId);
  const held = channels.get(keyOf(reading));
  if (!held || held.ts <= reading.ts) channels.set(keyOf(reading), reading);
}

/** The newest reading of every channel in a workspace. */
export async function latestReadings(workspaceId: string): Promise<Reading[]> {
  if (!seeded.has(workspaceId)) {
    // Once per workspace per run, and fast with idx_readings_raw_latest.
    const rows = await db
      .select()
      .from(readingsRaw)
      .where(
        sql`${readingsRaw.id} IN (
          SELECT MAX(id) FROM readings_raw
          WHERE workspace_id = ${workspaceId}
          GROUP BY device_id, channel
        )`,
      );
    for (const r of rows) {
      rememberReading({
        workspaceId: r.workspaceId,
        deviceId: r.deviceId,
        channel: r.channel,
        metric: r.metric as Reading["metric"],
        unit: r.unit as Reading["unit"],
        value: r.value,
        ts: r.recordedAt,
      });
    }
    seeded.add(workspaceId);
  }
  return [...channelsOf(workspaceId).values()];
}

/** Forget everything. Tests only. */
export function resetLatestReadings(): void {
  latest.clear();
  seeded.clear();
}
