/**
 * Integration — rollups and retention pruning (Phase 5)
 *
 * Run against a real in-memory SQLite rather than mocks: these are set-based
 * SQL, and the aggregation and the ordering guard are exactly the parts a mock
 * would assume rather than prove.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { rollupHourly, rollupDaily, hourBucket, dayBucket } from "../../src/scheduler/jobs/rollup.js";
import { pruneRaw, pruneHourly } from "../../src/scheduler/jobs/prune.js";

let testDb: TestDb;

beforeEach(() => {
  testDb = createTestDb();
  testDb.sqlite
    .prepare(
      `INSERT INTO workspaces (id, name, created_at, archived, timezone)
       VALUES ('ws-1', 'Tent', '2026-01-01T00:00:00.000Z', 0, 'UTC')`,
    )
    .run();
});

afterEach(() => testDb?.close());

/** Insert a raw sample. */
function raw(at: string, value: number, metric = "temperature", device = "dev-1") {
  testDb.sqlite
    .prepare(
      `INSERT INTO readings_raw
         (workspace_id, device_id, channel, metric, unit, value, recorded_at)
       VALUES ('ws-1', ?, 'ch', ?, 'C', ?, ?)`,
    )
    .run(device, metric, value, at);
}

function hourlyRows() {
  return testDb.sqlite
    .prepare("SELECT metric, value, recorded_at FROM readings_hourly ORDER BY recorded_at, metric")
    .all() as { metric: string; value: number; recorded_at: string }[];
}

