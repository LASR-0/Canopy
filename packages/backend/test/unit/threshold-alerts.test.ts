/**
 * Unit — threshold alerts (Phase 6)
 *
 * The point of these is the activity feed staying readable. A row per reading
 * that is still too hot buries the crossing that mattered, and the feed is what
 * a grower scans first when something looks wrong.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { evalThreshold, thresholdFor, type SensorThreshold } from "@canopy/shared-types";

const { mockRecordEvent, rows } = vi.hoisted(() => ({
  mockRecordEvent: vi.fn(async () => undefined),
  rows: { thresholds: [] as unknown[], workspaces: [] as unknown[], grows: [] as unknown[] },
}));

vi.mock("../../src/store/index.js", () => ({
  db: {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: { _?: { name?: string } }) => {
        // Only the workspaces query selects explicit fields, which is enough to
        // tell the three reads apart without importing the schema objects.
        const pick = fields ? rows.workspaces : tableFor(table);
        return Object.assign(Promise.resolve(pick), { where: () => Promise.resolve(rows.grows) });
      },
    }),
  },
}));
vi.mock("../../src/automation/apply.js", () => ({ recordEvent: mockRecordEvent }));

function tableFor(_table: unknown): unknown[] {
  return rows.thresholds;
}

const { checkThresholds, refreshThresholds, resetThresholdState } = await import(
  "../../src/rules/thresholds.js"
);

const BAND: SensorThreshold = {
  id: "t-1",
  workspaceId: "ws-1",
  metric: "temperature",
  minValue: 18,
  maxValue: 28,
  unit: "C",
};

function reading(value: number) {
  return {
    workspaceId: "ws-1",
    deviceId: "dev-1",
    channel: "canopy-temp",
    metric: "temperature",
    unit: "C",
    value,
    ts: "2026-09-26T12:00:00.000Z",
  } as const;
}

const T0 = new Date("2026-09-26T12:00:00Z");

beforeEach(async () => {
  vi.clearAllMocks();
  resetThresholdState();
  rows.thresholds = [{ ...BAND, stage: null }];
  rows.workspaces = [{ id: "ws-1", activeGrowId: null }];
  rows.grows = [];
  await refreshThresholds();
});

describe("evalThreshold (shared with the UI)", () => {
  it("is ok comfortably inside the band", () => {
    expect(evalThreshold(23, "temperature", [BAND])).toBe("ok");
  });

  it("warns inside the shoulder before a hard breach", () => {
    // 10% of a 10-wide band is 1, so 18-19 and 27-28 are the shoulders.
    expect(evalThreshold(18.5, "temperature", [BAND])).toBe("warn");
    expect(evalThreshold(27.5, "temperature", [BAND])).toBe("warn");
  });

  it("errors outside the band", () => {
    expect(evalThreshold(31, "temperature", [BAND])).toBe("err");
    expect(evalThreshold(10, "temperature", [BAND])).toBe("err");
  });

  it("is ok for a metric nobody configured a band for", () => {
    expect(evalThreshold(999, "co2", [BAND])).toBe("ok");
  });

  it("prefers a stage-scoped band over the workspace default", () => {
    const flowering: SensorThreshold = { ...BAND, id: "t-2", stage: "flowering", maxValue: 24 };

    expect(evalThreshold(26, "temperature", [BAND, flowering], "flowering")).toBe("err");
    expect(evalThreshold(26, "temperature", [BAND, flowering])).toBe("ok");
    expect(thresholdFor("temperature", [BAND, flowering], "flowering")?.id).toBe("t-2");
  });
});

describe("checkThresholds", () => {
  it("says nothing about a healthy channel's first reading", async () => {
    await checkThresholds(reading(23), T0);

    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("records a crossing out of range", async () => {
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), T0);

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "threshold_alert", severity: "err" }),
    );
  });

  it("says which way the reading went", async () => {
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), T0);

    const event = mockRecordEvent.mock.calls[0]?.[0] as { description: string };
    expect(event.description).toContain("above");
    expect(event.description).toContain("18–28");
  });

  it("does not repeat while the reading stays out of range", async () => {
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), T0);
    await checkThresholds(reading(32), T0);
    await checkThresholds(reading(33), T0);

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  it("records the recovery, so the feed's last word is not always alarming", async () => {
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), T0);
    mockRecordEvent.mockClear();

    await checkThresholds(reading(23), T0);

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const event = mockRecordEvent.mock.calls[0]?.[0] as { description: string; severity?: string };
    expect(event.description).toContain("back in range");
    expect(event.severity).toBeUndefined();
  });

  it("treats warn and err as separate crossings worth reporting", async () => {
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(27.5), T0); // warn shoulder
    await checkThresholds(reading(31), T0);   // hard breach

    expect(mockRecordEvent).toHaveBeenCalledTimes(2);
    const severities = mockRecordEvent.mock.calls.map(
      (c) => (c[0] as { severity?: string }).severity,
    );
    expect(severities).toEqual(["warn", "err"]);
  });

  it("tracks channels independently", async () => {
    const other = { ...reading(31), deviceId: "dev-2", channel: "other-temp" };

    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), T0);
    await checkThresholds(other, T0);

    expect(mockRecordEvent).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when the workspace has no bands configured", async () => {
    rows.thresholds = [];
    await refreshThresholds();

    await checkThresholds(reading(999), T0);

    expect(mockRecordEvent).not.toHaveBeenCalled();
  });
});
