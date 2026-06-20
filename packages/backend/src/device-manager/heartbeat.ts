/**
 * Device heartbeat tracker.
 *
 * Marks devices offline when they haven't published in longer than the
 * grace period. MQTT devices are tracked via broker activity; mDNS/HTTP
 * devices are polled periodically.
 *
 * Runs as a background interval started by startDeviceManager().
 */
import { eq, lt, and } from "drizzle-orm";
import { db } from "../store/index.js";
import { devices } from "../store/schema.js";
import { broadcast } from "../ws/index.js";

const OFFLINE_GRACE_MS = 5 * 60_000; // 5 minutes of silence → offline
const CHECK_INTERVAL_MS = 60_000;     // check every minute

let _interval: ReturnType<typeof setInterval> | null = null;

/** Record a heartbeat for a device (called when it publishes to the broker). */
export async function recordHeartbeat(deviceId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.update(devices)
    .set({ online: true, lastSeen: now })
    .where(eq(devices.id, deviceId));
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
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.online, true), lt(devices.lastSeen, cutoff)));

    if (stale.length === 0) return;

    await db.update(devices).set({ online: false }).where(
      eq(devices.online, true),
    );

    for (const { id } of stale) {
      broadcast({ type: "device.status", payload: { deviceId: id, online: false } });
    }
  } catch (err) {
    console.error("[heartbeat] check failed:", err);
  }
}
