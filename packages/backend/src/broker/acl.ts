/**
 * Publish authorization for the embedded broker.
 *
 * The broker binds 0.0.0.0:1883 because devices on the LAN have to reach it,
 * which means anything else on the LAN reaches it too. Phase 4 turned that from
 * a data-integrity question into a physical one: command topics became real, so
 * an anonymous publish can switch a pump or a light.
 *
 * No connected client ever has a legitimate reason to publish to a command
 * topic. Commands originate from the controller and nowhere else — and the
 * controller does not publish as a client. `publishToBroker()` calls
 * `Aedes.prototype.publish`, which never runs this hook: aedes invokes
 * `authorizePublish` only from the client PUBLISH path and the will path. So
 * denying every client publish to a command topic cannot lock the controller
 * out of its own devices, and the rule needs no exception carved for it.
 *
 * Aedes closes the connection when this hook returns an error, so a denial is
 * not a silently dropped message — the client is disconnected and the existing
 * `clientError` handler logs it.
 *
 * Who may connect at all is auth.ts (Tier 2). One rule from it lands here: a
 * client let in without the credential only to announce itself during a scan
 * leaves nothing behind. Its other publishes are not refused, because a
 * refusal disconnects it before it has announced, but they are not retained.
 *
 * Tier 3 (Phase 8 G) adds a scope per device: a client on a device's own
 * credential may publish that device's topics and discovery, and nothing
 * else is read from it. Those publishes are ignored rather than refused, for
 * the same reason: firmware publishes topics Canopy never learns about
 * (ESPHome's `<node>/status`, Tasmota's `tele/<topic>/LWT`), and a refusal
 * would disconnect it on every one, so it would reconnect forever. Ignored
 * means not ingested (broker/index.ts) and not retained (below).
 */
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import type { Capability } from "@canopy/shared-types";
import type { Client, PublishPacket } from "aedes";
import { clientAuth, isDiscoveryTopic } from "./auth.js";

/**
 * Aedes' own reserved tree. Overriding `authorizePublish` replaces the default
 * handler, which is the only thing refusing client writes to $SYS, so the check
 * has to be carried across rather than inherited.
 */
const SYS_PREFIX = "$SYS/";

/** Just enough of a device to derive the topics it accepts commands on. */
export interface AclDevice {
  capabilities: Capability[];
}

/** Just enough of a device to derive the topics its own credential may publish. */
export interface ScopedDevice extends AclDevice {
  id: string;
  mqttTopicPrefix: string | null;
}

/** What one device's credential may publish: these topics, and anything under the prefix. */
export interface DeviceScope {
  topics: Set<string>;
  prefix?: string;
}

/**
 * The topics each device's own credential may publish: every state topic its
 * capabilities declare, and anything under its topic prefix. Pure, like
 * `buildCommandTopicSet`. Discovery topics are allowed separately, for every
 * credential, so a board can announce a new entity.
 */
export function buildDeviceScopes(deviceList: ScopedDevice[]): Map<string, DeviceScope> {
  const scopes = new Map<string, DeviceScope>();
  for (const device of deviceList) {
    const topics = new Set<string>();
    for (const cap of device.capabilities) if (cap.stateTopic) topics.add(cap.stateTopic);
    scopes.set(device.id, device.mqttTopicPrefix ? { topics, prefix: device.mqttTopicPrefix } : { topics });
  }
  return scopes;
}

/**
 * Every topic the controller may drive a device through.
 *
 * Pure, so the rule can be tested without a database — the same split that
 * makes `buildTopicIndex` testable.
 *
 * `commandTopic` is read off every capability rather than actuators only. It is
 * declared on the shared `MqttTopics` interface, so a sensor channel carrying
 * one is representable; protecting it costs nothing and leaves no hole if an
 * adapter ever emits that shape.
 */
export function buildCommandTopicSet(deviceList: AclDevice[]): Set<string> {
  const topics = new Set<string>();

  for (const device of deviceList) {
    for (const cap of device.capabilities) {
      if (cap.commandTopic) topics.add(cap.commandTopic);
      // Dimmers take level on a second topic when the firmware declares one.
      if (cap.kind === "actuator" && cap.brightnessCommandTopic) {
        topics.add(cap.brightnessCommandTopic);
      }
    }
  }

  return topics;
}

let commandTopics = new Set<string>();
let deviceScopes = new Map<string, DeviceScope>();

/**
 * Reload the command-topic ACL from the devices table.
 *
 * Unlike the ingest index, forgotten devices are **included**. Forgetting a
 * device stops Canopy talking to it; it does not unplug it, so its command
 * topic still reaches hardware that can still be switched. Dropping it from the
 * ACL would mean the UI's "forget" button quietly opened a hole.
 */
