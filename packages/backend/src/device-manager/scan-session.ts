/**
 * Scan session manager.
 *
 * Coordinates an mDNS + MQTT discovery scan for a workspace.
 * Persists each discovered device immediately, deduplicates by host/MQTT prefix,
 * and pushes WS events so the frontend sees devices appear in real time.
 */
import { randomUUID } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import { broadcast } from "../ws/index.js";
import { runMdnsScan } from "./mdns-scanner.js";
import { registerMqttDiscovery, unregisterMqttDiscovery } from "./mqtt-discovery.js";
import { refreshDeviceTopics } from "./topics.js";
import { setDiscoveryWindow } from "../broker/index.js";
import { provisionPairedDevice } from "./device-credentials.js";
import { mergeCapabilities } from "./adapters/generic-mqtt.js";
import type { Capability, Device, MqttAuth } from "@canopy/shared-types";

const SCAN_DURATION_MS = 20_000;

interface ScanSession {
  scanId: string;
  workspaceId: string;
  found: number;
  cancel: () => void;
  timer: ReturnType<typeof setTimeout>;
}

const activeSessions = new Map<string, ScanSession>();

/** The discovery being saved now; the next waits for it. */
let pairing: Promise<void> = Promise.resolve();

/** Start a scan for the given workspace. Returns the scanId. */
export async function startScan(workspaceId: string): Promise<string> {
  // Cancel any existing scan for this workspace
  const existing = [...activeSessions.values()].find((s) => s.workspaceId === workspaceId);
  // Replaced, not ended: the window stays open for the scan that follows.
  if (existing) cancelScan(existing.scanId, false);

  const scanId = randomUUID();

  const onFound = (raw: Omit<Device, "id">) => {
    // One at a time: a board announces its entities together, and two
    // upserts racing would each miss the other and pair it twice.
    pairing = pairing
      .then(() => pair(raw))
      .catch((err: unknown) => console.error("[scan] failed to pair a discovered device:", err));
    return pairing;
  };

  const pair = async (raw: Omit<Device, "id">) => {
    const device = await upsertDevice(raw);
    if (!device) return;

    const session = activeSessions.get(scanId);
    if (session) session.found++;

    // A newly paired device must start being ingested immediately, not on the
    // next restart, and its command topic must close to the LAN just as fast.
    await refreshDeviceTopics();
    // Its own broker credential, sent to it when it is a Shelly (Phase 8 G).
    try {
      await provisionPairedDevice(device.id);
    } catch (err) {
      console.error(`[scan] failed to give ${device.name} a broker credential:`, err);
    }

    broadcast({ type: "scan.device_found", payload: { device, scanId } });
  };

  // Start mDNS scan
  const cancelMdns = runMdnsScan(workspaceId, (d) => { void onFound(d); });

  // Register MQTT discovery for this workspace
  registerMqttDiscovery(workspaceId, (d) => { void onFound(d); });

  const timer = setTimeout(() => {
    finishScan(scanId);
  }, SCAN_DURATION_MS);

  activeSessions.set(scanId, {
    scanId,
    workspaceId,
    found: 0,
    cancel: cancelMdns,
    timer,
  });
  // A device without the broker credential may now connect, to announce
  // itself (broker/auth.ts), for as long as any scan is open.
  setDiscoveryWindow(true);

  return scanId;
}

function cancelScan(scanId: string, closeWindow = true): void {
  const session = activeSessions.get(scanId);
  if (!session) return;
  clearTimeout(session.timer);
  session.cancel();
  unregisterMqttDiscovery(session.workspaceId);
  activeSessions.delete(scanId);
  if (closeWindow) closeWindowIfIdle();
}

/** Cancel every scan in progress, closing its mDNS browsers. For shutdown. */
export function cancelAllScans(): void {
  for (const scanId of [...activeSessions.keys()]) cancelScan(scanId);
}

function finishScan(scanId: string): void {
  const session = activeSessions.get(scanId);
  if (!session) return;
  session.cancel();
  unregisterMqttDiscovery(session.workspaceId);
  broadcast({ type: "scan.complete", payload: { scanId, found: session.found } });
  activeSessions.delete(scanId);
  closeWindowIfIdle();
}

/** The last scan to finish closes the window, and drops what came in through it. */
function closeWindowIfIdle(): void {
  if (activeSessions.size === 0) setDiscoveryWindow(false);
}

