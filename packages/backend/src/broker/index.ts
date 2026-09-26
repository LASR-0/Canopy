/**
 * Embedded MQTT broker (Aedes).
 *
 * All devices on the local network publish to this broker. The HA-style
 * discovery listener subscribes to homeassistant/+/+/config to auto-populate
 * devices without requiring manual configuration.
 */
import { Aedes, type AedesPublishPacket, type Client } from "aedes";
import { createServer } from "node:net";

export const MQTT_PORT = Number(process.env["MQTT_PORT"] ?? 1883);

let _broker: Aedes | null = null;
let _listening = false;

export function getBroker(): Aedes {
  if (!_broker) throw new Error("MQTT broker has not been started");
  return _broker;
}

/** True once the broker is built and its TCP server is accepting connections. */
export function isBrokerOnline(): boolean {
  return _broker !== null && _listening;
}

/** Devices currently holding an MQTT connection. Zero is normal before pairing. */
export function connectedClientCount(): number {
  return _broker?.connectedClients ?? 0;
}

type MessageHandler = (topic: string, payload: Buffer, packet: AedesPublishPacket) => void;
const messageHandlers: MessageHandler[] = [];

/** Register a handler called for every published MQTT message. */
export function onMqttMessage(handler: MessageHandler): void {
  messageHandlers.push(handler);
}

export async function startBroker(): Promise<void> {
  // aedes 1.x: the broker MUST be built by the async factory. `new Aedes()`
  // constructs an instance whose listen() never runs, so persistence is never
  // set up and the server accepts TCP but never answers CONNECT with CONNACK —
  // clients just hang until connack timeout.
  _broker = await Aedes.createBroker();

  _broker.on("publish", (packet: AedesPublishPacket, client: Client | null) => {
    if (!client) return;
    for (const handler of messageHandlers) {
      handler(packet.topic, packet.payload as Buffer, packet);
    }
  });

  _broker.on("client", (client: Client) => {
    console.log(`[broker] connected: ${client.id}`);
  });

  _broker.on("clientDisconnect", (client: Client) => {
    console.log(`[broker] disconnected: ${client.id}`);
  });

  _broker.on("clientError", (client: Client, err: Error) => {
    console.error(`[broker] client error (${client.id}):`, err.message);
  });

  const server = createServer(_broker.handle.bind(_broker));

  return new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.on("close", () => { _listening = false; });
    server.listen(MQTT_PORT, "0.0.0.0", () => {
      _listening = true;
      console.log(`[broker] MQTT listening on port ${MQTT_PORT}`);
      resolve();
    });
  });
}
