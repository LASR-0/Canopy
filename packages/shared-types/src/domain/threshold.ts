import type { Id } from "./common.js";
import type { Metric, Unit } from "./capability.js";
import type { GrowStageName } from "./grow.js";

/**
 * User-configurable target range for a sensor metric.
 * stage = null means workspace default; a specific stage overrides it.
 */
export interface SensorThreshold {
  id: Id;
  workspaceId: Id;
  /** null = workspace-level default; set = applies only during that grow stage. */
  stage?: GrowStageName;
  metric: Metric;
  minValue: number;
  maxValue: number;
  unit: Unit;
}