export async function refreshCommandTopics(): Promise<void> {
  try {
    const rows = await db
      .select({ id: devices.id, mqttTopicPrefix: devices.mqttTopicPrefix, capabilitiesJson: devices.capabilitiesJson })
      .from(devices);

    const list = rows.map((row) => ({
      id: row.id,
      mqttTopicPrefix: row.mqttTopicPrefix,
      capabilities: parseCapabilities(row.capabilitiesJson),
    }));
    commandTopics = buildCommandTopicSet(list);
    deviceScopes = buildDeviceScopes(list);
  } catch (err) {
    // Keep the previous set. An empty ACL authorizes everything, so discarding
    // what we have on a transient DB error would open exactly the hole this
    // closes.
    console.error("[broker] failed to rebuild command-topic ACL:", err);
  }
}

/**
 * Parsed here rather than imported from ingest: this module is reached from the
 * broker, and ingest pulls in the rules engine and actuation, which publish
 * back through the broker. A five-line guard is cheaper than that cycle.
 */
function parseCapabilities(json: string): Capability[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as Capability[]) : [];
  } catch {
    return [];
  }
}

/** Topics currently closed to clients. Startup logging and tests. */
export function commandTopicCount(): number {
  return commandTopics.size;
}

export function isCommandTopic(topic: string): boolean {
  return commandTopics.has(topic);
}

/**
 * Whether a device's own credential may publish on this topic. A device
 * Canopy no longer has (deleted since it connected) may publish nothing but
 * discovery; its client is dropped as its credential goes anyway.
 */
export function mayPublish(deviceId: string, topic: string, scopes: Map<string, DeviceScope> = deviceScopes): boolean {
  if (isDiscoveryTopic(topic)) return true;
  const scope = scopes.get(deviceId);
  if (!scope) return false;
  return scope.topics.has(topic) || (scope.prefix !== undefined && topic.startsWith(`${scope.prefix}/`));
}

/**
 * Publishes outside a device's scope are ignored, and logged once an hour per
 * device and topic: firmware repeats them every few seconds, and an unknown
 * topic is usually harmless (a status message), so the log says what was
 * ignored without filling up.
 */
const OUT_OF_SCOPE_LOG_MS = 60 * 60_000;
const outOfScopeLogged = new Map<string, number>();

function noteOutOfScope(clientId: string, deviceId: string, topic: string): void {
  const key = `${deviceId} ${topic}`;
  const now = Date.now();
  if (now - (outOfScopeLogged.get(key) ?? 0) < OUT_OF_SCOPE_LOG_MS) return;
  outOfScopeLogged.set(key, now);
  console.warn(`[broker] ignored ${topic} from ${clientId}: not one of its device's topics`);
}

/**
 * Aedes `authorizePublish` hook.
 *
 * `client` is used only for the log line. A command topic is refused whichever
 * client it came from, including the null aedes passes when publishing the will
 * of a client it no longer holds — nothing legitimate arrives here, because the
 * controller's own publishes bypass this hook entirely.
 */
export function authorizeClientPublish(
  client: Client | null,
  packet: PublishPacket,
  callback: (error?: Error | null) => void,
): void {
  if (packet.topic.startsWith(SYS_PREFIX)) {
    return callback(new Error(`${SYS_PREFIX} topic is reserved`));
  }

  if (commandTopics.has(packet.topic)) {
    console.warn(
      `[broker] refused publish to command topic ${packet.topic} ` +
        `from client ${client?.id ?? "<will>"} — commands are controller-only`,
    );
    return callback(new Error("command topics are controller-only"));
  }

  // A client without the credential, in only for the scan: a retained state
  // message would outlive its 20 seconds and be replayed to every subscriber.
  const state = clientAuth(client);
  if (state?.provisioned === false && !isDiscoveryTopic(packet.topic)) {
    packet.retain = false;
  }

  // A device's own credential, outside its device's topics: ignored, and so
  // not retained either.
  if (client && state?.deviceId && !mayPublish(state.deviceId, packet.topic)) {
    noteOutOfScope(client.id, state.deviceId, packet.topic);
    packet.retain = false;
  }

  callback(null);
}

/** Load a set directly, bypassing the database. Tests only. */
export function setCommandTopicsForTesting(deviceList: AclDevice[]): void {
  commandTopics = buildCommandTopicSet(deviceList);
}

export function resetAclForTesting(): void {
  commandTopics = new Set<string>();
  deviceScopes = new Map();
  outOfScopeLogged.clear();
}

/** Load device scopes directly, bypassing the database. Tests only. */
export function setDeviceScopesForTesting(deviceList: ScopedDevice[]): void {
  deviceScopes = buildDeviceScopes(deviceList);
}
