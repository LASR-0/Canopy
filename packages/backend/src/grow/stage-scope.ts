/**
 * A stage scope as stored: a JSON list of planned stages, null for "every
 * stage". Shared by automations and maintenance tasks.
 */
import { PLANNED_STAGES, isPlannedStage, type PlannedStage } from "@canopy/shared-types";

/** The stages in a stored scope, in plan order. Undefined for every stage. */
export function parseStages(json: string | null | undefined): PlannedStage[] | undefined {
  if (!json) return undefined;
  try {
    const list = JSON.parse(json) as unknown;
    if (!Array.isArray(list)) return undefined;
    const stages = PLANNED_STAGES.filter((s) => list.includes(s));
    return stages.length > 0 ? stages : undefined;
  } catch {
    return undefined;
  }
}

/** What is wrong with a scope from a request, or null. */
export function stagesProblem(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input) || !input.every(isPlannedStage)) {
    return `stages must be a list of: ${PLANNED_STAGES.join(", ")}`;
  }
  return null;
}

/** A scope for storage: null when it names no stage, which means every stage. */
export function stagesJson(stages: readonly PlannedStage[] | null | undefined): string | null {
  if (!stages || stages.length === 0) return null;
  return JSON.stringify(PLANNED_STAGES.filter((s) => stages.includes(s)));
}