/** The row a discovered device updates, if it is already known. */
async function findExisting(raw: Omit<Device, "id">): Promise<typeof devices.$inferSelect | undefined> {
  const { workspaceId, address, discoveryKey } = raw;
  const inWorkspace = eq(devices.workspaceId, workspaceId);

  // One board, many entities: matched by the board, whatever the entity's topics.
  if (discoveryKey) {
    const [byKey] = await db.select().from(devices).where(and(inWorkspace, eq(devices.discoveryKey, discoveryKey)));
    if (byKey) return byKey;
    // Found before boards were told apart (Phase 8 G): matched by prefix
    // once, and given its key on the way.
    if (!address.mqttTopicPrefix) return undefined;
    const [byPrefix] = await db.select().from(devices)
      .where(and(inWorkspace, eq(devices.mqttTopicPrefix, address.mqttTopicPrefix), isNull(devices.discoveryKey)));
    return byPrefix;
  }

  if (address.host) {
    const [byHost] = await db.select().from(devices).where(and(inWorkspace, eq(devices.host, address.host)));
    return byHost;
  }
  if (address.mqttTopicPrefix) {
    const [byPrefix] = await db.select().from(devices).where(and(inWorkspace, eq(devices.mqttTopicPrefix, address.mqttTopicPrefix)));
    return byPrefix;
  }
  return undefined;
}

/**
 * Persist a discovered device. A board announced over HA discovery is matched
 * by its `discoveryKey`, and each entity it announces is added to the one
 * device; otherwise by (workspaceId, host) for mDNS devices or
 * (workspaceId, mqttTopicPrefix) for MQTT ones.
 * Returns the full Device (with id) if it was new or updated.
 */
async function upsertDevice(raw: Omit<Device, "id">): Promise<Device | null> {
  try {
    const { workspaceId, address } = raw;
    const found = await findExisting(raw);
    const existing = found ? [found] : [];

    const id = existing[0]?.id ?? randomUUID();
    const now = new Date().toISOString();

    const row = {
      id,
      workspaceId,
      name: raw.name,
      family: raw.family,
      protocol: address.protocol,
      ...(address.host           ? { host: address.host }                         : {}),
      ...(address.port           ? { port: address.port }                         : {}),
      ...(address.mqttTopicPrefix ? { mqttTopicPrefix: address.mqttTopicPrefix }  : {}),
      ...(raw.model              ? { model: raw.model }                           : {}),
      ...(raw.firmware           ? { firmware: raw.firmware }                     : {}),
      // A board's entities arrive one at a time, so they are added together.
      // Anything else announces itself whole, and replaces what it was.
      capabilitiesJson: JSON.stringify(
        raw.discoveryKey && existing[0]
          ? mergeCapabilities(JSON.parse(existing[0].capabilitiesJson) as Capability[], raw.capabilities)
          : raw.capabilities,
      ),
      discoveredVia: raw.discoveredVia,
      online: true,
      forgotten: false,
      lastSeen: now,
      ...(raw.signalPct != null  ? { signalPct: raw.signalPct }                  : {}),
      ...(raw.mqttAuth           ? { mqttAuth: raw.mqttAuth }                    : {}),
      ...(raw.discoveryKey       ? { discoveryKey: raw.discoveryKey }            : {}),
      runtimeHours: existing[0]?.runtimeHours ?? 0,
    };

    if (existing[0]) {
      // The prefix it was first found under stays: a board's entities each
      // carry their own, and the device keeps one.
      await db.update(devices).set({
        ...row,
        name: existing[0].name,
        ...(raw.discoveryKey && existing[0].mqttTopicPrefix ? { mqttTopicPrefix: existing[0].mqttTopicPrefix } : {}),
      }).where(eq(devices.id, id));
    } else {
      await db.insert(devices).values(row);
    }

    const [saved] = await db.select().from(devices).where(eq(devices.id, id));
    if (!saved) return null;

    return rowToDevice(saved);
  } catch (err) {
    console.error("[scan] failed to upsert device:", err);
    return null;
  }
}

function rowToDevice(row: typeof devices.$inferSelect): Device {
  const device: Device = {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    family: row.family as Device["family"],
    address: { protocol: row.protocol as Device["address"]["protocol"] },
    capabilities: JSON.parse(row.capabilitiesJson) as Device["capabilities"],
    discoveredVia: row.discoveredVia as Device["discoveredVia"],
    online: row.online,
    runtimeHours: row.runtimeHours,
  };
  if (row.host)             device.address.host = row.host;
  if (row.port != null)     device.address.port = row.port;
  if (row.mqttTopicPrefix)  device.address.mqttTopicPrefix = row.mqttTopicPrefix;
  if (row.model)            device.model = row.model;
  if (row.firmware)         device.firmware = row.firmware;
  if (row.lastSeen)         device.lastSeen = row.lastSeen;
  if (row.signalPct != null) device.signalPct = row.signalPct;
  if (row.mqttAuth)         device.mqttAuth = row.mqttAuth as MqttAuth;
  if (row.discoveryKey)     device.discoveryKey = row.discoveryKey;
  return device;
}
