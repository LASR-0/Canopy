/**
 * Telemetry ingestion — the write path for readings_raw.
 *
 * Every device on the LAN publishes to the embedded broker, but a published
 * message only becomes a `Reading` if it can be attributed to a known device
 * channel. That attribution comes from the state topics captured at discovery
 * and held here as an in-memory index, rebuilt from the devices table whenever
 * the device set changes.
 *
 * Deliberately NOT gated on a scan session. Discovery only listens while a scan
 * is open, because a scan is a user action with a 20s window; telemetry must be
 * ingested for the whole life of the service.
 *
 * Only sensor channels produce readings. An actuator publishing "ON" on its
 * state topic is proof of life, and its state is held in memory and pushed to
 * the UI when it changes (actuator-state.ts), but it is not a reading.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../store/index.js";
import { devices, readingsRaw, workspaces } from "../store/schema.js";
import { broadcast } from "../ws/index.js";
import { canIngest } from "../controller/state.js";
import { onReading } from "../rules/index.js";
import { checkThresholds } from "../rules/thresholds.js";
import { recordHeartbeat } from "./heartbeat.js";
import { deriveFromReading } from "./derived.js";
import { rememberReading } from "./latest.js";
import { noteActuatorState, parseActuatorPayload, type ActuatorBinding } from "./actuator-state.js";
import type { Capability, Metric, MqttAuth, Reading, Unit } from "@canopy/shared-types";

/** A sensor channel, resolved from the topic it publishes on. */
interface SensorBinding {
  deviceId: string;
  workspaceId: string;
  channel: string;
  metric: Metric;
  unit: Unit;
}

/** The subset of a device row the index is built from. */
export interface IndexableDevice {
  id: string;
  workspaceId: string;
  capabilities: Capability[];
}

export interface TopicIndex {
  /** state topic -> the sensor channel publishing on it. */
  sensors: Map<string, SensorBinding>;
  /** state topic -> the actuator channel reporting on it. */
  actuators: Map<string, ActuatorBinding>;
  /** state topic -> device id, for every channel including actuators. */
  owners: Map<string, string>;
}

const emptyIndex = (): TopicIndex => ({ sensors: new Map(), actuators: new Map(), owners: new Map() });

let index: TopicIndex = emptyIndex();

/**
 * Build the topic index for a set of devices.
 *
 * Pure, so the mapping rules can be tested without a database. A topic claimed
 * by two devices is won by the first: duplicates mean a misconfigured fleet,
 * and silently attributing one device's readings to another would be worse than
 * ignoring the second claim.
 */
export function buildTopicIndex(deviceList: IndexableDevice[]): TopicIndex {
  const sensors = new Map<string, SensorBinding>();
  const actuators = new Map<string, ActuatorBinding>();
  const owners = new Map<string, string>();

  for (const device of deviceList) {
    for (const cap of device.capabilities) {
      const topic = cap.stateTopic;
      if (!topic) continue;

      if (!owners.has(topic)) owners.set(topic, device.id);

      if (cap.kind === "sensor" && !sensors.has(topic)) {
        sensors.set(topic, {
          deviceId: device.id,
          workspaceId: device.workspaceId,
          channel: cap.channel,
          metric: cap.metric,
          unit: cap.unit,
        });
      }

      if (cap.kind === "actuator" && !actuators.has(topic)) {
        actuators.set(topic, {
          deviceId: device.id,
          workspaceId: device.workspaceId,
          channel: cap.channel,
          variable: cap.variable,
          ...(cap.payloadOn !== undefined ? { payloadOn: cap.payloadOn } : {}),
          ...(cap.payloadOff !== undefined ? { payloadOff: cap.payloadOff } : {}),
          ...(cap.stateOn !== undefined ? { stateOn: cap.stateOn } : {}),
          ...(cap.stateOff !== undefined ? { stateOff: cap.stateOff } : {}),
          ...(cap.brightnessScale !== undefined ? { brightnessScale: cap.brightnessScale } : {}),
        });
      }
    }
  }

  return { sensors, actuators, owners };
}

/**
 * Reload the topic index from the devices table.
 *
 * Called at startup and after any change to the device set. Forgotten devices
 * are excluded, so forgetting a device also stops its telemetry being recorded.
 * The table holds one row per paired device, so a full reload is cheap and
 * leaves no room for an incremental path to drift out of sync.
 */
export async function refreshTopicIndex(): Promise<void> {
  try {
    const rows = await db
      .select({
        id: devices.id,
        workspaceId: devices.workspaceId,
        capabilitiesJson: devices.capabilitiesJson,
      })
      .from(devices)
      // Detached devices are imported copies of hardware another device owns.
      // Devices of an archived or deleted workspace are idle until it is
      // restored: no readings are recorded, so nothing is judged or triggered.
      .where(and(
        eq(devices.forgotten, false),
        isNull(devices.detachedAt),
        inArray(
          devices.workspaceId,
          db.select({ id: workspaces.id }).from(workspaces).where(and(isNull(workspaces.archivedAt), isNull(workspaces.deletedAt))),
        ),
      ));

    index = buildTopicIndex(
      rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        capabilities: parseCapabilities(row.capabilitiesJson),
      })),
    );
  } catch (err) {
    // Keep the previous index rather than silently ingesting nothing.
    console.error("[ingest] failed to rebuild topic index:", err);
  }
}

