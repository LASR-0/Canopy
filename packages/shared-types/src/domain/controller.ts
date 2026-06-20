import type { Id, Timestamp } from "./common.js";

/**
 * The controller (backend) runs as an OS-managed service, independent of the UI.
 * "stopped" is a deliberate user action — distinct from simply closing the
 * window. "paused" keeps monitoring but suspends automations/actuation.
 */
export type ControllerState = "running" | "paused" | "stopped";

export interface ControllerStatus {
  state: ControllerState;
  version: string;
  uptimeSec: number;
  brokerOnline: boolean;
  deviceCount: number;
  activeGrowId?: Id;
  ts: Timestamp;
}

/** Lightweight liveness probe the UI hits to decide online/offline. */
export interface HealthResponse {
  ok: true;
  version: string;
  ts: Timestamp;
}

/** Commands the UI may issue to the controller's own lifecycle. */
export type ControllerCommand =
  | { op: "pause" }
  | { op: "resume" }
  | { op: "stop" };
