/**
 * Unit — actuator state (what a switch, light or fan last reported)
 *
 * The parser has to read what real firmware sends on a state topic, and the
 * store has to pass on changes only, since devices repeat their state on a
 * timer.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  actuatorStates,
  noteActuatorState,
  parseActuatorPayload,
  resetActuatorStates,
  type ActuatorBinding,
} from "../../src/device-manager/actuator-state.js";

const relay: ActuatorBinding = { deviceId: "dev-1", workspaceId: "ws-1", channel: "relay", variable: false };
const dimmer: ActuatorBinding = { deviceId: "dev-2", workspaceId: "ws-1", channel: "light", variable: true };

const parse = (text: string, binding: ActuatorBinding = relay) => parseActuatorPayload(Buffer.from(text), binding);

beforeEach(() => resetActuatorStates());

describe("parseActuatorPayload", () => {
  it.each([
    ["ON", true], ["OFF", false],          // Home Assistant, the simulator
    ["on", true], ["off", false],          // Shelly Gen 1
    ["true", true], ["false", false],
    ["1", true], ["0", false],
    [" ON\n", true],
  ])("reads %j as on=%s", (text, on) => {
    expect(parse(text)).toEqual({ on });
  });

  it("prefers the channel's declared state words", () => {
    const declared = { ...relay, stateOn: "running", stateOff: "stopped" };
    expect(parse("running", declared)).toEqual({ on: true });
    expect(parse("stopped", declared)).toEqual({ on: false });
  });

  it("falls back to the switching payloads when no state words were declared", () => {
    const declared = { ...relay, payloadOn: "start", payloadOff: "stop" };
    expect(parse("start", declared)).toEqual({ on: true });
    expect(parse("stop", declared)).toEqual({ on: false });
  });

  it("lets a declared word win over a conventional one", () => {
    // Inverted firmware is rare but legal: "0" means on here.
    const inverted = { ...relay, stateOn: "0", stateOff: "1" };
    expect(parse("0", inverted)).toEqual({ on: true });
    expect(parse("1", inverted)).toEqual({ on: false });
  });

  it.each([
    ['{"state":"ON"}', true],              // Home Assistant JSON schema
    ['{"POWER":"OFF"}', false],            // Tasmota
    ['{"ison":true}', true],               // Shelly status object
  ])("reads the state key of %s", (text, on) => {
    expect(parse(text)).toEqual({ on });
  });

  it("reads a dimmer's level from brightness on its declared scale", () => {
    expect(parse('{"state":"ON","brightness":255}', dimmer)).toEqual({ on: true, level: 100 });
    expect(parse('{"state":"ON","brightness":50}', { ...dimmer, brightnessScale: 100 })).toEqual({ on: true, level: 50 });
  });

  it("reads Tasmota's Dimmer as a 0–100 level", () => {
    expect(parse('{"POWER":"ON","Dimmer":40}', dimmer)).toEqual({ on: true, level: 40 });
  });

  it("reads a bare level echoed by a variable channel", () => {
    expect(parse("40", dimmer)).toEqual({ on: true, level: 40 });
    expect(parse("250", dimmer)).toEqual({ on: true, level: 100 });
  });

  it("ignores a level on an on/off channel", () => {
    expect(parse("40")).toBeNull();
    expect(parse('{"state":"ON","brightness":128}')).toEqual({ on: true });
  });

  it.each(["", "unavailable", "{not json", "[1]", '{"brightness":10}', "null"])(
    "returns null for %j",
    (text) => {
      expect(parse(text, dimmer)).toBeNull();
    },
  );
});

describe("noteActuatorState", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s));

  it("returns the first report as a change", () => {
    expect(noteActuatorState(relay, { on: true }, at(0))).toEqual({
      workspaceId: "ws-1", deviceId: "dev-1", channel: "relay", on: true, since: at(0).toISOString(),
    });
  });

  it("returns null for a repeat, and keeps when it changed", () => {
    noteActuatorState(relay, { on: true }, at(0));
    expect(noteActuatorState(relay, { on: true }, at(5))).toBeNull();
    expect(actuatorStates("ws-1")[0]?.since).toBe(at(0).toISOString());
  });

  it("returns a change of on/off or of level", () => {
    noteActuatorState(dimmer, { on: true, level: 40 }, at(0));
    expect(noteActuatorState(dimmer, { on: true, level: 60 }, at(1))?.level).toBe(60);
    expect(noteActuatorState(dimmer, { on: false, level: 60 }, at(2))?.on).toBe(false);
  });

  it("keeps a dimmer's last level when a report carries none", () => {
    noteActuatorState(dimmer, { on: true, level: 40 }, at(0));
    noteActuatorState(dimmer, { on: false }, at(1));
    expect(noteActuatorState(dimmer, { on: true }, at(2))).toMatchObject({ on: true, level: 40 });
  });

  it("keeps workspaces apart", () => {
    noteActuatorState(relay, { on: true }, at(0));
    noteActuatorState({ ...relay, workspaceId: "ws-2" }, { on: false }, at(0));
    expect(actuatorStates("ws-1").map((s) => s.on)).toEqual([true]);
    expect(actuatorStates("ws-2").map((s) => s.on)).toEqual([false]);
    expect(actuatorStates("ws-3")).toEqual([]);
  });
});
