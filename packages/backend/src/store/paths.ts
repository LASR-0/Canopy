/**
 * Where the controller keeps its files. Its own module, apart from
 * store/index.ts, because importing that opens the database: code that only
 * needs a path (and its tests) should not.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env["DATA_DIR"] ?? join(here, "../../../data");
export const DB_PATH = process.env["DB_PATH"] ?? join(DATA_DIR, "canopy.db");
/** Journal photos (grow/journal-photos.ts). */
export const PHOTO_DIR = join(DATA_DIR, "attachments", "journal");
