import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env["DATA_DIR"] ?? join(__dirname, "../../../data");
const DB_PATH  = process.env["DB_PATH"]   ?? join(DATA_DIR, "canopy.db");

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
  seedData(sqlite);
}

/**
 * Applies the full DDL to any SQLite connection.
 * Exported so tests can call it on an in-memory database without importing
 * the live file-backed instance.
 */
export function applyDDL(db: InstanceType<typeof Database>): void {
  db.exec(`
    /* ── workspaces ───────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS workspaces (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      archived        INTEGER NOT NULL DEFAULT 0,
      timezone        TEXT NOT NULL DEFAULT 'UTC',
      width_cm        INTEGER,
      depth_cm        INTEGER,
      height_cm       INTEGER,
      active_grow_id  TEXT REFERENCES grows(id) ON DELETE SET NULL
    );

    /* ── app_settings (single row, id = 1) ───────────────────────────── */
    CREATE TABLE IF NOT EXISTS app_settings (
      id                        INTEGER PRIMARY KEY DEFAULT 1,
      theme                     TEXT NOT NULL DEFAULT 'dark',
      unit_temperature          TEXT NOT NULL DEFAULT 'C',
      unit_weight               TEXT NOT NULL DEFAULT 'g',
      unit_volume               TEXT NOT NULL DEFAULT 'ml',
      unit_dimension            TEXT NOT NULL DEFAULT 'cm',
      startup_page              TEXT NOT NULL DEFAULT 'overview',
      active_workspace_id       TEXT,
      notifications_enabled     INTEGER NOT NULL DEFAULT 1,
      notify_threshold_warn     INTEGER NOT NULL DEFAULT 1,
      notify_threshold_err      INTEGER NOT NULL DEFAULT 1,
      notify_failsafe           INTEGER NOT NULL DEFAULT 1,
      notify_device_offline     INTEGER NOT NULL DEFAULT 1,
      notify_maintenance_due    INTEGER NOT NULL DEFAULT 1,
      notify_grow_stage         INTEGER NOT NULL DEFAULT 1,
      notify_automation_override INTEGER NOT NULL DEFAULT 0,
      raw_retention_days        INTEGER NOT NULL DEFAULT 7,
      hourly_retention_days     INTEGER NOT NULL DEFAULT 90,
      archive_after_days        INTEGER NOT NULL DEFAULT 30,
      backup_enabled            INTEGER NOT NULL DEFAULT 0,
      backup_interval_days      INTEGER NOT NULL DEFAULT 7,
      backup_path               TEXT
    );

    /* ── devices ──────────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS devices (
      id                  TEXT PRIMARY KEY,
      workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      family              TEXT NOT NULL,
      protocol            TEXT NOT NULL,
      host                TEXT,
      port                INTEGER,
      mqtt_topic_prefix   TEXT,
      model               TEXT,
      firmware            TEXT,
      capabilities_json   TEXT NOT NULL DEFAULT '[]',
      discovered_via      TEXT NOT NULL,
      online              INTEGER NOT NULL DEFAULT 0,
      last_seen           TEXT,
      signal_pct          INTEGER,
      runtime_hours       REAL NOT NULL DEFAULT 0,
      forgotten           INTEGER NOT NULL DEFAULT 0
    );

    /* ── role_assignments ─────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS role_assignments (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      role          TEXT NOT NULL,
      channel       TEXT NOT NULL,
      UNIQUE (workspace_id, device_id)
    );

    /* ── sensor_thresholds ────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS sensor_thresholds (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      stage         TEXT,
      metric        TEXT NOT NULL,
      min_value     REAL NOT NULL,
      max_value     REAL NOT NULL,
      unit          TEXT NOT NULL,
      UNIQUE (workspace_id, stage, metric)
    );

    /* ── readings ─────────────────────────────────────────────────────── */
    /* device_id = "__derived__" for VPD / DLI computed metrics           */
    CREATE TABLE IF NOT EXISTS readings_raw (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  TEXT NOT NULL,
      device_id     TEXT NOT NULL,
      channel       TEXT NOT NULL,
      metric        TEXT NOT NULL,
      unit          TEXT NOT NULL,
      value         REAL NOT NULL,
      recorded_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_readings_raw_lookup
      ON readings_raw (workspace_id, metric, recorded_at);

    CREATE TABLE IF NOT EXISTS readings_hourly (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  TEXT NOT NULL,
      device_id     TEXT NOT NULL,
      channel       TEXT NOT NULL,
      metric        TEXT NOT NULL,
      unit          TEXT NOT NULL,
      value         REAL NOT NULL,
      recorded_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_readings_hourly_lookup
      ON readings_hourly (workspace_id, metric, recorded_at);

    CREATE TABLE IF NOT EXISTS readings_daily (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  TEXT NOT NULL,
      device_id     TEXT NOT NULL,
      channel       TEXT NOT NULL,
      metric        TEXT NOT NULL,
      unit          TEXT NOT NULL,
      value         REAL NOT NULL,
      recorded_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_readings_daily_lookup
      ON readings_daily (workspace_id, metric, recorded_at);

    /* ── grow_templates ───────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS grow_templates (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      seedling_weeks  INTEGER NOT NULL DEFAULT 2,
      veg_weeks       INTEGER NOT NULL DEFAULT 4,
      flower_weeks    INTEGER NOT NULL DEFAULT 8,
      flush_weeks     INTEGER NOT NULL DEFAULT 1
    );

    /* ── grows ────────────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS grows (
      id                      TEXT PRIMARY KEY,
      workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name                    TEXT NOT NULL,
      strain                  TEXT,
      plant_count             INTEGER,
      template_id             TEXT REFERENCES grow_templates(id) ON DELETE SET NULL,
      status                  TEXT NOT NULL DEFAULT 'planned',
      planned_seedling_weeks  INTEGER NOT NULL DEFAULT 2,
      planned_veg_weeks       INTEGER NOT NULL DEFAULT 4,
      planned_flower_weeks    INTEGER NOT NULL DEFAULT 8,
      planned_flush_weeks     INTEGER NOT NULL DEFAULT 1,
      actual_seedling_weeks   INTEGER,
      actual_veg_weeks        INTEGER,
      actual_flower_weeks     INTEGER,
      actual_flush_weeks      INTEGER,
      started_at              TEXT,
      completed_at            TEXT,
      wet_weight_g            INTEGER,
      dry_weight_g            INTEGER,
      rating                  REAL,
      notes_worked            TEXT,
      notes_change            TEXT,
      techniques_json         TEXT,
      abort_reason            TEXT,
      abort_note              TEXT,
      env_avg_vpd             REAL,
      env_temp_min            REAL,
      env_temp_max            REAL,
      env_temp_avg            REAL,
      env_rh_min              REAL,
      env_rh_max              REAL,
      env_rh_avg              REAL,
      env_failsafe_trips      INTEGER,
      env_failsafe_note       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_grows_workspace
      ON grows (workspace_id, status);

    /* ── grow_milestones ──────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS grow_milestones (
      id      TEXT PRIMARY KEY,
      grow_id TEXT NOT NULL REFERENCES grows(id) ON DELETE CASCADE,
      label   TEXT NOT NULL,
      day     INTEGER NOT NULL,
      done    INTEGER NOT NULL DEFAULT 0,
      done_at TEXT
    );

    /* ── journal_entries ──────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS journal_entries (
      id                  TEXT PRIMARY KEY,
      workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      grow_id             TEXT NOT NULL REFERENCES grows(id) ON DELETE CASCADE,
      grow_day            INTEGER NOT NULL,
      grow_week           INTEGER NOT NULL,
      type                TEXT NOT NULL,
      title               TEXT NOT NULL,
      body                TEXT,
      hypothesis          TEXT,
      result              TEXT,
      measurements_json   TEXT,
      attachments_json    TEXT,
      env_temp_c          REAL,
      env_rh_pct          REAL,
      env_vpd_kpa         REAL,
      created_at          TEXT NOT NULL,
      updated_at          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_journal_grow_day
      ON journal_entries (grow_id, grow_day);

    /* ── events ───────────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS events (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      grow_id       TEXT REFERENCES grows(id) ON DELETE SET NULL,
      type          TEXT NOT NULL,
      source_id     TEXT,
      source_label  TEXT,
      description   TEXT NOT NULL,
      severity      TEXT,
      occurred_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_workspace_time
      ON events (workspace_id, occurred_at DESC);

    /* ── automations ──────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS automations (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      kind            TEXT NOT NULL,
      subsystem       TEXT NOT NULL,
      driver          TEXT NOT NULL,
      actuator_role   TEXT,
      control_res     TEXT,
      requires_role   TEXT,
      trigger_json    TEXT NOT NULL,
      actions_json    TEXT NOT NULL DEFAULT '[]',
      stage           TEXT,
      override_until  TEXT,
      override_state  TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0
    );

    /* ── maintenance_tasks ────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS maintenance_tasks (
      id                      TEXT PRIMARY KEY,
      workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name                    TEXT NOT NULL,
      cadence                 TEXT NOT NULL,
      interval_days           INTEGER,
      runtime_hours_interval  INTEGER,
      seeded_by               TEXT,
      device_id               TEXT REFERENCES devices(id) ON DELETE SET NULL,
      group_time              TEXT NOT NULL DEFAULT 'today',
      notifications           INTEGER NOT NULL DEFAULT 1,
      next_due_at             TEXT,
      last_done_at            TEXT,
      created_at              TEXT NOT NULL
    );

    /* ── maintenance_completions ──────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS maintenance_completions (
      id            TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      grow_id       TEXT REFERENCES grows(id) ON DELETE SET NULL,
      grow_day      INTEGER,
      status        TEXT NOT NULL,
      completed_at  TEXT NOT NULL,
      note          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_completions_task_time
      ON maintenance_completions (task_id, completed_at DESC);

    /* ── maintenance_day_notes ────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS maintenance_day_notes (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      grow_id       TEXT REFERENCES grows(id) ON DELETE SET NULL,
      date          TEXT NOT NULL,
      grow_day      INTEGER,
      note          TEXT NOT NULL,
      UNIQUE (workspace_id, date)
    );

    /* ── chart_layouts ────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS chart_layouts (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      metrics_json  TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    /* ── jobs ─────────────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      last_error  TEXT,
      params_json TEXT
    );
  `);

  // ── Column migrations (ALTER TABLE ADD COLUMN IF NOT EXISTS equivalent) ──
  // SQLite has no IF NOT EXISTS for ALTER TABLE, so we catch and ignore the
  // "duplicate column" error. Each entry here is safe to re-run on every boot.
  const addColumnIfMissing = (sql: string) => {
    try { db.exec(sql); } catch { /* column already exists */ }
  };
  addColumnIfMissing(`ALTER TABLE devices ADD COLUMN forgotten INTEGER NOT NULL DEFAULT 0;`);
  addColumnIfMissing(`ALTER TABLE role_assignments ADD COLUMN label TEXT;`);

}

