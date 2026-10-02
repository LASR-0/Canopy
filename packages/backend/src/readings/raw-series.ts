/**
 * Raw readings for a chart, thinned in SQL.
 *
 * A 6H chart used to select every raw row of the metric, build an object for
 * each, and then throw most of them away in JavaScript (`decimate`). At the
 * rate the dev loop once ran, that was ~85,000 rows per metric and nine
 * metrics at once, and better-sqlite3 is synchronous, so each request held up
 * the next one and ingest with them. The cap on points per line was right; it
 * was applied after the cost had been paid.
 *
 * Here the window is cut into `limit` equal time buckets per line, and SQLite
 * keeps the first reading of each, so only what is charted crosses into
 * JavaScript. Every point is still a real sample, never an average: raw has no
 * min/max band to carry an average's spread, so an average would invent a
 * smoother line than the tent had. At the normal sample rate a bucket holds at
 * most one reading up to several hours, and nothing is dropped at all.
 *
 * Buckets are by time, not by row, so a gap in the data (the controller off,
 * a device unplugged) stays a gap rather than being squeezed out.
 */
import type { Database, Statement } from "better-sqlite3";
import type { Metric } from "@canopy/shared-types";

export interface RawSeriesQuery {
  workspaceId: string;
  metric: Metric;
  deviceId?: string;
  from: string;
  to: string;
  /** Most points per line. */
  limit: number;
}

export interface RawSeriesRow {
  deviceId: string;
  channel: string;
  unit: string;
  value: number;
  recordedAt: string;
}

export interface RawSeries {
  /** Every line's points, oldest first. */
  rows: RawSeriesRow[];
  /** True when a bucket held more than one reading, so some were left out. */
  downsampled: boolean;
}

// SQLite's bare-column rule: with MIN() as the only aggregate, the other
// columns come from the row that holds the minimum, so value and unit belong
// to the first reading in the bucket. The lookup index serves the WHERE.
//
// The bucket is whole milliseconds over a whole-millisecond width, so it is
// integer division: julianday() alone is fractional days, and a reading on a
// bucket's edge came out as 0.99999 of it and fell into the bucket before.
// The casts matter: better-sqlite3 binds every JavaScript number as REAL.
// Rounded, its ~0.04 ms precision is exact. The two-argument min() is the
// scalar one: it puts a reading at exactly `to` in the last bucket rather than
// one past it.
const SQL = (withDevice: boolean) => `
  SELECT device_id AS deviceId, channel, unit, value,
         MIN(recorded_at) AS recordedAt, COUNT(*) AS n
  FROM readings_raw
  WHERE workspace_id = @workspaceId AND metric = @metric
    AND recorded_at >= @from AND recorded_at <= @to
    ${withDevice ? "AND device_id = @deviceId" : ""}
  GROUP BY device_id, channel,
    min((CAST(round((julianday(recorded_at) - 2440587.5) * 86400000) AS INTEGER) - CAST(@fromMs AS INTEGER))
        / CAST(@bucketMs AS INTEGER), @lastBucket)
  ORDER BY recordedAt`;

const statements = new WeakMap<Database, { all: Statement; one: Statement }>();

function prepared(sqlite: Database) {
  let held = statements.get(sqlite);
  if (!held) {
    held = { all: sqlite.prepare(SQL(false)), one: sqlite.prepare(SQL(true)) };
    statements.set(sqlite, held);
  }
  return held;
}

export function rawSeries(sqlite: Database, query: RawSeriesQuery): RawSeries {
  const fromMs = Date.parse(query.from);
  const span = Date.parse(query.to) - fromMs;
  // Rounded up, so the window never needs more than `limit` buckets. An
  // unparseable or reversed range selects nothing anyway; any positive width
  // keeps the arithmetic finite.
  const bucketMs = Number.isFinite(span) && span > 0 ? Math.max(1, Math.ceil(span / query.limit)) : 1;

  const { all, one } = prepared(sqlite);
  const params = {
    workspaceId: query.workspaceId,
    metric: query.metric,
    from: query.from,
    to: query.to,
    fromMs: Number.isFinite(fromMs) ? fromMs : 0,
    bucketMs,
    lastBucket: query.limit - 1,
    ...(query.deviceId ? { deviceId: query.deviceId } : {}),
  };
  const rows = (query.deviceId ? one : all).all(params) as (RawSeriesRow & { n: number })[];

  let downsampled = false;
  const out: RawSeriesRow[] = rows.map(({ n, ...row }) => {
    if (n > 1) downsampled = true;
    return row;
  });
  return { rows: out, downsampled };
}
