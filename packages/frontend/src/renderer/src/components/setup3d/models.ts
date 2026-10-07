/**
 * Which model draws a device in the 3D view. The one place to change when a
 * model is swapped, added or replaced by an asset.
 *
 * Chosen by role: a device's family is its firmware (Shelly, Tasmota, ESPHome),
 * which says nothing about its shape, while its role says what it is. A device
 * with no role is drawn as a plain block.
 */
import type { EnclosureDimensions, RoleKind } from "@canopy/shared-types";

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
  /**
   * Width (x) and depth (z) in its own frame, in cm, so a device placed hard
   * against a wall is drawn standing against it, not through it. Ducts and
   * cords are left out: they are meant to reach the walls and roof.
   */
  footprintCm: [number, number];
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
  inline_fan: { heightCm: 26, mount: "hung", footprintCm: [26, 30] },
  clip_fan: { heightCm: 34, mount: "standing", footprintCm: [26, 16] },
  // The panel's footprint follows the tent; see `ledPanelSize`.
  led_light: { heightCm: 8, mount: "hung", footprintCm: [0, 0] },
  sensor: { heightCm: 8, mount: "hung", footprintCm: [8, 3] },
  light_sensor: { heightCm: 5, mount: "hung", footprintCm: [7, 7] },
  co2_sensor: { heightCm: 12, mount: "hung", footprintCm: [8, 4] },
  soil_probe: { heightCm: 20, mount: "standing", footprintCm: [5, 3] },
  res_probe: { heightCm: 18, mount: "standing", footprintCm: [14, 4] },
  smart_plug: { heightCm: 11, mount: "standing", footprintCm: [30, 9] },
  reservoir_pump: { heightCm: 50, mount: "standing", footprintCm: [34, 34] },
  humidifier: { heightCm: 27, mount: "standing", footprintCm: [18, 14] },
  dehumidifier: { heightCm: 51, mount: "standing", footprintCm: [32, 22] },
  heater: { heightCm: 62, mount: "standing", footprintCm: [42, 26] },
  co2_tank: { heightCm: 70, mount: "standing", footprintCm: [14, 14] },
  block: { heightCm: 14, mount: "standing", footprintCm: [12, 8] },
};

/**
 * An LED panel sized to the tent as growers size theirs: about 70 % of the
 * width, between 40 and 110 cm across, and never wider than the tent leaves
 * room for.
 */
export function ledPanelSize(dims: EnclosureDimensions): { widthCm: number; depthCm: number } {
  const across = Math.min(dims.widthCm, dims.depthCm);
  const widthCm = Math.min(110, across - 8, Math.max(40, across * 0.7));
  return { widthCm, depthCm: widthCm * 0.55 };
}

/** A model's footprint in its own frame, for this tent. */
export function footprintOf(kind: ModelKind, dims: EnclosureDimensions): [number, number] {
  if (kind === "led_light") {
    const { widthCm, depthCm } = ledPanelSize(dims);
    return [widthCm, depthCm];
  }
  return MODEL_SPECS[kind].footprintCm;
}

export function modelFor(role: RoleKind | undefined): ModelKind {
  return role ? BY_ROLE[role] : "block";
}
