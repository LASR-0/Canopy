/**
 * Import: add workspaces from a `.canopy` file beside the ones here. Nothing
 * here is replaced or changed.
 *
 * Two steps, because the grower chooses what to import after seeing what the
 * file holds:
 *
 * 1. **Stage** (`stageImport`). The upload is unpacked into its own folder,
 *    checked (it must be a Canopy export this version can read, and an intact
 *    SQLite database), and brought up to the current schema the same way the
 *    live database is on start. The answer is a preview: each workspace with
 *    its counts, a name clash, and how many of its devices are already here.
 * 2. **Apply** (`applyImport`). The staged database is attached to the live
 *    connection and the chosen workspaces are copied in with **new ids**, every
 *    reference between rows remapped, so a file can be imported twice, or into
 *    the controller it came from, without colliding. Everything but the
 *    readings goes in one transaction. The readings (millions of rows) follow
 *    in batches that yield between them, so the controller keeps ingesting and
 *    answering while they copy.
 *
 * A device whose hardware (its MQTT topics) already belongs to a device here
 * stays with that device. The imported copy keeps its workspace's history,
 * roles and placement but is **detached**: ingest ignores it and it cannot be
 * driven, so readings and commands never go to two places.
 */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import type { ImportPreview, ImportStatus, ImportWorkspacePreview, ImportedWorkspace } from "@canopy/shared-types";
import { NOTIFICATION_CHANNELS } from "@canopy/shared-types";
import { applyColumnAdditions, applyDDL } from "../store/ddl.js";
import { extractTar } from "./tar.js";
import { DB_ENTRY, EXPORT_FORMAT, EXPORT_VERSION, MANIFEST_ENTRY, PHOTO_PREFIX, type ExportManifest } from "./export.js";

/** Readings copied per batch, between yields to the event loop. */
export const READINGS_BATCH = 5_000;

