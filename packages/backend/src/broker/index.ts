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

/**
 * Publish a message as the controller itself.
 *
 * QoS 0 and not retained: a command is an instruction to act now, and a
 * retained one would be replayed at every device reconnect, switching hardware
 * on hours later for no reason.
 *
 * Note that aedes does not deliver a broker-originated publish back to this
 * process's own `publish` handlers, so ingestion never sees these. Devices
 * echoing their new state on the state topic is what closes the loop.
 */
export async function publishToBroker(topic: string, payload: string): Promise<void> {
  const broker = getBroker();

  return new Promise<void>((resolve, reject) => {
    broker.publish(
      {
        cmd: "publish",
        topic,
        payload: Buffer.from(payload, "utf8"),
        qos: 0,
        retain: false,
        dup: false,
      },
      (error?: Error) => (error ? reject(error) : resolve()),
    );
  });
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
