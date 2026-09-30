import type { IconName } from "@/components/Icon";
import { METRIC_META } from "@/lib/metrics";
import type { AppEvent, Metric } from "@canopy/shared-types";

/**
 * Which group an event type falls under, for the Logging chart's marker
 * toggles and the Activity tab's filter.
 */
export type EventGroup = "automations" | "alerts" | "devices" | "grow";

export const EVENT_GROUP: Record<AppEvent["type"], EventGroup> = {
  automation_fired: "automations",
  automation_failed: "automations",
  failsafe_trip: "automations",
  threshold_alert: "alerts",
  device_online: "devices",
  device_offline: "devices",
  stage_changed: "grow",
  mode_changed: "grow",
  milestone_reached: "grow",
  maintenance_done: "grow",
  maintenance_due: "grow",
};

export const EVENT_GROUPS: { key: EventGroup; label: string }[] = [
  { key: "automations", label: "Automations" },
  { key: "alerts", label: "Alerts" },
  { key: "devices", label: "Devices" },
  { key: "grow", label: "Grow" },
];

/** Every event type in a group, for asking the controller for just those. */
export function typesIn(groups: Iterable<EventGroup>): AppEvent["type"][] {
  const wanted = new Set(groups);
  return (Object.keys(EVENT_GROUP) as AppEvent["type"][]).filter((t) => wanted.has(EVENT_GROUP[t]));
}

export function eventIcon(type: AppEvent["type"]): IconName {
  switch (type) {
    case "threshold_alert":
    case "failsafe_trip":     return "alert";
    case "device_online":
    case "device_offline":    return "plug";
    case "automation_fired":
    case "automation_failed": return "automation";
    case "stage_changed":
    case "mode_changed":      return "cycle";
    case "milestone_reached": return "pin";
    case "maintenance_done":
    case "maintenance_due":   return "maintenance";
  }
}

/** Severity first, then the few routine events worth a colour of their own. */
export function eventColor(event: Pick<AppEvent, "type" | "severity">): string {
  return event.severity === "err"              ? "var(--danger-fg)"
    : event.severity === "warn"                ? "var(--attention-fg)"
    : event.type === "device_online"           ? "var(--success-fg)"
    : event.type === "automation_fired"        ? "var(--accent-fg)"
    : "var(--fg-muted)";
}

/**
 * An event's description for display. Threshold alerts are written with the
 * metric's id ("soil_moisture 44.9% below range 45–60"); shown, they lead
 * with its label ("Soil moisture 44.9% below range 45–60").
 */
export function eventText(description: string, metric?: Metric): string {
  if (!metric || !description.startsWith(`${metric} `)) return description;
  return `${METRIC_META[metric].label}${description.slice(metric.length)}`;
}
