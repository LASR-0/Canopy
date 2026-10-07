/**
 * Setup View → 3D: an isometric render of the tent. It renders the floor plan
 * and never edits it; placement stays in Layout.
 *
 * Loaded lazily (React.lazy in SetupView), so three.js stays out of the main
 * bundle until someone opens the view.
 *
 * Dev builds add a diagnostics bar: which WebGL renderer Chromium got
 * (hardware, or a software fallback such as llvmpipe) and the frame rate of a
 * timed full turn. It settled the Phase 9 spike, and is the first thing to
 * look at when the view is slow or blank on a new machine.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, invalidate, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { DevicePlacement, EnclosureDimensions, Plant, RoleKind } from "@canopy/shared-types";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/theme/ThemeProvider";
import { ROLE_COLOR, ROLE_META, UNASSIGNED_COLOR } from "@/lib/roles";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { calcGrowStage } from "@/lib/growStage";
import { Baked } from "./bake";
import { Ducts, type DuctRoute } from "./ducts";
import { Equipment } from "./equipment";
import { MODEL_SPECS, footprintOf, ledPanelSize, modelFor, type ModelKind } from "./models";
import { PALETTE, type Palette } from "./palette";
import { PlantInPot, type Growth } from "./plants";
import { ELEVATION, EYE_LEVEL, ZOOM_MAX, ZOOM_MIN, cameraDir, type YawState } from "./rig";
import { Lights, RAIL_DROP_CM, Tent, ductPorts } from "./tent";

export interface PlacedDevice {
  placement: DevicePlacement;
  name: string;
  role: RoleKind | undefined;
  status: DeviceStatus;
}

/** Something in the tent that can be opened in Layout. */
export interface TentItem { kind: "device" | "plant"; id: string }

export interface TentViewProps {
  dims: EnclosureDimensions;
  devices: PlacedDevice[];
  plants: Plant[];
  /** Clicking a device or plant: Setup View selects it in Layout. */
  onOpen?: (item: TentItem) => void;
}

/**
 * Hover and click on things in the tent. The tooltip is a DOM element updated
 * directly, not React state: a re-render per pointer move would rebuild the
 * scene's children and redraw the overhead shadow on every move.
 */
interface Pointing {
  show: (e: ThreeEvent<PointerEvent>, title: string, detail: string) => void;
  hide: () => void;
  open: (e: ThreeEvent<MouseEvent>, item: TentItem) => void;
}

const STEP = Math.PI / 4;

/**
 * The view's two toggles are the viewer's preference, kept between visits:
 * the roof open, and the cutaway (walls facing the camera open) or, with it
 * off, the tent closed but for its door.
 */
const ROOF_KEY = "canopy.setup3d.roof";
const EYE_KEY = "canopy.setup3d.eye";
const CUTAWAY_KEY = "canopy.setup3d.cutaway";
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "on" || v === "open";
  } catch { return fallback; }
}
function writeFlag(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? "on" : "off"); } catch { /* private window: not remembered */ }
}
const SPIN_SECONDS = 3;

const FACES = ["Front", "Front-right", "Right", "Back-right", "Back", "Back-left", "Left", "Front-left"];

/** Draw calls and triangles are the last frame's, shadow passes included. */
export interface SpinResult { fps: number; worstMs: number; calls: number; triangles: number }

interface GlInfo { version: string; renderer: string; software: boolean }

/** Plan coordinates (cm from the back-left corner, z up) to scene coordinates (y up, centred). */
function toScene(dims: EnclosureDimensions, xCm: number, yCm: number, zCm: number): [number, number, number] {
  return [xCm - dims.widthCm / 2, zCm, yCm - dims.depthCm / 2];
}

/**
 * Pixels per centimetre that fit the tent at every yaw, so turning it never
 * changes its size on screen.
 */
function fitZoom(dims: EnclosureDimensions, width: number, height: number, elevation: number): number {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const up = new THREE.Vector3(0, 1, 0);
  let maxX = 0;
  let maxY = 0;
  for (let deg = 0; deg < 360; deg += 5) {
    const c = cameraDir((deg * Math.PI) / 180, elevation);
    const right = new THREE.Vector3().crossVectors(up, c).normalize();
    const camUp = new THREE.Vector3().crossVectors(c, right);
    for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) {
      const p = new THREE.Vector3(x, y, z);
      maxX = Math.max(maxX, Math.abs(p.dot(right)));
      maxY = Math.max(maxY, Math.abs(p.dot(camUp)));
    }
  }
  return 0.86 * Math.min(width / (2 * maxX), height / (2 * maxY));
}

