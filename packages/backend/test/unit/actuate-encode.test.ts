/**
 * Unit — actuator command encoding (Phase 4)
 *
 * The wire format differs per family and a wrong payload fails silently: the
 * broker accepts it, the device ignores it, and nothing reports an error. These
 * tests pin each family's format so that silence never has to be debugged.
 */
import { describe, it, expect } from "vitest";
import { encodeGenericMqttCommand } from "../../src/device-manager/adapters/generic-mqtt.js";
import { encodeShellyCommand } from "../../src/device-manager/adapters/shelly.js";
import { selectActuator, encodeForFamily, validateCommand } from "../../src/device-manager/actuate.js";
import type { ActuatorCapability, Capability } from "@canopy/shared-types";

const haSwitch: ActuatorCapability = {
  kind: "actuator",
  channel: "water-pump",
  actuator: "switch",
  variable: false,
  commandTopic: "canopy/water-pump/set",
  stateTopic: "canopy/water-pump/state",
};

const haDimmableLight: ActuatorCapability = {
  ...haSwitch,
  channel: "grow-light",
  actuator: "light",
  variable: true,
  commandTopic: "canopy/grow-light/set",
};

const shellyRelay: ActuatorCapability = {
  kind: "actuator",
  channel: "relay:0",
  actuator: "switch",
  variable: false,
  commandTopic: "shellies/shelly1-AAA/relay/0/command",
  stateTopic: "shellies/shelly1-AAA/relay/0",
};

const shellyDimmer: ActuatorCapability = {
  kind: "actuator",
  channel: "light:0",
  actuator: "dimmer",
  variable: true,
  commandTopic: "shellies/shellydimmer-AAA/light/0/command",
  brightnessCommandTopic: "shellies/shellydimmer-AAA/light/0/set",
  stateTopic: "shellies/shellydimmer-AAA/light/0",
};

function unwrap(result: ReturnType<typeof encodeGenericMqttCommand>) {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
  return result.command;
}

