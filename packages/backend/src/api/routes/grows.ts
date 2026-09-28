import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { ok, err } from "../reply.js";
import type { GrowCycle, GrowMilestone, GrowTemplate } from "@canopy/shared-types";
import { db } from "../../store/index.js";
import { grows, growMilestones, growTemplates, workspaces } from "../../store/schema.js";
import { refreshActiveGrows } from "../../grow/stage.js";
import { refreshThresholds } from "../../rules/thresholds.js";

function rowToGrow(row: typeof grows.$inferSelect): GrowCycle {
  const g: GrowCycle = {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    status: row.status as GrowCycle["status"],
    plannedSeedlingWeeks: row.plannedSeedlingWeeks,
    plannedVegWeeks: row.plannedVegWeeks,
    plannedFlowerWeeks: row.plannedFlowerWeeks,
    plannedFlushWeeks: row.plannedFlushWeeks,
  };
  if (row.strain)              g.strain = row.strain;
  if (row.plantCount != null)  g.plantCount = row.plantCount;
  if (row.templateId)          g.templateId = row.templateId;
  if (row.startedAt)           g.startedAt = row.startedAt;
  if (row.completedAt)         g.completedAt = row.completedAt;
  if (row.actualSeedlingWeeks != null) g.actualSeedlingWeeks = row.actualSeedlingWeeks;
  if (row.actualVegWeeks != null)      g.actualVegWeeks = row.actualVegWeeks;
  if (row.actualFlowerWeeks != null)   g.actualFlowerWeeks = row.actualFlowerWeeks;
  if (row.actualFlushWeeks != null)    g.actualFlushWeeks = row.actualFlushWeeks;
  if (row.wetWeightG != null)  g.wetWeightG = row.wetWeightG;
  if (row.dryWeightG != null)  g.dryWeightG = row.dryWeightG;
  if (row.rating != null)      g.rating = row.rating;
  if (row.notesWorked)         g.notesWorked = row.notesWorked;
  if (row.notesChange)         g.notesChange = row.notesChange;
  if (row.techniquesJson) {
    try { g.techniques = JSON.parse(row.techniquesJson) as string[]; } catch { /* skip */ }
  }
  if (row.abortReason)         g.abortReason = row.abortReason;
  if (row.abortNote)           g.abortNote = row.abortNote;
  if (row.envAvgVpd != null)        g.envAvgVpd = row.envAvgVpd;
  if (row.envTempMin != null)       g.envTempMin = row.envTempMin;
  if (row.envTempMax != null)       g.envTempMax = row.envTempMax;
  if (row.envTempAvg != null)       g.envTempAvg = row.envTempAvg;
  if (row.envRhMin != null)         g.envRhMin = row.envRhMin;
  if (row.envRhMax != null)         g.envRhMax = row.envRhMax;
  if (row.envRhAvg != null)         g.envRhAvg = row.envRhAvg;
  if (row.envFailsafeTrips != null) g.envFailsafeTrips = row.envFailsafeTrips;
  if (row.envFailsafeNote)          g.envFailsafeNote = row.envFailsafeNote;
  return g;
}

function rowToMilestone(row: typeof growMilestones.$inferSelect): GrowMilestone {
  const m: GrowMilestone = { id: row.id, growId: row.growId, label: row.label, day: row.day, done: row.done };
  if (row.doneAt) m.doneAt = row.doneAt;
  return m;
}

const isGrowDay = (day: unknown): day is number =>
  typeof day === "number" && Number.isInteger(day) && day >= 1;

/** Whether the grow exists in this workspace — every nested route is scoped by both. */
async function growIn(workspaceId: string, growId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: grows.id })
    .from(grows)
    .where(and(eq(grows.id, growId), eq(grows.workspaceId, workspaceId)));
  return !!row;
}

