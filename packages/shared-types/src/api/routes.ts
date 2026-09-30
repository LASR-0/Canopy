import type {
  Workspace,
  Device,
  RoleAssignment,
  GrowCycle,
  GrowTemplate,
  GrowMilestone,
  Automation,
  AutomationPatch,
  JournalEntry,
  MaintenanceTask,
  MaintenanceCompletion,
  MaintenanceDayNote,
  SensorThreshold,
  ThresholdAlertSetting,
  AlertBehaviour,
  AppEvent,
  NotificationChannel,
  NotificationSummary,
  LogsResponse,
  AppSettings,
  ChartLayout,
  Reading,
  ReadingSeriesQuery,
  ReadingSeries,
  ControllerStatus,
  ControllerCommand,
  ActuatorCommand,
  DevicePlacement,
  Plant,
  WorkspaceLayout,
  Id,
} from "../domain/index.js";

export interface CreateWorkspaceBody {
  name: string;
  timezone?: string;
}

export interface StartScanBody {
  includeSubnetSweep?: boolean;
}

/** Where to put a device. Omitted fields keep their current value, or a default when new. */
export interface PlaceDeviceBody {
  xCm?: number;
  yCm?: number;
  zCm?: number;
  rotationDeg?: number;
}

/** A plant's editable fields. An empty `label` clears it. */
export interface PlantBody {
  xCm?: number;
  yCm?: number;
  potLitres?: number;
  label?: string;
}

export interface AssignRoleBody {
  role: RoleAssignment["role"];
  deviceId: Id;
  channel: string;
}

export interface ActuateBody {
  command: ActuatorCommand;
  /**
   * Which actuator channel to drive. Optional when the device exposes exactly
   * one actuator; required when it exposes several, such as a two-relay Shelly,
   * where guessing would switch the wrong load.
   */
  channel?: string;
}

/** Each entry: the params/body the UI sends and the data it gets back. */
export interface ApiRoutes {
  "GET /health":                    { res: { ok: true; version: string; ts: string; uptimeSec: number } };
  "GET /controller/status":         { res: ControllerStatus };
  "POST /controller/command":       { body: ControllerCommand; res: ControllerStatus };

  // ── Workspaces ────────────────────────────────────────────────────────────
  "GET /workspaces":                { res: Workspace[] };
  "POST /workspaces":               { body: CreateWorkspaceBody; res: Workspace };
  "PATCH /workspaces/:workspaceId": { body: Partial<Pick<Workspace, "name" | "timezone" | "dimensions">>; res: Workspace };
  "DELETE /workspaces/:workspaceId": { res: { deleted: true } };

  // ── Layout (Setup View) ───────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/layout":                          { res: WorkspaceLayout };
  "PUT /workspaces/:workspaceId/placements/:deviceId":            { body: PlaceDeviceBody; res: DevicePlacement };
  "DELETE /workspaces/:workspaceId/placements/:deviceId":         { res: { deleted: true } };
  "POST /workspaces/:workspaceId/plants":                         { body: PlantBody; res: Plant };
  "PATCH /workspaces/:workspaceId/plants/:plantId":               { body: PlantBody; res: Plant };
  "DELETE /workspaces/:workspaceId/plants/:plantId":              { res: { deleted: true } };

  // ── Settings ──────────────────────────────────────────────────────────────
  "GET /settings":                  { res: AppSettings };
  "PATCH /settings":                { body: Partial<AppSettings>; res: AppSettings };

  // ── Devices ───────────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/devices":   { res: Device[] };
  "POST /workspaces/:workspaceId/scan":              { body: StartScanBody; res: { scanId: Id } };
  "POST /workspaces/:workspaceId/devices/forget-all": { res: { forgotten: true } };
  "POST /workspaces/:workspaceId/roles":    { body: AssignRoleBody; res: RoleAssignment };
  "POST /devices/:deviceId/actuate":        { body: ActuateBody; res: { accepted: true } };

  // ── Sensor thresholds ─────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/thresholds":           { res: SensorThreshold[] };
  "PUT /workspaces/:workspaceId/thresholds/:id":       { body: Partial<SensorThreshold>; res: SensorThreshold };
  "DELETE /workspaces/:workspaceId/thresholds/:id":    { res: { deleted: true } };
  "GET /workspaces/:workspaceId/threshold-alerts":             { res: ThresholdAlertSetting[] };
  "PUT /workspaces/:workspaceId/threshold-alerts/:metric":     { body: Partial<AlertBehaviour>; res: ThresholdAlertSetting };
  "DELETE /workspaces/:workspaceId/threshold-alerts/:metric":  { res: { deleted: true } };

