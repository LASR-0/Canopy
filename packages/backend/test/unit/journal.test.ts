/**
 * Unit — journal entry stamping and validation (Phase 7, Journal)
 *
 * The route was a stub that echoed its body back and stored nothing. What an
 * entry is filed under — its grow day, and the conditions it was written in — is
 * stamped by the server at write time, so those rules are pinned here.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/store/index.js", () => ({ db: {} }));

const { composeSnapshot, growDayAt, parseMeasurements, parseNewEntry, titleFrom, MAX_TITLE_LENGTH } =
  await import("../../src/grow/journal.js");

describe("growDayAt", () => {
  const start = "2026-01-01T00:00:00.000Z";

  it("counts the start day as day 1, week 1", () => {
    expect(growDayAt(start, new Date("2026-01-01T09:00:00.000Z"))).toEqual({ growDay: 1, growWeek: 1 });
  });

  it("rolls into week 2 on day 8", () => {
    expect(growDayAt(start, new Date("2026-01-07T23:00:00.000Z"))).toEqual({ growDay: 7, growWeek: 1 });
    expect(growDayAt(start, new Date("2026-01-08T00:00:00.000Z"))).toEqual({ growDay: 8, growWeek: 2 });
  });

  it("clamps to day 1 when the start date is in the future", () => {
    expect(growDayAt(start, new Date("2025-12-20T00:00:00.000Z"))).toEqual({ growDay: 1, growWeek: 1 });
  });
});

describe("titleFrom", () => {
  it("takes the first non-blank line", () => {
    expect(titleFrom("\n  Tips burning  \nDialled EC back")).toBe("Tips burning");
  });

  it("truncates a long first line", () => {
    const title = titleFrom("x".repeat(500));
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("parseNewEntry", () => {
  it("derives the title from the body, as the composer relies on", () => {
    const entry = parseNewEntry({ type: "observation", body: "Explosive growth\nInto the third node." });
    expect(entry).toMatchObject({ type: "observation", title: "Explosive growth" });
  });

  it("defaults the type to observation", () => {
    expect(parseNewEntry({ body: "note" })).toMatchObject({ type: "observation" });
  });

  it("rejects an unknown type", () => {
    expect(parseNewEntry({ type: "rant" as never, body: "x" })).toMatch(/Unknown entry type/);
  });

  it("rejects an entry with nothing in it", () => {
    expect(parseNewEntry({ body: "   " })).toMatch(/needs a title/);
  });

  it("accepts an entry that is only photos, titled by the first caption", () => {
    expect(parseNewEntry({ type: "photo", photos: [{ id: "p1", caption: "Week 3 canopy" }, { id: "p2" }] }))
      .toMatchObject({ title: "Week 3 canopy" });
  });

  it("titles uncaptioned photos by how many there are", () => {
    expect(parseNewEntry({ photos: [{ id: "p1" }] })).toMatchObject({ title: "Photo" });
    expect(parseNewEntry({ photos: [{ id: "p1" }, { id: "p2" }] })).toMatchObject({ title: "Photos" });
  });

  it("accepts a measurement-only entry and gives it a title", () => {
    const entry = parseNewEntry({ type: "measurement", measurements: [["pH", "6.2"]] });
    expect(entry).toMatchObject({ title: "Measurements", measurements: [["pH", "6.2"]] });
  });

  it("names an experiment from its hypothesis even when there is a body", () => {
    const entry = parseNewEntry({ type: "experiment", hypothesis: "LST beats topping", body: "Tied down the mains." });
    expect(entry).toMatchObject({ title: "LST beats topping", body: "Tied down the mains." });
  });

  it("names an experiment from its hypothesis when there is no body", () => {
    const entry = parseNewEntry({ type: "experiment", hypothesis: "LST beats topping" });
    expect(entry).toMatchObject({ title: "LST beats topping", hypothesis: "LST beats topping", body: null });
  });

  it("stores blank optional fields as null rather than empty strings", () => {
    expect(parseNewEntry({ body: "x", result: "  " })).toMatchObject({ result: null, hypothesis: null });
  });
});

describe("parseMeasurements", () => {
  it("drops blank pairs and trims", () => {
    expect(parseMeasurements([[" pH ", " 6.2 "], ["", ""]])).toEqual([["pH", "6.2"]]);
  });

  it("returns null when every pair is blank, so an empty list clears the field", () => {
    expect(parseMeasurements([])).toBeNull();
    expect(parseMeasurements([["", " "]])).toBeNull();
  });

  it("rejects anything that is not a list of string pairs", () => {
    expect(parseMeasurements("pH 6.2")).toMatch(/pairs/);
    expect(parseMeasurements([["pH", 6.2]])).toMatch(/pairs/);
    expect(parseMeasurements([["pH"]])).toMatch(/pairs/);
  });
});

describe("composeSnapshot", () => {
  it("stamps VPD only when both halves are known", () => {
    expect(composeSnapshot(24.6, undefined)).toEqual({ envTempC: 24.6 });
    expect(composeSnapshot(undefined, 58)).toEqual({ envRhPct: 58 });
    expect(composeSnapshot(undefined, undefined)).toEqual({});
  });

  it("computes VPD from the stamped pair", () => {
    const snap = composeSnapshot(24.6, 58);
    expect(snap.envTempC).toBe(24.6);
    expect(snap.envRhPct).toBe(58);
    // Tetens at 24.6 °C is ~3.09 kPa; 42 % of that is ~1.30.
    expect(snap.envVpdKpa).toBeCloseTo(1.3, 1);
  });

  it("leaves VPD out for an impossible humidity rather than stamping nonsense", () => {
    expect(composeSnapshot(24, 140)).toEqual({ envTempC: 24, envRhPct: 140 });
  });
});
