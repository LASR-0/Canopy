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
  // Clone: SHELLY_CAPS entries are shared module-level objects, and the MQTT
  // path below attaches per-device topics to them.
  return key ? (SHELLY_CAPS[key] ?? []).map((cap) => ({ ...cap })) : [];
}

/**
 * MQTT topics for one Shelly Gen 1 channel.
 *
 * A Shelly announce carries no topic list, unlike HA discovery, so these come
 * from the documented Gen 1 layout rather than from the device itself. Gen 2
 * (Plus/Pro) uses a different RPC-based scheme and is not covered here.
 */
function shellyTopics(channel: string, prefix: string): {
  stateTopic: string;
  commandTopic?: string;
} {
  const [kind, index = "0"] = channel.split(":");

  switch (kind) {
    case "relay":
      return {
        stateTopic: `${prefix}/relay/${index}`,
        commandTopic: `${prefix}/relay/${index}/command`,
      };
    case "light":
      return {
        stateTopic: `${prefix}/light/${index}`,
        commandTopic: `${prefix}/light/${index}/command`,
      };
    case "input":
      return { stateTopic: `${prefix}/input/${index}` };
    // Metered plugs and dimmers report consumption under the relay they meter.
    case "power":
      return { stateTopic: `${prefix}/relay/0/power` };
    case "temperature":
    case "humidity":
      return { stateTopic: `${prefix}/sensor/${kind}` };
    default:
      return { stateTopic: `${prefix}/${channel}` };
  }
}

/** Attach Gen 1 MQTT topics to each capability of an announce-discovered device. */
function withMqttTopics(
  caps: Device["capabilities"],
  prefix: string,
): Device["capabilities"] {
  return caps.map((cap) => {
    const { stateTopic, commandTopic } = shellyTopics(cap.channel, prefix);
    // Sensors have no command topic; only actuators accept one.
    if (cap.kind === "sensor") return { ...cap, stateTopic };
    return { ...cap, stateTopic, ...(commandTopic ? { commandTopic } : {}) };
  });
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

  const prefix = `shellies/${announce.id}`;

  return {
    workspaceId,
    name: announce.id,
    family: "shelly",
    address: {
      protocol: "mqtt" as const,
      host: announce.ip,
      mqttTopicPrefix: prefix,
    },
    model: announce.model,
    ...(announce.fw_ver ? { firmware: announce.fw_ver } : {}),
    capabilities: withMqttTopics(capsForModel(announce.model), prefix),
    discoveredVia: "mqtt-discovery" as const,
    online: true,
    runtimeHours: 0,
  };
}
