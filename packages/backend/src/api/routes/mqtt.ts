/**
 * The broker's shared credential and connection rules (Phase 8 F), for
 * Settings. Each device's own credential is under /devices (Phase 8 G).
 *
 * The password is returned as it is, because Settings shows it for typing into
 * a device. The API listens on loopback only, and anything on this machine can
 * already drive devices through it, so this exposes nothing new to it.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import type { MqttAuth, MqttBrokerPatch, MqttBrokerSettings } from "@canopy/shared-types";
import { db } from "../../store/index.js";
import { devices } from "../../store/schema.js";
import { applyAuthConfig, brokerBind, MQTT_PORT, rebindBroker } from "../../broker/index.js";
import { authConfig } from "../../broker/auth.js";
import {
  chooseBindHost,
  isBindable,
  loadAuthConfig,
  loadSharedCredential,
  loadBindSetting,
  localInterfaces,
  regenerateSharedPassword,
  saveBindSetting,
  saveRequireCredentials,
} from "../../broker/settings.js";
import { ok, err } from "../reply.js";

/** Devices in use whose last connection was this way. */
function devicesConnecting(how: MqttAuth) {
  return db
    .select({ id: devices.id, name: devices.name, workspaceId: devices.workspaceId })
    .from(devices)
    .where(and(eq(devices.mqttAuth, how), eq(devices.forgotten, false), isNull(devices.detachedAt)));
}

async function currentSettings(): Promise<MqttBrokerSettings> {
  const auth = authConfig();
  const bind = brokerBind();
  const setting = await loadBindSetting();
  const shared = await loadSharedCredential();

  return {
    username: shared.username,
    password: shared.password,
    requireCredentials: auth.requireCredentials,
    port: MQTT_PORT,
    bind: {
      host: bind.host,
      setting,
      envOverride: process.env["MQTT_HOST"] || null,
      ...(bind.unavailable ? { unavailable: bind.unavailable } : {}),
    },
    interfaces: localInterfaces(),
    devicesWithoutCredential: await devicesConnecting("anonymous"),
    devicesOnShared: await devicesConnecting("shared"),
  };
}

export async function mqttRoutes(app: FastifyInstance): Promise<void> {
  app.get("/mqtt", async (_req, reply) => reply.send(ok(await currentSettings())));

  app.patch<{ Body: MqttBrokerPatch }>("/mqtt", async (req, reply) => {
    const { requireCredentials, bindHost } = req.body ?? {};

    if (bindHost !== undefined) {
      if (bindHost !== null && typeof bindHost !== "string") {
        return reply.status(400).send(err("validation_failed", "bindHost must be an address or null"));
      }
      // Refused rather than saved and fallen back from: an address picked in
      // Settings should be one the broker can actually listen on.
      if (!isBindable(bindHost)) {
        return reply.status(400).send(err("validation_failed", `${bindHost} is not an address on this machine`));
      }
      await saveBindSetting(bindHost === "0.0.0.0" ? null : bindHost);
      const next = chooseBindHost(await loadBindSetting());
      // MQTT_HOST may pin it anyway, in which case nothing moves.
      if (next.host !== brokerBind().host) await rebindBroker(next);
    }

    if (requireCredentials !== undefined) {
      if (typeof requireCredentials !== "boolean") {
        return reply.status(400).send(err("validation_failed", "requireCredentials must be true or false"));
      }
      await saveRequireCredentials(requireCredentials);
      applyAuthConfig(await loadAuthConfig());
    }

    return reply.send(ok(await currentSettings()));
  });

  app.post("/mqtt/password", async (_req, reply) => {
    await regenerateSharedPassword();
    // Devices on the old password are dropped now, rather than at their next
    // reconnect, because a new password usually means the old one got out.
    applyAuthConfig(await loadAuthConfig());
    return reply.send(ok(await currentSettings()));
  });
}
