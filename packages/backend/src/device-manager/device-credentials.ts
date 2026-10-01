/**
 * A device's own broker credential as the device card sees it, and handing it
 * to the device (Phase 8 G). The credentials themselves are broker/credentials.ts.
 */
import { eq } from "drizzle-orm";
import type { DeviceMqttCredential } from "@canopy/shared-types";
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import { brokerBind, MQTT_PORT } from "../broker/index.js";
import { brokerAddressFor } from "../broker/settings.js";
import { ensureDeviceCredential, type DeviceCredential } from "../broker/credentials.js";
import { lastPush, pushAndRecord } from "./shelly-push.js";

type DeviceRow = typeof devices.$inferSelect;

/** Only MQTT devices connect to the broker, so only they get a credential. */
export function needsCredential(row: Pick<DeviceRow, "protocol" | "detachedAt">): boolean {
  return row.protocol === "mqtt" && !row.detachedAt;
}

/** A Shelly whose address is known can be sent its credential over HTTP. */
function canPush(row: Pick<DeviceRow, "family" | "host">): boolean {
  return row.family === "shelly" && !!row.host;
}

export function credentialView(row: DeviceRow, credential: DeviceCredential): DeviceMqttCredential {
  const brokerHost = brokerAddressFor(row.host ?? undefined, brokerBind().host);
  const push = lastPush(row.id);
  return {
    username: credential.username,
    password: credential.password,
    ...(brokerHost ? { brokerHost } : {}),
    port: MQTT_PORT,
    canPush: canPush(row),
    ...(push ? { push } : {}),
  };
}

/** Send a Shelly its credential. Resolves when the attempt is over; the outcome is in `lastPush`. */
export async function pushCredential(row: DeviceRow, credential: DeviceCredential): Promise<void> {
  if (!canPush(row) || !row.host) return;
  const host = brokerAddressFor(row.host, brokerBind().host);
  if (!host) return;
  await pushAndRecord(row.id, {
    host: row.host,
    server: `${host}:${MQTT_PORT}`,
    username: credential.username,
    password: credential.password,
  });
}

/**
 * A device was just paired or found again: give it a credential if it has
 * none, and send it to a Shelly, so it needs no typing. Runs the push in the
 * background; a scan does not wait on a device's HTTP answer.
 */
export async function provisionPairedDevice(deviceId: string): Promise<void> {
  const [row] = await db.select().from(devices).where(eq(devices.id, deviceId));
  if (!row || !needsCredential(row)) return;
  const { created, ...credential } = await ensureDeviceCredential(deviceId);
  if (created) void pushCredential(row, credential);
}
