/**
 * Unit — broker publish authorization (Tier 1 MQTT hardening)
 *
 * Two things decide whether a client publish reaches the broker: which topics
 * count as command topics, and what the hook does with one. The first is a pure
 * function over capabilities; the second is the hook aedes calls.
 *
 * The property that matters most is negative — that the controller is never
 * refused. It cannot be asserted here, because the controller's publishes never
 * reach this hook at all: `publishToBroker()` calls `Aedes.prototype.publish`,
 * which does not run `authorizePublish`. That is a property of aedes, asserted
 * where it belongs: on the shape of the module under test, which takes a client
 * and a packet and knows nothing about the controller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Capability } from "@canopy/shared-types";

// The module reaches the DB only in refreshCommandTopics(); every test here
// drives the set directly, so the store is stubbed to keep the import cheap.
const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));
vi.mock("../../src/store/index.js", () => ({ db: { select: mockSelect } }));

const {
  authorizeClientPublish,
  buildCommandTopicSet,
  commandTopicCount,
  isCommandTopic,
  refreshCommandTopics,
  resetAclForTesting,
  setCommandTopicsForTesting,
} = await import("../../src/broker/acl.js");

/** The hook's callback, reduced to the only question asked of it. */
function authorize(topic: string, clientId: string | null = "sim-1"): Error | null {
  let outcome: Error | null = null;
  const client = clientId === null ? null : ({ id: clientId } as never);
  authorizeClientPublish(client, { topic } as never, (error) => {
    outcome = error ?? null;
  });
  // Asserted back to the declared type: TS does not track assignment inside the
  // callback and would otherwise narrow this to `null`.
  return outcome as Error | null;
}

const switchCap: Capability = {
  kind: "actuator",
  channel: "relay0",
  actuator: "switch",
  variable: false,
  stateTopic: "tent/fan/state",
  commandTopic: "tent/fan/command",
};

const dimmerCap: Capability = {
  kind: "actuator",
  channel: "light0",
  actuator: "light",
  variable: true,
  stateTopic: "tent/light/state",
  commandTopic: "tent/light/command",
  brightnessCommandTopic: "tent/light/set",
};

const sensorCap: Capability = {
  kind: "sensor",
  channel: "temp",
  metric: "temperature",
  unit: "C",
  stateTopic: "tent/sensor/temp",
};

beforeEach(() => {
  resetAclForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildCommandTopicSet", () => {
  it("collects the command topic of an actuator", () => {
    const set = buildCommandTopicSet([{ capabilities: [switchCap] }]);
    expect([...set]).toEqual(["tent/fan/command"]);
  });

  it("collects the separate brightness topic a dimmer declares", () => {
    const set = buildCommandTopicSet([{ capabilities: [dimmerCap] }]);
    expect(set).toContain("tent/light/command");
    expect(set).toContain("tent/light/set");
  });

  it("does not close a state topic — devices must still publish telemetry", () => {
    const set = buildCommandTopicSet([
      { capabilities: [sensorCap, switchCap, dimmerCap] },
    ]);
    expect(set.has("tent/sensor/temp")).toBe(false);
    expect(set.has("tent/fan/state")).toBe(false);
    expect(set.has("tent/light/state")).toBe(false);
  });

  it("protects a command topic wherever it is declared, including on a sensor", () => {
    // commandTopic lives on the shared MqttTopics interface, so this shape is
    // representable even though adapters do not currently emit it.
    const odd: Capability = { ...sensorCap, commandTopic: "tent/sensor/cmd" };
    const set = buildCommandTopicSet([{ capabilities: [odd] }]);
    expect(set).toContain("tent/sensor/cmd");
  });

  it("skips capabilities with no command topic", () => {
    const noCommand: Capability = {
      kind: "actuator",
      channel: "relay1",
      actuator: "pump",
      variable: false,
      stateTopic: "tent/pump/state",
    };
    expect(buildCommandTopicSet([{ capabilities: [noCommand] }]).size).toBe(0);
  });

  it("deduplicates a topic claimed by two devices", () => {
    const set = buildCommandTopicSet([
      { capabilities: [switchCap] },
      { capabilities: [switchCap] },
    ]);
    expect(set.size).toBe(1);
  });

  it("returns an empty set for a device with no capabilities", () => {
    expect(buildCommandTopicSet([{ capabilities: [] }]).size).toBe(0);
  });
});

