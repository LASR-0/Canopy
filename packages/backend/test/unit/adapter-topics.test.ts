/**
 * Unit — MQTT topic capture at discovery (Phase 3)
 *
 * Ingestion can only attribute telemetry to a device if discovery recorded the
 * topic it publishes on. These tests pin that down for both discovery surfaces,
 * because the failure mode is silent: readings simply never appear.
 */
import { describe, it, expect } from "vitest";
import { parseHaDiscovery } from "../../src/device-manager/adapters/generic-mqtt.js";
import { deviceFromShellyAnnounce } from "../../src/device-manager/adapters/shelly.js";
import type { ActuatorCapability, SensorCapability } from "@canopy/shared-types";

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
