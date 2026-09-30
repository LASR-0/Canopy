import type { Id, Timestamp } from "./common.js";
import type { PlannedStage } from "./grow.js";

export type MaintenanceCadence = "daily" | "weekly" | "stage" | "runtime" | "custom";

export type MaintenanceGroupTime = "morning" | "today" | "evening";

/**
 * A recurring upkeep task. Workspace-scoped (persists across grows).
 * Tasks are seeded automatically when devices are added; users can also add
 * custom tasks.
 */
export interface MaintenanceTask {
  id: Id;
  workspaceId: Id;
  name: string;
  cadence: MaintenanceCadence;
  /** For "weekly": repeat every N days (1–30). */
  intervalDays?: number;
  /**
   * For "stage": the stage whose start it falls due on, once per grow ("Switch
   * to bloom nutrients" when Flower starts). The date comes from the grow plan.
   */
  startStage?: PlannedStage;
  /**
   * The stages a recurring task belongs to. Absent (or empty) means every
   * stage. Outside them the task is hidden from Today, never falls due and is
   * never announced; its next due date moves to the start of its next stage.
   */
  stages?: PlannedStage[];
  /** For "runtime": trigger every N device runtime-hours (50–500). */
  runtimeHoursInterval?: number;
  /** Display label for what generated this task (e.g. "pH sensor", "Carbon filter"). */
  seededBy?: string;
  /** Device this task relates to — used for runtime cadence tracking. */
  deviceId?: Id;
  groupTime: MaintenanceGroupTime;
  notifications: boolean;
  nextDueAt?: Timestamp;
  lastDoneAt?: Timestamp;
}

/** A single completion or skip record for a maintenance task. */
export interface MaintenanceCompletion {
  id: Id;
  taskId: Id;
  workspaceId: Id;
  growId?: Id;
  growDay?: number;
  status: "completed" | "skipped";
  /** Full ISO timestamp including time of completion. */
  completedAt: Timestamp;
  /** Optional inline note e.g. "added 1.8 L", "2-point calibration". */
  note?: string;
}

/** Free-text note for an entire maintenance session (the whole day). */
export interface MaintenanceDayNote {
  id: Id;
  workspaceId: Id;
  growId?: Id;
  /** ISO date string "2026-05-29". */
  date: string;
  growDay?: number;
  note: string;
}
