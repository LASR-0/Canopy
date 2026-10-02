/**
 * Actuator state: what each switch, light or fan last reported.
 *
 * Commands go out at QoS 0 and `POST /devices/:id/actuate` answers 202, because
 * reaching the broker is not the device acting. The device's echo on its state
 * topic is the proof, so that is what is held here, never the last command.
 *
 * In memory only, like the latest readings (latest.ts). The broker is embedded,
 * so a controller restart drops every device's connection, and firmware reports
 * its state again when it reconnects: ESPHome and Tasmota on connect, Shelly
 * Gen 1 on connect and every 30 s, the simulator every few seconds. A table
 * would add a schema change and an import path for what returns in seconds.
 *
 * Only changes are passed on. Devices repeat an unchanged state on a timer, and
 * pushing each repeat to every window would be noise.
 */
import type { ActuatorState } from "@canopy/shared-types";

/** An actuator channel, resolved from the topic it reports on. */
export interface ActuatorBinding {
  deviceId: string;
  workspaceId: string;
  channel: string;
  variable: boolean;
  payloadOn?: string;
  payloadOff?: string;
  stateOn?: string;
  stateOff?: string;
  brightnessScale?: number;
}

export interface ParsedActuatorState {
  on: boolean;
  level?: number;
}

const HA_DEFAULT_BRIGHTNESS_SCALE = 255;

/** Conventional words, tried after the channel's own declared ones. */
const ON_WORDS = new Set(["on", "true", "1", "open"]);
const OFF_WORDS = new Set(["off", "false", "0", "closed"]);

/**
 * JSON keys that carry the state: Home Assistant's JSON schema (`state`),
 * Tasmota (`POWER`), Shelly's status objects (`ison`).
 */
const STATE_KEYS = ["state", "POWER", "ison"] as const;

function clampLevel(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

/** On, off, or neither, from a word or a boolean. */
function switchedFrom(value: unknown, binding: ActuatorBinding): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const text = value.trim();

  // The channel's own words first, exactly as declared: firmware may use
  // anything, and a declared "1" must not lose to a conventional reading.
  const declaredOn = binding.stateOn ?? binding.payloadOn;
  const declaredOff = binding.stateOff ?? binding.payloadOff;
  if (declaredOn !== undefined && text === declaredOn) return true;
  if (declaredOff !== undefined && text === declaredOff) return false;

  const word = text.toLowerCase();
  if (ON_WORDS.has(word)) return true;
  if (OFF_WORDS.has(word)) return false;
  return null;
}

/**
 * Read a state payload, or null when it says nothing usable.
 *
 * Pure and exported for testing. Accepts a bare word ("ON", "off", "true"), a
 * bare level for a variable channel ("40"), or a JSON object with a state key
 * and, for a variable channel, `brightness` (on its declared scale) or
 * Tasmota's `Dimmer` (0–100).
 */
export function parseActuatorPayload(payload: Buffer, binding: ActuatorBinding): ParsedActuatorState | null {
  const text = payload.toString("utf8").trim();
  if (text === "") return null;

  const word = switchedFrom(text, binding);
  if (word !== null) return { on: word };

  // Simple dimmer firmware echoes the level it was sent, on the same topic.
  const number = Number(text);
  if (Number.isFinite(number)) {
    if (!binding.variable) return null;
    const level = clampLevel(number);
    return { on: level > 0, level };
  }

  if (!text.startsWith("{")) return null;
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  let on: boolean | null = null;
  for (const key of STATE_KEYS) {
    on = switchedFrom(obj[key], binding);
    if (on !== null) break;
  }
  if (on === null) return null;

  if (!binding.variable) return { on };
  if (typeof obj["brightness"] === "number") {
    const scale = binding.brightnessScale ?? HA_DEFAULT_BRIGHTNESS_SCALE;
    return { on, level: clampLevel((obj["brightness"] / scale) * 100) };
  }
  if (typeof obj["Dimmer"] === "number") return { on, level: clampLevel(obj["Dimmer"]) };
  return { on };
}

const states = new Map<string, Map<string, ActuatorState>>();

const keyOf = (deviceId: string, channel: string) => `${deviceId}:${channel}`;

/**
 * Note a reported state. Returns the new state when it differs from what was
 * held (or nothing was), and null when it repeats it.
 *
 * A dimmer's plain "ON" carries no level, so the level last reported is kept
 * rather than dropped: it is still the device's last word on it.
 */
export function noteActuatorState(
  binding: ActuatorBinding,
  parsed: ParsedActuatorState,
  now: Date = new Date(),
): ActuatorState | null {
  let channels = states.get(binding.workspaceId);
  if (!channels) states.set(binding.workspaceId, (channels = new Map()));

  const key = keyOf(binding.deviceId, binding.channel);
  const held = channels.get(key);
  const level = parsed.level ?? held?.level;
  if (held && held.on === parsed.on && held.level === level) return null;

  const next: ActuatorState = {
    workspaceId: binding.workspaceId,
    deviceId: binding.deviceId,
    channel: binding.channel,
    on: parsed.on,
    ...(level !== undefined ? { level } : {}),
    since: now.toISOString(),
  };
  channels.set(key, next);
  return next;
}

/** The last reported state of every actuator channel in a workspace. */
export function actuatorStates(workspaceId: string): ActuatorState[] {
  return [...(states.get(workspaceId)?.values() ?? [])];
}

/** Forget everything. Tests only. */
export function resetActuatorStates(): void {
  states.clear();
}
