/** The camera's yaw, shared by the view's controls, the camera rig, the lights and the walls. */
import * as THREE from "three";

/** True isometric: the camera looks down the diagonal of a cube. */
export const ELEVATION = Math.atan(1 / Math.SQRT2);

/** Shared between the controls outside the canvas and everything inside it that follows the camera. */
export interface YawState {
  current: number;
  target: number;
  /**
   * A timed full turn. Timed by the wall clock, not the frame delta: with
   * frames on demand, the first frame's delta is however long the view sat idle.
   */
  spin: { start: number; t0: number | null; last: number; frames: number; worstMs: number } | null;
}

/** Direction from the tent's centre toward a viewer at this yaw and elevation. */
export function cameraDir(yaw: number, elevation = ELEVATION): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(yaw),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(yaw),
  );
}
