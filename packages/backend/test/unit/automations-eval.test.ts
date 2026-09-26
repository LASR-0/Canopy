/**
 * Unit — automation evaluation (Phase 5)
 *
 * The behaviour worth pinning is the difference between a window and a cron
 * trigger: a window is a state that must be re-derived after a restart, a cron
 * is an event that must not be replayed. Both failure modes are silent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { automations, roleAssignments, workspaces } from "../../src/store/schema.js";

const { mockActuate, mockBroadcast, mockInsertValues, tableRows } = vi.hoisted(() => ({
  mockActuate: vi.fn(async () => ({ ok: true as const, sent: { topic: "t", payload: "p" }, channel: "ch" })),
  mockBroadcast: vi.fn(),
  mockInsertValues: vi.fn(async () => undefined),
  tableRows: new Map<unknown, unknown[]>(),
}));

vi.mock("../../src/store/index.js", () => ({
  db: {
    // `.from(table)` is awaitable on its own and also chains `.where()`, which
    // covers both shapes the evaluator uses.
    select: () => ({
      from: (table: unknown) => {
        const rows = tableRows.get(table) ?? [];
        return Object.assign(Promise.resolve(rows), { where: () => Promise.resolve(rows) });
      },
    }),
    insert: () => ({ values: mockInsertValues }),
  },
}));
vi.mock("../../src/device-manager/actuate.js", () => ({ actuateDevice: mockActuate }));
vi.mock("../../src/ws/index.js", () => ({ broadcast: mockBroadcast }));

const { evaluateAutomations, resetAutomationState, windowActions, stateKey } = await import(
  "../../src/scheduler/automations.js"
);
const { setControllerState, resetControllerState } = await import(
  "../../src/controller/state.js"
);

/** An automations-table row as the store would return it. */
function automationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "auto-1",
    workspaceId: "ws-1",
    name: "Photoperiod",
    enabled: true,
    kind: "schedule",
    subsystem: "lighting",
    driver: "schedule",
    actuatorRole: null,
    controlRes: null,
    requiresRole: null,
    triggerJson: JSON.stringify({ kind: "window", on: "06:00", off: "18:00" }),
    actionsJson: JSON.stringify([{ role: "light", command: { op: "level", value: 80 } }]),
    stage: null,
    overrideUntil: null,
    overrideState: null,
    sortOrder: 0,
    ...overrides,
  };
}

const NOON = new Date("2026-09-26T12:00:00Z");
const MIDNIGHT = new Date("2026-09-26T00:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  resetAutomationState();
  resetControllerState();
  mockActuate.mockResolvedValue({ ok: true, sent: { topic: "t", payload: "p" }, channel: "ch" });

  tableRows.set(automations, [automationRow()]);
  tableRows.set(workspaces, [{ id: "ws-1", timezone: "UTC" }]);
  tableRows.set(roleAssignments, [{ deviceId: "dev-1", channel: "light-0" }]);
});

describe("windowActions", () => {
  const actions = [{ role: "light" as const, command: { op: "level" as const, value: 80 } }];

  it("keeps the configured state inside the window", () => {
    expect(windowActions(actions, true)).toEqual(actions);
  });

  it("drives every targeted role off outside the window", () => {
    expect(windowActions(actions, false)).toEqual([{ role: "light", command: { op: "off" } }]);
  });
});

describe("stateKey", () => {
  it("is order-independent, so reordering actions is not a state change", () => {
    const a = [
      { role: "light" as const, command: { op: "on" as const } },
      { role: "exhaust" as const, command: { op: "off" as const } },
    ];
    expect(stateKey(a)).toBe(stateKey([...a].reverse()));
  });

  it("changes when a level changes", () => {
    const at80 = [{ role: "light" as const, command: { op: "level" as const, value: 80 } }];
    const at50 = [{ role: "light" as const, command: { op: "level" as const, value: 50 } }];
    expect(stateKey(at80)).not.toBe(stateKey(at50));
  });
});

