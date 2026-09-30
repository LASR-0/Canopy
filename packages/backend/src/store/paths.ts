/**
 * Where the controller keeps its files. Its own module, apart from
 * store/index.ts, because importing that opens the database: code that only
 * needs a path (and its tests) should not.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUNDLED } from "../build-info.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The installed controller is told where its data lives by whatever starts it
 * (the systemd unit, the Windows service). There is no safe default to fall
 * back on: relative to the bundle it would land inside the install directory,
 * which an upgrade replaces. The repo-relative default is for `pnpm dev` only.
 */
function dataDir(): string {
  const configured = process.env["DATA_DIR"];
  if (configured) return configured;
  if (BUNDLED) throw new Error("DATA_DIR is not set. The installed controller needs to be told where to keep its data.");
  return join(here, "../../../data");
}

export const DATA_DIR = dataDir();
export const DB_PATH = process.env["DB_PATH"] ?? join(DATA_DIR, "canopy.db");
/** Journal photos (grow/journal-photos.ts). */
export const PHOTO_DIR = join(DATA_DIR, "attachments", "journal");
/** Imports being staged (data/import.ts); cleared on start. */
export const IMPORT_DIR = join(DATA_DIR, "import");
/** Scratch space, e.g. an export's database snapshot while it streams. */
export const TMP_DIR = join(DATA_DIR, "tmp");
