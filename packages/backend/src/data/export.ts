/**
 * Export everything: the database and the journal photos, as one `.canopy`
 * file (a gzipped tar; see tar.ts).
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

export const EXPORT_FORMAT = "canopy-export";
export const EXPORT_VERSION = 1;
export const DB_ENTRY = "canopy.db";
export const MANIFEST_ENTRY = "manifest.json";
export const PHOTO_PREFIX = "attachments/journal/";

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  workspaces: { id: string; name: string }[];
  photos: number;
}

export function exportFileName(now: Date = new Date()): string {
  return `canopy-export-${now.toISOString().slice(0, 10)}.canopy`;
}

/**
 * The export as a gzipped stream. The snapshot is written to `tmpDir` first
 * and removed once the stream has sent it.
 */
export async function exportArchive(db: Database, photoDir: string, tmpDir: string, now: Date = new Date()): Promise<Readable> {
  await mkdir(tmpDir, { recursive: true });
  const snapshot = join(tmpDir, `export-${now.getTime()}.db`);
  await db.backup(snapshot);

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
  }

  async function* archive(): AsyncGenerator<Buffer> {
    try {
      yield* tarStream(sources());
    } finally {
      await rm(snapshot, { force: true });
    }
  }

  return Readable.from(archive()).pipe(createGzip());
}
