/**
 * Device manager — entry point.
 *
 * Wires the MQTT broker's message stream into the discovery handlers
 * and starts background monitoring.
 */
import { onMqttMessage } from "../broker/index.js";
import { handleMqttMessage } from "./mqtt-discovery.js";
import { startHeartbeatMonitor } from "./heartbeat.js";
import { handleTelemetry, indexedTopicCount, refreshTopicIndex } from "./ingest.js";

export { startScan } from "./scan-session.js";
export { refreshTopicIndex } from "./ingest.js";

export async function startDeviceManager(): Promise<void> {
  // Devices paired in an earlier run must be ingested from the first message,
  // without waiting for a scan, so the index is loaded before the broker's
  // messages start flowing through.
  await refreshTopicIndex();

  // Route all MQTT messages to discovery and to telemetry ingestion. The two
  // are independent: discovery only listens during a scan, ingestion always.
  onMqttMessage((topic, payload) => {
    handleMqttMessage(topic, payload);
    void handleTelemetry(topic, payload);
  });

  startHeartbeatMonitor();
  console.log(`[device-manager] started — ingesting ${indexedTopicCount()} device topics`);
}
