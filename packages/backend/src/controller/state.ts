/**
 * Controller lifecycle state.
 *
 * Three states, and the distinction between them is operational, not cosmetic:
 *
 *  - `running`  — monitoring and acting.
 *  - `paused`   — still monitoring, but nothing may drive hardware. This is the
 *                 state to use while working in the tent: readings keep
 *                 accumulating, and no automation turns a fan on behind you.
 *  - `stopped`  — deliberately idle. Neither ingesting nor acting. Distinct
 *                 from "the window is closed", which stops nothing.
 *
 * Held in memory only. A restarted controller comes back `running`, because a
 * grow controller that silently stays stopped across a reboot is the more
 * dangerous default — a missed irrigation cycle harms plants, and a user who
 * stopped it deliberately is present to stop it again. Persisting this is a
 * decision worth revisiting when the service is installed at boot in Phase 8.
 */
import type { ControllerState } from "@canopy/shared-types";

let state: ControllerState = "running";

export function getControllerState(): ControllerState {
  return state;
}

/** True when the controller may drive hardware. False while paused or stopped. */
export function canActuate(): boolean {
  return state === "running";
}

/** True when telemetry should still be recorded. Pausing keeps monitoring. */
export function canIngest(): boolean {
  return state !== "stopped";
}

/**
 * Apply a lifecycle transition. Returns the resulting state.
 *
 * Every transition is allowed from every state: resuming an already-running
 * controller is a harmless no-op, and refusing it would make the UI's buttons
 * order-dependent for no benefit.
 */
export function setControllerState(next: ControllerState): ControllerState {
  if (next === state) return state;

  const previous = state;
  state = next;
  console.log(`[controller] ${previous} -> ${next}`);
  return state;
}

/** Reset to the default. Tests only. */
export function resetControllerState(): void {
  state = "running";
}