// ── Camera ────────────────────────────────────────────────────────────────────

function Rig({ dims, yaw, onSpinDone }: { dims: EnclosureDimensions; yaw: React.RefObject<YawState>; onSpinDone: (r: SpinResult) => void }) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const centre = useMemo(() => new THREE.Vector3(0, dims.heightCm / 2, 0), [dims.heightCm]);
  // The fit at each angle, so the zoom eases between them as the angle changes.
  const fits = useMemo(() => ({
    iso: fitZoom(dims, size.width, size.height, ELEVATION),
    eye: fitZoom(dims, size.width, size.height, EYE_LEVEL),
  }), [dims, size.width, size.height]);

  useEffect(() => invalidate(), [fits]);

  useFrame((state, delta) => {
    const y = yaw.current;
    // Capped, or the first frame after a pause would finish a move at once.
    const ease = Math.min(1, Math.min(delta, 1 / 30) * 12);
    let moving = false;
    const approach = (current: number, target: number, eps: number) => {
      if (Math.abs(target - current) <= eps) return target;
      moving = true;
      return current + (target - current) * ease;
    };
    if (y.spin) {
      const s = y.spin;
      const now = performance.now();
      if (s.t0 === null) {
        s.t0 = now;
      } else {
        s.worstMs = Math.max(s.worstMs, now - s.last);
        s.frames += 1;
      }
      s.last = now;
      const elapsed = (now - s.t0) / 1000;
      y.current = y.target = s.start + (2 * Math.PI * Math.min(elapsed, SPIN_SECONDS)) / SPIN_SECONDS;
      if (elapsed >= SPIN_SECONDS) {
        y.spin = null;
        y.current = y.target = s.start;
        const { calls, triangles } = state.gl.info.render;
        onSpinDone({ fps: s.frames / elapsed, worstMs: s.worstMs, calls, triangles });
      }
      moving = true;
    } else {
      y.current = approach(y.current, y.target, 1e-4);
    }
    y.elevation = approach(y.elevation, y.elevationTarget, 1e-4);
    y.zoom = approach(y.zoom, y.zoomTarget, 1e-4);
    y.pan = [approach(y.pan[0], y.panTarget[0], 0.05), approach(y.pan[1], y.panTarget[1], 0.05)];
    if (moving) state.invalidate();

    // Between the two angles' fits, by how far the angle has moved from one to the other.
    const t = (y.elevation - ELEVATION) / (EYE_LEVEL - ELEVATION);
    y.fitPx = fits.iso + (fits.eye - fits.iso) * Math.min(1, Math.max(0, t));
    const zoom = y.fitPx * y.zoom;
    if (Math.abs(camera.zoom - zoom) > 1e-6) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    const dir = cameraDir(y.current, y.elevation);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right);
    const look = centre.clone().addScaledVector(right, y.pan[0]).addScaledVector(up, y.pan[1]);
    camera.position.copy(dir.multiplyScalar(2000).add(look));
    camera.lookAt(look);
  });
  return null;
}

// ── Contents ──────────────────────────────────────────────────────────────────

/** Devices stand this far inside the walls' inner face at the closest. */
const WALL_CLEAR_CM = 1.8;
/** In the air within this of a wall, a sensor or controller is mounted on it. */
const WALL_MOUNT_CM = 15;
/** Models that can hang on a wall; the rest keep their cords or stand. */
const WALL_MOUNTABLE: ReadonlySet<ModelKind> = new Set(["sensor", "co2_sensor", "block"]);

/** Where and how a device is drawn: its model, how it is held, base, position and turn. */
interface Pose {
  kind: ModelKind;
  mount: "hung" | "standing" | "wall";
  x: number;
  z: number;
  baseY: number;
  rotationY: number;
  roofY: number;
}

/** Everything the scene draws devices from, worked out once per render. */
interface DevicePlan {
  poses: Map<string, Pose>;
  ducts: DuctRoute[];
  /** Duct ports a duct goes through. */
  connected: Set<string>;
}

/**
 * A device's pose in the scene. The mounting height is the model's base, held
 * inside the tent. Placed hard against a wall, the model is moved in until its
 * footprint, turned as placed, stands against the wall rather than through
 * it; Layout's pin is a point, the model is not. A sensor or controller up in
 * the air near a wall is mounted on it instead: its back to the wall, facing
 * into the tent, on a bracket rather than a cord. `turn` overrides the placed
 * rotation (an inline fan facing its duct port).
 */
