/**
 * Integration — raw readings thinned in SQL (before Phase 9, C)
 *
 * The thinning relies on SQLite's bare-column rule (value comes from the row
 * holding MIN(recorded_at)), so it is run against real SQLite: a mock would
 * assume exactly the behaviour under test.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { rawSeries } from "../../src/readings/raw-series.js";

let testDb: TestDb | undefined;
afterEach(() => {
  testDb?.close();
  testDb = undefined;
});

const FROM = "2026-10-02T00:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(FROM) + ms).toISOString();

/** One reading every `everyMs` for `count` readings, valued by index. */
function seed(count: number, everyMs: number, { deviceId = "dev-1", channel = "temp", startMs = 0 } = {}) {
  testDb ??= createTestDb();
  const insert = testDb.sqlite.prepare(
    `INSERT INTO readings_raw (workspace_id, device_id, channel, metric, unit, value, recorded_at)
     VALUES ('ws-1', ?, ?, 'temperature', 'C', ?, ?)`,
  );
  testDb.sqlite.transaction(() => {
    for (let i = 0; i < count; i++) insert.run(deviceId, channel, i, at(startMs + i * everyMs));
  })();
}

const query = (toMs: number, limit: number, extra: { deviceId?: string } = {}) =>
  rawSeries(testDb!.sqlite, { workspaceId: "ws-1", metric: "temperature", from: FROM, to: at(toMs), limit, ...extra });

describe("rawSeries", () => {
  it("returns every reading when each bucket holds at most one", () => {
    seed(100, 5000);
    const { rows, downsampled } = query(100 * 5000, 2000);

    expect(rows.map((r) => r.value)).toEqual([...Array(100).keys()]);
    expect(downsampled).toBe(false);
  });

  it("thins to at most `limit` points per line, keeping the first reading of each bucket", () => {
    seed(1000, 1000);
    const { rows, downsampled } = query(1000 * 1000, 100);

    expect(rows).toHaveLength(100);
    expect(downsampled).toBe(true);
    // Ten readings a bucket: the first of each, with its own value and time.
    expect(rows.slice(0, 3).map((r) => [r.value, r.recordedAt])).toEqual([[0, at(0)], [10, at(10_000)], [20, at(20_000)]]);
  });

  it("puts a reading at exactly the end of the window in the last bucket, not one past it", () => {
    seed(11, 1000);
    expect(query(10_000, 10).rows).toHaveLength(10);
  });

  it("keeps a gap a gap, rather than spreading the points over it", () => {
    seed(10, 1000);
    seed(10, 1000, { startMs: 90_000 });
    const { rows } = query(100_000, 100);

    expect(rows).toHaveLength(20);
    expect(rows[10]!.recordedAt).toBe(at(90_000));
  });

  it("thins each device and channel on its own, and returns them oldest first", () => {
    seed(50, 1000, { deviceId: "dev-1" });
    seed(50, 1000, { deviceId: "dev-2", startMs: 500 });
    const { rows } = query(50_000, 10);

    expect(rows.filter((r) => r.deviceId === "dev-1")).toHaveLength(10);
    expect(rows.filter((r) => r.deviceId === "dev-2")).toHaveLength(10);
    expect(rows.map((r) => r.recordedAt)).toEqual([...rows.map((r) => r.recordedAt)].sort());
  });

  it("limits to one device when asked", () => {
    seed(20, 1000, { deviceId: "dev-1" });
    seed(20, 1000, { deviceId: "dev-2" });
    expect(new Set(query(20_000, 100, { deviceId: "dev-2" }).rows.map((r) => r.deviceId))).toEqual(new Set(["dev-2"]));
  });

  it("returns nothing for a reversed or empty range", () => {
    seed(10, 1000);
    expect(rawSeries(testDb!.sqlite, { workspaceId: "ws-1", metric: "temperature", from: at(10_000), to: FROM, limit: 100 }).rows).toEqual([]);
    expect(rawSeries(testDb!.sqlite, { workspaceId: "ws-1", metric: "humidity", from: FROM, to: at(10_000), limit: 100 }).rows).toEqual([]);
  });
});
