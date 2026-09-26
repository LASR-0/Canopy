import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../store/index.js";
import { automations } from "../../store/schema.js";
import { isValidCron, parseClockTime } from "../../scheduler/schedule.js";
import { refreshRules } from "../../rules/index.js";
import { ok, err } from "../reply.js";
import type { Automation, AutomationTrigger } from "@canopy/shared-types";

function rowToAutomation(row: typeof automations.$inferSelect): Automation {
  const automation: Automation = {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    enabled: row.enabled,
    kind: row.kind as Automation["kind"],
    subsystem: row.subsystem as Automation["subsystem"],
    driver: row.driver,
    trigger: JSON.parse(row.triggerJson) as AutomationTrigger,
    actions: JSON.parse(row.actionsJson) as Automation["actions"],
    sortOrder: row.sortOrder,
  };

  if (row.actuatorRole)  automation.actuatorRole = row.actuatorRole as NonNullable<Automation["actuatorRole"]>;
  if (row.controlRes)    automation.controlRes = row.controlRes as NonNullable<Automation["controlRes"]>;
  if (row.requiresRole)  automation.requiresRole = row.requiresRole as NonNullable<Automation["requiresRole"]>;
  if (row.stage)         automation.stage = row.stage as NonNullable<Automation["stage"]>;
  if (row.overrideUntil) automation.overrideUntil = row.overrideUntil;
  if (row.overrideState) automation.overrideState = row.overrideState;

  return automation;
}

/**
 * Reject a trigger the scheduler could never act on.
 *
 * An automation that silently never fires is the worst outcome here: it looks
 * configured, the card shows enabled, and the tent quietly does nothing. Better
 * to refuse it at the point of entry.
 */
