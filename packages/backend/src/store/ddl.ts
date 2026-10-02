/**
 * The schema as SQL: the tables and indexes, the columns added since, and the
 * rows every database needs. Apart from store/index.ts, which opens the live
 * database when imported, so code working on another database (a test's, or
 * a file being imported) can use these without touching the live one.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Columns added to tables that already exist in the wild.
 *
 * `applyDDL` is all `CREATE TABLE IF NOT EXISTS`, which is enough to create a
 * database and does nothing at all to one that is already there — so a column
 * added to a CREATE reaches new installs only, and the first write against an
 * older database fails with "no such column".
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so each addition is guarded by
 * `PRAGMA table_info`. Idempotent, in keeping with the rest of this file, and
 * ordered only by the list below.
 *
 * This is deliberately not a migration framework. It handles the case Canopy
 * actually has — a new nullable column on a local single-user database — and
 * nothing that needs ordering, data transformation or a rollback. A real
 * `user_version` ladder belongs with Phase 8, where databases stop being ours.
 */
export function applyColumnAdditions(db: InstanceType<typeof Database>): void {
  // Bucket extremes, so a rollup keeps the peak an average would hide.
  addColumnIfMissing(db, "readings_hourly", "min_value", "REAL");
  addColumnIfMissing(db, "readings_hourly", "max_value", "REAL");
  addColumnIfMissing(db, "readings_daily",  "min_value", "REAL");
  addColumnIfMissing(db, "readings_daily",  "max_value", "REAL");
  // Event retention. Events had none, and a flapping alert wrote 13k rows a day.
  addColumnIfMissing(db, "app_settings", "event_retention_days", "INTEGER NOT NULL DEFAULT 90");
  // The due date a task's "due" notification was last recorded for.
  addColumnIfMissing(db, "maintenance_tasks", "due_notified_at", "TEXT");
  // The metric a threshold alert is about, so the Logs tab can filter by it.
  addColumnIfMissing(db, "events", "metric", "TEXT");
  // Chart templates hold the chart's mode, options and markers, not only metrics.
  addColumnIfMissing(db, "chart_layouts", "view_json", "TEXT");
  // An imported copy of hardware that already belongs to another workspace.
  addColumnIfMissing(db, "devices", "detached_at", "TEXT");
  // Archive and Recently deleted, as timestamps (7.5 G). The old flag was set
  // by both the Archive and the Delete button, so what it marked is archived.
  if (addColumnIfMissing(db, "workspaces", "archived_at", "TEXT")) {
    db.prepare(`UPDATE workspaces SET archived_at = ? WHERE archived = 1`).run(new Date().toISOString());
  }
  addColumnIfMissing(db, "workspaces", "deleted_at", "TEXT");
  // Automations run in any set of stages (7.5 H); a single stage carries over.
  if (addColumnIfMissing(db, "automations", "stages_json", "TEXT")) {
    db.exec(`UPDATE automations SET stages_json = json_array(stage) WHERE stage IS NOT NULL`);
  }
  // Maintenance: a stage scope, and the stage a "when a stage starts" task waits for.
  addColumnIfMissing(db, "maintenance_tasks", "stages_json", "TEXT");
  addColumnIfMissing(db, "maintenance_tasks", "start_stage", "TEXT");
  // MQTT authentication (Phase 8 F). A fresh install requires credentials from
  // the start. An install that already has devices starts with it off: they
  // connect without one today, and switching it on would cut them all off.
  if (addColumnIfMissing(db, "app_settings", "mqtt_require_credentials", "INTEGER NOT NULL DEFAULT 1")) {
    db.exec(`UPDATE app_settings SET mqtt_require_credentials = 0 WHERE EXISTS (SELECT 1 FROM devices)`);
  }
  addColumnIfMissing(db, "app_settings", "mqtt_bind_host", "TEXT");
  addColumnIfMissing(db, "devices", "mqtt_auth", "TEXT");
  // Per-device credentials (Phase 8 G): the shared credential is now one of
  // two, so what was "credential" is "shared". Cheap and idempotent, and it
  // runs on an imported file too, which may come from before the rename.
  const deviceColumns = db.prepare(`PRAGMA table_info(devices)`).all() as { name: string }[];
  if (deviceColumns.some((c) => c.name === "mqtt_auth")) {
    db.exec(`UPDATE devices SET mqtt_auth = 'shared' WHERE mqtt_auth = 'credential'`);
  }
  // The physical device behind MQTT discovery, which gathers a board's
  // entities into one device. Older rows gain it at their next discovery.
  addColumnIfMissing(db, "devices", "discovery_key", "TEXT");
  // When a finished grow's environment summary was worked out (grow/archive.ts).
  addColumnIfMissing(db, "grows", "env_summarised_at", "TEXT");
}

