import type { Metric, Unit } from "./capability.js";
import type { Id, Timestamp } from "./common.js";

/** A single sensor sample as it streams in from a device. */
export interface Reading {
  workspaceId: Id;
  deviceId: Id;
  channel: string;
  metric: Metric;
  unit: Unit;
  value: number;
  ts: Timestamp;
}

export type ReadingResolution = "raw" | "hourly" | "daily";

export interface ReadingSeriesQuery {
  workspaceId: Id;
  metric: Metric;
  deviceId?: Id;
  from: Timestamp;
  to: Timestamp;
  resolution?: ReadingResolution;
}

export interface ReadingPoint {
  ts: Timestamp;
  value: number;
}

export interface ReadingSeries {
  metric: Metric;
  unit: Unit;
  resolution: ReadingResolution;
  points: ReadingPoint[];
}
