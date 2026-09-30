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
}

/** How long a deleted workspace can be restored. Fixed, not a setting. */
export const WORKSPACE_RESTORE_DAYS = 7;

/** Archived and recently deleted workspaces, for Settings → Workspaces. */
export interface StoredWorkspaces {
  archived: Workspace[];
  deleted: Workspace[];
}
