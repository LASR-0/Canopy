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
import { Canvas, invalidate, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DevicePlacement, EnclosureDimensions, Plant, RoleKind } from "@canopy/shared-types";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/theme/ThemeProvider";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { calcGrowStage } from "@/lib/growStage";
import { Equipment } from "./equipment";
import { MODEL_SPECS, modelFor } from "./models";
import { PALETTE, type Palette } from "./palette";
import { PlantInPot, type Growth } from "./plants";

export interface PlacedDevice {
  placement: DevicePlacement;
  role: RoleKind | undefined;
}

export interface TentViewProps {
  dims: EnclosureDimensions;
  devices: PlacedDevice[];
  plants: Plant[];
}

/** True isometric: the camera looks down the diagonal of a cube. */
const ELEVATION = Math.atan(1 / Math.SQRT2);
const STEP = Math.PI / 4;
const POLE_CM = 2.5;
const SPIN_SECONDS = 3;

const FACES = ["Front", "Front-right", "Right", "Back-right", "Back", "Back-left", "Left", "Front-left"];

/** Shared between the controls outside the canvas and the camera rig inside it. */
interface YawState {
  current: number;
  target: number;
  /**
   * A timed full turn. Timed by the wall clock, not the frame delta: with
   * frames on demand, the first frame's delta is however long the view sat idle.
   */
  spin: { start: number; t0: number | null; last: number; frames: number; worstMs: number } | null;
}

export interface SpinResult { fps: number; worstMs: number }

interface GlInfo { version: string; renderer: string; software: boolean }

/** Plan coordinates (cm from the back-left corner, z up) to scene coordinates (y up, centred). */
function toScene(dims: EnclosureDimensions, xCm: number, yCm: number, zCm: number): [number, number, number] {
  return [xCm - dims.widthCm / 2, zCm, yCm - dims.depthCm / 2];
}

/** Direction from the tent's centre toward the camera, for a yaw. */
function cameraDir(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(ELEVATION) * Math.sin(yaw),
    Math.sin(ELEVATION),
    Math.cos(ELEVATION) * Math.cos(yaw),
  );
}

/**
 * Pixels per centimetre that fit the tent at every yaw, so turning it never
 * changes its size on screen.
 */
function fitZoom(dims: EnclosureDimensions, width: number, height: number): number {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const up = new THREE.Vector3(0, 1, 0);
  let maxX = 0;
  let maxY = 0;
  for (let deg = 0; deg < 360; deg += 5) {
    const c = cameraDir((deg * Math.PI) / 180);
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

  useEffect(() => {
    camera.zoom = fitZoom(dims, size.width, size.height);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, dims, size.width, size.height]);

  useFrame((state, delta) => {
    const y = yaw.current;
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
        onSpinDone({ fps: s.frames / elapsed, worstMs: s.worstMs });
      }
      state.invalidate();
    } else {
      const diff = y.target - y.current;
      if (Math.abs(diff) > 1e-4) {
        // Capped, or the first frame after a pause would finish the turn at once.
        y.current += diff * Math.min(1, Math.min(delta, 1 / 30) * 12);
        state.invalidate();
      } else {
        y.current = y.target;
      }
    }
    camera.position.copy(cameraDir(y.current).multiplyScalar(2000).add(centre));
    camera.lookAt(centre);
  });
  return null;
}

// ── Tent ──────────────────────────────────────────────────────────────────────

