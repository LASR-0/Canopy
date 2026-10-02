/**
 * A grow's archive: its hourly readings, kept after the live database lets
 * them go, and the environment summary worked out when it finishes.
 *
 * The live database is already bounded by retention (raw a week, hourly 90
 * days, daily for good), so moving finished grows out of it would save next
 * to nothing. What retention does lose is detail: 90 days after a reading, a
 * grow has only daily averages left, and a grow often runs longer than that.
 * So when the hourly prune would delete rows that fall inside a grow, they
 * are moved into that grow's own file instead (`grow-<id>.db` in
 * GROW_ARCHIVE_DIR), during the grow as much as after it. Rows outside every
 * grow are deleted as before. Live rows are never duplicated: a row is in the
 * live table or in an archive, and readers ask the archive only for what live
 * no longer holds.
 *
 * Moving is two steps, not one transaction: SQLite under WAL does not make a
 * transaction across attached databases atomic. Rows are inserted into the
 * archive first (ignoring any already there, by a unique key), and deleted
 * from live after. A crash between the two leaves a row in both, which the
 * next prune finishes and readers tolerate; it can never leave one in neither.
 *
 * Raw readings are not archived. A week of them runs to a million rows, and
 * hourly carries each hour's min and max, which is what a past grow's chart
 * draws.
 */
import { existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { openDatabase } from "../store/sqlite.js";
import { hourBucket } from "../scheduler/jobs/rollup.js";
import type { Metric } from "@canopy/shared-types";

/**
 * Grow ids are UUIDs. Letters, digits, `-` and `_` are allowed, which is
 * safe in a file name; anything else (a slash, a dot) is refused rather than
 * used in a path.
 */
const GROW_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function archiveFileName(growId: string): string {
  if (!GROW_ID.test(growId)) throw new Error(`Not a grow id: ${growId}`);
  return `grow-${growId}.db`;
}

export const ARCHIVE_FILE = /^grow-([A-Za-z0-9_-]{1,64})\.db$/;

const ARCHIVE_DDL = `
  CREATE TABLE IF NOT EXISTS readings_hourly (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id  TEXT NOT NULL,
    device_id     TEXT NOT NULL,
    channel       TEXT NOT NULL,
    metric        TEXT NOT NULL,
    unit          TEXT NOT NULL,
    value         REAL NOT NULL,
    min_value     REAL,
    max_value     REAL,
    recorded_at   TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_hourly_key
    ON readings_hourly (device_id, channel, metric, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_archive_hourly_lookup
    ON readings_hourly (metric, recorded_at);
`;

/** A grow's archive, created when `create` is set; null when it has none. */
export function openArchive(dir: string, growId: string, { create = false } = {}): Database | null {
  const path = join(dir, archiveFileName(growId));
  if (!create && !existsSync(path)) return null;
  if (create) mkdirSync(dir, { recursive: true });
  const archive = openDatabase(path, create ? {} : { readonly: true });
  if (create) archive.exec(ARCHIVE_DDL);
  return archive;
}

interface GrowWindow {
  id: string;
  workspace_id: string;
  started_at: string;
  completed_at: string | null;
}

const HOURLY_COLUMNS = "workspace_id, device_id, channel, metric, unit, value, min_value, max_value, recorded_at";

/**
 * Before the hourly prune: move every row older than `cutoff` that falls in
 * a grow into that grow's archive. The prune then deletes them from live as
 * it always has.
 */
export function archiveBeforePrune(db: Database, dir: string, cutoff: string): { archived: number; grows: number } {
  const grows = db.prepare(`
    SELECT id, workspace_id, started_at, completed_at FROM grows
    WHERE started_at IS NOT NULL AND started_at < ?
  `).all(cutoff) as GrowWindow[];

  const select = db.prepare(`
    SELECT ${HOURLY_COLUMNS} FROM readings_hourly
    WHERE workspace_id = ? AND recorded_at >= ? AND recorded_at < ? AND recorded_at <= ?
  `);

  let archived = 0;
  let touched = 0;
  for (const grow of grows) {
    // A grow's last hour is the bucket its end falls in.
    const end = grow.completed_at ?? "9999";
    const rows = select.all(grow.workspace_id, hourBucket(new Date(grow.started_at)), cutoff, end) as Record<string, unknown>[];
    if (rows.length === 0) continue;

    const archive = openArchive(dir, grow.id, { create: true })!;
    try {
      const insert = archive.prepare(`
        INSERT OR IGNORE INTO readings_hourly (${HOURLY_COLUMNS})
        VALUES (@workspace_id, @device_id, @channel, @metric, @unit, @value, @min_value, @max_value, @recorded_at)
      `);
      archive.transaction(() => {
        for (const row of rows) archived += insert.run(row).changes;
      })();
      touched++;
    } finally {
      archive.close();
    }
  }
  return { archived, grows: touched };
}

export interface HourlyRow {
  deviceId: string;
  channel: string;
  unit: string;
  value: number;
  minValue: number | null;
  maxValue: number | null;
  recordedAt: string;
}

/**
 * Hourly rows from the archives of a workspace's grows that overlap the
 * window. Oldest first. Rows a crash left in both places are dropped by the
 * caller, which knows what live returned.
 */
export function archivedHourly(db: Database, dir: string, query: {
  workspaceId: string;
  metric: Metric;
  deviceId?: string;
  from: string;
  to: string;
}): HourlyRow[] {
  const grows = db.prepare(`
    SELECT id FROM grows
    WHERE workspace_id = ? AND started_at IS NOT NULL AND started_at <= ?
      AND (completed_at IS NULL OR completed_at >= ?)
  `).all(query.workspaceId, query.to, hourBucket(new Date(query.from))) as { id: string }[];

  const out: HourlyRow[] = [];
  for (const { id } of grows) {
    const archive = openArchive(dir, id);
    if (!archive) continue;
    try {
      out.push(...(archive.prepare(`
        SELECT device_id AS deviceId, channel, unit, value, min_value AS minValue, max_value AS maxValue, recorded_at AS recordedAt
        FROM readings_hourly
        WHERE metric = ? AND recorded_at >= ? AND recorded_at <= ? ${query.deviceId ? "AND device_id = ?" : ""}
        ORDER BY recorded_at
      `).all(query.metric, query.from, query.to, ...(query.deviceId ? [query.deviceId] : [])) as HourlyRow[]));
    } finally {
      archive.close();
    }
  }
  return out.sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
}

/** Live rows, with archived ones added for what live no longer holds. */
export function withArchived(live: HourlyRow[], archived: HourlyRow[]): HourlyRow[] {
  if (archived.length === 0) return live;
  const key = (r: HourlyRow) => `${r.deviceId}\0${r.channel}\0${r.recordedAt}`;
  const held = new Set(live.map(key));
  return [...archived.filter((r) => !held.has(key(r))), ...live]
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
}

/** Remove the archives of these grows: a workspace deleted for good. */
export async function removeArchives(dir: string, growIds: readonly string[]): Promise<void> {
  await Promise.all(growIds.map((id) => unlink(join(dir, archiveFileName(id))).catch(() => undefined)));
}

// ── The environment summary ─────────────────────────────────────────────────

export interface EnvSummary {
  envAvgVpd: number | null;
  envTempMin: number | null;
  envTempMax: number | null;
  envTempAvg: number | null;
  envRhMin: number | null;
  envRhMax: number | null;
  envRhAvg: number | null;
}

interface Band { avg: number; min: number; max: number }

const round = (value: number, places: number) => Number(value.toFixed(places));

/**
 * Average, lowest and highest over hourly rows: each hour counts once, and
 * an hour's own min and max are used where it has them.
 */
function band(rows: HourlyRow[]): Band | null {
  if (rows.length === 0) return null;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    sum += r.value;
    min = Math.min(min, r.minValue ?? r.value);
    max = Math.max(max, r.maxValue ?? r.value);
  }
  return { avg: sum / rows.length, min, max };
}

/** The device and channel holding a role in a workspace now. */
function roleSource(db: Database, workspaceId: string, role: string): { deviceId: string; channel: string } | undefined {
  return db.prepare(`
    SELECT device_id AS deviceId, channel FROM role_assignments WHERE workspace_id = ? AND role = ? LIMIT 1
  `).get(workspaceId, role) as { deviceId: string; channel: string } | undefined;
}

