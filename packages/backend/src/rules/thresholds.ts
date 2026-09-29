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
import { eq, and } from "drizzle-orm";
import { db } from "../store/index.js";
import { sensorThresholds, thresholdAlertSettings } from "../store/schema.js";
import { currentStage, refreshActiveGrows, resetGrowStageForTesting } from "../grow/stage.js";
import { recordEvent } from "../automation/apply.js";
import {
  alertSettingFor,
  evalThreshold,
  thresholdFor,
  type Metric,
  type Reading,
  type SensorThreshold,
  type ThresholdAlertSetting,
  type ThresholdStatus,
} from "@canopy/shared-types";

/**
 * Per channel: the status last *recorded*, and a worse status waiting out the
 * metric's delay before it is.
 */
interface ChannelState {
  recorded: ThresholdStatus;
  pending?: { status: ThresholdStatus; since: number };
  /** When the reading first cleared its recorded state by the deadband. */
  recovering?: { since: number };
}

/**
 * Hysteresis: how far past an edge a reading must come back, as a fraction of
 * the band's width, before it counts as having recovered.
 *
 * Without it a reading sitting on an edge crossed it on every flicker of sensor
 * noise, and each crossing was recorded: 13,387 alerts in a day, from soil
 * moisture wandering 44.7–46.7 % across a 45 % edge and a light's power draw
 * wandering 303–310 W across a 305 W warning shoulder.
 */
export const RECOVERY_DEADBAND = 0.05;

/**
 * And how long it must stay recovered. The deadband alone cannot know a
 * sensor's noise — the light's 7 W swing is 14 % of its band — so a recovery
 * also has to *hold*. A reading that keeps dipping back never completes one,
 * and the excursion is reported once, not once per dip.
 */
export const RECOVERY_DWELL_MS = 60_000;

/**
 * The status a reading earns once the deadband is taken off each edge — what it
 * would have to be to count as genuinely better, not just across the line.
 */
function clearedStatus(value: number, band: SensorThreshold, warnMarginPct: number): ThresholdStatus {
  const width = band.maxValue - band.minValue;
  const deadband = width * RECOVERY_DEADBAND;
  const warnBand = width * (warnMarginPct / 100);
  const lo = band.minValue + deadband;
  const hi = band.maxValue - deadband;
  if (value < lo || value > hi) return "err";
  if (warnBand > 0 && (value < lo + warnBand || value > hi - warnBand)) return "warn";
  return "ok";
}

const channels = new Map<string, ChannelState>();

/** Cached per workspace; thresholds change rarely and readings arrive constantly. */
let bands = new Map<string, SensorThreshold[]>();
let alertSettings = new Map<string, ThresholdAlertSetting[]>();

const SEVERITY: Record<ThresholdStatus, number> = { ok: 0, warn: 1, err: 2 };

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

    const settingRows = await db.select().from(thresholdAlertSettings);
    const nextSettings = new Map<string, ThresholdAlertSetting[]>();
    for (const row of settingRows) {
      const list = nextSettings.get(row.workspaceId) ?? [];
      list.push({
        workspaceId: row.workspaceId,
        metric: row.metric as Metric,
        enabled: row.enabled,
        warnMarginPct: row.warnMarginPct,
        delaySec: row.delaySec,
      });
      nextSettings.set(row.workspaceId, list);
    }
    alertSettings = nextSettings;

    // The active grow per workspace is resolved by grow/stage.ts, which the
    // scheduler and the rules engine read too.
    await refreshActiveGrows();
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
 * Three per-metric settings shape what is recorded (see ThresholdAlertSetting):
 *
 * - **Disabled** metrics record nothing, but their status is still tracked, so
 *   turning alerts back on does not immediately report a state that has held
 *   for hours.
 * - **The warning margin** is passed to `evalThreshold`, the same function
 *   the card colours with, so the feed and the card still agree.
 * - **The delay** holds back a *worse* status until it has lasted that long. A
 *   reading that recovers inside the delay is never reported.
 *
 * Getting better is held to a different rule, **hysteresis**: the reading must
 * clear the edge by `RECOVERY_DEADBAND` and stay clear for `RECOVERY_DWELL_MS`.
 * That is what stops a reading sitting on an edge from reporting every flicker.
 *
 * Returns the status so the caller can log it; the event write is the point.
 */
export async function checkThresholds(
  reading: Reading,
  now: Date = new Date(),
): Promise<ThresholdStatus> {
  const workspaceBands = bands.get(reading.workspaceId) ?? [];
  if (workspaceBands.length === 0) return "ok";

  const stage = currentStage(reading.workspaceId, now);
  const behaviour = alertSettingFor(reading.metric, alertSettings.get(reading.workspaceId) ?? []);

  const status = evalThreshold(reading.value, reading.metric, workspaceBands, stage, behaviour.warnMarginPct);
  const id = key(reading);
  const state = channels.get(id);

  // The first reading of a healthy channel is not news. An unhealthy first
  // reading is treated as a crossing out of "ok".
  if (!state) {
    if (status === "ok") {
      channels.set(id, { recorded: "ok" });
      return status;
    }
  }
  const recorded = state?.recorded ?? "ok";

  if (status === recorded) {
    // Back where it was before the delay ran out, or a recovery that did not
    // hold: nothing to report.
    if (state) {
      delete state.pending;
      delete state.recovering;
    } else channels.set(id, { recorded });
    return status;
  }

  if (!behaviour.enabled) {
    channels.set(id, { recorded: status });
    return status;
  }

  const nowMs = now.getTime();
  const worse = SEVERITY[status] > SEVERITY[recorded];
  const band = thresholdFor(reading.metric, workspaceBands, stage);

  let report = status;
  if (!worse && band) {
    // Better, but only by as much as the deadband allows, and only once that
    // has held for the dwell.
    const cleared = clearedStatus(reading.value, band, behaviour.warnMarginPct);
    if (SEVERITY[cleared] >= SEVERITY[recorded]) {
      channels.set(id, { recorded });
      return status;
    }
    const since = state?.recovering ? state.recovering.since : nowMs;
    if (nowMs - since < RECOVERY_DWELL_MS) {
      channels.set(id, { recorded, recovering: { since } });
      return status;
    }
    report = cleared;
  }

  if (worse && behaviour.delaySec > 0) {
    // The clock runs from the first worse reading, so warn-then-err within the
    // delay is timed from when the reading first left its recorded state.
    const since = state?.pending ? state.pending.since : nowMs;
    const next: ChannelState = { recorded, pending: { status, since } };
    channels.set(id, next);
    if (nowMs - since < behaviour.delaySec * 1000) return status;
  }

  channels.set(id, { recorded: report });

  try {
    await recordEvent({
      workspaceId: reading.workspaceId,
      type: "threshold_alert",
      sourceId: reading.deviceId,
      sourceLabel: reading.channel,
      description: describe(reading, report, band),
      at: now,
      ...(report === "ok" ? {} : { severity: report === "err" ? ("err" as const) : ("warn" as const) }),
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
  channels.clear();
  bands = new Map();
  alertSettings = new Map();
  resetGrowStageForTesting();
}
