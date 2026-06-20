/**
 * Generic MQTT adapter — HA-style discovery.
 *
 * Any device that publishes to homeassistant/<type>/<id>/config is parsed here.
 * This covers ESPHome, Tasmota, and any other HA-compatible firmware out of the box.
 */
import type { Device } from "@canopy/shared-types";
import { randomUUID } from "node:crypto";

/** HA discovery config payload (subset we care about). */
interface HaConfig {
  name?: string;
  unique_id?: string;
  state_topic?: string;
  command_topic?: string;
  unit_of_measurement?: string;
  device_class?: string;
  payload_on?: string;
  payload_off?: string;
  brightness?: boolean;
  device?: {
    identifiers?: string[];
    name?: string;
    model?: string;
    manufacturer?: string;
    sw_version?: string;
  };
}

/** HA component type → our metric/actuator kind mapping */
const SENSOR_COMPONENT_MAP: Record<string, { metric: string; unit: string }> = {
  temperature:  { metric: "temperature", unit: "C" },
  humidity:     { metric: "humidity",    unit: "percent" },
  co2:          { metric: "co2",         unit: "ppm" },
  moisture:     { metric: "soil_moisture", unit: "percent" },
  illuminance:  { metric: "lux",         unit: "lux" },
  power:        { metric: "power",       unit: "W" },
  ph:           { metric: "ph",          unit: "pH" },
  conductivity: { metric: "ec",          unit: "mS_cm" },
};

/**
 * Parses a HA-style MQTT discovery topic + payload into a Device.
 * Returns null if the topic/payload is not recognisable.
 */
export function parseHaDiscovery(
  topic: string,
  payload: Buffer,
  workspaceId: string,
): Omit<Device, "id"> | null {
  // homeassistant/<component>/<object_id>/config
  const match = topic.match(/^homeassistant\/([^/]+)\/([^/]+)\/config$/);
  if (!match) return null;

  const [, component, objectId] = match;
  if (!component || !objectId) return null;

  let config: HaConfig;
  try {
    config = JSON.parse(payload.toString()) as HaConfig;
  } catch {
    return null;
  }

  const deviceInfo = config.device;
  const name = config.name ?? deviceInfo?.name ?? objectId;
  const model = deviceInfo?.model ?? deviceInfo?.manufacturer ?? undefined;

  // Determine capability from component type
  const capabilities: Device["capabilities"] = [];

  if (component === "sensor") {
    const mapped = SENSOR_COMPONENT_MAP[config.device_class ?? ""] ??
      SENSOR_COMPONENT_MAP[component] ??
      { metric: "temperature", unit: "C" };
    capabilities.push({
      kind: "sensor",
      channel: objectId,
      metric: mapped.metric as Device["capabilities"][number] extends { metric: infer M } ? M : never,
      unit: mapped.unit as Device["capabilities"][number] extends { unit: infer U } ? U : never,
    });
  } else if (component === "switch" || component === "light" || component === "fan") {
    capabilities.push({
      kind: "actuator",
      channel: objectId,
      actuator: component === "light" ? "light" : component === "fan" ? "fan" : "switch",
      variable: component === "light" && config.brightness === true,
      label: component === "switch" ? "Switch" : component === "light" ? "Light" : "Fan",
    });
  } else if (component === "number") {
    capabilities.push({
      kind: "actuator",
      channel: objectId,
      actuator: "dimmer",
      variable: true,
      label: name,
    });
  }

  // Extract MQTT host from state_topic if available
  const topicPrefix = config.state_topic?.split("/").slice(0, 2).join("/");

  return {
    workspaceId,
    name,
    family: "generic-mqtt",
    address: {
      protocol: "mqtt" as const,
      ...(topicPrefix ? { mqttTopicPrefix: topicPrefix } : {}),
    },
    ...(model ? { model } : {}),
    ...(deviceInfo?.sw_version ? { firmware: deviceInfo.sw_version } : {}),
    capabilities,
    discoveredVia: "mqtt-discovery" as const,
    online: true,
    runtimeHours: 0,
  };
}
