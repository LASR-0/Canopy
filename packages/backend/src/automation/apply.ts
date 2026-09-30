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
 * Targets whose failure has already been recorded, by automation, role and
 * device, until that target next succeeds.
 *
 * A window automation whose command fails retries on every scheduler tick, so
 * recording each attempt would write one event a minute for as long as the
 * device stays broken, which is the flood Phase 7.5 A cleaned up after. In
 * memory, so a restart records a still-failing target once more.
 */
const failing = new Set<string>();

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
  automation: Pick<Automation, "id" | "workspaceId" | "name">,
  actions: AutomationAction[],
  source: string,
): Promise<boolean> {
  let sentAnything = false;

  for (const action of actions) {
    const targets = await devicesForRole(automation.workspaceId, action.role);
    if (targets.length === 0) continue;

    for (const target of targets) {
      const result = await actuateDevice(target.deviceId, action.command, target.channel);
      const key = `${automation.id}:${action.role}:${target.deviceId}`;
      if (result.ok) {
        sentAnything = true;
        failing.delete(key);
      } else {
        console.warn(
          `[${source}] ${automation.name}: ${action.role} -> ${result.code}: ${result.message}`,
        );
        if (!failing.has(key)) {
          failing.add(key);
          await recordFailure(automation, action.role, result.message);
        }
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

/**
 * Record a failed run: an automation tried to act and a device refused or
 * could not be reached. A notification for the Automation page.
 */
async function recordFailure(
  automation: Pick<Automation, "id" | "workspaceId" | "name">,
  role: RoleKind,
  message: string,
): Promise<void> {
  try {
    await recordEvent({
      workspaceId: automation.workspaceId,
      type: "automation_failed",
      severity: "err",
      sourceId: automation.id,
      sourceLabel: automation.name,
      description: `${role}: ${message}`,
    });
  } catch (err) {
    // Losing the record must not stop the remaining actions from being driven.
    console.error("[automation] failed to record a failed run:", err);
  }
}

/** Forget which targets are failing. Tests only. */
export function resetFailureState(): void {
  failing.clear();
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