export async function growRoutes(app: FastifyInstance): Promise<void> {
  app.get("/grow-templates", async (_req, reply) => {
    const rows = await db.select().from(growTemplates);
    const templates: GrowTemplate[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      seedlingWeeks: r.seedlingWeeks,
      vegWeeks: r.vegWeeks,
      flowerWeeks: r.flowerWeeks,
      flushWeeks: r.flushWeeks,
    }));
    return reply.send(ok(templates));
  });

  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/grows",
    async (req, reply) => {
      const rows = await db.select().from(grows).where(eq(grows.workspaceId, req.params.workspaceId));
      return reply.send(ok(rows.map(rowToGrow)));
    },
  );

  app.get<{ Params: { workspaceId: string; growId: string } }>(
    "/workspaces/:workspaceId/grows/:growId",
    async (req, reply) => {
      const [row] = await db.select().from(grows).where(eq(grows.id, req.params.growId));
      if (!row) return reply.status(404).send(err("not_found", "Grow not found"));
      return reply.send(ok(rowToGrow(row)));
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: Partial<GrowCycle> }>(
    "/workspaces/:workspaceId/grows",
    async (req, reply) => {
      const id = randomUUID();
      const b = req.body;
      await db.insert(grows).values({
        id,
        workspaceId: req.params.workspaceId,
        name: b.name ?? "Unnamed grow",
        status: b.status ?? "planned",
        plannedSeedlingWeeks: b.plannedSeedlingWeeks ?? 2,
        plannedVegWeeks: b.plannedVegWeeks ?? 4,
        plannedFlowerWeeks: b.plannedFlowerWeeks ?? 8,
        plannedFlushWeeks: b.plannedFlushWeeks ?? 1,
        ...(b.strain       ? { strain: b.strain }           : {}),
        ...(b.plantCount != null ? { plantCount: b.plantCount } : {}),
        ...(b.templateId   ? { templateId: b.templateId }   : {}),
        ...(b.startedAt    ? { startedAt: b.startedAt }     : {}),
      });
      if ((b.status ?? "planned") === "active") {
        await db.update(workspaces).set({ activeGrowId: id }).where(eq(workspaces.id, req.params.workspaceId));
        await refreshActiveGrows();
        await refreshThresholds();
      }

      const [row] = await db.select().from(grows).where(eq(grows.id, id));
      return reply.status(201).send(ok(rowToGrow(row!)));
    },
  );

  app.patch<{ Params: { workspaceId: string; growId: string }; Body: Partial<GrowCycle> }>(
    "/workspaces/:workspaceId/grows/:growId",
    async (req, reply) => {
      const { workspaceId, growId } = req.params;
      const b = req.body;
      const updates: Partial<typeof grows.$inferInsert> = {};
      if (b.name)                          updates.name = b.name;
      if (b.status)                        updates.status = b.status;
      if (b.strain !== undefined)          updates.strain = b.strain ?? null;
      if (b.plantCount != null)            updates.plantCount = b.plantCount;
      if (b.startedAt)                     updates.startedAt = b.startedAt;
      if (b.completedAt)                   updates.completedAt = b.completedAt;
      if (b.plannedSeedlingWeeks != null)  updates.plannedSeedlingWeeks = b.plannedSeedlingWeeks;
      if (b.plannedVegWeeks != null)       updates.plannedVegWeeks = b.plannedVegWeeks;
      if (b.plannedFlowerWeeks != null)    updates.plannedFlowerWeeks = b.plannedFlowerWeeks;
      if (b.plannedFlushWeeks != null)     updates.plannedFlushWeeks = b.plannedFlushWeeks;
      // Filled at completion for the harvest report. Stored since the first
      // commit with no way to write them.
      if (b.actualSeedlingWeeks != null)   updates.actualSeedlingWeeks = b.actualSeedlingWeeks;
      if (b.actualVegWeeks != null)        updates.actualVegWeeks = b.actualVegWeeks;
      if (b.actualFlowerWeeks != null)     updates.actualFlowerWeeks = b.actualFlowerWeeks;
      if (b.actualFlushWeeks != null)      updates.actualFlushWeeks = b.actualFlushWeeks;
      if (b.techniques !== undefined)      updates.techniquesJson = JSON.stringify(b.techniques);
      if (b.wetWeightG != null)            updates.wetWeightG = b.wetWeightG;
      if (b.dryWeightG != null)            updates.dryWeightG = b.dryWeightG;
      if (b.rating != null)                updates.rating = b.rating;
      if (b.notesWorked !== undefined)     updates.notesWorked = b.notesWorked ?? null;
      if (b.notesChange !== undefined)     updates.notesChange = b.notesChange ?? null;
      if (b.abortReason)                   updates.abortReason = b.abortReason;
      if (b.abortNote !== undefined)       updates.abortNote = b.abortNote ?? null;

      if (Object.keys(updates).length > 0) {
        await db.update(grows).set(updates).where(eq(grows.id, growId));
      }

      // Sync workspace.activeGrowId with grow status
      if (b.status === "active") {
        await db.update(workspaces).set({ activeGrowId: growId }).where(eq(workspaces.id, workspaceId));
      } else if (b.status === "completed" || b.status === "aborted") {
        await db.update(workspaces).set({ activeGrowId: null }).where(eq(workspaces.id, workspaceId));
      }

      // Which stage the tent is in decides whether stage-scoped automations run
      // and which threshold band is in force, so starting, completing or
      // re-planning a grow has to take effect now rather than at the next
      // restart. Re-planning matters as much as starting: moving the veg weeks
      // moves the stage boundaries under everything scoped to them.
      await refreshActiveGrows();
      await refreshThresholds();

      const [row] = await db.select().from(grows).where(eq(grows.id, growId));
      if (!row) return reply.status(404).send(err("not_found", "Grow not found"));
      return reply.send(ok(rowToGrow(row)));
    },
  );

  // ── Milestones ──────────────────────────────────────────────────────────────
  // Planned points on the grow's day line ("flip to flower", "first pistils"),
  // ticked off as they happen. Listed on the Journal beside the notebook.

  type MilestoneParams = { workspaceId: string; growId: string };

  app.get<{ Params: MilestoneParams }>(
    "/workspaces/:workspaceId/grows/:growId/milestones",
    async (req, reply) => {
      if (!(await growIn(req.params.workspaceId, req.params.growId))) {
        return reply.status(404).send(err("not_found", "Grow not found"));
      }
      const rows = await db
        .select()
        .from(growMilestones)
        .where(eq(growMilestones.growId, req.params.growId))
        .orderBy(asc(growMilestones.day));
      return reply.send(ok(rows.map(rowToMilestone)));
    },
  );

  app.post<{ Params: MilestoneParams; Body: Partial<GrowMilestone> }>(
    "/workspaces/:workspaceId/grows/:growId/milestones",
    async (req, reply) => {
      if (!(await growIn(req.params.workspaceId, req.params.growId))) {
        return reply.status(404).send(err("not_found", "Grow not found"));
      }
      const label = req.body?.label?.trim();
      const day = req.body?.day;
      if (!label) return reply.status(400).send(err("validation_failed", "A milestone needs a label"));
      if (!isGrowDay(day)) {
        return reply.status(400).send(err("validation_failed", "A milestone needs a grow day of 1 or later"));
      }

      const id = randomUUID();
      const done = req.body.done === true;
      await db.insert(growMilestones).values({
        id,
        growId: req.params.growId,
        label,
        day,
        done,
        doneAt: done ? new Date().toISOString() : null,
      });
      const [row] = await db.select().from(growMilestones).where(eq(growMilestones.id, id));
      return reply.status(201).send(ok(rowToMilestone(row!)));
    },
  );

  app.patch<{ Params: MilestoneParams & { id: string }; Body: Partial<GrowMilestone> }>(
    "/workspaces/:workspaceId/grows/:growId/milestones/:id",
    async (req, reply) => {
      if (!(await growIn(req.params.workspaceId, req.params.growId))) {
        return reply.status(404).send(err("not_found", "Grow not found"));
      }
      const b = req.body ?? {};
      const updates: Partial<typeof growMilestones.$inferInsert> = {};
      if (b.label !== undefined) {
        if (!b.label.trim()) return reply.status(400).send(err("validation_failed", "A milestone needs a label"));
        updates.label = b.label.trim();
      }
      if (b.day !== undefined) {
        if (!isGrowDay(b.day)) {
          return reply.status(400).send(err("validation_failed", "A milestone needs a grow day of 1 or later"));
        }
        updates.day = b.day;
      }
      if (b.done !== undefined) {
        // doneAt follows done, so the two cannot disagree.
        updates.done = b.done;
        updates.doneAt = b.done ? new Date().toISOString() : null;
      }

      const where = and(eq(growMilestones.id, req.params.id), eq(growMilestones.growId, req.params.growId));
      if (Object.keys(updates).length > 0) await db.update(growMilestones).set(updates).where(where);
      const [row] = await db.select().from(growMilestones).where(where);
      if (!row) return reply.status(404).send(err("not_found", "Milestone not found"));
      return reply.send(ok(rowToMilestone(row)));
    },
  );

  app.delete<{ Params: MilestoneParams & { id: string } }>(
    "/workspaces/:workspaceId/grows/:growId/milestones/:id",
    async (req, reply) => {
      if (!(await growIn(req.params.workspaceId, req.params.growId))) {
        return reply.status(404).send(err("not_found", "Grow not found"));
      }
      const removed = await db
        .delete(growMilestones)
        .where(and(eq(growMilestones.id, req.params.id), eq(growMilestones.growId, req.params.growId)))
        .returning({ id: growMilestones.id });
      if (removed.length === 0) return reply.status(404).send(err("not_found", "Milestone not found"));
      return reply.send(ok({ deleted: true as const }));
    },
  );
}
