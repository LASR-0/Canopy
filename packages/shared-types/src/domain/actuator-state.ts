import type { Id, Timestamp } from "./common.js";

/**
 * What an actuator channel last reported on its state topic.
 *
 * The device's own word, not what Canopy last sent it: a command is published
 * at QoS 0 and the device may be unplugged, so only its echo says what it did.
 * Held in memory by the controller. A restart of the controller restarts the
 * embedded broker, so every device reconnects and reports again.
 */
export interface ActuatorState {
  workspaceId: Id;
  deviceId: Id;
  channel: string;
  on: boolean;
  /** 0–100, for a variable actuator whose state carries a level. */
  level?: number;
  /**
   * When it changed to this state, as far as this controller has seen: the
   * first report after a controller restart counts as a change.
   */
  since: Timestamp;
}
