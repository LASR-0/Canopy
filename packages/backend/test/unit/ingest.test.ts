/**
 * Unit — telemetry ingestion (Phase 3)
 *
 * Covers the three things that decide whether a broker message becomes a row in
 * readings_raw: payload coercion, the topic index, and the handler that joins
 * them to the database and the websocket.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Capability } from "@canopy/shared-types";

// ── Mocks, hoisted above the module under test ───────────────────────────────
//
// The Drizzle chain is hand-rolled rather than taken from createDbMock(): that
// helper's proxy answers `then` with another chainable mock, so awaiting an
// insert would never settle.
const { mockInsertValues, mockBroadcast, mockRecordHeartbeat } = vi.hoisted(() => ({
  mockInsertValues: vi.fn(async (_row: unknown) => undefined),
  mockBroadcast: vi.fn(),
  mockRecordHeartbeat: vi.fn(async (_deviceId: string) => undefined),
}));

vi.mock("../../src/store/index.js", () => ({
  db: { insert: () => ({ values: mockInsertValues }) },
}));
vi.mock("../../src/ws/index.js", () => ({ broadcast: mockBroadcast }));
vi.mock("../../src/device-manager/heartbeat.js", () => ({
  recordHeartbeat: mockRecordHeartbeat,
}));

const {
  buildTopicIndex,
  handleTelemetry,
  indexedTopicCount,
  parseNumericPayload,
  resetIngestState,
  setTopicIndexForTesting,
} = await import("../../src/device-manager/ingest.js");

const { setControllerState, resetControllerState } = await import(
  "../../src/controller/state.js"
);

// ── Fixtures ─────────────────────────────────────────────────────────────────
const tempSensor: Capability = {
  kind: "sensor",
  channel: "canopy-temp",
  metric: "temperature",
  unit: "C",
  stateTopic: "canopy/canopy-temp/state",
};

const fanActuator: Capability = {
  kind: "actuator",
  channel: "exhaust-fan",
  actuator: "fan",
  variable: false,
  stateTopic: "canopy/exhaust-fan/state",
  commandTopic: "canopy/exhaust-fan/set",
};

/** A sensor whose firmware declared no state topic. */
const untopicedSensor: Capability = {
  kind: "sensor",
  channel: "mystery",
  metric: "humidity",
  unit: "percent",
};

const oneDevice = [
  { id: "dev-1", workspaceId: "ws-1", capabilities: [tempSensor, fanActuator] },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetIngestState();
  resetControllerState();
});

describe("parseNumericPayload", () => {
  it.each([
    ["24.5", 24.5],
    ["0", 0],
    ["-3.25", -3.25],
    ["  61.2  ", 61.2],
    ["1200", 1200],
  ])("reads the bare numeric payload %s", (input, expected) => {
    expect(parseNumericPayload(Buffer.from(input))).toBe(expected);
  });

  it.each([
    ['{"value":24.5}', 24.5],
    ['{"state":"61.2"}', 61.2],
    ['{"tC":19.875}', 19.875],
  ])("reads a conventional key out of the JSON payload %s", (input, expected) => {
    expect(parseNumericPayload(Buffer.from(input))).toBe(expected);
  });

  it.each([
    ["ON"],
    ["OFF"],
    ["true"],
    [""],
    ["   "],
    ["not a number"],
    ['{"unrecognised":5}'],
    ["{ broken json"],
    ['{"value":"abc"}'],
  ])("returns null for %s, which carries no measurement", (input) => {
    expect(parseNumericPayload(Buffer.from(input))).toBeNull();
  });

  it("rejects a non-finite payload rather than storing Infinity", () => {
    expect(parseNumericPayload(Buffer.from("Infinity"))).toBeNull();
    expect(parseNumericPayload(Buffer.from("NaN"))).toBeNull();
  });
});

