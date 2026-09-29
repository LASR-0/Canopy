import type { Id, Timestamp } from "./common.js";
import type { EnclosureDimensions } from "./layout.js";

/** A physical grow space — tent, room, closet, greenhouse bay. Everything is scoped to one. */
export interface Workspace {
  id: Id;
  name: string;
  createdAt: Timestamp;
  archived: boolean;
  /** IANA timezone string — drives all scheduling. e.g. "Australia/Sydney" */
  timezone: string;
  /**
   * Enclosure dimensions in cm, set in Setup View and capped by
   * `ENCLOSURE_LIMITS`. Changing them rescales everything placed in the tent.
   */
  dimensions?: EnclosureDimensions;
  /** FK to the currently active grow, if one is running. */
  activeGrowId?: Id;
}