function count(table: string): number {
  return (testDb.sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
}

describe("bucket helpers", () => {
  it("floors to the hour and the day", () => {
    const at = new Date("2026-09-26T14:37:12.345Z");

    expect(hourBucket(at)).toBe("2026-09-26T14:00:00.000Z");
    expect(dayBucket(at)).toBe("2026-09-26T00:00:00.000Z");
  });
});

describe("rollupHourly", () => {
  it("averages each hour's samples into one row per channel and metric", () => {
    raw("2026-09-26T10:05:00.000Z", 20);
    raw("2026-09-26T10:35:00.000Z", 24);
    raw("2026-09-26T11:05:00.000Z", 30);

    const outcome = rollupHourly(testDb.sqlite, new Date("2026-09-26T12:00:00.000Z"));

    expect(outcome.written).toBe(2);
    expect(hourlyRows()).toEqual([
      { metric: "temperature", value: 22, recorded_at: "2026-09-26T10:00:00.000Z" },
      { metric: "temperature", value: 30, recorded_at: "2026-09-26T11:00:00.000Z" },
    ]);
  });

  it("keeps metrics and devices apart rather than averaging across them", () => {
    raw("2026-09-26T10:05:00.000Z", 20, "temperature", "dev-1");
    raw("2026-09-26T10:06:00.000Z", 60, "humidity", "dev-1");
    raw("2026-09-26T10:07:00.000Z", 30, "temperature", "dev-2");

    rollupHourly(testDb.sqlite, new Date("2026-09-26T12:00:00.000Z"));

    expect(count("readings_hourly")).toBe(3);
  });

  it("excludes the hour in progress, which is only partly sampled", () => {
    raw("2026-09-26T10:30:00.000Z", 20);
    raw("2026-09-26T11:05:00.000Z", 99);

    rollupHourly(testDb.sqlite, new Date("2026-09-26T11:30:00.000Z"));

    expect(hourlyRows().map((r) => r.recorded_at)).toEqual(["2026-09-26T10:00:00.000Z"]);
  });

  it("is idempotent: re-running repairs rather than doubles", () => {
    raw("2026-09-26T10:05:00.000Z", 20);
    raw("2026-09-26T10:35:00.000Z", 24);

    const at = new Date("2026-09-26T12:00:00.000Z");
    rollupHourly(testDb.sqlite, at);
    rollupHourly(testDb.sqlite, at);
    rollupHourly(testDb.sqlite, at);

    expect(count("readings_hourly")).toBe(1);
    expect(hourlyRows()[0]?.value).toBe(22);
  });

  it("rebuilds the newest bucket, so a partially sampled hour is corrected", () => {
    raw("2026-09-26T10:05:00.000Z", 20);
    rollupHourly(testDb.sqlite, new Date("2026-09-26T11:00:00.000Z"));
    expect(hourlyRows()[0]?.value).toBe(20);

    // A late sample lands in an hour already rolled up.
    raw("2026-09-26T10:50:00.000Z", 30);
    rollupHourly(testDb.sqlite, new Date("2026-09-26T11:00:00.000Z"));

    expect(count("readings_hourly")).toBe(1);
    expect(hourlyRows()[0]?.value).toBe(25);
  });

  it("backfills a gap left by downtime instead of only the last hour", () => {
    for (let hour = 0; hour < 6; hour++) {
      raw(`2026-09-26T0${hour}:30:00.000Z`, 20 + hour);
    }

    const outcome = rollupHourly(testDb.sqlite, new Date("2026-09-26T06:00:00.000Z"));

    expect(outcome.written).toBe(6);
  });

  it("does nothing when there is no raw data at all", () => {
    const outcome = rollupHourly(testDb.sqlite, new Date("2026-09-26T12:00:00.000Z"));

    expect(outcome).toEqual({ written: 0, from: null, to: null });
  });
});

describe("rollupDaily", () => {
  it("averages a whole day from raw, not from the hourly averages", () => {
    // Two samples in one hour and one in another. Averaging the hourly
    // averages would give 25; the true mean of the three values is 23.33.
    raw("2026-09-25T10:00:00.000Z", 20);
    raw("2026-09-25T10:30:00.000Z", 20);
    raw("2026-09-25T18:00:00.000Z", 30);

    rollupDaily(testDb.sqlite, new Date("2026-09-26T01:00:00.000Z"));

    const [row] = testDb.sqlite
      .prepare("SELECT value, recorded_at FROM readings_daily")
      .all() as { value: number; recorded_at: string }[];

    expect(row?.recorded_at).toBe("2026-09-25T00:00:00.000Z");
    expect(row?.value).toBeCloseTo(23.333, 2);
  });

  it("excludes the day in progress", () => {
    raw("2026-09-25T10:00:00.000Z", 20);
    raw("2026-09-26T10:00:00.000Z", 40);

    rollupDaily(testDb.sqlite, new Date("2026-09-26T12:00:00.000Z"));

    expect(count("readings_daily")).toBe(1);
  });
});

describe("pruneRaw", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");

  it("refuses to delete anything before the first rollup has run", () => {
    raw("2026-01-01T00:00:00.000Z", 20);

    const outcome = pruneRaw(testDb.sqlite, 7, now);

    expect(outcome.deleted).toBe(0);
    expect(outcome.heldBackBy).toBe("rollup");
    expect(count("readings_raw")).toBe(1);
  });

  it("deletes samples past the retention window once they are rolled up", () => {
    raw("2026-09-01T00:00:00.000Z", 20); // old
    raw("2026-09-26T10:00:00.000Z", 22); // recent
    rollupHourly(testDb.sqlite, now);

    const outcome = pruneRaw(testDb.sqlite, 7, now);

    expect(outcome.deleted).toBe(1);
    expect(count("readings_raw")).toBe(1);
  });

  it("never deletes past the rollup watermark, even when retention says it may", () => {
    // Everything is older than the window, but only the first hour has been
    // aggregated. The rest must survive.
    raw("2026-09-01T00:30:00.000Z", 20);
    raw("2026-09-02T00:30:00.000Z", 21);
    raw("2026-09-03T00:30:00.000Z", 22);
    // Roll up only as far as the 2nd.
    rollupHourly(testDb.sqlite, new Date("2026-09-02T01:00:00.000Z"));

    const outcome = pruneRaw(testDb.sqlite, 7, now);

    expect(outcome.heldBackBy).toBe("rollup");
    expect(count("readings_raw")).toBeGreaterThan(0);
    // The sample from the 3rd was never aggregated, so it is still there.
    const remaining = testDb.sqlite
      .prepare("SELECT recorded_at FROM readings_raw ORDER BY recorded_at")
      .all() as { recorded_at: string }[];
    expect(remaining.some((r) => r.recorded_at.startsWith("2026-09-03"))).toBe(true);
  });
});

describe("pruneHourly", () => {
  it("is guarded by the daily rollup the same way", () => {
    raw("2026-09-01T00:30:00.000Z", 20);
    rollupHourly(testDb.sqlite, new Date("2026-09-26T12:00:00.000Z"));

    const outcome = pruneHourly(testDb.sqlite, 90, new Date("2026-12-26T12:00:00.000Z"));

    expect(outcome.deleted).toBe(0);
    expect(outcome.heldBackBy).toBe("rollup");
  });

  it("deletes hourly buckets the daily rollup has moved past", () => {
    raw("2026-09-01T00:30:00.000Z", 20);
    raw("2026-09-05T00:30:00.000Z", 21);
    const after = new Date("2026-09-26T12:00:00.000Z");
    rollupHourly(testDb.sqlite, after);
    rollupDaily(testDb.sqlite, after);

    const outcome = pruneHourly(testDb.sqlite, 7, after);

    // The 1st is behind the daily watermark and goes. The 5th *is* the
    // watermark, and the guard is strict, so it stays for one more cycle.
    expect(outcome.deleted).toBe(1);
    expect(outcome.heldBackBy).toBe("rollup");
    const remaining = testDb.sqlite
      .prepare("SELECT recorded_at FROM readings_hourly")
      .all() as { recorded_at: string }[];
    expect(remaining.map((r) => r.recorded_at)).toEqual(["2026-09-05T00:00:00.000Z"]);
  });
});

