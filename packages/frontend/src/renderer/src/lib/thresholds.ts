/**
 * Threshold evaluation now lives in @canopy/shared-types, so the controller
 * judges a reading exactly the way the card colours it. Re-exported here to
 * keep the `@/lib/thresholds` import path stable.
 */
export { evalThreshold, thresholdFor } from "@canopy/shared-types";
export type { ThresholdStatus } from "@canopy/shared-types";

import {
  alertSettingFor,
  evalThreshold as evaluate,
  type GrowStageName,
  type Reading,
  type SensorThreshold,
  type ThresholdAlertSetting,
  type ThresholdStatus as Status,
} from "@canopy/shared-types";

/**
 * A reading's status with its metric's own warning margin — what the
 * controller's alerts judge it by, so a card and the feed cannot disagree.
 */
export function statusOf(
  reading: Pick<Reading, "value" | "metric">,
  thresholds: SensorThreshold[],
  stage: GrowStageName | undefined,
  alertSettings: readonly ThresholdAlertSetting[],
): Status {
  const { warnMarginPct } = alertSettingFor(reading.metric, alertSettings);
  return evaluate(reading.value, reading.metric, thresholds, stage, warnMarginPct);
}
