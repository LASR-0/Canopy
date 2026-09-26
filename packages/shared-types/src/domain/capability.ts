/**
 * A capability is something a device can DO, detected at pairing time. A single
 * physical device may expose several (e.g. a sensor that reports temp + humidity,
 * or a plug that both switches and meters power).
 */

/** Quantities Canopy can read. Extend as adapters grow. */
export type Metric =
  | "temperature"
  | "humidity"
  | "co2"
  | "vpd"
  | "soil_moisture"
  | "ph"
  | "ec"
  | "lux"
  | "ppfd"
  | "power"
  | "water_level";

/** Display units, kept alongside readings so the UI never guesses. */
export type Unit =
  | "C"
  | "F"
  | "percent"
  | "ppm"
  | "kPa"
  | "pH"
  | "mS_cm"
  | "lux"
  | "umol_m2s"
  | "W"
  | "L";

/** Things a device can be told to do. */
export type ActuatorKind =
  | "switch" // on/off
  | "dimmer" // 0–100%
  | "pump"
  | "valve"
  | "fan"
  | "light";

/**
 * Where an MQTT capability lives on the broker.
 *
 * Discovery is the only moment these are known. HA-style firmware declares a
 * `state_topic` (and `command_topic`) per entity and they are arbitrary strings,
 * not a convention that can be reconstructed from a device id afterwards. A
 * topic that is not recorded here is telemetry the controller cannot attribute
 * to a device, so it gets discarded. Absent for HTTP devices.
 */
export interface MqttTopics {
  /** Topic this channel publishes its value on. */
  stateTopic?: string;
  /** Topic this channel accepts commands on. Actuators only. */
  commandTopic?: string;
}

export interface SensorCapability extends MqttTopics {
  kind: "sensor";
  /** Stable id unique within the device, e.g. "temp", "rh". */
  channel: string;
  metric: Metric;
  unit: Unit;
}

export interface ActuatorCapability extends MqttTopics {
  kind: "actuator";
  channel: string;
  actuator: ActuatorKind;
  /** True for dimmers/anything taking a 0–100 level rather than just on/off. */
  variable: boolean;
  /** Human-readable label from the device firmware e.g. "Relay", "Dimmer". */
  label?: string;
  /**
   * Exact payloads this channel expects to switch. Captured at discovery
   * because firmware is free to use "1"/"0" or "true"/"false" instead of the
   * Home Assistant defaults, and a wrong payload fails silently — the broker
   * accepts it and the device simply does nothing.
   */
  payloadOn?: string;
  payloadOff?: string;
  /**
   * Separate topic for level, when the firmware declares one. Home Assistant
   * keeps brightness off the on/off command topic; simpler firmware accepts a
   * bare level on the command topic instead.
   */
  brightnessCommandTopic?: string;
  /** Full-scale value for `brightnessCommandTopic`. Home Assistant defaults to 255. */
  brightnessScale?: number;
}

export type Capability = SensorCapability | ActuatorCapability;

/** A command sent to an actuator capability. */
export type ActuatorCommand =
  | { op: "on" }
  | { op: "off" }
  | { op: "level"; value: number }; // 0–100 for variable actuators