  // ── Readings ──────────────────────────────────────────────────────────────
  "POST /readings/series":                              { body: ReadingSeriesQuery; res: ReadingSeries };
  "GET /workspaces/:workspaceId/readings/latest":       { res: Reading[] };

  // ── Grows ─────────────────────────────────────────────────────────────────
  "GET /grow-templates":                              { res: GrowTemplate[] };
  "GET /workspaces/:workspaceId/grows":               { res: GrowCycle[] };
  "GET /workspaces/:workspaceId/grows/:growId":       { res: GrowCycle };
  "POST /workspaces/:workspaceId/grows":              { body: Partial<GrowCycle>; res: GrowCycle };
  "PATCH /workspaces/:workspaceId/grows/:growId":     { body: Partial<GrowCycle>; res: GrowCycle };
  "GET /workspaces/:workspaceId/grows/:growId/milestones":         { res: GrowMilestone[] };
  "POST /workspaces/:workspaceId/grows/:growId/milestones":        { body: Partial<GrowMilestone>; res: GrowMilestone };
  "PATCH /workspaces/:workspaceId/grows/:growId/milestones/:id":   { body: Partial<GrowMilestone>; res: GrowMilestone };
  "DELETE /workspaces/:workspaceId/grows/:growId/milestones/:id":  { res: { deleted: true } };

  // ── Automations ───────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/automations":            { res: Automation[] };
  "POST /workspaces/:workspaceId/automations":           { body: Partial<Automation>; res: Automation };
  "PATCH /workspaces/:workspaceId/automations/:id":      { body: AutomationPatch; res: Automation };
  "DELETE /workspaces/:workspaceId/automations/:id":     { res: { deleted: true } };

  // ── Journal ───────────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/grows/:growId/journal":         { res: JournalEntry[] };
  "POST /workspaces/:workspaceId/grows/:growId/journal":        { body: Partial<JournalEntry>; res: JournalEntry };
  "PATCH /workspaces/:workspaceId/grows/:growId/journal/:id":   { body: Partial<JournalEntry>; res: JournalEntry };
  "DELETE /workspaces/:workspaceId/grows/:growId/journal/:id":  { res: { deleted: true } };

  // ── Maintenance ───────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/maintenance":                     { res: MaintenanceTask[] };
  "POST /workspaces/:workspaceId/maintenance":                    { body: Partial<MaintenanceTask>; res: MaintenanceTask };
  "PATCH /workspaces/:workspaceId/maintenance/:id":               { body: Partial<MaintenanceTask>; res: MaintenanceTask };
  "POST /workspaces/:workspaceId/maintenance/:id/complete":       { body: { note?: string }; res: MaintenanceCompletion };
  "POST /workspaces/:workspaceId/maintenance/:id/skip":           { body: { note?: string }; res: MaintenanceCompletion };
  "GET /workspaces/:workspaceId/maintenance/completions":         { res: MaintenanceCompletion[] };
  "DELETE /workspaces/:workspaceId/maintenance/:id":              { res: { deleted: true } };
  "GET /workspaces/:workspaceId/maintenance/day-notes":           { res: MaintenanceDayNote[] };
  "POST /workspaces/:workspaceId/maintenance/day-notes":          { body: Partial<MaintenanceDayNote>; res: MaintenanceDayNote };

  // ── Events ────────────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/events":    { res: AppEvent[] };
  /** Problems in a window, for the Logging page's Logs tab. */
  "GET /workspaces/:workspaceId/logs":      { res: LogsResponse };

  // ── Notifications ─────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/notifications":       { res: NotificationSummary };
  /** Marks the given channels seen up to now; every channel when none are given. */
  "POST /workspaces/:workspaceId/notifications/seen": { body: { channels?: NotificationChannel[] }; res: NotificationSummary };

  // ── Chart layouts ─────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/chart-layouts":         { res: ChartLayout[] };
  "POST /workspaces/:workspaceId/chart-layouts":        { body: Partial<ChartLayout>; res: ChartLayout };
  "DELETE /workspaces/:workspaceId/chart-layouts/:id":  { res: { deleted: true } };
}
