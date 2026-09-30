/**
 * A workspace's life: live, archived, recently deleted, gone.
 *
 * - **Archive** puts a workspace away indefinitely. It is kept whole and can be
 *   restored at any time.
 * - **Delete** moves it to Recently deleted, where it can be restored for
 *   `WORKSPACE_RESTORE_DAYS`. After that `purgeDeletedWorkspaces`, a daily job,
 *   removes it and everything under it.
 *
 * Archived or deleted, the controller does nothing for it (see ingest's topic
 * index, the scheduler and the heartbeat): no readings, automations or alerts.
 * Its devices are held, idle, until a restore. Hardware found by another
 * workspace meanwhile stays there, and the restored copy comes back detached.
 *
 * One live workspace always remains, since the app needs somewhere to be.
 */
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { WORKSPACE_RESTORE_DAYS } from "@canopy/shared-types";
import { alreadyClaimed, claimedTopics, type DeviceTopicsRow } from "../device-manager/claims.js";

/** A change the workspace's state does not allow, or a workspace that does not exist. */
export class WorkspaceStateError extends Error {
  constructor(message: string, readonly notFound = false) {
    super(message);
  }
}

const DAY_MS = 86_400_000;
/** Readings deleted per batch when purging, between yields to the event loop. */
export const PURGE_BATCH = 5_000;
const READINGS_TABLES = ["readings_raw", "readings_hourly", "readings_daily"] as const;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

interface WorkspaceRow {
  id: string;
  name: string;
  archived_at: string | null;
  deleted_at: string | null;
}

function find(db: Database, id: string): WorkspaceRow {
  const row = db.prepare(`SELECT id, name, archived_at, deleted_at FROM workspaces WHERE id = ?`).get(id) as WorkspaceRow | undefined;
  if (!row) throw new WorkspaceStateError("Workspace not found", true);
  return row;
}

const isLive = (w: WorkspaceRow) => !w.archived_at && !w.deleted_at;

function otherLive(db: Database, id: string): string | undefined {
  const row = db.prepare(
    `SELECT id FROM workspaces WHERE id <> ? AND archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
  ).get(id) as { id: string } | undefined;
  return row?.id;
}

/**
 * Putting a live workspace away: one must remain, and if it was the active
 * one the app moves to another.
 */
function putAway(db: Database, w: WorkspaceRow, set: string, at: string): void {
  if (isLive(w)) {
    const next = otherLive(db, w.id);
    if (!next) throw new WorkspaceStateError("Keep at least one workspace: add another before putting this one away");
    db.prepare(`UPDATE app_settings SET active_workspace_id = ? WHERE id = 1 AND active_workspace_id = ?`).run(next, w.id);
  }
  db.prepare(`UPDATE workspaces SET ${set} WHERE id = ?`).run(at, w.id);
}

export function archiveWorkspace(db: Database, id: string, now: Date = new Date()): void {
  const w = find(db, id);
  if (w.archived_at) return;
  if (w.deleted_at) throw new WorkspaceStateError("Restore it from Recently deleted first");
  db.transaction(() => putAway(db, w, "archived_at = ?", now.toISOString()))();
}

/** Move to Recently deleted, from live or archived. Restoring brings it back live. */
export function deleteWorkspace(db: Database, id: string, now: Date = new Date()): void {
  const w = find(db, id);
  if (w.deleted_at) return;
  db.transaction(() => putAway(db, w, "deleted_at = ?, archived_at = NULL", now.toISOString()))();
}

/**
 * Bring an archived or deleted workspace back live. Its devices whose hardware
 * another live workspace has found meanwhile come back detached. Returns how
 * many.
 */
export function restoreWorkspace(db: Database, id: string, now: Date = new Date()): { detachedDevices: number } {
  const w = find(db, id);
  if (isLive(w)) return { detachedDevices: 0 };
  return db.transaction(() => {
    const devices = db.prepare(
      `SELECT id, mqtt_topic_prefix, capabilities_json FROM devices WHERE workspace_id = ? AND forgotten = 0 AND detached_at IS NULL`,
    ).all(id) as (DeviceTopicsRow & { id: string })[];
    const clash = alreadyClaimed(devices, claimedTopics(db, id));
    const detach = db.prepare(`UPDATE devices SET detached_at = ?, online = 0 WHERE id = ?`);
    for (const deviceId of clash) detach.run(now.toISOString(), deviceId);
    db.prepare(`UPDATE workspaces SET archived_at = NULL, deleted_at = NULL WHERE id = ?`).run(id);
    return { detachedDevices: clash.size };
  })();
}

export const purgeAt = (deletedAt: string) =>
  new Date(Date.parse(deletedAt) + WORKSPACE_RESTORE_DAYS * DAY_MS).toISOString();

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Remove a deleted workspace for good. Readings have no foreign key to cascade
 * on and can run to millions, so they go first, in batches that yield. The
 * rest cascades from the workspace row, and photo files are removed by hand.
 */
export async function purgeWorkspace(db: Database, photoDir: string, id: string): Promise<void> {
  const w = find(db, id);
  if (!w.deleted_at) throw new WorkspaceStateError("Only a workspace in Recently deleted can be deleted for good");

  for (const table of READINGS_TABLES) {
    const batch = db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE workspace_id = ? LIMIT ${PURGE_BATCH})`);
    while (batch.run(id).changes > 0) await nextTick();
  }
  const photos = db.prepare(`SELECT id, content_type FROM journal_photos WHERE workspace_id = ?`).all(id) as
    { id: string; content_type: string }[];
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  await Promise.all(photos.map((p) =>
    unlink(join(photoDir, `${p.id}.${PHOTO_EXT[p.content_type] ?? "bin"}`)).catch(() => undefined),
  ));
}

/** The daily job: workspaces deleted more than the restore window ago. */
export async function purgeDeletedWorkspaces(db: Database, photoDir: string, now: Date = new Date()): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - WORKSPACE_RESTORE_DAYS * DAY_MS).toISOString();
  const due = db.prepare(`SELECT id FROM workspaces WHERE deleted_at IS NOT NULL AND deleted_at <= ?`).all(cutoff) as { id: string }[];
  for (const { id } of due) await purgeWorkspace(db, photoDir, id);
  return { purged: due.length };
}
