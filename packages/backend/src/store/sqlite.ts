/**
 * Every SQLite connection is opened here, so the installed controller can say
 * where the native half of better-sqlite3 is.
 *
 * Under `pnpm dev` better-sqlite3 finds its binary in node_modules as usual.
 * The installed controller has no node_modules: better-sqlite3's JavaScript
 * is in the bundle, and its binary sits beside it (scripts/stage.mjs). The
 * installers could not carry a node_modules folder anyway, because
 * electron-builder drops one at the top of any folder it copies.
 */
import Database from "better-sqlite3";
import type { Database as SqliteDatabase, Options } from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED } from "../build-info.js";

const nativeBinding = BUNDLED
  ? join(dirname(fileURLToPath(import.meta.url)), "better_sqlite3.node")
  : undefined;

export function openDatabase(path: string, options: Options = {}): SqliteDatabase {
  return new Database(path, nativeBinding ? { ...options, nativeBinding } : options);
}