function poseOf(dims: EnclosureDimensions, device: PlacedDevice, turn?: number): Pose {
  const { placement, role } = device;
  const kind = modelFor(role);
  const baseY = Math.min(Math.max(placement.zCm, 0), Math.max(0, dims.heightCm - MODEL_SPECS[kind].heightCm));
  // 0° faces the door (+z), clockwise seen from above; three.js turns counter-clockwise.
  let rotationY = turn ?? (-placement.rotationDeg * Math.PI) / 180;
  let mount: Pose["mount"] = MODEL_SPECS[kind].mount;
  const [fw, fd] = footprintOf(kind, dims);
  const halfW = dims.widthCm / 2;
  const halfD = dims.depthCm / 2;
  const [px, , pz] = toScene(dims, placement.xCm, placement.yCm, 0);

  // The wall nearest the pin, and the way into the tent from it.
  let wall: { gap: number; into: [number, number] } | undefined;
  if (WALL_MOUNTABLE.has(kind) && baseY > 3) {
    const walls = [
      { gap: halfW - px, into: [-1, 0] as [number, number] },
      { gap: px + halfW, into: [1, 0] as [number, number] },
      { gap: halfD - pz, into: [0, -1] as [number, number] },
      { gap: pz + halfD, into: [0, 1] as [number, number] },
    ].sort((a, b) => a.gap - b.gap);
    if (walls[0]!.gap <= WALL_MOUNT_CM + fd / 2) wall = walls[0];
  }
  if (wall) {
    mount = "wall";
    rotationY = Math.atan2(wall.into[0], wall.into[1]);
  }

  const c = Math.abs(Math.cos(rotationY));
  const sn = Math.abs(Math.sin(rotationY));
  const hx = (c * fw + sn * fd) / 2;
  const hz = (sn * fw + c * fd) / 2;
  const hold = (v: number, half: number, extent: number) => {
    const limit = half - WALL_CLEAR_CM - extent;
    return limit <= 0 ? 0 : Math.min(limit, Math.max(-limit, v));
  };
  let x = hold(px, halfW, hx);
  let z = hold(pz, halfD, hz);
  // Wall-mounted: flush against the wall, whatever the gap was.
  if (wall) {
    if (wall.into[0] !== 0) x = -wall.into[0] * (halfW - WALL_CLEAR_CM - hx);
    else z = -wall.into[1] * (halfD - WALL_CLEAR_CM - hz);
  }
  return { kind, mount, x, z, baseY, rotationY, roofY: dims.heightCm - RAIL_DROP_CM - baseY };
}

/** The inline fan's collar ends this far from its centre, and its axis is this high above its base. */
const FAN_COLLAR_CM = 14;
const FAN_AXIS_CM = 12.5;
/** A duct hole's radius with its collar, kept clear of other holes and the tent's edges. */
const HOLE_CLEAR_CM = 11;

/**
 * Poses for every device, and the inline fans' ducts. Fans get the tent's duct
 * ports (ducts.tsx): exhausts first, then intakes, each to the nearest port
 * still free, roof or wall; a fan with a port is turned to face it. Exhaust ducts leave from the fan's face,
 * intakes' from its back. A fan without a port keeps its placed turn and
 * ducts straight out through the wall it points at.
 */
