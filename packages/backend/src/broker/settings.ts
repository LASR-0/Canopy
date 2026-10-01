/**
 * The broker's settings as stored: the credentials, whether devices need one,
 * and where to listen. Apart from auth.ts, which decides with them and
 * stays free of the database.
 */
import { networkInterfaces } from "node:os";
import { eq, isNull } from "drizzle-orm";
import type { MqttInterface } from "@canopy/shared-types";
import { db } from "../store/index.js";
import { appSettings, mqttCredentials } from "../store/schema.js";
import { generateMqttPassword } from "../store/ddl.js";
import type { AuthConfig, BrokerCredential } from "./auth.js";

/** Every credential, the shared one and each device's own, and whether one is required. */
export async function loadAuthConfig(): Promise<AuthConfig> {
  const [settings] = await db.select({ require: appSettings.mqttRequireCredentials }).from(appSettings).where(eq(appSettings.id, 1));
  const rows = await db
    .select({ username: mqttCredentials.username, password: mqttCredentials.password, deviceId: mqttCredentials.deviceId })
    .from(mqttCredentials);
  return {
    credentials: rows.map(({ username, password, deviceId }): BrokerCredential =>
      deviceId ? { username, password, deviceId } : { username, password }),
    requireCredentials: settings?.require ?? true,
  };
}

/** The credential every device may use, for Settings. */
export async function loadSharedCredential(): Promise<{ username: string; password: string }> {
  const [shared] = await db.select().from(mqttCredentials).where(isNull(mqttCredentials.deviceId));
  return { username: shared?.username ?? "", password: shared?.password ?? "" };
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

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return parts.reduce((n, p) => n * 256 + p, 0);
}

/**
 * The address a device at `deviceIp` should be told to reach the broker on:
 * the one the broker is pinned to, if it is; otherwise this machine's IPv4
 * address on the device's own subnet; otherwise the first IPv4 address.
 * Undefined when there is none, which leaves the device to be told by hand.
 */
export function brokerAddressFor(
  deviceIp: string | undefined,
  boundHost: string,
  interfaces: { address: string; netmask: string; family: string; internal: boolean }[] =
    Object.values(networkInterfaces()).flat().filter((i) => i !== undefined),
): string | undefined {
  if (boundHost !== ALL_INTERFACES && boundHost !== "::") return boundHost;
  const v4 = interfaces.filter((i) => i.family === "IPv4" && !i.internal);
  const device = deviceIp ? ipv4ToInt(deviceIp) : null;
  if (device !== null) {
    const same = v4.find((i) => {
      const address = ipv4ToInt(i.address);
      const mask = ipv4ToInt(i.netmask);
      return address !== null && mask !== null && ((address & mask) >>> 0) === ((device & mask) >>> 0);
    });
    if (same) return same.address;
    // A device on this machine (the simulator) reaches it on loopback.
    if (deviceIp === "127.0.0.1") return deviceIp;
  }
  return v4[0]?.address;
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
