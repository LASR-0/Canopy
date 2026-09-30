/**
 * Integration — archive, Recently deleted, purge (Phase 7.5 G)
 *
 * The expensive mistakes here are silent: a purge that leaves millions of
 * readings behind, a restore that brings two devices onto one piece of
 * hardware, the app left with no workspace to open.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/db.js";
import {
  archiveWorkspace,
  deleteWorkspace,
  purgeDeletedWorkspaces,
  purgeWorkspace,
  restoreWorkspace,
} from "../../src/workspaces/lifecycle.js";

let testDb: TestDb;
let photoDir: string;
const NOW = new Date("2026-09-30T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const state = (id: string) =>
  testDb.sqlite.prepare(`SELECT archived_at, deleted_at FROM workspaces WHERE id = ?`).get(id) as
    { archived_at: string | null; deleted_at: string | null } | undefined;
const active = () => (testDb.sqlite.prepare(`SELECT active_workspace_id a FROM app_settings WHERE id = 1`).get() as { a: string | null }).a;

beforeEach(async () => {
  testDb = createTestDb();
  photoDir = await mkdtemp(join(tmpdir(), "canopy-lifecycle-"));
  const db = testDb.sqlite;
  const ws = db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`);
  ws.run("ws-1", "Tent 1", "2026-01-01T00:00:00Z");
  ws.run("ws-2", "Tent 2", "2026-01-02T00:00:00Z");
  db.prepare(`UPDATE app_settings SET active_workspace_id = 'ws-2' WHERE id = 1`).run();
});
afterEach(async () => {
  testDb.close();
  await rm(photoDir, { recursive: true, force: true });
});

describe("archive and delete", () => {
  it("archives, moving the app to another workspace if it was the active one", () => {
    archiveWorkspace(testDb.sqlite, "ws-2", NOW);
    expect(state("ws-2")!.archived_at).toBe(NOW.toISOString());
    expect(active()).toBe("ws-1");
  });

  it("deletes into Recently deleted, from live or from archived", () => {
    archiveWorkspace(testDb.sqlite, "ws-2", NOW);
    deleteWorkspace(testDb.sqlite, "ws-2", NOW);
    expect(state("ws-2")).toEqual({ archived_at: null, deleted_at: NOW.toISOString() });
  });

  it("will not put away the last live workspace", () => {
    archiveWorkspace(testDb.sqlite, "ws-1", NOW);
    expect(() => deleteWorkspace(testDb.sqlite, "ws-2", NOW)).toThrow(/at least one workspace/);
    expect(state("ws-2")!.deleted_at).toBeNull();
  });
});

describe("restoreWorkspace", () => {
  it("brings an archived or deleted workspace back live", () => {
    deleteWorkspace(testDb.sqlite, "ws-2", NOW);
    restoreWorkspace(testDb.sqlite, "ws-2", NOW);
    expect(state("ws-2")).toEqual({ archived_at: null, deleted_at: null });
  });

  it("brings a device back detached if another live workspace has found its hardware meanwhile", () => {
    const db = testDb.sqlite;
    const device = db.prepare(`INSERT INTO devices (id, workspace_id, name, family, protocol, mqtt_topic_prefix, capabilities_json, discovered_via) VALUES (?, ?, 'Fan', 'tasmota', 'mqtt', ?, '[]', 'mqtt')`);
    device.run("fan-old", "ws-2", "fan-1");
    device.run("light", "ws-2", "light-1");
    archiveWorkspace(db, "ws-2", NOW);
    // While Tent 2 was away, Tent 1 found the fan.
    device.run("fan-new", "ws-1", "fan-1");

    expect(restoreWorkspace(db, "ws-2", NOW)).toEqual({ detachedDevices: 1 });
    const rows = db.prepare(`SELECT id, detached_at FROM devices WHERE workspace_id = 'ws-2' ORDER BY id`).all();
    expect(rows).toEqual([{ id: "fan-old", detached_at: NOW.toISOString() }, { id: "light", detached_at: null }]);
  });
});

describe("purge", () => {
  it("removes everything under the workspace, readings and photo files included", async () => {
    const db = testDb.sqlite;
    db.prepare(`INSERT INTO grows (id, workspace_id, name, status) VALUES ('g', 'ws-2', 'Grow', 'active')`).run();
    db.prepare(`INSERT INTO journal_entries (id, workspace_id, grow_id, grow_day, grow_week, type, title, created_at) VALUES ('e', 'ws-2', 'g', 1, 1, 'photo', 't', ?)`).run(NOW.toISOString());
    db.prepare(`INSERT INTO journal_photos (id, workspace_id, entry_id, width, height, content_type, bytes, created_at) VALUES ('p', 'ws-2', 'e', 1, 1, 'image/jpeg', 1, ?)`).run(NOW.toISOString());
    await writeFile(join(photoDir, "p.jpg"), "x");
    const reading = db.prepare(`INSERT INTO readings_raw (workspace_id, device_id, channel, metric, unit, value, recorded_at) VALUES (?, 'd', 'c', 'temperature', 'C', 1, ?)`);
    db.transaction(() => {
      for (let i = 0; i < 12_000; i++) reading.run("ws-2", NOW.toISOString());
      reading.run("ws-1", NOW.toISOString());
    })();

    deleteWorkspace(db, "ws-2", NOW);
    await purgeWorkspace(db, photoDir, "ws-2");

    expect(state("ws-2")).toBeUndefined();
    expect(db.prepare(`SELECT workspace_id, COUNT(*) n FROM readings_raw GROUP BY workspace_id`).all()).toEqual([{ workspace_id: "ws-1", n: 1 }]);
    expect(db.prepare(`SELECT COUNT(*) n FROM journal_entries`).get()).toEqual({ n: 0 });
    expect(await readdir(photoDir)).toEqual([]);
  });

  it("refuses to purge a workspace that is not in Recently deleted", async () => {
    await expect(purgeWorkspace(testDb.sqlite, photoDir, "ws-2")).rejects.toThrow(/Recently deleted/);
  });

  it("the daily job purges only what has been deleted for 7 days", async () => {
    deleteWorkspace(testDb.sqlite, "ws-2", NOW);
    expect(await purgeDeletedWorkspaces(testDb.sqlite, photoDir, days(6))).toEqual({ purged: 0 });
    expect(await purgeDeletedWorkspaces(testDb.sqlite, photoDir, days(7))).toEqual({ purged: 1 });
    expect(state("ws-2")).toBeUndefined();
  });
});
