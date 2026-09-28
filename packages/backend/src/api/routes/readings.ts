import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../store/index.js";
import { devices, readingsRaw, readingsHourly, readingsDaily } from "../../store/schema.js";
import { ok } from "../reply.js";
import type {
  DeviceSeries,
  Reading,
  ReadingPoint,
  ReadingResolution,
  ReadingSeriesQuery,
  ReadingSeries,
} from "@canopy/shared-types";

/**
 * Longest span served at raw resolution.
 *
 * A tent samples every few seconds, so raw is thousands of points per hour and
 * per metric: a week is a few hundred thousand, which is a multi-megabyte
 * response the renderer cannot chart. Beyond this the request is served from the
 * rollups instead, and the response says which resolution was actually used.
 */
const MAX_RAW_SPAN_MS = 6 * 60 * 60 * 1000;

/**
 * Most points returned per line.
 *
 * A chart a few hundred pixels wide cannot show more, and the cost of the extra
 * points is paid in the payload and in the renderer. Well above the point count
 * of any rollup range, so in practice this only bites on raw.
 */
const MAX_POINTS_PER_SERIES = 2000;

/** The narrowest resolution that can serve a span without flooding the client. */
export function resolutionFor(
  requested: ReadingResolution,
  fromIso: string,
  toIso: string,
): ReadingResolution {
  if (requested !== "raw") return requested;

  const span = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(span) || span <= MAX_RAW_SPAN_MS) return requested;
  // Upgraded rather than refused: the caller wants this range charted, and a
  // coarser answer is useful where an error is not. `resolution` in the
  // response reports what was really used.
  return span > 30 * 24 * 60 * 60 * 1000 ? "daily" : "hourly";
}

/**
 * Reduce a line to at most `limit` points, keeping the first and last.
 *
 * Even-stride decimation. It is chosen over anything cleverer because the
 * extremes a naive stride would drop are already carried on each rollup point as
 * `min`/`max`, so the band stays honest even when the average line is thinned.
 * At raw resolution there are no extremes to lose — every point is a sample.
 */
export function decimate(points: ReadingPoint[], limit = MAX_POINTS_PER_SERIES): ReadingPoint[] {
  if (points.length <= limit) return points;

  const stride = (points.length - 1) / (limit - 1);
  const out: ReadingPoint[] = [];
  for (let i = 0; i < limit - 1; i++) out.push(points[Math.round(i * stride)]!);
  out.push(points[points.length - 1]!);
  return out;
}

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
      const { workspaceId, metric, deviceId, from, to } = req.body;
      const resolution = resolutionFor(req.body.resolution ?? "raw", from, to);

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

      // Ordered in SQL, not left to insertion order. Rollup rows are written by
      // a DELETE-then-INSERT whose order follows the GROUP BY, so a chart
      // connecting them as they came back drew a scribble rather than a line.
      const rows = await db
        .select()
        .from(table)
        .where(and(...conditions))
        .orderBy(asc(table.recordedAt));

      // Split per (device, channel): two sensors reporting one metric are two
      // claims about the tent, and flattening them interleaved the two into
      // swings that were an artefact of the merge.
      const byLine = new Map<string, { deviceId: string; channel: string; points: ReadingPoint[] }>();

      for (const row of rows) {
        const key = `${row.deviceId}:${row.channel}`;
        let line = byLine.get(key);
        if (!line) {
          line = { deviceId: row.deviceId, channel: row.channel, points: [] };
          byLine.set(key, line);
        }

        const point: ReadingPoint = { ts: row.recordedAt, value: row.value };
        // Raw rows have no extremes, and a rollup written before the min/max
        // columns existed has them as null.
        if ("minValue" in row && row.minValue != null) point.min = row.minValue;
        if ("maxValue" in row && row.maxValue != null) point.max = row.maxValue;
        line.points.push(point);
      }

      // Names resolved here so a legend needs no second request. One query for
      // the whole set rather than one per line.
      const ids = [...new Set([...byLine.values()].map((l) => l.deviceId))];
      const nameRows = ids.length
        ? await db
            .select({ id: devices.id, name: devices.name })
            .from(devices)
            .where(inArray(devices.id, ids))
        : [];
      const names = new Map(nameRows.map((r) => [r.id, r.name]));

      let downsampled = false;
      const series: DeviceSeries[] = [...byLine.values()].map((line) => {
        const points = decimate(line.points);
        if (points.length !== line.points.length) downsampled = true;
        return {
          deviceId: line.deviceId,
          // A forgotten device keeps its history; naming it by id beats a blank
          // legend entry.
          deviceName: names.get(line.deviceId) ?? line.deviceId,
          channel: line.channel,
          points,
        };
      });

      const result: ReadingSeries = {
        metric,
        unit: (rows[0]?.unit ?? "C") as ReadingSeries["unit"],
        resolution,
        devices: series,
        ...(downsampled ? { downsampled: true } : {}),
      };

      return reply.send(ok(result));
    },
  );
}
