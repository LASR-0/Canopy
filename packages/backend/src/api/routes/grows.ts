import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ok, err } from "../reply.js";
import type { GrowCycle, GrowTemplate } from "@canopy/shared-types";
import { db } from "../../store/index.js";
import { grows, growTemplates, workspaces } from "../../store/schema.js";

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

      const [row] = await db.select().from(grows).where(eq(grows.id, growId));
      if (!row) return reply.status(404).send(err("not_found", "Grow not found"));
      return reply.send(ok(rowToGrow(row)));
    },
  );

  app.get<{ Params: { workspaceId: string; growId: string } }>(
    "/workspaces/:workspaceId/grows/:growId/milestones",
    async (_req, reply) => reply.send(ok([])),
  );

  app.post<{ Params: { workspaceId: string; growId: string }; Body: unknown }>(
    "/workspaces/:workspaceId/grows/:growId/milestones",
    async (req, reply) => reply.status(201).send(ok({ id: randomUUID(), growId: req.params.growId, label: "", day: 1, done: false })),
  );

  app.patch<{ Params: { workspaceId: string; growId: string; id: string }; Body: unknown }>(
    "/workspaces/:workspaceId/grows/:growId/milestones/:id",
    async (req, reply) => reply.send(ok({ id: req.params.id, growId: req.params.growId, label: "", day: 1, done: false })),
  );
}
