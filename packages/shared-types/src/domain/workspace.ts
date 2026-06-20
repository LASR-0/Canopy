import type { Id, Timestamp } from "./common.js";

/** A physical grow space — tent, room, closet, greenhouse bay. Everything is scoped to one. */
export interface Workspace {
  id: Id;
  name: string;
  createdAt: Timestamp;
  archived: boolean;
  /** IANA timezone string — drives all scheduling. e.g. "Australia/Sydney" */
  timezone: string;
  /** Enclosure dimensions in cm. Set via Setup View. */
  dimensions?: { widthCm: number; depthCm: number; heightCm: number };
  /** FK to the currently active grow, if one is running. */
  activeGrowId?: Id;
}
