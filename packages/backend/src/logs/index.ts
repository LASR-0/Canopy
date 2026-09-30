/**
 * The Logs tab: what went wrong in a window.
 *
 * Threshold alerts are folded into out-of-range periods, one per excursion,
 * because a reading hovering at a band edge records a step every minute or two
 * and a row per step buries everything else. The other problems (failed runs,
 * failsafe trips, devices going offline or coming back, tasks falling due) are
 * listed as they are.
 */
import type { Database } from "better-sqlite3";
import type {
  AppEvent,
  EventSeverity,
  LogsResponse,
  OutOfRangePeriod,
} from "@canopy/shared-types";
import { eventMetric } from "../events/metric.js";

/**
 * How far before the window to read alerts, so a period that began earlier is
 * shown with its real start. An excursion longer than this starts at the
 * lookback's edge instead.
 */
export const PERIOD_LOOKBACK_DAYS = 7;

/** Most non-alert rows returned for one window. */
export const MAX_LOG_EVENTS = 1000;

/** The event types the Logs tab lists besides out-of-range periods. */
export const LOG_EVENT_TYPES = [
  "automation_failed",
  "failsafe_trip",
  "device_offline",
  "device_online",
  "maintenance_due",
] as const;

interface EventRow {
  id: string;
  workspace_id: string;
  grow_id: string | null;
  type: string;
  source_id: string | null;
  source_label: string | null;
  description: string;
  severity: string | null;
  occurred_at: string;
  metric: string | null;
}

const RANK: Record<EventSeverity, number> = { warn: 1, err: 2 };

/**
 * Fold threshold alerts into periods. `rows` must be oldest first.
 *
 * A period opens at the first alert with a severity on a channel, takes every
 * warn and err step after it, and closes at the recovery (an alert with no
 * severity). A recovery with nothing open belongs to a period that started
 * before the rows begin, and is dropped. A period with no recovery yet is
 * ongoing.
 */
export function buildPeriods(rows: readonly EventRow[]): OutOfRangePeriod[] {
  const open = new Map<string, OutOfRangePeriod>();
  const done: OutOfRangePeriod[] = [];

  for (const row of rows) {
    const key = `${row.source_id ?? ""}:${row.source_label ?? ""}`;
    const current = open.get(key);
    const severity = row.severity === "err" || row.severity === "warn" ? row.severity : undefined;

    if (!severity) {
      if (!current) continue;
      current.endedAt = row.occurred_at;
      current.steps.push({ at: row.occurred_at, description: row.description });
      done.push(current);
      open.delete(key);
      continue;
    }

    if (current) {
      current.steps.push({ at: row.occurred_at, severity, description: row.description });
      if (RANK[severity] > RANK[current.worst]) current.worst = severity;
      continue;
    }

    const period: OutOfRangePeriod = {
      id: row.id,
      startedAt: row.occurred_at,
      worst: severity,
      steps: [{ at: row.occurred_at, severity, description: row.description }],
    };
    if (row.source_id) period.deviceId = row.source_id;
    if (row.source_label) period.channel = row.source_label;
    const metric = eventMetric(row);
    if (metric) period.metric = metric;
    open.set(key, period);
  }

  return [...done, ...open.values()];
}

function toEvent(row: EventRow): AppEvent {
  const e: AppEvent = {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as AppEvent["type"],
    description: row.description,
    occurredAt: row.occurred_at,
  };
  if (row.grow_id)      e.growId = row.grow_id;
  if (row.source_id)    e.sourceId = row.source_id;
  if (row.source_label) e.sourceLabel = row.source_label;
  if (row.severity)     e.severity = row.severity as EventSeverity;
  const metric = eventMetric(row);
  if (metric)           e.metric = metric;
  return e;
}

/** Out-of-range periods overlapping `[from, to]`, newest first, and the other problems in it. */
export function logsFor(db: Database, workspaceId: string, from: string, to: string): LogsResponse {
  const lookback = new Date(Date.parse(from) - PERIOD_LOOKBACK_DAYS * 86_400_000).toISOString();

  const alerts = db.prepare(`
    SELECT * FROM events
    WHERE workspace_id = ? AND type = 'threshold_alert' AND occurred_at >= ? AND occurred_at <= ?
    ORDER BY occurred_at ASC, rowid ASC
  `).all(workspaceId, lookback, to) as EventRow[];

  const periods = buildPeriods(alerts)
    .filter((p) => (p.endedAt ?? to) >= from)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const placeholders = LOG_EVENT_TYPES.map(() => "?").join(", ");
  const events = (db.prepare(`
    SELECT * FROM events
    WHERE workspace_id = ? AND type IN (${placeholders}) AND occurred_at >= ? AND occurred_at <= ?
    ORDER BY occurred_at DESC
    LIMIT ${MAX_LOG_EVENTS}
  `).all(workspaceId, ...LOG_EVENT_TYPES, from, to) as EventRow[]).map(toEvent);

  return { periods, events };
}
