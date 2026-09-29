/**
 * Grow stage maths now lives in @canopy/shared-types, because thresholds are
 * stage-scoped and the controller has to reach the same answer the UI shows.
 * Re-exported here to keep the `@/lib/growStage` import path stable.
 */
export { calcGrowStage, growTotalPlannedDays } from "@canopy/shared-types";
export type { GrowStageInfo } from "@canopy/shared-types";

import type { GrowCycle, GrowStageName } from "@canopy/shared-types";

/**
 * The four planned stages in order, with the prototype's colours.
 *
 * One list for every screen that draws a grow's stages — Grow Cycle's timeline,
 * the Overview banner, Journal's history bars — so a stage cannot be green on
 * one page and blue on the next. `harvest` is absent: it is an end state, not a
 * span with a length.
 */
export const STAGE_DEFS: {
  stage: Exclude<GrowStageName, "harvest">;
  label: string;
  color: string;
  weeks: (grow: GrowCycle) => number;
}[] = [
  { stage: "seedling",   label: "Seedling", color: "#3fb950", weeks: (g) => g.plannedSeedlingWeeks },
  { stage: "vegetative", label: "Veg",      color: "#2f81f7", weeks: (g) => g.plannedVegWeeks },
  { stage: "flowering",  label: "Flower",   color: "#a371f7", weeks: (g) => g.plannedFlowerWeeks },
  { stage: "flush",      label: "Flush",    color: "#d29922", weeks: (g) => g.plannedFlushWeeks },
];
