import type { SensorThreshold } from "@canopy/shared-types";
import type { Metric } from "@canopy/shared-types";

export type ThresholdStatus = "ok" | "warn" | "err";

const WARN_MARGIN = 0.1; // 10% buffer before hard err

/**
 * Evaluates a reading value against workspace thresholds.
 * Stage-scoped thresholds take priority over workspace defaults (stage = null).
 * Returns "ok" if no threshold is configured for the metric.
 */
export function evalThreshold(
  value: number,
  metric: Metric,
  thresholds: SensorThreshold[],
  stage?: string,
): ThresholdStatus {
  const stageMatch = stage
    ? thresholds.find((t) => t.metric === metric && t.stage === stage)
    : undefined;
  const defaultMatch = thresholds.find((t) => t.metric === metric && !t.stage);
  const t = stageMatch ?? defaultMatch;
  if (!t) return "ok";

  const range = t.maxValue - t.minValue;
  const warnBand = range * WARN_MARGIN;

  if (value < t.minValue || value > t.maxValue) return "err";
  if (value < t.minValue + warnBand || value > t.maxValue - warnBand) return "warn";
  return "ok";
}
