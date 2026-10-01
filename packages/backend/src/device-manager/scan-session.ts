/**
 * Scan session manager.
 *
 * Coordinates an mDNS + MQTT discovery scan for a workspace.
 * Persists each discovered device immediately, deduplicates by host/MQTT prefix,
 * and pushes WS events so the frontend sees devices appear in real time.
 */
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import { broadcast } from "../ws/index.js";
import { runMdnsScan } from "./mdns-scanner.js";
import { registerMqttDiscovery, unregisterMqttDiscovery } from "./mqtt-discovery.js";
import { refreshDeviceTopics } from "./topics.js";
import { setDiscoveryWindow } from "../broker/index.js";
import type { Device, MqttAuth } from "@canopy/shared-types";

const SCAN_DURATION_MS = 20_000;

interface ScanSession {
  scanId: string;
  workspaceId: string;
  found: number;
  cancel: () => void;
  timer: ReturnType<typeof setTimeout>;
}

const activeSessions = new Map<string, ScanSession>();

/** Start a scan for the given workspace. Returns the scanId. */
export async function startScan(workspaceId: string): Promise<string> {
  // Cancel any existing scan for this workspace
  const existing = [...activeSessions.values()].find((s) => s.workspaceId === workspaceId);
  // Replaced, not ended: the window stays open for the scan that follows.
  if (existing) cancelScan(existing.scanId, false);

  const scanId = randomUUID();

  const onFound = async (raw: Omit<Device, "id">) => {
    const device = await upsertDevice(raw);
    if (!device) return;

    const session = activeSessions.get(scanId);
    if (session) session.found++;

    // A newly paired device must start being ingested immediately, not on the
    // next restart, and its command topic must close to the LAN just as fast.
    await refreshDeviceTopics();

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

/**
 * Persist a discovered device, deduplicating by (workspaceId, host) for mDNS
 * devices or (workspaceId, mqttTopicPrefix) for MQTT devices.
 * Returns the full Device (with id) if it was new or updated.
 */
async function upsertDevice(raw: Omit<Device, "id">): Promise<Device | null> {
  try {
    const { workspaceId, address } = raw;

    // Find existing by host or MQTT prefix
    const existing = await db.select().from(devices).where(
      address.host
        ? and(eq(devices.workspaceId, workspaceId), eq(devices.host, address.host))
        : address.mqttTopicPrefix
          ? and(eq(devices.workspaceId, workspaceId), eq(devices.mqttTopicPrefix, address.mqttTopicPrefix))
          : eq(devices.workspaceId, "__never__"), // safety fallback
    );

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
      capabilitiesJson: JSON.stringify(raw.capabilities),
      discoveredVia: raw.discoveredVia,
      online: true,
      forgotten: false,
      lastSeen: now,
      ...(raw.signalPct != null  ? { signalPct: raw.signalPct }                  : {}),
      ...(raw.mqttAuth           ? { mqttAuth: raw.mqttAuth }                    : {}),
      runtimeHours: existing[0]?.runtimeHours ?? 0,
    };

    if (existing[0]) {
      await db.update(devices).set({ ...row, name: existing[0].name }).where(eq(devices.id, id));
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
  return device;
}