function parseCapabilities(json: string): Capability[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as Capability[]) : [];
  } catch {
    return [];
  }
}

/** How many topics the index is currently watching — surfaced for diagnostics. */
export function indexedTopicCount(): number {
  return index.owners.size;
}

/**
 * Keys checked when a payload is a JSON object rather than a bare number.
 *
 * HA discovery without a `value_template` means a bare numeric payload, which
 * is the common case and what the simulator emits. Some firmware wraps the
 * value instead, so a short list of conventional keys is tried. Full
 * `value_template` / JSONPath evaluation is not supported.
 */
const VALUE_KEYS = ["value", "state", "tC", "temperature", "humidity", "power"] as const;

/**
 * Coerce an MQTT payload to a number, or null if it does not carry one.
 *
 * Pure and exported for testing. Booleans and on/off strings return null:
 * they are actuator state, not a measurement.
 */
export function parseNumericPayload(payload: Buffer): number | null {
  const text = payload.toString("utf8").trim();
  if (text === "") return null;

  // Bare numeric payload — the common case.
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;

  if (!text.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;

    for (const key of VALUE_KEYS) {
      const candidate = obj[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
      if (typeof candidate === "string") {
        const asNumber = Number(candidate.trim());
        if (candidate.trim() !== "" && Number.isFinite(asNumber)) return asNumber;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Handle one broker message.
 *
 * Registered for every published message, so the unknown-topic case must stay
 * the cheap one: a single Map lookup, then return.
 */
export async function handleTelemetry(topic: string, payload: Buffer, auth?: MqttAuth): Promise<void> {
  // A paused controller still monitors; only a stopped one stops recording.
  if (!canIngest()) return;

  const deviceId = index.owners.get(topic);
  if (deviceId === undefined) return;

  try {
    // Any message on a known topic is proof the device is alive, whether or not
    // it parses as a reading.
    await touchDevice(deviceId);
    if (auth) await noteDeviceAuth(deviceId, auth);

    // Not returned from: a topic can in principle carry both a state and a
    // reading, and the sensor path below decides for itself.
    const actuator = index.actuators.get(topic);
    if (actuator) {
      const parsed = parseActuatorPayload(payload, actuator);
      const changed = parsed && noteActuatorState(actuator, parsed);
      if (changed) broadcast({ type: "actuator.state", payload: changed });
    }

    const binding = index.sensors.get(topic);
    if (!binding) return;

    const value = parseNumericPayload(payload);
    if (value === null) return;

    const reading: Reading = {
      workspaceId: binding.workspaceId,
      deviceId: binding.deviceId,
      channel: binding.channel,
      metric: binding.metric,
      unit: binding.unit,
      value,
      ts: new Date().toISOString(),
    };

    await db.insert(readingsRaw).values({
      workspaceId: reading.workspaceId,
      deviceId: reading.deviceId,
      channel: reading.channel,
      metric: reading.metric,
      unit: reading.unit,
      value: reading.value,
      recordedAt: reading.ts,
    });

    rememberReading(reading);
    broadcast({ type: "reading", payload: reading });

    // Reactive work happens here rather than on a poll, so a rule responds to a
    // reading as it arrives. All are awaited: a failure in any is caught below
    // and must not silently drop the reading that caused it.
    await checkThresholds(reading, new Date(reading.ts));
    await onReading(reading, new Date(reading.ts));

    // Derived metrics are judged like any other reading, so VPD crossing its
    // threshold raises an alert and can trigger a rule. Derived *from* this one,
    // so it has to follow rather than precede.
    const derived = await deriveFromReading(reading, new Date(reading.ts));
    if (derived) {
      await checkThresholds(derived, new Date(derived.ts));
      await onReading(derived, new Date(derived.ts));
    }
  } catch (err) {
    // A bad message must never take the broker's publish handler down.
    console.error(`[ingest] failed to ingest ${topic}:`, err);
  }
}

/**
 * Heartbeat writes, throttled per device.
 *
 * Devices publish every few seconds but the offline grace period is minutes, so
 * writing on every message would be pure write amplification.
 */
const HEARTBEAT_MIN_INTERVAL_MS = 60_000;
const lastHeartbeat = new Map<string, number>();

/** How each device last connected, as written to the database. */
const knownAuth = new Map<string, MqttAuth>();

/**
 * Record whether a device connects with the broker credential, written only
 * when it changes (or first seen since a restart), not on every message.
 * Settings lists the devices without one: they are what stop credentials
 * being required.
 */
async function noteDeviceAuth(deviceId: string, auth: MqttAuth): Promise<void> {
  if (knownAuth.get(deviceId) === auth) return;
  knownAuth.set(deviceId, auth);
  await db.update(devices).set({ mqttAuth: auth }).where(eq(devices.id, deviceId));
}

async function touchDevice(deviceId: string): Promise<void> {
  const now = Date.now();
  const previous = lastHeartbeat.get(deviceId);
  if (previous !== undefined && now - previous < HEARTBEAT_MIN_INTERVAL_MS) return;
  lastHeartbeat.set(deviceId, now);
  await recordHeartbeat(deviceId);
}

/** Reset module state. Tests only. */
export function resetIngestState(): void {
  index = emptyIndex();
  lastHeartbeat.clear();
}

/** Replace the active index directly. Tests only. */
export function setTopicIndexForTesting(deviceList: IndexableDevice[]): void {
  index = buildTopicIndex(deviceList);
}
