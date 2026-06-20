import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ── workspaces ───────────────────────────────────────────────────────────────
export const workspaces = sqliteTable("workspaces", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  createdAt:      text("created_at").notNull(),
  archived:       integer("archived", { mode: "boolean" }).notNull().default(false),
  timezone:       text("timezone").notNull().default("UTC"),
  widthCm:        integer("width_cm"),
  depthCm:        integer("depth_cm"),
  heightCm:       integer("height_cm"),
  // Circular ref with grows — omit .references() to avoid TS cycle; enforced in DDL.
  activeGrowId:   text("active_grow_id"),
});

// ── app_settings ─────────────────────────────────────────────────────────────
// Single row, id always = 1.
export const appSettings = sqliteTable("app_settings", {
  id:                         integer("id").primaryKey().default(1),
  theme:                      text("theme").notNull().default("dark"),
  unitTemperature:            text("unit_temperature").notNull().default("C"),
  unitWeight:                 text("unit_weight").notNull().default("g"),
  unitVolume:                 text("unit_volume").notNull().default("ml"),
  unitDimension:              text("unit_dimension").notNull().default("cm"),
  startupPage:                text("startup_page").notNull().default("overview"),
  activeWorkspaceId:          text("active_workspace_id"),
  notificationsEnabled:       integer("notifications_enabled", { mode: "boolean" }).notNull().default(true),
  notifyThresholdWarn:        integer("notify_threshold_warn", { mode: "boolean" }).notNull().default(true),
  notifyThresholdErr:         integer("notify_threshold_err", { mode: "boolean" }).notNull().default(true),
  notifyFailsafe:             integer("notify_failsafe", { mode: "boolean" }).notNull().default(true),
  notifyDeviceOffline:        integer("notify_device_offline", { mode: "boolean" }).notNull().default(true),
  notifyMaintenanceDue:       integer("notify_maintenance_due", { mode: "boolean" }).notNull().default(true),
  notifyGrowStage:            integer("notify_grow_stage", { mode: "boolean" }).notNull().default(true),
  notifyAutomationOverride:   integer("notify_automation_override", { mode: "boolean" }).notNull().default(false),
  rawRetentionDays:           integer("raw_retention_days").notNull().default(7),
  hourlyRetentionDays:        integer("hourly_retention_days").notNull().default(90),
  archiveAfterDays:           integer("archive_after_days").notNull().default(30),
  backupEnabled:              integer("backup_enabled", { mode: "boolean" }).notNull().default(false),
  backupIntervalDays:         integer("backup_interval_days").notNull().default(7),
  backupPath:                 text("backup_path"),
});

// ── devices ──────────────────────────────────────────────────────────────────
export const devices = sqliteTable("devices", {
  id:                 text("id").primaryKey(),
  workspaceId:        text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name:               text("name").notNull(),
  family:             text("family").notNull(),
  protocol:           text("protocol").notNull(),
  host:               text("host"),
  port:               integer("port"),
  mqttTopicPrefix:    text("mqtt_topic_prefix"),
  model:              text("model"),
  firmware:           text("firmware"),
  /** JSON: Capability[] — actuators include label field */
  capabilitiesJson:   text("capabilities_json").notNull().default("[]"),
  discoveredVia:      text("discovered_via").notNull(),
  online:             integer("online", { mode: "boolean" }).notNull().default(false),
  lastSeen:           text("last_seen"),
  /** Raw Wi-Fi signal 0–100 %. Display layer converts to bars. */
  signalPct:          integer("signal_pct"),
  /** Cumulative runtime hours for runtime-cadence maintenance tasks. */
  runtimeHours:       real("runtime_hours").notNull().default(0),
  /** Soft-delete flag. Forgotten devices are hidden from the UI but kept in DB. */
  forgotten:          integer("forgotten", { mode: "boolean" }).notNull().default(false),
});

// ── role_assignments ──────────────────────────────────────────────────────────
export const roleAssignments = sqliteTable("role_assignments", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  deviceId:    text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  role:        text("role").notNull(),
  channel:     text("channel").notNull(),
});

// ── sensor_thresholds ─────────────────────────────────────────────────────────
export const sensorThresholds = sqliteTable("sensor_thresholds", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** null = workspace default; set = applies only during that grow stage. */
  stage:       text("stage"),
  metric:      text("metric").notNull(),
  minValue:    real("min_value").notNull(),
  maxValue:    real("max_value").notNull(),
  unit:        text("unit").notNull(),
});

