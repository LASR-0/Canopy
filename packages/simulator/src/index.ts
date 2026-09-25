/**
 * Canopy device simulator.
 *
 * Impersonates a tent's worth of HA-discoverable MQTT devices so backend work
 * can proceed without hardware. It connects OUTBOUND to the embedded Aedes
 * broker on loopback, so it needs no LAN multicast and works under WSL2 NAT —
 * which is the whole reason it exists.
 *
 * Usage:  pnpm dev:sim        (with the controller already running)
 *
 * Env:
 *   SIM_BROKER_URL    default mqtt://127.0.0.1:1883
 *   SIM_SEED          default 1      — same seed, same telemetry
 *   SIM_ANNOUNCE_MS   default 5000   — must stay well under the backend's
 *                                      20s scan window, or a scan started
 *                                      after startup finds nothing
 *   SIM_TELEMETRY_MS  default 5000
 */
import mqtt from "mqtt";
import { mulberry32 } from "./rng.js";
import { FLEET, topics, componentOf, MANUFACTURER, SW_VERSION } from "./fleet.js";
import type { DeviceSpec, SensorSpec } from "./fleet.js";

const BROKER_URL = process.env["SIM_BROKER_URL"] ?? "mqtt://127.0.0.1:1883";
const SEED = Number(process.env["SIM_SEED"] ?? 1);
const ANNOUNCE_MS = Number(process.env["SIM_ANNOUNCE_MS"] ?? 5000);
const TELEMETRY_MS = Number(process.env["SIM_TELEMETRY_MS"] ?? 5000);

const rng = mulberry32(SEED);

/** Mean-reverting random walk — drifts plausibly instead of jittering. */
function createWalk(spec: SensorSpec): () => number {
  let value = spec.start;
  return () => {
    const pull = (spec.start - value) * spec.reversion;
    const noise = (rng() * 2 - 1) * spec.drift;
    value = Math.min(spec.max, Math.max(spec.min, value + pull + noise));
    return Number(value.toFixed(spec.precision));
  };
}

const walks = new Map<string, () => number>();
const actuatorState = new Map<string, { on: boolean; level: number }>();

for (const spec of FLEET) {
  if (spec.kind === "sensor") walks.set(spec.id, createWalk(spec));
  else actuatorState.set(spec.id, { on: spec.initialOn, level: spec.initialOn ? 100 : 0 });
}

/** The HA discovery payload for one spec. */
function discoveryPayload(spec: DeviceSpec): Record<string, unknown> {
  const base = {
    name: spec.name,
    unique_id: `canopy-sim-${spec.id}`,
    state_topic: topics.state(spec.id),
    device: {
      identifiers: [`canopy-sim-${spec.id}`],
      name: spec.name,
      model: spec.model,
      manufacturer: MANUFACTURER,
      sw_version: SW_VERSION,
    },
  };

  if (spec.kind === "sensor") {
    return { ...base, device_class: spec.deviceClass, unit_of_measurement: spec.unit };
  }

  return {
    ...base,
    command_topic: topics.command(spec.id),
    payload_on: "ON",
    payload_off: "OFF",
    ...(spec.brightness === true ? { brightness: true } : {}),
  };
}

function announce(client: mqtt.MqttClient): void {
  for (const spec of FLEET) {
    const topic = topics.discovery(componentOf(spec), spec.id);
    client.publish(topic, JSON.stringify(discoveryPayload(spec)), { retain: true, qos: 0 });
  }

  // Second discovery surface: Shelly Gen 1 announce, handled by adapters/shelly.ts
  // rather than the HA path. Exercises deviceFromShellyAnnounce + capsForModel.
  client.publish(
    "shellies/announce",
    JSON.stringify({
      id: "shellyplug-s-SIM01",
      model: "shellyplug-s",
      ip: "127.0.0.1",
      fw_ver: SW_VERSION,
    }),
    { retain: true, qos: 0 },
  );
}

function publishTelemetry(client: mqtt.MqttClient): void {
  for (const spec of FLEET) {
    if (spec.kind === "sensor") {
      const next = walks.get(spec.id)?.();
      if (next === undefined) continue;
      client.publish(topics.state(spec.id), String(next), { qos: 0 });
    } else {
      const st = actuatorState.get(spec.id);
      if (!st) continue;
      client.publish(topics.state(spec.id), st.on ? "ON" : "OFF", { qos: 0 });
    }
  }
}

/** Reflect a command back as state, so Phase 4 actuation has something to drive. */
function handleCommand(client: mqtt.MqttClient, topic: string, payload: Buffer): void {
  const match = topic.match(/^canopy\/([^/]+)\/set$/);
  if (!match) return;
  const id = match[1];
  if (!id) return;

  const st = actuatorState.get(id);
  if (!st) return;

  const body = payload.toString().trim();
  const asLevel = Number(body);

  if (Number.isFinite(asLevel) && body !== "") {
    st.level = Math.min(100, Math.max(0, asLevel));
    st.on = st.level > 0;
  } else {
    st.on = body.toUpperCase() === "ON";
    st.level = st.on ? 100 : 0;
  }

  console.log(`[sim] ${id} <- ${body} (on=${st.on} level=${st.level})`);
  client.publish(topics.state(id), st.on ? "ON" : "OFF", { qos: 0 });
}

function main(): void {
  console.log(`[sim] connecting to ${BROKER_URL}`);
  const client = mqtt.connect(BROKER_URL, { clientId: `canopy-sim-${process.pid}`, clean: true });

  let announceTimer: ReturnType<typeof setInterval> | null = null;
  let telemetryTimer: ReturnType<typeof setInterval> | null = null;

  client.on("connect", () => {
    const sensors = FLEET.filter((d) => d.kind === "sensor").length;
    const actuators = FLEET.length - sensors;
    console.log(`[sim] connected — ${sensors} sensors, ${actuators} actuators, +1 Shelly announce`);
    console.log(`[sim] seed=${SEED} announce=${ANNOUNCE_MS}ms telemetry=${TELEMETRY_MS}ms`);

    client.subscribe("canopy/+/set", (err) => {
      if (err) console.error("[sim] command subscribe failed:", err.message);
    });

    announce(client);
    publishTelemetry(client);

    // Re-announce: discovery only reaches the backend while a scan session is
    // open, and scans last 20s. Announcing once at startup would be invisible
    // to any scan the user starts afterwards.
    announceTimer = setInterval(() => announce(client), ANNOUNCE_MS);
    telemetryTimer = setInterval(() => publishTelemetry(client), TELEMETRY_MS);
  });

  client.on("message", (topic, payload) => handleCommand(client, topic, payload));
  client.on("error", (err) => console.error("[sim] mqtt error:", err.message));
  client.on("close", () => console.log("[sim] connection closed"));

  const shutdown = (): void => {
    console.log("\n[sim] shutting down");
    if (announceTimer) clearInterval(announceTimer);
    if (telemetryTimer) clearInterval(telemetryTimer);
    client.end(false, {}, () => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
