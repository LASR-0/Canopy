import type { Id, Timestamp } from "./common.js";
import type { Metric } from "./capability.js";

export type EventType =
  | "automation_fired"
  | "threshold_alert"
  | "failsafe_trip"
  | "device_online"
  | "device_offline"
  | "stage_changed"
  | "mode_changed"
  | "milestone_reached"
  | "maintenance_done"
  | "automation_failed"
  | "maintenance_due";

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
  /** The metric a threshold alert is about. */
  metric?: Metric;
  occurredAt: Timestamp;
}

/**
 * The pages that collect notifications: the events worth the grower's
 * attention, as opposed to the routine record. Named after the page each badge
 * sits on.
 *
 * - logging: a threshold alert at warn or err (not a recovery)
 * - automation: a failed run, or a failsafe trip
 * - maintenance: a task falling due, for tasks with their bell on
 * - settings: a device going offline
 */
export type NotificationChannel = "logging" | "automation" | "maintenance" | "settings";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "logging",
  "automation",
  "maintenance",
  "settings",
];

/** An event that is a notification, with the page it belongs to and whether it has been seen. */
export interface AppNotification extends AppEvent {
  channel: NotificationChannel;
  seen: boolean;
}

export interface NotificationSummary {
  /** Unseen notifications per page. Every channel is present, 0 when there are none. */
  unseen: Record<NotificationChannel, number>;
  /** The most recent notifications, newest first, seen or not. */
  recent: AppNotification[];
}

/** One recorded step inside an out-of-range period. */
export interface OutOfRangeStep {
  at: Timestamp;
  /** Absent on the recovery that ends the period. */
  severity?: EventSeverity;
  description: string;
}

/**
 * One excursion of a reading outside its band: from the first threshold alert
 * until the recovery that ends it. The warn and err steps between are folded
 * into it, so a reading flapping near an edge is one row rather than dozens.
 */
export interface OutOfRangePeriod {
  /** The id of the alert that opened the period. */
  id: Id;
  deviceId?: Id;
  channel?: string;
  metric?: Metric;
  startedAt: Timestamp;
  /** Absent while the reading is still out of range. */
  endedAt?: Timestamp;
  /** The worst level the period reached. */
  worst: EventSeverity;
  steps: OutOfRangeStep[];
}

/** The Logs tab: out-of-range periods, and the other events that need attention. */
export interface LogsResponse {
  periods: OutOfRangePeriod[];
  /** Failed runs, failsafe trips, devices going offline or online, tasks falling due. */
  events: AppEvent[];
}
