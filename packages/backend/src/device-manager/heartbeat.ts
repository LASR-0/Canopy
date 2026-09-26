/**
 * Device heartbeat tracker.
 *
 * Marks devices offline when they haven't published in longer than the
 * grace period. MQTT devices are tracked via broker activity; mDNS/HTTP
 * devices are polled periodically.
 *
 * Runs as a background interval started by startDeviceManager().
 */
import { eq, lt, and, inArray } from "drizzle-orm";
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import { broadcast } from "../ws/index.js";
import { recordEvent } from "../automation/apply.js";

const OFFLINE_GRACE_MS = 5 * 60_000; // 5 minutes of silence → offline
const CHECK_INTERVAL_MS = 60_000;     // check every minute

let _interval: ReturnType<typeof setInterval> | null = null;

/**
 * Record a heartbeat for a device (called when it publishes to the broker).
 *
 * A device that was marked offline and has started talking again is worth a
 * timeline entry: "the sensor came back" is what explains a gap in the charts,
 * and without it the feed only ever reports the bad half of the story.
 */
export async function recordHeartbeat(deviceId: string): Promise<void> {
  const now = new Date().toISOString();

  const [before] = await db
    .select({ online: devices.online, workspaceId: devices.workspaceId, name: devices.name })
    .from(devices)
    .where(eq(devices.id, deviceId));

  await db.update(devices)
    .set({ online: true, lastSeen: now })
    .where(eq(devices.id, deviceId));

  if (before && !before.online) {
    await recordEvent({
      workspaceId: before.workspaceId,
      type: "device_online",
      sourceId: deviceId,
      sourceLabel: before.name,
      description: `${before.name} is back online`,
    });
    broadcast({ type: "device.status", payload: { deviceId, online: true } });
  }
}

/** Start the background loop that marks silent devices offline. */
export function startHeartbeatMonitor(): void {
  if (_interval) return;

  _interval = setInterval(() => {
    void checkOfflineDevices();
  }, CHECK_INTERVAL_MS);
}

export function stopHeartbeatMonitor(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

async function checkOfflineDevices(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - OFFLINE_GRACE_MS).toISOString();

    // Find online devices that haven't been seen since the cutoff
    const stale = await db
      .select({ id: devices.id, workspaceId: devices.workspaceId, name: devices.name })
      .from(devices)
      .where(and(eq(devices.online, true), lt(devices.lastSeen, cutoff)));

    if (stale.length === 0) return;

    // Only the stale ones. Matching on `online = true` would knock every live
    // device offline as soon as a single one went quiet, and the broadcast below
    // would not even mention them, so the UI would disagree with the database
    // until the next reading arrived.
    await db.update(devices).set({ online: false }).where(
      inArray(devices.id, stale.map(({ id }) => id)),
    );

    for (const { id, workspaceId, name } of stale) {
      // A sensor going quiet is the most common cause of a chart that stops
      // moving, so it belongs in the timeline rather than only in the log.
      await recordEvent({
        workspaceId,
        type: "device_offline",
        sourceId: id,
        sourceLabel: name,
        description: `${name} stopped reporting`,
        severity: "warn",
      });
      broadcast({ type: "device.status", payload: { deviceId: id, online: false } });
    }
  } catch (err) {
    console.error("[heartbeat] check failed:", err);
  }
}
