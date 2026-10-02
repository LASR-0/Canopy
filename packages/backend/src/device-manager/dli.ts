/**
 * Daily light integral: the light a canopy received in a day, in mol/m²/day.
 *
 * DLI is PPFD (µmol/m²/s) summed over a day. An hour's average PPFD times
 * 3,600 s is exactly that hour's light, so a day's DLI is the sum of its
 * hourly rollups and nothing new needs storing: past days are worked out from
 * `readings_hourly` (and the grows' archives) when asked for, and today's
 * running total is kept in memory from the readings as they arrive. It is
 * never written as a reading. A running total would turn the hourly and daily
 * rollups' averages into nonsense.
 *
 * **The day runs from local midnight** in the workspace's timezone. With the
 * lights on the same schedule each day, any 24 hours hold exactly one
 * photoperiod's light, so a whole day's DLI is right however the photoperiod
 * sits across midnight (lights on 20:00, off 14:00 included), and nothing
 * depends on reading the light's automation, which changes between stages.
 *
 * The input is the **canopy light** role, like VPD's canopy roles: a sensor
 * elsewhere in the room would measure some other light. A PPFD sensor is used
 * as it reads. A lux sensor is converted with the workspace's grow-light
 * factor, which depends on the light's spectrum and is only typical, so that
 * DLI is flagged as estimated everywhere it shows.
 *
 * A day the sensor did not report for all of is `partial`: missing hours count
 * as no light, so its DLI is low by however much light they had.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "better-sqlite3";
import { db, sqliteConnection } from "../store/index.js";
import { devices, roleAssignments, workspaces } from "../store/schema.js";
import { broadcast } from "../ws/index.js";
import { rememberReading } from "./latest.js";
import { archivedHourly, withArchived, type HourlyRow } from "../grow/archive.js";
import { DERIVED_DEVICE_ID } from "./derived.js";
import {
  DEFAULT_GROW_LIGHT,
  LUX_TO_PPFD,
  type Capability,
  type GrowLight,
  type GrowLightType,
  type Reading,
  type ReadingPoint,
} from "@canopy/shared-types";

const HOUR_MS = 3_600_000;
/** µmol to mol, per second of light. */
const MOL = 1e6;

// ── Local days ──────────────────────────────────────────────────────────────

/** The calendar date of `at` in `timeZone`, as YYYY-MM-DD. UTC if the zone is unknown. */
export function localDate(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** How far `timeZone` is ahead of UTC at `at`, in ms. */
function offsetMs(at: Date, timeZone: string): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(at).map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts["year"]!, +parts["month"]! - 1, +parts["day"]!, +parts["hour"]!, +parts["minute"]!, +parts["second"]!);
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** The instant local midnight starts `date` (YYYY-MM-DD) in `timeZone`. */
export function localMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  // Twice: the offset at the guess can differ from the offset at the answer
  // when a DST change falls near midnight.
  const first = naive - offsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs(new Date(first), timeZone));
}

/** The date after `date`, as YYYY-MM-DD. */
export function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// ── The light source ────────────────────────────────────────────────────────

export function growLightOf(row: { growLight: string | null; luxToPpfd: number | null }): GrowLight {
  const type = (row.growLight ?? DEFAULT_GROW_LIGHT.type) as GrowLightType;
  if (type === "custom") {
    return { type, luxToPpfd: row.luxToPpfd != null && row.luxToPpfd > 0 ? row.luxToPpfd : DEFAULT_GROW_LIGHT.luxToPpfd };
  }
  return { type, luxToPpfd: LUX_TO_PPFD[type] ?? DEFAULT_GROW_LIGHT.luxToPpfd };
}

/** Where a workspace's DLI comes from. */
export interface DliSource {
  workspaceId: string;
  deviceId: string;
  channel: string;
  metric: "ppfd" | "lux";
  /** PPFD per unit of the reading: 1 for PPFD, the grow light's factor for lux. */
  factor: number;
  estimated: boolean;
  timeZone: string;
}

