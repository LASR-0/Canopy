import type { Id, Timestamp } from "./common.js";
import type { Metric } from "./capability.js";

/** A saved Logging page metric preset. */
export interface ChartLayout {
  id: Id;
  workspaceId: Id;
  name: string;
  metrics: Metric[];
  sortOrder: number;
  createdAt: Timestamp;
}
