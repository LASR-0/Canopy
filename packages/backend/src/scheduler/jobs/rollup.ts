/**
 * Reading rollups — raw samples into hourly and daily averages.
 *
 * Retention is tiered: raw is kept about a week, the aggregates for months.
 * The Overview's sparklines read `hourly` on the 24H and 7D ranges and `daily`
 * on 30D, so until these run those ranges render blank. This is the fix for a
 * visible hole, not housekeeping.
 *
 * Both rollups are **idempotent**: each deletes the buckets it is about to
 * write before writing them. Re-running one repairs a partial result rather
 * than doubling it, which matters because the controller can be stopped
 * mid-job.
 *
 * Both aggregate from `readings_raw` rather than chaining daily off hourly.
 * Averaging an average is only correct when every hour carries the same number
 * of samples, and a device that drops out for twenty minutes breaks that.
 */
import type { Database } from "better-sqlite3";

export interface RollupOutcome {
  /** Rows written into the target table. */
  written: number;
  /** Bucket range covered, for logging. Null when there was nothing to do. */
  from: string | null;
  to: string | null;
}

const EMPTY: RollupOutcome = { written: 0, from: null, to: null };

/** Start of the hour containing `at`, as an ISO string. */
export function hourBucket(at: Date): string {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** Start of the UTC day containing `at`, as an ISO string. */
export function dayBucket(at: Date): string {
  const d = new Date(at);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Where to resume aggregating.
 *
 * The newest bucket already written is redone rather than skipped: it may have
 * been built from a partial hour, and re-deriving it from raw is cheap. Falling
 * back to the oldest raw sample means a first run backfills everything it can
 * rather than only the last hour.
 */
function resumeFrom(
  db: Database,
  targetTable: "readings_hourly" | "readings_daily",
): string | null {
  const target = db
    .prepare(`SELECT MAX(recorded_at) AS at FROM ${targetTable}`)
    .get() as { at: string | null };
  if (target.at) return target.at;

  const raw = db
    .prepare("SELECT MIN(recorded_at) AS at FROM readings_raw")
    .get() as { at: string | null };
  return raw.at;
}

function rollup(
  db: Database,
  targetTable: "readings_hourly" | "readings_daily",
  bucketExpression: string,
  upperBound: string,
): RollupOutcome {
  const from = resumeFrom(db, targetTable);
  if (from === null || from >= upperBound) return EMPTY;

  // One transaction: a half-applied rollup would leave the deleted buckets
  // missing until the next run.
  const run = db.transaction(() => {
    db.prepare(
      `DELETE FROM ${targetTable} WHERE recorded_at >= ? AND recorded_at < ?`,
    ).run(from, upperBound);

    const result = db
      .prepare(
        `INSERT INTO ${targetTable}
           (workspace_id, device_id, channel, metric, unit, value, recorded_at)
         SELECT workspace_id, device_id, channel, metric, unit,
                AVG(value),
                ${bucketExpression}
           FROM readings_raw
          WHERE recorded_at >= ? AND recorded_at < ?
          GROUP BY workspace_id, device_id, channel, metric, unit, ${bucketExpression}`,
      )
      .run(from, upperBound);

    return result.changes;
  });

  return { written: run(), from, to: upperBound };
}

/**
 * Average raw samples into hourly buckets.
 *
 * The hour in progress is excluded. Rolling it up would write an average over
 * a partial hour, and the next run would have to redo it anyway.
 */
export function rollupHourly(db: Database, now: Date = new Date()): RollupOutcome {
  return rollup(
    db,
    "readings_hourly",
    `strftime('%Y-%m-%dT%H:00:00.000Z', recorded_at)`,
    hourBucket(now),
  );
}

/** Average raw samples into daily buckets, excluding the day in progress. */
export function rollupDaily(db: Database, now: Date = new Date()): RollupOutcome {
  return rollup(
    db,
    "readings_daily",
    `strftime('%Y-%m-%dT00:00:00.000Z', recorded_at)`,
    dayBucket(now),
  );
}
