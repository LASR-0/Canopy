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
 * Scope: this authorizes, it does not authenticate. A client may still connect
 * anonymously and publish telemetry on a state topic. Closing that needs
 * credential provisioning for devices that were adopted anonymously, which is
 * Tier 2 in Phase 8.
 */
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import type { Capability } from "@canopy/shared-types";
import type { Client, PublishPacket } from "aedes";

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
      .select({ capabilitiesJson: devices.capabilitiesJson })
      .from(devices);

    commandTopics = buildCommandTopicSet(
      rows.map((row) => ({ capabilities: parseCapabilities(row.capabilitiesJson) })),
    );
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

  callback(null);
}

/** Load a set directly, bypassing the database. Tests only. */
export function setCommandTopicsForTesting(deviceList: AclDevice[]): void {
  commandTopics = buildCommandTopicSet(deviceList);
}

export function resetAclForTesting(): void {
  commandTopics = new Set<string>();
}
