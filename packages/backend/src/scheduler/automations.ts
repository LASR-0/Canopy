/**
 * Time-driven automations.
 *
 * Evaluated on every tick against the workspace clock. Two trigger shapes,
 * handled deliberately differently:
 *
 *  - **window** is a desired state. Each tick derives what the tent should look
 *    like now and acts only when that differs from what was last applied. A
 *    restart re-derives it, so a controller that reboots mid-photoperiod
 *    corrects the lights instead of waiting for tomorrow's edge.
 *  - **schedule** (cron) is an event. It fires when an occurrence falls in the
 *    elapsed tick interval, and an occurrence missed while the controller was
 *    down stays missed. Replaying a skipped irrigation pulse hours late is
 *    worse than skipping it.
 *
 * Automations target **roles**, never device ids, so hardware can be swapped
 * without rewriting schedules. An automation whose role nothing holds is
 * skipped quietly: that is a half-finished setup, not an error.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../store/index.js";
import { automations, roleAssignments, workspaces, events } from "../store/schema.js";
import { actuateDevice } from "../device-manager/actuate.js";
import { canActuate } from "../controller/state.js";
import { broadcast } from "../ws/index.js";
import { cronFiredBetween, isWithinWindow } from "./schedule.js";
import type {
  ActuatorCommand,
  Automation,
  AutomationAction,
  AutomationTrigger,
  RoleKind,
} from "@canopy/shared-types";

/**
 * What was last pushed to each automation's roles.
 *
 * In memory on purpose. An empty map means "unknown", which makes the first
 * tick after a restart re-apply the current desired state — exactly the
 * recovery behaviour a photoperiod needs.
 */
const lastApplied = new Map<string, string>();

/** When each cron automation was last evaluated, so occurrences fire once. */
const lastEvaluated = new Map<string, number>();

export interface AutomationOutcome {
  evaluated: number;
  fired: number;
  skipped: number;
}

/** Desired state for a window automation: the actions, or everything off. */
export function windowActions(
  actions: AutomationAction[],
  inside: boolean,
): AutomationAction[] {
  if (inside) return actions;
  return actions.map((action) => ({ role: action.role, command: { op: "off" } as ActuatorCommand }));
}

/** A stable description of a desired state, used to detect change. */
export function stateKey(actions: AutomationAction[]): string {
  return actions
    .map((a) => `${a.role}:${JSON.stringify(a.command)}`)
    .sort()
    .join("|");
}

/** Every device currently holding a role in this workspace. */
async function devicesForRole(
  workspaceId: string,
  role: RoleKind,
): Promise<{ deviceId: string; channel: string }[]> {
  const rows = await db
    .select({ deviceId: roleAssignments.deviceId, channel: roleAssignments.channel })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.workspaceId, workspaceId), eq(roleAssignments.role, role)));
  return rows;
}

async function recordFiring(
  automation: Automation,
  description: string,
  at: Date,
): Promise<void> {
  await db.insert(events).values({
    id: randomUUID(),
    workspaceId: automation.workspaceId,
    type: "automation_fired",
    sourceId: automation.id,
    sourceLabel: automation.name,
    description,
    occurredAt: at.toISOString(),
  });

  broadcast({
    type: "automation.fired",
    payload: { automationId: automation.id, at: at.toISOString() },
  });
}

/**
 * Drive every role an automation targets.
 *
 * Returns whether anything was actually sent. A role nobody holds, or a device
 * that refuses the command, does not abort the remaining actions: one broken
 * fan should not also strand the lights.
 */
async function applyActions(
  automation: Automation,
  actions: AutomationAction[],
): Promise<boolean> {
  let sentAnything = false;

  for (const action of actions) {
    const targets = await devicesForRole(automation.workspaceId, action.role);
    if (targets.length === 0) continue;

    for (const target of targets) {
      const result = await actuateDevice(target.deviceId, action.command, target.channel);
      if (result.ok) {
        sentAnything = true;
      } else {
        console.warn(
          `[scheduler] ${automation.name}: ${action.role} -> ${result.code}: ${result.message}`,
        );
      }
    }
  }

  return sentAnything;
}

