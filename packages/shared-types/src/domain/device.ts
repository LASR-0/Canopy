import type { TransportProtocol, DeviceFamily, DiscoverySource } from "./protocol.js";
import type { Capability } from "./capability.js";
import type { Id } from "./common.js";

/** Where a device lives on the network. */
export interface DeviceAddress {
  protocol: TransportProtocol;
  host?: string;
  port?: number;
  mqttTopicPrefix?: string;
}

/** A paired device — scoped to one workspace. */
export interface Device {
  id: Id;
  workspaceId: Id;
  name: string;
  family: DeviceFamily;
  address: DeviceAddress;
  model?: string;
  firmware?: string;
  /** Detected at pairing; what this device can measure/control. */
  capabilities: Capability[];
  discoveredVia: DiscoverySource;
  online: boolean;
  lastSeen?: string;
  /** Raw Wi-Fi signal strength 0–100 %. Display layer converts to bars. */
  signalPct?: number;
  /** Cumulative runtime hours — used by runtime-cadence maintenance tasks. */
  runtimeHours: number;
  /**
   * When set, an imported copy of hardware that belongs to a device in another
   * workspace: kept for history, but not read from or driven.
   */
  detachedAt?: string;
}

/**
 * Functional role a device fulfils within a workspace. Automations target
 * roles, not device IDs, so hardware can be swapped without breaking rules.
 */
export type RoleKind =
  // Sensing
  | "canopy_temp"
  | "canopy_rh"
  | "canopy_light"
  | "rootzone"
  | "co2_probe"
  | "res_temp"
  | "res_ph"
  | "res_ec"
  | "power_draw"
  // Equipment
  | "exhaust"
  | "intake"
  | "circ"
  | "light"
  | "pump"
  | "humidifier"
  | "dehumidifier"
  | "co2_valve"
  | "heater";

/** Binds a device capability channel to a role within a workspace. */
export interface RoleAssignment {
  id: Id;
  workspaceId: Id;
  role: RoleKind;
  deviceId: Id;
  channel: string;
}