export function validateTrigger(trigger: unknown): string | null {
  if (typeof trigger !== "object" || trigger === null) return "trigger is required";

  const kind = (trigger as { kind?: unknown }).kind;

  if (kind === "schedule") {
    const cron = (trigger as { cron?: unknown }).cron;
    if (typeof cron !== "string" || !isValidCron(cron)) {
      return "schedule trigger needs a valid cron expression";
    }
    return null;
  }

  if (kind === "window") {
    const { on, off } = trigger as { on?: unknown; off?: unknown };
    if (typeof on !== "string" || parseClockTime(on) === null) {
      return 'window trigger needs "on" as HH:MM';
    }
    if (typeof off !== "string" || parseClockTime(off) === null) {
      return 'window trigger needs "off" as HH:MM';
    }
    return null;
  }

  if (kind === "rule") {
    // Evaluated by the rules engine in Phase 6; accepted and stored now so the
    // UI can be built against it.
    const { metric, comparator, threshold } = trigger as Record<string, unknown>;
    if (typeof metric !== "string") return "rule trigger needs a metric";
    if (!["lt", "lte", "gt", "gte"].includes(String(comparator))) {
      return "rule trigger needs comparator lt, lte, gt or gte";
    }
    if (typeof threshold !== "number") return "rule trigger needs a numeric threshold";
    return null;
  }

  return 'trigger.kind must be "schedule", "window" or "rule"';
}

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/automations",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(automations)
        .where(eq(automations.workspaceId, req.params.workspaceId))
        .orderBy(automations.sortOrder);
      return reply.send(ok(rows.map(rowToAutomation)));
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: Partial<Automation> }>(
    "/workspaces/:workspaceId/automations",
    async (req, reply) => {
      const body = req.body ?? {};
      const trigger = body.trigger;

      const invalid = validateTrigger(trigger);
      if (invalid) return reply.status(400).send(err("validation_failed", invalid));
      if (!body.name?.trim()) {
        return reply.status(400).send(err("validation_failed", "name is required"));
      }

      // Appended to the end of the list rather than assuming zero, which would
      // silently reorder every existing card.
      const [orderRow] = await db
        .select({ nextOrder: sql<number>`COALESCE(MAX(sort_order), -1) + 1` })
        .from(automations)
        .where(eq(automations.workspaceId, req.params.workspaceId));
      const nextOrder = orderRow?.nextOrder ?? 0;

      const id = randomUUID();
      await db.insert(automations).values({
        id,
        workspaceId: req.params.workspaceId,
        name: body.name.trim(),
        enabled: body.enabled ?? true,
        // A rule trigger implies kind "rule"; everything else is time-driven.
        kind: body.kind ?? ((trigger as AutomationTrigger).kind === "rule" ? "rule" : "schedule"),
        subsystem: body.subsystem ?? "lighting",
        driver: body.driver ?? "schedule",
        ...(body.actuatorRole ? { actuatorRole: body.actuatorRole } : {}),
        ...(body.controlRes ? { controlRes: body.controlRes } : {}),
        ...(body.requiresRole ? { requiresRole: body.requiresRole } : {}),
        triggerJson: JSON.stringify(trigger),
        actionsJson: JSON.stringify(body.actions ?? []),
        ...(body.stage ? { stage: body.stage } : {}),
        sortOrder: body.sortOrder ?? nextOrder ?? 0,
      });

      // A rule the user just saved has to take effect now, not next restart.
      await refreshRules();

      const [row] = await db.select().from(automations).where(eq(automations.id, id));
      return reply.status(201).send(ok(rowToAutomation(row!)));
    },
  );

  app.patch<{ Params: { workspaceId: string; id: string }; Body: Partial<Automation> }>(
    "/workspaces/:workspaceId/automations/:id",
    async (req, reply) => {
      const body = req.body ?? {};

      if (body.trigger !== undefined) {
        const invalid = validateTrigger(body.trigger);
        if (invalid) return reply.status(400).send(err("validation_failed", invalid));
      }

      const updates: Partial<typeof automations.$inferInsert> = {};
      if (body.name !== undefined)          updates.name = body.name;
      if (body.enabled !== undefined)       updates.enabled = body.enabled;
      if (body.kind !== undefined)          updates.kind = body.kind;
      if (body.subsystem !== undefined)     updates.subsystem = body.subsystem;
      if (body.driver !== undefined)        updates.driver = body.driver;
      if (body.actuatorRole !== undefined)  updates.actuatorRole = body.actuatorRole;
      if (body.controlRes !== undefined)    updates.controlRes = body.controlRes;
      if (body.requiresRole !== undefined)  updates.requiresRole = body.requiresRole;
      if (body.trigger !== undefined)       updates.triggerJson = JSON.stringify(body.trigger);
      if (body.actions !== undefined)       updates.actionsJson = JSON.stringify(body.actions);
      if (body.stage !== undefined)         updates.stage = body.stage ?? null;
      if (body.overrideUntil !== undefined) updates.overrideUntil = body.overrideUntil ?? null;
      if (body.overrideState !== undefined) updates.overrideState = body.overrideState ?? null;
      if (body.sortOrder !== undefined)     updates.sortOrder = body.sortOrder;

      if (Object.keys(updates).length > 0) {
        await db
          .update(automations)
          .set(updates)
          .where(
            and(
              eq(automations.id, req.params.id),
              eq(automations.workspaceId, req.params.workspaceId),
            ),
          );
      }

      await refreshRules();

      const [row] = await db.select().from(automations).where(eq(automations.id, req.params.id));
      if (!row) return reply.status(404).send(err("not_found", "Automation not found"));
      return reply.send(ok(rowToAutomation(row)));
    },
  );

  app.delete<{ Params: { workspaceId: string; id: string } }>(
    "/workspaces/:workspaceId/automations/:id",
    async (req, reply) => {
      await db
        .delete(automations)
        .where(
          and(
            eq(automations.id, req.params.id),
            eq(automations.workspaceId, req.params.workspaceId),
          ),
        );
      await refreshRules();
      return reply.send(ok({ deleted: true as const }));
    },
  );
}
