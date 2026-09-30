/**
 * Notifications: the events worth the grower's attention, per page, and how
 * far each page's have been seen.
 *
 * A notification is not a separate record. It is an event of certain types,
 * classified here into the page (channel) it belongs to, so the timeline and
 * the badges cannot disagree about what happened. "Seen" is one timestamp per
 * workspace and channel: everything at or before it is seen. Marking seen
 * moves it to now; there is no per-event flag to keep in step.
 *
 * Routine activity (automation firings, devices coming back, recoveries) is
 * deliberately not a notification. A badge that climbs every day while nothing
 * is wrong teaches the grower to ignore it.
 */
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { eventMetric } from "../events/metric.js";
import {
  NOTIFICATION_CHANNELS,
  type AppEvent,
  type AppNotification,
  type NotificationChannel,
  type NotificationSummary,
} from "@canopy/shared-types";

/**
 * How far back an unseen count reaches for a page that has never been marked
 * seen, so a first run (or an upgrade) does not open on months of history.
 */
export const UNSEEN_LOOKBACK_DAYS = 7;

/** Recent notifications returned with the counts, for the bell. */
export const RECENT_LIMIT = 30;

/**
 * The channel of an event, as SQL over the `events` columns. The one place the
 * mapping lives, so the counts and the list agree. A threshold alert without a
 * severity is a recovery, which is not news.
 */
const CHANNEL_SQL = `
  CASE
    WHEN type = 'threshold_alert' AND severity IS NOT NULL      THEN 'logging'
    WHEN type IN ('automation_failed', 'failsafe_trip')         THEN 'automation'
    WHEN type = 'maintenance_due'                               THEN 'maintenance'
    WHEN type = 'device_offline'                                THEN 'settings'
  END`;

/** Events with their channel and the point their channel is seen up to. */
const CLASSIFIED_SQL = `
  SELECT e.*, COALESCE(s.seen_at, @fallback) AS seen_to
  FROM (SELECT *, ${CHANNEL_SQL} AS channel FROM events WHERE workspace_id = @ws) e
  LEFT JOIN notification_seen s ON s.workspace_id = @ws AND s.channel = e.channel
  WHERE e.channel IS NOT NULL`;

interface ClassifiedRow {
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
  channel: NotificationChannel;
  seen_to: string;
}

function fallbackCursor(now: Date): string {
  return new Date(now.getTime() - UNSEEN_LOOKBACK_DAYS * 86_400_000).toISOString();
}

function toNotification(row: ClassifiedRow): AppNotification {
  const n: AppNotification = {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as AppEvent["type"],
    description: row.description,
    occurredAt: row.occurred_at,
    channel: row.channel,
    seen: row.occurred_at <= row.seen_to,
  };
  if (row.grow_id)      n.growId = row.grow_id;
  if (row.source_id)    n.sourceId = row.source_id;
  if (row.source_label) n.sourceLabel = row.source_label;
  if (row.severity)     n.severity = row.severity as NonNullable<AppEvent["severity"]>;
  const metric = eventMetric(row);
  if (metric)           n.metric = metric;
  return n;
}

/** Unseen counts per channel and the most recent notifications. */
export function notificationSummary(
  db: Database,
  workspaceId: string,
  now: Date = new Date(),
  limit: number = RECENT_LIMIT,
): NotificationSummary {
  const params = { ws: workspaceId, fallback: fallbackCursor(now) };

  const unseen = Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, 0])) as Record<NotificationChannel, number>;
  const counts = db
    .prepare(`SELECT channel, COUNT(*) AS n FROM (${CLASSIFIED_SQL}) WHERE occurred_at > seen_to GROUP BY channel`)
    .all(params) as { channel: NotificationChannel; n: number }[];
  for (const { channel, n } of counts) unseen[channel] = n;

  const recent = (db
    .prepare(`${CLASSIFIED_SQL} ORDER BY e.occurred_at DESC LIMIT @limit`)
    .all({ ...params, limit }) as ClassifiedRow[]).map(toNotification);

  return { unseen, recent };
}

/** Mark channels seen up to `now`: the given ones, or every channel. */
export function markNotificationsSeen(
  db: Database,
  workspaceId: string,
  channels: readonly NotificationChannel[] = NOTIFICATION_CHANNELS,
  now: Date = new Date(),
): void {
  const upsert = db.prepare(`
    INSERT INTO notification_seen (workspace_id, channel, seen_at) VALUES (?, ?, ?)
    ON CONFLICT (workspace_id, channel) DO UPDATE SET seen_at = excluded.seen_at`);
  const at = now.toISOString();
  db.transaction(() => {
    for (const channel of channels) upsert.run(workspaceId, channel, at);
  })();
}

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === "string" && (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

/**
 * Record a `maintenance_due` event for each task that has come due since it
 * was last announced. Only tasks with their bell on: that toggle is the
 * grower saying whether a task is worth being told about.
 *
 * Once per due date. `due_notified_at` holds the `next_due_at` last announced,
 * and completing or skipping a task moves `next_due_at` on, which re-arms it.
 * Tasks in archived or deleted workspaces are left alone.
 */
export function announceDueTasks(db: Database, now: Date = new Date()): number {
  const at = now.toISOString();
  const due = db.prepare(`
    SELECT t.id, t.workspace_id, t.name, t.next_due_at
    FROM maintenance_tasks t
    JOIN workspaces w ON w.id = t.workspace_id AND w.archived_at IS NULL AND w.deleted_at IS NULL
    WHERE t.notifications = 1
      AND t.next_due_at IS NOT NULL
      AND t.next_due_at <= ?
      AND (t.due_notified_at IS NULL OR t.due_notified_at <> t.next_due_at)
  `).all(at) as { id: string; workspace_id: string; name: string; next_due_at: string }[];

  if (due.length === 0) return 0;

  const insert = db.prepare(`
    INSERT INTO events (id, workspace_id, type, source_id, source_label, description, severity, occurred_at)
    VALUES (?, ?, 'maintenance_due', ?, ?, ?, 'warn', ?)`);
  const mark = db.prepare(`UPDATE maintenance_tasks SET due_notified_at = next_due_at WHERE id = ?`);

  db.transaction(() => {
    for (const task of due) {
      insert.run(randomUUID(), task.workspace_id, task.id, task.name, `${task.name} is due`, at);
      mark.run(task.id);
    }
  })();
  return due.length;
}