/**
 * Bucket extremes.
 *
 * An average alone hides the excursion that mattered: the spike that tripped a
 * threshold disappears into the mean for its hour, which is the opposite of what
 * a history page is for.
 */
describe("rollup extremes", () => {
  function hourlyExtremes() {
    return testDb.sqlite
      .prepare(
        `SELECT value, min_value, max_value, recorded_at
           FROM readings_hourly ORDER BY recorded_at`,
      )
      .all() as { value: number; min_value: number; max_value: number; recorded_at: string }[];
  }

  it("stores the min and max of the bucket alongside the average", () => {
    raw("2026-03-02T04:05:00.000Z", 20);
    raw("2026-03-02T04:25:00.000Z", 30);
    raw("2026-03-02T04:45:00.000Z", 25);

    rollupHourly(testDb.sqlite, new Date("2026-03-02T06:00:00.000Z"));

    const [bucket] = hourlyExtremes();
    expect(bucket!.value).toBeCloseTo(25, 5);
    expect(bucket!.min_value).toBe(20);
    expect(bucket!.max_value).toBe(30);
  });

  it("keeps a spike visible that the average smooths away", () => {
    // Fifty-nine calm samples and one excursion: the mean barely moves, so the
    // maximum is the only thing that still reports it.
    for (let i = 0; i < 59; i++) raw(`2026-03-03T01:${String(i).padStart(2, "0")}:00.000Z`, 24);
    raw("2026-03-03T01:59:30.000Z", 41);

    rollupHourly(testDb.sqlite, new Date("2026-03-03T03:00:00.000Z"));

    const [bucket] = hourlyExtremes();
    expect(bucket!.value).toBeLessThan(25);
    expect(bucket!.max_value).toBe(41);
  });

  it("gives a single-sample bucket equal min, max and average", () => {
    raw("2026-03-04T08:10:00.000Z", 18.5);
    rollupHourly(testDb.sqlite, new Date("2026-03-04T10:00:00.000Z"));

    const [bucket] = hourlyExtremes();
    expect(bucket!.min_value).toBe(18.5);
    expect(bucket!.max_value).toBe(18.5);
    expect(bucket!.value).toBeCloseTo(18.5, 5);
  });

  it("keeps extremes per device rather than across the tent", () => {
    raw("2026-03-05T05:10:00.000Z", 20, "temperature", "dev-a");
    raw("2026-03-05T05:20:00.000Z", 22, "temperature", "dev-a");
    raw("2026-03-05T05:30:00.000Z", 35, "temperature", "dev-b");

    rollupHourly(testDb.sqlite, new Date("2026-03-05T07:00:00.000Z"));

    const rows = testDb.sqlite
      .prepare(
        `SELECT device_id, min_value, max_value FROM readings_hourly ORDER BY device_id`,
      )
      .all() as { device_id: string; min_value: number; max_value: number }[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ device_id: "dev-a", min_value: 20, max_value: 22 });
    expect(rows[1]).toMatchObject({ device_id: "dev-b", min_value: 35, max_value: 35 });
  });

  it("backfills extremes when a bucket is re-rolled", () => {
    // Rollups are idempotent, which is what lets a bucket written before these
    // columns existed be repaired rather than migrated.
    raw("2026-03-06T02:15:00.000Z", 10);
    raw("2026-03-06T02:45:00.000Z", 20);
    testDb.sqlite
      .prepare(
        `INSERT INTO readings_hourly
           (workspace_id, device_id, channel, metric, unit, value, recorded_at)
         VALUES ('ws-1','dev-1','ch','temperature','C', 15, '2026-03-06T02:00:00.000Z')`,
      )
      .run();
    expect(hourlyExtremes()[0]!.max_value).toBeNull();

    rollupHourly(testDb.sqlite, new Date("2026-03-06T04:00:00.000Z"));

    const rows = hourlyExtremes();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.min_value).toBe(10);
    expect(rows[0]!.max_value).toBe(20);
  });

  it("stores extremes on daily buckets too", () => {
    raw("2026-03-07T03:00:00.000Z", 12);
    raw("2026-03-07T15:00:00.000Z", 28);

    rollupDaily(testDb.sqlite, new Date("2026-03-09T00:00:00.000Z"));

    const [bucket] = testDb.sqlite
      .prepare("SELECT min_value, max_value FROM readings_daily ORDER BY recorded_at")
      .all() as { min_value: number; max_value: number }[];
    expect(bucket).toMatchObject({ min_value: 12, max_value: 28 });
  });
});

