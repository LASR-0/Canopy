import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../store/index.js";
import { sensorThresholds, thresholdAlertSettings } from "../../store/schema.js";
import { ok, err } from "../reply.js";
import { refreshThresholds } from "../../rules/thresholds.js";
import {
  DEFAULT_ALERT_SETTING,
  alertSettingProblem,
  bandProblem,
  type AlertBehaviour,
  type GrowStageName,
  type Metric,
  type SensorThreshold,
  type ThresholdAlertSetting,
} from "@canopy/shared-types";

const STAGES: readonly GrowStageName[] = ["seedling", "vegetative", "flowering", "flush"];

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

function rowToAlertSetting(row: typeof thresholdAlertSettings.$inferSelect): ThresholdAlertSetting {
  return {
    workspaceId: row.workspaceId,
    metric: row.metric as Metric,
    enabled: row.enabled,
    warnMarginPct: row.warnMarginPct,
    delaySec: row.delaySec,
  };
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

  /**
   * Set the band for one metric and scope.
   *
   * Upserts by **(metric, stage)**, not by the id in the path. The table's
   * UNIQUE (workspace_id, stage, metric) does not protect the default band:
   * its stage is NULL, and SQLite treats NULLs as distinct, so two clients each
   * sending a fresh id would have stored two defaults for one metric — and
   * which one applied would depend on row order. The path id is used only when
   * the band is new.
   */
  app.put<{ Params: { workspaceId: string; id: string }; Body: Partial<SensorThreshold> }>(
    "/workspaces/:workspaceId/thresholds/:id",
    async (req, reply) => {
      const { id, workspaceId } = req.params;
      const b = req.body ?? {};
      if (!b.metric || b.minValue == null || b.maxValue == null || !b.unit) {
        return reply.status(400).send(err("validation_failed", "metric, minValue, maxValue and unit are required"));
      }
      const problem = bandProblem(b.minValue, b.maxValue);
      if (problem) return reply.status(400).send(err("validation_failed", problem));
      if (b.stage && !STAGES.includes(b.stage)) {
        return reply.status(400).send(err("validation_failed", `Unknown stage "${String(b.stage)}"`));
      }

      const scope = and(
        eq(sensorThresholds.workspaceId, workspaceId),
        eq(sensorThresholds.metric, b.metric),
        b.stage ? eq(sensorThresholds.stage, b.stage) : isNull(sensorThresholds.stage),
      );
      const [existing] = await db.select().from(sensorThresholds).where(scope);

      if (existing) {
        await db
          .update(sensorThresholds)
          .set({ minValue: b.minValue, maxValue: b.maxValue, unit: b.unit })
          .where(eq(sensorThresholds.id, existing.id));
      } else {
        await db.insert(sensorThresholds).values({
          id,
          workspaceId,
          metric: b.metric,
          minValue: b.minValue,
          maxValue: b.maxValue,
          unit: b.unit,
          stage: b.stage ?? null,
        });
      }
      // Alerts are judged against a cached copy, so a band the user just moved
      // has to take effect on the next reading rather than the next restart.
      await refreshThresholds();

      const [row] = await db.select().from(sensorThresholds).where(scope);
      return reply.send(ok(rowToThreshold(row!)));
    },
  );

  /**
   * Remove a band. For a stage override this is "clear override": the stage
   * falls back to the default. For a default it is "stop judging this metric".
   */
  app.delete<{ Params: { workspaceId: string; id: string } }>(
    "/workspaces/:workspaceId/thresholds/:id",
    async (req, reply) => {
      const removed = await db
        .delete(sensorThresholds)
        .where(and(eq(sensorThresholds.id, req.params.id), eq(sensorThresholds.workspaceId, req.params.workspaceId)))
        .returning({ id: sensorThresholds.id });
      if (removed.length === 0) return reply.status(404).send(err("not_found", "Target range not found"));
      await refreshThresholds();
      return reply.send(ok({ deleted: true as const }));
    },
  );

  // ── Alert behaviour ─────────────────────────────────────────────────────────

  /** Only metrics that differ from the default have a row; the rest use DEFAULT_ALERT_SETTING. */
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/threshold-alerts",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(thresholdAlertSettings)
        .where(eq(thresholdAlertSettings.workspaceId, req.params.workspaceId));
      return reply.send(ok(rows.map(rowToAlertSetting)));
    },
  );

  /** Change one metric's alert behaviour. Omitted fields keep their current value. */
  app.put<{ Params: { workspaceId: string; metric: string }; Body: Partial<AlertBehaviour> }>(
    "/workspaces/:workspaceId/threshold-alerts/:metric",
    async (req, reply) => {
      const { workspaceId, metric } = req.params;
      const b = req.body ?? {};
      const problem = alertSettingProblem(b);
      if (problem) return reply.status(400).send(err("validation_failed", problem));
      if (b.enabled !== undefined && typeof b.enabled !== "boolean") {
        return reply.status(400).send(err("validation_failed", "enabled must be true or false"));
      }

      const where = and(eq(thresholdAlertSettings.workspaceId, workspaceId), eq(thresholdAlertSettings.metric, metric));
      const [existing] = await db.select().from(thresholdAlertSettings).where(where);
      const next: AlertBehaviour = {
        enabled: b.enabled ?? existing?.enabled ?? DEFAULT_ALERT_SETTING.enabled,
        warnMarginPct: b.warnMarginPct ?? existing?.warnMarginPct ?? DEFAULT_ALERT_SETTING.warnMarginPct,
        delaySec: b.delaySec ?? existing?.delaySec ?? DEFAULT_ALERT_SETTING.delaySec,
      };

      await db
        .insert(thresholdAlertSettings)
        .values({ workspaceId, metric, ...next })
        .onConflictDoUpdate({ target: [thresholdAlertSettings.workspaceId, thresholdAlertSettings.metric], set: next });
      await refreshThresholds();

      const [row] = await db.select().from(thresholdAlertSettings).where(where);
      return reply.send(ok(rowToAlertSetting(row!)));
    },
  );

  /** Put a metric back on the default behaviour. */
  app.delete<{ Params: { workspaceId: string; metric: string } }>(
    "/workspaces/:workspaceId/threshold-alerts/:metric",
    async (req, reply) => {
      await db
        .delete(thresholdAlertSettings)
        .where(
          and(
            eq(thresholdAlertSettings.workspaceId, req.params.workspaceId),
            eq(thresholdAlertSettings.metric, req.params.metric),
          ),
        );
      await refreshThresholds();
      return reply.send(ok({ deleted: true as const }));
    },
  );
}
