import type { Timestamp } from "./common.js";

export type JobType =
  | "rollup_hourly"
  | "rollup_daily"
  | "prune_raw"
  | "prune_hourly"
  | "archive_grow"
  | "backup"
  | "maintenance_check"
  | "vacuum";

export type JobStatus = "pending" | "running" | "done" | "failed";

/** A scheduled background job tracked by the controller service. */
export interface ScheduledJob {
  id: string;
  type: JobType;
  lastRunAt?: Timestamp;
  nextRunAt: Timestamp;
  status: JobStatus;
  lastError?: string;
  /** Job-specific parameters e.g. { growId } for archive_grow. */
  params?: Record<string, unknown>;
}
