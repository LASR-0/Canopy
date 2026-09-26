/**
 * Driving an automation's actions, shared by the scheduler and the rules
 * engine.
 *
 * Both resolve roles to hardware and record what they did, and the two must
 * agree: an activity feed where a scheduled firing and a rule firing are
 * described differently, or where one records an event and the other does not,
 * is worse than no feed.
 *
 * Actions target **roles**, never device ids, so hardware can be swapped
 * without rewriting automations.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../store/index.js";
import { events, roleAssignments } from "../store/schema.js";
import { actuateDevice } from "../device-manager/actuate.js";
import { broadcast } from "../ws/index.js";
import type { Automation, AutomationAction, EventType, RoleKind } from "@canopy/shared-types";

/** Every device currently holding a role in this workspace. */
export async function devicesForRole(
  workspaceId: string,
  role: RoleKind,
): Promise<{ deviceId: string; channel: string }[]> {
  return db
    .select({ deviceId: roleAssignments.deviceId, channel: roleAssignments.channel })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.workspaceId, workspaceId), eq(roleAssignments.role, role)));
}

/**
 * Drive every role an automation targets.
 *
 * Returns whether anything was actually sent. A role nobody holds, or a device
 * that refuses the command, does not abort the remaining actions: one broken
 * fan should not also strand the lights.
 *
 * The caller uses the return value to decide whether to remember the new state.
 * Recording a state that was never delivered would leave the tent wrong and the
 * controller convinced it was right.
 */
export async function applyActions(
  automation: Pick<Automation, "workspaceId" | "name">,
  actions: AutomationAction[],
  source: string,
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
          `[${source}] ${automation.name}: ${action.role} -> ${result.code}: ${result.message}`,
        );
      }
    }
  }

  return sentAnything;
}

export interface EventRecord {
  workspaceId: string;
  type: EventType;
  description: string;
  sourceId?: string;
  sourceLabel?: string;
  severity?: "warn" | "err";
  at?: Date;
}

/**
 * Write a timeline event and push it live.
 *
 * The Overview's activity feed reads this table, so anything worth telling the
 * grower about goes through here rather than only into the log.
 */
export async function recordEvent(event: EventRecord): Promise<void> {
  const at = event.at ?? new Date();

  await db.insert(events).values({
    id: randomUUID(),
    workspaceId: event.workspaceId,
    type: event.type,
    description: event.description,
    occurredAt: at.toISOString(),
    ...(event.sourceId ? { sourceId: event.sourceId } : {}),
    ...(event.sourceLabel ? { sourceLabel: event.sourceLabel } : {}),
    ...(event.severity ? { severity: event.severity } : {}),
  });
}

/** Record an automation firing and push the live notification for it. */
export async function recordFiring(
  automation: Pick<Automation, "id" | "workspaceId" | "name">,
  description: string,
  at: Date,
): Promise<void> {
  await recordEvent({
    workspaceId: automation.workspaceId,
    type: "automation_fired",
    sourceId: automation.id,
    sourceLabel: automation.name,
    description,
    at,
  });

  broadcast({
    type: "automation.fired",
    payload: { automationId: automation.id, at: at.toISOString() },
  });
}
