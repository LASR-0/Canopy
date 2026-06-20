import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../store/index.js";
import { readingsRaw, readingsHourly, readingsDaily } from "../../store/schema.js";
import { ok } from "../reply.js";
import type { Reading, ReadingSeriesQuery, ReadingSeries } from "@canopy/shared-types";

export async function readingsRoutes(app: FastifyInstance): Promise<void> {
  /** Latest reading per (deviceId, channel) for a workspace — used to hydrate the Overview on mount. */
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/readings/latest",
    async (req, reply) => {
      const { workspaceId } = req.params;
      const rows = await db
        .select()
        .from(readingsRaw)
        .where(
          sql`${readingsRaw.id} IN (
            SELECT MAX(id) FROM readings_raw
            WHERE workspace_id = ${workspaceId}
            GROUP BY device_id, channel
          )`,
        );
      const readings: Reading[] = rows.map((r) => ({
        workspaceId: r.workspaceId,
        deviceId: r.deviceId,
        channel: r.channel,
        metric: r.metric as Reading["metric"],
        unit: r.unit as Reading["unit"],
        value: r.value,
        ts: r.recordedAt,
      }));
      return reply.send(ok(readings));
    },
  );

  app.post<{ Body: ReadingSeriesQuery }>(
    "/readings/series",
    async (req, reply) => {
      const { workspaceId, metric, deviceId, from, to, resolution = "raw" } = req.body;

      const table =
        resolution === "hourly" ? readingsHourly
        : resolution === "daily" ? readingsDaily
        : readingsRaw;

      const conditions = [
        eq(table.workspaceId, workspaceId),
        eq(table.metric, metric),
        gte(table.recordedAt, from),
        lte(table.recordedAt, to),
        ...(deviceId ? [eq(table.deviceId, deviceId)] : []),
      ];

      const rows = await db.select().from(table).where(and(...conditions));

      const series: ReadingSeries = {
        metric,
        unit: (rows[0]?.unit ?? "C") as ReadingSeries["unit"],
        resolution,
        points: rows.map((r) => ({ ts: r.recordedAt, value: r.value })),
      };

      return reply.send(ok(series));
    },
  );
}
