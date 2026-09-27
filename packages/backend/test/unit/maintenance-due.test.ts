/**
 * Unit — maintenance due dates (Phase 7)
 *
 * Getting this wrong is quiet in both directions. Too early and a completed
 * daily task nags again the same day; never, and it either nags forever or
 * drops off the list entirely. Neither announces itself.
 */
import { describe, it, expect } from "vitest";
import { nextDueAfter } from "../../src/api/routes/maintenance.js";

const FROM = new Date("2026-09-26T08:00:00.000Z");

describe("nextDueAfter", () => {
  it("moves a daily task to the same time tomorrow", () => {
    expect(nextDueAfter({ cadence: "daily" }, FROM)).toBe("2026-09-27T08:00:00.000Z");
  });

  it("uses the configured interval for a weekly task", () => {
    expect(nextDueAfter({ cadence: "weekly", intervalDays: 14 }, FROM))
      .toBe("2026-10-10T08:00:00.000Z");
  });

  it("falls back to seven days when a weekly task has no interval", () => {
    expect(nextDueAfter({ cadence: "weekly" }, FROM)).toBe("2026-10-03T08:00:00.000Z");
  });

  it("uses the interval for a custom task", () => {
    expect(nextDueAfter({ cadence: "custom", intervalDays: 3 }, FROM))
      .toBe("2026-09-29T08:00:00.000Z");
  });

  it("never returns a date in the past", () => {
    for (const cadence of ["daily", "weekly", "custom"] as const) {
      const next = nextDueAfter({ cadence, intervalDays: 1 }, FROM);
      expect(next).not.toBeNull();
      expect(new Date(next!).getTime()).toBeGreaterThan(FROM.getTime());
    }
  });

  it("gives a stage task no date, because the grow moves it on, not a clock", () => {
    expect(nextDueAfter({ cadence: "stage" }, FROM)).toBeNull();
  });

  it("gives a runtime task no date, because nothing accumulates device hours yet", () => {
    expect(nextDueAfter({ cadence: "runtime" }, FROM)).toBeNull();
  });

  it("crosses a month boundary correctly", () => {
    expect(nextDueAfter({ cadence: "daily" }, new Date("2026-09-30T23:00:00.000Z")))
      .toBe("2026-10-01T23:00:00.000Z");
  });
});
