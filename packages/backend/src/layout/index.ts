/**
 * Tent layout rules: where a placement or a plant may go, and what happens to
 * everything in the tent when the tent is resized.
 *
 * Pure functions, so the routes stay thin and the rules are testable without a
 * database.
 */
import {
  clampCm,
  potSize,
  rescalePoint,
  type EnclosureDimensions,
  type PlaceDeviceBody,
  type PlantBody,
} from "@canopy/shared-types";

/** Height a device is mounted at when first placed, before the grower sets it. */
export const DEFAULT_MOUNT_CM = 100;

interface Position {
  xCm: number;
  yCm: number;
  zCm: number;
  rotationDeg: number;
}

interface PlantPosition {
  xCm: number;
  yCm: number;
  potLitres: number;
  label: string | null;
}

const finiteOrUndefined = (v: unknown): number | undefined | "bad" =>
  v === undefined ? undefined : typeof v === "number" && Number.isFinite(v) ? v : "bad";

/** Degrees folded into [0, 360), so 450 and -270 both store as 90. */
export function normaliseRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * A device placement after applying a request to what is stored.
 *
 * Positions are **clamped** to the walls rather than rejected: a pin dragged
 * hard against the edge of the plan lands a fraction outside it, and refusing
 * that would make the edge feel sticky. A non-number is a real error, though,
 * and is returned as a message.
 */
export function resolvePlacement(
  existing: Position | undefined,
  body: PlaceDeviceBody,
  dims: EnclosureDimensions,
): Position | string {
  const fields = {
    xCm: finiteOrUndefined(body.xCm),
    yCm: finiteOrUndefined(body.yCm),
    zCm: finiteOrUndefined(body.zCm),
    rotationDeg: finiteOrUndefined(body.rotationDeg),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === "bad") return `${key} must be a number`;
  }
  const pick = (value: number | undefined | "bad", current: number | undefined, fallback: number) =>
    (value as number | undefined) ?? current ?? fallback;

  return {
    xCm: clampCm(pick(fields.xCm, existing?.xCm, dims.widthCm / 2), 0, dims.widthCm),
    yCm: clampCm(pick(fields.yCm, existing?.yCm, dims.depthCm / 2), 0, dims.depthCm),
    zCm: clampCm(pick(fields.zCm, existing?.zCm, Math.min(DEFAULT_MOUNT_CM, dims.heightCm)), 0, dims.heightCm),
    rotationDeg: normaliseRotation(pick(fields.rotationDeg, existing?.rotationDeg, 0)),
  };
}

/**
 * A plant after applying a request to what is stored.
 *
 * The pot must be one of the listed sizes — the plan draws it to scale from that
 * table, and a size with no dimensions could not be drawn. Position is clamped
 * to the floor like a device's.
 */
export function resolvePlant(
  existing: PlantPosition | undefined,
  body: PlantBody,
  dims: EnclosureDimensions,
  fallbackLitres: number,
): PlantPosition | string {
  const x = finiteOrUndefined(body.xCm);
  const y = finiteOrUndefined(body.yCm);
  if (x === "bad") return "xCm must be a number";
  if (y === "bad") return "yCm must be a number";

  const potLitres = body.potLitres ?? existing?.potLitres ?? fallbackLitres;
  if (!potSize(potLitres)) return `${String(potLitres)} L is not one of the listed pot sizes`;

  const label =
    body.label === undefined ? existing?.label ?? null : body.label.trim() ? body.label.trim() : null;

  return {
    xCm: clampCm(x ?? existing?.xCm ?? dims.widthCm / 2, 0, dims.widthCm),
    yCm: clampCm(y ?? existing?.yCm ?? dims.depthCm / 2, 0, dims.depthCm),
    potLitres,
    label,
  };
}

/** Whether a resize changes anything, so an unchanged PATCH does not rewrite every row. */
export function dimensionsChanged(from: EnclosureDimensions, to: EnclosureDimensions): boolean {
  return from.widthCm !== to.widthCm || from.depthCm !== to.depthCm || from.heightCm !== to.heightCm;
}

/** A placement moved to the same proportional spot in the resized tent. */
export function rescalePlacement<P extends { xCm: number; yCm: number; zCm: number }>(
  placement: P,
  from: EnclosureDimensions,
  to: EnclosureDimensions,
): P {
  return rescalePoint(placement, from, to);
}

/** A plant moved to the same proportional spot. Plants stand on the floor, so only x and y move. */
export function rescalePlant<P extends { xCm: number; yCm: number }>(
  plant: P,
  from: EnclosureDimensions,
  to: EnclosureDimensions,
): P {
  return rescalePoint(plant, from, to);
}