/** A wall that fades out while it faces the camera, so the tent reads as a cutaway. */
function Wall({ size, position, normal, palette, yaw }: {
  size: [number, number];
  position: [number, number, number];
  normal: [number, number, number];
  palette: Palette;
  yaw: React.RefObject<YawState>;
}) {
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const rotationY = Math.atan2(normal[0], normal[2]);
  useFrame((state) => {
    const m = material.current;
    if (!m) return;
    const c = cameraDir(yaw.current.current);
    const facing = normal[0] * c.x + normal[2] * c.z > 0.01;
    const want = facing ? 0.07 : 1;
    if (Math.abs(m.opacity - want) > 0.005) {
      m.opacity += (want - m.opacity) * 0.25;
      state.invalidate();
    } else {
      m.opacity = want;
    }
    m.depthWrite = m.opacity > 0.95;
  });
  return (
    <mesh position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={size} />
      <meshStandardMaterial ref={material} color={palette.wall} side={THREE.DoubleSide} transparent flatShading roughness={1} />
    </mesh>
  );
}

/** The frame: four uprights and the top and bottom rails. */
function Frame({ dims, palette }: { dims: EnclosureDimensions; palette: Palette }) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const poles: { pos: [number, number, number]; size: [number, number, number] }[] = [];
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) {
    poles.push({ pos: [x, h / 2, z], size: [POLE_CM, h, POLE_CM] });
  }
  for (const y of [0, h]) {
    for (const z of [-d / 2, d / 2]) poles.push({ pos: [0, y, z], size: [w + POLE_CM, POLE_CM, POLE_CM] });
    for (const x of [-w / 2, w / 2]) poles.push({ pos: [x, y, 0], size: [POLE_CM, POLE_CM, d + POLE_CM] });
  }
  return (
    <group>
      {poles.map((p, i) => (
        <mesh key={i} position={p.pos}>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={palette.pole} flatShading roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** The door's zip on the front panel: an arch-topped outline. */
function Door({ dims, palette }: { dims: EnclosureDimensions; palette: Palette }) {
  const line = useMemo(() => {
    const doorW = Math.min(dims.widthCm * 0.7, 160);
    const doorH = dims.heightCm * 0.86;
    const r = Math.min(doorW / 2, 25);
    const shape = new THREE.Shape();
    shape.moveTo(-doorW / 2, 0);
    shape.lineTo(-doorW / 2, doorH - r);
    shape.quadraticCurveTo(-doorW / 2, doorH, -doorW / 2 + r, doorH);
    shape.lineTo(doorW / 2 - r, doorH);
    shape.quadraticCurveTo(doorW / 2, doorH, doorW / 2, doorH - r);
    shape.lineTo(doorW / 2, 0);
    // `<line>` is SVG's in JSX, so three's Line goes in as a primitive.
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(shape.getPoints(8)),
      new THREE.LineBasicMaterial({ color: palette.door }),
    );
  }, [dims.widthCm, dims.heightCm, palette.door]);
  useEffect(() => () => {
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  }, [line]);
  return <primitive object={line} position={[0, 0, dims.depthCm / 2 + 0.5]} />;
}

function Tent({ dims, palette, yaw }: { dims: EnclosureDimensions; palette: Palette; yaw: React.RefObject<YawState> }) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={palette.floor} flatShading roughness={1} />
      </mesh>
      <Wall size={[w, h]} position={[0, h / 2, -d / 2]} normal={[0, 0, -1]} palette={palette} yaw={yaw} />
      <Wall size={[w, h]} position={[0, h / 2, d / 2]} normal={[0, 0, 1]} palette={palette} yaw={yaw} />
      <Wall size={[d, h]} position={[-w / 2, h / 2, 0]} normal={[-1, 0, 0]} palette={palette} yaw={yaw} />
      <Wall size={[d, h]} position={[w / 2, h / 2, 0]} normal={[1, 0, 0]} palette={palette} yaw={yaw} />
      <Frame dims={dims} palette={palette} />
      <Door dims={dims} palette={palette} />
    </group>
  );
}

// ── Contents ──────────────────────────────────────────────────────────────────

/**
 * A device, drawn by its role's model. The mounting height is the model's
 * base, held inside the tent; hung models get cords up to the roof bars.
 */
function DeviceMesh({ dims, device, palette }: { dims: EnclosureDimensions; device: PlacedDevice; palette: Palette }) {
  const { placement, role } = device;
  const kind = modelFor(role);
  const baseY = Math.min(Math.max(placement.zCm, 0), Math.max(0, dims.heightCm - MODEL_SPECS[kind].heightCm));
  const [x, , z] = toScene(dims, placement.xCm, placement.yCm, 0);
  // 0° faces the door (+z), clockwise seen from above; three.js turns counter-clockwise.
  const rotationY = (-placement.rotationDeg * Math.PI) / 180;
  return (
    <group position={[x, baseY, z]} rotation={[0, rotationY, 0]}>
      <Equipment kind={kind} p={palette} dims={dims} roofY={dims.heightCm - baseY} />
    </group>
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

export default function TentView({ dims, devices, plants }: TentViewProps) {
  const { resolved } = useTheme();
  const palette = PALETTE[resolved];
  const { data: grow } = useActiveGrow();
  const stageInfo = grow ? calcGrowStage(grow) : undefined;
  const growth: Growth = { stage: stageInfo?.stage, pct: stageInfo?.pctInStage ?? 0.5 };
  const yaw = useRef<YawState>({ current: STEP, target: STEP, spin: null });
  const [face, setFace] = useState(1);
  const [glInfo, setGlInfo] = useState<GlInfo | null>(null);
  const [glFailed, setGlFailed] = useState(false);
  const [spin, setSpin] = useState<SpinResult | "running" | null>(null);
  const drag = useRef<{ x: number; startYaw: number } | null>(null);

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
  const onPointerDown = (e: React.PointerEvent) => {
    if (yaw.current.spin) return;
    drag.current = { x: e.clientX, startYaw: yaw.current.target };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const y = yaw.current;
    y.target = drag.current.startYaw - (e.clientX - drag.current.x) * 0.01;
    y.current = y.target;
    invalidate();
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    turn(0);
  };

  return (
    <div className="plan-box">
      <div className="plan-head">
        <Icon name="cube" size={14} /><h3>Isometric view</h3>
        <span className="ph-hint"><Icon name="move" size={12} /> drag to turn · {FACES[face]}</span>
        <div className="sv-modes" style={{ marginLeft: 8 }}>
          <button onClick={() => turn(1)} aria-label="Turn left"><Icon name="arrow-left" size={13} /></button>
          <button onClick={() => turn(-1)} aria-label="Turn right"><Icon name="arrow-right" size={13} /></button>
        </div>
      </div>
      <div
        className="tent-3d"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") turn(1);
          if (e.key === "ArrowRight") turn(-1);
        }}
        tabIndex={0}
      >
        <WebGlBoundary onError={() => setGlFailed(true)}>
          <Canvas
            orthographic
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ near: 1, far: 5000, position: [0, 0, 2000] }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            onCreated={({ gl }) => setGlInfo(readGlInfo(gl))}
            fallback={<div className="tent-3d-fallback">WebGL is not available on this machine, so the 3D view cannot be drawn.</div>}
          >
            <ambientLight intensity={1.4} />
            <directionalLight position={[-300, 600, 400]} intensity={1.6} />
            <Rig dims={dims} yaw={yaw} onSpinDone={setSpin} />
            <Tent dims={dims} palette={palette} yaw={yaw} />
            {plants.map((p) => (
              <PlantInPot key={p.id} plant={p} dims={dims} growth={growth} palette={palette} position={toScene(dims, p.xCm, p.yCm, 0)} />
            ))}
            {devices.map((d) => <DeviceMesh key={d.placement.deviceId} dims={dims} device={d} palette={palette} />)}
          </Canvas>
        </WebGlBoundary>
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
                ? `${spin.fps.toFixed(0)} fps · worst frame ${spin.worstMs.toFixed(1)} ms`
                : null}
            <button className="btn" onClick={startSpin} disabled={spin === "running" || !glInfo}>Spin test</button>
          </span>
        </div>
      )}
    </div>
  );
}
