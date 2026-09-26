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

/** Fraction of the band treated as a warning shoulder before a hard breach. */
const WARN_MARGIN = 0.1;

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
): ThresholdStatus {
  const stageMatch = stage
    ? thresholds.find((t) => t.metric === metric && t.stage === stage)
    : undefined;
  const defaultMatch = thresholds.find((t) => t.metric === metric && !t.stage);
  const threshold = stageMatch ?? defaultMatch;
  if (!threshold) return "ok";

  const warnBand = (threshold.maxValue - threshold.minValue) * WARN_MARGIN;

  if (value < threshold.minValue || value > threshold.maxValue) return "err";
  if (value < threshold.minValue + warnBand || value > threshold.maxValue - warnBand) {
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