function planDevices(dims: EnclosureDimensions, devices: PlacedDevice[]): DevicePlan {
  const poses = new Map<string, Pose>();
  const ducts: DuctRoute[] = [];
  const connected = new Set<string>();
  for (const d of devices) poses.set(d.placement.deviceId, poseOf(dims, d));

  const free = ductPorts(dims);
  const fans = devices
    .filter((d) => modelFor(d.role) === "inline_fan")
    .sort((a, b) => Number(a.role === "intake") - Number(b.role === "intake") || a.placement.deviceId.localeCompare(b.placement.deviceId));
  for (const fan of fans) {
    const id = fan.placement.deviceId;
    const side = fan.role === "intake" ? -1 : 1;
    let pose = poses.get(id)!;
    const centre = (p: Pose) => new THREE.Vector3(p.x, p.baseY + FAN_AXIS_CM, p.z);
    // The nearest free port, roof or wall.
    let pick = -1;
    if (free.length) {
      const c = centre(pose);
      pick = free
        .map((pt, i) => ({ i, d: c.distanceTo(new THREE.Vector3(...pt.world)) }))
        .sort((a, b) => a.d - b.d)[0]!.i;
    }
    if (pick >= 0) {
      const port = free.splice(pick, 1)[0]!;
      connected.add(port.key);
      const c = centre(pose);
      const dx = port.world[0] - c.x;
      const dz = port.world[2] - c.z;
      // Face the port across the floor plan; a port straight overhead leaves the turn as placed.
      if (Math.hypot(dx, dz) > 5) {
        pose = poseOf(dims, fan, Math.atan2(side * dx, side * dz));
        poses.set(id, pose);
      }
      const dir = new THREE.Vector3(Math.sin(pose.rotationY) * side, 0, Math.cos(pose.rotationY) * side);
      const start = centre(pose).addScaledVector(dir, FAN_COLLAR_CM);
      ducts.push({ start: start.toArray(), dir: dir.toArray(), end: port.world, normal: port.normal, port: port.key });
    } else {
      const c = centre(pose);
      const dir = new THREE.Vector3(Math.sin(pose.rotationY) * side, 0, Math.cos(pose.rotationY) * side);
      const hit = (pos: number, d: number, half: number) =>
        d > 1e-6 ? (half - pos) / d : d < -1e-6 ? (-half - pos) / d : Infinity;
      const tx = hit(c.x, dir.x, dims.widthCm / 2);
      const tz = hit(c.z, dir.z, dims.depthCm / 2);
      const start = c.clone().addScaledVector(dir, FAN_COLLAR_CM);
      const end = c.clone().addScaledVector(dir, Math.max(FAN_COLLAR_CM + 1, Math.min(tx, tz)));
      // Out through the wall it meets, square to it, and clear of every port and hole already there.
      const normal = tx < tz ? new THREE.Vector3(Math.sign(dir.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dir.z));
      const along = new THREE.Vector3(normal.z, 0, -normal.x);
      const half = (normal.x !== 0 ? dims.depthCm : dims.widthCm) / 2 - HOLE_CLEAR_CM;
      const taken = [...ductPorts(dims).map((pt) => new THREE.Vector3(...pt.world)), ...ducts.map((r) => new THREE.Vector3(...r.end))];
      for (let tries = 0; tries < 8 && taken.some((t) => t.distanceTo(end) < 2 * HOLE_CLEAR_CM); tries++) {
        const away = taken.find((t) => t.distanceTo(end) < 2 * HOLE_CLEAR_CM)!;
        const sideways = Math.sign(along.dot(end.clone().sub(away))) || 1;
        end.addScaledVector(along, sideways * 2 * HOLE_CLEAR_CM);
        const offset = Math.max(-half, Math.min(half, along.dot(end)));
        end.addScaledVector(along, offset - along.dot(end));
      }
      ducts.push({ start: start.toArray(), dir: dir.toArray(), end: end.toArray(), normal: normal.toArray(), port: undefined });
    }
  }
  return { poses, ducts, connected };
}

/** What is shown about a device's state: on, off, offline, or not reported yet. */
export type DeviceStatus = "on" | "off" | "offline" | "unknown";

const STATUS_LABEL: Record<DeviceStatus, string> = { on: "On", off: "Off", offline: "Offline", unknown: "No state yet" };

/** A device, drawn by its role's model, in its planned pose. */
function DeviceMesh({ dims, device, pose, palette, pointing }: {
  dims: EnclosureDimensions; device: PlacedDevice; pose: Pose; palette: Palette; pointing: Pointing;
}) {
  const { placement, role, name, status } = device;
  return (
    <group
      position={[pose.x, pose.baseY, pose.z]}
      rotation={[0, pose.rotationY, 0]}
      onPointerMove={(e) => pointing.show(e, name, `${role ? ROLE_META[role].name : "No role"} · ${STATUS_LABEL[status]}`)}
      onPointerOut={pointing.hide}
      onClick={(e) => pointing.open(e, { kind: "device", id: placement.deviceId })}
    >
      <Equipment
        kind={pose.kind}
        p={palette}
        dims={dims}
        roofY={pose.roofY}
        mount={pose.mount}
        accent={role ? ROLE_COLOR[role] : UNASSIGNED_COLOR}
        on={status !== "off"}
      />
    </group>
  );
}

const STATUS_COLOR: Record<DeviceStatus, string> = { on: "#3fb950", off: "#f85149", offline: "#8b949e", unknown: "#8b949e" };

