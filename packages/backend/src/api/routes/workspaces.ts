import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../store/index.js";
import { workspaces, roleAssignments, appSettings, devicePlacements, plants } from "../../store/schema.js";
import { ok, err } from "../reply.js";
import { dimensionsProblem, type EnclosureDimensions, type Workspace, type RoleAssignment } from "@canopy/shared-types";
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
    archived: row.archived,
    timezone: row.timezone,
  };
  const dimensions = dimensionsOf(row);
  if (dimensions) w.dimensions = dimensions;
  if (row.activeGrowId != null) w.activeGrowId = row.activeGrowId;
  return w;
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/workspaces", async (_req, reply) => {
    const rows = await db.select().from(workspaces).where(eq(workspaces.archived, false));
    return reply.send(ok(rows.map(rowToWorkspace)));
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
        archived: false,
        timezone: timezone ?? "UTC",
      });
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
      return reply.status(201).send(ok(rowToWorkspace(row!)));
    },
  );

  /** Update workspace name, timezone, or dimensions */
  app.patch<{
    Params: { workspaceId: string };
    Body: Partial<Pick<Workspace, "name" | "timezone" | "dimensions">>;
  }>(
    "/workspaces/:workspaceId",
    async (req, reply) => {
      const { workspaceId } = req.params;
      const updates: Partial<typeof workspaces.$inferInsert> = {};
      if (req.body.name)     updates.name = req.body.name;
      if (req.body.timezone) updates.timezone = req.body.timezone;

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

      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      if (!row) return reply.status(404).send(err("not_found", "Workspace not found"));
      return reply.send(ok(rowToWorkspace(row)));
    },
  );

  /** Archive (soft-delete) a workspace */
  app.delete<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId",
    async (req, reply) => {
      const { workspaceId } = req.params;
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      if (!row) return reply.status(404).send(err("not_found", "Workspace not found"));
      await db.update(workspaces).set({ archived: true }).where(eq(workspaces.id, workspaceId));
      // If this was the active workspace, clear the active workspace setting
      await db.update(appSettings)
        .set({ activeWorkspaceId: null })
        .where(and(eq(appSettings.id, 1), eq(appSettings.activeWorkspaceId, workspaceId)));
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