/**
 * The summary for one grow, from its hourly readings (live and archived).
 *
 * Temperature and humidity come from the **canopy** roles, the same sensors
 * VPD is derived from: a tent also has a reservoir probe, and averaging that
 * in would be a confident, wrong number. With no role assigned, that part of
 * the summary stays empty. A grow older than this feature may have lost its
 * hourly rows to the prune; its daily rows stand in then.
 */
export function growSummary(db: Database, dir: string, grow: GrowWindow): EnvSummary {
  const from = hourBucket(new Date(grow.started_at));
  const to = grow.completed_at ?? new Date().toISOString();

  const series = (metric: Metric, source: { deviceId: string; channel: string } | undefined): HourlyRow[] => {
    if (!source) return [];
    const q = { workspaceId: grow.workspace_id, metric, deviceId: source.deviceId, from, to };
    const live = db.prepare(`
      SELECT device_id AS deviceId, channel, unit, value, min_value AS minValue, max_value AS maxValue, recorded_at AS recordedAt
      FROM readings_hourly
      WHERE workspace_id = ? AND metric = ? AND device_id = ? AND channel = ? AND recorded_at >= ? AND recorded_at <= ?
    `).all(q.workspaceId, metric, source.deviceId, source.channel, from, to) as HourlyRow[];
    const rows = withArchived(live, archivedHourly(db, dir, q).filter((r) => r.channel === source.channel));
    if (rows.length > 0) return rows;
    return db.prepare(`
      SELECT device_id AS deviceId, channel, unit, value, min_value AS minValue, max_value AS maxValue, recorded_at AS recordedAt
      FROM readings_daily
      WHERE workspace_id = ? AND metric = ? AND device_id = ? AND channel = ? AND recorded_at >= ? AND recorded_at <= ?
    `).all(q.workspaceId, metric, source.deviceId, source.channel, from.slice(0, 10), to) as HourlyRow[];
  };

  const temp = band(series("temperature", roleSource(db, grow.workspace_id, "canopy_temp")));
  const rh = band(series("humidity", roleSource(db, grow.workspace_id, "canopy_rh")));
  const vpd = band(series("vpd", { deviceId: "__derived__", channel: "vpd" }));

  return {
    envAvgVpd: vpd ? round(vpd.avg, 2) : null,
    envTempMin: temp ? round(temp.min, 1) : null,
    envTempMax: temp ? round(temp.max, 1) : null,
    envTempAvg: temp ? round(temp.avg, 1) : null,
    envRhMin: rh ? round(rh.min, 1) : null,
    envRhMax: rh ? round(rh.max, 1) : null,
    envRhAvg: rh ? round(rh.avg, 1) : null,
  };
}

/**
 * The `archive_grow` job: work out the summary of every finished grow that
 * has none yet.
 *
 * Waits until the hourly rollup has run past the grow's end, so the final
 * hour is in the summary. A grow with no readings at all still gets an empty
 * summary and its timestamp, so it is not looked at again every hour.
 */
export function summariseFinishedGrows(db: Database, dir: string, now: Date = new Date()): { summarised: number } {
  const lastRollup = (db.prepare(`SELECT last_run_at AS at FROM jobs WHERE type = 'rollup_hourly'`).get() as { at: string | null } | undefined)?.at;
  if (!lastRollup) return { summarised: 0 };
  // The rollup covers every hour before the one it ran in.
  const coveredTo = hourBucket(new Date(lastRollup));

  const due = db.prepare(`
    SELECT id, workspace_id, started_at, completed_at FROM grows
    WHERE status IN ('completed', 'aborted') AND env_summarised_at IS NULL
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at < ?
  `).all(coveredTo) as GrowWindow[];

  const update = db.prepare(`
    UPDATE grows SET env_avg_vpd = @envAvgVpd, env_temp_min = @envTempMin, env_temp_max = @envTempMax,
      env_temp_avg = @envTempAvg, env_rh_min = @envRhMin, env_rh_max = @envRhMax, env_rh_avg = @envRhAvg,
      env_summarised_at = @at
    WHERE id = @id
  `);
  for (const grow of due) update.run({ ...growSummary(db, dir, grow), at: now.toISOString(), id: grow.id });
  return { summarised: due.length };
}