const PHOTO_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A random v4 UUID, in SQL, for remapping ids in bulk. */
const SQL_UUID = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`;

// ── Staging ───────────────────────────────────────────────────────────────────

export class ImportError extends Error {}

interface StagedFile {
  dir: string;
  dbPath: string;
  photoDir: string;
  manifest: ExportManifest;
}

/** The topics a device answers on: its prefix and every capability's topics. */
function deviceTopics(row: { mqtt_topic_prefix: string | null; capabilities_json: string }): Set<string> {
  const topics = new Set<string>();
  if (row.mqtt_topic_prefix) topics.add(`prefix:${row.mqtt_topic_prefix}`);
  try {
    for (const cap of JSON.parse(row.capabilities_json) as { stateTopic?: string; commandTopic?: string }[]) {
      if (cap.stateTopic) topics.add(cap.stateTopic);
      if (cap.commandTopic) topics.add(cap.commandTopic);
    }
  } catch {
    // A device with unreadable capabilities claims only its prefix.
  }
  return topics;
}

/** Every topic claimed by a live (not forgotten, not detached) device here. */
function liveTopics(live: SqliteDatabase): Set<string> {
  const rows = live.prepare(
    `SELECT mqtt_topic_prefix, capabilities_json FROM devices WHERE forgotten = 0 AND detached_at IS NULL`,
  ).all() as { mqtt_topic_prefix: string | null; capabilities_json: string }[];
  const all = new Set<string>();
  for (const row of rows) for (const t of deviceTopics(row)) all.add(t);
  return all;
}

/** The ids of a file's devices whose hardware is already here. */
function devicesAlreadyHere(staged: SqliteDatabase, live: SqliteDatabase, workspaceIds: readonly string[]): Set<string> {
  const here = liveTopics(live);
  const out = new Set<string>();
  const rows = staged.prepare(
    `SELECT id, mqtt_topic_prefix, capabilities_json FROM devices
     WHERE forgotten = 0 AND workspace_id IN (${workspaceIds.map(() => "?").join(",")})`,
  ).all(...workspaceIds) as { id: string; mqtt_topic_prefix: string | null; capabilities_json: string }[];
  for (const row of rows) {
    for (const t of deviceTopics(row)) {
      if (here.has(t)) { out.add(row.id); break; }
    }
  }
  return out;
}

/** "Tent 1" is taken? "Tent 1 (imported)", then "Tent 1 (imported 2)"… */
function freeName(name: string, taken: Set<string>): string | undefined {
  if (!taken.has(name)) return undefined;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name} (imported)` : `${name} (imported ${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Unpack and check an uploaded file. Only the entries an export writes are
 * kept; anything else in the archive is ignored, and no name from it is used
 * as a path. Throws ImportError with a message for the grower.
 */
async function unpack(input: AsyncIterable<Buffer>, dir: string): Promise<StagedFile> {
  const photoDir = join(dir, "photos");
  await mkdir(photoDir, { recursive: true });
  const dbPath = join(dir, DB_ENTRY);
  const manifestPath = join(dir, MANIFEST_ENTRY);

  let names: string[];
  try {
    const entries = await extractTar(Readable.from(input).pipe(createGunzip()), ({ name }) => {
      if (name === MANIFEST_ENTRY) return manifestPath;
      if (name === DB_ENTRY) return dbPath;
      if (name.startsWith(PHOTO_PREFIX)) {
        const file = name.slice(PHOTO_PREFIX.length);
        if (PHOTO_NAME.test(file)) return join(photoDir, file);
      }
      return null;
    });
    names = entries.map((e) => e.name);
  } catch (err) {
    if (err instanceof Error && /incorrect header check|unexpected end|damaged|ends part-way/.test(err.message)) {
      throw new ImportError("That file is not a Canopy export, or it is damaged");
    }
    throw err;
  }
  if (!names.includes(MANIFEST_ENTRY) || !names.includes(DB_ENTRY)) {
    throw new ImportError("That file is not a Canopy export");
  }

  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ExportManifest;
  } catch {
    throw new ImportError("That file is not a Canopy export");
  }
  if (manifest.format !== EXPORT_FORMAT) throw new ImportError("That file is not a Canopy export");
  if (manifest.version > EXPORT_VERSION) {
    throw new ImportError("That export was made by a newer version of Canopy. Update Canopy to import it.");
  }
  return { dir, dbPath, photoDir, manifest };
}

/**
 * Open the staged database, check it, and bring it up to the current schema:
 * an export from an older Canopy lacks tables and columns added since, and the
 * copy reads every column this version knows.
 */
function openStaged(dbPath: string): SqliteDatabase {
  let staged: SqliteDatabase;
  try {
    staged = new Database(dbPath);
    const check = staged.pragma("quick_check", { simple: true });
    if (check !== "ok") throw new Error(String(check));
    const hasWorkspaces = staged.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'`).get();
    if (!hasWorkspaces) throw new Error("no workspaces table");
  } catch {
    throw new ImportError("The database in that file is damaged or is not Canopy's");
  }
  applyDDL(staged);
  applyColumnAdditions(staged);
  return staged;
}

