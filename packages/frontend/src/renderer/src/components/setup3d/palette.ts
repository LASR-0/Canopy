/** Grays per theme for the 3D view. Colour is kept for state, later. */
export const PALETTE = {
  dark: {
    wall: "#6e7681", floor: "#30363d", pole: "#a5adb6", door: "#c9d1d9",
    pot: "#545d68", plant: "#8b949e", device: "#d0d7de", accent: "#7d8590", rope: "#a5adb6",
  },
  light: {
    wall: "#c4ccd4", floor: "#e1e6eb", pole: "#57606a", door: "#424a53",
    pot: "#8c959f", plant: "#6e7781", device: "#32383f", accent: "#8c959f", rope: "#57606a",
  },
};

export type Palette = (typeof PALETTE)["dark"];
