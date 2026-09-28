/**
 * Unit — grow stage gating (Phase 7, Grow Cycle)
 *
 * `Automation.stage` was stored from the first commit and read back by both
 * engines, and filtered on by neither — so a "flowering only" automation ran in
 * every stage. The rule is decided here, and the case that needed deciding is
 * what happens with no active grow: a scope then has nothing to match, so it
 * idles rather than running as if unscoped.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GrowCycle } from "@canopy/shared-types";

vi.mock("../../src/store/index.js", () => ({ db: {} }));

const {
  appliesInCurrentStage,
  currentStage,
  activeGrowFor,
  resetGrowStageForTesting,
  setActiveGrowsForTesting,
} = await import("../../src/grow/stage.js");

/** A grow whose planned weeks put day 1 in seedling and day 30 in flowering. */
function grow(startedAt: string): GrowCycle {
  return {
    id: "g-1",
    workspaceId: "ws-1",
    name: "Grow #1",
    status: "active",
    // 2 seedling, 4 veg, 8 flower, 1 flush — days 1-14, 15-42, 43-98, 99-105.
    plannedSeedlingWeeks: 2,
    plannedVegWeeks: 4,
    plannedFlowerWeeks: 8,
    plannedFlushWeeks: 1,
    startedAt,
  };
}

const DAY_3 = new Date("2026-01-03T12:00:00.000Z");
const DAY_20 = new Date("2026-01-20T12:00:00.000Z");
const DAY_50 = new Date("2026-02-19T12:00:00.000Z");

beforeEach(() => resetGrowStageForTesting());

describe("currentStage", () => {
  it("resolves the stage from the grow's planned weeks", () => {
    setActiveGrowsForTesting([["ws-1", grow("2026-01-01T00:00:00.000Z")]]);
    expect(currentStage("ws-1", DAY_3)).toBe("seedling");
    expect(currentStage("ws-1", DAY_20)).toBe("vegetative");
    expect(currentStage("ws-1", DAY_50)).toBe("flowering");
  });

  it("is undefined when the workspace has no active grow", () => {
    setActiveGrowsForTesting([["ws-1", null]]);
    expect(currentStage("ws-1", DAY_3)).toBeUndefined();
  });

  it("is undefined for a workspace it has never heard of", () => {
    expect(currentStage("ws-unknown", DAY_3)).toBeUndefined();
  });

  it("is undefined for a grow that was never started", () => {
    // A planned grow has no startedAt, so it has no day and therefore no stage.
    const planned = { ...grow("2026-01-01T00:00:00.000Z"), status: "planned" as const };
    delete (planned as { startedAt?: string }).startedAt;
    setActiveGrowsForTesting([["ws-1", planned]]);
    expect(currentStage("ws-1", DAY_3)).toBeUndefined();
  });
});

describe("appliesInCurrentStage", () => {
  it("always applies when there is no scope", () => {
    // Most automations are not stage-specific and must not be affected by this.
    setActiveGrowsForTesting([["ws-1", null]]);
    expect(appliesInCurrentStage("ws-1", undefined, DAY_3)).toBe(true);
  });

  it("applies when the scope matches the current stage", () => {
    setActiveGrowsForTesting([["ws-1", grow("2026-01-01T00:00:00.000Z")]]);
    expect(appliesInCurrentStage("ws-1", "seedling", DAY_3)).toBe(true);
    expect(appliesInCurrentStage("ws-1", "flowering", DAY_50)).toBe(true);
  });

  it("does not apply when the scope is a different stage", () => {
    setActiveGrowsForTesting([["ws-1", grow("2026-01-01T00:00:00.000Z")]]);
    expect(appliesInCurrentStage("ws-1", "flowering", DAY_3)).toBe(false);
    expect(appliesInCurrentStage("ws-1", "seedling", DAY_50)).toBe(false);
  });

  it("idles a scoped automation when no grow is running", () => {
    // The decision: a scope with no stage to match does not run. The alternative
    // — ignoring the scope — makes "flowering only" a lie.
    setActiveGrowsForTesting([["ws-1", null]]);
    expect(appliesInCurrentStage("ws-1", "flowering", DAY_3)).toBe(false);
  });

  it("keeps workspaces independent", () => {
    // One tent flowering must not let another tent's flowering automation run.
    setActiveGrowsForTesting([
      ["ws-1", grow("2026-01-01T00:00:00.000Z")],
      ["ws-2", null],
    ]);
    expect(appliesInCurrentStage("ws-1", "seedling", DAY_3)).toBe(true);
    expect(appliesInCurrentStage("ws-2", "seedling", DAY_3)).toBe(false);
  });

  it("follows a re-planned timeline", () => {
    // Moving the veg weeks moves the stage boundaries under everything scoped to
    // them, which is why the route reloads this on any grow edit.
    const short = { ...grow("2026-01-01T00:00:00.000Z"), plannedSeedlingWeeks: 1 };
    setActiveGrowsForTesting([["ws-1", short]]);
    // Day 20 was vegetative with 2 seedling weeks; with 1 it still is, but day 10
    // has moved from seedling to vegetative.
    expect(appliesInCurrentStage("ws-1", "seedling", new Date("2026-01-10T12:00:00.000Z"))).toBe(false);
    expect(appliesInCurrentStage("ws-1", "vegetative", new Date("2026-01-10T12:00:00.000Z"))).toBe(true);
  });
});

describe("activeGrowFor", () => {
  it("returns the grow, or null when none is running", () => {
    const g = grow("2026-01-01T00:00:00.000Z");
    setActiveGrowsForTesting([["ws-1", g], ["ws-2", null]]);
    expect(activeGrowFor("ws-1")).toBe(g);
    expect(activeGrowFor("ws-2")).toBeNull();
    expect(activeGrowFor("ws-3")).toBeNull();
  });
});
