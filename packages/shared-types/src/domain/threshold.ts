import type { Id } from "./common.js";
import type { Metric, Unit } from "./capability.js";
import type { GrowStageName } from "./grow.js";

/**
 * User-configurable target range for a sensor metric.
 * stage = null means workspace default; a specific stage overrides it.
 */
export interface SensorThreshold {
  id: Id;
  workspaceId: Id;
  /** null = workspace-level default; set = applies only during that grow stage. */
  stage?: GrowStageName;
  metric: Metric;
  minValue: number;
  maxValue: number;
  unit: Unit;
}

export type ThresholdStatus = "ok" | "warn" | "err";

/**
 * How a metric's alerts behave. One per metric per workspace; a metric with no
 * row uses `DEFAULT_ALERT_SETTING`, which is exactly how alerts behaved before
 * these were configurable.
 */
export interface ThresholdAlertSetting {
  workspaceId: Id;
  metric: Metric;
  /**
   * Whether crossings are recorded to the activity feed. Off silences the
   * alerts only: the card still colours and the band still draws, because the
   * range is still the range.
   */
  enabled: boolean;
  /**
   * Width of the "drifting" shoulder inside each edge of the band, as a
   * percentage of the band's width. 0 means no warning, only breaches.
   */
  warnMarginPct: number;
  /**
   * How long a reading must stay worse before it is reported, in seconds. Stops
   * a door opened for a minute from writing an alert. Recoveries are recorded
   * at once.
   */
  delaySec: number;
}

export type AlertBehaviour = Pick<ThresholdAlertSetting, "enabled" | "warnMarginPct" | "delaySec">;

export const DEFAULT_ALERT_SETTING: AlertBehaviour = { enabled: true, warnMarginPct: 10, delaySec: 0 };

/**
 * Bounds for the alert settings. The margin stops short of 50 %, where the two
 * shoulders would meet and no reading could ever be "ok"; the delay tops out
 * at an hour, past which an alert is history rather than a warning.
 */
export const ALERT_LIMITS = {
  maxWarnMarginPct: 40,
  maxDelaySec: 3600,
} as const;

/** The behaviour in force for a metric: its stored setting, or the default. */
export function alertSettingFor(metric: Metric, settings: readonly ThresholdAlertSetting[]): AlertBehaviour {
  const found = settings.find((s) => s.metric === metric);
  return found
    ? { enabled: found.enabled, warnMarginPct: found.warnMarginPct, delaySec: found.delaySec }
    : DEFAULT_ALERT_SETTING;
}

/** Why an alert setting is not allowed, or null when it is. */
export function alertSettingProblem(s: Partial<AlertBehaviour>): string | null {
  if (s.warnMarginPct !== undefined) {
    if (!Number.isFinite(s.warnMarginPct) || s.warnMarginPct < 0 || s.warnMarginPct > ALERT_LIMITS.maxWarnMarginPct) {
      return `The warning margin must be between 0 and ${ALERT_LIMITS.maxWarnMarginPct} %`;
    }
  }
  if (s.delaySec !== undefined) {
    if (!Number.isInteger(s.delaySec) || s.delaySec < 0 || s.delaySec > ALERT_LIMITS.maxDelaySec) {
      return `The delay must be a whole number of seconds from 0 to ${ALERT_LIMITS.maxDelaySec}`;
    }
  }
  return null;
}

/**
 * Why a band is not allowed, or null when it is.
 *
 * The minimum must be below the maximum: an inverted band marks every reading
 * out of range and alerts on all of them.
 */
export function bandProblem(minValue: number, maxValue: number): string | null {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return "Both ends of the range must be numbers";
  if (minValue >= maxValue) return "The minimum must be below the maximum";
  return null;
}

/**
 * Evaluate a reading against the configured band.
 *
 * Lives here rather than in either app because both sides judge the same
 * reading: the renderer colours the card, and the controller decides whether a
 * crossing is worth an event. Two implementations of "is this too hot" would
 * drift, and the disagreement would show up as a card that looks fine next to
 * an alert that says otherwise.
 *
 * A stage-scoped threshold wins over the workspace default, and a metric with
 * no threshold at all is "ok" rather than an error — not every sensor is one
 * the grower has opinions about.
 */
export function evalThreshold(
  value: number,
  metric: Metric,
  thresholds: SensorThreshold[],
  stage?: GrowStageName,
  /** The metric's warning shoulder, in percent of the band. See `ThresholdAlertSetting`. */
  warnMarginPct: number = DEFAULT_ALERT_SETTING.warnMarginPct,
): ThresholdStatus {
  const stageMatch = stage
    ? thresholds.find((t) => t.metric === metric && t.stage === stage)
    : undefined;
  const defaultMatch = thresholds.find((t) => t.metric === metric && !t.stage);
  const threshold = stageMatch ?? defaultMatch;
  if (!threshold) return "ok";

  const warnBand = (threshold.maxValue - threshold.minValue) * (warnMarginPct / 100);

  if (value < threshold.minValue || value > threshold.maxValue) return "err";
  if (warnBand > 0 && (value < threshold.minValue + warnBand || value > threshold.maxValue - warnBand)) {
    return "warn";
  }
  return "ok";
}

/** The band actually in force for a metric, or undefined if none is configured. */
export function thresholdFor(
  metric: Metric,
  thresholds: SensorThreshold[],
  stage?: GrowStageName,
): SensorThreshold | undefined {
  const stageMatch = stage
    ? thresholds.find((t) => t.metric === metric && t.stage === stage)
    : undefined;
  return stageMatch ?? thresholds.find((t) => t.metric === metric && !t.stage);
}
