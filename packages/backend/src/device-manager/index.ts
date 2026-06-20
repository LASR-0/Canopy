/**
 * Device manager — entry point.
 *
 * Wires the MQTT broker's message stream into the discovery handlers
 * and starts background monitoring.
 */
import { onMqttMessage } from "../broker/index.js";
import { handleMqttMessage } from "./mqtt-discovery.js";
import { startHeartbeatMonitor } from "./heartbeat.js";

export { startScan } from "./scan-session.js";

export function startDeviceManager(): void {
  // Route all MQTT messages to the discovery handler
  onMqttMessage((topic, payload) => {
    handleMqttMessage(topic, payload);
  });

  startHeartbeatMonitor();
  console.log("[device-manager] started");
}
