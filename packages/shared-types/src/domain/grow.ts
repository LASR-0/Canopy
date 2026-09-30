import type { Id, Timestamp } from "./common.js";

export type GrowStageName = "seedling" | "vegetative" | "flowering" | "flush" | "harvest";

export type GrowStatus = "planned" | "active" | "completed" | "aborted";

/** Predefined grow cycle template — defines default stage durations. */
export interface GrowTemplate {
  id: Id;
  name: string;
  seedlingWeeks: number;
  vegWeeks: number;
  flowerWeeks: number;
  flushWeeks: number;
}

/**
 * A grow cycle. Everything from planning through harvest (or abort) lives here.
 * The four stage week fields are always present; planned is set at setup, actual
 * is filled when the grow completes.
 */
export interface GrowCycle {
  id: Id;
  workspaceId: Id;
  name: string;
  /** What is being grown — plant variety / strain. Generic field, not cannabis-specific. */
  strain?: string;
  plantCount?: number;
  templateId?: Id;
  status: GrowStatus;

  // ── Stage planning (weeks per stage, set at grow setup) ─────────────────
  plannedSeedlingWeeks: number;
  plannedVegWeeks: number;
  plannedFlowerWeeks: number;
  plannedFlushWeeks: number;

  // ── Stage actuals (filled at grow completion for the harvest report) ─────
  actualSeedlingWeeks?: number;
  actualVegWeeks?: number;
  actualFlowerWeeks?: number;
  actualFlushWeeks?: number;

  // ── Lifecycle dates ──────────────────────────────────────────────────────
  startedAt?: Timestamp;
  completedAt?: Timestamp;

  // ── Harvest data (completed grows) ───────────────────────────────────────
  wetWeightG?: number;
  dryWeightG?: number;
  /** 0.5–5.0 with half-star increments. */
  rating?: number;
  notesWorked?: string;
  notesChange?: string;
  /** e.g. ["LST", "Defoliation", "CO₂ purge"] */
  techniques?: string[];

  // ── Abort data ────────────────────────────────────────────────────────────
  abortReason?: string;
  abortNote?: string;

  // ── Auto-compiled environment summary (stored at completion) ─────────────
  envAvgVpd?: number;
  envTempMin?: number;
  envTempMax?: number;
  envTempAvg?: number;
  envRhMin?: number;
  envRhMax?: number;
  envRhAvg?: number;
  envFailsafeTrips?: number;
  envFailsafeNote?: string;
}

/** A milestone within a grow — appears in Journal and Harvest Report. */
export interface GrowMilestone {
  id: Id;
  growId: Id;
  label: string;
  /** Which day of the grow this milestone falls on. */
  day: number;
  done: boolean;
  doneAt?: Timestamp;
}

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

/** A stage with a planned length: every stage but harvest, which is an end state. */
export type PlannedStage = Exclude<GrowStageName, "harvest">;

/** Stages in the order a grow moves through them. */
export const PLANNED_STAGES: readonly PlannedStage[] = ["seedling", "vegetative", "flowering", "flush"];
const ORDERED_STAGES = PLANNED_STAGES;

/** What the stage maths needs from a grow. */
export type GrowPlan = Pick<
  GrowCycle,
  "startedAt" | "plannedSeedlingWeeks" | "plannedVegWeeks" | "plannedFlowerWeeks" | "plannedFlushWeeks"
>;

function plannedDays(grow: GrowPlan): number[] {
  return [
    grow.plannedSeedlingWeeks * 7,
    grow.plannedVegWeeks * 7,
    grow.plannedFlowerWeeks * 7,
    grow.plannedFlushWeeks * 7,
  ];
}

/**
 * Current stage and progress, derived from `startedAt` and the planned weeks.
 *
 * Shared because the stage is not only a display concern: thresholds are
 * stage-scoped, so the controller needs the same answer the UI is showing in
 * order to judge a reading against the right band.
 *
 * Undefined for a grow that has not started. A grow running past its plan stays
 * in the final stage rather than falling off the end — plans slip, and the
 * alternative is a tent with no stage at all.
 */
export function calcGrowStage(grow: GrowPlan, now = new Date()): GrowStageInfo | undefined {
  if (!grow.startedAt) return undefined;

  const startMs = new Date(grow.startedAt).getTime();
  const totalDay = Math.max(1, Math.floor((now.getTime() - startMs) / 86_400_000) + 1);

  const days = plannedDays(grow);
  let cumulative = 0;

  for (let i = 0; i < ORDERED_STAGES.length; i++) {
    const stageDays = days[i]!;
    if (totalDay <= cumulative + stageDays || i === ORDERED_STAGES.length - 1) {
      const dayInStage = Math.max(1, totalDay - cumulative);
      return {
        stage: ORDERED_STAGES[i]!,
        dayInStage,
        stageTotalDays: stageDays,
        pctInStage: Math.min(1, (dayInStage - 1) / stageDays),
        totalDay,
      };
    }
    cumulative += stageDays;
  }

  return undefined;
}

/** Total planned duration of the grow in days. */
export function growTotalPlannedDays(grow: GrowCycle): number {
  return plannedDays(grow).reduce((a, b) => a + b, 0);
}

/**
 * When a stage starts in a grow's plan: its start plus the planned days of the
 * stages before it. Undefined for a grow that has not started. Moves when the
 * plan is edited, which is the point: it is the plan's answer, not a record.
 */
export function stageStartDate(grow: GrowPlan, stage: PlannedStage): Date | undefined {
  if (!grow.startedAt) return undefined;
  const days = plannedDays(grow);
  const before = days.slice(0, PLANNED_STAGES.indexOf(stage)).reduce((a, b) => a + b, 0);
  return new Date(Date.parse(grow.startedAt) + before * 86_400_000);
}

/**
 * Whether something scoped to `stages` applies in `current`. No scope always
 * applies. A scope with no current stage (no grow running) does not: "Flower
 * only" has no answer then, so it idles rather than pretending.
 */
export function stageScopeApplies(stages: readonly GrowStageName[] | undefined, current: GrowStageName | undefined): boolean {
  if (!stages || stages.length === 0) return true;
  return current !== undefined && stages.includes(current);
}

export function isPlannedStage(value: unknown): value is PlannedStage {
  return typeof value === "string" && (PLANNED_STAGES as readonly string[]).includes(value);
}