/**
 * Seeds initial rows that must always exist. Accepts the connection so both
 * the live DB and test in-memory DBs can be seeded identically.
 */
export function seedData(database: InstanceType<typeof Database>): void {
  /* ── app_settings: ensure a row exists ─────────────────────────────── */
  database.exec(`INSERT OR IGNORE INTO app_settings (id) VALUES (1);`);

  /* ── grow_templates: 4 standard templates ──────────────────────────── */
  const tplStmt = database.prepare(
    `INSERT OR IGNORE INTO grow_templates (id, name, seedling_weeks, veg_weeks, flower_weeks, flush_weeks)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  tplStmt.run("photo",   "Photoperiod · Standard", 2, 4, 8, 1);
  tplStmt.run("auto",    "Autoflower · Quick",     1, 3, 6, 1);
  tplStmt.run("sog",     "Sea of Green",           1, 2, 8, 1);
  tplStmt.run("longveg", "Extended Veg",           2, 8, 9, 2);

  /* ── jobs: seed scheduler jobs if they don't exist ─────────────────── */
  const seedJob = database.prepare(
    `INSERT OR IGNORE INTO jobs (id, type, next_run_at, status) VALUES (?, ?, ?, 'pending')`,
  );
  const in1h    = new Date(Date.now() + 3_600_000).toISOString();
  const in24h   = new Date(Date.now() + 86_400_000).toISOString();
  const in7d    = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const nextMid = (() => {
    const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString();
  })();

  seedJob.run("job_rollup_hourly",       "rollup_hourly",       in1h);
  seedJob.run("job_rollup_daily",        "rollup_daily",        nextMid);
  seedJob.run("job_prune_raw",           "prune_raw",           in24h);
  seedJob.run("job_prune_hourly",        "prune_hourly",        in7d);
  seedJob.run("job_maintenance_check",   "maintenance_check",   nextMid);
  seedJob.run("job_vacuum",              "vacuum",              in7d);
}
