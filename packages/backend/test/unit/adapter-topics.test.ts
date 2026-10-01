/**
 * Unit — MQTT topic capture at discovery (Phase 3)
 *
 * Ingestion can only attribute telemetry to a device if discovery recorded the
 * topic it publishes on. These tests pin that down for both discovery surfaces,
 * because the failure mode is silent: readings simply never appear.
 */
import { describe, it, expect } from "vitest";
import { discoveryKey, mergeCapabilities, parseHaDiscovery } from "../../src/device-manager/adapters/generic-mqtt.js";
import { deviceFromShellyAnnounce } from "../../src/device-manager/adapters/shelly.js";
import type { ActuatorCapability, Capability, SensorCapability } from "@canopy/shared-types";

function haConfig(extra: Record<string, unknown>): Buffer {
  return Buffer.from(
    JSON.stringify({
      name: "Canopy Temperature",
      unique_id: "canopy-sim-canopy-temp",
      device: { identifiers: ["canopy-sim-canopy-temp"], name: "Canopy Temperature" },
      ...extra,
    }),
  );
}

describe("parseHaDiscovery — topic capture", () => {
  it("keeps a sensor's state topic verbatim rather than rebuilding it", () => {
    const device = parseHaDiscovery(
      "homeassistant/sensor/canopy-temp/config",
      haConfig({ device_class: "temperature", state_topic: "some/unguessable/path" }),
      "ws-1",
    );

    const cap = device?.capabilities[0] as SensorCapability;
    expect(cap.stateTopic).toBe("some/unguessable/path");
  });

  it("keeps both topics for an actuator, so Phase 4 can command it", () => {
    const device = parseHaDiscovery(
      "homeassistant/switch/water-pump/config",
      haConfig({ state_topic: "canopy/water-pump/state", command_topic: "canopy/water-pump/set" }),
      "ws-1",
    );

    const cap = device?.capabilities[0] as ActuatorCapability;
    expect(cap.stateTopic).toBe("canopy/water-pump/state");
    expect(cap.commandTopic).toBe("canopy/water-pump/set");
  });

  it("omits the topic keys entirely when the firmware declared none", () => {
    const device = parseHaDiscovery(
      "homeassistant/sensor/canopy-temp/config",
      haConfig({ device_class: "temperature" }),
      "ws-1",
    );

    const cap = device?.capabilities[0] as SensorCapability;
    expect("stateTopic" in cap).toBe(false);
  });
});

describe("deviceFromShellyAnnounce — topic derivation", () => {
  const announce = (model: string) =>
    Buffer.from(JSON.stringify({ id: "shellyplug-s-SIM01", model, ip: "10.0.0.5", fw_ver: "1.0" }));

  it("derives Gen 1 relay topics from the announced device id", () => {
    const device = deviceFromShellyAnnounce(announce("shellyplug-s"), "ws-1");
    const relay = device?.capabilities.find((c) => c.kind === "actuator") as ActuatorCapability;

    expect(relay.stateTopic).toBe("shellies/shellyplug-s-SIM01/relay/0");
    expect(relay.commandTopic).toBe("shellies/shellyplug-s-SIM01/relay/0/command");
  });

  it("points a metered plug's power channel at the relay that meters it", () => {
    const device = deviceFromShellyAnnounce(announce("shellyplug-s"), "ws-1");
    const power = device?.capabilities.find((c) => c.kind === "sensor") as SensorCapability;

    expect(power.stateTopic).toBe("shellies/shellyplug-s-SIM01/relay/0/power");
  });

  it("gives a sensor channel no command topic", () => {
    const device = deviceFromShellyAnnounce(announce("shellyht"), "ws-1");
    const sensors = device?.capabilities ?? [];

    expect(sensors).toHaveLength(2);
    for (const cap of sensors) {
      expect(cap.kind).toBe("sensor");
      expect("commandTopic" in cap).toBe(false);
    }
  });

  it("maps the H&T channels onto the documented sensor topics", () => {
    const device = deviceFromShellyAnnounce(announce("shellyht"), "ws-1");
    const topics = (device?.capabilities ?? []).map((c) => c.stateTopic);

    expect(topics).toEqual([
      "shellies/shellyplug-s-SIM01/sensor/temperature",
      "shellies/shellyplug-s-SIM01/sensor/humidity",
    ]);
  });

  it("does not leak one device's topics into another built from the same model", () => {
    const first = deviceFromShellyAnnounce(
      Buffer.from(JSON.stringify({ id: "shelly-AAA", model: "shellyplug-s", ip: "10.0.0.5", fw_ver: "1" })),
      "ws-1",
    );
    const second = deviceFromShellyAnnounce(
      Buffer.from(JSON.stringify({ id: "shelly-BBB", model: "shellyplug-s", ip: "10.0.0.6", fw_ver: "1" })),
      "ws-1",
    );

    expect(first?.capabilities[0]?.stateTopic).toBe("shellies/shelly-AAA/relay/0");
    expect(second?.capabilities[0]?.stateTopic).toBe("shellies/shelly-BBB/relay/0");
  });
});

