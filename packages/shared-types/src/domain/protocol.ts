/**
 * How Canopy reaches a device. We deliberately support only two transports in
 * v1: local HTTP (REST/RPC) and MQTT (via the embedded broker). Everything
 * else is out of scope on purpose.
 */
export type TransportProtocol = "http" | "mqtt";

/**
 * The adapter family that knows how to interpret a given device's payloads.
 * Two transports does NOT mean two integrations — each family needs its own
 * small adapter. "generic-mqtt" is the fallback for devices that publish a
 * Home-Assistant-style discovery config without a more specific adapter.
 */
export type DeviceFamily =
  | "shelly"
  | "tasmota"
  | "esphome"
  | "generic-mqtt"
  | "unknown";

/** How a device first came to Canopy's attention. */
export type DiscoverySource =
  | "mdns" // advertised itself over multicast DNS
  | "mqtt-discovery" // published a retained HA-style discovery config
  | "ip-probe" // found by the opt-in subnet sweep (advanced scan)
  | "manual"; // entered by hand
