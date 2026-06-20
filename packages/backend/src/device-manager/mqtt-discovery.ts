/**
 * MQTT device discovery — HA-style retained config topics.
 *
 * Listens on homeassistant/+/+/config and shellies/announce for devices
 * that announce themselves via MQTT. Called by startDeviceManager() which
 * registers this as an onMqttMessage handler.
 */
import { parseHaDiscovery } from "./adapters/generic-mqtt.js";
import { deviceFromShellyAnnounce } from "./adapters/shelly.js";
import type { Device } from "@canopy/shared-types";

type DiscoveryCallback = (device: Omit<Device, "id">) => void;

const activeListeners = new Map<string, DiscoveryCallback>();

/** Register a workspace to receive MQTT-discovered devices. */
export function registerMqttDiscovery(workspaceId: string, onFound: DiscoveryCallback): void {
  activeListeners.set(workspaceId, onFound);
}

export function unregisterMqttDiscovery(workspaceId: string): void {
  activeListeners.delete(workspaceId);
}

/**
 * Called for every MQTT message published to the broker.
 * Tries each adapter in order; first match wins.
 */
export function handleMqttMessage(topic: string, payload: Buffer): void {
  if (activeListeners.size === 0) return;

  for (const [workspaceId, onFound] of activeListeners) {
    // Shelly Gen 1 announce
    if (topic === "shellies/announce") {
      const device = deviceFromShellyAnnounce(payload, workspaceId);
      if (device) onFound(device);
      continue;
    }

    // HA-style discovery
    if (topic.startsWith("homeassistant/") && topic.endsWith("/config")) {
      const device = parseHaDiscovery(topic, payload, workspaceId);
      if (device) onFound(device);
    }
  }
}
