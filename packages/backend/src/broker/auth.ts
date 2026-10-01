/**
 * Authentication for the embedded broker (Tier 2 MQTT hardening, Phase 8 F).
 *
 * Tier 1 (acl.ts) stops any client driving hardware. This stops anything on
 * the LAN connecting at all, without breaking zero-config discovery, which
 * happens over MQTT itself: a device cannot present a credential it has not
 * been given, and it is given one only after it has been found.
 *
 * The scan window is the seam. A scan is a deliberate, 20-second action with
 * someone watching the screen, so while one is open a client without the
 * credential may connect, but only to announce itself:
 *
 *   a device's own credential         connects, its own topics only (Phase 8 G)
 *   the shared credential             connects, full rights
 *   no credential, not required       connects, full rights, recorded as anonymous
 *   no credential, required, scan     connects unprovisioned: discovery only
 *   no credential, required           refused
 *
 * "Its own topics" is enforced where messages are read, not here: see
 * acl.ts and broker/index.ts.
 *
 * "No credential" includes a wrong one. Tasmota ships with DVES_USER /
 * DVES_PASS and the broker never asked before, so a wrong login has to be
 * treated like none: otherwise every existing Tasmota device would be cut off
 * by the upgrade, and a freshly flashed one could not be discovered.
 *
 * Unprovisioned clients cannot be refused their other publishes: aedes closes
 * the connection on a refusal, and ESPHome publishes its "online" status
 * before its discovery config. So their messages pass through the broker,
 * nothing but discovery is acted on (broker/index.ts), nothing they publish is
 * retained (acl.ts), and they are dropped when the scan window closes.
 *
 * Credentials cross the LAN in clear text inside the CONNECT packet. That is
 * decided for v1, on a trusted segment: TLS comes after the real-device
 * testing that follows Phase 9.
 *
 * Pure apart from the module state below, so it is tested without a broker or
 * a database.
 */
import { timingSafeEqual } from "node:crypto";
import type { AuthenticateError, Client } from "aedes";
import type { MqttAuth } from "@canopy/shared-types";

export interface ClientAuth {
  auth: MqttAuth;
  /** False while a client without the credential is let in only to announce itself. */
  provisioned: boolean;
  /** Set for a device's own credential: the one device whose topics it may publish. */
  deviceId?: string;
  /** The credential it connected with, so a change to it can be noticed (`stillValid`). */
  credential?: BrokerCredential;
}

/** A login the broker accepts. Without `deviceId`, the shared one. */
export interface BrokerCredential {
  username: string;
  password: string;
  deviceId?: string;
}

export interface AuthConfig {
  credentials: BrokerCredential[];
  requireCredentials: boolean;
}

// Until the controller loads its settings nothing is accepted without a
// credential, and there are none: closed, not open.
let config: AuthConfig = { credentials: [], requireCredentials: true };
let discoveryOpen = false;
const clients = new WeakMap<Client, ClientAuth>();

export function configureAuth(next: AuthConfig): void {
  config = next;
}

export function authConfig(): Readonly<AuthConfig> {
  return config;
}

export function setDiscoveryOpen(open: boolean): void {
  discoveryOpen = open;
}

export function isDiscoveryOpen(): boolean {
  return discoveryOpen;
}

/** Constant-time, so the comparison does not leak how much of a guess was right. */
function same(presented: string | Buffer | undefined, expected: string): boolean {
  if (presented === undefined || expected === "") return false;
  const a = Buffer.isBuffer(presented) ? presented : Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The credential a login matches. Every one is compared, and both halves of
 * each, so the time taken says nothing about which username exists or how
 * close a guess came. There is one per device, so the list stays short.
 */
function findCredential(
  username: string | undefined,
  password: Buffer | undefined,
  credentials: readonly BrokerCredential[],
): BrokerCredential | undefined {
  let found: BrokerCredential | undefined;
  for (const credential of credentials) {
    const userOk = same(username, credential.username);
    const passOk = same(password, credential.password);
    if (userOk && passOk && !found) found = credential;
  }
  return found;
}

/**
 * Whether a client connected with a credential may stay connected under new
 * settings: false once its credential is gone (a forgotten device) or has a
 * new password. Clients without a credential are judged by `requireCredentials`
 * instead, in broker/index.ts.
 */
export function stillValid(state: ClientAuth, next: AuthConfig): boolean {
  const held = state.credential;
  if (!held) return true;
  return next.credentials.some((c) =>
    c.username === held.username && c.password === held.password && c.deviceId === held.deviceId);
}

/** Who a client is let in as, or null if it is refused. */
export function decideConnection(
  username: string | undefined,
  password: Buffer | undefined,
  current: AuthConfig = config,
  scanOpen: boolean = discoveryOpen,
): ClientAuth | null {
  const match = findCredential(username, password, current.credentials);
  if (match) {
    return match.deviceId
      ? { auth: "device", provisioned: true, deviceId: match.deviceId, credential: match }
      : { auth: "shared", provisioned: true, credential: match };
  }
  if (!current.requireCredentials) return { auth: "anonymous", provisioned: true };
  if (scanOpen) return { auth: "anonymous", provisioned: false };
  return null;
}

/**
 * What a client last connected as, kept for each client the broker holds.
 * Undefined only for the controller's own publishes, which have no client.
 */
export function clientAuth(client: Client | null): ClientAuth | undefined {
  return client ? clients.get(client) : undefined;
}

/** For tests, which build clients by hand. */
export function setClientAuthForTesting(client: Client, auth: ClientAuth): void {
  clients.set(client, auth);
}

/**
 * The topics devices announce themselves on: Home Assistant's discovery
 * convention (with or without a node id) and Shelly Gen 1's announce. The
 * only thing an unprovisioned client is listened to on.
 */
export function isDiscoveryTopic(topic: string): boolean {
  return topic === "shellies/announce" || (topic.startsWith("homeassistant/") && topic.endsWith("/config"));
}

/**
 * MQTT 3.1.1 CONNACK return code 4: bad user name or password. aedes types it
 * as a const enum, which an isolated module cannot import as a value.
 */
const BAD_USERNAME_OR_PASSWORD = 4 as AuthenticateError["returnCode"];

/** The error a refused connection carries; broker/index.ts leaves it out of the log, which this already covers. */
export const REFUSED = "A broker credential is required";

/**
 * Refused clients retry every few seconds for as long as they are powered, so
 * a refusal is logged once an hour per client rather than every time.
 */
const REFUSAL_LOG_MS = 60 * 60_000;
const refusalsLogged = new Map<string, number>();

/** Aedes `authenticate` hook. */
export function authenticateClient(
  client: Client,
  username: string | undefined,
  password: Buffer | undefined,
  callback: (error: AuthenticateError | null, success: boolean | null) => void,
): void {
  const decision = decideConnection(username, password);
  if (!decision) {
    const now = Date.now();
    if (now - (refusalsLogged.get(client.id) ?? 0) > REFUSAL_LOG_MS) {
      refusalsLogged.set(client.id, now);
      console.warn(`[broker] refused ${client.id}: no broker credential, and no scan is open`);
    }
    const error = Object.assign(new Error(REFUSED), { returnCode: BAD_USERNAME_OR_PASSWORD });
    return callback(error, false);
  }
  clients.set(client, decision);
  callback(null, true);
}
