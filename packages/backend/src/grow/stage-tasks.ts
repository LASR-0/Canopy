/**
 * Keep maintenance due dates in step with the grow's stages.
 *
 * Two kinds of task follow the grow rather than a clock:
 *
 * - **"When a stage starts"** (cadence `stage`, `start_stage`): due once, on the
 *   day the grow's plan says that stage begins. Done for this grow, it waits
 *   for the next one. With no grow running it has no date.
 * - **A stage-scoped recurring task** (`stages_json`): inside its stages it
 *   recurs as usual. Outside them its next due date is moved to the start of
 *   its next stage, so it neither nags meanwhile nor opens that stage weeks
 *   overdue. With no grow running it idles, like a stage-scoped automation.
 *
 * Dates come from the plan (start plus planned weeks), so editing the plan
 * moves them; no hook on the stage changing is needed. Run every scheduler
 * tick, before due tasks are announced, and after a task is edited.
 */
import type { Database } from "better-sqlite3";
import {
  PLANNED_STAGES,
  calcGrowStage,
  isPlannedStage,
  stageStartDate,
  type GrowPlan,
} from "@canopy/shared-types";
import { parseStages } from "./stage-scope.js";

interface Row {
  id: string;
  cadence: string;
  stages_json: string | null;
  start_stage: string | null;
  next_due_at: string | null;
  last_done_at: string | null;
  started_at: string | null;
  planned_seedling_weeks: number | null;
  planned_veg_weeks: number | null;
  planned_flower_weeks: number | null;
  planned_flush_weeks: number | null;
}

function planOf(row: Row): GrowPlan | undefined {
  if (!row.started_at) return undefined;
  return {
    startedAt: row.started_at,
    plannedSeedlingWeeks: row.planned_seedling_weeks ?? 0,
    plannedVegWeeks: row.planned_veg_weeks ?? 0,
    plannedFlowerWeeks: row.planned_flower_weeks ?? 0,
    plannedFlushWeeks: row.planned_flush_weeks ?? 0,
  };
}

/** The due date a task should have now, or undefined to leave it as it is. */
export function stageDueDate(row: Row, now: Date): string | null | undefined {
  const plan = planOf(row);

  if (row.cadence === "stage") {
    if (!plan || !isPlannedStage(row.start_stage)) return null;
    const start = stageStartDate(plan, row.start_stage)!.toISOString();
    // Done since this grow's stage began: nothing more until the next grow.
    return row.last_done_at && row.last_done_at >= start ? null : start;
  }

  const stages = parseStages(row.stages_json);
  if (!stages) return undefined;
  if (!plan) return null;
  const current = calcGrowStage(plan, now)?.stage;
  if (current && (stages as string[]).includes(current)) {
    // In scope: recurs as usual. Coming in with no date, it is due now.
    return row.next_due_at ?? now.toISOString();
  }
  const from = current ? PLANNED_STAGES.indexOf(current as (typeof PLANNED_STAGES)[number]) : -1;
  const next = PLANNED_STAGES.find((s, i) => i > from && stages.includes(s));
  return next ? stageStartDate(plan, next)!.toISOString() : null;
}

/** Update every stage-driven task in live workspaces. Returns how many changed. */
export function syncStageTasks(db: Database, now: Date = new Date()): number {
  const rows = db.prepare(`
    SELECT t.id, t.cadence, t.stages_json, t.start_stage, t.next_due_at, t.last_done_at,
           g.started_at, g.planned_seedling_weeks, g.planned_veg_weeks, g.planned_flower_weeks, g.planned_flush_weeks
    FROM maintenance_tasks t
    JOIN workspaces w ON w.id = t.workspace_id
    LEFT JOIN grows g ON g.id = w.active_grow_id AND g.status = 'active'
    WHERE w.archived_at IS NULL AND w.deleted_at IS NULL
      AND (t.cadence = 'stage' OR t.stages_json IS NOT NULL)
  `).all() as Row[];

  const update = db.prepare(`UPDATE maintenance_tasks SET next_due_at = ? WHERE id = ?`);
  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const due = stageDueDate(row, now);
      if (due === undefined || due === row.next_due_at) continue;
      update.run(due, row.id);
      changed++;
    }
  })();
  return changed;
}
