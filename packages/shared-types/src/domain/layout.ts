/**
 * The physical layout of a workspace's tent: where devices are mounted and where
 * plants stand.
 *
 * One tent per workspace — that is what a workspace *is*. The enclosure itself
 * is `Workspace.dimensions`; this module holds what sits inside it.
 *
 * ## Coordinates
 *
 * Centimetres from the **back-left corner** as seen on the top-down plan, with
 * the door on the front edge:
 *
 * - `xCm` — across the width, left → right.
 * - `yCm` — across the depth, back wall → front (door).
 * - `zCm` — mounting height above the floor.
 *
 * The prototype's comment said "front-left" while its plan drew y = 0 against
 * the back wall. The drawing is what a grower sees, so the drawing wins.
 *
 * Positions are stored as real numbers, not rounded, so resizing a tent and then
 * resizing it back returns everything to where it was instead of drifting a
 * centimetre per round trip.
 */
import type { Id, Timestamp } from "./common.js";

export interface EnclosureDimensions {
  widthCm: number;
  depthCm: number;
  heightCm: number;
}

/**
 * The v1 size cap: a 6 × 6 m footprint, 3 m tall.
 *
 * The floor of 30 cm matches the prototype and keeps the plan legible — below
 * it, a pot is wider than the tent.
 */
export const ENCLOSURE_LIMITS = {
  minCm: 30,
  maxFootprintCm: 600,
  maxHeightCm: 300,
} as const;

/** The size a new layout starts from: a 4 × 4 ft tent, 2 m tall. */
export const DEFAULT_ENCLOSURE: EnclosureDimensions = { widthCm: 120, depthCm: 120, heightCm: 200 };

/**
 * Why a set of dimensions is not allowed, or null when it is.
 *
 * A message rather than a clamp: silently storing 600 when someone typed 800
 * would leave them believing the tent is 8 m wide.
 */
export function dimensionsProblem(d: EnclosureDimensions): string | null {
  const { minCm, maxFootprintCm, maxHeightCm } = ENCLOSURE_LIMITS;
  const check = (value: number, label: string, max: number) => {
    if (!Number.isFinite(value)) return `${label} must be a number`;
    if (value < minCm || value > max) return `${label} must be between ${minCm} and ${max} cm`;
    return null;
  };
  return (
    check(d.widthCm, "Width", maxFootprintCm) ??
    check(d.depthCm, "Depth", maxFootprintCm) ??
    check(d.heightCm, "Height", maxHeightCm)
  );
}

/** A device mounted in the tent. One per device per workspace. */
export interface DevicePlacement {
  workspaceId: Id;
  deviceId: Id;
  xCm: number;
  yCm: number;
  zCm: number;
  /**
   * Which way the device faces, in degrees clockwise seen from above, with 0
   * facing the front (the door). Meaningful for fans and lights; stored for
   * every device so the 3D view can orient anything without a later migration.
   */
  rotationDeg: number;
}

/** A plant in its pot, standing on the floor. As many as the grower likes. */
export interface Plant {
  id: Id;
  workspaceId: Id;
  label?: string;
  xCm: number;
  yCm: number;
  /** Pot volume in litres of soil — one of `POT_SIZES`. */
  potLitres: number;
  createdAt: Timestamp;
}

/** Everything placed in a workspace's tent, fetched together by the Setup View. */
export interface WorkspaceLayout {
  placements: DevicePlacement[];
  plants: Plant[];
}

/** A pot size, named by the litres of soil it holds — the measure growers buy by. */
export interface PotSize {
  litres: number;
  /** Top (rim) diameter. */
  diameterCm: number;
  heightCm: number;
}

/**
 * Pot sizes from 1 L to 50 L.
 *
 * Diameter and height are those of a typical round nursery pot at that volume —
 * a slight taper (base ≈ 85 % of the rim) and a height of ≈ 90 % of the rim
 * diameter — which puts each within a litre of its nominal volume. Real pots
 * vary by maker and fabric pots run wider and shorter, so these are for drawing
 * the pot to scale, not for ordering one.
 */
export const POT_SIZES: readonly PotSize[] = [
  { litres: 1,  diameterCm: 12, heightCm: 11 },
  { litres: 2,  diameterCm: 15, heightCm: 13 },
  { litres: 3,  diameterCm: 17, heightCm: 15 },
  { litres: 5,  diameterCm: 20, heightCm: 18 },
  { litres: 7,  diameterCm: 23, heightCm: 20 },
  { litres: 10, diameterCm: 25, heightCm: 23 },
  { litres: 12, diameterCm: 27, heightCm: 24 },
  { litres: 15, diameterCm: 29, heightCm: 26 },
  { litres: 20, diameterCm: 32, heightCm: 29 },
  { litres: 25, diameterCm: 35, heightCm: 31 },
  { litres: 30, diameterCm: 37, heightCm: 33 },
  { litres: 40, diameterCm: 40, heightCm: 36 },
  { litres: 50, diameterCm: 44, heightCm: 39 },
];

/** The pot most growers start a photoperiod plant in, and the default here. */
export const DEFAULT_POT_LITRES = 12;

export function potSize(litres: number): PotSize | undefined {
  return POT_SIZES.find((p) => p.litres === litres);
}

/** Keep a value inside [min, max]. */
export function clampCm(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Where a point lands when its tent is resized: the same fraction of each
 * dimension it held before.
 *
 * Proportional rather than fixed, so a light hung dead centre stays dead centre
 * and a sensor near the back wall stays near it. Absolute positions would leave
 * things outside a tent that shrank, or bunched in one corner of one that grew.
 */
export function rescalePoint<P extends { xCm: number; yCm: number; zCm?: number }>(
  point: P,
  from: EnclosureDimensions,
  to: EnclosureDimensions,
): P {
  const scaled = {
    ...point,
    xCm: (point.xCm / from.widthCm) * to.widthCm,
    yCm: (point.yCm / from.depthCm) * to.depthCm,
  };
  if (point.zCm !== undefined) scaled.zCm = (point.zCm / from.heightCm) * to.heightCm;
  return scaled;
}
