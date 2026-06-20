import type { GrowCycle, GrowStageName } from "@canopy/shared-types";

export interface GrowStageInfo {
  stage: GrowStageName;
  /** 1-based day within the current stage. */
  dayInStage: number;
  /** Total planned days in this stage. */
  stageTotalDays: number;
  /** 0–1 progress through the current stage. */
  pctInStage: number;
  /** 1-based overall day of the grow. */
  totalDay: number;
}

const STAGES: GrowStageName[] = ["seedling", "vegetative", "flowering", "flush"];

function plannedDays(grow: GrowCycle): number[] {
  return [
    grow.plannedSeedlingWeeks * 7,
    grow.plannedVegWeeks      * 7,
    grow.plannedFlowerWeeks   * 7,
    grow.plannedFlushWeeks    * 7,
  ];
}

/**
 * Computes the current grow stage and progress from startedAt + planned weeks.
 * Returns undefined if the grow hasn't started (no startedAt).
 */
export function calcGrowStage(grow: GrowCycle, now = new Date()): GrowStageInfo | undefined {
  if (!grow.startedAt) return undefined;

  const startMs = new Date(grow.startedAt).getTime();
  const totalDay = Math.max(1, Math.floor((now.getTime() - startMs) / 86_400_000) + 1);

  const days = plannedDays(grow);
  let cumulative = 0;

  for (let i = 0; i < STAGES.length; i++) {
    const stageDays = days[i]!;
    if (totalDay <= cumulative + stageDays || i === STAGES.length - 1) {
      const dayInStage = Math.max(1, totalDay - cumulative);
      return {
        stage: STAGES[i]!,
        dayInStage,
        stageTotalDays: stageDays,
        pctInStage: Math.min(1, (dayInStage - 1) / stageDays),
        totalDay,
      };
    }
    cumulative += stageDays;
  }
}

/** Total planned duration of the grow in days. */
export function growTotalPlannedDays(grow: GrowCycle): number {
  return plannedDays(grow).reduce((a, b) => a + b, 0);
}