describe("buildTopicIndex", () => {
  it("indexes a sensor channel under the topic it publishes on", () => {
    const { sensors } = buildTopicIndex(oneDevice);

    expect(sensors.get("canopy/canopy-temp/state")).toEqual({
      deviceId: "dev-1",
      workspaceId: "ws-1",
      channel: "canopy-temp",
      metric: "temperature",
      unit: "C",
    });
  });

  it("claims actuator topics for heartbeats but not as reading sources", () => {
    const { sensors, owners } = buildTopicIndex(oneDevice);

    expect(owners.get("canopy/exhaust-fan/state")).toBe("dev-1");
    expect(sensors.has("canopy/exhaust-fan/state")).toBe(false);
  });

  it("skips capabilities that declared no state topic", () => {
    const { sensors, owners } = buildTopicIndex([
      { id: "dev-2", workspaceId: "ws-1", capabilities: [untopicedSensor] },
    ]);

    expect(sensors.size).toBe(0);
    expect(owners.size).toBe(0);
  });

  it("gives a contested topic to the first claimant instead of the last", () => {
    const { sensors } = buildTopicIndex([
      { id: "dev-1", workspaceId: "ws-1", capabilities: [tempSensor] },
      { id: "dev-2", workspaceId: "ws-1", capabilities: [tempSensor] },
    ]);

    expect(sensors.get("canopy/canopy-temp/state")?.deviceId).toBe("dev-1");
  });
});

describe("handleTelemetry", () => {
  beforeEach(() => setTopicIndexForTesting(oneDevice));

  it("persists a reading and pushes it to connected clients", async () => {
    await handleTelemetry("canopy/canopy-temp/state", Buffer.from("24.5"));

    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        deviceId: "dev-1",
        channel: "canopy-temp",
        metric: "temperature",
        unit: "C",
        value: 24.5,
      }),
    );

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: "reading",
      payload: expect.objectContaining({ deviceId: "dev-1", value: 24.5 }),
    });
  });

  it("stamps the row and the pushed reading with the same timestamp", async () => {
    await handleTelemetry("canopy/canopy-temp/state", Buffer.from("24.5"));

    const row = mockInsertValues.mock.calls[0]?.[0] as { recordedAt: string };
    const pushed = mockBroadcast.mock.calls[0]?.[0] as { payload: { ts: string } };

    expect(row.recordedAt).toBe(pushed.payload.ts);
    expect(Number.isNaN(Date.parse(row.recordedAt))).toBe(false);
  });

  it("ignores a topic no device has claimed, without touching the database", async () => {
    await handleTelemetry("homeassistant/sensor/whatever/config", Buffer.from("24.5"));

    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(mockRecordHeartbeat).not.toHaveBeenCalled();
  });

  it("treats an actuator's state as proof of life, not as a reading", async () => {
    await handleTelemetry("canopy/exhaust-fan/state", Buffer.from("ON"));

    expect(mockRecordHeartbeat).toHaveBeenCalledWith("dev-1");
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("keeps the heartbeat but drops the reading when a sensor payload is unusable", async () => {
    await handleTelemetry("canopy/canopy-temp/state", Buffer.from("unavailable"));

    expect(mockRecordHeartbeat).toHaveBeenCalledWith("dev-1");
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("throttles heartbeat writes across a burst of messages", async () => {
    for (let i = 0; i < 5; i++) {
      await handleTelemetry("canopy/canopy-temp/state", Buffer.from(String(20 + i)));
    }

    expect(mockInsertValues).toHaveBeenCalledTimes(5);
    expect(mockRecordHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast a reading that failed to persist", async () => {
    mockInsertValues.mockRejectedValueOnce(new Error("disk full"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await handleTelemetry("canopy/canopy-temp/state", Buffer.from("24.5"));

    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reports how many topics are being watched", () => {
    expect(indexedTopicCount()).toBe(2);
  });

  it("keeps recording while the controller is paused, since pausing only stops acting", async () => {
    setControllerState("paused");

    await handleTelemetry("canopy/canopy-temp/state", Buffer.from("24.5"));

    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
  });

  it("stops recording while the controller is stopped", async () => {
    setControllerState("stopped");

    await handleTelemetry("canopy/canopy-temp/state", Buffer.from("24.5"));

    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(mockRecordHeartbeat).not.toHaveBeenCalled();
  });
});
