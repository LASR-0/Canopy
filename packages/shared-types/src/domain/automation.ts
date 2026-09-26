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

/**
 * Fires at an instant. Use for one-shot events — an irrigation pulse, a
 * nightly flush. Evaluated in the workspace's timezone.
 *
 * A cron trigger is *missed* if the controller was down when it was due. That
 * is the right behaviour for a pulse (firing a skipped watering hours late is
 * worse than skipping it) and the wrong behaviour for a light cycle, which is
 * what `WindowTrigger` exists for.
 */
export interface ScheduleTrigger {
  kind: "schedule";
  cron: string;
}

/**
 * A daily on/off window — the photoperiod shape.
 *
 * Unlike cron this describes a *state*, not an event: at any instant it can
 * answer "should this be on right now?". That is what makes it recoverable. A
 * controller that reboots at 10:00 with lights due on at 06:00 re-derives the
 * window and switches them on, where a cron scheduler would have missed the
 * edge and left the tent dark all day.
 *
 * `on` and `off` are "HH:MM" in the workspace's timezone. An `off` at or before
 * `on` crosses midnight, which is the normal flowering case. Equal times mean
 * always on, a real 24h seedling setting.
 *
 * The automation's `actions` describe the state *inside* the window; outside
 * it, each action's role is driven off. So a dimmable light at 80% is one
 * action with `{ op: "level", value: 80 }`.
 */
export interface WindowTrigger {
  kind: "window";
  on: string;
  off: string;
}

export type Comparator = "lt" | "lte" | "gt" | "gte";

export interface RuleTrigger {
  kind: "rule";
  metric: Metric;
  comparator: Comparator;
  threshold: number;
  forSeconds?: number;
}

export type AutomationTrigger = ScheduleTrigger | WindowTrigger | RuleTrigger;

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