describe("evaluateAutomations — window triggers", () => {
  it("drives the configured state inside the window", async () => {
    const outcome = await evaluateAutomations(NOON);

    expect(outcome.fired).toBe(1);
    expect(mockActuate).toHaveBeenCalledWith("dev-1", { op: "level", value: 80 }, "light-0");
  });

  it("drives off outside the window", async () => {
    const outcome = await evaluateAutomations(MIDNIGHT);

    expect(outcome.fired).toBe(1);
    expect(mockActuate).toHaveBeenCalledWith("dev-1", { op: "off" }, "light-0");
  });

  it("does not resend an unchanged state every tick", async () => {
    await evaluateAutomations(NOON);
    await evaluateAutomations(new Date("2026-09-26T12:01:00Z"));
    await evaluateAutomations(new Date("2026-09-26T12:02:00Z"));

    expect(mockActuate).toHaveBeenCalledTimes(1);
  });

  it("acts again when the window boundary is crossed", async () => {
    await evaluateAutomations(NOON);
    await evaluateAutomations(new Date("2026-09-26T18:30:00Z"));

    expect(mockActuate).toHaveBeenCalledTimes(2);
    expect(mockActuate).toHaveBeenLastCalledWith("dev-1", { op: "off" }, "light-0");
  });

  it("re-derives the state after a restart, so a reboot mid-window fixes the lights", async () => {
    await evaluateAutomations(NOON);
    expect(mockActuate).toHaveBeenCalledTimes(1);

    // A restart loses the in-memory applied state.
    resetAutomationState();
    await evaluateAutomations(new Date("2026-09-26T12:05:00Z"));

    expect(mockActuate).toHaveBeenCalledTimes(2);
    expect(mockActuate).toHaveBeenLastCalledWith("dev-1", { op: "level", value: 80 }, "light-0");
  });

  it("retries later when no device holds the role yet", async () => {
    tableRows.set(roleAssignments, []);
    await evaluateAutomations(NOON);
    expect(mockActuate).not.toHaveBeenCalled();

    // The user assigns a device; the next tick must pick it up rather than
    // believing the state was already applied.
    tableRows.set(roleAssignments, [{ deviceId: "dev-1", channel: "light-0" }]);
    await evaluateAutomations(new Date("2026-09-26T12:01:00Z"));

    expect(mockActuate).toHaveBeenCalledTimes(1);
  });

  it("does not remember a state the device refused", async () => {
    mockActuate.mockResolvedValue({ ok: false, code: "device_unreachable", message: "down" } as never);
    await evaluateAutomations(NOON);

    mockActuate.mockResolvedValue({ ok: true, sent: { topic: "t", payload: "p" }, channel: "ch" });
    await evaluateAutomations(new Date("2026-09-26T12:01:00Z"));

    expect(mockActuate).toHaveBeenCalledTimes(2);
  });

  it("drives every device holding the role, not just the first", async () => {
    tableRows.set(roleAssignments, [
      { deviceId: "dev-1", channel: "a" },
      { deviceId: "dev-2", channel: "b" },
    ]);

    await evaluateAutomations(NOON);

    expect(mockActuate).toHaveBeenCalledTimes(2);
  });

  it("uses the workspace timezone rather than the host clock", async () => {
    tableRows.set(workspaces, [{ id: "ws-1", timezone: "Australia/Brisbane" }]);

    // 22:00 UTC is 08:00 next day in Brisbane, inside the 06:00-18:00 window.
    await evaluateAutomations(new Date("2026-09-26T22:00:00Z"));

    expect(mockActuate).toHaveBeenCalledWith("dev-1", { op: "level", value: 80 }, "light-0");
  });

  it("records an event and pushes it so the activity feed sees the change", async () => {
    await evaluateAutomations(NOON);

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ type: "automation_fired", sourceLabel: "Photoperiod" }),
    );
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "automation.fired" }),
    );
  });

  it("skips an automation whose window is unreadable", async () => {
    tableRows.set(automations, [
      automationRow({ triggerJson: JSON.stringify({ kind: "window", on: "6pm", off: "18:00" }) }),
    ]);

    const outcome = await evaluateAutomations(NOON);

    expect(outcome.skipped).toBe(1);
    expect(mockActuate).not.toHaveBeenCalled();
  });

  it("skips an automation held by an unexpired override", async () => {
    tableRows.set(automations, [
      automationRow({ overrideUntil: "2026-09-26T23:00:00.000Z" }),
    ]);

    const outcome = await evaluateAutomations(NOON);

    expect(outcome.skipped).toBe(1);
    expect(mockActuate).not.toHaveBeenCalled();
  });

  it("resumes once the override has expired", async () => {
    tableRows.set(automations, [
      automationRow({ overrideUntil: "2026-09-26T09:00:00.000Z" }),
    ]);

    await evaluateAutomations(NOON);

    expect(mockActuate).toHaveBeenCalledTimes(1);
  });
});

describe("evaluateAutomations — cron triggers", () => {
  beforeEach(() => {
    tableRows.set(automations, [
      automationRow({
        triggerJson: JSON.stringify({ kind: "schedule", cron: "0 6 * * *" }),
        actionsJson: JSON.stringify([{ role: "pump", command: { op: "on" } }]),
      }),
    ]);
  });

  it("does not replay past occurrences on the first tick after a restart", async () => {
    await evaluateAutomations(new Date("2026-09-26T12:00:00Z"));

    expect(mockActuate).not.toHaveBeenCalled();
  });

  it("fires when an occurrence falls in the elapsed interval", async () => {
    await evaluateAutomations(new Date("2026-09-26T05:59:00Z"));
    await evaluateAutomations(new Date("2026-09-26T06:01:00Z"));

    expect(mockActuate).toHaveBeenCalledWith("dev-1", { op: "on" }, "light-0");
  });

  it("fires once, not on every following tick", async () => {
    await evaluateAutomations(new Date("2026-09-26T05:59:00Z"));
    await evaluateAutomations(new Date("2026-09-26T06:01:00Z"));
    await evaluateAutomations(new Date("2026-09-26T06:02:00Z"));
    await evaluateAutomations(new Date("2026-09-26T06:03:00Z"));

    expect(mockActuate).toHaveBeenCalledTimes(1);
  });
});

describe("evaluateAutomations — lifecycle", () => {
  it.each(["paused", "stopped"] as const)("does nothing while %s", async (state) => {
    setControllerState(state);

    const outcome = await evaluateAutomations(NOON);

    expect(outcome.evaluated).toBe(0);
    expect(mockActuate).not.toHaveBeenCalled();
  });

  it("ignores disabled automations", async () => {
    // The query filters on enabled, so an empty result stands in for it.
    tableRows.set(automations, []);

    const outcome = await evaluateAutomations(NOON);

    expect(outcome.evaluated).toBe(0);
  });
});