/**
 * Backfilling extremes without destroying history.
 *
 * The repair path and the data-loss hazard are the same mechanism: a re-roll
 * deletes its range before rebuilding it from raw. Reaching back further than
 * raw retention would therefore delete rollups it cannot rebuild.
 */
describe("extremes backfill is bounded by raw retention", () => {
  /** A rollup bucket as written before the min/max columns existed. */
  function legacyHourly(at: string, value: number, device = "dev-1") {
    testDb.sqlite
      .prepare(
        `INSERT INTO readings_hourly
           (workspace_id, device_id, channel, metric, unit, value, recorded_at)
         VALUES ('ws-1', ?, 'ch', 'temperature', 'C', ?, ?)`,
      )
      .run(device, value, at);
  }

  function hourlyAt(at: string) {
    return testDb.sqlite
      .prepare("SELECT value, min_value, max_value FROM readings_hourly WHERE recorded_at = ?")
      .get(at) as { value: number; min_value: number | null; max_value: number | null } | undefined;
  }

  it("repairs older buckets, not just the newest", () => {
    legacyHourly("2026-04-01T01:00:00.000Z", 20);
    legacyHourly("2026-04-01T02:00:00.000Z", 22);
    legacyHourly("2026-04-01T03:00:00.000Z", 24);
    raw("2026-04-01T01:30:00.000Z", 19);
    raw("2026-04-01T01:40:00.000Z", 21);
    raw("2026-04-01T02:30:00.000Z", 22);
    raw("2026-04-01T03:30:00.000Z", 24);

    rollupHourly(testDb.sqlite, new Date("2026-04-01T05:00:00.000Z"));

    // The first bucket is the one a newest-only resume would have left null.
    expect(hourlyAt("2026-04-01T01:00:00.000Z")).toMatchObject({ min_value: 19, max_value: 21 });
    expect(hourlyAt("2026-04-01T02:00:00.000Z")).toMatchObject({ min_value: 22, max_value: 22 });
    expect(hourlyAt("2026-04-01T03:00:00.000Z")).toMatchObject({ min_value: 24, max_value: 24 });
  });

  it("does not delete buckets whose raw samples have been pruned", () => {
    // The archive: a bucket far older than any surviving raw sample.
    legacyHourly("2026-01-01T00:00:00.000Z", 18);
    // Raw only goes back to April, so January cannot be rebuilt.
    legacyHourly("2026-04-01T01:00:00.000Z", 20);
    raw("2026-04-01T01:30:00.000Z", 19);
    raw("2026-04-01T01:40:00.000Z", 21);

    rollupHourly(testDb.sqlite, new Date("2026-04-01T05:00:00.000Z"));

    const january = hourlyAt("2026-01-01T00:00:00.000Z");
    expect(january).toBeDefined();
    expect(january!.value).toBe(18);
    // Unrecoverable, and correctly left alone rather than deleted.
    expect(january!.min_value).toBeNull();
    // Still repaired where raw survives.
    expect(hourlyAt("2026-04-01T01:00:00.000Z")).toMatchObject({ min_value: 19, max_value: 21 });
  });

  it("does nothing at all when no raw samples survive", () => {
    // Otherwise the job deletes its newest bucket and aggregates nothing back in.
    legacyHourly("2026-01-01T00:00:00.000Z", 18);
    legacyHourly("2026-01-01T01:00:00.000Z", 19);

    const outcome = rollupHourly(testDb.sqlite, new Date("2026-06-01T00:00:00.000Z"));

    expect(outcome.written).toBe(0);
    expect(count("readings_hourly")).toBe(2);
    expect(hourlyAt("2026-01-01T00:00:00.000Z")!.value).toBe(18);
  });

  it("stops reaching back once every bucket has its extremes", () => {
    raw("2026-04-02T01:30:00.000Z", 20);
    rollupHourly(testDb.sqlite, new Date("2026-04-02T03:00:00.000Z"));
    expect(hourlyAt("2026-04-02T01:00:00.000Z")).toMatchObject({ min_value: 20 });

    // With no nulls left, a second run resumes at the newest bucket as before
    // rather than rewriting the whole retained range every hour.
    const outcome = rollupHourly(testDb.sqlite, new Date("2026-04-02T03:00:00.000Z"));
    expect(outcome.from).toBe("2026-04-02T01:00:00.000Z");
  });
});
