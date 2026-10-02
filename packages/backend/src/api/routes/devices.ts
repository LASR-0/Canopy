import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../store/index.js";
import { devices, roleAssignments } from "../../store/schema.js";
import { ok, err } from "../reply.js";
import { startScan, refreshDeviceTopics } from "../../device-manager/index.js";
import { refreshDerivedRoles } from "../../device-manager/derived.js";
import { actuateDevice, validateCommand } from "../../device-manager/actuate.js";
import { actuatorStates } from "../../device-manager/actuator-state.js";
import { ensureDeviceCredential, regenerateDevicePassword, revokeDeviceCredentials } from "../../broker/credentials.js";
import { credentialView, needsCredential, pushCredential } from "../../device-manager/device-credentials.js";
import type { ActuateBody, ApiErrorCode, Device, MqttAuth, RoleAssignment } from "@canopy/shared-types";

/**
 * How an actuation failure reaches the client.
 *
 * `device_unreachable` is 503 rather than 400: the request was well formed and
 * may succeed once the broker or the device is back, so a caller is right to
 * retry it.
 */
const STATUS_FOR_ERROR: Record<ApiErrorCode, number> = {
  not_found: 404,
  validation_failed: 400,
  device_unreachable: 503,
  conflict: 409,
  controller_paused: 409,
  internal: 500,
};

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
  if (row.mqttAuth)          device.mqttAuth = row.mqttAuth as MqttAuth;
  if (row.signalPct != null) device.signalPct = row.signalPct;
  if (row.detachedAt)        device.detachedAt = row.detachedAt;
  if (row.discoveryKey)      device.discoveryKey = row.discoveryKey;
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
      const forgotten = await db
        .update(devices)
        .set({ online: false, forgotten: true })
        .where(eq(devices.workspaceId, req.params.workspaceId))
        .returning({ id: devices.id });
      // Forgotten devices are excluded from the index, so their telemetry stops
      // being recorded. Their command topics stay closed — forgetting a device
      // does not unplug it. See broker/acl.ts.
      await refreshDeviceTopics();
      // Their own broker credentials go, and anything connected with one is
      // dropped. Paired again, a device gets a new one.
      await revokeDeviceCredentials(forgotten.map((d) => d.id));
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
      // Before the row: its credential would go with it (ON DELETE CASCADE),
      // but the broker would not hear of it.
      await revokeDeviceCredentials([req.params.deviceId]);
      await db.delete(devices).where(eq(devices.id, req.params.deviceId));
      await refreshDeviceTopics();
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
      // Derived metrics resolve their inputs by role, so assigning the canopy
      // temperature or humidity role is what starts VPD being computed.
      await refreshDerivedRoles();

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
      await refreshDerivedRoles();
      return reply.send(ok({ deleted: true as const }));
    },
  );

  /**
   * Drive one actuator channel.
   *
   * 202 rather than 200: the command has been published to the broker, which
   * is not the same as the device having acted on it. Confirmation arrives
   * separately, when the device echoes its state on the state topic.
   */
  app.post<{ Params: { deviceId: string }; Body: ActuateBody }>(
    "/devices/:deviceId/actuate",
    async (req, reply) => {
      const { command, channel } = req.body ?? {};

      if (!validateCommand(command)) {
        return reply
          .status(400)
          .send(err("validation_failed", 'command must be {op:"on"}, {op:"off"} or {op:"level",value:0-100}'));
      }
      if (channel !== undefined && typeof channel !== "string") {
        return reply.status(400).send(err("validation_failed", "channel must be a string"));
      }

      const result = await actuateDevice(req.params.deviceId, command, channel);

      if (!result.ok) {
        return reply.status(STATUS_FOR_ERROR[result.code]).send(err(result.code, result.message));
      }

      app.log.info(
        { deviceId: req.params.deviceId, channel: result.channel, topic: result.sent.topic },
        "actuator command published",
      );
      return reply.status(202).send(ok({ accepted: true as const }));
    },
  );

  /** What each actuator channel last reported: the echo the 202 above waits on. */
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/actuators/state",
    async (req, reply) => reply.send(ok(actuatorStates(req.params.workspaceId))),
  );

  // ── The device's own broker credential (Phase 8 G) ─────────────────────────

  /** A device that can have a credential, or the reply saying why not. */
  async function credentialDevice(deviceId: string) {
    const [row] = await db.select().from(devices).where(eq(devices.id, deviceId));
    if (!row) return { error: [404, err("not_found", "Device not found")] as const };
    if (row.forgotten) return { error: [404, err("not_found", "Device not found")] as const };
    if (!needsCredential(row)) {
      return { error: [400, err("validation_failed", "Only an MQTT device in use connects to the broker")] as const };
    }
    return { row };
  }

  /** Created here if it has none: a device paired before Phase 8 G gets one on first look. */
  app.get<{ Params: { deviceId: string } }>("/devices/:deviceId/mqtt", async (req, reply) => {
    const found = await credentialDevice(req.params.deviceId);
    if ("error" in found) return reply.status(found.error[0]).send(found.error[1]);
    const { created: _created, ...credential } = await ensureDeviceCredential(found.row.id);
    return reply.send(ok(credentialView(found.row, credential)));
  });

  app.post<{ Params: { deviceId: string } }>("/devices/:deviceId/mqtt/password", async (req, reply) => {
    const found = await credentialDevice(req.params.deviceId);
    if ("error" in found) return reply.status(found.error[0]).send(found.error[1]);
    const credential = await regenerateDevicePassword(found.row.id);
    return reply.send(ok(credentialView(found.row, credential)));
  });

  /** Waits for the device's answer (a few seconds at most), so the card can say how it went. */
  app.post<{ Params: { deviceId: string } }>("/devices/:deviceId/mqtt/push", async (req, reply) => {
    const found = await credentialDevice(req.params.deviceId);
    if ("error" in found) return reply.status(found.error[0]).send(found.error[1]);
    if (found.row.family !== "shelly" || !found.row.host) {
      return reply.status(400).send(err("validation_failed", "Only a Shelly with a known address can be sent its credential"));
    }
    const { created: _created, ...credential } = await ensureDeviceCredential(found.row.id);
    await pushCredential(found.row, credential);
    return reply.send(ok(credentialView(found.row, credential)));
  });
}
