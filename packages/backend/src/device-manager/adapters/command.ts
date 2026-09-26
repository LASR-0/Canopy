/**
 * What an adapter turns an `ActuatorCommand` into.
 *
 * Adapters never touch the broker themselves. They translate intent into a
 * topic and a payload, and `actuate.ts` publishes it. That split is what makes
 * the per-family encoding testable without a running broker.
 */
export interface MqttCommand {
  topic: string;
  payload: string;
}

/**
 * Why a command could not be encoded.
 *
 * Every case here is a permanent property of the device or the request, not a
 * transient failure, so the caller should report it rather than retry.
 */
export type EncodeFailure =
  | "no_command_topic"
  | "not_variable"
  | "level_out_of_range";

export type EncodeResult =
  | { ok: true; command: MqttCommand }
  | { ok: false; reason: EncodeFailure };

export function encoded(topic: string, payload: string): EncodeResult {
  return { ok: true, command: { topic, payload } };
}

export function cannotEncode(reason: EncodeFailure): EncodeResult {
  return { ok: false, reason };
}

/** Levels are 0–100 across the whole app; devices scale from there. */
export function isValidLevel(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}
