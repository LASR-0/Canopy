/**
 * Journal photos: files in the data directory, rows in `journal_photos`.
 *
 * A photo is uploaded as soon as it is picked, before its entry exists, so the
 * composer can show it at once. Until the entry is saved the row has no
 * `entry_id`. Saving names the entry's photos in order (`setEntryPhotos`),
 * which attaches the new ones and deletes any left out.
 *
 * Rows and files can part company: a grow or workspace deleted in the
 * database cascades its rows but leaves the files, and a photo picked for an
 * entry that was never saved stays pending. `pruneAttachments`, a daily job,
 * removes both kinds.
 *
 * The renderer shrinks photos before upload (long edge 2400 px, JPEG), so the
 * controller stores what it is sent and needs no image library.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { JournalPhoto, JournalPhotoRef } from "@canopy/shared-types";

/** Largest upload accepted. A shrunk photo is well under 2 MB. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_PHOTOS_PER_ENTRY = 20;
export const MAX_CAPTION_LENGTH = 280;
/** How long an uploaded photo may wait for its entry to be saved. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type PhotoType = keyof typeof TYPES;

/** What the bytes are, from their signature rather than a header anyone can set. */
export function sniffImage(bytes: Buffer): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function photoFile(dir: string, id: string, type: string): string {
  return join(dir, `${id}.${TYPES[type as PhotoType] ?? "bin"}`);
}

interface PhotoRow {
  id: string;
  workspace_id: string;
  entry_id: string | null;
  caption: string | null;
  sort_order: number;
  width: number;
  height: number;
  content_type: string;
  created_at: string;
}

function toPhoto(row: PhotoRow): JournalPhoto {
  const photo: JournalPhoto = { id: row.id, width: row.width, height: row.height };
  if (row.caption) photo.caption = row.caption;
  return photo;
}

async function removeFiles(dir: string, rows: Pick<PhotoRow, "id" | "content_type">[]): Promise<void> {
  // A file already gone is the state we wanted.
  await Promise.all(rows.map((r) => unlink(photoFile(dir, r.id, r.content_type)).catch(() => undefined)));
}

/** Store an upload as a pending photo. Returns an error message when the bytes are not a photo. */
export async function storePhoto(
  db: Database,
  dir: string,
  upload: { workspaceId: string; bytes: Buffer; width: number; height: number },
  now: Date = new Date(),
): Promise<JournalPhoto | string> {
  const type = sniffImage(upload.bytes);
  if (!type) return "Only JPEG, PNG and WebP photos can be stored";
  if (upload.bytes.length > MAX_PHOTO_BYTES) return "That photo is too large";
  const width = Math.round(upload.width);
  const height = Math.round(upload.height);
  if (!(width > 0 && height > 0)) return "A photo needs its width and height";

  const id = randomUUID();
  await mkdir(dir, { recursive: true });
  await writeFile(photoFile(dir, id, type), upload.bytes);
  db.prepare(`
    INSERT INTO journal_photos (id, workspace_id, entry_id, width, height, content_type, bytes, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
  `).run(id, upload.workspaceId, width, height, type, upload.bytes.length, now.toISOString());
  return { id, width, height };
}

/** The photo's file and type, for serving it. */
export function findPhoto(db: Database, dir: string, id: string): { file: string; type: string } | null {
  const row = db.prepare(`SELECT id, content_type FROM journal_photos WHERE id = ?`).get(id) as
    | Pick<PhotoRow, "id" | "content_type">
    | undefined;
  return row ? { file: photoFile(dir, row.id, row.content_type), type: row.content_type } : null;
}

/** Each entry's photos, in order. Entries without any are absent. */
export function photosForEntries(db: Database, entryIds: readonly string[]): Map<string, JournalPhoto[]> {
  const out = new Map<string, JournalPhoto[]>();
  if (entryIds.length === 0) return out;
  const rows = db.prepare(`
    SELECT * FROM journal_photos
    WHERE entry_id IN (${entryIds.map(() => "?").join(", ")})
    ORDER BY sort_order, created_at
  `).all(...entryIds) as PhotoRow[];
  for (const row of rows) {
    const list = out.get(row.entry_id!) ?? [];
    list.push(toPhoto(row));
    out.set(row.entry_id!, list);
  }
  return out;
}

/**
 * What is wrong with naming `refs` as an entry's photos, or null. A photo must
 * belong to the workspace and be pending or already on this entry. Checked
 * before an entry is written, so a bad list never leaves a half-saved entry.
 */