// ── readings_raw ──────────────────────────────────────────────────────────────
// "__derived__" is used as device_id for VPD/DLI computed readings.
export const readingsRaw = sqliteTable("readings_raw", {
  id:          integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  deviceId:    text("device_id").notNull(),
  channel:     text("channel").notNull(),
  metric:      text("metric").notNull(),
  unit:        text("unit").notNull(),
  value:       real("value").notNull(),
  recordedAt:  text("recorded_at").notNull(),
});

// ── readings_hourly ───────────────────────────────────────────────────────────
export const readingsHourly = sqliteTable("readings_hourly", {
  id:          integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  deviceId:    text("device_id").notNull(),
  channel:     text("channel").notNull(),
  metric:      text("metric").notNull(),
  unit:        text("unit").notNull(),
  value:       real("value").notNull(),
  recordedAt:  text("recorded_at").notNull(),
});

// ── readings_daily ────────────────────────────────────────────────────────────
export const readingsDaily = sqliteTable("readings_daily", {
  id:          integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  deviceId:    text("device_id").notNull(),
  channel:     text("channel").notNull(),
  metric:      text("metric").notNull(),
  unit:        text("unit").notNull(),
  value:       real("value").notNull(),
  recordedAt:  text("recorded_at").notNull(),
});

// ── grow_templates ────────────────────────────────────────────────────────────
export const growTemplates = sqliteTable("grow_templates", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  seedlingWeeks:  integer("seedling_weeks").notNull().default(2),
  vegWeeks:       integer("veg_weeks").notNull().default(4),
  flowerWeeks:    integer("flower_weeks").notNull().default(8),
  flushWeeks:     integer("flush_weeks").notNull().default(1),
});

// ── grows ─────────────────────────────────────────────────────────────────────
export const grows = sqliteTable("grows", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  strain:      text("strain"),
  plantCount:  integer("plant_count"),
  templateId:  text("template_id").references(() => growTemplates.id, { onDelete: "set null" }),
  /** planned | active | completed | aborted */
  status:      text("status").notNull().default("planned"),

  // Stage planning
  plannedSeedlingWeeks: integer("planned_seedling_weeks").notNull().default(2),
  plannedVegWeeks:      integer("planned_veg_weeks").notNull().default(4),
  plannedFlowerWeeks:   integer("planned_flower_weeks").notNull().default(8),
  plannedFlushWeeks:    integer("planned_flush_weeks").notNull().default(1),

  // Stage actuals — filled at completion
  actualSeedlingWeeks: integer("actual_seedling_weeks"),
  actualVegWeeks:      integer("actual_veg_weeks"),
  actualFlowerWeeks:   integer("actual_flower_weeks"),
  actualFlushWeeks:    integer("actual_flush_weeks"),

  startedAt:   text("started_at"),
  completedAt: text("completed_at"),

  // Harvest
  wetWeightG:   integer("wet_weight_g"),
  dryWeightG:   integer("dry_weight_g"),
  rating:       real("rating"),
  notesWorked:  text("notes_worked"),
  notesChange:  text("notes_change"),
  /** JSON: string[] */
  techniquesJson: text("techniques_json"),

  // Abort
  abortReason: text("abort_reason"),
  abortNote:   text("abort_note"),

  // Environment summary — computed and stored at completion
  envAvgVpd:        real("env_avg_vpd"),
  envTempMin:       real("env_temp_min"),
  envTempMax:       real("env_temp_max"),
  envTempAvg:       real("env_temp_avg"),
  envRhMin:         real("env_rh_min"),
  envRhMax:         real("env_rh_max"),
  envRhAvg:         real("env_rh_avg"),
  envFailsafeTrips: integer("env_failsafe_trips"),
  envFailsafeNote:  text("env_failsafe_note"),
});

// ── grow_milestones ───────────────────────────────────────────────────────────
export const growMilestones = sqliteTable("grow_milestones", {
  id:     text("id").primaryKey(),
  growId: text("grow_id").notNull().references(() => grows.id, { onDelete: "cascade" }),
  label:  text("label").notNull(),
  day:    integer("day").notNull(),
  done:   integer("done", { mode: "boolean" }).notNull().default(false),
  doneAt: text("done_at"),
});

// ── journal_entries ───────────────────────────────────────────────────────────
export const journalEntries = sqliteTable("journal_entries", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  growId:      text("grow_id").notNull().references(() => grows.id, { onDelete: "cascade" }),
  growDay:     integer("grow_day").notNull(),
  growWeek:    integer("grow_week").notNull(),
  /** observation | experiment | technique | measurement | photo */
  type:        text("type").notNull(),
  title:       text("title").notNull(),
  body:        text("body"),
  hypothesis:  text("hypothesis"),
  result:      text("result"),
  /** JSON: [["pH","6.2"],["EC","1.4 mS/cm"]] */
  measurementsJson:  text("measurements_json"),
  /** JSON: string[] — local file paths relative to data dir */
  attachmentsJson:   text("attachments_json"),
  envTempC:    real("env_temp_c"),
  envRhPct:    real("env_rh_pct"),
  envVpdKpa:   real("env_vpd_kpa"),
  createdAt:   text("created_at").notNull(),
  updatedAt:   text("updated_at"),
});