/** By workspace, and by the `deviceId:channel` that feeds it, for the ingest path. */
let sources = new Map<string, DliSource>();
let byChannel = new Map<string, DliSource>();

/**
 * Reload every workspace's DLI source: its canopy light role, what that
 * channel measures, and the workspace's timezone and grow light. Run whenever
 * VPD's roles are (derived.ts), and when a workspace's settings change.
 */
export async function refreshDliSources(): Promise<void> {
  try {
    const rows = await db
      .select({
        workspaceId: roleAssignments.workspaceId,
        deviceId: roleAssignments.deviceId,
        channel: roleAssignments.channel,
        capabilitiesJson: devices.capabilitiesJson,
        timezone: workspaces.timezone,
        growLight: workspaces.growLight,
        luxToPpfd: workspaces.luxToPpfd,
      })
      .from(roleAssignments)
      .innerJoin(devices, eq(devices.id, roleAssignments.deviceId))
      .innerJoin(workspaces, eq(workspaces.id, roleAssignments.workspaceId))
      .where(and(eq(roleAssignments.role, "canopy_light")));

    const next = new Map<string, DliSource>();
    for (const row of rows) {
      let caps: Capability[] = [];
      try {
        caps = JSON.parse(row.capabilitiesJson) as Capability[];
      } catch {
        // No capabilities: nothing to derive from.
      }
      const cap = caps.find((c) => c.channel === row.channel && c.kind === "sensor");
      if (!cap || cap.kind !== "sensor" || (cap.metric !== "ppfd" && cap.metric !== "lux")) continue;
      next.set(row.workspaceId, {
        workspaceId: row.workspaceId,
        deviceId: row.deviceId,
        channel: row.channel,
        metric: cap.metric,
        factor: cap.metric === "ppfd" ? 1 : growLightOf(row).luxToPpfd,
        estimated: cap.metric === "lux",
        timeZone: row.timezone,
      });
    }
    sources = next;
    byChannel = new Map([...next.values()].map((s) => [`${s.deviceId}:${s.channel}`, s]));
    // A changed source, factor or timezone invalidates today's running total.
    for (const [workspaceId, day] of live) {
      const s = next.get(workspaceId);
      if (!s || s.deviceId !== day.source.deviceId || s.channel !== day.source.channel
        || s.factor !== day.source.factor || s.timeZone !== day.source.timeZone) live.delete(workspaceId);
    }
  } catch (err) {
    console.error("[dli] failed to reload light sources:", err);
  }
}

export function dliSource(workspaceId: string): DliSource | undefined {
  return sources.get(workspaceId);
}

// ── Days from stored readings ───────────────────────────────────────────────

export interface DliDay {
  /** YYYY-MM-DD, local to the workspace. */
  date: string;
  /** When the day starts: local midnight. */
  start: string;
  dli: number;
  /** Hours with a reading. */
  hours: number;
  /** Fewer hours with readings than the day has, or still going. */
  partial: boolean;
}

/**
 * Light per local hour from raw readings, from `from` up to (not including)
 * `before`: each hour's mean PPFD and its readings, keyed by hour index.
 */
function rawHours(sqlite: Database, source: DliSource, dayStart: Date, before: Date) {
  const rows = sqlite.prepare(`
    SELECT value, recorded_at AS at FROM readings_raw
    WHERE workspace_id = ? AND device_id = ? AND channel = ? AND recorded_at >= ? AND recorded_at < ?
    ORDER BY recorded_at
  `).all(source.workspaceId, source.deviceId, source.channel, dayStart.toISOString(), before.toISOString()) as { value: number; at: string }[];
  const hours = new Map<number, { sum: number; count: number; last: number }>();
  for (const r of rows) {
    const t = Date.parse(r.at);
    const index = Math.floor((t - dayStart.getTime()) / HOUR_MS);
    const h = hours.get(index) ?? { sum: 0, count: 0, last: t };
    h.sum += r.value;
    h.count++;
    h.last = t;
    hours.set(index, h);
  }
  return hours;
}