export function photoRefsProblem(
  db: Database,
  workspaceId: string,
  entryId: string,
  refs: unknown,
): string | null {
  if (!Array.isArray(refs)) return "photos must be a list";
  if (refs.length > MAX_PHOTOS_PER_ENTRY) return `An entry can hold at most ${MAX_PHOTOS_PER_ENTRY} photos`;
  const ids = (refs as JournalPhotoRef[]).map((r) => r?.id);
  if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) {
    return "Each photo must be named once, by id";
  }

  const find = db.prepare(`SELECT * FROM journal_photos WHERE id = ?`);
  for (const ref of refs as JournalPhotoRef[]) {
    const row = find.get(ref.id) as PhotoRow | undefined;
    if (!row || row.workspace_id !== workspaceId || (row.entry_id !== null && row.entry_id !== entryId)) {
      return `Photo ${ref.id} is not available to this entry`;
    }
    if (ref.caption !== undefined && typeof ref.caption !== "string") return "A caption must be text";
  }
  return null;
}

/**
 * Make `refs` the entry's photos, in that order. Photos on the entry that
 * `refs` leaves out are deleted, files and all. Returns an error message, or
 * null when done.
 */
export async function setEntryPhotos(
  db: Database,
  dir: string,
  workspaceId: string,
  entryId: string,
  refs: readonly JournalPhotoRef[],
): Promise<string | null> {
  const problem = photoRefsProblem(db, workspaceId, entryId, refs);
  if (problem) return problem;
  const ids = refs.map((r) => r.id);

  const dropped = (db.prepare(`SELECT id, content_type FROM journal_photos WHERE entry_id = ?`).all(entryId) as
    Pick<PhotoRow, "id" | "content_type">[]).filter((r) => !ids.includes(r.id));

  const attach = db.prepare(`UPDATE journal_photos SET entry_id = ?, sort_order = ?, caption = ? WHERE id = ?`);
  const remove = db.prepare(`DELETE FROM journal_photos WHERE id = ?`);
  db.transaction(() => {
    refs.forEach((ref, i) => {
      const caption = ref.caption?.trim().slice(0, MAX_CAPTION_LENGTH) || null;
      attach.run(entryId, i, caption, ref.id);
    });
    for (const r of dropped) remove.run(r.id);
  })();
  await removeFiles(dir, dropped);
  return null;
}

/** Delete an entry's photo files. Call before deleting the entry; the rows cascade. */
export async function deleteEntryPhotoFiles(db: Database, dir: string, entryId: string): Promise<void> {
  const rows = db.prepare(`SELECT id, content_type FROM journal_photos WHERE entry_id = ?`).all(entryId) as
    Pick<PhotoRow, "id" | "content_type">[];
  await removeFiles(dir, rows);
}

export interface PruneAttachmentsOutcome {
  /** Uploads never attached to an entry within a day. */
  pending: number;
  /** Files with no row, left by a grow or workspace deleted in the database. */
  orphanFiles: number;
}

/** The daily sweep: stale pending uploads, and files nothing points at. */
export async function pruneAttachments(db: Database, dir: string, now: Date = new Date()): Promise<PruneAttachmentsOutcome> {
  const cutoff = new Date(now.getTime() - PENDING_TTL_MS).toISOString();
  const stale = db.prepare(`SELECT id, content_type FROM journal_photos WHERE entry_id IS NULL AND created_at < ?`).all(cutoff) as
    Pick<PhotoRow, "id" | "content_type">[];
  const remove = db.prepare(`DELETE FROM journal_photos WHERE id = ?`);
  db.transaction(() => { for (const r of stale) remove.run(r.id); })();
  await removeFiles(dir, stale);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return { pending: stale.length, orphanFiles: 0 };
  }
  const known = new Set((db.prepare(`SELECT id FROM journal_photos`).all() as { id: string }[]).map((r) => r.id));
  let orphanFiles = 0;
  for (const name of files) {
    const id = name.replace(/\.[^.]+$/, "");
    if (known.has(id)) continue;
    // A file written this instant may not have its row yet; leave young ones.
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info || now.getTime() - info.mtimeMs < 60_000) continue;
    await unlink(join(dir, name)).catch(() => undefined);
    orphanFiles++;
  }
  return { pending: stale.length, orphanFiles };
}
