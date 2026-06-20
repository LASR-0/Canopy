import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../store/index.js";
import { sensorThresholds } from "../../store/schema.js";
import { ok } from "../reply.js";
import type { SensorThreshold } from "@canopy/shared-types";

function rowToThreshold(row: typeof sensorThresholds.$inferSelect): SensorThreshold {
  const t: SensorThreshold = {
    id: row.id,
    workspaceId: row.workspaceId,
    metric: row.metric as SensorThreshold["metric"],
    minValue: row.minValue,
    maxValue: row.maxValue,
    unit: row.unit as SensorThreshold["unit"],
  };
  if (row.stage) t.stage = row.stage as NonNullable<SensorThreshold["stage"]>;
  return t;
}

export async function thresholdRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/thresholds",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(sensorThresholds)
        .where(eq(sensorThresholds.workspaceId, req.params.workspaceId));
      return reply.send(ok(rows.map(rowToThreshold)));
    },
  );

  app.put<{ Params: { workspaceId: string; id: string }; Body: Partial<SensorThreshold> }>(
    "/workspaces/:workspaceId/thresholds/:id",
    async (req, reply) => {
      const { id, workspaceId } = req.params;
      const b = req.body;
      if (!b.metric || b.minValue == null || b.maxValue == null || !b.unit) {
        return reply.status(400).send({ ok: false, error: { code: "validation_failed", message: "metric, minValue, maxValue, unit required" } });
      }
      await db.insert(sensorThresholds).values({
        id,
        workspaceId,
        metric: b.metric,
        minValue: b.minValue,
        maxValue: b.maxValue,
        unit: b.unit,
        ...(b.stage ? { stage: b.stage } : {}),
      }).onConflictDoUpdate({
        target: sensorThresholds.id,
        set: { minValue: b.minValue, maxValue: b.maxValue, unit: b.unit, ...(b.stage ? { stage: b.stage } : {}) },
      });
      const [row] = await db.select().from(sensorThresholds).where(eq(sensorThresholds.id, id));
      return reply.send(ok(rowToThreshold(row!)));
    },
  );
}
