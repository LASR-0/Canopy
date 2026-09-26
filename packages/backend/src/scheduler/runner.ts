/**
 * The job runner.
 *
 * Internal housekeeping only — rollups, pruning, backups. Automations are
 * evaluated separately, because the two answer to different lifecycle rules: a
 * paused controller must keep aggregating readings while refusing to touch
 * hardware.
 *
 * Jobs are rows, not timers. Their next run time lives in the database, so a
 * controller that was off for a day resumes with everything due rather than
 * silently restarting every schedule from now.
 */
import { eq, lte, and, ne } from "drizzle-orm";
import { db, sqliteConnection } from "../store/index.js";
import { jobs, appSettings } from "../store/schema.js";
import { canIngest } from "../controller/state.js";
import { rollupDaily, rollupHourly } from "./jobs/rollup.js";
import { pruneHourly, pruneRaw } from "./jobs/prune.js";
import { runBackup } from "./jobs/backup.js";
import type { JobType } from "@canopy/shared-types";

/**
 * What a handler reports back, purely for the log line. Deliberately `object`
 * rather than an index signature, so each job can return its own named result
 * type instead of a bag of strings.
 */
type JobSummary = object;

type JobHandler = (now: Date) => Promise<JobSummary> | JobSummary;

/**
 * How long until this job should run again.
 *
 * Returned as a function of `now` rather than a fixed interval so the hourly
 * and daily jobs land on bucket boundaries instead of drifting by however long
 * the previous run took.
 */
type Cadence = (now: Date, settings: Settings) => Date;

interface Settings {
  rawRetentionDays: number;
  hourlyRetentionDays: number;
  backupEnabled: boolean;
  backupIntervalDays: number;
  backupPath: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  rawRetentionDays: 7,
  hourlyRetentionDays: 90,
  backupEnabled: false,
  backupIntervalDays: 7,
  backupPath: null,
};

function nextHour(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d;
}

function nextMidnight(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

function inDays(days: number, now: Date): Date {
  return new Date(now.getTime() + Math.max(1, days) * 86_400_000);
}

async function loadSettings(): Promise<Settings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!row) return DEFAULT_SETTINGS;

  return {
    rawRetentionDays: row.rawRetentionDays,
    hourlyRetentionDays: row.hourlyRetentionDays,
    backupEnabled: row.backupEnabled,
    backupIntervalDays: row.backupIntervalDays,
    backupPath: row.backupPath ?? null,
  };
}

/**
 * The registry.
 *
 * `archive_grow` and `maintenance_check` are deliberately absent. Archiving
 * needs the separate archive-database design, and runtime-cadence maintenance
 * cannot work while nothing accumulates device runtime hours. A job with no
 * handler is rescheduled rather than repeatedly failed.
 */
function handlers(settings: Settings): Partial<Record<JobType, JobHandler>> {
  return {
    rollup_hourly: (now) => rollupHourly(sqliteConnection, now),
    rollup_daily: (now) => rollupDaily(sqliteConnection, now),
    prune_raw: (now) => pruneRaw(sqliteConnection, settings.rawRetentionDays, now),
    prune_hourly: (now) => pruneHourly(sqliteConnection, settings.hourlyRetentionDays, now),
    vacuum: (now) =>
      runBackup(
        sqliteConnection,
        { backupEnabled: settings.backupEnabled, backupPath: settings.backupPath },
        now,
      ),
  };
}

const CADENCE: Record<JobType, Cadence> = {
  rollup_hourly: (now) => nextHour(now),
  rollup_daily: (now) => nextMidnight(now),
  prune_raw: (now) => nextMidnight(now),
  prune_hourly: (now) => inDays(7, now),
  vacuum: (now, settings) => inDays(settings.backupIntervalDays, now),
  // No handler yet; checked rarely so an unimplemented job is not a hot loop.
  archive_grow: (now) => inDays(1, now),
  maintenance_check: (now) => nextMidnight(now),
  backup: (now, settings) => inDays(settings.backupIntervalDays, now),
};

function nextRunFor(type: JobType, now: Date, settings: Settings): Date {
  const cadence = CADENCE[type];
  return cadence ? cadence(now, settings) : inDays(1, now);
}

/**
 * Run every job that is due.
 *
 * Exported so a test, or a future "run now" endpoint, can drive one pass
 * without waiting on the interval.
 */
export async function runDueJobs(now: Date = new Date()): Promise<number> {
  const settings = await loadSettings();
  const registry = handlers(settings);

  const due = await db
    .select()
    .from(jobs)
    .where(and(lte(jobs.nextRunAt, now.toISOString()), ne(jobs.status, "running")));

  let ran = 0;

  for (const job of due) {
    const type = job.type as JobType;
    const handler = registry[type];

    if (!handler) {
      // Not implemented yet. Push it out so it stops appearing as due.
      await db
        .update(jobs)
        .set({ nextRunAt: nextRunFor(type, now, settings).toISOString(), status: "pending" })
        .where(eq(jobs.id, job.id));
      continue;
    }

    // Claimed before running, so an overrunning job is not started twice by the
    // next tick.
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, job.id));

    try {
      const summary = await handler(now);
      await db
        .update(jobs)
        .set({
          status: "done",
          lastRunAt: now.toISOString(),
          nextRunAt: nextRunFor(type, now, settings).toISOString(),
          lastError: null,
        })
        .where(eq(jobs.id, job.id));

      ran++;
      console.log(`[scheduler] ${type}`, summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Failure still reschedules. A job that gave up permanently after one
      // bad night would stop aggregating for good.
      await db
        .update(jobs)
        .set({
          status: "failed",
          lastRunAt: now.toISOString(),
          nextRunAt: nextRunFor(type, now, settings).toISOString(),
          lastError: message,
        })
        .where(eq(jobs.id, job.id));

      console.error(`[scheduler] ${type} failed:`, message);
    }
  }

  return ran;
}

/** One pass, gated on the controller lifecycle. */
export async function tickJobs(now: Date = new Date()): Promise<number> {
  // Housekeeping is monitoring, so it continues while paused. A stopped
  // controller does nothing at all.
  if (!canIngest()) return 0;
  return runDueJobs(now);
}

/**
 * Release jobs left mid-flight by a crash or a kill.
 *
 * A row stuck in `running` would never be picked up again, silently stopping
 * that job forever.
 */
export async function recoverStaleJobs(): Promise<number> {
  const stuck = await db.select().from(jobs).where(eq(jobs.status, "running"));
  if (stuck.length === 0) return 0;

  await db
    .update(jobs)
    .set({ status: "pending", lastError: "Interrupted; controller restarted" })
    .where(eq(jobs.status, "running"));

  return stuck.length;
}
