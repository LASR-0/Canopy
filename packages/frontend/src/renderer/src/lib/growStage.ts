/**
 * Grow stage maths now lives in @canopy/shared-types, because thresholds are
 * stage-scoped and the controller has to reach the same answer the UI shows.
 * Re-exported here to keep the `@/lib/growStage` import path stable.
 */
export { calcGrowStage, growTotalPlannedDays } from "@canopy/shared-types";
export type { GrowStageInfo } from "@canopy/shared-types";
