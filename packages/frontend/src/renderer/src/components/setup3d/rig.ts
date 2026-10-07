/** The camera: its yaw, angle, zoom and pan, shared by the view's controls, the camera rig, the lights and the walls. */
import * as THREE from "three";

/** True isometric: the camera looks down the diagonal of a cube. */
export const ELEVATION = Math.atan(1 / Math.SQRT2);
/** Eye level: looking almost straight in, a little from above so the floor still shows. */
export const EYE_LEVEL = 0.1;
/** How far in and out the zoom goes, as a multiple of the fit that shows the whole tent. */
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 6;

/** Shared between the controls outside the canvas and everything inside it that follows the camera. */
export interface YawState {
  current: number;
  target: number;
  /**
   * A timed full turn. Timed by the wall clock, not the frame delta: with
   * frames on demand, the first frame's delta is however long the view sat idle.
   */
  spin: { start: number; t0: number | null; last: number; frames: number; worstMs: number } | null;
  /** The camera's angle above the horizon: `ELEVATION` or `EYE_LEVEL`. */
  elevation: number;
  elevationTarget: number;
  /** Zoom as a multiple of the fit; 1 shows the whole tent. */
  zoom: number;
  zoomTarget: number;
  /** How far the view is moved off the tent's centre, in cm across and up the screen. */
  pan: [number, number];
  panTarget: [number, number];
  /** Pixels per cm at zoom 1, for the controls to turn pointer moves into cm. */
  fitPx: number;
}

/** Direction from the tent's centre toward a viewer at this yaw and elevation. */
export function cameraDir(yaw: number, elevation = ELEVATION): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(yaw),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(yaw),
  );
}