describe("encodeGenericMqttCommand", () => {
  it("uses Home Assistant's default payloads when the firmware declared none", () => {
    expect(unwrap(encodeGenericMqttCommand(haSwitch, { op: "on" }))).toEqual({
      topic: "canopy/water-pump/set",
      payload: "ON",
    });
    expect(unwrap(encodeGenericMqttCommand(haSwitch, { op: "off" }))).toEqual({
      topic: "canopy/water-pump/set",
      payload: "OFF",
    });
  });

  it("prefers the payloads the firmware declared over the defaults", () => {
    const cap = { ...haSwitch, payloadOn: "1", payloadOff: "0" };

    expect(unwrap(encodeGenericMqttCommand(cap, { op: "on" })).payload).toBe("1");
    expect(unwrap(encodeGenericMqttCommand(cap, { op: "off" })).payload).toBe("0");
  });

  it("sends a bare level on the command topic when there is no brightness topic", () => {
    expect(unwrap(encodeGenericMqttCommand(haDimmableLight, { op: "level", value: 60 }))).toEqual({
      topic: "canopy/grow-light/set",
      payload: "60",
    });
  });

  it("rescales onto the declared brightness topic, which wins over the command topic", () => {
    const cap = {
      ...haDimmableLight,
      brightnessCommandTopic: "canopy/grow-light/brightness/set",
      brightnessScale: 255,
    };

    expect(unwrap(encodeGenericMqttCommand(cap, { op: "level", value: 100 }))).toEqual({
      topic: "canopy/grow-light/brightness/set",
      payload: "255",
    });
    expect(unwrap(encodeGenericMqttCommand(cap, { op: "level", value: 50 })).payload).toBe("128");
    expect(unwrap(encodeGenericMqttCommand(cap, { op: "level", value: 0 })).payload).toBe("0");
  });

  it("honours a non-default brightness scale", () => {
    const cap = {
      ...haDimmableLight,
      brightnessCommandTopic: "canopy/grow-light/brightness/set",
      brightnessScale: 100,
    };

    expect(unwrap(encodeGenericMqttCommand(cap, { op: "level", value: 40 })).payload).toBe("40");
  });

  it("refuses a level on a channel that only switches", () => {
    const result = encodeGenericMqttCommand(haSwitch, { op: "level", value: 50 });

    expect(result).toEqual({ ok: false, reason: "not_variable" });
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses the out-of-range level %s",
    (value) => {
      expect(encodeGenericMqttCommand(haDimmableLight, { op: "level", value })).toEqual({
        ok: false,
        reason: "level_out_of_range",
      });
    },
  );

  it("refuses to guess a topic when the firmware declared none", () => {
    const { commandTopic: _omitted, ...noTopic } = haSwitch;

    expect(encodeGenericMqttCommand(noTopic, { op: "on" })).toEqual({
      ok: false,
      reason: "no_command_topic",
    });
  });
});

describe("encodeShellyCommand", () => {
  it("switches a relay with Gen 1's lowercase words, not HA's", () => {
    expect(unwrap(encodeShellyCommand(shellyRelay, { op: "on" }))).toEqual({
      topic: "shellies/shelly1-AAA/relay/0/command",
      payload: "on",
    });
    expect(unwrap(encodeShellyCommand(shellyRelay, { op: "off" })).payload).toBe("off");
  });

  it("sends a dimmer level as JSON on the separate set topic", () => {
    const sent = unwrap(encodeShellyCommand(shellyDimmer, { op: "level", value: 40 }));

    expect(sent.topic).toBe("shellies/shellydimmer-AAA/light/0/set");
    expect(JSON.parse(sent.payload)).toEqual({ turn: "on", brightness: 40 });
  });

  it("treats level zero as off rather than on at zero brightness", () => {
    const sent = unwrap(encodeShellyCommand(shellyDimmer, { op: "level", value: 0 }));

    expect(JSON.parse(sent.payload)).toEqual({ turn: "off", brightness: 0 });
  });

  it("refuses a level on a plain relay", () => {
    expect(encodeShellyCommand(shellyRelay, { op: "level", value: 50 })).toEqual({
      ok: false,
      reason: "not_variable",
    });
  });
});

describe("encodeForFamily", () => {
  it("gives Shelly its own format rather than the generic one", () => {
    const shelly = encodeForFamily("shelly", shellyRelay, { op: "on" });
    const generic = encodeForFamily("generic-mqtt", haSwitch, { op: "on" });

    expect(unwrap(shelly).payload).toBe("on");
    expect(unwrap(generic).payload).toBe("ON");
  });

  it.each(["tasmota", "esphome", "unknown"] as const)(
    "routes %s through the generic HA encoder",
    (family) => {
      expect(unwrap(encodeForFamily(family, haSwitch, { op: "on" })).payload).toBe("ON");
    },
  );
});

describe("selectActuator", () => {
  const sensor: Capability = {
    kind: "sensor",
    channel: "power",
    metric: "power",
    unit: "W",
  };

  it("picks the only actuator when no channel is named", () => {
    const result = selectActuator([sensor, haSwitch], undefined);

    expect(result.ok).toBe(true);
    expect(result.ok && result.cap.channel).toBe("water-pump");
  });

  it("refuses to guess between two actuators, rather than switching the wrong load", () => {
    const second = { ...shellyRelay, channel: "relay:1" };
    const result = selectActuator([shellyRelay, second], undefined);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("validation_failed");
    expect(result.ok === false && result.message).toContain("relay:0");
    expect(result.ok === false && result.message).toContain("relay:1");
  });

  it("selects the named channel when there are several", () => {
    const second = { ...shellyRelay, channel: "relay:1" };
    const result = selectActuator([shellyRelay, second], "relay:1");

    expect(result.ok && result.cap.channel).toBe("relay:1");
  });

  it("reports an unknown channel as not found", () => {
    const result = selectActuator([shellyRelay], "relay:9");

    expect(result.ok === false && result.code).toBe("not_found");
  });

  it("reports a sensor-only device as having nothing to drive", () => {
    const result = selectActuator([sensor], undefined);

    expect(result.ok === false && result.code).toBe("validation_failed");
    expect(result.ok === false && result.message).toContain("no actuator");
  });
});

describe("validateCommand", () => {
  it.each([{ op: "on" }, { op: "off" }, { op: "level", value: 0 }, { op: "level", value: 100 }])(
    "accepts %o",
    (command) => {
      expect(validateCommand(command)).toBe(true);
    },
  );

  it.each([
    null,
    undefined,
    "on",
    {},
    { op: "toggle" },
    { op: "level" },
    { op: "level", value: "50" },
  ])("rejects %o", (command) => {
    expect(validateCommand(command)).toBe(false);
  });
});