/**
 * Daily DLI for each local day from `from` to `to`, oldest first. Past days
 * come from the hourly rollups (and the grows' archives), each hour assigned to
 * the day its middle falls in, which settles hours a half-hour timezone splits.
 * Today, when in range, comes from raw readings up to `now`.
 */
export function dailyDli(
  sqlite: Database,
  archiveDir: string,
  source: DliSource,
  from: Date,
  to: Date,
  now: Date = new Date(),
): DliDay[] {
  const today = localDate(now, source.timeZone);
  const firstDate = localDate(from, source.timeZone);
  const lastDate = localDate(to < now ? to : now, source.timeZone);
  if (firstDate > lastDate) return [];

  const dates: string[] = [];
  for (let d = firstDate; d <= lastDate; d = nextDate(d)) dates.push(d);

  const days = new Map(dates.map((date) => [date, { date, start: localMidnight(date, source.timeZone), mol: 0, hours: 0 }]));

  // Past days: hourly rows, live and archived.
  const pastEnd = localMidnight(today, source.timeZone);
  const pastStart = localMidnight(firstDate, source.timeZone);
  if (pastStart < pastEnd) {
    const query = {
      workspaceId: source.workspaceId, metric: source.metric, deviceId: source.deviceId,
      from: new Date(pastStart.getTime() - HOUR_MS).toISOString(), to: pastEnd.toISOString(),
    };
    const live = sqlite.prepare(`
      SELECT device_id AS deviceId, channel, unit, value, min_value AS minValue, max_value AS maxValue, recorded_at AS recordedAt
      FROM readings_hourly
      WHERE workspace_id = ? AND metric = ? AND device_id = ? AND channel = ? AND recorded_at >= ? AND recorded_at < ?
      ORDER BY recorded_at
    `).all(query.workspaceId, query.metric, query.deviceId, source.channel, query.from, query.to) as HourlyRow[];
    const rows = withArchived(live, archivedHourly(sqlite, archiveDir, query).filter((r) => r.channel === source.channel));
    for (const r of rows) {
      const middle = new Date(Date.parse(r.recordedAt) + HOUR_MS / 2);
      const day = days.get(localDate(middle, source.timeZone));
      if (!day || day.date === today) continue;
      day.mol += (r.value * source.factor * 3600) / MOL;
      day.hours++;
    }
  }

  // Today: raw readings so far, including one stamped exactly `now`.
  const todayDay = days.get(today);
  if (todayDay) {
    const state = stateFromRaw(sqlite, source, new Date(now.getTime() + 1));
    todayDay.mol = state ? soFar(state, now.getTime()) : 0;
    todayDay.hours = state ? state.hours : 0;
  }

  return [...days.values()].map((d) => {
    const length = Math.round((localMidnight(nextDate(d.date), source.timeZone).getTime() - d.start.getTime()) / HOUR_MS);
    return {
      date: d.date,
      start: d.start.toISOString(),
      dli: Number(d.mol.toFixed(2)),
      hours: d.hours,
      partial: d.date === today || d.hours < length,
    };
  });
}

/**
 * Days as chart points, at each day's start. A day with no readings at all is
 * left out: drawn as 0 it would read as a day without light, when it is a day
 * without data (the controller off, the sensor unplugged).
 */
export function dliPoints(days: DliDay[]): ReadingPoint[] {
  return days.filter((d) => d.hours > 0).map((d) => ({ ts: d.start, value: d.dli, ...(d.partial ? { partial: true } : {}) }));
}

// ── Today, live ─────────────────────────────────────────────────────────────

/** Today's running total for one workspace. */
interface LiveDay {
  source: DliSource;
  date: string;
  dayStart: number;
  /** mol from the local hours already over. */
  closed: number;
  /** Local hours with a reading, the current one included. */
  hours: number;
  hourIndex: number;
  sum: number;
  count: number;
  last: number;
}

