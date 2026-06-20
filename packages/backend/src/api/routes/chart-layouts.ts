import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../store/index.js";
import { chartLayouts } from "../../store/schema.js";
import { ok } from "../reply.js";
import type { ChartLayout } from "@canopy/shared-types";

function rowToLayout(row: typeof chartLayouts.$inferSelect): ChartLayout {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    metrics: JSON.parse(row.metricsJson) as ChartLayout["metrics"],
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export async function chartLayoutRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/chart-layouts",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(chartLayouts)
        .where(eq(chartLayouts.workspaceId, req.params.workspaceId));
      return reply.send(ok(rows.map(rowToLayout)));
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: Partial<ChartLayout> }>(
    "/workspaces/:workspaceId/chart-layouts",
    async (req, reply) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(chartLayouts).values({
        id,
        workspaceId: req.params.workspaceId,
        name: req.body.name ?? "Layout",
        metricsJson: JSON.stringify(req.body.metrics ?? []),
        sortOrder: req.body.sortOrder ?? 0,
        createdAt: now,
      });
      const [row] = await db.select().from(chartLayouts).where(eq(chartLayouts.id, id));
      return reply.status(201).send(ok(rowToLayout(row!)));
    },
  );

  app.delete<{ Params: { workspaceId: string; id: string } }>(
    "/workspaces/:workspaceId/chart-layouts/:id",
    async (req, reply) => {
      await db.delete(chartLayouts).where(
        and(eq(chartLayouts.id, req.params.id), eq(chartLayouts.workspaceId, req.params.workspaceId)),
      );
      return reply.send(ok({ deleted: true as const }));
    },
  );
}
