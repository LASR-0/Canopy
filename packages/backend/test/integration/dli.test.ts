/**
 * Integration — daily light integral (before Phase 9, E)
 *
 * DLI is worked out from stored readings rather than stored, so it is tested
 * against real SQLite: past days from hourly rows, today from raw, and the
 * live running total, which must agree with a recount from raw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// dli.ts reaches the live store and the websocket for its live path; neither
// is wanted here, since every function under test is handed its database.
vi.mock("../../src/store/index.js", () => ({ db: {}, sqliteConnection: null }));
vi.mock("../../src/ws/index.js", () => ({ broadcast: vi.fn() }));

const { createTestDb } = await import("../helpers/db.js");
const {
  dailyDli, deriveDli, dliPoints, localDate, localMidnight, nextDate, resetDliForTesting, setDliSourcesForTesting,
} = await import("../../src/device-manager/dli.js");
type DliSource = import("../../src/device-manager/dli.js").DliSource;
type TestDb = import("../helpers/db.js").TestDb;

let testDb: TestDb;
let dir: string;

const HOUR = 3_600_000;
const ppfd: DliSource = {
  workspaceId: "ws-1", deviceId: "dev-l", channel: "par", metric: "ppfd", factor: 1, estimated: false, timeZone: "UTC",
};

beforeEach(async () => {
  testDb = createTestDb();
  dir = await mkdtemp(join(tmpdir(), "canopy-dli-"));
  resetDliForTesting();
});

afterEach(async () => {
  testDb.close();
  await rm(dir, { recursive: true, force: true });
});

/** One hourly row per hour from `start`, valued by `value(hourIndex)`. */
function hourly(start: string, hours: number, value: (h: number) => number, source = ppfd) {
  const insert = testDb.sqlite.prepare(`
    INSERT INTO readings_hourly (workspace_id, device_id, channel, metric, unit, value, recorded_at)
    VALUES (?, ?, ?, ?, 'umol_m2s', ?, ?)`);
  for (let h = 0; h < hours; h++) {
    insert.run(source.workspaceId, source.deviceId, source.channel, source.metric, value(h), new Date(Date.parse(start) + h * HOUR).toISOString());
  }
}

function raw(start: string, count: number, everyMs: number, value: (i: number) => number, source = ppfd) {
  const insert = testDb.sqlite.prepare(`
    INSERT INTO readings_raw (workspace_id, device_id, channel, metric, unit, value, recorded_at)
    VALUES (?, ?, ?, ?, 'umol_m2s', ?, ?)`);
  for (let i = 0; i < count; i++) {
    insert.run(source.workspaceId, source.deviceId, source.channel, source.metric, value(i), new Date(Date.parse(start) + i * everyMs).toISOString());
  }
}

describe("local days", () => {
  it("finds local midnight in a half-hour timezone", () => {
    // Adelaide is UTC+9:30 until daylight saving starts on 4 October.
    expect(localMidnight("2026-10-02", "Australia/Adelaide").toISOString()).toBe("2026-10-01T14:30:00.000Z");
    expect(localDate(new Date("2026-10-01T14:29:59Z"), "Australia/Adelaide")).toBe("2026-10-01");
    expect(localDate(new Date("2026-10-01T14:30:00Z"), "Australia/Adelaide")).toBe("2026-10-02");
  });

  it("gives the day daylight saving starts its 23 hours", () => {
    const start = localMidnight("2026-10-04", "Australia/Sydney");
    const end = localMidnight(nextDate("2026-10-04"), "Australia/Sydney");
    expect(start.toISOString()).toBe("2026-10-03T14:00:00.000Z");
    expect((end.getTime() - start.getTime()) / HOUR).toBe(23);
  });

  it("falls back to UTC for a timezone it does not know", () => {
    expect(localDate(new Date("2026-10-01T23:00:00Z"), "Not/AZone")).toBe("2026-10-01");
  });
});

