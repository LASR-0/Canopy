/**
 * Database backup.
 *
 * `VACUUM INTO` is used rather than copying the file: it takes a consistent
 * snapshot while the controller keeps writing, and it compacts as it goes. A
 * plain file copy of a live WAL database can capture a torn state.
 *
 * Backups are opt-in. A controller with no configured path writes nothing
 * rather than inventing a location, because a grow controller silently filling
 * a disk it was never pointed at is worse than having no backup.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database } from "better-sqlite3";

export interface BackupOutcome {
  written: boolean;
  path?: string;
  /** Why nothing was written, when nothing was. */
  skipped?: "disabled" | "no_path";
}

export interface BackupSettings {
  backupEnabled: boolean;
  backupPath: string | null;
}

/** Timestamped so a run never overwrites the previous good backup. */
export function backupFilename(now: Date): string {
  return `canopy-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

export function runBackup(
  db: Database,
  settings: BackupSettings,
  now: Date = new Date(),
): BackupOutcome {
  if (!settings.backupEnabled) return { written: false, skipped: "disabled" };
  if (!settings.backupPath) return { written: false, skipped: "no_path" };

  const target = join(settings.backupPath, backupFilename(now));
  mkdirSync(dirname(target), { recursive: true });

  try {
    // Parameter binding is not available for VACUUM INTO, so the path is
    // quoted as a SQL string literal with embedded quotes doubled.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (err) {
    // A partial file left behind would look like a usable backup.
    try {
      rmSync(target, { force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }

  return { written: true, path: target };
}