/** A round status light: a coloured disc with a white rim and a soft halo, drawn once per colour. */
function statusTexture(color: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const halo = ctx.createRadialGradient(c, c, size * 0.2, c, c, size * 0.5);
  halo.addColorStop(0, `${color}88`);
  halo.addColorStop(1, `${color}00`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(c, c, size * 0.27, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, size * 0.21, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A status light over each device: green while it is on (a sensor that is
 * online counts), red while it is off, grey when the device is offline or has
 * not reported a state yet. The same size on screen at any zoom.
 */
function StatusDots({ dims, devices, plan }: { dims: EnclosureDimensions; devices: PlacedDevice[]; plan: DevicePlan }) {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const materials = useMemo(() => {
    const out = {} as Record<DeviceStatus, THREE.SpriteMaterial>;
    for (const status of Object.keys(STATUS_COLOR) as DeviceStatus[]) {
      out[status] = new THREE.SpriteMaterial({ map: statusTexture(STATUS_COLOR[status]), depthWrite: false, toneMapped: false });
    }
    return out;
  }, []);
  useEffect(() => () => Object.values(materials).forEach((m) => { m.map?.dispose(); m.dispose(); }), [materials]);
  useFrame(() => {
    const scale = 22 / camera.zoom;
    group.current?.children.forEach((o) => o.scale.set(scale, scale, 1));
  });
  return (
    <group ref={group}>
      {devices.map((d) => {
        const pose = plan.poses.get(d.placement.deviceId)!;
        const lift = pose.kind === "led_light" ? 18 : 5;
        const y = Math.min(dims.heightCm - 4, pose.baseY + MODEL_SPECS[pose.kind].heightCm + lift);
        return <sprite key={d.placement.deviceId} position={[pose.x, y, pose.z]} material={materials[d.status]} renderOrder={2} />;
      })}
    </group>
  );
}

/** A soft round pool of warm light, white in the middle and gone at the edge. */
function poolTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The light of each grow light that is on, falling: a faint warm beam from its
 * face, widening toward the floor, and the pool it makes there. Added on top
 * of the scene, so it brightens what it passes through and darkens nothing.
 */
function LightBeams({ dims, devices, plan, palette }: { dims: EnclosureDimensions; devices: PlacedDevice[]; plan: DevicePlan; palette: Palette }) {
  const lights = devices.filter((d) => d.role === "light" && d.status !== "off");
  const { widthCm: pw, depthCm: pd } = ledPanelSize(dims);
  const pool = useMemo(poolTexture, []);
  useEffect(() => () => pool.dispose(), [pool]);
  return (
    <>
      {lights.map((d) => {
        const pose = plan.poses.get(d.placement.deviceId)!;
        return (
          <group key={d.placement.deviceId} position={[pose.x, 0, pose.z]} rotation={[0, pose.rotationY, 0]}>
            <Beam top={pose.baseY} width={pw - 2} depth={pd - 2} dims={dims} color={palette.led} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]} renderOrder={1}>
              <planeGeometry args={[pw * 1.7, pd * 2.2]} />
              <meshBasicMaterial map={pool} color={palette.led} transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** One light's beam: the four sides of a frustum from the panel's face to the floor, fading as it falls. */
function Beam({ top, width, depth, dims, color }: { top: number; width: number; depth: number; dims: EnclosureDimensions; color: string }) {
  const geometry = useMemo(() => {
    const spread = 1 + Math.min(0.7, top / 150);
    const bw = Math.min(width * spread, dims.widthCm - 6) / 2;
    const bd = Math.min(depth * spread, dims.depthCm - 6) / 2;
    const tw = width / 2;
    const td = depth / 2;
    // Faint: both faces of the beam add, and it adds over everything inside it.
    const c = new THREE.Color(color).multiplyScalar(0.035);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
    const position: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]!;
      const [bx, bz] = corners[(i + 1) % 4]!;
      const quad = [
        [ax * tw, top, az * td, 1], [bx * tw, top, bz * td, 1], [bx * bw, 0.5, bz * bd, 0],
        [ax * tw, top, az * td, 1], [bx * bw, 0.5, bz * bd, 0], [ax * bw, 0.5, az * bd, 0],
      ];
      for (const [x, y, z, lit] of quad) {
        position.push(x!, y!, z!);
        colors.push(c.r * lit!, c.g * lit!, c.b * lit!);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [top, width, depth, dims.widthCm, dims.depthCm, color]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshBasicMaterial vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

/**
 * Without a WebGL context the renderer throws while the canvas mounts, and
 * with nothing to catch it React unmounts the whole app. This keeps the
 * failure inside the view.
 */
class WebGlBoundary extends Component<{ children: ReactNode; onError: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="tent-3d-fallback">
        <span>
          The 3D view needs WebGL, which this machine is not providing.
          <br />
          <span className="tent-3d-error">{this.state.error.message}</span>
        </span>
      </div>
    );
  }
}

function readGlInfo(gl: THREE.WebGLRenderer): GlInfo {
  const ctx = gl.getContext();
  const ext = ctx.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER));
  return {
    version: typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext ? "WebGL 2" : "WebGL 1",
    renderer,
    software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer),
  };
}

export default function TentView({ dims, devices, plants, onOpen }: TentViewProps) {
  const palette = PALETTE;
  // Only the ground's grid follows the theme, as the background behind it does.
  const { resolved } = useTheme();
  const { data: grow } = useActiveGrow();
  const stageInfo = grow ? calcGrowStage(grow) : undefined;
  const growth: Growth = { stage: stageInfo?.stage, pct: stageInfo?.pctInStage ?? 0.5 };
  const [eyeLevel, setEyeLevel] = useState(() => readFlag(EYE_KEY, false));
  const yaw = useRef<YawState>({
    current: STEP, target: STEP, spin: null,
    elevation: eyeLevel ? EYE_LEVEL : ELEVATION, elevationTarget: eyeLevel ? EYE_LEVEL : ELEVATION,
    zoom: 1, zoomTarget: 1, pan: [0, 0], panTarget: [0, 0], fitPx: 1,
  });
  const toggleEyeLevel = () => {
    setEyeLevel((on) => {
      writeFlag(EYE_KEY, !on);
      yaw.current.elevationTarget = on ? ELEVATION : EYE_LEVEL;
      return !on;
    });
    invalidate();
  };
  // Zoom, held between the limits, and pan, held so the tent cannot be lost
  // off the edge: at the fit there is nothing to pan to.
  const panLimit = (zoom: number) => (Math.max(dims.widthCm, dims.depthCm, dims.heightCm) / 2) * (1 - 1 / zoom);
  const setPan = (x: number, y: number, zoom = yaw.current.zoomTarget) => {
    const limit = Math.max(0, panLimit(zoom));
    yaw.current.panTarget = [Math.max(-limit, Math.min(limit, x)), Math.max(-limit, Math.min(limit, y))];
  };
  /** Zoom by `factor`, keeping the point under (dx, dy) px from the canvas centre where it is. */
  const zoomBy = (factor: number, dx = 0, dy = 0) => {
    const v = yaw.current;
    const from = v.zoomTarget;
    const to = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, from * factor));
    if (to === from) return;
    const perPx = (z: number) => 1 / (v.fitPx * z);
    v.zoomTarget = to;
    setPan(v.panTarget[0] + dx * (perPx(from) - perPx(to)), v.panTarget[1] - dy * (perPx(from) - perPx(to)), to);
    setZoomed(to > 1.001);
    invalidate();
  };
  const resetZoom = () => {
    yaw.current.zoomTarget = 1;
    yaw.current.panTarget = [0, 0];
    setZoomed(false);
    invalidate();
  };
  const [zoomed, setZoomed] = useState(false);
  // Scrolling over the view zooms it, toward the pointer. A native listener:
  // React's wheel listeners are passive, so the page would scroll as well.
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomByRef.current(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const plan = useMemo(() => planDevices(dims, devices), [dims, devices]);
  const [face, setFace] = useState(1);
  const [glInfo, setGlInfo] = useState<GlInfo | null>(null);
  const [glFailed, setGlFailed] = useState(false);
  const [spin, setSpin] = useState<SpinResult | "running" | null>(null);
  // A lost context (a driver reset, the GPU process restarting) usually comes
  // back by itself; until it does, or if it never does, the view says so and
  // offers a fresh canvas.
  const [roofOpen, setRoofOpen] = useState(() => readFlag(ROOF_KEY, false));
  const [cutaway, setCutaway] = useState(() => readFlag(CUTAWAY_KEY, true));
  const toggleCutaway = () => {
    setCutaway((on) => {
      writeFlag(CUTAWAY_KEY, !on);
      return !on;
    });
    invalidate();
  };
  const toggleRoof = () => {
    setRoofOpen((open) => {
      writeFlag(ROOF_KEY, !open);
      return !open;
    });
    invalidate();
  };
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const liveCanvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number; startYaw: number; startPan: [number, number]; pan: boolean; moved: boolean } | null>(null);
  // Whether the press that ends in a click turned the tent, so a drag that
  // starts on a device does not also open it.
  const lastPressMoved = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const pointing = useMemo<Pointing>(() => {
    const hide = () => {
      if (tip.current) tip.current.hidden = true;
      if (box.current) box.current.style.cursor = "";
    };
    return {
      hide,
      show: (e, title, detail) => {
        e.stopPropagation();
        const t = tip.current;
        const b = box.current;
        if (!t || !b || drag.current?.moved || yaw.current.spin) return hide();
        const rect = b.getBoundingClientRect();
        t.firstElementChild!.textContent = title;
        t.children[1]!.textContent = detail;
        t.hidden = false;
        const left = e.clientX - rect.left + 14;
        t.style.left = `${left + t.offsetWidth > rect.width ? left - t.offsetWidth - 28 : left}px`;
        t.style.top = `${e.clientY - rect.top + 14}px`;
        if (onOpenRef.current) b.style.cursor = "pointer";
      },
      open: (e, item) => {
        e.stopPropagation();
        if (lastPressMoved.current) return;
        hide();
        onOpenRef.current?.(item);
      },
    };
  }, []);

  const turn = useCallback((steps: number) => {
    const y = yaw.current;
    if (y.spin) return;
    y.target = Math.round(y.target / STEP) * STEP + steps * STEP;
    setFace(((Math.round(y.target / STEP) % 8) + 8) % 8);
    invalidate();
  }, []);

  const startSpin = () => {
    const y = yaw.current;
    if (y.spin) return;
    y.current = y.target;
    y.spin = { start: y.target, t0: null, last: 0, frames: 0, worstMs: 0 };
    setSpin("running");
    invalidate();
  };

  // Drag turns the tent; letting go settles on the nearest of the eight views,
  // as a view cube does.
  // A drag turns the tent; with Shift, or the right or middle button, it moves the view instead.
  const onPointerDown = (e: React.PointerEvent) => {
    if (yaw.current.spin) return;
    const pan = e.shiftKey || e.button === 1 || e.button === 2;
    drag.current = { x: e.clientX, y: e.clientY, startYaw: yaw.current.target, startPan: yaw.current.panTarget, pan, moved: false };
    lastPressMoved.current = false;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (!drag.current.moved && Math.hypot(dx, dy) < 4) return;
    drag.current.moved = true;
    pointing.hide();
    const y = yaw.current;
    if (drag.current.pan) {
      const perPx = 1 / (y.fitPx * y.zoomTarget);
      setPan(drag.current.startPan[0] - dx * perPx, drag.current.startPan[1] + dy * perPx);
      y.pan = y.panTarget;
    } else {
      y.target = drag.current.startYaw - dx * 0.01;
      y.current = y.target;
    }
    invalidate();
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    lastPressMoved.current = drag.current.moved;
    const panned = drag.current.pan;
    drag.current = null;
    if (!panned) turn(0);
  };

  return (
    <div className="plan-box">
      <div className="plan-head">
        <Icon name="cube" size={14} /><h3>3D view</h3>
        <span
          className="ph-hint tent-3d-hint"
          title="Drag to turn · scroll or + and − to zoom · shift-drag or right-drag to move the view · 0 to fit"
        >
          <Icon name="move" size={12} /> {zoomed ? "shift-drag to move" : "drag to turn"} · {FACES[face]}
        </span>
        <div className="sv-modes" style={{ marginLeft: 8 }}>
          <button className={eyeLevel ? "" : "on"} onClick={() => eyeLevel && toggleEyeLevel()} aria-pressed={!eyeLevel} title="Looking down at the tent">
            Isometric
          </button>
          <button className={eyeLevel ? "on" : ""} onClick={() => !eyeLevel && toggleEyeLevel()} aria-pressed={eyeLevel} title="Looking straight in">
            Eye level
          </button>
        </div>
        <div className="sv-modes" style={{ marginLeft: 8 }}>
          <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out"><Icon name="minus" size={13} /></button>
          <button onClick={resetZoom} disabled={!zoomed} aria-label="Fit the tent" title="Fit the tent">Fit</button>
          <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in"><Icon name="plus" size={13} /></button>
        </div>
        <div className="sv-modes" style={{ marginLeft: 8 }}>
          <button
            className={roofOpen ? "on" : ""}
            onClick={toggleRoof}
            aria-pressed={roofOpen}
            title={roofOpen ? "Close the roof" : "Open the roof to see in from above"}
          >
            <Icon name="eye" size={13} /> Roof
          </button>
          <button
            className={cutaway ? "on" : ""}
            onClick={toggleCutaway}
            aria-pressed={cutaway}
            title={cutaway ? "Close the walls; only the door stays open" : "Open the walls facing you"}
          >
            <Icon name="layers" size={13} /> Cutaway
          </button>
        </div>
        <div className="sv-modes" style={{ marginLeft: 8 }}>
          <button onClick={() => turn(1)} aria-label="Turn left"><Icon name="arrow-left" size={13} /></button>
          <button onClick={() => turn(-1)} aria-label="Turn right"><Icon name="arrow-right" size={13} /></button>
        </div>
      </div>
      <div
        ref={box}
        className="tent-3d"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") turn(1);
          if (e.key === "ArrowRight") turn(-1);
          if (e.key === "+" || e.key === "=") zoomBy(1.25);
          if (e.key === "-") zoomBy(1 / 1.25);
          if (e.key === "0") resetZoom();
        }}
        tabIndex={0}
      >
        <WebGlBoundary onError={() => setGlFailed(true)}>
          <Canvas
            orthographic
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ near: 1, far: 5000, position: [0, 0, 2000] }}
            key={canvasKey}
            shadows="percentage"
            gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.NeutralToneMapping }}
            onCreated={({ gl }) => {
              setGlInfo(readGlInfo(gl));
              const canvas = gl.domElement;
              liveCanvas.current = canvas;
              // Only the live canvas counts: a replaced one is released on purpose.
              canvas.addEventListener("webglcontextlost", () => {
                if (canvas === liveCanvas.current) setContextLost(true);
              });
              canvas.addEventListener("webglcontextrestored", () => {
                if (canvas !== liveCanvas.current) return;
                // three re-uploads everything itself; the re-render redraws the overhead shadow.
                setContextLost(false);
                invalidate();
              });
            }}
            fallback={<div className="tent-3d-fallback">WebGL is not available on this machine, so the 3D view cannot be drawn.</div>}
          >
            <Lights dims={dims} yaw={yaw} growLight={devices.some((d) => d.role === "light" && d.status !== "off") ? palette.led : undefined} />
            <Rig dims={dims} yaw={yaw} onSpinDone={setSpin} />
            <Tent
              dims={dims} palette={palette} yaw={yaw} roofOpen={roofOpen} cutaway={cutaway} connected={plan.connected}
              gridColor={resolved === "dark" ? "rgba(255,255,255,0.13)" : "rgba(70,58,44,0.2)"}
            />
            {/*
              Plants and devices are each baked together, so the draws stay a
              handful however many there are. Hover still works: the hidden
              parts each group was baked from still catch the pointer.
            */}
            <Baked version={JSON.stringify([dims, plants, growth])}>
            {plants.map((p, i) => (
              <group
                key={p.id}
                onPointerMove={(e) => pointing.show(e, p.label || `Plant ${i + 1}`, `${p.potLitres} L pot`)}
                onPointerOut={pointing.hide}
                onClick={(e) => pointing.open(e, { kind: "plant", id: p.id })}
              >
                <PlantInPot plant={p} dims={dims} growth={growth} palette={palette} position={toScene(dims, p.xCm, p.yCm, 0)} />
              </group>
            ))}
            </Baked>
            {/* Only whether each is off changes how it is drawn; the rest of its status is the dot. */}
            <Baked version={JSON.stringify([dims, devices.map((d) => [d.placement, d.role, d.status === "off"])])}>
              {devices.map((d) => (
                <DeviceMesh key={d.placement.deviceId} dims={dims} device={d} pose={plan.poses.get(d.placement.deviceId)!} palette={palette} pointing={pointing} />
              ))}
            </Baked>
            <Ducts routes={plan.ducts} p={palette} />
            <LightBeams dims={dims} devices={devices} plan={plan} palette={palette} />
            <StatusDots dims={dims} devices={devices} plan={plan} />
          </Canvas>
        </WebGlBoundary>
        <div ref={tip} className="tent-3d-tip" hidden>
          <b />
          <span />
          {onOpen && <small>Click to open in Layout</small>}
        </div>
        {contextLost && (
          <div className="tent-3d-fallback tent-3d-lost">
            <span>
              The graphics driver reset, so the 3D view stopped drawing.
              <br />
              <button className="btn" onClick={() => { setContextLost(false); setCanvasKey((k) => k + 1); }}>
                Redraw
              </button>
            </span>
          </div>
        )}
      </div>
      {import.meta.env.DEV && (
        <div className="plan-foot tent-3d-diag">
          {glInfo ? (
            <>
              <span>{glInfo.version}</span>
              <span title={glInfo.renderer} className="tent-3d-renderer">{glInfo.renderer}</span>
              <span className={glInfo.software ? "tent-3d-sw" : "tent-3d-hw"}>{glInfo.software ? "software" : "hardware"}</span>
            </>
          ) : (
            <span>{glFailed ? "WebGL unavailable" : "Starting WebGL…"}</span>
          )}
          <span className="pf-scale">
            {spin === "running"
              ? "Spinning…"
              : spin
                ? `${spin.fps.toFixed(0)} fps · worst frame ${spin.worstMs.toFixed(1)} ms · ${spin.calls} draws · ${(spin.triangles / 1000).toFixed(0)}k tris`
                : null}
            <button className="btn" onClick={startSpin} disabled={spin === "running" || !glInfo}>Spin test</button>
          </span>
        </div>
      )}
    </div>
  );
}
