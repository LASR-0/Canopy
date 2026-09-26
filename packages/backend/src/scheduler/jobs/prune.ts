/**
 * Retention pruning.
 *
 * The important property here is the ordering guard. Pruning raw samples that
 * have not yet been rolled up destroys them permanently: the aggregate is the
 * only copy that outlives the retention window, and there is nothing to rebuild
 * it from. So each prune refuses to delete past the point its downstream
 * aggregate has actually reached, even when the retention window says it may.
 *
 * That makes a stalled rollup show up as a growing database rather than as
 * silently missing history, which is the failure mode worth having.
 */
import type { Database } from "better-sqlite3";

export interface PruneOutcome {
  deleted: number;
  /** Everything strictly older than this was removed. Null when nothing was. */
  cutoff: string | null;
  /** Set when retention wanted to delete more than the rollups allowed. */
  heldBackBy?: "rollup";
}

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function watermark(db: Database, table: string): string | null {
  const row = db.prepare(`SELECT MAX(recorded_at) AS at FROM ${table}`).get() as {
    at: string | null;
  };
  return row.at;
}

function prune(
  db: Database,
  table: "readings_raw" | "readings_hourly",
  aggregateTable: "readings_hourly" | "readings_daily",
  retentionDays: number,
  now: Date,
): PruneOutcome {
  const wanted = isoDaysAgo(retentionDays, now);

  // Nothing has been aggregated yet, so nothing may be discarded.
  const rolledUpTo = watermark(db, aggregateTable);
  if (rolledUpTo === null) {
    return { deleted: 0, cutoff: null, heldBackBy: "rollup" };
  }

  const cutoff = wanted <= rolledUpTo ? wanted : rolledUpTo;
  const result = db
    .prepare(`DELETE FROM ${table} WHERE recorded_at < ?`)
    .run(cutoff);

  return {
    deleted: result.changes,
    cutoff,
    ...(cutoff === rolledUpTo && wanted > rolledUpTo ? { heldBackBy: "rollup" as const } : {}),
  };
}

/** Drop raw samples past the retention window, but never past the hourly rollup. */
export function pruneRaw(
  db: Database,
  retentionDays: number,
  now: Date = new Date(),
): PruneOutcome {
  return prune(db, "readings_raw", "readings_hourly", retentionDays, now);
}

/** Drop hourly buckets past the retention window, but never past the daily rollup. */
export function pruneHourly(
  db: Database,
  retentionDays: number,
  now: Date = new Date(),
): PruneOutcome {
  return prune(db, "readings_hourly", "readings_daily", retentionDays, now);
}
