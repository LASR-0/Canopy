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
 * state topic is proof of life, so it refreshes the device heartbeat and is
 * otherwise ignored — reflecting actuator state back into the UI is Phase 4.
 */
import { eq } from "drizzle-orm";
import { db } from "../store/index.js";
import { devices, readingsRaw } from "../store/schema.js";
import { broadcast } from "../ws/index.js";
import { canIngest } from "../controller/state.js";
import { recordHeartbeat } from "./heartbeat.js";
import type { Capability, Metric, Reading, Unit } from "@canopy/shared-types";

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
  /** state topic -> device id, for every channel including actuators. */
  owners: Map<string, string>;
}

let index: TopicIndex = { sensors: new Map(), owners: new Map() };

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
    }
  }

  return { sensors, owners };
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
      .where(eq(devices.forgotten, false));

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
export async function handleTelemetry(topic: string, payload: Buffer): Promise<void> {
  // A paused controller still monitors; only a stopped one stops recording.
  if (!canIngest()) return;

  const deviceId = index.owners.get(topic);
  if (deviceId === undefined) return;

  try {
    // Any message on a known topic is proof the device is alive, whether or not
    // it parses as a reading.
    await touchDevice(deviceId);

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

    broadcast({ type: "reading", payload: reading });
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

async function touchDevice(deviceId: string): Promise<void> {
  const now = Date.now();
  const previous = lastHeartbeat.get(deviceId);
  if (previous !== undefined && now - previous < HEARTBEAT_MIN_INTERVAL_MS) return;
  lastHeartbeat.set(deviceId, now);
  await recordHeartbeat(deviceId);
}

/** Reset module state. Tests only. */
export function resetIngestState(): void {
  index = { sensors: new Map(), owners: new Map() };
  lastHeartbeat.clear();
}

/** Replace the active index directly. Tests only. */
export function setTopicIndexForTesting(deviceList: IndexableDevice[]): void {
  index = buildTopicIndex(deviceList);
}
