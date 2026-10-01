/**
 * Per-device broker credentials (Tier 3 MQTT hardening, Phase 8 G).
 *
 * Every MQTT device gets its own credential when it is paired, beside the
 * shared one (Phase 8 F). Both let a device connect; a device's own may
 * publish only that device's topics (acl.ts), so one leaked device credential
 * cannot feed readings to another device.
 *
 * Forgetting a device revokes its credential. That is safe: forgetting does
 * not unplug the hardware, and the command-topic ACL keeps its command topics
 * closed regardless. Paired again, it gets a new one.
 *
 * Every change here is applied to the broker at once, so a client on a
 * credential that no longer exists, or on an old password, is disconnected.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../store/index.js";
import { mqttCredentials } from "../store/schema.js";
import { generateMqttPassword } from "../store/ddl.js";
import { applyAuthConfig } from "./index.js";
import { loadAuthConfig } from "./settings.js";

export interface DeviceCredential {
  username: string;
  password: string;
}

/**
 * A username for one device: `canopy-` and 8 hex characters. Random rather
 * than the device's name, which is not unique, may change, and would tell
 * anyone listening which device is which.
 */
function deviceUsername(): string {
  return `canopy-${randomBytes(4).toString("hex")}`;
}

async function reloadBroker(): Promise<void> {
  applyAuthConfig(await loadAuthConfig());
}

export async function deviceCredential(deviceId: string): Promise<DeviceCredential | undefined> {
  const [row] = await db
    .select({ username: mqttCredentials.username, password: mqttCredentials.password })
    .from(mqttCredentials)
    .where(eq(mqttCredentials.deviceId, deviceId));
  return row;
}

/** The device's credential, created when it has none. `created` says which. */
export async function ensureDeviceCredential(deviceId: string): Promise<DeviceCredential & { created: boolean }> {
  const existing = await deviceCredential(deviceId);
  if (existing) return { ...existing, created: false };

  // 32 bits of username space: a clash is unlikely, and retried if it happens.
  for (let attempt = 0; ; attempt++) {
    const credential = { username: deviceUsername(), password: generateMqttPassword() };
    try {
      await db.insert(mqttCredentials).values({ id: randomUUID(), ...credential, deviceId, createdAt: new Date().toISOString() });
      await reloadBroker();
      return { ...credential, created: true };
    } catch (err) {
      if (attempt >= 3) throw err;
    }
  }
}

/** A new password for one device. Its clients on the old one are dropped. */
export async function regenerateDevicePassword(deviceId: string): Promise<DeviceCredential> {
  const { created, ...credential } = await ensureDeviceCredential(deviceId);
  if (created) return credential;
  const password = generateMqttPassword();
  await db.update(mqttCredentials).set({ password }).where(eq(mqttCredentials.deviceId, deviceId));
  await reloadBroker();
  return { username: credential.username, password };
}

/** Revoke these devices' credentials, when they are forgotten. Their clients are dropped. */
export async function revokeDeviceCredentials(deviceIds: readonly string[]): Promise<void> {
  if (deviceIds.length === 0) return;
  await db.delete(mqttCredentials).where(and(isNotNull(mqttCredentials.deviceId), inArray(mqttCredentials.deviceId, [...deviceIds])));
  await reloadBroker();
}
