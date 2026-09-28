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
  /** The sample at `raw`; the bucket average at `hourly` and `daily`. */
  value: number;
  /**
   * Bucket extremes. Present only at rollup resolutions — a raw point is its
   * own minimum and maximum, so repeating it would be noise.
   *
   * These exist because an average hides the excursion that mattered: a spike
   * that tripped a threshold at 14:03 disappears into an hourly mean. A chart
   * drawing the average inside a min–max band keeps the peak visible at every
   * range.
   */
  min?: number;
  max?: number;
}

/**
 * One line's worth of points: what a single channel on a single device reported.
 *
 * Series are split per (device, channel) rather than flattened, because two
 * sensors reporting the same metric are two different claims about the tent.
 * Interleaving them into one array produced a zigzag between sensors that looked
 * like violent swings in the reading.
 */
export interface DeviceSeries {
  deviceId: Id;
  /** Resolved on read, so a legend needs no second request. */
  deviceName: string;
  channel: string;
  points: ReadingPoint[];
}

export interface ReadingSeries {
  metric: Metric;
  unit: Unit;
  /**
   * The resolution actually used, which may be coarser than requested: raw over
   * a long span is hundreds of thousands of points, so the server upgrades it
   * and says so here rather than returning something unusable.
   */
  resolution: ReadingResolution;
  devices: DeviceSeries[];
  /** True when points were decimated to fit the response cap. */
  downsampled?: boolean;
}
