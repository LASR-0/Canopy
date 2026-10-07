/**
 * Which model draws a device in the 3D view. The one place to change when a
 * model is swapped, added or replaced by an asset.
 *
 * Chosen by role: a device's family is its firmware (Shelly, Tasmota, ESPHome),
 * which says nothing about its shape, while its role says what it is. A device
 * with no role is drawn as a plain block.
 */
import type { RoleKind } from "@canopy/shared-types";

export type ModelKind =
  | "inline_fan"
  | "clip_fan"
  | "led_light"
  | "sensor"
  | "light_sensor"
  | "co2_sensor"
  | "soil_probe"
  | "res_probe"
  | "smart_plug"
  | "reservoir_pump"
  | "humidifier"
  | "dehumidifier"
  | "heater"
  | "co2_tank"
  | "block";

/** How a model is held: hung from the roof bars on cords, or standing on its base. */
export type Mount = "hung" | "standing";

export interface ModelSpec {
  /** Height in cm, so a device mounted near the roof is kept inside the tent. */
  heightCm: number;
  mount: Mount;
}

/** Keyed by `RoleKind`, so a new role without a model is a compile error. */
const BY_ROLE: Record<RoleKind, ModelKind> = {
  canopy_temp: "sensor",
  canopy_rh: "sensor",
  canopy_light: "light_sensor",
  rootzone: "soil_probe",
  co2_probe: "co2_sensor",
  res_temp: "res_probe",
  res_ph: "res_probe",
  res_ec: "res_probe",
  power_draw: "smart_plug",
  exhaust: "inline_fan",
  intake: "inline_fan",
  circ: "clip_fan",
  light: "led_light",
  pump: "reservoir_pump",
  humidifier: "humidifier",
  dehumidifier: "dehumidifier",
  co2_valve: "co2_tank",
  heater: "heater",
};

export const MODEL_SPECS: Record<ModelKind, ModelSpec> = {
  inline_fan: { heightCm: 26, mount: "hung" },
  clip_fan: { heightCm: 32, mount: "standing" },
  led_light: { heightCm: 8, mount: "hung" },
  sensor: { heightCm: 8, mount: "hung" },
  light_sensor: { heightCm: 5, mount: "hung" },
  co2_sensor: { heightCm: 12, mount: "hung" },
  soil_probe: { heightCm: 20, mount: "standing" },
  res_probe: { heightCm: 18, mount: "standing" },
  smart_plug: { heightCm: 8, mount: "standing" },
  reservoir_pump: { heightCm: 50, mount: "standing" },
  humidifier: { heightCm: 27, mount: "standing" },
  dehumidifier: { heightCm: 51, mount: "standing" },
  heater: { heightCm: 58, mount: "standing" },
  co2_tank: { heightCm: 70, mount: "standing" },
  block: { heightCm: 12, mount: "standing" },
};

export function modelFor(role: RoleKind | undefined): ModelKind {
  return role ? BY_ROLE[role] : "block";
}
