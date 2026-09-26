/**
 * Generic MQTT adapter — HA-style discovery.
 *
 * Any device that publishes to homeassistant/<type>/<id>/config is parsed here.
 * This covers ESPHome, Tasmota, and any other HA-compatible firmware out of the box.
 */
import type { ActuatorCapability, ActuatorCommand, Device } from "@canopy/shared-types";
import { cannotEncode, encoded, isValidLevel, type EncodeResult } from "./command.js";

/** Home Assistant's own defaults, used when the firmware declares nothing. */
const DEFAULT_PAYLOAD_ON = "ON";
const DEFAULT_PAYLOAD_OFF = "OFF";
const HA_DEFAULT_BRIGHTNESS_SCALE = 255;

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
  brightness_command_topic?: string;
  brightness_scale?: number;
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

  // Determine capability from component type.
  //
  // state_topic / command_topic are carried onto the capability rather than
  // dropped: they are how telemetry is later attributed back to this channel,
  // and HA firmware is free to use any topic it likes.
  const capabilities: Device["capabilities"] = [];

  const stateTopic = config.state_topic ? { stateTopic: config.state_topic } : {};
  const commandTopic = config.command_topic ? { commandTopic: config.command_topic } : {};

  // Switching payloads and the brightness channel are captured for the same
  // reason as the topics: the firmware chooses them, and a wrong guess fails
  // silently rather than erroring.
  const switching = {
    ...(config.payload_on ? { payloadOn: config.payload_on } : {}),
    ...(config.payload_off ? { payloadOff: config.payload_off } : {}),
    ...(config.brightness_command_topic
      ? { brightnessCommandTopic: config.brightness_command_topic }
      : {}),
    ...(typeof config.brightness_scale === "number"
      ? { brightnessScale: config.brightness_scale }
      : {}),
  };

  if (component === "sensor") {
    const mapped = SENSOR_COMPONENT_MAP[config.device_class ?? ""] ??
      SENSOR_COMPONENT_MAP[component] ??
      { metric: "temperature", unit: "C" };
    capabilities.push({
      kind: "sensor",
      channel: objectId,
      metric: mapped.metric as Device["capabilities"][number] extends { metric: infer M } ? M : never,
      unit: mapped.unit as Device["capabilities"][number] extends { unit: infer U } ? U : never,
      ...stateTopic,
    });
  } else if (component === "switch" || component === "light" || component === "fan") {
    capabilities.push({
      kind: "actuator",
      channel: objectId,
      actuator: component === "light" ? "light" : component === "fan" ? "fan" : "switch",
      variable: component === "light" && config.brightness === true,
      label: component === "switch" ? "Switch" : component === "light" ? "Light" : "Fan",
      ...stateTopic,
      ...commandTopic,
      ...switching,
    });
  } else if (component === "number") {
    capabilities.push({
      kind: "actuator",
      channel: objectId,
      actuator: "dimmer",
      variable: true,
      label: name,
      ...stateTopic,
      ...commandTopic,
      ...switching,
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

/**
 * Encode a command for a Home-Assistant-style actuator.
 *
 * On/off uses the payloads the firmware declared, defaulting to HA's own
 * "ON"/"OFF". Level has two shapes because firmware disagrees: Home Assistant
 * proper keeps brightness on its own topic with its own scale, while simpler
 * firmware — including Canopy's simulator — accepts a bare 0–100 level on the
 * ordinary command topic. The declared brightness topic wins when present.
 */
export function encodeGenericMqttCommand(
  cap: ActuatorCapability,
  command: ActuatorCommand,
): EncodeResult {
  if (command.op === "on" || command.op === "off") {
    if (!cap.commandTopic) return cannotEncode("no_command_topic");
    const payload = command.op === "on"
      ? (cap.payloadOn ?? DEFAULT_PAYLOAD_ON)
      : (cap.payloadOff ?? DEFAULT_PAYLOAD_OFF);
    return encoded(cap.commandTopic, payload);
  }

  if (!cap.variable) return cannotEncode("not_variable");
  if (!isValidLevel(command.value)) return cannotEncode("level_out_of_range");

  if (cap.brightnessCommandTopic) {
    const scale = cap.brightnessScale ?? HA_DEFAULT_BRIGHTNESS_SCALE;
    const scaled = Math.round((command.value / 100) * scale);
    return encoded(cap.brightnessCommandTopic, String(scaled));
  }

  if (!cap.commandTopic) return cannotEncode("no_command_topic");
  return encoded(cap.commandTopic, String(Math.round(command.value)));
}
