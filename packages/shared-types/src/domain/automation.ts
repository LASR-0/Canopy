import type { Id } from "./common.js";
import type { Metric } from "./capability.js";
import type { ActuatorCommand, RoleKind } from "./index-internal.js";
import type { GrowStageName } from "./grow.js";

export type AutomationKind = "schedule" | "rule" | "failsafe";

export type AutomationSubsystem =
  | "lighting"
  | "climate"
  | "airflow"
  | "co2"
  | "irrigation"
  | "failsafe";

export type ControlResolution = "on-off" | "variable" | "setpoint";

export interface ScheduleTrigger {
  kind: "schedule";
  cron: string;
}

export type Comparator = "lt" | "lte" | "gt" | "gte";

export interface RuleTrigger {
  kind: "rule";
  metric: Metric;
  comparator: Comparator;
  threshold: number;
  forSeconds?: number;
}

export type AutomationTrigger = ScheduleTrigger | RuleTrigger;

export interface AutomationAction {
  role: RoleKind;
  command: ActuatorCommand;
}

export interface Automation {
  id: Id;
  workspaceId: Id;
  name: string;
  enabled: boolean;
  kind: AutomationKind;
  subsystem: AutomationSubsystem;
  /** What drives this automation: "schedule" | role_id | "any" */
  driver: string;
  actuatorRole?: RoleKind;
  controlRes?: ControlResolution;
  /** If set, automation shows as locked when no device holds this role. */
  requiresRole?: RoleKind;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  /** Optional grow stage scope — only active during this stage. */
  stage?: GrowStageName;
  /** ISO timestamp — manual override active until this time. */
  overrideUntil?: string;
  /** Description of the active override e.g. "held off", "held at 80%". */
  overrideState?: string;
  sortOrder: number;
}
