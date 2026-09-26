/**
 * Actuation — the outbound command path.
 *
 * route -> here -> adapter encodes -> broker publishes. This module owns the
 * decisions that are not family-specific: which capability a request refers to,
 * whether the request makes sense for it, and how a failure should be reported.
 * The wire format is the adapter's business, and publishing is the broker's.
 *
 * Every failure is returned rather than thrown. Actuation is driven by user
 * input and, later, by the rules engine, and both need to tell the difference
 * between "that device is gone" and "the broker is down" without unwrapping
 * exceptions.
 */
import { eq } from "drizzle-orm";
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import { isBrokerOnline, publishToBroker } from "../broker/index.js";
import { canActuate, getControllerState } from "../controller/state.js";
import { encodeGenericMqttCommand } from "./adapters/generic-mqtt.js";
import { encodeShellyCommand } from "./adapters/shelly.js";
import type { EncodeResult, MqttCommand } from "./adapters/command.js";
import type {
  ActuatorCapability,
  ActuatorCommand,
  ApiErrorCode,
  Capability,
  DeviceFamily,
} from "@canopy/shared-types";

export interface ActuateSuccess {
  ok: true;
  /** What was published. Returned so callers can log or assert on it. */
  sent: MqttCommand;
  channel: string;
}

export interface ActuateFailure {
  ok: false;
  code: ApiErrorCode;
  message: string;
}

export type ActuateResult = ActuateSuccess | ActuateFailure;

function fail(code: ApiErrorCode, message: string): ActuateFailure {
  return { ok: false, code, message };
}

/**
 * Pick the actuator a request refers to.
 *
 * With no channel given, a device exposing exactly one actuator is
 * unambiguous. A two-relay Shelly is not, and guessing there would switch the
 * wrong load, so it is rejected instead.
 */
export function selectActuator(
  capabilities: Capability[],
  channel: string | undefined,
): { ok: true; cap: ActuatorCapability } | ActuateFailure {
  const actuators = capabilities.filter(
    (cap): cap is ActuatorCapability => cap.kind === "actuator",
  );

  if (actuators.length === 0) {
    return fail("validation_failed", "Device has no actuator capability");
  }

  if (channel === undefined) {
    if (actuators.length > 1) {
      const names = actuators.map((a) => a.channel).join(", ");
      return fail(
        "validation_failed",
        `Device has more than one actuator; specify channel (${names})`,
      );
    }
    return { ok: true, cap: actuators[0]! };
  }

  const match = actuators.find((a) => a.channel === channel);
  if (!match) {
    return fail("not_found", `Device has no actuator channel "${channel}"`);
  }
  return { ok: true, cap: match };
}

/** Route a command to the adapter that knows the device family's wire format. */
export function encodeForFamily(
  family: DeviceFamily,
  cap: ActuatorCapability,
  command: ActuatorCommand,
): EncodeResult {
  switch (family) {
    case "shelly":
      return encodeShellyCommand(cap, command);
    // Tasmota and ESPHome are discovered through the HA convention and are
    // commanded the same way, so they share the generic encoder until one of
    // them needs something it cannot express.
    case "generic-mqtt":
    case "tasmota":
    case "esphome":
    case "unknown":
      return encodeGenericMqttCommand(cap, command);
  }
}

/** Turn an encoder refusal into something the API can report. */
function describeEncodeFailure(
  result: Extract<EncodeResult, { ok: false }>,
  cap: ActuatorCapability,
): ActuateFailure {
  switch (result.reason) {
    case "no_command_topic":
      return fail(
        "device_unreachable",
        `Actuator "${cap.channel}" declared no command topic, so it cannot be driven over MQTT`,
      );
    case "not_variable":
      return fail(
        "validation_failed",
        `Actuator "${cap.channel}" is not variable and only accepts on/off`,
      );
    case "level_out_of_range":
      return fail("validation_failed", "Level must be between 0 and 100");
  }
}

/** Reject a malformed command before it reaches an adapter. */
export function validateCommand(command: unknown): command is ActuatorCommand {
  if (typeof command !== "object" || command === null) return false;
  const op = (command as { op?: unknown }).op;
  if (op === "on" || op === "off") return true;
  if (op !== "level") return false;
  return typeof (command as { value?: unknown }).value === "number";
}

/**
 * Drive one actuator channel.
 *
 * Success means the command was published, not that the device obeyed. MQTT at
 * QoS 0 gives no delivery guarantee and the device may be unplugged; the only
 * proof of effect is the device echoing its new state, which arrives through
 * ingestion on the state topic.
 */
export async function actuateDevice(
  deviceId: string,
  command: ActuatorCommand,
  channel?: string,
): Promise<ActuateResult> {
  const [row] = await db.select().from(devices).where(eq(devices.id, deviceId));
  if (!row) return fail("not_found", "Device not found");
  if (row.forgotten) {
    return fail("not_found", "Device has been forgotten; rescan before driving it");
  }

  let capabilities: Capability[];
  try {
    const parsed = JSON.parse(row.capabilitiesJson) as unknown;
    capabilities = Array.isArray(parsed) ? (parsed as Capability[]) : [];
  } catch {
    capabilities = [];
  }

  const selected = selectActuator(capabilities, channel);
  if (!selected.ok) return selected;

  const encodeResult = encodeForFamily(
    row.family as DeviceFamily,
    selected.cap,
    command,
  );
  if (!encodeResult.ok) return describeEncodeFailure(encodeResult, selected.cap);

  // A paused controller keeps monitoring but must not drive hardware — that is
  // the whole point of pausing before reaching into the tent.
  if (!canActuate()) {
    return fail(
      "controller_paused",
      `Controller is ${getControllerState()}; resume it before driving devices`,
    );
  }

  // Checked after encoding so that a malformed request is reported as such even
  // while the broker happens to be down.
  if (!isBrokerOnline()) {
    return fail("device_unreachable", "MQTT broker is not running");
  }

  try {
    await publishToBroker(encodeResult.command.topic, encodeResult.command.payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail("device_unreachable", `Failed to publish command: ${detail}`);
  }

  return { ok: true, sent: encodeResult.command, channel: selected.cap.channel };
}
