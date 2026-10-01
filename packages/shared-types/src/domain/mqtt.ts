import type { Id } from "./common.js";

/**
 * How a client connected to the embedded MQTT broker: with a device's own
 * credential (Phase 8 G), with the shared one every device may use, or
 * without one. A device with a wrong username or password (Tasmota ships with
 * DVES_USER / DVES_PASS) counts as without one.
 */
export type MqttAuth = "device" | "shared" | "anonymous";

/** A network address on the controller's machine. */
export interface MqttInterface {
  name: string;
  address: string;
  family: "IPv4" | "IPv6";
}

/**
 * The broker as Settings shows it: the credential devices connect with, the
 * rules for connecting without one, and where it listens.
 *
 * MQTT credentials cross the LAN in clear text. That is decided for v1: TLS
 * comes after per-device credentials (ROADMAP Phase 8 F).
 */
export interface MqttBrokerSettings {
  /** The credential every device is given (Tier 2: one, shared). */
  username: string;
  password: string;
  /**
   * On: a device without the credential connects only while a scan is open,
   * and then only to announce itself. Off: anything on the network connects.
   */
  requireCredentials: boolean;
  port: number;
  bind: {
    /** The address the broker listens on now. 0.0.0.0 is every interface. */
    host: string;
    /** What Settings asked for; null is every interface. */
    setting: string | null;
    /** MQTT_HOST, which overrides the setting when set. */
    envOverride: string | null;
    /** Set when the address asked for is not on this machine, so the broker fell back to every interface. */
    unavailable?: string;
  };
  /** Where devices can reach the broker, for typing into their MQTT settings. */
  interfaces: MqttInterface[];
  /** Devices whose last connection had no credential: what stops enforcement being switched on. */
  devicesWithoutCredential: { id: Id; name: string; workspaceId: Id }[];
  /** Devices whose last connection used the shared credential rather than their own. */
  devicesOnShared: { id: Id; name: string; workspaceId: Id }[];
}

/**
 * Sending a Shelly its credential over its HTTP API, so it needs no typing.
 * Kept in memory: it describes the last attempt since the controller started.
 */
export interface MqttCredentialPush {
  state: "sending" | "sent" | "failed";
  at: string;
  /** Why it failed, in words for the device card. */
  error?: string;
}

/**
 * One device's own broker credential (Phase 8 G). It may publish only that
 * device's topics; anything else it sends is ignored.
 */
export interface DeviceMqttCredential {
  username: string;
  password: string;
  /** Where the device reaches the broker: the address on its own network when one is known. */
  brokerHost?: string;
  port: number;
  /** Shelly only: whether the credential can be sent to it over HTTP. */
  canPush: boolean;
  push?: MqttCredentialPush;
}

export interface MqttBrokerPatch {
  requireCredentials?: boolean;
  /** An address on this machine, or null for every interface. */
  bindHost?: string | null;
}
