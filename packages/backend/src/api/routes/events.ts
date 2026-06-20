import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../../store/index.js";
import { events } from "../../store/schema.js";
import { ok } from "../reply.js";
import type { AppEvent } from "@canopy/shared-types";

function rowToEvent(row: typeof events.$inferSelect): AppEvent {
  const e: AppEvent = {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type as AppEvent["type"],
    description: row.description,
    occurredAt: row.occurredAt,
  };
  if (row.growId)      e.growId = row.growId;
  if (row.sourceId)    e.sourceId = row.sourceId;
  if (row.sourceLabel) e.sourceLabel = row.sourceLabel;
  if (row.severity)    e.severity = row.severity as NonNullable<AppEvent["severity"]>;
  return e;
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string }; Querystring: { limit?: string } }>(
    "/workspaces/:workspaceId/events",
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const rows = await db
        .select()
        .from(events)
        .where(eq(events.workspaceId, req.params.workspaceId))
        .orderBy(desc(events.occurredAt))
        .limit(limit);
      return reply.send(ok(rows.map(rowToEvent)));
    },
  );
}
