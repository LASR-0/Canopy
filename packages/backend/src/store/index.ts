import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";
import { DATA_DIR, DB_PATH } from "./paths.js";
import { applyColumnAdditions, applyDDL, seedData } from "./ddl.js";

export { DATA_DIR } from "./paths.js";
export { addColumnIfMissing, applyColumnAdditions, applyDDL, seedData } from "./ddl.js";

mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/**
 * The underlying connection.
 *
 * Exported for the scheduler's aggregate jobs, which are set-based SQL that
 * Drizzle's builder would only obscure — `INSERT ... SELECT ... GROUP BY`, and
 * `VACUUM INTO`, which has no ORM equivalent at all.
 */
export const sqliteConnection: SqliteDatabase = sqlite;

/**
 * Initialise the live database: apply DDL then seed required rows.
 * Safe to call on every startup — all statements are CREATE/INSERT IF NOT EXISTS.
 */
export function initSchema(): void {
  applyDDL(sqlite);
  applyColumnAdditions(sqlite);
  seedData(sqlite);
}

/**
 * Close the live database at shutdown. The checkpoint folds the WAL back into
 * the main file first, so what is left on disk is one self-contained
 * `canopy.db` rather than a database and a log to be replayed on next open.
 */
export function closeStore(): void {
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  sqlite.close();
}