describe("authorizeClientPublish", () => {
  beforeEach(() => {
    setCommandTopicsForTesting([{ capabilities: [switchCap, dimmerCap, sensorCap] }]);
  });

  it("refuses a client publishing to a command topic", () => {
    expect(authorize("tent/fan/command")).toBeInstanceOf(Error);
  });

  it("refuses a client publishing to a dimmer's brightness topic", () => {
    expect(authorize("tent/light/set")).toBeInstanceOf(Error);
  });

  it("allows a device to publish its own telemetry", () => {
    expect(authorize("tent/sensor/temp")).toBeNull();
  });

  it("allows an actuator to echo its state — that is how the loop closes", () => {
    expect(authorize("tent/fan/state")).toBeNull();
  });

  it("allows discovery topics, which is how a device gets adopted at all", () => {
    expect(authorize("homeassistant/sensor/tent/config")).toBeNull();
    expect(authorize("shellies/announce")).toBeNull();
  });

  it("refuses a command topic in a will, where aedes passes no client", () => {
    // A device registering a will that switches a pump when it drops off is the
    // reason this is not gated on having a client handle.
    expect(authorize("tent/fan/command", null)).toBeInstanceOf(Error);
  });

  it("keeps refusing $SYS, which overriding the hook would otherwise re-open", () => {
    expect(authorize("$SYS/broker/uptime")).toBeInstanceOf(Error);
  });

  it("matches a topic exactly rather than by prefix", () => {
    expect(authorize("tent/fan/commandeer")).toBeNull();
    expect(authorize("tent/fan")).toBeNull();
  });

  it("authorizes everything when no device is paired", () => {
    // Nothing is closed because nothing is drivable yet. Recorded so that a
    // change to a default-deny posture has to break a test to happen.
    resetAclForTesting();
    expect(authorize("tent/fan/command")).toBeNull();
  });
});

describe("refreshCommandTopics", () => {
  /** Drizzle's select().from() chain, resolved with the given rows. */
  function stubRows(rows: { capabilitiesJson: string }[]): void {
    mockSelect.mockReturnValue({ from: () => Promise.resolve(rows) });
  }

  it("loads command topics from stored capability JSON", async () => {
    stubRows([{ capabilitiesJson: JSON.stringify([switchCap]) }]);
    await refreshCommandTopics();
    expect(isCommandTopic("tent/fan/command")).toBe(true);
  });

  it("includes forgotten devices — forgetting is not unplugging", async () => {
    // The query is deliberately unfiltered, unlike the ingest index. Asserted
    // by its absence: no `where` is called on the chain.
    const from = vi.fn(() => Promise.resolve([
      { capabilitiesJson: JSON.stringify([switchCap]) },
    ]));
    mockSelect.mockReturnValue({ from });
    await refreshCommandTopics();
    expect(from).toHaveBeenCalledTimes(1);
    expect(isCommandTopic("tent/fan/command")).toBe(true);
  });

  it("keeps the previous set when the database read fails", async () => {
    stubRows([{ capabilitiesJson: JSON.stringify([switchCap]) }]);
    await refreshCommandTopics();

    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSelect.mockReturnValue({ from: () => Promise.reject(new Error("db down")) });
    await refreshCommandTopics();

    // An empty ACL authorizes everything, so a transient failure must not clear it.
    expect(isCommandTopic("tent/fan/command")).toBe(true);
  });

  it("survives malformed capability JSON without dropping other devices", async () => {
    stubRows([
      { capabilitiesJson: "not json" },
      { capabilitiesJson: "{}" },
      { capabilitiesJson: JSON.stringify([switchCap]) },
    ]);
    await refreshCommandTopics();
    expect(commandTopicCount()).toBe(1);
    expect(isCommandTopic("tent/fan/command")).toBe(true);
  });
});
