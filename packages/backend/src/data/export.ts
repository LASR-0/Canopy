/**
 * Export everything: the database, the journal photos and the grows' archives
 * (grow/archive.ts), as one `.canopy` file (a gzipped tar; see tar.ts).
 *
 * The database is copied with SQLite's online backup API, which takes a
 * consistent snapshot while the controller keeps writing, a few pages at a
 * time so it never stalls the controller the way one long statement would. A
 * plain copy of a live WAL database can capture a torn state.
 */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import type { Database } from "better-sqlite3";
import { tarStream, type TarSource } from "./tar.js";
import { ARCHIVE_FILE } from "../grow/archive.js";
import { openDatabase } from "../store/sqlite.js";

export const EXPORT_FORMAT = "canopy-export";
export const EXPORT_VERSION = 1;
export const DB_ENTRY = "canopy.db";
export const MANIFEST_ENTRY = "manifest.json";
export const PHOTO_PREFIX = "attachments/journal/";
export const ARCHIVE_PREFIX = "archive/";

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  workspaces: { id: string; name: string }[];
  photos: number;
  /** Grow archives. Absent from exports made before they existed. */
  archives?: number;
}

export function exportFileName(now: Date = new Date()): string {
  return `canopy-export-${now.toISOString().slice(0, 10)}.canopy`;
}

/**
 * The export as a gzipped stream. The snapshots are written to `tmpDir` first
 * and removed once the stream has sent them. Grow archives are snapshotted the
 * same way as the database, since the hourly prune may be writing to one.
 */
export async function exportArchive(db: Database, photoDir: string, tmpDir: string, now: Date = new Date(), archiveDir?: string): Promise<Readable> {
  await mkdir(tmpDir, { recursive: true });
  const snapshot = join(tmpDir, `export-${now.getTime()}.db`);
  await db.backup(snapshot);

  const archives: { name: string; path: string }[] = [];
  if (archiveDir) {
    let names: string[] = [];
    try {
      names = (await readdir(archiveDir)).filter((n) => ARCHIVE_FILE.test(n));
    } catch {
      // No grow has been archived yet.
    }
    for (const name of names) {
      const path = join(tmpDir, `export-${now.getTime()}-${name}`);
      const archive = openDatabase(join(archiveDir, name), { readonly: true });
      try {
        await archive.backup(path);
        archives.push({ name, path });
      } finally {
        archive.close();
      }
    }
  }

  const workspaces = db.prepare(`SELECT id, name FROM workspaces ORDER BY created_at`).all() as { id: string; name: string }[];
  let photos: string[] = [];
  try {
    photos = (await readdir(photoDir)).filter((n) => !n.startsWith("."));
  } catch {
    // No photo has ever been stored.
  }

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    workspaces,
    photos: photos.length,
    archives: archives.length,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));

  async function* sources(): AsyncGenerator<TarSource> {
    yield { name: MANIFEST_ENTRY, size: manifestBytes.length, data: manifestBytes };
    yield { name: DB_ENTRY, size: (await stat(snapshot)).size, path: snapshot };
    for (const name of photos) {
      const path = join(photoDir, name);
      const info = await stat(path).catch(() => null);
      // A photo deleted since the listing is simply left out.
      if (info?.isFile()) yield { name: PHOTO_PREFIX + name, size: info.size, path };
    }
    for (const { name, path } of archives) {
      yield { name: ARCHIVE_PREFIX + name, size: (await stat(path)).size, path };
    }
  }

  async function* archive(): AsyncGenerator<Buffer> {
    try {
      yield* tarStream(sources());
    } finally {
      await rm(snapshot, { force: true });
      await Promise.all(archives.map((a) => rm(a.path, { force: true })));
    }
  }

  return Readable.from(archive()).pipe(createGzip());
}
