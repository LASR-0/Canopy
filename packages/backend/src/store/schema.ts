import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

// ── workspaces ───────────────────────────────────────────────────────────────
export const workspaces = sqliteTable("workspaces", {
  id:             text("id").primaryKey(),
  name:           text("name").notNull(),
  createdAt:      text("created_at").notNull(),
  /** Unused since 7.5 G, which replaced it with archivedAt and deletedAt. */
  archived:       integer("archived", { mode: "boolean" }).notNull().default(false),
  /** Put away: restorable at any time; the controller does nothing for it. */
  archivedAt:     text("archived_at"),
  /** In Recently deleted: purged 7 days after this. */
  deletedAt:      text("deleted_at"),
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
  eventRetentionDays:         integer("event_retention_days").notNull().default(90),
  archiveAfterDays:           integer("archive_after_days").notNull().default(30),
  backupEnabled:              integer("backup_enabled", { mode: "boolean" }).notNull().default(false),
  backupIntervalDays:         integer("backup_interval_days").notNull().default(7),
  backupPath:                 text("backup_path"),
  /** Devices need the broker credential to connect, except while a scan is open. */
  mqttRequireCredentials:     integer("mqtt_require_credentials", { mode: "boolean" }).notNull().default(true),
  /** The address the broker listens on; null is every interface. MQTT_HOST overrides it. */
  mqttBindHost:               text("mqtt_bind_host"),
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
  /**
   * Set on an imported device whose hardware (its MQTT topics) already belongs
   * to a device here. It keeps its workspace's history, roles and placement,
   * but ingest ignores it and it cannot be driven, so readings and commands
   * never go to two places. See data/import.ts.
   */
  detachedAt:         text("detached_at"),
  /** How it last connected to the broker: "device", "shared" or "anonymous". */
  mqttAuth:           text("mqtt_auth"),
  /** The physical device behind MQTT discovery, gathering a board's entities into one device. */
  discoveryKey:       text("discovery_key"),
});

/**
 * What devices present when they connect to the broker: one shared row
 * (deviceId null), and one per MQTT device (Phase 8 G).
 */
export const mqttCredentials = sqliteTable("mqtt_credentials", {
  id:        text("id").primaryKey(),
  username:  text("username").notNull().unique(),
  password:  text("password").notNull(),
  deviceId:  text("device_id").references(() => devices.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
});

// ── role_assignments ──────────────────────────────────────────────────────────
export const roleAssignments = sqliteTable("role_assignments", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  deviceId:    text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  role:        text("role").notNull(),
  channel:     text("channel").notNull(),
});

// ── device_placements ─────────────────────────────────────────────────────────
// Where a device is mounted in the tent. See DevicePlacement for the coordinates.
export const devicePlacements = sqliteTable("device_placements", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  deviceId:    text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  xCm:         real("x_cm").notNull(),
  yCm:         real("y_cm").notNull(),
  zCm:         real("z_cm").notNull(),
  rotationDeg: real("rotation_deg").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.deviceId] })]);

// ── plants ────────────────────────────────────────────────────────────────────
export const plants = sqliteTable("plants", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  label:       text("label"),
  xCm:         real("x_cm").notNull(),
  yCm:         real("y_cm").notNull(),
  potLitres:   real("pot_litres").notNull(),
  createdAt:   text("created_at").notNull(),
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

// ── threshold_alert_settings ──────────────────────────────────────────────────
// How a metric's alerts behave. A metric with no row uses DEFAULT_ALERT_SETTING.
export const thresholdAlertSettings = sqliteTable("threshold_alert_settings", {
  workspaceId:   text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  metric:        text("metric").notNull(),
  enabled:       integer("enabled", { mode: "boolean" }).notNull().default(true),
  warnMarginPct: real("warn_margin_pct").notNull().default(10),
  delaySec:      integer("delay_sec").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.metric] })]);

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
  /** Bucket average. Named `value` so the raw and rollup tables read alike. */
  value:       real("value").notNull(),
  /** Bucket extremes. Nullable: rows written before these columns existed. */
  minValue:    real("min_value"),
  maxValue:    real("max_value"),
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
  /** Bucket average. Named `value` so the raw and rollup tables read alike. */
  value:       real("value").notNull(),
  /** Bucket extremes. Nullable: rows written before these columns existed. */
  minValue:    real("min_value"),
  maxValue:    real("max_value"),
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
  /** When the summary above was worked out; null until then (grow/archive.ts). */
  envSummarisedAt:  text("env_summarised_at"),
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
  /** Unused: photos are in journal_photos. Never written; kept for older databases. */
  attachmentsJson:   text("attachments_json"),
  envTempC:    real("env_temp_c"),
  envRhPct:    real("env_rh_pct"),
  envVpdKpa:   real("env_vpd_kpa"),
  createdAt:   text("created_at").notNull(),
  updatedAt:   text("updated_at"),
});

// ── journal_photos ────────────────────────────────────────────────────────────
export const journalPhotos = sqliteTable("journal_photos", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** Null from upload until the entry is saved. */
  entryId:     text("entry_id").references(() => journalEntries.id, { onDelete: "cascade" }),
  caption:     text("caption"),
  sortOrder:   integer("sort_order").notNull().default(0),
  width:       integer("width").notNull(),
  height:      integer("height").notNull(),
  contentType: text("content_type").notNull(),
  bytes:       integer("bytes").notNull(),
  createdAt:   text("created_at").notNull(),
});

// ── events ────────────────────────────────────────────────────────────────────
export const events = sqliteTable("events", {
  id:          text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  growId:      text("grow_id").references(() => grows.id, { onDelete: "set null" }),
  /**
   * automation_fired | threshold_alert | failsafe_trip | device_online |
   * device_offline | stage_changed | mode_changed | milestone_reached |
   * maintenance_done | automation_failed | maintenance_due
   */
  type:         text("type").notNull(),
  sourceId:     text("source_id"),
  sourceLabel:  text("source_label"),
  description:  text("description").notNull(),
  /** null | warn | err — used by Overview health panel */
  severity:     text("severity"),
  occurredAt:   text("occurred_at").notNull(),
  /** threshold_alert only: the metric it is about. Null on rows written before 7.5 D. */
  metric:       text("metric"),
});

// ── notification_seen ─────────────────────────────────────────────────────────
/** How far each page's notifications have been seen, per workspace. */
export const notificationSeen = sqliteTable("notification_seen", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  /** A NotificationChannel: logging | automation | maintenance | settings */
  channel:     text("channel").notNull(),
  seenAt:      text("seen_at").notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.channel] })]);

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
  /** Unused since 7.5 H, which replaced it with stagesJson. */
  stage:        text("stage"),
  /** JSON PlannedStage[]: the stages it runs in. Null or empty: every stage. */
  stagesJson:   text("stages_json"),
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
  /**
   * The `next_due_at` a "due" notification was recorded for. Recorded once per
   * due date: completing or skipping moves `next_due_at` on, which re-arms it.
   */
  dueNotifiedAt: text("due_notified_at"),
  /** JSON PlannedStage[]: the stages a recurring task belongs to. Null: every stage. */
  stagesJson:    text("stages_json"),
  /** For cadence "stage": the stage whose start it falls due on. */
  startStage:    text("start_stage"),
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
  /** ChartView as JSON: mode, options and marker groups. Null on layouts saved before 7.5 D. */
  viewJson:    text("view_json"),
});

// ── jobs ──────────────────────────────────────────────────────────────────────
export const jobs = sqliteTable("jobs", {
  id:         text("id").primaryKey(),
  /**
   * rollup_hourly | rollup_daily | prune_raw | prune_hourly | prune_events |
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
