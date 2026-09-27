import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
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


/**
 * When a task next falls due after being dealt with.
 *
 * Without this a completed daily task stays due forever: the row records that
 * it was done and nothing moves it forward, so the list keeps nagging and the
 * completion looks like it did not register.
 *
 * `stage` and `runtime` return null deliberately. A stage task is driven by the
 * grow moving on, not by a clock, and a runtime task needs accumulated device
 * hours, which nothing tracks yet. Both are left for whatever advances them
 * rather than being given a made-up date.
 */
export function nextDueAfter(
  task: Pick<MaintenanceTask, "cadence" | "intervalDays">,
  from: Date,
): string | null {
  const addDays = (days: number) =>
    new Date(from.getTime() + days * 86_400_000).toISOString();

  switch (task.cadence) {
    case "daily":
      return addDays(1);
    case "weekly":
      return addDays(task.intervalDays ?? 7);
    case "custom":
      return addDays(task.intervalDays ?? 1);
    case "stage":
    case "runtime":
      return null;
  }
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
      const [task] = await db
        .select()
        .from(maintenanceTasks)
        .where(eq(maintenanceTasks.id, req.params.id));

      const nextDue = task ? nextDueAfter(rowToTask(task), new Date(completedAt)) : null;

      await db
        .update(maintenanceTasks)
        .set({ lastDoneAt: completedAt, ...(nextDue ? { nextDueAt: nextDue } : {}) })
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

      // A skip still moves the task on. Leaving it due would mean skipping the
      // same task again tomorrow, and the day after.
      const [task] = await db
        .select()
        .from(maintenanceTasks)
        .where(eq(maintenanceTasks.id, req.params.id));
      const nextDue = task ? nextDueAfter(rowToTask(task), new Date(completedAt)) : null;
      if (nextDue) {
        await db
          .update(maintenanceTasks)
          .set({ nextDueAt: nextDue })
          .where(eq(maintenanceTasks.id, req.params.id));
      }

      return reply.status(201).send(ok(completion));
    },
  );

  /**
   * Completion history, newest first.
   *
   * The History view needs what was actually done and when, which the tasks
   * table cannot answer: a task carries only its last completion, so anything
   * done twice or skipped is invisible there.
   */
  app.get<{ Params: { workspaceId: string }; Querystring: { limit?: string } }>(
    "/workspaces/:workspaceId/maintenance/completions",
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const rows = await db
        .select()
        .from(maintenanceCompletions)
        .where(eq(maintenanceCompletions.workspaceId, req.params.workspaceId))
        .orderBy(desc(maintenanceCompletions.completedAt))
        .limit(limit);

      const completions: MaintenanceCompletion[] = rows.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        workspaceId: row.workspaceId,
        status: row.status as MaintenanceCompletion["status"],
        completedAt: row.completedAt,
        ...(row.growId ? { growId: row.growId } : {}),
        ...(row.growDay != null ? { growDay: row.growDay } : {}),
        ...(row.note ? { note: row.note } : {}),
      }));

      return reply.send(ok(completions));
    },
  );

  /** Remove a task. Its completion history is kept — it still happened. */
  app.delete<{ Params: { workspaceId: string; id: string } }>(
    "/workspaces/:workspaceId/maintenance/:id",
    async (req, reply) => {
      await db
        .delete(maintenanceTasks)
        .where(
          and(
            eq(maintenanceTasks.id, req.params.id),
            eq(maintenanceTasks.workspaceId, req.params.workspaceId),
          ),
        );
      return reply.send(ok({ deleted: true as const }));
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
