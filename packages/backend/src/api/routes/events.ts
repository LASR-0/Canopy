import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
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

/** Most rows one request returns: the newest-first feed wants a page, a chart wants a window. */
const MAX_LIMIT = 1000;

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Timeline events, newest first.
   *
   * `from` / `to` bound the window by `occurred_at`, and `types` filters by a
   * comma-separated list. Without a window the chart could only ask for the
   * newest N events, so a week-long view showed the markers of the last few
   * hours and none of the rest.
   */
  app.get<{
    Params: { workspaceId: string };
    Querystring: { limit?: string; from?: string; to?: string; types?: string };
  }>(
    "/workspaces/:workspaceId/events",
    async (req, reply) => {
      const { limit: rawLimit, from, to, types } = req.query;
      const limit = Math.min(Math.max(1, Number(rawLimit ?? 50) || 50), MAX_LIMIT);
      const typeList = types ? types.split(",").map((t) => t.trim()).filter(Boolean) : [];

      const conditions = [eq(events.workspaceId, req.params.workspaceId)];
      if (from) conditions.push(gte(events.occurredAt, from));
      if (to) conditions.push(lte(events.occurredAt, to));
      if (typeList.length) conditions.push(inArray(events.type, typeList));

      const rows = await db
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(desc(events.occurredAt))
        .limit(limit);
      return reply.send(ok(rows.map(rowToEvent)));
    },
  );
}
