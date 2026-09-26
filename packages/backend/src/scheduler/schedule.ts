/**
 * Schedule evaluation — pure, so the awkward cases can be tested without a
 * clock, a database or a broker.
 *
 * Two trigger shapes, and the difference is not cosmetic:
 *
 *  - A **cron** trigger is an *event*. It fires at an instant and is missed if
 *    the controller was down at that instant.
 *  - A **window** trigger is a *state*. "Lights on 06:00, off 00:00" says what
 *    the tent should look like at any moment, so it can be re-derived after a
 *    restart rather than missed.
 *
 * The photoperiod is the flagship scheduled feature and a missed light cycle
 * harms plants, so it is modelled as a window. A controller that reboots at
 * 10:00 must switch the lights on, not wait until tomorrow's 06:00 edge.
 */
import { CronExpressionParser } from "cron-parser";

/** Minutes since local midnight, or null if not "HH:MM". */
export function parseClockTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Minutes since midnight for `at`, as read in `timeZone`.
 *
 * Intl is the only dependency-free way to do this correctly across DST. A
 * timezone the runtime does not recognise throws, so it falls back to UTC
 * rather than taking the whole scheduler down over one bad workspace setting.
 */
export function localMinutesOfDay(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);

    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    // Some locales render midnight as 24:00.
    return (hour % 24) * 60 + minute;
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

/**
 * Is `at` inside the daily on/off window?
 *
 * A window whose off time is at or before its on time crosses midnight, which
 * is the normal case for flowering — "on 18:00, off 06:00" is a twelve hour
 * night cycle, not an empty window. Equal times mean always on: a 24h
 * photoperiod is a real seedling setting, and treating it as always off would
 * silently kill a grow.
 */
export function isWithinWindow(
  on: string,
  off: string,
  at: Date,
  timeZone: string,
): boolean | null {
  const onMinutes = parseClockTime(on);
  const offMinutes = parseClockTime(off);
  if (onMinutes === null || offMinutes === null) return null;

  if (onMinutes === offMinutes) return true;

  const now = localMinutesOfDay(at, timeZone);

  return onMinutes < offMinutes
    ? now >= onMinutes && now < offMinutes
    : now >= onMinutes || now < offMinutes;
}

/**
 * Reject expressions the parser would quietly reinterpret.
 *
 * cron-parser is lenient in a way that is actively dangerous here. An empty
 * string parses as "every minute", and a four-field expression is padded into
 * something unrelated — `0 6 * *` resolves to every minute for a whole day.
 * An irrigation pulse firing sixty times an hour because a field was left blank
 * is not a validation nicety.
 *
 * Standard cron is five fields; six is accepted for the seconds extension.
 */
function hasCronShape(cron: string): boolean {
  const fields = cron.trim().split(/\s+/).filter(Boolean);
  return fields.length === 5 || fields.length === 6;
}

/**
 * Did `cron` have an occurrence in (since, at]?
 *
 * The interval is half-open at the start so a tick boundary cannot fire the
 * same occurrence twice.
 */
export function cronFiredBetween(
  cron: string,
  since: Date,
  at: Date,
  timeZone: string,
): boolean {
  if (at <= since) return false;
  if (!hasCronShape(cron)) return false;

  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: since,
      tz: timeZone,
    });
    const next = interval.next().toDate();
    return next > since && next <= at;
  } catch {
    // A malformed expression must not stop the other automations running.
    return false;
  }
}

/** True if the expression is one this scheduler can evaluate. */
export function isValidCron(cron: string, timeZone = "UTC"): boolean {
  if (!hasCronShape(cron)) return false;

  try {
    CronExpressionParser.parse(cron, { tz: timeZone });
    return true;
  } catch {
    return false;
  }
}