function preview(staged: SqliteDatabase, live: SqliteDatabase, token: string, exportedAt: string): ImportPreview {
  const count = (sql: string, id: string) => (staged.prepare(sql).get(id) as { n: number }).n;
  const taken = new Set((live.prepare(`SELECT name FROM workspaces`).all() as { name: string }[]).map((r) => r.name));
  const rows = staged.prepare(`SELECT id, name, archived FROM workspaces ORDER BY created_at`).all() as
    { id: string; name: string; archived: number }[];

  const workspaces: ImportWorkspacePreview[] = rows.map((w) => {
    const importedName = freeName(w.name, taken);
    return {
      id: w.id,
      name: w.name,
      ...(importedName ? { importedName } : {}),
      archived: w.archived === 1,
      grows: count(`SELECT COUNT(*) n FROM grows WHERE workspace_id = ?`, w.id),
      entries: count(`SELECT COUNT(*) n FROM journal_entries WHERE workspace_id = ?`, w.id),
      photos: count(`SELECT COUNT(*) n FROM journal_photos WHERE workspace_id = ? AND entry_id IS NOT NULL`, w.id),
      automations: count(`SELECT COUNT(*) n FROM automations WHERE workspace_id = ?`, w.id),
      devices: count(`SELECT COUNT(*) n FROM devices WHERE workspace_id = ? AND forgotten = 0`, w.id),
      devicesAlreadyHere: devicesAlreadyHere(staged, live, [w.id]).size,
      readings:
        count(`SELECT COUNT(*) n FROM readings_raw WHERE workspace_id = ?`, w.id) +
        count(`SELECT COUNT(*) n FROM readings_hourly WHERE workspace_id = ?`, w.id) +
        count(`SELECT COUNT(*) n FROM readings_daily WHERE workspace_id = ?`, w.id),
    };
  });
  return { token, exportedAt: exportedAt, workspaces };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

interface Session {
  file: StagedFile;
  status: ImportStatus;
}

const sessions = new Map<string, Session>();

/** Stage an upload and preview it. The staged folder lives under `root`. */
export async function stageImport(input: AsyncIterable<Buffer>, root: string, live: SqliteDatabase): Promise<ImportPreview> {
  const token = randomUUID();
  const dir = join(root, token);
  try {
    const file = await unpack(input, dir);
    const staged = openStaged(file.dbPath);
    try {
      const result = preview(staged, live, token, file.manifest.exportedAt);
      if (result.workspaces.length === 0) throw new ImportError("That export has no workspaces in it");
      sessions.set(token, { file, status: { state: "staged" } });
      return result;
    } finally {
      staged.close();
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

export function importStatus(token: string): ImportStatus | undefined {
  return sessions.get(token)?.status;
}

/** Throw away a staged file the grower decided not to import. */
export async function discardImport(token: string): Promise<boolean> {
  const session = sessions.get(token);
  if (!session || session.status.state === "importing") return false;
  sessions.delete(token);
  await rm(session.file.dir, { recursive: true, force: true });
  return true;
}

/** Clear staging folders left by a controller that stopped mid-import. */
export async function clearStaging(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

// ── Applying ──────────────────────────────────────────────────────────────────

/**
 * How each table is copied: which rows belong to the chosen workspaces, and
 * which columns hold ids to remap. `optional` references keep their value when
 * it is not an imported id (an event's source, a derived reading's device).
 * Order matters: a row's references are inserted before it.
 */
interface TablePlan {
  table: string;
  where: string;
  required?: string[];
  optional?: string[];
}

const IN_WS = `t.workspace_id IN (SELECT id FROM temp.import_ws)`;

const PLAN: TablePlan[] = [
  { table: "devices", where: IN_WS, required: ["id", "workspace_id"] },
  { table: "role_assignments", where: IN_WS, required: ["id", "workspace_id", "device_id"] },
  { table: "device_placements", where: IN_WS, required: ["workspace_id", "device_id"] },
  { table: "plants", where: IN_WS, required: ["id", "workspace_id"] },
  { table: "sensor_thresholds", where: IN_WS, required: ["id", "workspace_id"] },
  { table: "threshold_alert_settings", where: IN_WS, required: ["workspace_id"] },
  { table: "grows", where: IN_WS, required: ["id", "workspace_id"] },
  {
    table: "grow_milestones",
    where: `t.grow_id IN (SELECT id FROM imp.grows WHERE workspace_id IN (SELECT id FROM temp.import_ws))`,
    required: ["id", "grow_id"],
  },
  { table: "journal_entries", where: IN_WS, required: ["id", "workspace_id", "grow_id"] },
  // Pending uploads (no entry) are left behind, as they would be pruned here.
  { table: "journal_photos", where: `${IN_WS} AND t.entry_id IS NOT NULL`, required: ["id", "workspace_id", "entry_id"] },
  { table: "automations", where: IN_WS, required: ["id", "workspace_id"] },
  { table: "maintenance_tasks", where: IN_WS, required: ["id", "workspace_id"], optional: ["device_id"] },
  { table: "maintenance_completions", where: IN_WS, required: ["id", "task_id", "workspace_id"], optional: ["grow_id"] },
  { table: "maintenance_day_notes", where: IN_WS, required: ["id", "workspace_id"], optional: ["grow_id"] },
  { table: "chart_layouts", where: IN_WS, required: ["id", "workspace_id"] },
  { table: "events", where: IN_WS, required: ["id", "workspace_id"], optional: ["grow_id", "source_id"] },
];

const READINGS_TABLES = ["readings_raw", "readings_hourly", "readings_daily"] as const;

function columnsOf(db: SqliteDatabase, schema: "main" | "imp", table: string): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info(?, ?)`).all(table, schema) as { name: string }[]).map((r) => r.name);
}

const mapped = (col: string) => `(SELECT new FROM temp.import_map WHERE old = t.${col})`;

/** Copy one table's rows for the chosen workspaces, ids remapped. */
function copyTable(db: SqliteDatabase, plan: TablePlan): number {
  const importCols = new Set(columnsOf(db, "imp", plan.table));
  const cols = columnsOf(db, "main", plan.table).filter((c) => importCols.has(c));
  const select = cols.map((c) =>
    plan.required?.includes(c) ? mapped(c)
      : plan.optional?.includes(c) ? `COALESCE(${mapped(c)}, t.${c})`
      : plan.table === "grows" && c === "template_id"
        ? `CASE WHEN t.template_id IN (SELECT id FROM main.grow_templates) THEN t.template_id END`
        : `t.${c}`,
  );
  const result = db.prepare(`
    INSERT INTO main.${plan.table} (${cols.join(", ")})
    SELECT ${select.join(", ")} FROM imp.${plan.table} t WHERE ${plan.where}
  `).run();
  return result.changes;
}

/** Map every id the chosen workspaces' rows carry to a fresh one. */
function buildIdMap(db: SqliteDatabase): void {
  db.exec(`
    DROP TABLE IF EXISTS temp.import_map;
    CREATE TEMP TABLE import_map (old TEXT PRIMARY KEY, new TEXT NOT NULL);
    INSERT INTO temp.import_map SELECT id, ${SQL_UUID} FROM temp.import_ws;
  `);
  for (const plan of PLAN) {
    if (!plan.required?.includes("id")) continue;
    db.prepare(`INSERT OR IGNORE INTO temp.import_map SELECT t.id, ${SQL_UUID} FROM imp.${plan.table} t WHERE ${plan.where}`).run();
  }
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Copy the chosen workspaces in. Updates the session's status as it goes, for
 * the UI to poll. `onLoaded` is called once the rows are in, to load the new
 * workspaces into the controller's caches (rules, thresholds, device topics…).
 */
export async function applyImport(
  live: SqliteDatabase,
  token: string,
  workspaceIds: readonly string[],
  photoDir: string,
  onLoaded: () => Promise<void>,
  now: Date = new Date(),
): Promise<ImportStatus> {
  const session = sessions.get(token);
  if (!session) throw new ImportError("That import has expired. Upload the file again.");
  if (session.status.state !== "staged") throw new ImportError("That import has already run");
  const status = session.status;
  const set = (patch: Partial<ImportStatus>) => Object.assign(status, patch);
  set({ state: "importing", step: "Checking what to import" });

  const { file } = session;
  const at = now.toISOString();
  let newWorkspaces: string[] = [];
  const copiedPhotos: string[] = [];
  let attached = false;

  try {
    live.prepare(`ATTACH DATABASE ? AS imp`).run(file.dbPath);
    attached = true;

    const known = new Set((live.prepare(`SELECT id FROM imp.workspaces`).all() as { id: string }[]).map((r) => r.id));
    const chosen = [...new Set(workspaceIds)].filter((id) => known.has(id));
    if (chosen.length === 0) throw new ImportError("Choose at least one workspace from the file");

    live.exec(`DROP TABLE IF EXISTS temp.import_ws; CREATE TEMP TABLE import_ws (id TEXT PRIMARY KEY);`);
    const addWs = live.prepare(`INSERT INTO temp.import_ws VALUES (?)`);
    for (const id of chosen) addWs.run(id);

    // The staged database was closed after the preview, so read the
    // already-here devices again through the live connection's attachment.
    const alreadyHere = (() => {
      const staged = new Database(file.dbPath, { readonly: true });
      try {
        return devicesAlreadyHere(staged, live, chosen);
      } finally {
        staged.close();
      }
    })();

    set({ step: "Copying workspaces, grows, devices and automations" });
    const counts = new Map<string, ImportedWorkspace>();
    live.transaction(() => {
      buildIdMap(live);
      const idOf = (old: string) => (live.prepare(`SELECT new FROM temp.import_map WHERE old = ?`).get(old) as { new: string }).new;

      // Workspaces first: everything else refers to them. A name taken here
      // gets " (imported)", and the active grow is set once grows exist.
      const taken = new Set((live.prepare(`SELECT name FROM main.workspaces`).all() as { name: string }[]).map((r) => r.name));
      const importCols = new Set(columnsOf(live, "imp", "workspaces"));
      const cols = columnsOf(live, "main", "workspaces").filter((c) => importCols.has(c));
      for (const oldId of chosen) {
        const row = live.prepare(`SELECT * FROM imp.workspaces WHERE id = ?`).get(oldId) as Record<string, unknown>;
        const name = freeName(String(row["name"]), taken) ?? String(row["name"]);
        taken.add(name);
        const values = cols.map((c) => (c === "id" ? idOf(oldId) : c === "name" ? name : c === "active_grow_id" ? null : row[c]));
        live.prepare(`INSERT INTO main.workspaces (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...values);
        counts.set(oldId, { id: idOf(oldId), name, grows: 0, devices: 0, detachedDevices: 0, automations: 0, readings: 0, photos: 0 });
      }
      newWorkspaces = [...counts.values()].map((w) => w.id);

      for (const plan of PLAN) copyTable(live, plan);

      live.prepare(`
        UPDATE main.workspaces SET active_grow_id = (
          SELECT m.new FROM imp.workspaces w JOIN temp.import_map m ON m.old = w.active_grow_id
          WHERE (SELECT new FROM temp.import_map WHERE old = w.id) = main.workspaces.id
        ) WHERE id IN (SELECT new FROM temp.import_map WHERE old IN (SELECT id FROM temp.import_ws))
      `).run();

      // A device's online state in the file is stale; the heartbeat decides
      // here. Devices whose hardware is already here are detached.
      live.prepare(`UPDATE main.devices SET online = 0 WHERE workspace_id IN (${newWorkspaces.map(() => "?").join(",")})`).run(...newWorkspaces);
      const detach = live.prepare(`UPDATE main.devices SET detached_at = ? WHERE id = ?`);
      for (const old of alreadyHere) detach.run(at, idOf(old));

      // Imported history is not news: its alerts should not light the badges.
      const seen = live.prepare(`INSERT OR REPLACE INTO main.notification_seen (workspace_id, channel, seen_at) VALUES (?, ?, ?)`);
      for (const id of newWorkspaces) for (const channel of NOTIFICATION_CHANNELS) seen.run(id, channel, at);
    })();

    // Readings: the long part, in batches, yielding between them.
    const ranges = READINGS_TABLES.map((table) => {
      const r = live.prepare(`SELECT MIN(rowid) lo, MAX(rowid) hi FROM imp.${table}`).get() as { lo: number | null; hi: number | null };
      return { table, lo: r.lo ?? 0, hi: r.hi ?? -1 };
    });
    const total = ranges.reduce((n, r) => n + Math.max(0, r.hi - r.lo + 1), 0);
    let done = 0;
    set({ step: "Copying readings", done, total });
    for (const { table, lo, hi } of ranges) {
      const importCols = new Set(columnsOf(live, "imp", table));
      const cols = columnsOf(live, "main", table).filter((c) => c !== "id" && importCols.has(c));
      const select = cols.map((c) =>
        c === "workspace_id" ? "m.new" : c === "device_id" ? `COALESCE(d.new, t.device_id)` : `t.${c}`,
      );
      const batch = live.prepare(`
        INSERT INTO main.${table} (${cols.join(", ")})
        SELECT ${select.join(", ")} FROM imp.${table} t
        JOIN temp.import_ws w ON w.id = t.workspace_id
        JOIN temp.import_map m ON m.old = t.workspace_id
        LEFT JOIN temp.import_map d ON d.old = t.device_id
        WHERE t.rowid BETWEEN ? AND ?
      `);
      for (let from = lo; from <= hi; from += READINGS_BATCH) {
        const to = Math.min(hi, from + READINGS_BATCH - 1);
        batch.run(from, to);
        done += to - from + 1;
        set({ done });
        await nextTick();
      }
    }

    // Photos: the files, under their new ids.
    set({ step: "Copying photos" });
    await mkdir(photoDir, { recursive: true });
    const photos = live.prepare(`
      SELECT p.id AS old, m.new AS new, p.content_type AS type FROM imp.journal_photos p
      JOIN temp.import_map m ON m.old = p.id
    `).all() as { old: string; new: string; type: string }[];
    for (const p of photos) {
      const ext = PHOTO_EXT[p.type] ?? "bin";
      const target = join(photoDir, `${p.new}.${ext}`);
      try {
        await copyFile(join(file.photoDir, `${p.old}.${ext}`), target);
        copiedPhotos.push(target);
      } catch {
        // The file is missing from the export: drop the row rather than show a broken photo.
        live.prepare(`DELETE FROM main.journal_photos WHERE id = ?`).run(p.new);
      }
    }

    // What went in, per workspace.
    const tally = (sql: string, id: string) => (live.prepare(sql).get(id) as { n: number }).n;
    const result = [...counts.values()].map((w) => ({
      ...w,
      grows: tally(`SELECT COUNT(*) n FROM main.grows WHERE workspace_id = ?`, w.id),
      devices: tally(`SELECT COUNT(*) n FROM main.devices WHERE workspace_id = ? AND forgotten = 0`, w.id),
      detachedDevices: tally(`SELECT COUNT(*) n FROM main.devices WHERE workspace_id = ? AND detached_at IS NOT NULL`, w.id),
      automations: tally(`SELECT COUNT(*) n FROM main.automations WHERE workspace_id = ?`, w.id),
      readings:
        tally(`SELECT COUNT(*) n FROM main.readings_raw WHERE workspace_id = ?`, w.id) +
        tally(`SELECT COUNT(*) n FROM main.readings_hourly WHERE workspace_id = ?`, w.id) +
        tally(`SELECT COUNT(*) n FROM main.readings_daily WHERE workspace_id = ?`, w.id),
      photos: tally(`SELECT COUNT(*) n FROM main.journal_photos WHERE workspace_id = ?`, w.id),
    }));

    live.exec(`DROP TABLE IF EXISTS temp.import_map; DROP TABLE IF EXISTS temp.import_ws; DETACH DATABASE imp;`);
    attached = false;
    set({ step: "Loading the new workspaces" });
    await onLoaded();
    set({ state: "done", step: "Done", result });
  } catch (err) {
    // Undo whatever went in: the workspaces cascade, readings have no key to
    // cascade on, and copied photo files are removed by hand.
    try {
      if (attached) live.exec(`DROP TABLE IF EXISTS temp.import_map; DROP TABLE IF EXISTS temp.import_ws; DETACH DATABASE imp;`);
      for (const id of newWorkspaces) {
        for (const table of READINGS_TABLES) live.prepare(`DELETE FROM main.${table} WHERE workspace_id = ?`).run(id);
        live.prepare(`DELETE FROM main.workspaces WHERE id = ?`).run(id);
      }
      await Promise.all(copiedPhotos.map((p) => rm(p, { force: true })));
    } catch (cleanup) {
      console.error("[import] cleanup after a failed import also failed:", cleanup);
    }
    const message = err instanceof ImportError ? err.message : "The import failed; nothing was added";
    if (!(err instanceof ImportError)) console.error("[import] failed:", err);
    set({ state: "failed", error: message });
  } finally {
    await rm(file.dir, { recursive: true, force: true });
  }
  return status;
}

/** Forget sessions. Tests only. */
export function resetImportSessions(): void {
  sessions.clear();
}
