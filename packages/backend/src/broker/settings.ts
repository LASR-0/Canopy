/**
 * The broker's settings as stored: the shared credential, whether devices need
 * it, and where to listen. Apart from auth.ts, which decides with them and
 * stays free of the database.
 */
import { networkInterfaces } from "node:os";
import { eq, isNull } from "drizzle-orm";
import type { MqttInterface } from "@canopy/shared-types";
import { db } from "../store/index.js";
import { appSettings, mqttCredentials } from "../store/schema.js";
import { generateMqttPassword } from "../store/ddl.js";
import type { AuthConfig } from "./auth.js";

export async function loadAuthConfig(): Promise<AuthConfig> {
  const [settings] = await db.select({ require: appSettings.mqttRequireCredentials }).from(appSettings).where(eq(appSettings.id, 1));
  const [shared] = await db.select().from(mqttCredentials).where(isNull(mqttCredentials.deviceId));
  return {
    username: shared?.username ?? "",
    password: shared?.password ?? "",
    requireCredentials: settings?.require ?? true,
  };
}

export async function loadBindSetting(): Promise<string | null> {
  const [settings] = await db.select({ host: appSettings.mqttBindHost }).from(appSettings).where(eq(appSettings.id, 1));
  return settings?.host ?? null;
}

export async function saveRequireCredentials(require: boolean): Promise<void> {
  await db.update(appSettings).set({ mqttRequireCredentials: require }).where(eq(appSettings.id, 1));
}

export async function saveBindSetting(host: string | null): Promise<void> {
  await db.update(appSettings).set({ mqttBindHost: host }).where(eq(appSettings.id, 1));
}

/** A new password for the shared credential. Returns it. */
export async function regenerateSharedPassword(): Promise<string> {
  const password = generateMqttPassword();
  await db.update(mqttCredentials).set({ password }).where(isNull(mqttCredentials.deviceId));
  return password;
}

/** Every address on this machine a device could reach, loopback excluded. */
export function localInterfaces(): MqttInterface[] {
  const list: MqttInterface[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      list.push({ name, address: entry.address, family: entry.family === "IPv6" ? "IPv6" : "IPv4" });
    }
  }
  return list;
}

/** Every interface, IPv4 and IPv6. */
export const ALL_INTERFACES = "0.0.0.0";

export interface BindChoice {
  host: string;
  /** The address asked for, when it is not on this machine. */
  unavailable?: string;
}

/**
 * Where the broker listens. MQTT_HOST wins over the setting, so a service file
 * can pin it whatever Settings says.
 *
 * An address that is no longer on the machine (a DHCP lease changed, a USB
 * adapter unplugged) falls back to every interface rather than failing: a
 * broker that does not start takes every device offline, which for a grow
 * controller is the worse failure. The fallback is logged and shown in
 * Settings.
 */
export function chooseBindHost(
  setting: string | null,
  envOverride: string | undefined = process.env["MQTT_HOST"],
  available: string[] = localInterfaces().map((i) => i.address),
): BindChoice {
  const wanted = envOverride || setting;
  if (!wanted || wanted === ALL_INTERFACES || wanted === "::") return { host: wanted || ALL_INTERFACES };
  // Loopback is always there; useful for a controller that only serves itself.
  if (wanted === "127.0.0.1" || wanted === "::1" || available.includes(wanted)) return { host: wanted };
  return { host: ALL_INTERFACES, unavailable: wanted };
}

/** Whether Settings may ask for this address: every interface, or one that is on this machine. */
export function isBindable(host: string | null): boolean {
  return host === null || host === ALL_INTERFACES || host === "127.0.0.1" || localInterfaces().some((i) => i.address === host);
}
