/**
 * Sending a Shelly its broker credential over its HTTP API (Phase 8 G), so
 * pairing one needs no typing. ESPHome and Tasmota have no such API that is
 * on by default, so they still take theirs by hand, or at flash time.
 *
 *   Gen 1: GET /settings?mqtt_enable=true&mqtt_server=…&mqtt_user=…&mqtt_pass=…
 *          then GET /reboot, which the MQTT settings need to take effect.
 *   Gen 2+ (Plus, Pro): POST /rpc/MQTT.SetConfig, then POST /rpc/Shelly.Reboot
 *          when it answers `restart_required`.
 *
 * GET /shelly tells them apart: Gen 2 answers with `gen`, Gen 1 without.
 *
 * Plain HTTP on the LAN, like the MQTT login itself (decided for v1). A
 * Shelly with its own web login set answers 401; it is not given the
 * password, so it is left to be set by hand, and the card says why.
 *
 * The last attempt per device is kept in memory for the device card. It is
 * not worth a column: it describes what happened since the controller started.
 */
import type { MqttCredentialPush } from "@canopy/shared-types";

export interface PushTarget {
  /** The Shelly's address on the LAN. */
  host: string;
  /** host:port of the broker, as the device should reach it. */
  server: string;
  username: string;
  password: string;
}

const TIMEOUT_MS = 5_000;

/** A failure worded for the device card. */
export class PushError extends Error {}

type Fetch = typeof fetch;

async function call(fetchImpl: Fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new PushError("The device did not answer. Check it is on and on this network.");
  }
  if (res.status === 401) {
    throw new PushError("The device has a web login set. Enter the credential in its MQTT settings by hand.");
  }
  if (!res.ok) throw new PushError(`The device refused the settings (HTTP ${res.status}).`);
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return text;
  }
}

/** Send the credential, and restart the device so it connects with it. Throws a PushError. */
export async function pushShellyCredential(target: PushTarget, fetchImpl: Fetch = fetch): Promise<void> {
  const base = `http://${target.host}`;
  const info = await call(fetchImpl, `${base}/shelly`);
  const gen = typeof info === "object" && info !== null && typeof (info as { gen?: unknown }).gen === "number"
    ? (info as { gen: number }).gen
    : 1;

  if (gen >= 2) {
    const result = await call(fetchImpl, `${base}/rpc/MQTT.SetConfig`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { enable: true, server: target.server, user: target.username, pass: target.password } }),
    });
    if ((result as { restart_required?: boolean } | null)?.restart_required) {
      await call(fetchImpl, `${base}/rpc/Shelly.Reboot`, { method: "POST" });
    }
    return;
  }

  const query = new URLSearchParams({
    mqtt_enable: "true",
    mqtt_server: target.server,
    mqtt_user: target.username,
    mqtt_pass: target.password,
  });
  await call(fetchImpl, `${base}/settings?${query.toString()}`);
  await call(fetchImpl, `${base}/reboot`);
}

const pushes = new Map<string, MqttCredentialPush>();

export function lastPush(deviceId: string): MqttCredentialPush | undefined {
  return pushes.get(deviceId);
}

/** Push and record the outcome for the device card. Never throws. */
export async function pushAndRecord(deviceId: string, target: PushTarget, fetchImpl: Fetch = fetch): Promise<MqttCredentialPush> {
  pushes.set(deviceId, { state: "sending", at: new Date().toISOString() });
  let outcome: MqttCredentialPush;
  try {
    await pushShellyCredential(target, fetchImpl);
    outcome = { state: "sent", at: new Date().toISOString() };
    console.log(`[shelly] sent ${target.host} its broker credential (${target.username})`);
  } catch (err) {
    const error = err instanceof PushError ? err.message : "Sending the credential failed.";
    outcome = { state: "failed", at: new Date().toISOString(), error };
    console.warn(`[shelly] could not send ${target.host} its broker credential: ${err instanceof Error ? err.message : String(err)}`);
  }
  pushes.set(deviceId, outcome);
  return outcome;
}
