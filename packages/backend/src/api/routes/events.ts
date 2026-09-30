import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db, sqliteConnection } from "../../store/index.js";
import { events } from "../../store/schema.js";
import { err, ok } from "../reply.js";
import { logsFor } from "../../logs/index.js";
import type { AppEvent } from "@canopy/shared-types";
import { eventMetric } from "../../events/metric.js";

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
  const metric = eventMetric(row);
  if (metric)          e.metric = metric;
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
    Querystring: { limit?: string; from?: string; to?: string; before?: string; types?: string };
  }>(
    "/workspaces/:workspaceId/events",
    async (req, reply) => {
      const { limit: rawLimit, from, to, before, types } = req.query;
      const limit = Math.min(Math.max(1, Number(rawLimit ?? 50) || 50), MAX_LIMIT);
      const typeList = types ? types.split(",").map((t) => t.trim()).filter(Boolean) : [];

      const conditions = [eq(events.workspaceId, req.params.workspaceId)];
      if (from) conditions.push(gte(events.occurredAt, from));
      if (to) conditions.push(lte(events.occurredAt, to));
      // Paging: the next page of a newest-first list starts below its last row.
      if (before) conditions.push(lt(events.occurredAt, before));
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

  /**
   * The Logs tab: out-of-range periods overlapping the window, and the other
   * problems in it. The window defaults to the last 24 hours.
   */
  app.get<{ Params: { workspaceId: string }; Querystring: { from?: string; to?: string } }>(
    "/workspaces/:workspaceId/logs",
    async (req, reply) => {
      const to = req.query.to ?? new Date().toISOString();
      const from = req.query.from ?? new Date(Date.parse(to) - 86_400_000).toISOString();
      if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) {
        return reply.status(400).send(err("validation_failed", "from and to must be ISO timestamps, from before to"));
      }
      return reply.send(ok(logsFor(sqliteConnection, req.params.workspaceId, from, to)));
    },
  );
}