function parseAutomation(row: typeof automations.$inferSelect): Automation | null {
  try {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      enabled: row.enabled,
      kind: row.kind as Automation["kind"],
      subsystem: row.subsystem as Automation["subsystem"],
      driver: row.driver,
      trigger: JSON.parse(row.triggerJson) as AutomationTrigger,
      actions: JSON.parse(row.actionsJson) as AutomationAction[],
      sortOrder: row.sortOrder,
      ...(row.stage ? { stage: row.stage as NonNullable<Automation["stage"]> } : {}),
      ...(row.overrideUntil ? { overrideUntil: row.overrideUntil } : {}),
    };
  } catch {
    console.error(`[scheduler] automation ${row.id} has unreadable trigger or actions`);
    return null;
  }
}

/** Timezone per workspace, so a photoperiod follows the tent's clock. */
async function workspaceTimezones(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: workspaces.id, timezone: workspaces.timezone })
    .from(workspaces);
  return new Map(rows.map((r) => [r.id, r.timezone]));
}

/**
 * Evaluate every enabled time-driven automation.
 *
 * `now` is injectable so the behaviour across a photoperiod boundary can be
 * tested without waiting for one.
 */
export async function evaluateAutomations(now: Date = new Date()): Promise<AutomationOutcome> {
  const outcome: AutomationOutcome = { evaluated: 0, fired: 0, skipped: 0 };

  // A paused controller must not drive hardware, and evaluating without acting
  // would desync the applied-state map from reality.
  if (!canActuate()) return outcome;

  const rows = await db.select().from(automations).where(eq(automations.enabled, true));
  if (rows.length === 0) return outcome;

  const timezones = await workspaceTimezones();

  for (const row of rows) {
    const automation = parseAutomation(row);
    if (!automation) {
      outcome.skipped++;
      continue;
    }

    const trigger = automation.trigger;
    if (trigger.kind === "rule") continue; // Phase 6 evaluates these.

    // A manual override holds the automation off until it expires.
    if (automation.overrideUntil && automation.overrideUntil > now.toISOString()) {
      outcome.skipped++;
      continue;
    }

    outcome.evaluated++;
    const timeZone = timezones.get(automation.workspaceId) ?? "UTC";

    if (trigger.kind === "window") {
      const inside = isWithinWindow(trigger.on, trigger.off, now, timeZone);
      if (inside === null) {
        console.error(`[scheduler] ${automation.name} has an unreadable window`);
        outcome.skipped++;
        continue;
      }

      const desired = windowActions(automation.actions, inside);
      const key = stateKey(desired);
      if (lastApplied.get(automation.id) === key) continue;

      const sent = await applyActions(automation, desired);
      // Only remembered once something was actually sent, so an automation
      // whose role is unassigned re-attempts when a device is finally bound.
      if (sent) {
        lastApplied.set(automation.id, key);
        await recordFiring(automation, `${inside ? "on" : "off"} (${trigger.on}–${trigger.off})`, now);
        outcome.fired++;
      }
      continue;
    }

    // Cron. The first sighting only establishes a baseline: without it, a
    // restart would replay every occurrence since the epoch.
    const previous = lastEvaluated.get(automation.id);
    lastEvaluated.set(automation.id, now.getTime());
    if (previous === undefined) continue;

    if (!cronFiredBetween(trigger.cron, new Date(previous), now, timeZone)) continue;

    const sent = await applyActions(automation, automation.actions);
    if (sent) {
      await recordFiring(automation, `fired (${trigger.cron})`, now);
      outcome.fired++;
    }
  }

  return outcome;
}

/** Forget applied state. Tests, and anything that reloads automations. */
export function resetAutomationState(): void {
  lastApplied.clear();
  lastEvaluated.clear();
}
