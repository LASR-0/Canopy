/**
 * Unit — threshold alerts (Phase 6)
 *
 * The point of these is the activity feed staying readable. A row per reading
 * that is still too hot buries the crossing that mattered, and the feed is what
 * a grower scans first when something looks wrong.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  alertSettingFor,
  alertSettingProblem,
  bandProblem,
  evalThreshold,
  thresholdFor,
  type SensorThreshold,
} from "@canopy/shared-types";

const { mockRecordEvent, rows } = vi.hoisted(() => ({
  mockRecordEvent: vi.fn(async () => undefined),
  rows: {
    thresholds: [] as unknown[],
    alertSettings: [] as unknown[],
    workspaces: [] as unknown[],
    grows: [] as unknown[],
  },
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

const schema = await import("../../src/store/schema.js");

function tableFor(table: unknown): unknown[] {
  return table === schema.thresholdAlertSettings ? rows.alertSettings : rows.thresholds;
}

const { checkThresholds, refreshThresholds, resetThresholdState, RECOVERY_DWELL_MS } = await import(
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
  rows.alertSettings = [];
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

    // A recovery has to hold for the dwell before it is news.
    await checkThresholds(reading(23), T0);
    expect(mockRecordEvent).not.toHaveBeenCalled();
    await checkThresholds(reading(23), new Date(T0.getTime() + RECOVERY_DWELL_MS));

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

describe("alert settings", () => {
  async function withSetting(setting: { enabled?: boolean; warnMarginPct?: number; delaySec?: number }) {
    rows.alertSettings = [
      { workspaceId: "ws-1", metric: "temperature", enabled: true, warnMarginPct: 10, delaySec: 0, ...setting },
    ];
    await refreshThresholds();
  }
  const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

  it("widens the warning shoulder with the margin, as the card does", async () => {
    // 30 % of a 10-wide band is 3, so 25.5 is drifting rather than fine.
    expect(evalThreshold(25.5, "temperature", [BAND])).toBe("ok");
    expect(evalThreshold(25.5, "temperature", [BAND], undefined, 30)).toBe("warn");

    await withSetting({ warnMarginPct: 30 });
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(25.5), T0);
    expect(mockRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "warn" }));
  });

  it("never warns with a margin of 0, only breaches", () => {
    expect(evalThreshold(18.01, "temperature", [BAND], undefined, 0)).toBe("ok");
    expect(evalThreshold(17.99, "temperature", [BAND], undefined, 0)).toBe("err");
  });

  it("records nothing for a metric with alerts turned off", async () => {
    await withSetting({ enabled: false });
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), T0);
    await checkThresholds(reading(23), T0);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("does not report a breach that held while alerts were off once they are back on", async () => {
    await withSetting({ enabled: false });
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), T0);

    await withSetting({ enabled: true });
    await checkThresholds(reading(31), at(60));
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("holds a breach back until it has lasted the delay", async () => {
    await withSetting({ delaySec: 120 });
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), at(0));
    await checkThresholds(reading(31), at(119));
    expect(mockRecordEvent).not.toHaveBeenCalled();

    await checkThresholds(reading(31), at(120));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  it("never reports a breach that recovers inside the delay", async () => {
    await withSetting({ delaySec: 120 });
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), at(0));
    await checkThresholds(reading(23), at(60)); // door closed again
    await checkThresholds(reading(31), at(90)); // a new excursion restarts the clock
    await checkThresholds(reading(31), at(200));
    expect(mockRecordEvent).not.toHaveBeenCalled();

    await checkThresholds(reading(31), at(210));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  it("times warn-then-err from the first worse reading", async () => {
    await withSetting({ delaySec: 120 });
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(27.5), at(0)); // warn
    await checkThresholds(reading(31), at(100)); // err, still inside the delay
    await checkThresholds(reading(31), at(120));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "err" }));
  });

  it("holds a recovery to the dwell, not to the escalation delay", async () => {
    await withSetting({ delaySec: 300 });
    await checkThresholds(reading(23), T0);
    await checkThresholds(reading(31), at(0));
    await checkThresholds(reading(31), at(300));
    mockRecordEvent.mockClear();

    await checkThresholds(reading(23), at(301));
    await checkThresholds(reading(23), at(301 + RECOVERY_DWELL_MS / 1000));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });
});

describe("validation", () => {
  it("rejects an inverted or empty band", () => {
    expect(bandProblem(18, 28)).toBeNull();
    expect(bandProblem(28, 18)).toMatch(/below/);
    expect(bandProblem(20, 20)).toMatch(/below/);
    expect(bandProblem(Number.NaN, 20)).toMatch(/numbers/);
  });

  it("keeps the margin under the point where the shoulders meet", () => {
    expect(alertSettingProblem({ warnMarginPct: 40 })).toBeNull();
    expect(alertSettingProblem({ warnMarginPct: 41 })).toMatch(/0 and 40/);
    expect(alertSettingProblem({ warnMarginPct: -1 })).toMatch(/0 and 40/);
  });

  it("wants the delay in whole seconds, up to an hour", () => {
    expect(alertSettingProblem({ delaySec: 3600 })).toBeNull();
    expect(alertSettingProblem({ delaySec: 3601 })).toMatch(/3600/);
    expect(alertSettingProblem({ delaySec: 1.5 })).toMatch(/whole/);
  });

  it("falls back to the default behaviour for a metric with no setting", () => {
    expect(alertSettingFor("co2", [])).toEqual({ enabled: true, warnMarginPct: 10, delaySec: 0 });
  });
});

describe("hysteresis", () => {
  const SOIL = { id: "t-soil", workspaceId: "ws-1", metric: "soil_moisture", minValue: 45, maxValue: 60, unit: "percent", stage: null };
  const soil = (value: number) => ({ ...reading(value), channel: "rootzone-moisture", metric: "soil_moisture", unit: "percent" }) as never;
  const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

  beforeEach(async () => {
    rows.thresholds = [SOIL];
    await refreshThresholds();
  });

  it("reports an edge-sitting reading once, not once per flicker", async () => {
    // The live sequence: 13,387 alerts a day came from readings like these,
    // every five seconds, against 45–60 % (warn below 46.5 %).
    const wander = [46.7, 44.7, 45.0, 46.4, 46.7, 44.8, 45.0, 46.3, 46.7, 46.4, 46.5, 44.9, 46.7];
    await checkThresholds(soil(50), at(0));
    for (let i = 0; i < wander.length; i++) await checkThresholds(soil(wander[i]!), at(5 + i * 5));

    // One excursion out of range, reported once. No recoveries: none held.
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "err" }));
  });

  it("does not count a reading as recovered until it clears the edge by the deadband", async () => {
    await checkThresholds(soil(50), at(0));
    await checkThresholds(soil(44), at(5)); // breach
    mockRecordEvent.mockClear();

    // 45.5 is inside 45–60, but not by the 0.75 deadband: still breached.
    await checkThresholds(soil(45.5), at(10));
    await checkThresholds(soil(45.5), at(200));
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("records a recovery that clears the deadband and holds", async () => {
    await checkThresholds(soil(50), at(0));
    await checkThresholds(soil(44), at(5));
    mockRecordEvent.mockClear();

    await checkThresholds(soil(52), at(10));
    await checkThresholds(soil(52), at(70));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const event = mockRecordEvent.mock.calls[0]?.[0] as { description: string; severity?: string };
    expect(event.description).toContain("back in range");
  });

  it("steps down to warn when the reading only clears as far as the shoulder", async () => {
    await checkThresholds(soil(50), at(0));
    await checkThresholds(soil(44), at(5));
    mockRecordEvent.mockClear();

    // 46.2: clear of the breach edge by more than the deadband, still in the shoulder.
    await checkThresholds(soil(46.2), at(10));
    await checkThresholds(soil(46.2), at(70));
    expect(mockRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ severity: "warn" }));
  });
});
