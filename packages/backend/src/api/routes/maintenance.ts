import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../store/index.js";
import { maintenanceTasks, maintenanceCompletions, maintenanceDayNotes } from "../../store/schema.js";
import { ok } from "../reply.js";
import type { MaintenanceTask, MaintenanceCompletion, MaintenanceDayNote } from "@canopy/shared-types";

function rowToTask(row: typeof maintenanceTasks.$inferSelect): MaintenanceTask {
  const t: MaintenanceTask = {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    cadence: row.cadence as MaintenanceTask["cadence"],
    groupTime: row.groupTime as MaintenanceTask["groupTime"],
    notifications: row.notifications,
  };
  if (row.intervalDays != null)         t.intervalDays = row.intervalDays;
  if (row.runtimeHoursInterval != null) t.runtimeHoursInterval = row.runtimeHoursInterval;
  if (row.seededBy)   t.seededBy = row.seededBy;
  if (row.deviceId)   t.deviceId = row.deviceId;
  if (row.nextDueAt)  t.nextDueAt = row.nextDueAt;
  if (row.lastDoneAt) t.lastDoneAt = row.lastDoneAt;
  return t;
}

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/maintenance",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(maintenanceTasks)
        .where(eq(maintenanceTasks.workspaceId, req.params.workspaceId));
      return reply.send(ok(rows.map(rowToTask)));
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: Partial<MaintenanceTask> }>(
    "/workspaces/:workspaceId/maintenance",
    async (req, reply) => {
      const id = randomUUID();
      const b = req.body;
      await db.insert(maintenanceTasks).values({
        id,
        workspaceId: req.params.workspaceId,
        name: b.name ?? "Untitled task",
        cadence: b.cadence ?? "daily",
        groupTime: b.groupTime ?? "today",
        notifications: b.notifications ?? true,
        createdAt: new Date().toISOString(),
        ...(b.intervalDays != null         ? { intervalDays: b.intervalDays }                 : {}),
        ...(b.runtimeHoursInterval != null ? { runtimeHoursInterval: b.runtimeHoursInterval } : {}),
        ...(b.seededBy  ? { seededBy: b.seededBy }   : {}),
        ...(b.deviceId  ? { deviceId: b.deviceId }   : {}),
        ...(b.nextDueAt ? { nextDueAt: b.nextDueAt } : {}),
      });
      const [row] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id));
      return reply.status(201).send(ok(rowToTask(row!)));
    },
  );

  app.patch<{ Params: { workspaceId: string; id: string }; Body: Partial<MaintenanceTask> }>(
    "/workspaces/:workspaceId/maintenance/:id",
    async (req, reply) => {
      const b = req.body;
      const updates: Partial<typeof maintenanceTasks.$inferInsert> = {};
      if (b.name)                          updates.name = b.name;
      if (b.cadence)                       updates.cadence = b.cadence;
      if (b.groupTime)                     updates.groupTime = b.groupTime;
      if (b.notifications != null)         updates.notifications = b.notifications;
      if (b.intervalDays != null)          updates.intervalDays = b.intervalDays;
      if (b.runtimeHoursInterval != null)  updates.runtimeHoursInterval = b.runtimeHoursInterval;
      if (b.nextDueAt !== undefined)        updates.nextDueAt = b.nextDueAt ?? null;
      if (Object.keys(updates).length > 0) {
        await db.update(maintenanceTasks).set(updates).where(eq(maintenanceTasks.id, req.params.id));
      }
      const [row] = await db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, req.params.id));
      return reply.send(ok(rowToTask(row!)));
    },
  );

  app.post<{ Params: { workspaceId: string; id: string }; Body: { note?: string } }>(
    "/workspaces/:workspaceId/maintenance/:id/complete",
    async (req, reply) => {
      const completedAt = new Date().toISOString();
      const completion: MaintenanceCompletion = {
        id: randomUUID(),
        taskId: req.params.id,
        workspaceId: req.params.workspaceId,
        status: "completed",
        completedAt,
      };
      await db.insert(maintenanceCompletions).values({
        ...completion,
        ...(req.body.note ? { note: req.body.note } : {}),
      });
      await db
        .update(maintenanceTasks)
        .set({ lastDoneAt: completedAt })
        .where(eq(maintenanceTasks.id, req.params.id));
      return reply.status(201).send(ok(completion));
    },
  );

  app.post<{ Params: { workspaceId: string; id: string }; Body: { note?: string } }>(
    "/workspaces/:workspaceId/maintenance/:id/skip",
    async (req, reply) => {
      const completedAt = new Date().toISOString();
      const completion: MaintenanceCompletion = {
        id: randomUUID(),
        taskId: req.params.id,
        workspaceId: req.params.workspaceId,
        status: "skipped",
        completedAt,
      };
      await db.insert(maintenanceCompletions).values({
        ...completion,
        ...(req.body.note ? { note: req.body.note } : {}),
      });
      return reply.status(201).send(ok(completion));
    },
  );

  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/maintenance/day-notes",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(maintenanceDayNotes)
        .where(eq(maintenanceDayNotes.workspaceId, req.params.workspaceId));
      const notes: MaintenanceDayNote[] = rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        date: r.date,
        note: r.note,
        ...(r.growId   ? { growId: r.growId }     : {}),
        ...(r.growDay != null ? { growDay: r.growDay } : {}),
      }));
      return reply.send(ok(notes));
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: Partial<MaintenanceDayNote> }>(
    "/workspaces/:workspaceId/maintenance/day-notes",
    async (req, reply) => {
      const id = randomUUID();
      const date = req.body.date ?? new Date().toISOString().slice(0, 10);
      await db.insert(maintenanceDayNotes).values({
        id,
        workspaceId: req.params.workspaceId,
        date,
        note: req.body.note ?? "",
        ...(req.body.growId   ? { growId: req.body.growId }     : {}),
        ...(req.body.growDay != null ? { growDay: req.body.growDay } : {}),
      });
      const [row] = await db.select().from(maintenanceDayNotes).where(eq(maintenanceDayNotes.id, id));
      return reply.status(201).send(ok({
        id: row!.id,
        workspaceId: row!.workspaceId,
        date: row!.date,
        note: row!.note,
      } satisfies MaintenanceDayNote));
    },
  );
}
