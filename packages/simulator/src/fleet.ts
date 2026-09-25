/**
 * The simulated fleet.
 *
 * Each entry becomes one HA-discoverable device. Two constraints from the
 * backend shape this file, and both are easy to violate by accident:
 *
 *  1. `scan-session.upsertDevice` deduplicates MQTT devices by
 *     `mqttTopicPrefix`, and `parseHaDiscovery` derives that prefix from the
 *     FIRST TWO segments of `state_topic`. So every device needs a distinct
 *     second segment, or several devices collapse into one row. Hence
 *     `canopy/<objectId>/state` rather than a shared prefix.
 *
 *  2. `parseHaDiscovery` maps a sensor's capability from `device_class`, via
 *     SENSOR_COMPONENT_MAP in adapters/generic-mqtt.ts. A device_class outside
 *     that map silently falls back to temperature/C, so the classes below are
 *     chosen to match the map exactly.
 */

/** A drifting analogue sensor. */
export interface SensorSpec {
  kind: "sensor";
  /** Becomes the HA object_id, the capability channel, and the topic segment. */
  id: string;
  name: string;
  /** Must exist in SENSOR_COMPONENT_MAP or it degrades to temperature. */
  deviceClass: "temperature" | "humidity" | "co2" | "moisture" | "illuminance" | "power" | "ph" | "conductivity";
  unit: string;
  model: string;
  /** Resting value the walk reverts toward. */
  start: number;
  min: number;
  max: number;
  /** Max absolute step per tick before mean reversion. */
  drift: number;
  /** 0–1; how strongly the value is pulled back to `start`. */
  reversion: number;
  precision: number;
}

/** An on/off or variable actuator. */
export interface ActuatorSpec {
  kind: "actuator";
  id: string;
  name: string;
  /** Drives the HA component segment; parseHaDiscovery maps these three only. */
  component: "switch" | "light" | "fan";
  model: string;
  /** Marks the light as variable (dimmable) in the parsed capability. */
  brightness?: boolean;
  initialOn: boolean;
}

export type DeviceSpec = SensorSpec | ActuatorSpec;

export const MANUFACTURER = "Canopy Simulator";
export const SW_VERSION = "1.0.0-sim";

/**
 * A plausible single-tent fleet. Sensors are modelled as standalone probes
 * rather than one multi-channel board — see the dedup note above.
 */
export const FLEET: DeviceSpec[] = [
  {
    kind: "sensor", id: "canopy-temp", name: "Canopy Temperature",
    deviceClass: "temperature", unit: "°C", model: "SIM-TH10",
    start: 24.5, min: 16, max: 34, drift: 0.18, reversion: 0.04, precision: 1,
  },
  {
    kind: "sensor", id: "canopy-rh", name: "Canopy Humidity",
    deviceClass: "humidity", unit: "%", model: "SIM-TH10",
    start: 58, min: 25, max: 85, drift: 0.7, reversion: 0.05, precision: 1,
  },
  {
    kind: "sensor", id: "tent-co2", name: "Tent CO2",
    deviceClass: "co2", unit: "ppm", model: "SIM-CO2",
    start: 900, min: 400, max: 1600, drift: 18, reversion: 0.06, precision: 0,
  },
  {
    kind: "sensor", id: "rootzone-moisture", name: "Rootzone Moisture",
    deviceClass: "moisture", unit: "%", model: "SIM-SOIL",
    start: 46, min: 10, max: 90, drift: 0.4, reversion: 0.03, precision: 1,
  },
  {
    kind: "sensor", id: "res-ph", name: "Reservoir pH",
    deviceClass: "ph", unit: "pH", model: "SIM-HYDRO",
    start: 5.9, min: 4.5, max: 7.5, drift: 0.03, reversion: 0.05, precision: 2,
  },
  {
    kind: "sensor", id: "res-ec", name: "Reservoir EC",
    deviceClass: "conductivity", unit: "mS/cm", model: "SIM-HYDRO",
    start: 1.8, min: 0.4, max: 3.5, drift: 0.02, reversion: 0.05, precision: 2,
  },
  {
    kind: "sensor", id: "canopy-par", name: "Canopy Light Level",
    deviceClass: "illuminance", unit: "lx", model: "SIM-PAR",
    start: 42000, min: 0, max: 70000, drift: 450, reversion: 0.08, precision: 0,
  },
  {
    kind: "sensor", id: "light-power", name: "Light Power Draw",
    deviceClass: "power", unit: "W", model: "SIM-PLUG",
    start: 320, min: 0, max: 600, drift: 6, reversion: 0.1, precision: 0,
  },
  {
    kind: "actuator", id: "exhaust-fan", name: "Exhaust Fan",
    component: "fan", model: "SIM-FAN6", initialOn: true,
  },
  {
    kind: "actuator", id: "grow-light", name: "Grow Light",
    component: "light", model: "SIM-LED480", brightness: true, initialOn: true,
  },
  {
    kind: "actuator", id: "water-pump", name: "Water Pump",
    component: "switch", model: "SIM-PUMP", initialOn: false,
  },
];

/** Topic helpers — kept in one place so the dedup invariant stays visible. */
export const topics = {
  discovery: (component: string, id: string) => `homeassistant/${component}/${id}/config`,
  state: (id: string) => `canopy/${id}/state`,
  command: (id: string) => `canopy/${id}/set`,
};

/** HA component segment for a spec. */
export function componentOf(spec: DeviceSpec): string {
  return spec.kind === "sensor" ? "sensor" : spec.component;
}
