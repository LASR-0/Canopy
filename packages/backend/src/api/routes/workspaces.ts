import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../store/index.js";
import { workspaces, roleAssignments, appSettings } from "../../store/schema.js";
import { ok, err } from "../reply.js";
import type { Workspace, RoleAssignment } from "@canopy/shared-types";

function rowToWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  const w: Workspace = {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    archived: row.archived,
    timezone: row.timezone,
  };
  if (row.widthCm != null && row.depthCm != null && row.heightCm != null) {
    w.dimensions = { widthCm: row.widthCm, depthCm: row.depthCm, heightCm: row.heightCm };
  }
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
      if (req.body.dimensions) {
        updates.widthCm  = req.body.dimensions.widthCm;
        updates.depthCm  = req.body.dimensions.depthCm;
        updates.heightCm = req.body.dimensions.heightCm;
      }
      if (Object.keys(updates).length > 0) {
        await db.update(workspaces).set(updates).where(eq(workspaces.id, workspaceId));
      }
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
