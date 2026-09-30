/**
 * Derived metrics — values Canopy computes rather than reads.
 *
 * The schema has reserved `device_id = "__derived__"` for these since the first
 * commit and nothing wrote it, so the Overview's VPD card has been empty since
 * telemetry started flowing. A derived reading is stored exactly like a measured
 * one, which is what makes it free: rollups average it, retention prunes it, the
 * series route charts it and the rules engine can trigger on it, all without
 * knowing it was computed.
 *
 * VPD is the one worth having first. It is a pure function of temperature and
 * humidity, both of which already arrive, and it is the number a grower actually
 * steers by — neither temperature nor humidity alone tells you whether the plant
 * can transpire.
 *
 * DLI is the other derived metric the prototype lists. It needs PPFD integrated
 * across the photoperiod rather than a reading-to-reading function, so it is not
 * done here.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../store/index.js";
import { readingsRaw, roleAssignments } from "../store/schema.js";
import { broadcast } from "../ws/index.js";
import { computeVpd } from "@canopy/shared-types";
import type { Reading } from "@canopy/shared-types";
import { rememberReading } from "./latest.js";

/** The reserved device id for a computed reading. See store/schema.ts. */
export const DERIVED_DEVICE_ID = "__derived__";

/**
 * The VPD maths lives in @canopy/shared-types, so the Journal's composer can
 * preview the same number the controller stamps. Re-exported to keep this
 * module's import path stable for callers and tests.
 */
export { computeVpd, saturationVapourPressure } from "@canopy/shared-types";

/**
 * Latest canopy temperature and humidity per workspace.
 *
 * In memory because VPD is only ever computed from the pair that just changed: a
 * restart loses nothing a reading will not replace within seconds, and querying
 * the counterpart on every sample would double the read volume on the hot path.
 */
interface Pair {
  tempC?: number;
  humidityPct?: number;
  /** Halves that have arrived since the last VPD was written. */
  freshTemp?: boolean;
  freshHumidity?: boolean;
}

const pairs = new Map<string, Pair>();

/** Which (deviceId, channel) holds a given role, cached from the roles table. */
let canopyRoles = new Map<string, "temp" | "humidity">();

/**
 * Reload which devices are the canopy temperature and humidity sensors.
 *
 * VPD is resolved by **role**, not by metric: a tent has a reservoir temperature
 * probe as well as a canopy one, and computing VPD from the reservoir would be a
 * confident, meaningless number. A workspace with no canopy roles assigned
 * computes nothing, which is correct — there is no canopy reading to derive from.
 */
export async function refreshDerivedRoles(): Promise<void> {
  try {
    const rows = await db
      .select({
        deviceId: roleAssignments.deviceId,
        channel: roleAssignments.channel,
        role: roleAssignments.role,
      })
      .from(roleAssignments);

    const next = new Map<string, "temp" | "humidity">();
    for (const row of rows) {
      if (row.role === "canopy_temp") next.set(`${row.deviceId}:${row.channel}`, "temp");
      if (row.role === "canopy_rh") next.set(`${row.deviceId}:${row.channel}`, "humidity");
    }
    canopyRoles = next;
  } catch (err) {
    // Keep the previous mapping rather than silently stopping derivation.
    console.error("[derived] failed to reload canopy roles:", err);
  }
}

export function derivedRoleCount(): number {
  return canopyRoles.size;
}

/**
 * Update the cached pair from a reading and, when both halves are known, write
 * the VPD it implies.
 *
 * Called from the ingest path after the measured reading is stored. Returns the
 * derived reading when one was written, for tests and for logging.
 *
 * A reading from a device holding neither canopy role is ignored outright, which
 * keeps this to one Map lookup on the hot path.
 */
export async function deriveFromReading(reading: Reading, now: Date): Promise<Reading | null> {
  const half = canopyRoles.get(`${reading.deviceId}:${reading.channel}`);
  if (!half) return null;

  const pair = pairs.get(reading.workspaceId) ?? {};
  if (half === "temp") {
    pair.tempC = reading.value;
    pair.freshTemp = true;
  } else {
    pair.humidityPct = reading.value;
    pair.freshHumidity = true;
  }
  pairs.set(reading.workspaceId, pair);

  if (pair.tempC === undefined || pair.humidityPct === undefined) return null;

  // One derived value per *complete* set of inputs. Writing on each half instead
  // stored VPD at twice the rate of the channels it comes from — the second write
  // carried no new information, because only one of its two inputs had moved.
  if (!pair.freshTemp || !pair.freshHumidity) return null;

  const vpd = computeVpd(pair.tempC, pair.humidityPct);
  if (vpd === null) return null;

  pair.freshTemp = false;
  pair.freshHumidity = false;

  const derived: Reading = {
    workspaceId: reading.workspaceId,
    deviceId: DERIVED_DEVICE_ID,
    channel: "vpd",
    metric: "vpd",
    unit: "kPa",
    value: vpd,
    ts: now.toISOString(),
  };

  await db.insert(readingsRaw).values({
    workspaceId: derived.workspaceId,
    deviceId: derived.deviceId,
    channel: derived.channel,
    metric: derived.metric,
    unit: derived.unit,
    value: derived.value,
    recordedAt: derived.ts,
  });

  rememberReading(derived);
  broadcast({ type: "reading", payload: derived });
  return derived;
}

/** Forget cached pairs and roles. Tests only. */
export function resetDerivedForTesting(): void {
  pairs.clear();
  canopyRoles = new Map();
}

/** Load a role mapping directly, bypassing the database. Tests only. */
export function setDerivedRolesForTesting(entries: [string, "temp" | "humidity"][]): void {
  canopyRoles = new Map(entries);
}