describe("parseHaDiscovery — one board, many entities (Phase 8 G)", () => {
  const board = { identifiers: ["esp32-a1b2c3"], name: "Tent Board" };
  const entity = (name: string, extra: Record<string, unknown>) =>
    Buffer.from(JSON.stringify({ name, device: board, ...extra }));

  it("accepts the node id form ESPHome and Tasmota publish", () => {
    const device = parseHaDiscovery(
      "homeassistant/sensor/tent-board/temperature/config",
      entity("Temperature", { device_class: "temperature", state_topic: "tent-board/sensor/temperature/state" }),
      "ws-1",
    );
    expect(device?.capabilities[0]?.channel).toBe("temperature");
  });

  it("gives every entity of a board the board's key and name, so they become one device", () => {
    const temp = parseHaDiscovery(
      "homeassistant/sensor/tent-board/temperature/config",
      entity("Temperature", { device_class: "temperature", state_topic: "tent-board/sensor/temperature/state" }),
      "ws-1",
    );
    const relay = parseHaDiscovery(
      "homeassistant/switch/tent-board/relay/config",
      entity("Relay", { state_topic: "tent-board/switch/relay/state", command_topic: "tent-board/switch/relay/command" }),
      "ws-1",
    );
    expect(temp?.discoveryKey).toBe("ha:esp32-a1b2c3");
    expect(relay?.discoveryKey).toBe("ha:esp32-a1b2c3");
    expect(temp?.name).toBe("Tent Board");
  });

  it("falls back to the node id, and leaves an entity with neither on its own", () => {
    expect(discoveryKey(undefined, "tent-board")).toBe("ha-node:tent-board");
    expect(discoveryKey("esp32-a1b2c3", undefined)).toBe("ha:esp32-a1b2c3");
    expect(discoveryKey([], undefined)).toBeUndefined();
    const lone = parseHaDiscovery("homeassistant/sensor/lone/config", Buffer.from(JSON.stringify({ name: "Lone" })), "ws-1");
    expect(lone && "discoveryKey" in lone).toBe(false);
  });
});

describe("mergeCapabilities", () => {
  const temp: Capability = { kind: "sensor", channel: "temperature", metric: "temperature", unit: "C", stateTopic: "b/sensor/temperature/state" };
  const rh: Capability = { kind: "sensor", channel: "humidity", metric: "humidity", unit: "percent", stateTopic: "b/sensor/humidity/state" };

  it("adds an entity announced after the first, rather than replacing it", () => {
    expect(mergeCapabilities([temp], [rh])).toEqual([temp, rh]);
  });

  it("replaces an entity announced again, so its new topics win", () => {
    const moved = { ...temp, stateTopic: "b/sensor/temp2/state" };
    expect(mergeCapabilities([temp, rh], [moved])).toEqual([rh, moved]);
  });
});
