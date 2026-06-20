import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../store/index.js";
import { devices, roleAssignments } from "../../store/schema.js";
import { ok, err } from "../reply.js";
import { startScan } from "../../device-manager/index.js";
import type { Device, RoleAssignment } from "@canopy/shared-types";

function rowToDevice(row: typeof devices.$inferSelect): Device {
  const device: Device = {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    family: row.family as Device["family"],
    address: { protocol: row.protocol as Device["address"]["protocol"] },
    capabilities: JSON.parse(row.capabilitiesJson) as Device["capabilities"],
    discoveredVia: row.discoveredVia as Device["discoveredVia"],
    online: row.online,
    runtimeHours: row.runtimeHours,
  };
  if (row.host)              device.address.host = row.host;
  if (row.port != null)      device.address.port = row.port;
  if (row.mqttTopicPrefix)   device.address.mqttTopicPrefix = row.mqttTopicPrefix;
  if (row.model)             device.model = row.model;
  if (row.firmware)          device.firmware = row.firmware;
  if (row.lastSeen)          device.lastSeen = row.lastSeen;
  if (row.signalPct != null) device.signalPct = row.signalPct;
  return device;
}

function rowToRole(row: typeof roleAssignments.$inferSelect): RoleAssignment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    role: row.role as RoleAssignment["role"],
    deviceId: row.deviceId,
    channel: row.channel,
  };
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  /** List all non-forgotten devices for a workspace */
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/devices",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(devices)
        .where(and(eq(devices.workspaceId, req.params.workspaceId), eq(devices.forgotten, false)));
      return reply.send(ok(rows.map(rowToDevice)));
    },
  );

  /** Mark all workspace devices as forgotten (hidden from UI, not deleted) */
  app.post<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/devices/forget-all",
    async (req, reply) => {
      await db
        .update(devices)
        .set({ online: false, forgotten: true })
        .where(eq(devices.workspaceId, req.params.workspaceId));
      return reply.send(ok({ forgotten: true as const }));
    },
  );

  /** Rename or update a device */
  app.patch<{ Params: { deviceId: string }; Body: { name?: string } }>(
    "/devices/:deviceId",
    async (req, reply) => {
      const { deviceId } = req.params;
      if (req.body.name) {
        await db.update(devices).set({ name: req.body.name }).where(eq(devices.id, deviceId));
      }
      const [row] = await db.select().from(devices).where(eq(devices.id, deviceId));
      if (!row) return reply.status(404).send(err("not_found", "Device not found"));
      return reply.send(ok(rowToDevice(row)));
    },
  );

  /** Remove a device */
  app.delete<{ Params: { deviceId: string } }>(
    "/devices/:deviceId",
    async (req, reply) => {
      await db.delete(devices).where(eq(devices.id, req.params.deviceId));
      return reply.send(ok({ deleted: true as const }));
    },
  );

  /** Start a network scan */
  app.post<{ Params: { workspaceId: string }; Body: { includeSubnetSweep?: boolean } }>(
    "/workspaces/:workspaceId/scan",
    async (req, reply) => {
      const scanId = await startScan(req.params.workspaceId);
      return reply.status(202).send(ok({ scanId }));
    },
  );

  /** Assign a device capability to a grow role */
  app.post<{
    Params: { workspaceId: string };
    Body: { role: RoleAssignment["role"]; deviceId: string; channel: string };
  }>(
    "/workspaces/:workspaceId/roles",
    async (req, reply) => {
      const { role, deviceId, channel } = req.body;
      if (!role || !deviceId || !channel) {
        return reply.status(400).send(err("validation_failed", "role, deviceId and channel required"));
      }
      // One role per device — replace any existing assignment for this device
      await db.delete(roleAssignments).where(
        and(eq(roleAssignments.workspaceId, req.params.workspaceId), eq(roleAssignments.deviceId, deviceId)),
      );
      const id = randomUUID();
      await db.insert(roleAssignments).values({
        id,
        workspaceId: req.params.workspaceId,
        deviceId,
        role,
        channel,
      });
      const [row] = await db.select().from(roleAssignments).where(eq(roleAssignments.id, id));
      return reply.status(201).send(ok(rowToRole(row!)));
    },
  );

  /** Unassign a role */
  app.delete<{ Params: { workspaceId: string; roleId: string } }>(
    "/workspaces/:workspaceId/roles/:roleId",
    async (req, reply) => {
      await db.delete(roleAssignments).where(
        and(
          eq(roleAssignments.id, req.params.roleId),
          eq(roleAssignments.workspaceId, req.params.workspaceId),
        ),
      );
      return reply.send(ok({ deleted: true as const }));
    },
  );

  /** Actuate a device (Phase 6 stub — adapter layer sends real command) */
  app.post<{ Params: { deviceId: string }; Body: unknown }>(
    "/devices/:deviceId/actuate",
    async (_req, reply) => reply.send(ok({ accepted: true as const })),
  );
}
