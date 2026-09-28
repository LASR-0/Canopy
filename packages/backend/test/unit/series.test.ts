/**
 * Unit — reading series resolution and decimation (Phase 7, Logging)
 *
 * Both guards exist because of one measurement: a tent samples every few
 * seconds, so raw is thousands of points per metric per hour. Charting a week of
 * it is a few hundred thousand points and a multi-megabyte response. These are
 * the two places that is prevented, and neither is visible from the UI, so they
 * are asserted here rather than left to be discovered as a hung renderer.
 */
import { describe, it, expect } from "vitest";
import { decimate, resolutionFor } from "../../src/api/routes/readings.js";
import type { ReadingPoint } from "@canopy/shared-types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `count` points one minute apart, values counting up from zero. */
function points(count: number): ReadingPoint[] {
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, i) => ({
    ts: new Date(start + i * 60_000).toISOString(),
    value: i,
  }));
}

function span(ms: number): [string, string] {
  const to = Date.parse("2026-09-28T12:00:00.000Z");
  return [new Date(to - ms).toISOString(), new Date(to).toISOString()];
}

describe("resolutionFor", () => {
  it("leaves a short raw request alone", () => {
    const [from, to] = span(HOUR);
    expect(resolutionFor("raw", from, to)).toBe("raw");
  });

  it("serves raw right up to the six-hour limit", () => {
    const [from, to] = span(6 * HOUR);
    expect(resolutionFor("raw", from, to)).toBe("raw");
  });

  it("upgrades a raw request past the limit to hourly", () => {
    const [from, to] = span(24 * HOUR);
    expect(resolutionFor("raw", from, to)).toBe("hourly");
  });

  it("upgrades a very long raw request to daily", () => {
    // Hourly over a year is still ~8,700 points per line; daily is ~365.
    const [from, to] = span(365 * DAY);
    expect(resolutionFor("raw", from, to)).toBe("daily");
  });

  it("never overrides an explicitly coarser resolution", () => {
    // A caller asking for daily over one hour gets an empty-ish answer, which is
    // their business — the guard exists to prevent floods, not to second-guess.
    const [from, to] = span(HOUR);
    expect(resolutionFor("daily", from, to)).toBe("daily");
    expect(resolutionFor("hourly", from, to)).toBe("hourly");
  });

  it("does not upgrade a coarse request over a long span", () => {
    const [from, to] = span(365 * DAY);
    expect(resolutionFor("hourly", from, to)).toBe("hourly");
  });

  it("leaves raw alone when the range is unparseable", () => {
    // Better to serve the request than to silently coarsen it on a bad input.
    expect(resolutionFor("raw", "not-a-date", "also-not")).toBe("raw");
  });

  it("treats a reversed range as short rather than upgrading it", () => {
    const [from, to] = span(24 * HOUR);
    expect(resolutionFor("raw", to, from)).toBe("raw");
  });
});

describe("decimate", () => {
  it("returns the input untouched when it already fits", () => {
    const input = points(50);
    expect(decimate(input, 100)).toBe(input);
  });

  it("returns the input untouched at exactly the limit", () => {
    const input = points(100);
    expect(decimate(input, 100)).toBe(input);
  });

  it("thins to the limit when over it", () => {
    expect(decimate(points(10_000), 500)).toHaveLength(500);
  });

  it("keeps the first and last point", () => {
    // The ends anchor the chart's time axis; dropping either shifts the whole
    // line against the range the user asked for.
    const input = points(1000);
    const out = decimate(input, 10);
    expect(out[0]).toEqual(input[0]);
    expect(out[out.length - 1]).toEqual(input[input.length - 1]);
  });

  it("keeps points in order", () => {
    const out = decimate(points(5000), 200);
    const timestamps = out.map((p) => p.ts);
    expect([...timestamps].sort()).toEqual(timestamps);
  });

  it("spreads evenly rather than taking a prefix", () => {
    // A prefix would chart the first minutes of the range and call it the week.
    // 1001 points into 11 is a stride of exactly 100, so the expected indices
    // are unambiguous — an inexact stride rounds and obscures the intent.
    const out = decimate(points(1001), 11);
    expect(out.map((p) => p.value)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it("carries rollup extremes through untouched", () => {
    const input: ReadingPoint[] = points(100).map((p) => ({ ...p, min: p.value - 2, max: p.value + 2 }));
    const out = decimate(input, 10);
    for (const point of out) {
      expect(point.min).toBe(point.value - 2);
      expect(point.max).toBe(point.value + 2);
    }
  });

  it("handles a single point", () => {
    expect(decimate(points(1), 10)).toHaveLength(1);
  });

  it("handles an empty line", () => {
    expect(decimate([], 10)).toEqual([]);
  });
});
