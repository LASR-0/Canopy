import { METRICS, type Metric } from "@canopy/shared-types";

/**
 * The metric a threshold alert is about. Rows from before the `metric` column
 * existed have none, but every threshold description starts with the metric's
 * name (rules/thresholds.ts `describe`), so it is read from there.
 *
 * No store import, so the pure builders that use it (logs, notifications) can
 * be tested without opening the database file.
 */
export function eventMetric(row: { type: string; metric: string | null; description: string }): Metric | undefined {
  if (row.metric) return row.metric as Metric;
  if (row.type !== "threshold_alert") return undefined;
  const first = row.description.split(" ", 1)[0];
  return METRICS.includes(first as Metric) ? (first as Metric) : undefined;
}
