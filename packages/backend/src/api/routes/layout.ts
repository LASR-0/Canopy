import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../store/index.js";
import { devicePlacements, devices, plants, workspaces } from "../../store/schema.js";
import { ok, err } from "../reply.js";
import {
  DEFAULT_POT_LITRES,
  type DevicePlacement,
  type EnclosureDimensions,
  type PlaceDeviceBody,
  type Plant,
  type PlantBody,
} from "@canopy/shared-types";
import { resolvePlacement, resolvePlant } from "../../layout/index.js";

function rowToPlacement(row: typeof devicePlacements.$inferSelect): DevicePlacement {
  return {
    workspaceId: row.workspaceId,
    deviceId: row.deviceId,
    xCm: row.xCm,
    yCm: row.yCm,
    zCm: row.zCm,
    rotationDeg: row.rotationDeg,
  };
}

function rowToPlant(row: typeof plants.$inferSelect): Plant {
  const p: Plant = {
    id: row.id,
    workspaceId: row.workspaceId,
    xCm: row.xCm,
    yCm: row.yCm,
    potLitres: row.potLitres,
    createdAt: row.createdAt,
  };
  if (row.label) p.label = row.label;
  return p;
}

/**
 * The tent's dimensions, or why there are none.
 *
 * Nothing can be placed before the tent has a size: a position is only
 * meaningful against the walls it is measured from.
 */
async function enclosureOf(workspaceId: string): Promise<EnclosureDimensions | "no_workspace" | "no_dimensions"> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) return "no_workspace";
  if (ws.widthCm == null || ws.depthCm == null || ws.heightCm == null) return "no_dimensions";
  return { widthCm: ws.widthCm, depthCm: ws.depthCm, heightCm: ws.heightCm };
}

const NO_WORKSPACE = err("not_found", "Workspace not found");
const NO_DIMENSIONS = err("conflict", "Set the tent's dimensions before placing anything in it");

type WsParams = { workspaceId: string };

export async function layoutRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Everything in the tent, in one request — the Setup View needs all of it to
   * draw anything.
   *
   * Placements of forgotten devices are left out. The row survives, so a device
   * re-adopted later comes back where it was mounted.
   */
  app.get<{ Params: WsParams }>(
    "/workspaces/:workspaceId/layout",
    async (req, reply) => {
      const { workspaceId } = req.params;
      const placementRows = await db
        .select({ placement: devicePlacements })
        .from(devicePlacements)
        .innerJoin(devices, eq(devices.id, devicePlacements.deviceId))
        .where(and(eq(devicePlacements.workspaceId, workspaceId), eq(devices.forgotten, false)));
      const plantRows = await db
        .select()
        .from(plants)
        .where(eq(plants.workspaceId, workspaceId))
        .orderBy(asc(plants.createdAt));
      return reply.send(
        ok({
          placements: placementRows.map((r) => rowToPlacement(r.placement)),
          plants: plantRows.map(rowToPlant),
        }),
      );
    },
  );

  /** Place a device, or move one already placed. Omitted fields keep their value. */
  app.put<{ Params: WsParams & { deviceId: string }; Body: PlaceDeviceBody }>(
    "/workspaces/:workspaceId/placements/:deviceId",
    async (req, reply) => {
      const { workspaceId, deviceId } = req.params;
      const dims = await enclosureOf(workspaceId);
      if (dims === "no_workspace") return reply.status(404).send(NO_WORKSPACE);
      if (dims === "no_dimensions") return reply.status(409).send(NO_DIMENSIONS);

      const [device] = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.workspaceId, workspaceId), eq(devices.forgotten, false)));
      if (!device) return reply.status(404).send(err("not_found", "Device not found in this workspace"));

      const where = and(eq(devicePlacements.workspaceId, workspaceId), eq(devicePlacements.deviceId, deviceId));
      const [existing] = await db.select().from(devicePlacements).where(where);

      const position = resolvePlacement(existing, req.body ?? {}, dims);
      if (typeof position === "string") return reply.status(400).send(err("validation_failed", position));

      await db
        .insert(devicePlacements)
        .values({ workspaceId, deviceId, ...position })
        .onConflictDoUpdate({ target: [devicePlacements.workspaceId, devicePlacements.deviceId], set: position });

      const [row] = await db.select().from(devicePlacements).where(where);
      return reply.send(ok(rowToPlacement(row!)));
    },
  );

  /** Take a device off the plan. The device itself is untouched. */
  app.delete<{ Params: WsParams & { deviceId: string } }>(
    "/workspaces/:workspaceId/placements/:deviceId",
    async (req, reply) => {
      const removed = await db
        .delete(devicePlacements)
        .where(
          and(
            eq(devicePlacements.workspaceId, req.params.workspaceId),
            eq(devicePlacements.deviceId, req.params.deviceId),
          ),
        )
        .returning({ deviceId: devicePlacements.deviceId });
      if (removed.length === 0) return reply.status(404).send(err("not_found", "Device is not placed"));
      return reply.send(ok({ deleted: true as const }));
    },
  );

  app.post<{ Params: WsParams; Body: PlantBody }>(
    "/workspaces/:workspaceId/plants",
    async (req, reply) => {
      const { workspaceId } = req.params;
      const dims = await enclosureOf(workspaceId);
      if (dims === "no_workspace") return reply.status(404).send(NO_WORKSPACE);
      if (dims === "no_dimensions") return reply.status(409).send(NO_DIMENSIONS);

      const plant = resolvePlant(undefined, req.body ?? {}, dims, DEFAULT_POT_LITRES);
      if (typeof plant === "string") return reply.status(400).send(err("validation_failed", plant));

      const id = randomUUID();
      await db.insert(plants).values({ id, workspaceId, ...plant, createdAt: new Date().toISOString() });
      const [row] = await db.select().from(plants).where(eq(plants.id, id));
      return reply.status(201).send(ok(rowToPlant(row!)));
    },
  );

  app.patch<{ Params: WsParams & { plantId: string }; Body: PlantBody }>(
    "/workspaces/:workspaceId/plants/:plantId",
    async (req, reply) => {
      const { workspaceId, plantId } = req.params;
      const dims = await enclosureOf(workspaceId);
      if (dims === "no_workspace") return reply.status(404).send(NO_WORKSPACE);
      if (dims === "no_dimensions") return reply.status(409).send(NO_DIMENSIONS);

      const where = and(eq(plants.id, plantId), eq(plants.workspaceId, workspaceId));
      const [existing] = await db.select().from(plants).where(where);
      if (!existing) return reply.status(404).send(err("not_found", "Plant not found"));

      const plant = resolvePlant(existing, req.body ?? {}, dims, existing.potLitres);
      if (typeof plant === "string") return reply.status(400).send(err("validation_failed", plant));

      await db.update(plants).set(plant).where(where);
      const [row] = await db.select().from(plants).where(where);
      return reply.send(ok(rowToPlant(row!)));
    },
  );

  app.delete<{ Params: WsParams & { plantId: string } }>(
    "/workspaces/:workspaceId/plants/:plantId",
    async (req, reply) => {
      const removed = await db
        .delete(plants)
        .where(and(eq(plants.id, req.params.plantId), eq(plants.workspaceId, req.params.workspaceId)))
        .returning({ id: plants.id });
      if (removed.length === 0) return reply.status(404).send(err("not_found", "Plant not found"));
      return reply.send(ok({ deleted: true as const }));
    },
  );
}
