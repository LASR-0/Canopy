/**
 * MQTT device discovery — HA-style retained config topics.
 *
 * Listens on homeassistant/+/+/config and shellies/announce for devices
 * that announce themselves via MQTT. Called by startDeviceManager() which
 * registers this as an onMqttMessage handler.
 */
import { parseHaDiscovery } from "./adapters/generic-mqtt.js";
import { deviceFromShellyAnnounce } from "./adapters/shelly.js";
import type { Device, MqttAuth } from "@canopy/shared-types";

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
export function handleMqttMessage(topic: string, payload: Buffer, auth?: MqttAuth): void {
  if (activeListeners.size === 0) return;

  // A device found over a connection without the credential is recorded so,
  // and Settings can tell the grower it still needs one.
  const found = (onFound: DiscoveryCallback, device: Omit<Device, "id"> | null) => {
    if (device) onFound(auth ? { ...device, mqttAuth: auth } : device);
  };

  for (const [workspaceId, onFound] of activeListeners) {
    // Shelly Gen 1 announce
    if (topic === "shellies/announce") {
      found(onFound, deviceFromShellyAnnounce(payload, workspaceId));
      continue;
    }

    // HA-style discovery
    if (topic.startsWith("homeassistant/") && topic.endsWith("/config")) {
      found(onFound, parseHaDiscovery(topic, payload, workspaceId));
    }
  }
}
