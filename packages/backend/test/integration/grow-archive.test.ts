/**
 * Integration — grow archives (before Phase 9, D)
 *
 * The hourly prune moves rows that fall inside a grow into that grow's own
 * file instead of deleting them, readers find them there, and a finished grow
 * gets its environment summary. Run against real SQLite files, since moving
 * rows between databases is the behaviour under test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { pruneHourly } from "../../src/scheduler/jobs/prune.js";
import {
  archiveBeforePrune,
  archivedHourly,
  openArchive,
  summariseFinishedGrows,
  withArchived,
} from "../../src/grow/archive.js";
import { deleteWorkspace, purgeWorkspace } from "../../src/workspaces/lifecycle.js";

let dir: string;
let testDb: TestDb;

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const at = (days: number, hours = 0) => new Date(T0 + days * DAY + hours * 3_600_000).toISOString();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "canopy-archive-"));
  testDb = createTestDb();
  testDb.sqlite.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-1', 'Tent 1', ?)`).run(at(0));
});

afterEach(async () => {
  testDb.close();
  await rm(dir, { recursive: true, force: true });
});

function grow(id: string, startDay: number, endDay: number | null, status = endDay === null ? "active" : "completed") {
  testDb.sqlite.prepare(`INSERT INTO grows (id, workspace_id, name, status, started_at, completed_at) VALUES (?, 'ws-1', ?, ?, ?, ?)`)
    .run(id, id, status, at(startDay), endDay === null ? null : at(endDay));
}

/** One hourly row per hour, valued by hour of day, for a device and metric. */
function hourly(fromDay: number, toDay: number, { device = "dev-t", channel = "t", metric = "temperature", base = 20 } = {}) {
  const insert = testDb.sqlite.prepare(`
    INSERT INTO readings_hourly (workspace_id, device_id, channel, metric, unit, value, min_value, max_value, recorded_at)
    VALUES ('ws-1', ?, ?, ?, 'C', ?, ?, ?, ?)`);
  testDb.sqlite.transaction(() => {
    for (let h = fromDay * 24; h < toDay * 24; h++) {
      const v = base + (h % 24) / 10;
      insert.run(device, channel, metric, v, v - 1, v + 1, new Date(T0 + h * 3_600_000).toISOString());
    }
  })();
}

/** Daily rows far enough on for the hourly prune not to be held back. */
function dailyThrough(day: number) {
  testDb.sqlite.prepare(`
    INSERT INTO readings_daily (workspace_id, device_id, channel, metric, unit, value, recorded_at)
    VALUES ('ws-1', 'dev-t', 't', 'temperature', 'C', 20, ?)`).run(at(day));
}

const liveCount = () => (testDb.sqlite.prepare(`SELECT COUNT(*) n FROM readings_hourly`).get() as { n: number }).n;
const archiveCount = (growId: string) => {
  const a = openArchive(dir, growId);
  if (!a) return 0;
  try { return (a.prepare(`SELECT COUNT(*) n FROM readings_hourly`).get() as { n: number }).n; } finally { a.close(); }
};

/** The hourly prune as the runner calls it. */
const prune = (retentionDays: number, nowDay: number) =>
  pruneHourly(testDb.sqlite, retentionDays, new Date(at(nowDay)), (cutoff) => archiveBeforePrune(testDb.sqlite, dir, cutoff));

describe("the hourly prune, with grows", () => {
  it("moves rows inside a grow to its archive and deletes the rest", () => {
    grow("g-1", 10, 20);
    hourly(0, 30);
    dailyThrough(40);

    prune(10, 40); // cutoff: day 30

    expect(liveCount()).toBe(0);
    // Days 10 to 20, through the hour the grow ended in.
    expect(archiveCount("g-1")).toBe(10 * 24 + 1);
  });

  it("archives an active grow's rows as they age out, not only at the end", () => {
    grow("g-live", 5, null);
    hourly(0, 20);
    dailyThrough(40);

    prune(25, 40); // cutoff: day 15

    expect(archiveCount("g-live")).toBe(10 * 24);
    expect(liveCount()).toBe(5 * 24);
  });

  it("never archives past the cutoff the daily rollup holds the prune back to", () => {
    grow("g-1", 0, 30);
    hourly(0, 30);
    dailyThrough(5);

    prune(1, 40);

    // Only what the prune actually deleted was moved.
    expect(archiveCount("g-1") + liveCount()).toBe(30 * 24);
    expect(archiveCount("g-1")).toBe(5 * 24);
  });

  it("is safe to run again: a row already archived is not doubled", () => {
    grow("g-1", 0, 10);
    hourly(0, 10);
    dailyThrough(40);

    // A crash after archiving but before the delete leaves rows in both.
    archiveBeforePrune(testDb.sqlite, dir, at(10));
    prune(10, 40);

    expect(archiveCount("g-1")).toBe(10 * 24);
    expect(liveCount()).toBe(0);
  });

  it("deletes nothing when moving fails", () => {
    grow("g-1", 0, 10);
    hourly(0, 10);
    dailyThrough(40);

    expect(() => pruneHourly(testDb.sqlite, 10, new Date(at(40)), () => { throw new Error("disk full"); })).toThrow(/disk full/);
    expect(liveCount()).toBe(10 * 24);
  });
});

