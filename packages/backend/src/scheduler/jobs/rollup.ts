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
 *
 * Each bucket stores its **minimum and maximum** alongside the average. An
 * average on its own hides the excursion that mattered — a spike that tripped a
 * threshold at 14:03 vanishes into the mean for 14:00 — which is the opposite of
 * what the Logging page exists to show. Because the rollups are idempotent, a
 * re-roll repairs buckets written before these columns existed — but only back
 * as far as the surviving raw samples, since the rewrite deletes before it
 * inserts. See `resumeFrom`. Older buckets keep their average and report no
 * band, which the chart renders as a line with no envelope.
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
 *
 * Buckets missing their extremes reach further back. A bucket written before the
 * min/max columns existed carries nulls, and only a re-roll can fill them — but
 * the rewrite **deletes the range before inserting**, so reaching past raw
 * retention would delete rollups it cannot rebuild. The resume point is
 * therefore clamped to the oldest surviving raw sample: everything newer is
 * repaired, everything older keeps its average and its null extremes, and
 * nothing is destroyed.
 *
 * Returning null when no raw survives at all is the same guard. Without it the
 * job would delete its newest bucket and aggregate nothing back into it.
 */
function resumeFrom(
  db: Database,
  targetTable: "readings_hourly" | "readings_daily",
  floor: (iso: string) => string,
): string | null {
  const oldestRaw = (
    db.prepare("SELECT MIN(recorded_at) AS at FROM readings_raw").get() as { at: string | null }
  ).at;
  if (oldestRaw === null) return null;

  // Floored to the bucket containing that sample, not the sample itself. The
  // DELETE that opens the rewrite is bounded by this value, so a mid-bucket
  // boundary leaves the bucket in place and then inserts a second copy of it
  // alongside the original.
  const oldestRawBucket = floor(oldestRaw);

  const missingExtremes = (
    db
      .prepare(`SELECT MIN(recorded_at) AS at FROM ${targetTable} WHERE min_value IS NULL`)
      .get() as { at: string | null }
  ).at;
  if (missingExtremes !== null) {
    return missingExtremes > oldestRawBucket ? missingExtremes : oldestRawBucket;
  }

  const newest = (
    db.prepare(`SELECT MAX(recorded_at) AS at FROM ${targetTable}`).get() as { at: string | null }
  ).at;
  return newest ?? oldestRawBucket;
}

function rollup(
  db: Database,
  targetTable: "readings_hourly" | "readings_daily",
  bucketExpression: string,
  upperBound: string,
  floor: (iso: string) => string,
): RollupOutcome {
  const from = resumeFrom(db, targetTable, floor);
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
           (workspace_id, device_id, channel, metric, unit,
            value, min_value, max_value, recorded_at)
         SELECT workspace_id, device_id, channel, metric, unit,
                AVG(value), MIN(value), MAX(value),
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
    (iso) => hourBucket(new Date(iso)),
  );
}

/** Average raw samples into daily buckets, excluding the day in progress. */
export function rollupDaily(db: Database, now: Date = new Date()): RollupOutcome {
  return rollup(
    db,
    "readings_daily",
    `strftime('%Y-%m-%dT00:00:00.000Z', recorded_at)`,
    dayBucket(now),
    (iso) => dayBucket(new Date(iso)),
  );
}
