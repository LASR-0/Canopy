/**
 * Threshold alerts — timeline events when a reading leaves its configured band.
 *
 * Distinct from the rules engine: a rule *does* something, an alert *says*
 * something. A grower wants both, and wants them to agree, so both read the
 * same band via `evalThreshold` in shared-types — the same function that
 * colours the card in the UI.
 *
 * Edge-triggered per channel. Writing a row for every reading that is still too
 * hot would bury the crossing that matters under hundreds of identical lines,
 * and the activity feed is the thing a grower scans first when something looks
 * wrong. Recovery is recorded too: "it came back" is as useful as "it went out",
 * and without it the feed's last word on a metric is always alarming.
 */
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../store/index.js";
import { sensorThresholds, grows, workspaces } from "../store/schema.js";
import { recordEvent } from "../automation/apply.js";
import {
  calcGrowStage,
  evalThreshold,
  thresholdFor,
  type GrowCycle,
  type Reading,
  type SensorThreshold,
  type ThresholdStatus,
} from "@canopy/shared-types";

/** Last known status per `workspace:device:channel`, so only changes are recorded. */
const lastStatus = new Map<string, ThresholdStatus>();

/** Cached per workspace; thresholds change rarely and readings arrive constantly. */
let bands = new Map<string, SensorThreshold[]>();
let stages = new Map<string, GrowCycle | null>();

function key(reading: Reading): string {
  return `${reading.workspaceId}:${reading.deviceId}:${reading.channel}`;
}

function rowToThreshold(row: typeof sensorThresholds.$inferSelect): SensorThreshold {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    metric: row.metric as SensorThreshold["metric"],
    minValue: row.minValue,
    maxValue: row.maxValue,
    unit: row.unit as SensorThreshold["unit"],
    ...(row.stage ? { stage: row.stage as NonNullable<SensorThreshold["stage"]> } : {}),
  };
}

/**
 * Reload thresholds and the active grow per workspace.
 *
 * The active grow is needed because thresholds are stage-scoped: the band for
 * flowering is not the band for seedlings, and judging against the wrong one
 * would raise alerts that contradict the card the user is looking at.
 */
export async function refreshThresholds(): Promise<void> {
  try {
    const rows = await db.select().from(sensorThresholds);
    const next = new Map<string, SensorThreshold[]>();
    for (const row of rows) {
      const list = next.get(row.workspaceId) ?? [];
      list.push(rowToThreshold(row));
      next.set(row.workspaceId, list);
    }
    bands = next;

    const spaces = await db
      .select({ id: workspaces.id, activeGrowId: workspaces.activeGrowId })
      .from(workspaces);

    const growIds = spaces.map((w) => w.activeGrowId).filter((id): id is string => !!id);
    const growRows = growIds.length
      ? await db.select().from(grows).where(inArray(grows.id, growIds))
      : [];
    const byId = new Map(growRows.map((g) => [g.id, g]));

    const nextStages = new Map<string, GrowCycle | null>();
    for (const space of spaces) {
      const grow = space.activeGrowId ? byId.get(space.activeGrowId) : undefined;
      nextStages.set(space.id, grow ? (grow as unknown as GrowCycle) : null);
    }
    stages = nextStages;
  } catch (err) {
    console.error("[thresholds] failed to reload:", err);
  }
}

function describe(
  reading: Reading,
  status: ThresholdStatus,
  band: SensorThreshold | undefined,
): string {
  const unit = reading.unit === "percent" ? "%" : ` ${reading.unit}`;
  const value = `${reading.value}${unit}`;
  if (!band) return `${reading.metric} ${value}`;

  const range = `${band.minValue}–${band.maxValue}`;
  if (status === "ok") return `${reading.metric} back in range at ${value} (${range})`;

  const direction = reading.value > band.maxValue ? "above" : reading.value < band.minValue ? "below" : "near the edge of";
  return `${reading.metric} ${value} ${direction} range ${range}`;
}

/**
 * Check one reading against its band, recording only status changes.
 *
 * Returns the status so the caller can log it; the event write is the point.
 */
export async function checkThresholds(
  reading: Reading,
  now: Date = new Date(),
): Promise<ThresholdStatus> {
  const workspaceBands = bands.get(reading.workspaceId) ?? [];
  if (workspaceBands.length === 0) return "ok";

  const grow = stages.get(reading.workspaceId) ?? null;
  const stage = grow ? calcGrowStage(grow, now)?.stage : undefined;

  const status = evalThreshold(reading.value, reading.metric, workspaceBands, stage);
  const id = key(reading);
  const previous = lastStatus.get(id);

  if (previous === status) return status;
  lastStatus.set(id, status);

  // The first reading of a healthy channel is not news.
  if (previous === undefined && status === "ok") return status;

  const band = thresholdFor(reading.metric, workspaceBands, stage);

  try {
    await recordEvent({
      workspaceId: reading.workspaceId,
      type: "threshold_alert",
      sourceId: reading.deviceId,
      sourceLabel: reading.channel,
      description: describe(reading, status, band),
      at: now,
      ...(status === "ok" ? {} : { severity: status === "err" ? ("err" as const) : ("warn" as const) }),
    });
    // Not pushed over the websocket: the protocol has no event message, and
    // inventing one with no consumer would be worse than the feed picking it
    // up on its next fetch. Worth adding with the first screen that shows it.
  } catch (err) {
    console.error("[thresholds] failed to record alert:", err);
  }

  return status;
}

/** Forget cached bands and per-channel status. Tests only. */
export function resetThresholdState(): void {
  lastStatus.clear();
  bands = new Map();
  stages = new Map();
}