describe("dailyDli", () => {
  const NOW = new Date("2026-10-05T12:00:00Z");

  it("sums a past day's hours: 12 hours at 500 µmol/m²/s is 21.6 mol/m²", () => {
    hourly("2026-10-01T00:00:00Z", 24, (h) => (h >= 6 && h < 18 ? 500 : 0));
    const [day] = dailyDli(testDb.sqlite, dir, ppfd, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T23:59:59Z"), NOW);
    expect(day).toMatchObject({ date: "2026-10-01", start: "2026-10-01T00:00:00.000Z", dli: 21.6, hours: 24, partial: false });
  });

  it("marks a day the sensor missed hours of as partial", () => {
    hourly("2026-10-01T00:00:00Z", 20, () => 100);
    expect(dailyDli(testDb.sqlite, dir, ppfd, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T12:00:00Z"), NOW)[0])
      .toMatchObject({ hours: 20, partial: true });
  });

  it("converts lux with the grow light's factor", () => {
    const lux: DliSource = { ...ppfd, metric: "lux", factor: 0.017, estimated: true };
    hourly("2026-10-01T00:00:00Z", 24, (h) => (h < 12 ? 30_000 : 0), lux);
    // 30,000 lux × 0.017 = 510 µmol/m²/s, for 12 hours.
    expect(dailyDli(testDb.sqlite, dir, lux, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T12:00:00Z"), NOW)[0]?.dli).toBe(22.03);
  });

  it("puts each hour in the day its middle falls in, so a half-hour zone's day has 24 of them", () => {
    const adelaide = { ...ppfd, timeZone: "Australia/Adelaide" };
    // UTC hours from 14:00 on 1 October: their middles run from 00:00 local on 2 October.
    hourly("2026-10-01T14:00:00Z", 24, () => 100, adelaide);
    const [day] = dailyDli(testDb.sqlite, dir, adelaide, new Date("2026-10-01T14:30:00Z"), new Date("2026-10-02T14:29:00Z"), NOW);
    expect(day).toMatchObject({ date: "2026-10-02", hours: 24, dli: 8.64, partial: false });
  });

  it("returns one entry per day in the range, oldest first, with empty days as zero", () => {
    hourly("2026-10-02T00:00:00Z", 24, () => 100);
    const days = dailyDli(testDb.sqlite, dir, ppfd, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-03T23:00:00Z"), NOW);
    expect(days.map((d) => [d.date, d.dli, d.partial])).toEqual([["2026-10-01", 0, true], ["2026-10-02", 8.64, false], ["2026-10-03", 0, true]]);
    // As chart points, a day with no readings is no data, not a day without light.
    expect(dliPoints(days)).toEqual([{ ts: "2026-10-02T00:00:00.000Z", value: 8.64 }]);
  });

  it("works out today from raw readings, and never says it is complete", () => {
    // Every 5 minutes from midnight: 06:00–12:00 at 600, dark before.
    raw("2026-10-05T00:00:00Z", 144, 5 * 60_000, (i) => (i >= 72 ? 600 : 0));
    const [today] = dailyDli(testDb.sqlite, dir, ppfd, new Date("2026-10-05T00:00:00Z"), NOW, NOW);
    // Six lit hours, each over by noon, so each counts in full: its mean × 3,600 s,
    // the same as a past day's hourly rows.
    expect(today).toMatchObject({ date: "2026-10-05", partial: true, hours: 12, dli: 12.96 });
  });
});

describe("deriveDli, live", () => {
  /** A reading as ingest stores it before deriving. */
  function ingest(at: string, value: number) {
    raw(at, 1, 0, () => value);
    return deriveDli({ workspaceId: "ws-1", deviceId: "dev-l", channel: "par", metric: "ppfd", unit: "umol_m2s", value, ts: at }, testDb.sqlite);
  }

  it("agrees with a recount from raw, without counting the newest reading twice", () => {
    setDliSourcesForTesting([ppfd]);
    raw("2026-10-05T06:00:00Z", 60, 60_000, () => 400); // 06:00–06:59, before a restart

    let last = null;
    for (let m = 0; m < 90; m += 5) last = ingest(new Date(Date.parse("2026-10-05T07:00:00Z") + m * 60_000).toISOString(), 800);

    const recount = dailyDli(testDb.sqlite, dir, ppfd, new Date("2026-10-05T00:00:00Z"), new Date(last!.ts), new Date(last!.ts))[0]!;
    expect(last!.value).toBeCloseTo(recount.dli, 2);
    expect(last).toMatchObject({ deviceId: "__derived__", channel: "dli", metric: "dli", unit: "mol_m2d" });
    expect(last).not.toHaveProperty("estimated");
  });

  it("starts again at local midnight", () => {
    setDliSourcesForTesting([ppfd]);
    ingest("2026-10-05T23:00:00Z", 1000);
    ingest("2026-10-05T23:59:00Z", 1000);
    expect(ingest("2026-10-06T00:01:00Z", 1000)!.value).toBeCloseTo(1000 * 60 / 1e6, 4);
  });

  it("flags DLI from lux as estimated, and ignores readings from other channels", () => {
    setDliSourcesForTesting([{ ...ppfd, metric: "lux", factor: 0.017, estimated: true }]);
    expect(ingest("2026-10-05T10:00:00Z", 20_000)).toMatchObject({ estimated: true });
    expect(deriveDli({ workspaceId: "ws-1", deviceId: "dev-t", channel: "t", metric: "temperature", unit: "C", value: 25, ts: "2026-10-05T10:00:00Z" }, testDb.sqlite)).toBeNull();
  });
});
