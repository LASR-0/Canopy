/**
 * Unit — actuateDevice (Phase 4)
 *
 * Covers what happens around the encoder: resolving the device, refusing
 * requests that cannot be honoured, and distinguishing a bad request from a
 * broker that is simply down.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Capability } from "@canopy/shared-types";

const { mockSelectWhere, mockPublish, mockIsBrokerOnline } = vi.hoisted(() => ({
  mockSelectWhere: vi.fn(async () => [] as unknown[]),
  mockPublish: vi.fn(async (_topic: string, _payload: string) => undefined),
  mockIsBrokerOnline: vi.fn(() => true),
}));

vi.mock("../../src/store/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: mockSelectWhere }) }) },
}));
vi.mock("../../src/broker/index.js", () => ({
  publishToBroker: mockPublish,
  isBrokerOnline: mockIsBrokerOnline,
}));

const { actuateDevice } = await import("../../src/device-manager/actuate.js");
const { setControllerState, resetControllerState } = await import(
  "../../src/controller/state.js"
);

const pumpCap: Capability = {
  kind: "actuator",
  channel: "water-pump",
  actuator: "switch",
  variable: false,
  commandTopic: "canopy/water-pump/set",
  stateTopic: "canopy/water-pump/state",
};

/** A devices-table row as the store would return it. */
function deviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dev-1",
    workspaceId: "ws-1",
    family: "generic-mqtt",
    forgotten: false,
    capabilitiesJson: JSON.stringify([pumpCap]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetControllerState();
  mockIsBrokerOnline.mockReturnValue(true);
  mockPublish.mockResolvedValue(undefined);
  mockSelectWhere.mockResolvedValue([deviceRow()]);
});

describe("actuateDevice", () => {
  it("publishes the encoded command and reports what it sent", async () => {
    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.sent).toEqual({
      topic: "canopy/water-pump/set",
      payload: "ON",
    });
    expect(result.ok && result.channel).toBe("water-pump");
    expect(mockPublish).toHaveBeenCalledWith("canopy/water-pump/set", "ON");
  });

  it("encodes through the device's own family, not a default", async () => {
    mockSelectWhere.mockResolvedValue([
      deviceRow({
        family: "shelly",
        capabilitiesJson: JSON.stringify([
          { ...pumpCap, channel: "relay:0", commandTopic: "shellies/x/relay/0/command" },
        ]),
      }),
    ]);

    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok && result.sent.payload).toBe("on");
  });

  it("reports an unknown device as not found and publishes nothing", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const result = await actuateDevice("nope", { op: "on" });

    expect(result.ok === false && result.code).toBe("not_found");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("refuses to drive a forgotten device", async () => {
    mockSelectWhere.mockResolvedValue([deviceRow({ forgotten: true })]);

    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok === false && result.code).toBe("not_found");
    expect(result.ok === false && result.message).toContain("forgotten");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("treats unreadable capabilities as no actuator rather than crashing", async () => {
    mockSelectWhere.mockResolvedValue([deviceRow({ capabilitiesJson: "{ not json" })]);

    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok === false && result.code).toBe("validation_failed");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("reports a missing command topic as unreachable, not as a bad request", async () => {
    const { commandTopic: _omitted, ...noTopic } = pumpCap as Record<string, unknown>;
    mockSelectWhere.mockResolvedValue([
      deviceRow({ capabilitiesJson: JSON.stringify([noTopic]) }),
    ]);

    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok === false && result.code).toBe("device_unreachable");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("reports a down broker as unreachable", async () => {
    mockIsBrokerOnline.mockReturnValue(false);

    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok === false && result.code).toBe("device_unreachable");
    expect(result.ok === false && result.message).toContain("broker");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("still calls a malformed request malformed while the broker is down", async () => {
    mockIsBrokerOnline.mockReturnValue(false);

    const result = await actuateDevice("dev-1", { op: "level", value: 50 });

    expect(result.ok === false && result.code).toBe("validation_failed");
  });

  it("surfaces a publish failure instead of reporting success", async () => {
    mockPublish.mockRejectedValueOnce(new Error("broker exploded"));

    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok === false && result.code).toBe("device_unreachable");
    expect(result.ok === false && result.message).toContain("broker exploded");
  });

  it.each(["paused", "stopped"] as const)(
    "refuses to drive hardware while %s",
    async (state) => {
      setControllerState(state);

      const result = await actuateDevice("dev-1", { op: "on" });

      expect(result.ok === false && result.code).toBe("controller_paused");
      expect(result.ok === false && result.message).toContain(state);
      expect(mockPublish).not.toHaveBeenCalled();
    },
  );

  it("drives again once resumed", async () => {
    setControllerState("paused");
    await actuateDevice("dev-1", { op: "on" });
    expect(mockPublish).not.toHaveBeenCalled();

    setControllerState("running");
    const result = await actuateDevice("dev-1", { op: "on" });

    expect(result.ok).toBe(true);
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });
});
