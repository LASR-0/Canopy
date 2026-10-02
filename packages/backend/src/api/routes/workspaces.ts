import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, sqliteConnection } from "../../store/index.js";
import { GROW_ARCHIVE_DIR, PHOTO_DIR } from "../../store/paths.js";
import { reloadWorkspaceCaches } from "../../controller/reload.js";
import {
  WorkspaceStateError,
  archiveWorkspace,
  deleteWorkspace,
  purgeAt,
  purgeWorkspace,
  restoreWorkspace,
} from "../../workspaces/lifecycle.js";
import { workspaces, roleAssignments, devicePlacements, plants } from "../../store/schema.js";
import { ok, err } from "../reply.js";
import { GROW_LIGHT_TYPES, dimensionsProblem, type EnclosureDimensions, type Workspace, type RoleAssignment } from "@canopy/shared-types";
import { growLightOf, refreshDliSources } from "../../device-manager/dli.js";
import { dimensionsChanged, rescalePlacement, rescalePlant } from "../../layout/index.js";

function dimensionsOf(row: typeof workspaces.$inferSelect): EnclosureDimensions | undefined {
  if (row.widthCm == null || row.depthCm == null || row.heightCm == null) return undefined;
  return { widthCm: row.widthCm, depthCm: row.depthCm, heightCm: row.heightCm };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Move everything in the tent to the same proportional spot in its new size.
 *
 * Proportional, as decided for the Setup View: a light hung dead centre stays
 * dead centre, and nothing ends up outside a tent that shrank. Positions stay
 * within a few centimetres of where they physically were, which is the point.
 */
function rescaleLayout(tx: Tx, workspaceId: string, from: EnclosureDimensions, to: EnclosureDimensions): void {
  const placed = tx.select().from(devicePlacements).where(eq(devicePlacements.workspaceId, workspaceId)).all();
  for (const p of placed) {
    const { xCm, yCm, zCm } = rescalePlacement(p, from, to);
    tx.update(devicePlacements)
      .set({ xCm, yCm, zCm })
      .where(and(eq(devicePlacements.workspaceId, workspaceId), eq(devicePlacements.deviceId, p.deviceId)))
      .run();
  }
  const planted = tx.select().from(plants).where(eq(plants.workspaceId, workspaceId)).all();
  for (const p of planted) {
    const { xCm, yCm } = rescalePlant(p, from, to);
    tx.update(plants).set({ xCm, yCm }).where(eq(plants.id, p.id)).run();
  }
}

function rowToWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  const w: Workspace = {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    timezone: row.timezone,
    growLight: growLightOf(row),
  };
  if (row.archivedAt) w.archivedAt = row.archivedAt;
  if (row.deletedAt) {
    w.deletedAt = row.deletedAt;
    w.purgeAt = purgeAt(row.deletedAt);
  }
  const dimensions = dimensionsOf(row);
  if (dimensions) w.dimensions = dimensions;
  if (row.activeGrowId != null) w.activeGrowId = row.activeGrowId;
  return w;
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/workspaces", async (_req, reply) => {
    const rows = await db.select().from(workspaces).where(and(isNull(workspaces.archivedAt), isNull(workspaces.deletedAt)));
    return reply.send(ok(rows.map(rowToWorkspace)));
  });

  /** Archived and recently deleted workspaces, newest first. */
  app.get("/workspaces/stored", async (_req, reply) => {
    const archived = await db.select().from(workspaces)
      .where(and(isNotNull(workspaces.archivedAt), isNull(workspaces.deletedAt)))
      .orderBy(desc(workspaces.archivedAt));
    const deleted = await db.select().from(workspaces)
      .where(isNotNull(workspaces.deletedAt))
      .orderBy(desc(workspaces.deletedAt));
    return reply.send(ok({ archived: archived.map(rowToWorkspace), deleted: deleted.map(rowToWorkspace) }));
  });

  /**
   * Archive, restore and delete change which workspaces the controller acts
   * for, so the caches are reloaded after. Null when the change was refused
   * and the error has been sent.
   */
  async function change<T>(reply: FastifyReply, fn: () => T | Promise<T>): Promise<{ value: T } | null> {
    try {
      const value = await fn();
      await reloadWorkspaceCaches();
      return { value };
    } catch (e) {
      if (!(e instanceof WorkspaceStateError)) throw e;
      await reply.status(e.notFound ? 404 : 409).send(err(e.notFound ? "not_found" : "conflict", e.message));
      return null;
    }
  }

  const current = async (id: string) =>
    rowToWorkspace((await db.select().from(workspaces).where(eq(workspaces.id, id)))[0]!);

  app.post<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/archive", async (req, reply) => {
    const done = await change(reply, () => archiveWorkspace(sqliteConnection, req.params.workspaceId));
    if (!done) return reply;
    return reply.send(ok(await current(req.params.workspaceId)));
  });

  app.post<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/restore", async (req, reply) => {
    const done = await change(reply, () => restoreWorkspace(sqliteConnection, req.params.workspaceId));
    if (!done) return reply;
    return reply.send(ok({ workspace: await current(req.params.workspaceId), detachedDevices: done.value.detachedDevices }));
  });

  /** For good, now, rather than after 7 days. Only from Recently deleted. */
  app.delete<{ Params: { workspaceId: string } }>("/workspaces/:workspaceId/permanent", async (req, reply) => {
    const done = await change(reply, () => purgeWorkspace(sqliteConnection, PHOTO_DIR, req.params.workspaceId, GROW_ARCHIVE_DIR));
    if (!done) return reply;
    return reply.send(ok({ deleted: true as const }));
  });

  app.post<{ Body: { name: string; timezone?: string } }>(
    "/workspaces",
    async (req, reply) => {
      const { name, timezone } = req.body;
      if (!name?.trim()) {
        return reply.status(400).send(err("validation_failed", "name is required"));
      }
      const id = randomUUID();
      await db.insert(workspaces).values({
        id,
        name: name.trim(),
        createdAt: new Date().toISOString(),
        timezone: timezone ?? "UTC",
      });
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
      return reply.status(201).send(ok(rowToWorkspace(row!)));
    },
  );

  /** Update workspace name, timezone, or dimensions */
  app.patch<{
    Params: { workspaceId: string };
    Body: Partial<Pick<Workspace, "name" | "timezone" | "dimensions" | "growLight">>;
  }>(
    "/workspaces/:workspaceId",
    async (req, reply) => {
      const { workspaceId } = req.params;
      const updates: Partial<typeof workspaces.$inferInsert> = {};
      if (req.body.name)     updates.name = req.body.name;
      if (req.body.timezone) updates.timezone = req.body.timezone;
      const light = req.body.growLight;
      if (light) {
        if (!GROW_LIGHT_TYPES.includes(light.type)) {
          return reply.status(400).send(err("validation_failed", `growLight.type must be one of ${GROW_LIGHT_TYPES.join(", ")}`));
        }
        if (light.type === "custom" && !(typeof light.luxToPpfd === "number" && light.luxToPpfd > 0 && light.luxToPpfd < 1)) {
          return reply.status(400).send(err("validation_failed", "A custom grow light needs a lux-to-PPFD factor between 0 and 1"));
        }
        updates.growLight = light.type;
        updates.luxToPpfd = light.type === "custom" ? light.luxToPpfd : null;
      }

      const [current] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      if (!current) return reply.status(404).send(err("not_found", "Workspace not found"));

      const next = req.body.dimensions;
      if (next) {
        const problem = dimensionsProblem(next);
        if (problem) return reply.status(400).send(err("validation_failed", problem));
        // Whole centimetres: the columns are integers, and nobody measures a
        // tent to the millimetre.
        updates.widthCm  = Math.round(next.widthCm);
        updates.depthCm  = Math.round(next.depthCm);
        updates.heightCm = Math.round(next.heightCm);
      }

      const from = dimensionsOf(current);
      const to = next
        ? { widthCm: updates.widthCm!, depthCm: updates.depthCm!, heightCm: updates.heightCm! }
        : undefined;

      // One transaction: the tent and everything in it move together, so a
      // failure part-way cannot leave pins scaled to a size the tent never took.
      db.transaction((tx) => {
        if (Object.keys(updates).length > 0) {
          tx.update(workspaces).set(updates).where(eq(workspaces.id, workspaceId)).run();
        }
        if (from && to && dimensionsChanged(from, to)) rescaleLayout(tx, workspaceId, from, to);
      });

      // DLI follows the timezone (where a day starts) and the grow light (how
      // lux converts), so either change restarts today's running total.
      if (updates.timezone || light) await refreshDliSources();

      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      if (!row) return reply.status(404).send(err("not_found", "Workspace not found"));
      return reply.send(ok(rowToWorkspace(row)));
    },
  );

  /** Move to Recently deleted, restorable for 7 days. */
  app.delete<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId",
    async (req, reply) => {
      const done = await change(reply, () => deleteWorkspace(sqliteConnection, req.params.workspaceId));
      if (!done) return reply;
      return reply.send(ok({ deleted: true as const }));
    },
  );

  /** List role assignments for a workspace */
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/roles",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(roleAssignments)
        .where(eq(roleAssignments.workspaceId, req.params.workspaceId));
      const result: RoleAssignment[] = rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        role: r.role as RoleAssignment["role"],
        deviceId: r.deviceId,
        channel: r.channel,
      }));
      return reply.send(ok(result));
    },
  );
}