describe("reading archived rows", () => {
  it("finds a grow's archived rows for a window, and adds them to live", () => {
    grow("g-1", 0, 20);
    hourly(0, 20);
    dailyThrough(40);
    prune(30, 40); // cutoff: day 10, so days 0–10 move

    const q = { workspaceId: "ws-1", metric: "temperature" as const, from: at(5), to: at(15) };
    const archived = archivedHourly(testDb.sqlite, dir, q);
    expect(archived).toHaveLength(5 * 24);

    const live = testDb.sqlite.prepare(`
      SELECT device_id AS deviceId, channel, unit, value, min_value AS minValue, max_value AS maxValue, recorded_at AS recordedAt
      FROM readings_hourly WHERE recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at`).all(at(5), at(15)) as never[];
    const merged = withArchived(live, archived);
    expect(merged).toHaveLength(10 * 24 + 1);
    expect(merged.map((r: { recordedAt: string }) => r.recordedAt)).toEqual(
      [...merged.map((r: { recordedAt: string }) => r.recordedAt)].sort(),
    );
  });

  it("drops an archived row live still holds, so a crash's duplicate shows once", () => {
    grow("g-1", 0, 2);
    hourly(0, 2);
    archiveBeforePrune(testDb.sqlite, dir, at(2)); // archived, not yet deleted

    const q = { workspaceId: "ws-1", metric: "temperature" as const, from: at(0), to: at(2) };
    const live = testDb.sqlite.prepare(`
      SELECT device_id AS deviceId, channel, unit, value, min_value AS minValue, max_value AS maxValue, recorded_at AS recordedAt
      FROM readings_hourly ORDER BY recorded_at`).all() as never[];
    expect(withArchived(live, archivedHourly(testDb.sqlite, dir, q))).toHaveLength(48);
  });
});

describe("summariseFinishedGrows", () => {
  const rolledUpAt = (iso: string) =>
    testDb.sqlite.prepare(`UPDATE jobs SET last_run_at = ? WHERE type = 'rollup_hourly'`).run(iso);
  const role = (deviceId: string, role: string, channel: string) =>
    testDb.sqlite.prepare(`INSERT INTO devices (id, workspace_id, name, family, protocol, capabilities_json, discovered_via) VALUES (?, 'ws-1', ?, 'generic-mqtt', 'mqtt', '[]', 'mqtt')`).run(deviceId, deviceId) &&
    testDb.sqlite.prepare(`INSERT INTO role_assignments (id, workspace_id, device_id, role, channel) VALUES (?, 'ws-1', ?, ?, ?)`).run(`r-${deviceId}`, deviceId, role, channel);
  const summary = (id: string) => testDb.sqlite.prepare(`
    SELECT env_avg_vpd vpd, env_temp_min tmin, env_temp_max tmax, env_temp_avg tavg, env_rh_min hmin, env_rh_max hmax, env_rh_avg havg, env_summarised_at at
    FROM grows WHERE id = ?`).get(id) as Record<string, number | string | null>;

  beforeEach(() => {
    role("dev-t", "canopy_temp", "t");
    role("dev-h", "canopy_rh", "h");
  });

  it("summarises the canopy sensors and VPD over the grow, archived hours included", () => {
    grow("g-1", 0, 2);
    hourly(0, 2, { device: "dev-t", channel: "t" });                                     // 20.0–22.3, ±1
    hourly(0, 2, { device: "dev-h", channel: "h", metric: "humidity", base: 55 });
    hourly(0, 2, { device: "__derived__", channel: "vpd", metric: "vpd", base: 1 });
    hourly(0, 2, { device: "dev-res", channel: "t", base: 35 });                          // reservoir: left out
    dailyThrough(40);
    prune(30, 31.5); // day 1.5 onward stays live; the rest is archived
    rolledUpAt(at(3));

    expect(summariseFinishedGrows(testDb.sqlite, dir, new Date(at(3)))).toEqual({ summarised: 1 });
    expect(summary("g-1")).toMatchObject({ tmin: 19, tmax: 23.3, tavg: 21.2, hmin: 54, hmax: 58.3, havg: 56.2, vpd: 2.15 });
  });

  it("waits until the hourly rollup has run past the grow's end", () => {
    grow("g-1", 0, 2);
    hourly(0, 2);
    rolledUpAt(at(2, -1));

    expect(summariseFinishedGrows(testDb.sqlite, dir, new Date(at(2)))).toEqual({ summarised: 0 });
    rolledUpAt(at(2, 1));
    expect(summariseFinishedGrows(testDb.sqlite, dir, new Date(at(2, 1)))).toEqual({ summarised: 1 });
  });

  it("marks a grow with no readings as summarised, so it is not looked at every hour", () => {
    grow("g-empty", 0, 2, "aborted");
    rolledUpAt(at(3));

    expect(summariseFinishedGrows(testDb.sqlite, dir, new Date(at(3)))).toEqual({ summarised: 1 });
    expect(summary("g-empty")).toMatchObject({ tavg: null, vpd: null, at: at(3) });
    expect(summariseFinishedGrows(testDb.sqlite, dir, new Date(at(3)))).toEqual({ summarised: 0 });
  });

  it("leaves active grows alone", () => {
    grow("g-live", 0, null);
    hourly(0, 2);
    rolledUpAt(at(3));
    expect(summariseFinishedGrows(testDb.sqlite, dir, new Date(at(3)))).toEqual({ summarised: 0 });
  });
});

describe("deleting a workspace for good", () => {
  it("removes its grows' archives", async () => {
    grow("g-1", 0, 2);
    hourly(0, 2);
    archiveBeforePrune(testDb.sqlite, dir, at(2));
    expect(existsSync(join(dir, "grow-g-1.db"))).toBe(true);

    testDb.sqlite.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-2', 'Tent 2', ?)`).run(at(0));
    deleteWorkspace(testDb.sqlite, "ws-1");
    await purgeWorkspace(testDb.sqlite, join(dir, "photos"), "ws-1", dir);

    expect(await readdir(dir)).toEqual([]);
  });
});