export function addColumnIfMissing(
  db: InstanceType<typeof Database>,
  table: string,
  column: string,
  definition: string,
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.length === 0) return false; // table not created yet; CREATE owns it
  if (columns.some((c) => c.name === column)) return false;

  // Only ever additive, and only ever nullable — an ADD COLUMN with NOT NULL
  // and no default is rejected outright on a non-empty table.
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
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
      archived        INTEGER NOT NULL DEFAULT 0,  /* unused since 7.5 G; see archived_at */
      archived_at     TEXT,
      deleted_at      TEXT,
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
      event_retention_days      INTEGER NOT NULL DEFAULT 90,
      archive_after_days        INTEGER NOT NULL DEFAULT 30,
      backup_enabled            INTEGER NOT NULL DEFAULT 0,
      backup_interval_days      INTEGER NOT NULL DEFAULT 7,
      backup_path               TEXT,
      mqtt_require_credentials  INTEGER NOT NULL DEFAULT 1,
      mqtt_bind_host            TEXT
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
      forgotten           INTEGER NOT NULL DEFAULT 0,
      detached_at         TEXT,
      mqtt_auth           TEXT,
      discovery_key       TEXT
    );

    /* ── mqtt_credentials ─────────────────────────────────────────────── */
    /* What a device presents when it connects to the broker. One shared row
       (device_id NULL) any device may use, and one per MQTT device, limited
       to its own topics (Phase 8 G). The password is stored as it is,
       because the UI shows it for typing into a device. The database is
       readable by the service alone. */
    CREATE TABLE IF NOT EXISTS mqtt_credentials (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      device_id   TEXT REFERENCES devices(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL
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

    /* ── device_placements ────────────────────────────────────────────── */
    -- Where a device is mounted in the tent. cm from the back-left corner;
    -- REAL so a resize and its reverse land back where they started.
    CREATE TABLE IF NOT EXISTS device_placements (
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      device_id     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      x_cm          REAL NOT NULL,
      y_cm          REAL NOT NULL,
      z_cm          REAL NOT NULL,
      rotation_deg  REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, device_id)
    );

    /* ── plants ───────────────────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS plants (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      label         TEXT,
      x_cm          REAL NOT NULL,
      y_cm          REAL NOT NULL,
      pot_litres    REAL NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plants_workspace ON plants (workspace_id);

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

    /* ── threshold_alert_settings ─────────────────────────────────────── */
    -- How a metric's alerts behave. No row = DEFAULT_ALERT_SETTING.
    CREATE TABLE IF NOT EXISTS threshold_alert_settings (
      workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      metric           TEXT NOT NULL,
      enabled          INTEGER NOT NULL DEFAULT 1,
      warn_margin_pct  REAL NOT NULL DEFAULT 10,
      delay_sec        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, metric)
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
    /* Newest row per channel: seeds the latest-readings cache
       (device-manager/latest.ts) without scanning every reading. */
    CREATE INDEX IF NOT EXISTS idx_readings_raw_latest
      ON readings_raw (workspace_id, device_id, channel, id);

    CREATE TABLE IF NOT EXISTS readings_hourly (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  TEXT NOT NULL,
      device_id     TEXT NOT NULL,
      channel       TEXT NOT NULL,
      metric        TEXT NOT NULL,
      unit          TEXT NOT NULL,
      value         REAL NOT NULL,   /* bucket average */
      min_value     REAL,
      max_value     REAL,
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
      value         REAL NOT NULL,   /* bucket average */
      min_value     REAL,
      max_value     REAL,
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
      env_failsafe_note       TEXT,
      env_summarised_at       TEXT
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

    /* ── journal_photos ───────────────────────────────────────────────── */
    /* The file lives in the data directory (journal/photos.ts). entry_id is
       null between upload and the entry being saved; prune_attachments
       clears what is never attached. */
    CREATE TABLE IF NOT EXISTS journal_photos (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      entry_id      TEXT REFERENCES journal_entries(id) ON DELETE CASCADE,
      caption       TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      width         INTEGER NOT NULL,
      height        INTEGER NOT NULL,
      content_type  TEXT NOT NULL,
      bytes         INTEGER NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_photos_entry
      ON journal_photos (entry_id, sort_order);

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
      occurred_at   TEXT NOT NULL,
      metric        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_workspace_time
      ON events (workspace_id, occurred_at DESC);

    /* ── notification_seen ────────────────────────────────────────────── */
    /* How far each page's notifications have been seen: one timestamp per
       page, not a flag per event. */
    CREATE TABLE IF NOT EXISTS notification_seen (
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      channel       TEXT NOT NULL,
      seen_at       TEXT NOT NULL,
      PRIMARY KEY (workspace_id, channel)
    );

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
      stage           TEXT,                   /* unused since 7.5 H; see stages_json */
      stages_json     TEXT,
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
      created_at              TEXT NOT NULL,
      due_notified_at         TEXT,
      stages_json             TEXT,
      start_stage             TEXT
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
      created_at    TEXT NOT NULL,
      view_json     TEXT
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
/** The username of the credential every device shares (Tier 2). */
export const SHARED_MQTT_USERNAME = "canopy";

/**
 * A broker password: 24 characters from 18 random bytes, base64url so it has
 * nothing a device's settings form might mangle (no quotes, slashes or +).
 */
export function generateMqttPassword(): string {
  return randomBytes(18).toString("base64url");
}

export function seedData(database: InstanceType<typeof Database>): void {
  /* ── app_settings: ensure a row exists ─────────────────────────────── */
  database.exec(`INSERT OR IGNORE INTO app_settings (id) VALUES (1);`);

  /* ── mqtt_credentials: the shared device credential ────────────────── */
  const shared = database.prepare(`SELECT 1 FROM mqtt_credentials WHERE device_id IS NULL`).get();
  if (!shared) {
    database
      .prepare(`INSERT INTO mqtt_credentials (id, username, password, created_at) VALUES (?, ?, ?, ?)`)
      .run(randomUUID(), SHARED_MQTT_USERNAME, generateMqttPassword(), new Date().toISOString());
  }

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
  seedJob.run("job_prune_events",        "prune_events",        in1h);
  seedJob.run("job_prune_attachments",   "prune_attachments",   in1h);
  seedJob.run("job_purge_workspaces",    "purge_workspaces",    in1h);
  seedJob.run("job_maintenance_check",   "maintenance_check",   nextMid);
  seedJob.run("job_archive_grow",        "archive_grow",        in1h);
  seedJob.run("job_vacuum",              "vacuum",              in7d);
}
