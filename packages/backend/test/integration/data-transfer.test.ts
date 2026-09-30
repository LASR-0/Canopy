/**
 * Integration — export and import (Phase 7.5 F)
 *
 * Import adds workspaces from a file beside the ones here. The failures that
 * would matter are silent: a copied row still pointing at an id from the other
 * controller, a device's readings going to two places, an import that
 * collides with the data it was exported from.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { createTestDb, type TestDb } from "../helpers/db.js";
import { exportArchive } from "../../src/data/export.js";
import { ImportError, applyImport, resetImportSessions, stageImport } from "../../src/data/import.js";
import { tarStream } from "../../src/data/tar.js";

let dir: string;
let source: TestDb;
let live: TestDb;
const NOW = "2026-09-30T00:00:00.000Z";
const PHOTO_ID = "11111111-2222-4333-8444-555555555555";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "canopy-transfer-"));
  resetImportSessions();

  // The controller the file comes from: one tent with a bit of everything.
  source = createTestDb();
  const s = source.sqlite;
  s.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-a', 'Tent 1', ?)`).run(NOW);
  const device = s.prepare(`INSERT INTO devices (id, workspace_id, name, family, protocol, mqtt_topic_prefix, capabilities_json, discovered_via, online)
    VALUES (?, 'ws-a', ?, 'tasmota', 'mqtt', ?, ?, 'mqtt', 1)`);
  device.run("dev-shared", "Shared fan", "fan-1", JSON.stringify([{ kind: "sensor", channel: "t", metric: "temperature", unit: "C", stateTopic: "fan-1/temp" }]));
  device.run("dev-own", "Own light", "light-9", JSON.stringify([{ kind: "sensor", channel: "l", metric: "lux", unit: "lux", stateTopic: "light-9/lux" }]));
  s.prepare(`INSERT INTO role_assignments (id, workspace_id, device_id, role, channel) VALUES ('ra-1', 'ws-a', 'dev-own', 'canopy_light', 'l')`).run();
  s.prepare(`INSERT INTO grows (id, workspace_id, name, status, started_at) VALUES ('g-1', 'ws-a', 'Grow', 'active', ?)`).run(NOW);
  s.prepare(`UPDATE workspaces SET active_grow_id = 'g-1' WHERE id = 'ws-a'`).run();
  s.prepare(`INSERT INTO journal_entries (id, workspace_id, grow_id, grow_day, grow_week, type, title, created_at) VALUES ('e-1', 'ws-a', 'g-1', 1, 1, 'photo', 'Photo', ?)`).run(NOW);
  s.prepare(`INSERT INTO journal_photos (id, workspace_id, entry_id, width, height, content_type, bytes, created_at) VALUES (?, 'ws-a', 'e-1', 10, 10, 'image/jpeg', 4, ?)`).run(PHOTO_ID, NOW);
  s.prepare(`INSERT INTO automations (id, workspace_id, name, enabled, kind, subsystem, driver, trigger_json, actions_json) VALUES ('au-1', 'ws-a', 'Lights', 1, 'schedule', 'lighting', 'schedule', '{"kind":"window","on":"06:00","off":"18:00"}', '[]')`).run();
  s.prepare(`INSERT INTO events (id, workspace_id, type, source_id, description, occurred_at) VALUES ('ev-1', 'ws-a', 'automation_fired', 'au-1', 'on', ?)`).run(NOW);
  const reading = s.prepare(`INSERT INTO readings_raw (workspace_id, device_id, channel, metric, unit, value, recorded_at) VALUES ('ws-a', ?, 'c', 'temperature', 'C', ?, ?)`);
  s.transaction(() => {
    for (let i = 0; i < 25_000; i++) reading.run(i % 2 ? "dev-own" : "__derived__", i, NOW);
  })();

  // Here: a tent with the same name, and the shared fan already found.
  live = createTestDb();
  const l = live.sqlite;
  l.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-here', 'Tent 1', ?)`).run(NOW);
  l.prepare(`INSERT INTO devices (id, workspace_id, name, family, protocol, mqtt_topic_prefix, capabilities_json, discovered_via)
    VALUES ('dev-here', 'ws-here', 'Fan', 'tasmota', 'mqtt', 'fan-1', '[]', 'mqtt')`).run();
});

afterEach(async () => {
  source.close();
  live.close();
  await rm(dir, { recursive: true, force: true });
});

/** Export the source controller to a file, with one photo on disk. */
async function exportSource(): Promise<string> {
  const photos = join(dir, "source-photos");
  await mkdir(photos, { recursive: true });
  await writeFile(join(photos, `${PHOTO_ID}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  const file = join(dir, "export.canopy");
  await pipeline(await exportArchive(source.sqlite, photos, join(dir, "tmp")), createWriteStream(file));
  return file;
}

const read = (file: string) => createReadStream(file) as AsyncIterable<Buffer>;
const loaded = async () => {};

describe("export, then import", () => {
  it("previews the file's workspaces with their counts, clashes and devices already here", async () => {
    const preview = await stageImport(read(await exportSource()), join(dir, "staging"), live.sqlite);

    expect(preview.workspaces).toHaveLength(1);
    expect(preview.workspaces[0]).toMatchObject({
      id: "ws-a", name: "Tent 1", importedName: "Tent 1 (imported)",
      grows: 1, entries: 1, photos: 1, automations: 1, devices: 2, devicesAlreadyHere: 1, readings: 25_000,
    });
  });

  it("adds the workspace with new ids, every reference following", async () => {
    const preview = await stageImport(read(await exportSource()), join(dir, "staging"), live.sqlite);
    const photoDir = join(dir, "live-photos");
    const status = await applyImport(live.sqlite, preview.token, ["ws-a"], photoDir, loaded);
    expect(status.state).toBe("done");

    const l = live.sqlite;
    const ws = l.prepare(`SELECT * FROM workspaces WHERE name = 'Tent 1 (imported)'`).get() as { id: string; active_grow_id: string };
    expect(ws.id).not.toBe("ws-a");
    // Nothing here was changed.
    expect(l.prepare(`SELECT name FROM workspaces WHERE id = 'ws-here'`).get()).toEqual({ name: "Tent 1" });

    const grow = l.prepare(`SELECT id FROM grows WHERE workspace_id = ?`).get(ws.id) as { id: string };
    expect(ws.active_grow_id).toBe(grow.id);

    const devices = l.prepare(`SELECT id, name, online, detached_at FROM devices WHERE workspace_id = ? ORDER BY name`).all(ws.id) as
      { id: string; name: string; online: number; detached_at: string | null }[];
    expect(devices.map((d) => [d.name, d.detached_at !== null, d.online])).toEqual([["Own light", false, 0], ["Shared fan", true, 0]]);
    const own = devices.find((d) => d.name === "Own light")!;

    expect(l.prepare(`SELECT device_id FROM role_assignments WHERE workspace_id = ?`).get(ws.id)).toEqual({ device_id: own.id });

    const readings = l.prepare(`SELECT device_id, COUNT(*) n FROM readings_raw WHERE workspace_id = ? GROUP BY device_id`).all(ws.id);
    expect(readings).toHaveLength(2);
    expect(readings).toEqual(expect.arrayContaining([{ device_id: "__derived__", n: 12_500 }, { device_id: own.id, n: 12_500 }]));

    const automation = l.prepare(`SELECT id FROM automations WHERE workspace_id = ?`).get(ws.id) as { id: string };
    expect(l.prepare(`SELECT source_id FROM events WHERE workspace_id = ?`).get(ws.id)).toEqual({ source_id: automation.id });

    const photo = l.prepare(`SELECT id, entry_id FROM journal_photos WHERE workspace_id = ?`).get(ws.id) as { id: string; entry_id: string };
    expect(photo.id).not.toBe(PHOTO_ID);
    expect(await readdir(photoDir)).toEqual([`${photo.id}.jpg`]);

    // Imported history does not light the badges.
    expect((l.prepare(`SELECT COUNT(*) n FROM notification_seen WHERE workspace_id = ?`).get(ws.id) as { n: number }).n).toBe(4);
    expect(status.result?.[0]).toMatchObject({ name: "Tent 1 (imported)", devices: 2, detachedDevices: 1, readings: 25_000, photos: 1 });
  });

  it("can import the same file twice without colliding", async () => {
    const file = await exportSource();
    for (let i = 0; i < 2; i++) {
      const preview = await stageImport(read(file), join(dir, "staging"), live.sqlite);
      expect((await applyImport(live.sqlite, preview.token, ["ws-a"], join(dir, "live-photos"), loaded)).state).toBe("done");
    }
    const names = (live.sqlite.prepare(`SELECT name FROM workspaces ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(["Tent 1", "Tent 1 (imported 2)", "Tent 1 (imported)"]);
  });
});

describe("stageImport refuses", () => {
  it("a file that is not an export", async () => {
    const file = join(dir, "photo.jpg");
    await writeFile(file, Buffer.from("definitely not gzip"));
    await expect(stageImport(read(file), join(dir, "staging"), live.sqlite)).rejects.toThrow(ImportError);
  });

  it("an export from a newer Canopy", async () => {
    const manifest = Buffer.from(JSON.stringify({ format: "canopy-export", version: 99, exportedAt: NOW, workspaces: [], photos: 0 }));
    const file = join(dir, "future.canopy");
    const db = Buffer.from("x");
    await pipeline(
      Readable.from(tarStream([{ name: "manifest.json", size: manifest.length, data: manifest }, { name: "canopy.db", size: 1, data: db }])),
      createGzip(),
      createWriteStream(file),
    );
    await expect(stageImport(read(file), join(dir, "staging"), live.sqlite)).rejects.toThrow(/newer version/);
  });
});