// ── events ────────────────────────────────────────────────────────────────────
export const events = sqliteTable("events", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  growId:      text("grow_id").references(() => grows.id, { onDelete: "set null" }),
  /**
   * automation_fired | threshold_alert | failsafe_trip | device_online |
   * device_offline | stage_changed | mode_changed | milestone_reached |
   * maintenance_done
   */
  type:         text("type").notNull(),
  sourceId:     text("source_id"),
  sourceLabel:  text("source_label"),
  description:  text("description").notNull(),
  /** null | warn | err — used by Overview health panel */
  severity:     text("severity"),
  occurredAt:   text("occurred_at").notNull(),
});

// ── automations ───────────────────────────────────────────────────────────────
export const automations = sqliteTable("automations", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  enabled:     integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** schedule | rule | failsafe */
  kind:        text("kind").notNull(),
  /** lighting | climate | airflow | co2 | irrigation | failsafe */
  subsystem:   text("subsystem").notNull(),
  /** "schedule" | role_id | "any" */
  driver:      text("driver").notNull(),
  actuatorRole: text("actuator_role"),
  /** on-off | variable | setpoint */
  controlRes:   text("control_res"),
  /** If set, locked when no device holds this role */
  requiresRole: text("requires_role"),
  triggerJson:  text("trigger_json").notNull(),
  actionsJson:  text("actions_json").notNull().default("[]"),
  stage:        text("stage"),
  overrideUntil: text("override_until"),
  overrideState: text("override_state"),
  sortOrder:    integer("sort_order").notNull().default(0),
});

// ── maintenance_tasks ─────────────────────────────────────────────────────────
export const maintenanceTasks = sqliteTable("maintenance_tasks", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  /** daily | weekly | stage | runtime | custom */
  cadence:     text("cadence").notNull(),
  /** weekly: repeat every N days */
  intervalDays:          integer("interval_days"),
  /** runtime: trigger every N device runtime-hours */
  runtimeHoursInterval:  integer("runtime_hours_interval"),
  seededBy:    text("seeded_by"),
  deviceId:    text("device_id").references(() => devices.id, { onDelete: "set null" }),
  /** morning | today | evening */
  groupTime:   text("group_time").notNull().default("today"),
  notifications: integer("notifications", { mode: "boolean" }).notNull().default(true),
  nextDueAt:   text("next_due_at"),
  lastDoneAt:  text("last_done_at"),
  createdAt:   text("created_at").notNull(),
});

// ── maintenance_completions ───────────────────────────────────────────────────
export const maintenanceCompletions = sqliteTable("maintenance_completions", {
  id:          text("id").primaryKey(),
  taskId:      text("task_id").notNull().references(() => maintenanceTasks.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  growId:      text("grow_id").references(() => grows.id, { onDelete: "set null" }),
  growDay:     integer("grow_day"),
  /** completed | skipped */
  status:      text("status").notNull(),
  completedAt: text("completed_at").notNull(),
  note:        text("note"),
});

// ── maintenance_day_notes ─────────────────────────────────────────────────────
export const maintenanceDayNotes = sqliteTable("maintenance_day_notes", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  growId:      text("grow_id").references(() => grows.id, { onDelete: "set null" }),
  date:        text("date").notNull(),
  growDay:     integer("grow_day"),
  note:        text("note").notNull(),
});

// ── chart_layouts ─────────────────────────────────────────────────────────────
export const chartLayouts = sqliteTable("chart_layouts", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name:        text("name").notNull(),
  /** JSON: string[] — metric IDs e.g. ["temp","rh","vpd"] */
  metricsJson: text("metrics_json").notNull(),
  sortOrder:   integer("sort_order").notNull().default(0),
  createdAt:   text("created_at").notNull(),
});

// ── jobs ──────────────────────────────────────────────────────────────────────
export const jobs = sqliteTable("jobs", {
  id:         text("id").primaryKey(),
  /**
   * rollup_hourly | rollup_daily | prune_raw | prune_hourly |
   * archive_grow | backup | maintenance_check | vacuum
   */
  type:       text("type").notNull(),
  lastRunAt:  text("last_run_at"),
  nextRunAt:  text("next_run_at").notNull(),
  /** pending | running | done | failed */
  status:     text("status").notNull().default("pending"),
  lastError:  text("last_error"),
  paramsJson: text("params_json"),
});
