/**
 * Unit — schedule evaluation (Phase 5)
 *
 * The photoperiod cases that matter are the awkward ones: a window crossing
 * midnight, a 24h window, and a tent whose clock is not UTC. Getting any of
 * them wrong leaves a grow dark or lit at the wrong time, and neither failure
 * announces itself.
 */
import { describe, it, expect } from "vitest";
import {
  cronFiredBetween,
  isValidCron,
  isWithinWindow,
  localMinutesOfDay,
  parseClockTime,
} from "../../src/scheduler/schedule.js";

describe("parseClockTime", () => {
  it.each([
    ["00:00", 0],
    ["06:00", 360],
    ["6:30", 390],
    ["18:45", 1125],
    ["23:59", 1439],
  ])("reads %s", (input, expected) => {
    expect(parseClockTime(input)).toBe(expected);
  });

  it.each(["24:00", "12:60", "", "six", "6", "06:0", "-1:00", "06:00:00"])(
    "rejects %s",
    (input) => {
      expect(parseClockTime(input)).toBeNull();
    },
  );
});

describe("localMinutesOfDay", () => {
  it("reads the wall clock in the tent's timezone, not the host's", () => {
    const at = new Date("2026-09-26T00:00:00.000Z");

    expect(localMinutesOfDay(at, "UTC")).toBe(0);
    // Brisbane is UTC+10 year round.
    expect(localMinutesOfDay(at, "Australia/Brisbane")).toBe(10 * 60);
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // London is UTC+1 in July, UTC+0 in January.
    expect(localMinutesOfDay(new Date("2026-07-01T12:00:00.000Z"), "Europe/London")).toBe(13 * 60);
    expect(localMinutesOfDay(new Date("2026-01-01T12:00:00.000Z"), "Europe/London")).toBe(12 * 60);
  });

  it("falls back to UTC for an unusable timezone instead of throwing", () => {
    const at = new Date("2026-09-26T08:30:00.000Z");

    expect(localMinutesOfDay(at, "Not/AZone")).toBe(8 * 60 + 30);
  });
});

describe("isWithinWindow", () => {
  const at = (iso: string) => new Date(iso);

  it("covers a daytime window", () => {
    expect(isWithinWindow("06:00", "18:00", at("2026-09-26T12:00:00Z"), "UTC")).toBe(true);
    expect(isWithinWindow("06:00", "18:00", at("2026-09-26T05:59:00Z"), "UTC")).toBe(false);
    expect(isWithinWindow("06:00", "18:00", at("2026-09-26T18:00:00Z"), "UTC")).toBe(false);
  });

  it("includes the on edge and excludes the off edge", () => {
    expect(isWithinWindow("06:00", "18:00", at("2026-09-26T06:00:00Z"), "UTC")).toBe(true);
    expect(isWithinWindow("06:00", "18:00", at("2026-09-26T17:59:00Z"), "UTC")).toBe(true);
  });

  it("handles a window crossing midnight, the normal flowering case", () => {
    // on 18:00, off 06:00 — a twelve hour night cycle.
    expect(isWithinWindow("18:00", "06:00", at("2026-09-26T23:00:00Z"), "UTC")).toBe(true);
    expect(isWithinWindow("18:00", "06:00", at("2026-09-26T02:00:00Z"), "UTC")).toBe(true);
    expect(isWithinWindow("18:00", "06:00", at("2026-09-26T12:00:00Z"), "UTC")).toBe(false);
  });

  it("treats the prototype's 06:00 to 00:00 as an 18 hour day, not an empty one", () => {
    expect(isWithinWindow("06:00", "00:00", at("2026-09-26T23:30:00Z"), "UTC")).toBe(true);
    expect(isWithinWindow("06:00", "00:00", at("2026-09-26T06:00:00Z"), "UTC")).toBe(true);
    expect(isWithinWindow("06:00", "00:00", at("2026-09-26T03:00:00Z"), "UTC")).toBe(false);
  });

  it("treats equal times as always on, a real 24h seedling setting", () => {
    for (const hour of ["00", "07", "13", "22"]) {
      expect(isWithinWindow("06:00", "06:00", at(`2026-09-26T${hour}:00:00Z`), "UTC")).toBe(true);
    }
  });

  it("evaluates against the tent's clock, not the host's", () => {
    // 22:00 UTC is 08:00 next day in Brisbane, inside a 06:00-18:00 window.
    const at2200Utc = at("2026-09-26T22:00:00Z");

    expect(isWithinWindow("06:00", "18:00", at2200Utc, "UTC")).toBe(false);
    expect(isWithinWindow("06:00", "18:00", at2200Utc, "Australia/Brisbane")).toBe(true);
  });

  it("reports an unreadable window rather than guessing on or off", () => {
    expect(isWithinWindow("6pm", "18:00", at("2026-09-26T12:00:00Z"), "UTC")).toBeNull();
    expect(isWithinWindow("06:00", "", at("2026-09-26T12:00:00Z"), "UTC")).toBeNull();
  });
});

describe("cronFiredBetween", () => {
  it("fires when an occurrence falls inside the interval", () => {
    const fired = cronFiredBetween(
      "0 6 * * *",
      new Date("2026-09-26T05:59:00Z"),
      new Date("2026-09-26T06:01:00Z"),
      "UTC",
    );

    expect(fired).toBe(true);
  });

  it("does not fire when the interval misses the occurrence", () => {
    const fired = cronFiredBetween(
      "0 6 * * *",
      new Date("2026-09-26T06:01:00Z"),
      new Date("2026-09-26T06:59:00Z"),
      "UTC",
    );

    expect(fired).toBe(false);
  });

  it("does not fire the same occurrence twice across adjacent intervals", () => {
    const boundary = new Date("2026-09-26T06:00:00Z");
    const before = cronFiredBetween("0 6 * * *", new Date("2026-09-26T05:00:00Z"), boundary, "UTC");
    const after = cronFiredBetween("0 6 * * *", boundary, new Date("2026-09-26T07:00:00Z"), "UTC");

    expect(before).toBe(true);
    expect(after).toBe(false);
  });

  it("resolves the expression in the tent's timezone", () => {
    // 06:00 Brisbane is 20:00 the previous day in UTC.
    const fired = cronFiredBetween(
      "0 6 * * *",
      new Date("2026-09-25T19:59:00Z"),
      new Date("2026-09-25T20:01:00Z"),
      "Australia/Brisbane",
    );

    expect(fired).toBe(true);
  });

  it("returns false for a zero-length or reversed interval", () => {
    const at = new Date("2026-09-26T06:00:00Z");

    expect(cronFiredBetween("* * * * *", at, at, "UTC")).toBe(false);
    expect(cronFiredBetween("* * * * *", at, new Date(at.getTime() - 1000), "UTC")).toBe(false);
  });

  it("treats a malformed expression as not firing, rather than throwing", () => {
    const fired = cronFiredBetween(
      "not a cron",
      new Date("2026-09-26T05:00:00Z"),
      new Date("2026-09-26T07:00:00Z"),
      "UTC",
    );

    expect(fired).toBe(false);
  });
});

describe("isValidCron", () => {
  it.each(["0 6 * * *", "*/15 * * * *", "0 0 1 * *", "30 6,18 * * 1-5"])(
    "accepts %s",
    (cron) => {
      expect(isValidCron(cron)).toBe(true);
    },
  );

  it.each(["", "not a cron", "99 * * * *", "0 6 * *"])("rejects %s", (cron) => {
    expect(isValidCron(cron)).toBe(false);
  });
});
