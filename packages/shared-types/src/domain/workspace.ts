import type { Id, Timestamp } from "./common.js";
import type { EnclosureDimensions } from "./layout.js";

/** A physical grow space — tent, room, closet, greenhouse bay. Everything is scoped to one. */
export interface Workspace {
  id: Id;
  name: string;
  createdAt: Timestamp;
  /** Put away: kept whole and restorable at any time, but the controller does nothing for it. */
  archivedAt?: Timestamp;
  /** In Recently deleted: restorable until `purgeAt`, then removed for good. */
  deletedAt?: Timestamp;
  /** When a deleted workspace is removed permanently: `deletedAt` plus 7 days. */
  purgeAt?: Timestamp;
  /** IANA timezone string — drives all scheduling. e.g. "Australia/Sydney" */
  timezone: string;
  /**
   * Enclosure dimensions in cm, set in Setup View and capped by
   * `ENCLOSURE_LIMITS`. Changing them rescales everything placed in the tent.
   */
  dimensions?: EnclosureDimensions;
  /** FK to the currently active grow, if one is running. */
  activeGrowId?: Id;
  /** The tent's lights, for estimating PPFD (and DLI) from a lux sensor. */
  growLight: GrowLight;
}

/**
 * What lights the tent, which decides how lux converts to PPFD.
 *
 * A lux meter weights light by the human eye, PPFD counts photons a plant can
 * use, so the ratio depends on the light's spectrum. These are typical
 * factors (µmol/m²/s per lux), not measurements; DLI from lux is always shown
 * as an estimate. "custom" takes the factor as given, for a light whose
 * maker publishes one.
 */
export type GrowLightType = "white_led" | "hps" | "sunlight" | "custom";

export const GROW_LIGHT_TYPES: readonly GrowLightType[] = ["white_led", "hps", "sunlight", "custom"];

export interface GrowLight {
  type: GrowLightType;
  /** µmol/m²/s per lux. Fixed by the type, except for "custom". */
  luxToPpfd: number;
}

export const LUX_TO_PPFD: Record<Exclude<GrowLightType, "custom">, number> = {
  white_led: 0.017,
  hps: 0.0122,
  sunlight: 0.0185,
};

export const DEFAULT_GROW_LIGHT: GrowLight = { type: "white_led", luxToPpfd: LUX_TO_PPFD.white_led };

/** How long a deleted workspace can be restored. Fixed, not a setting. */
export const WORKSPACE_RESTORE_DAYS = 7;

/** Archived and recently deleted workspaces, for Settings → Workspaces. */
export interface StoredWorkspaces {
  archived: Workspace[];
  deleted: Workspace[];
}
