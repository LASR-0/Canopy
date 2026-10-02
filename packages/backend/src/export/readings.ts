/**
 * Readings as CSV, for the Logging page's report generator.
 *
 * Long format, one row per reading: raw readings from different devices do
 * not share timestamps, so a wide table (a column per metric) would be mostly
 * empty. Rollup resolutions add the bucket's min and max.
 *
 * Written a page at a time, yielding between pages. A week of raw readings is
 * over a million rows, and better-sqlite3 is synchronous: one query for all of
 * it would stall the controller, ingest included, for as long as it ran. An
 * open iterator would not help either, since the connection refuses every
 * other statement until it closes.
 */
import type { Database } from "better-sqlite3";
import type { Metric, ReadingResolution } from "@canopy/shared-types";
import type { HourlyRow } from "../grow/archive.js";

export const EXPORT_PAGE = 5000;

const TABLE: Record<ReadingResolution, string> = {
  raw: "readings_raw",
  hourly: "readings_hourly",
  daily: "readings_daily",
};

export interface ExportRequest {
  workspaceId: string;
  metrics: Metric[];
  from: string;
  to: string;
  resolution: ReadingResolution;
}

interface Row {
  id: number;
  recorded_at: string;
  device_id: string;
  channel: string;
  metric: string;
  unit: string;
  value: number;
  min_value?: number | null;
  max_value?: number | null;
}

/** Quote a field only when it needs it: commas, quotes or line breaks. */
export function csvField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * `archived`, for hourly only, gives a metric's rows from the grows' archives
 * (grow/archive.ts). Those older than anything live still holds go first, so
 * the file stays in time order; any younger are rows a crash left in both
 * places, and live has them.
 */
export async function* readingsCsv(
  db: Database,
  request: ExportRequest,
  deviceNames: ReadonlyMap<string, string>,
  archived?: (metric: Metric) => HourlyRow[],
): AsyncGenerator<string> {
  const rollup = request.resolution !== "raw";
  const header = ["timestamp", "metric", "unit", rollup ? "average" : "value", ...(rollup ? ["min", "max"] : []), "device", "channel"];
  yield header.join(",") + "\n";

  const table = TABLE[request.resolution];
  const columns = `id, recorded_at, device_id, channel, metric, unit, value${rollup ? ", min_value, max_value" : ""}`;
  // Keyset paging on the (workspace_id, metric, recorded_at) index; id breaks
  // ties between readings stamped the same instant.
  const page = db.prepare(`
    SELECT ${columns} FROM ${table}
    WHERE workspace_id = @ws AND metric = @metric
      AND recorded_at >= @at AND recorded_at <= @to
      AND (recorded_at > @at OR id > @id)
    ORDER BY recorded_at, id
    LIMIT ${EXPORT_PAGE}
  `);

  const oldestLive = db.prepare(`
    SELECT MIN(recorded_at) AS at FROM ${table}
    WHERE workspace_id = ? AND metric = ? AND recorded_at >= ? AND recorded_at <= ?
  `);

  for (const metric of request.metrics) {
    if (archived && request.resolution === "hourly") {
      const before = (oldestLive.get(request.workspaceId, metric, request.from, request.to) as { at: string | null }).at;
      let chunk = "";
      for (const r of archived(metric)) {
        if (before !== null && r.recordedAt >= before) break;
        chunk += [
          r.recordedAt, metric, r.unit, Math.round(r.value * 10_000) / 10_000, r.minValue, r.maxValue,
          deviceNames.get(r.deviceId) ?? r.deviceId, r.channel,
        ].map(csvField).join(",") + "\n";
      }
      if (chunk) yield chunk;
    }

    // Starting below every id takes in readings stamped exactly at `from`.
    let at = request.from;
    let id = -1;
    for (;;) {
      const rows = page.all({ ws: request.workspaceId, metric, at, id, to: request.to }) as Row[];
      if (rows.length === 0) break;

      let chunk = "";
      for (const r of rows) {
        chunk += [
          r.recorded_at,
          r.metric,
          r.unit,
          // A rollup's average is a float mean; raw values are as the device sent them.
          rollup ? Math.round(r.value * 10_000) / 10_000 : r.value,
          ...(rollup ? [r.min_value, r.max_value] : []),
          deviceNames.get(r.device_id) ?? r.device_id,
          r.channel,
        ].map(csvField).join(",") + "\n";
      }
      yield chunk;

      const last = rows[rows.length - 1]!;
      at = last.recorded_at;
      id = last.id;
      if (rows.length < EXPORT_PAGE) break;
      await nextTick();
    }
  }
}
