/**
 * Which hardware is claimed. A device is its MQTT topics on the wire, and two
 * devices on the same topics would split readings and commands between them,
 * so an import or a restore that brings in a device whose hardware another
 * live device already holds brings it in **detached** (`devices.detached_at`).
 *
 * Only devices that are acting count: not forgotten, not detached, and in a
 * live workspace. An archived or deleted workspace's devices are idle, so
 * their hardware is free for another workspace to find.
 */
import type { Database } from "better-sqlite3";

export interface DeviceTopicsRow {
  mqtt_topic_prefix: string | null;
  capabilities_json: string;
}

/** The topics a device answers on: its prefix and every capability's topics. */
export function deviceTopics(row: DeviceTopicsRow): Set<string> {
  const topics = new Set<string>();
  if (row.mqtt_topic_prefix) topics.add(`prefix:${row.mqtt_topic_prefix}`);
  try {
    for (const cap of JSON.parse(row.capabilities_json) as { stateTopic?: string; commandTopic?: string }[]) {
      if (cap.stateTopic) topics.add(cap.stateTopic);
      if (cap.commandTopic) topics.add(cap.commandTopic);
    }
  } catch {
    // A device with unreadable capabilities claims only its prefix.
  }
  return topics;
}

/** Every topic held by an acting device, leaving out one workspace's own. */
export function claimedTopics(db: Database, exceptWorkspaceId?: string): Set<string> {
  const rows = db.prepare(`
    SELECT d.mqtt_topic_prefix, d.capabilities_json FROM main.devices d
    JOIN main.workspaces w ON w.id = d.workspace_id
    WHERE d.forgotten = 0 AND d.detached_at IS NULL
      AND w.archived_at IS NULL AND w.deleted_at IS NULL
      AND d.workspace_id IS NOT ?
  `).all(exceptWorkspaceId ?? null) as DeviceTopicsRow[];
  const all = new Set<string>();
  for (const row of rows) for (const t of deviceTopics(row)) all.add(t);
  return all;
}

/** Of these devices, the ids of those whose hardware is already claimed. */
export function alreadyClaimed(
  devices: readonly (DeviceTopicsRow & { id: string })[],
  claimed: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const device of devices) {
    for (const t of deviceTopics(device)) {
      if (claimed.has(t)) { out.add(device.id); break; }
    }
  }
  return out;
}
