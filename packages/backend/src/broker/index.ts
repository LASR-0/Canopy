/**
 * Embedded MQTT broker (Aedes).
 *
 * All devices on the local network publish to this broker. The HA-style
 * discovery listener subscribes to homeassistant/+/+/config to auto-populate
 * devices without requiring manual configuration.
 */
import { Aedes, type AedesPublishPacket, type Client } from "aedes";
import { createServer, type Server } from "node:net";
import type { MqttAuth } from "@canopy/shared-types";
import { authorizeClientPublish, commandTopicCount, refreshCommandTopics } from "./acl.js";
import {
  authenticateClient,
  clientAuth,
  configureAuth,
  isDiscoveryTopic,
  REFUSED,
  setDiscoveryOpen,
  type AuthConfig,
  type ClientAuth,
} from "./auth.js";
import { chooseBindHost, loadAuthConfig, loadBindSetting, type BindChoice } from "./settings.js";

export const MQTT_PORT = Number(process.env["MQTT_PORT"] ?? 1883);

let _broker: Aedes | null = null;
let _server: Server | null = null;
let _listening = false;
let _bind: BindChoice = { host: "0.0.0.0" };
/** Clients connected now. aedes keeps its own registry, but does not type it. */
const _clients = new Set<Client>();

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
 *
 * This path does not run `authorizePublish` either, which is what lets the ACL
 * in `acl.ts` refuse command topics outright without excepting the controller.
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

/** `auth` is how the publishing client connected: with the broker credential or without. */
type MessageHandler = (topic: string, payload: Buffer, packet: AedesPublishPacket, auth: MqttAuth) => void;
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

  // Who may connect (auth.ts), loaded before the first one can.
  configureAuth(await loadAuthConfig());
  _broker.authenticate = authenticateClient;

  // Command topics are controller-only. Installed before the server accepts a
  // connection, so there is no window in which a client can drive a device.
  _broker.authorizePublish = authorizeClientPublish;

  _broker.on("publish", (packet: AedesPublishPacket, client: Client | null) => {
    if (!client) return;
    const state = clientAuth(client);
    // Let in only to announce itself: anything else it publishes is not read.
    if (state && !state.provisioned && !isDiscoveryTopic(packet.topic)) return;
    for (const handler of messageHandlers) {
      handler(packet.topic, packet.payload as Buffer, packet, state?.auth ?? "anonymous");
    }
  });

  _broker.on("client", (client: Client) => {
    _clients.add(client);
    const state = clientAuth(client);
    const how = !state ? "" : !state.provisioned ? " (no credential, scan open: discovery only)" : state.auth === "anonymous" ? " (no credential)" : "";
    console.log(`[broker] connected: ${client.id}${how}`);
  });

  _broker.on("clientDisconnect", (client: Client) => {
    _clients.delete(client);
    console.log(`[broker] disconnected: ${client.id}`);
  });

  _broker.on("clientError", (client: Client, err: Error) => {
    // A refusal is logged once an hour by auth.ts; a device retrying every few
    // seconds would otherwise fill the log.
    if (err.message === REFUSED) return;
    console.error(`[broker] client error (${client.id}):`, err.message);
  });

  // Devices paired in an earlier run must be protected from the first packet,
  // not from whenever the device manager finishes starting.
  await refreshCommandTopics();

  await listen(chooseBindHost(await loadBindSetting()));
}

function listen(bind: BindChoice): Promise<void> {
  const broker = getBroker();
  const server = createServer(broker.handle.bind(broker));
  _server = server;
  _bind = bind;
  if (bind.unavailable) {
    console.warn(`[broker] ${bind.unavailable} is not an address on this machine; listening on every interface instead`);
  }

  return new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.on("close", () => { _listening = false; });
    server.listen(MQTT_PORT, bind.host, () => {
      _listening = true;
      console.log(
        `[broker] MQTT listening on ${bind.host}:${MQTT_PORT} — ` +
          `${commandTopicCount()} command topic(s) closed to clients`,
      );
      resolve();
    });
  });
}

/** Where the broker listens now, and what it fell back from. */
export function brokerBind(): BindChoice {
  return _bind;
}

/**
 * Listen somewhere else, after the setting changed. Every client is
 * disconnected: one on an interface the broker no longer listens on would
 * otherwise stay connected until it next dropped. Devices reconnect within
 * seconds.
 */
export async function rebindBroker(bind: BindChoice): Promise<void> {
  const server = _server;
  if (server) {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    closeClients(() => true);
    await closed;
  }
  await listen(bind);
}

/** Disconnect every client the predicate picks. They are free to reconnect, and are judged again. */
function closeClients(pick: (state: ClientAuth | undefined) => boolean): number {
  let closed = 0;
  for (const client of [..._clients]) {
    if (pick(clientAuth(client))) {
      client.close();
      closed++;
    }
  }
  return closed;
}

/**
 * Open or close the window in which a device without the credential may
 * connect to announce itself (scan-session.ts). Closing it drops whatever
 * came in that way.
 */
export function setDiscoveryWindow(open: boolean): void {
  setDiscoveryOpen(open);
  if (open) return;
  const dropped = closeClients((state) => state?.provisioned === false);
  if (dropped > 0) console.log(`[broker] scan closed: disconnected ${dropped} client(s) without the credential`);
}

/**
 * Apply changed settings to the clients already connected, judging each
 * again: switching enforcement on drops those without the credential, and a
 * new password (`credentialChanged`) drops those that connected with the old
 * one.
 */
export function applyAuthConfig(next: AuthConfig, credentialChanged = false): void {
  configureAuth(next);
  closeClients((state) =>
    (credentialChanged && state?.auth === "credential") ||
    (next.requireCredentials && state?.auth === "anonymous" && state.provisioned),
  );
}

/**
 * Stop accepting connections and disconnect every client. Devices reconnect
 * on their own when the controller comes back, and anything they publish in
 * between is lost rather than half-ingested.
 */
export async function stopBroker(): Promise<void> {
  const server = _server;
  const broker = _broker;
  _server = null;
  // The server's close callback waits for every open connection to end, and
  // those only end when aedes closes its clients. So: stop accepting, close
  // the clients, and only then wait for the server.
  const closed = server ? new Promise<void>((resolve) => server.close(() => resolve())) : Promise.resolve();
  if (broker) await new Promise<void>((resolve) => broker.close(() => resolve()));
  await closed;
}
