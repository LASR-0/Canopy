import type { Id, Timestamp } from "./common.js";
import type { Metric } from "./capability.js";

/** A saved Logging page metric preset. */
export interface ChartLayout {
  id: Id;
  workspaceId: Id;
  name: string;
  metrics: Metric[];
  /** How the chart is drawn. Absent on layouts saved before 7.5 D, which set metrics only. */
  view?: ChartView;
  sortOrder: number;
  createdAt: Timestamp;
}

/** The Logging chart's marker groups, which a template can turn on and off. */
export type ChartEventGroup = "automations" | "alerts" | "devices" | "grow";

/**
 * Everything about the chart except its time range: a template like
 * "Root zone" should hold whether you are looking at today or last month.
 */
export interface ChartView {
  mode: "overlay" | "stack";
  options: { night: boolean; targets: boolean; oor: boolean };
  eventGroups: ChartEventGroup[];
}
