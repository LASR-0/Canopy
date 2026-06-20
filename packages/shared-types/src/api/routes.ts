import type {
  Workspace,
  Device,
  RoleAssignment,
  GrowCycle,
  GrowTemplate,
  GrowMilestone,
  Automation,
  JournalEntry,
  MaintenanceTask,
  MaintenanceCompletion,
  MaintenanceDayNote,
  SensorThreshold,
  AppEvent,
  AppSettings,
  ChartLayout,
  Reading,
  ReadingSeriesQuery,
  ReadingSeries,
  ControllerStatus,
  ControllerCommand,
  ActuatorCommand,
  Id,
} from "../domain/index.js";

export interface CreateWorkspaceBody {
  name: string;
  timezone?: string;
}

export interface StartScanBody {
  includeSubnetSweep?: boolean;
}

export interface AssignRoleBody {
  role: RoleAssignment["role"];
  deviceId: Id;
  channel: string;
}

export interface ActuateBody {
  command: ActuatorCommand;
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

  // ── Automations ───────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/automations":            { res: Automation[] };
  "POST /workspaces/:workspaceId/automations":           { body: Partial<Automation>; res: Automation };
  "PATCH /workspaces/:workspaceId/automations/:id":      { body: Partial<Automation>; res: Automation };

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
  "GET /workspaces/:workspaceId/maintenance/day-notes":           { res: MaintenanceDayNote[] };
  "POST /workspaces/:workspaceId/maintenance/day-notes":          { body: Partial<MaintenanceDayNote>; res: MaintenanceDayNote };

  // ── Events ────────────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/events":    { res: AppEvent[] };

  // ── Chart layouts ─────────────────────────────────────────────────────────
  "GET /workspaces/:workspaceId/chart-layouts":         { res: ChartLayout[] };
  "POST /workspaces/:workspaceId/chart-layouts":        { body: Partial<ChartLayout>; res: ChartLayout };
  "DELETE /workspaces/:workspaceId/chart-layouts/:id":  { res: { deleted: true } };
}
