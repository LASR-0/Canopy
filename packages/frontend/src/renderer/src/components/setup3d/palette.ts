/**
 * Colours for the 3D view: what things are made of, so they stay the same in
 * both themes. A tent does not change colour at night; only the background
 * behind it follows the theme (`.tent-3d` in index.css).
 */
export const PALETTE = {
  // The tent
  fabric: "#e6e0d5",
  floor: "#d9d1c4",
  frame: "#45484d",
  pole: "#b9bcbf",
  zip: "#2a2c2f",
  // Plants
  pot: "#64676c",
  potRim: "#46494e",
  soil: "#5b3f2c",
  soilDark: "#3f2b1f",
  perlite: "#eeede8",
  leaf: "#6cb52f",
  leafDark: "#4f9426",
  leafOld: "#a8a33c",
  stem: "#6f9440",
  bud: "#9fc25a",
  // Equipment
  housing: "#4a4e54",
  housingDark: "#33363a",
  appliance: "#f2f1ee",
  applianceTrim: "#d6d5d1",
  sensor: "#2f7fd6",
  screen: "#c8d2c4",
  ink: "#26292c",
  led: "#ffe6b8",
  /** A grow light's face while it is off. */
  ledOff: "#8f8a7e",
  fanBlade: "#5d6168",
  /** A heater's lamp while it is on. */
  lamp: "#ff9a3c",
  /** A controller's status light. */
  ok: "#3fb950",
  cord: "#2a2b2d",
  duct: "#d9dadc",
  metal: "#9ca1a6",
  water: "#7fb2d9",
};

export type Palette = typeof PALETTE;
