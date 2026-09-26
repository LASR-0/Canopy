/**
 * Threshold evaluation now lives in @canopy/shared-types, so the controller
 * judges a reading exactly the way the card colours it. Re-exported here to
 * keep the `@/lib/thresholds` import path stable.
 */
export { evalThreshold, thresholdFor } from "@canopy/shared-types";
export type { ThresholdStatus } from "@canopy/shared-types";
