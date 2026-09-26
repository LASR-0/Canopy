/**
 * Unit — rules engine (Phase 6)
 *
 * The behaviour worth pinning is anti-flap. A sensor sitting on its threshold
 * must not toggle a fan every few seconds: relays and compressors do not
 * survive that, and nothing in the UI would show it happening.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RuleTrigger } from "@canopy/shared-types";

const { mockApplyActions, mockRecordFiring, tableRows } = vi.hoisted(() => ({
  mockApplyActions: vi.fn(async () => true),
  mockRecordFiring: vi.fn(async () => undefined),
  tableRows: { value: [] as unknown[] },
}));

vi.mock("../../src/store/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(tableRows.value) }),
    }),
  },
}));
vi.mock("../../src/automation/apply.js", () => ({
  applyActions: mockApplyActions,
  recordFiring: mockRecordFiring,
}));

const { compare, evaluateRule, onReading, refreshRules, resetRuleState, activeRuleCount } =
  await import("../../src/rules/index.js");
const { setControllerState, resetControllerState } = await import(
  "../../src/controller/state.js"
);

const HOT: RuleTrigger = { kind: "rule", metric: "temperature", comparator: "gt", threshold: 28 };

function ruleRow(trigger: RuleTrigger, overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    workspaceId: "ws-1",
    name: "Exhaust on when hot",
    enabled: true,
    kind: "rule",
    triggerJson: JSON.stringify(trigger),
    actionsJson: JSON.stringify([{ role: "exhaust", command: { op: "on" } }]),
    overrideUntil: null,
    ...overrides,
  };
}

function reading(value: number, metric = "temperature") {
  return {
    workspaceId: "ws-1",
    deviceId: "dev-1",
    channel: "canopy-temp",
    metric,
    unit: "C",
    value,
    ts: "2026-09-26T12:00:00.000Z",
  } as const;
}

const T0 = new Date("2026-09-26T12:00:00Z");
const at = (secondsLater: number) => new Date(T0.getTime() + secondsLater * 1000);

beforeEach(async () => {
  vi.clearAllMocks();
  resetRuleState();
  resetControllerState();
  mockApplyActions.mockResolvedValue(true);
  tableRows.value = [ruleRow(HOT)];
  await refreshRules();
});

describe("compare", () => {
  it.each([
    ["gt", 29, true],
    ["gt", 28, false],
    ["gte", 28, true],
    ["lt", 27, true],
    ["lt", 28, false],
    ["lte", 28, true],
  ] as const)("%s %s", (comparator, value, expected) => {
    expect(compare(value, comparator, 28)).toBe(expected);
  });
});

describe("evaluateRule", () => {
  it("fires on the transition into the condition", () => {
    const { fire, next } = evaluateRule(HOT, 30, undefined, 0);

    expect(fire).toBe(true);
    expect(next.fired).toBe(true);
  });

  it("does not fire again while the condition stays true", () => {
    const first = evaluateRule(HOT, 30, undefined, 0);
    const second = evaluateRule(HOT, 31, first.next, 1000);

    expect(second.fire).toBe(false);
  });

  it("re-arms once the condition lapses, so the next crossing fires", () => {
    const first = evaluateRule(HOT, 30, undefined, 0);
    const lapsed = evaluateRule(HOT, 20, first.next, 1000);
    const again = evaluateRule(HOT, 30, lapsed.next, 2000);

    expect(lapsed.fire).toBe(false);
    expect(again.fire).toBe(true);
  });

  it("holds until the dwell has elapsed", () => {
    const dwell: RuleTrigger = { ...HOT, forSeconds: 60 };

    const start = evaluateRule(dwell, 30, undefined, 0);
    expect(start.fire).toBe(false);

    const halfway = evaluateRule(dwell, 30, start.next, 30_000);
    expect(halfway.fire).toBe(false);

    const elapsed = evaluateRule(dwell, 30, halfway.next, 60_000);
    expect(elapsed.fire).toBe(true);
  });

  it("resets the dwell when the condition lapses, so a spike cannot accumulate", () => {
    const dwell: RuleTrigger = { ...HOT, forSeconds: 60 };

    const start = evaluateRule(dwell, 30, undefined, 0);
    const dipped = evaluateRule(dwell, 20, start.next, 30_000);
    const hotAgain = evaluateRule(dwell, 30, dipped.next, 31_000);
    // 61s after the first crossing, but only 0s into this one.
    const later = evaluateRule(dwell, 30, hotAgain.next, 61_000);

    expect(later.fire).toBe(false);
  });

  it("treats a single noisy sample as nothing when a dwell is set", () => {
    const dwell: RuleTrigger = { ...HOT, forSeconds: 30 };

    const spike = evaluateRule(dwell, 45, undefined, 0);
    const normal = evaluateRule(dwell, 24, spike.next, 5_000);

    expect(spike.fire).toBe(false);
    expect(normal.fire).toBe(false);
  });
});

describe("onReading", () => {
  it("drives the actions when a reading crosses the threshold", async () => {
    const fired = await onReading(reading(30), T0);

    expect(fired).toBe(1);
    expect(mockApplyActions).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Exhaust on when hot" }),
      [{ role: "exhaust", command: { op: "on" } }],
      "rules",
    );
  });

  it("does nothing while the reading is within range", async () => {
    await onReading(reading(24), T0);

    expect(mockApplyActions).not.toHaveBeenCalled();
  });

  it("does not re-fire on every reading while the tent stays hot", async () => {
    await onReading(reading(30), T0);
    await onReading(reading(31), at(5));
    await onReading(reading(32), at(10));

    expect(mockApplyActions).toHaveBeenCalledTimes(1);
  });

  it("fires again after the condition clears and returns", async () => {
    await onReading(reading(30), T0);
    await onReading(reading(24), at(5));
    await onReading(reading(30), at(10));

    expect(mockApplyActions).toHaveBeenCalledTimes(2);
  });

  it("ignores readings for a metric no rule watches", async () => {
    await onReading(reading(95, "humidity"), T0);

    expect(mockApplyActions).not.toHaveBeenCalled();
  });

  it("ignores readings from another workspace", async () => {
    await onReading({ ...reading(30), workspaceId: "ws-2" }, T0);

    expect(mockApplyActions).not.toHaveBeenCalled();
  });

  it("stays armed when nothing reached hardware, and retries", async () => {
    mockApplyActions.mockResolvedValueOnce(false);
    await onReading(reading(30), T0);
    expect(mockRecordFiring).not.toHaveBeenCalled();

    await onReading(reading(31), at(5));

    expect(mockApplyActions).toHaveBeenCalledTimes(2);
    expect(mockRecordFiring).toHaveBeenCalledTimes(1);
  });

  it("records the firing with the value that caused it", async () => {
    await onReading(reading(30), T0);

    expect(mockRecordFiring).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rule-1" }),
      expect.stringContaining("30"),
      T0,
    );
  });

  it("respects an unexpired override", async () => {
    tableRows.value = [ruleRow(HOT, { overrideUntil: "2026-09-26T23:00:00.000Z" })];
    await refreshRules();

    await onReading(reading(30), T0);

    expect(mockApplyActions).not.toHaveBeenCalled();
  });

  it.each(["paused", "stopped"] as const)("does not drive hardware while %s", async (state) => {
    setControllerState(state);

    const fired = await onReading(reading(30), T0);

    expect(fired).toBe(0);
    expect(mockApplyActions).not.toHaveBeenCalled();
  });

  it("applies a dwell across successive readings", async () => {
    tableRows.value = [ruleRow({ ...HOT, forSeconds: 60 })];
    await refreshRules();

    await onReading(reading(30), T0);
    await onReading(reading(30), at(30));
    expect(mockApplyActions).not.toHaveBeenCalled();

    await onReading(reading(30), at(61));
    expect(mockApplyActions).toHaveBeenCalledTimes(1);
  });
});

describe("refreshRules", () => {
  it("arms only rule-kind automations", async () => {
    tableRows.value = [
      ruleRow(HOT),
      ruleRow({ kind: "schedule", cron: "0 6 * * *" } as never, { id: "rule-2" }),
    ];
    await refreshRules();

    expect(activeRuleCount()).toBe(1);
  });

  it("skips an automation with unreadable JSON rather than failing the reload", async () => {
    tableRows.value = [ruleRow(HOT), { ...ruleRow(HOT), id: "rule-2", triggerJson: "{ broken" }];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await refreshRules();

    expect(activeRuleCount()).toBe(1);
    consoleError.mockRestore();
  });
});
