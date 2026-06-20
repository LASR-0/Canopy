/**
 * Shelly adapter.
 *
 * Handles two discovery surfaces:
 *  - mDNS: Shelly devices advertise on _http._tcp with hostnames like "shelly1-AABBCC"
 *  - MQTT: Shelly Gen 1 announces on shellies/announce; Gen 2 uses /rpc/Shelly.GetDeviceInfo
 */
import type { Device } from "@canopy/shared-types";

/** Shelly Gen 1 announce payload shape */
interface ShellyAnnounce {
  id: string;
  model: string;
  ip: string;
  fw_ver: string;
  new_fw?: boolean;
}

/** Maps Shelly model prefixes to capabilities */
const SHELLY_CAPS: Record<string, Device["capabilities"]> = {
  "shelly1":    [{ kind: "actuator", channel: "relay:0", actuator: "switch", variable: false, label: "Relay" }],
  "shelly2":    [{ kind: "actuator", channel: "relay:0", actuator: "switch", variable: false, label: "Relay 1" }, { kind: "actuator", channel: "relay:1", actuator: "switch", variable: false, label: "Relay 2" }],
  "shellydimmer": [{ kind: "actuator", channel: "light:0", actuator: "dimmer", variable: true, label: "Dimmer" }, { kind: "sensor", channel: "power", metric: "power", unit: "W" }],
  "shellyplug": [{ kind: "actuator", channel: "relay:0", actuator: "switch", variable: false, label: "Plug" }, { kind: "sensor", channel: "power", metric: "power", unit: "W" }],
  "shellyi3":   [{ kind: "sensor", channel: "input:0", metric: "power", unit: "W" }],
  "shellyht":   [{ kind: "sensor", channel: "temperature:0", metric: "temperature", unit: "C" }, { kind: "sensor", channel: "humidity:0", metric: "humidity", unit: "percent" }],
};

function capsForModel(model: string): Device["capabilities"] {
  const key = Object.keys(SHELLY_CAPS).find((k) => model.toLowerCase().startsWith(k));
  return key ? (SHELLY_CAPS[key] ?? []) : [];
}

/** Returns true if an mDNS hostname looks like a Shelly device */
export function isShellyHostname(hostname: string): boolean {
  return /^shelly/i.test(hostname);
}

/** Build a Device from an mDNS Shelly entry */
export function deviceFromShellyMdns(
  hostname: string,
  host: string,
  port: number,
  workspaceId: string,
): Omit<Device, "id"> {
  const model = hostname.split(".")[0] ?? hostname;
  return {
    workspaceId,
    name: hostname.split(".")[0] ?? hostname,
    family: "shelly",
    address: { protocol: "http" as const, host, port },
    model,
    capabilities: capsForModel(model),
    discoveredVia: "mdns" as const,
    online: true,
    runtimeHours: 0,
  };
}

/** Build a Device from a Shelly MQTT announce message */
export function deviceFromShellyAnnounce(
  raw: Buffer,
  workspaceId: string,
): Omit<Device, "id"> | null {
  let announce: ShellyAnnounce;
  try {
    announce = JSON.parse(raw.toString()) as ShellyAnnounce;
  } catch {
    return null;
  }
  if (!announce.id || !announce.model) return null;

  return {
    workspaceId,
    name: announce.id,
    family: "shelly",
    address: {
      protocol: "mqtt" as const,
      host: announce.ip,
      mqttTopicPrefix: `shellies/${announce.id}`,
    },
    model: announce.model,
    ...(announce.fw_ver ? { firmware: announce.fw_ver } : {}),
    capabilities: capsForModel(announce.model),
    discoveredVia: "mqtt-discovery" as const,
    online: true,
    runtimeHours: 0,
  };
}
