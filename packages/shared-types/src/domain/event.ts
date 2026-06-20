import type { Id, Timestamp } from "./common.js";

export type EventType =
  | "automation_fired"
  | "threshold_alert"
  | "failsafe_trip"
  | "device_online"
  | "device_offline"
  | "stage_changed"
  | "mode_changed"
  | "milestone_reached"
  | "maintenance_done";

export type EventSeverity = "warn" | "err";

/**
 * Unified timeline event — written by every subsystem, read by the Overview
 * activity feed and the Logging chart overlay.
 */
export interface AppEvent {
  id: Id;
  workspaceId: Id;
  growId?: Id;
  type: EventType;
  /** ID of the entity that produced this event (automationId, deviceId, etc.). */
  sourceId?: string;
  /** Human-readable source label e.g. "vpd-fan-control", "Atlas pH probe". */
  sourceLabel?: string;
  description: string;
  severity?: EventSeverity;
  occurredAt: Timestamp;
}
