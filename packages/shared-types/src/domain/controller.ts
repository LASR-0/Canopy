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
  /** True for an installed controller (a service), false for one run from the repo. */
  installed: boolean;
  /** Where it keeps its database, journal photos and backups. */
  dataDir: string;
  /** The HTTP + WebSocket API, which listens on loopback only. */
  httpPort: number;
  /** The MQTT broker, which listens on every interface so devices can reach it. */
  mqttPort: number;
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
