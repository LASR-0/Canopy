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
import { ROLE_META } from "@/lib/roles";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { calcGrowStage } from "@/lib/growStage";
import { Baked } from "./bake";
import { Equipment, type Duct } from "./equipment";
import { MODEL_SPECS, modelFor } from "./models";
import { PALETTE, type Palette } from "./palette";
import { PlantInPot, type Growth } from "./plants";
import { cameraDir, type YawState } from "./rig";
import { Lights, RAIL_DROP_CM, Tent } from "./tent";

export interface PlacedDevice {
  placement: DevicePlacement;
  name: string;
  role: RoleKind | undefined;
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
        const { calls, triangles } = state.gl.info.render;
        onSpinDone({ fps: s.frames / elapsed, worstMs: s.worstMs, calls, triangles });
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

// ── Contents ──────────────────────────────────────────────────────────────────

/**
 * A device, drawn by its role's model. The mounting height is the model's
 * base, held inside the tent; hung models get cords up to the roof rails, and
 * inline fans a duct out through the wall they point at.
 */
function DeviceMesh({ dims, device, palette, pointing }: {
  dims: EnclosureDimensions; device: PlacedDevice; palette: Palette; pointing: Pointing;
}) {
  const { placement, role, name } = device;
  const kind = modelFor(role);
  const baseY = Math.min(Math.max(placement.zCm, 0), Math.max(0, dims.heightCm - MODEL_SPECS[kind].heightCm));
  const [x, , z] = toScene(dims, placement.xCm, placement.yCm, 0);
  // 0° faces the door (+z), clockwise seen from above; three.js turns counter-clockwise.
  const rotationY = (-placement.rotationDeg * Math.PI) / 180;
  const roofY = dims.heightCm - RAIL_DROP_CM - baseY;
  const duct = kind === "inline_fan" ? ductTo(dims, x, z, rotationY, role === "intake" ? -1 : 1) : undefined;
  return (
    <group
      position={[x, baseY, z]}
      rotation={[0, rotationY, 0]}
      onPointerMove={(e) => pointing.show(e, name, role ? ROLE_META[role].name : "No role")}
      onPointerOut={pointing.hide}
      onClick={(e) => pointing.open(e, { kind: "device", id: placement.deviceId })}
    >
      <Baked version={JSON.stringify([kind, dims, roofY, duct])}>
        <Equipment kind={kind} p={palette} dims={dims} roofY={roofY} duct={duct} />
      </Baked>
    </group>
  );
}

/** The inline fan's collar sits this far from its centre. */
const FAN_COLLAR_CM = 14;

/**
 * The duct from an inline fan at scene (x, z), turned by `rotationY`, to the
 * wall in the direction it blows: out of its face for exhaust, out of its back
 * for intake, which draws through that wall.
 */
function ductTo(dims: EnclosureDimensions, x: number, z: number, rotationY: number, dir: 1 | -1): Duct {
  const dx = Math.sin(rotationY) * dir;
  const dz = Math.cos(rotationY) * dir;
  const hit = (pos: number, d: number, half: number) =>
    d > 1e-6 ? (half - pos) / d : d < -1e-6 ? (-half - pos) / d : Infinity;
  const distance = Math.min(hit(x, dx, dims.widthCm / 2), hit(z, dz, dims.depthCm / 2));
  return { lengthCm: Math.max(0, distance - FAN_COLLAR_CM), dir };
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
  const { data: grow } = useActiveGrow();
  const stageInfo = grow ? calcGrowStage(grow) : undefined;
  const growth: Growth = { stage: stageInfo?.stage, pct: stageInfo?.pctInStage ?? 0.5 };
  const yaw = useRef<YawState>({ current: STEP, target: STEP, spin: null });
  const [face, setFace] = useState(1);
  const [glInfo, setGlInfo] = useState<GlInfo | null>(null);
  const [glFailed, setGlFailed] = useState(false);
  const [spin, setSpin] = useState<SpinResult | "running" | null>(null);
  // A lost context (a driver reset, the GPU process restarting) usually comes
  // back by itself; until it does, or if it never does, the view says so and
  // offers a fresh canvas.
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const liveCanvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; startYaw: number; moved: boolean } | null>(null);
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
  const onPointerDown = (e: React.PointerEvent) => {
    if (yaw.current.spin) return;
    drag.current = { x: e.clientX, startYaw: yaw.current.target, moved: false };
    lastPressMoved.current = false;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    if (!drag.current.moved && Math.abs(e.clientX - drag.current.x) < 4) return;
    drag.current.moved = true;
    pointing.hide();
    const y = yaw.current;
    y.target = drag.current.startYaw - (e.clientX - drag.current.x) * 0.01;
    y.current = y.target;
    invalidate();
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    lastPressMoved.current = drag.current.moved;
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
        ref={box}
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
            <Lights dims={dims} yaw={yaw} growLight={devices.some((d) => d.role === "light") ? palette.led : undefined} />
            <Rig dims={dims} yaw={yaw} onSpinDone={setSpin} />
            <Tent dims={dims} palette={palette} yaw={yaw} />
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
            {devices.map((d) => <DeviceMesh key={d.placement.deviceId} dims={dims} device={d} palette={palette} pointing={pointing} />)}
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
