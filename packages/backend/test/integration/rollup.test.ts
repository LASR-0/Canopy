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
