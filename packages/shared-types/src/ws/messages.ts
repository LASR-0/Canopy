import type {
  Reading,
  ControllerStatus,
  GrowStageName,
  Id,
  Device,
} from "../domain/index.js";

/**
 * The live channel. Request/response goes over HTTP; anything that arrives
 * continuously (sensor samples, status changes) is pushed here so the UI can
 * stay live without polling.
 */

export const WS_PROTOCOL_VERSION = 1 as const;

/** Server -> client: things the backend pushes. */
export type ServerMessage =
  | { type: "reading";              payload: Reading }
  | { type: "device.status";        payload: { deviceId: Id; online: boolean } }
  | { type: "controller.status";    payload: ControllerStatus }
  | { type: "automation.fired";     payload: { automationId: Id; at: string } }
  | { type: "grow.stage.changed";   payload: { growId: Id; stage: GrowStageName; index: number } }
  // ── Scan events ────────────────────────────────────────────────────────────
  | { type: "scan.device_found";    payload: { device: Device; scanId: string } }
  | { type: "scan.complete";        payload: { scanId: string; found: number } }
  | { type: "scan.error";           payload: { scanId: string; error: string } };

/** Client -> server: subscription management, scoped per tent. */
export type ClientMessage =
  | { type: "subscribe"; payload: { workspaceId: Id } }
  | { type: "unsubscribe"; payload: { workspaceId: Id } };

/** Common envelope for both directions. */
export interface WsEnvelope<M extends ServerMessage | ClientMessage> {
  v: typeof WS_PROTOCOL_VERSION;
  ts: string;
  msg: M;
}
