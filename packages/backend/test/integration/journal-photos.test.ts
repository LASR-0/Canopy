/**
 * Integration — journal photos (Phase 7.5 E)
 *
 * Photos are files and rows that must stay in step. The failures worth
 * pinning are the silent ones: a photo moved onto someone else's entry, a
 * removed photo whose file stays on disk forever, and a cleanup that deletes
 * a file still in use.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/db.js";
import {
  PENDING_TTL_MS,
  deleteEntryPhotoFiles,
  photosForEntries,
  pruneAttachments,
  setEntryPhotos,
  sniffImage,
  storePhoto,
} from "../../src/grow/journal-photos.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const NOW = new Date("2026-09-30T12:00:00.000Z");

let testDb: TestDb;
let dir: string;

beforeEach(async () => {
  testDb = createTestDb();
  dir = await mkdtemp(join(tmpdir(), "canopy-photos-"));
  const db = testDb.sqlite;
  db.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws-1', 'Tent', ?), ('ws-2', 'Other', ?)`).run(NOW.toISOString(), NOW.toISOString());
  db.prepare(`INSERT INTO grows (id, workspace_id, name, status) VALUES ('g-1', 'ws-1', 'Grow', 'active')`).run();
  const entry = db.prepare(
    `INSERT INTO journal_entries (id, workspace_id, grow_id, grow_day, grow_week, type, title, created_at) VALUES (?, 'ws-1', 'g-1', 1, 1, 'photo', 't', ?)`,
  );
  entry.run("e-1", NOW.toISOString());
  entry.run("e-2", NOW.toISOString());
});
afterEach(async () => {
  testDb.close();
  await rm(dir, { recursive: true, force: true });
});

const upload = async (ws = "ws-1", at = NOW) => {
  const photo = await storePhoto(testDb.sqlite, dir, { workspaceId: ws, bytes: JPEG, width: 2400, height: 1800 }, at);
  if (typeof photo === "string") throw new Error(photo);
  return photo;
};

describe("storePhoto", () => {
  it("stores a JPEG and reports its size", async () => {
    const photo = await upload();
    expect(photo).toMatchObject({ width: 2400, height: 1800 });
    expect(await readdir(dir)).toEqual([`${photo.id}.jpg`]);
  });

  it("refuses bytes that are not a photo, whatever they claim to be", async () => {
    const result = await storePhoto(testDb.sqlite, dir, { workspaceId: "ws-1", bytes: Buffer.from("<svg/>"), width: 1, height: 1 });
    expect(result).toMatch(/JPEG, PNG and WebP/);
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
  });
});

describe("setEntryPhotos", () => {
  it("attaches in the order given, with captions", async () => {
    const a = await upload();
    const b = await upload();
    expect(await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-1", [{ id: b.id, caption: " second " }, { id: a.id }])).toBeNull();

    const photos = photosForEntries(testDb.sqlite, ["e-1"]).get("e-1")!;
    expect(photos.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(photos[0]!.caption).toBe("second");
  });

  it("deletes a photo left out, file and all", async () => {
    const a = await upload();
    const b = await upload();
    await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-1", [{ id: a.id }, { id: b.id }]);
    await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-1", [{ id: b.id }]);

    expect(photosForEntries(testDb.sqlite, ["e-1"]).get("e-1")!.map((p) => p.id)).toEqual([b.id]);
    expect(await readdir(dir)).toEqual([`${b.id}.jpg`]);
  });

  it("will not take another entry's photo, or another workspace's", async () => {
    const mine = await upload();
    await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-1", [{ id: mine.id }]);
    const theirs = await upload("ws-2");

    expect(await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-2", [{ id: mine.id }])).toMatch(/not available/);
    expect(await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-2", [{ id: theirs.id }])).toMatch(/not available/);
  });
});

describe("deleteEntryPhotoFiles", () => {
  it("removes the files of an entry about to be deleted", async () => {
    const a = await upload();
    await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-1", [{ id: a.id }]);
    await deleteEntryPhotoFiles(testDb.sqlite, dir, "e-1");
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("pruneAttachments", () => {
  it("clears uploads never attached within a day, and keeps attached ones", async () => {
    const stale = await upload("ws-1", new Date(NOW.getTime() - PENDING_TTL_MS - 1000));
    const kept = await upload();
    await setEntryPhotos(testDb.sqlite, dir, "ws-1", "e-1", [{ id: kept.id }]);
    const fresh = await upload();

    const outcome = await pruneAttachments(testDb.sqlite, dir, NOW);
    expect(outcome.pending).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([`${fresh.id}.jpg`, `${kept.id}.jpg`].sort());
    expect(stale.id).not.toBe(kept.id);
  });

  it("removes files nothing points at, but not one written a moment ago", async () => {
    const old = join(dir, "gone-grow-photo.jpg");
    await writeFile(old, JPEG);
    const oldTime = new Date(Date.now() - 3_600_000);
    await utimes(old, oldTime, oldTime);
    await writeFile(join(dir, "just-written.jpg"), JPEG);

    const outcome = await pruneAttachments(testDb.sqlite, dir, new Date(Date.now()));
    expect(outcome.orphanFiles).toBe(1);
    expect(await readdir(dir)).toEqual(["just-written.jpg"]);
  });
});