const live = new Map<string, LiveDay>();

/** Today's state from raw readings before `before`, or null with none. */
function stateFromRaw(sqlite: Database, source: DliSource, before: Date): LiveDay {
  const date = localDate(before, source.timeZone);
  const dayStart = localMidnight(date, source.timeZone);
  const hours = rawHours(sqlite, source, dayStart, before);
  const current = Math.floor((before.getTime() - dayStart.getTime()) / HOUR_MS);
  const state: LiveDay = {
    source, date, dayStart: dayStart.getTime(), closed: 0, hours: hours.size,
    hourIndex: current, sum: 0, count: 0, last: dayStart.getTime(),
  };
  for (const [index, h] of hours) {
    if (index < current) state.closed += (h.sum / h.count) * source.factor * 3600 / MOL;
    else {
      state.sum = h.sum;
      state.count = h.count;
    }
    state.last = Math.max(state.last, h.last);
  }
  return state;
}

/**
 * The total so far: the hours that are over, plus the current hour's mean
 * for the part of it covered by readings. Not extended past the last reading,
 * so a sensor that stops does not keep adding light.
 */
function soFar(state: LiveDay, at: number): number {
  if (state.count === 0) return state.closed;
  const hourStart = state.dayStart + state.hourIndex * HOUR_MS;
  const seconds = Math.max(0, Math.min(at, state.last) - hourStart) / 1000;
  return state.closed + ((state.sum / state.count) * state.source.factor * seconds) / MOL;
}

/** Add one reading to a day's state. Pure apart from the state it is given. */
export function advance(state: LiveDay, value: number, at: number): void {
  const index = Math.floor((at - state.dayStart) / HOUR_MS);
  if (index > state.hourIndex) {
    if (state.count > 0) state.closed += (state.sum / state.count) * state.source.factor * 3600 / MOL;
    state.hourIndex = index;
    state.sum = 0;
    state.count = 0;
  }
  if (state.count === 0) state.hours++;
  state.sum += value;
  state.count++;
  state.last = Math.max(state.last, at);
}

/**
 * From the ingest path, after a reading is stored: when it is a workspace's
 * canopy light, update today's DLI and push it like a reading. It is kept with
 * the latest readings, so the Overview and Logging pick it up, but it is not
 * stored, and no threshold or rule judges it: "so far today" is below any
 * target every morning.
 */
export function deriveDli(reading: Reading, sqlite: Database = sqliteConnection): Reading | null {
  const source = byChannel.get(`${reading.deviceId}:${reading.channel}`);
  if (!source || source.workspaceId !== reading.workspaceId) return null;

  const at = Date.parse(reading.ts);
  let state = live.get(source.workspaceId);
  if (!state || state.date !== localDate(new Date(at), source.timeZone)) {
    // A new day, or the first reading since a restart: what is stored so far,
    // not counting this reading, which is already in readings_raw.
    state = stateFromRaw(sqlite, source, new Date(at));
    live.set(source.workspaceId, state);
  }
  advance(state, reading.value, at);

  const derived: Reading = {
    workspaceId: source.workspaceId,
    deviceId: DERIVED_DEVICE_ID,
    channel: "dli",
    metric: "dli",
    unit: "mol_m2d",
    value: Number(soFar(state, at).toFixed(2)),
    ts: reading.ts,
    ...(source.estimated ? { estimated: true } : {}),
  };
  rememberReading(derived);
  broadcast({ type: "reading", payload: derived });
  return derived;
}

/** Forget sources and running totals. Tests only. */
export function resetDliForTesting(): void {
  sources = new Map();
  byChannel = new Map();
  live.clear();
}

/** Load sources directly, bypassing the database. Tests only. */
export function setDliSourcesForTesting(list: DliSource[]): void {
  sources = new Map(list.map((s) => [s.workspaceId, s]));
  byChannel = new Map(list.map((s) => [`${s.deviceId}:${s.channel}`, s]));
  live.clear();
}
