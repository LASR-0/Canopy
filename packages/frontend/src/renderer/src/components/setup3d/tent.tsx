/**
 * The tent, generated from its dimensions, and the lights it is shown under.
 *
 * Fabric panels with charcoal piping on the seams, moulded joints on the
 * corners, a floor tray, vents with flaps and round duct ports, over a thin
 * metal frame inside. Every wall is a fabric border around a zipped panel;
 * while a wall faces the camera its panel is unzipped (faded out), so the
 * tent reads as a cutaway from whichever side it is turned to. On a corner
 * view the corner between the two open walls is sliced away too, upright,
 * pole and the fabric either side, so nothing stands in the middle of the
 * view. The roof is the same kind of panel, opened by the view's Roof toggle.
 * With the view's Cutaway off, the walls stay closed and only the door is
 * open, so the tent can be seen from outside.
 * Only the front's zip is a door, so only it shows while closed.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { EnclosureDimensions } from "@canopy/shared-types";
import type { Palette } from "./palette";
import { Baked } from "./bake";
import { cameraDir, type YawState } from "./rig";
import { Box, Cyl, ALONG_X, ALONG_Z, type V3 } from "./shapes";

const PANEL_CM = 1.2;
const PIPING_CM = 1.3;
const JOINT_CM = 5.5;
const TRAY_CM = 4.5;
/** The roof rails sit this far below the roof; hung equipment's cords end there. */
export const RAIL_DROP_CM = 3;
const POLE_CM = 1.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type N2 = [number, number];
/** Whether a wall with horizontal normal `n` faces a viewer looking along `c`. */
const facing = (n: N2, c: THREE.Vector3) => n[0] * c.x + n[1] * c.z > 0.01;

/** A rectangle with rounded corners, from its bottom-left corner. */
function roundedRect(path: THREE.Path, x: number, y: number, w: number, h: number, r: number) {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

/** The zipped opening in a wall `width` wide and `height` tall, in the wall's own frame. */
function opening(width: number, height: number) {
  const side = clamp(width * 0.07, 4, 12);
  const top = clamp(height * 0.03, 3, 7);
  const bottom = clamp(height * 0.05, 5, 12);
  const w = width - 2 * side;
  const h = height - top - bottom;
  return { x: -w / 2, y: bottom, w, h, r: clamp(Math.min(w, h) / 4, 2, 14) };
}

/**
 * Which side of a wall is sliced away with its corner: none, or its +x side
 * ("right"); a "left" slice is the right one mirrored.
 */
type Slice = "none" | "left" | "right";

/**
 * A wall's border, its fabric around the opening. Sliced on one side, the
 * opening runs out through that edge, leaving a C of fabric.
 */
function borderGeometry(width: number, height: number, slice: Slice): THREE.BufferGeometry {
  const o = opening(width, height);
  const s = new THREE.Shape();
  if (slice === "none") {
    s.moveTo(-width / 2, 0);
    s.lineTo(width / 2, 0);
    s.lineTo(width / 2, height);
    s.lineTo(-width / 2, height);
    s.lineTo(-width / 2, 0);
    const hole = new THREE.Path();
    roundedRect(hole, o.x, o.y, o.w, o.h, o.r);
    s.holes.push(hole);
  } else {
    const { x, y, h, r } = o;
    s.moveTo(-width / 2, 0);
    s.lineTo(width / 2, 0);
    s.lineTo(width / 2, y);
    s.lineTo(x + r, y);
    s.quadraticCurveTo(x, y, x, y + r);
    s.lineTo(x, y + h - r);
    s.quadraticCurveTo(x, y + h, x + r, y + h);
    s.lineTo(width / 2, y + h);
    s.lineTo(width / 2, height);
    s.lineTo(-width / 2, height);
    s.lineTo(-width / 2, 0);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: PANEL_CM, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -PANEL_CM);
  if (slice === "left") g.scale(-1, 1, 1);
  return g;
}

/** The zip round the opening: a closed loop, or a C that runs out through a sliced side. */
function zipGeometry(width: number, height: number, slice: Slice): THREE.BufferGeometry {
  const o = opening(width, height);
  const path = new THREE.Path();
  if (slice === "none") {
    roundedRect(path, o.x, o.y, o.w, o.h, o.r);
  } else {
    const { x, y, h, r } = o;
    path.moveTo(width / 2, y);
    path.lineTo(x + r, y);
    path.quadraticCurveTo(x, y, x, y + r);
    path.lineTo(x, y + h - r);
    path.quadraticCurveTo(x, y + h, x + r, y + h);
    path.lineTo(width / 2, y + h);
  }
  const pts = path.getSpacedPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0.15));
  const closed = slice === "none";
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, "catmullrom", 0.1), 128, 0.55, 5, closed);
  if (slice === "left") g.scale(-1, 1, 1);
  return g;
}

/**
 * Soft shading into a panel's edges, darkest along the bottom: the stand-in
 * for ambient occlusion where fabric meets floor and corners. One canvas,
 * shared; each panel maps it across its own size.
 */
function edgeShade(bottom: number, sides: number, top: number): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  const band = (x0: number, y0: number, x1: number, y1: number, strength: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(60,48,32,${strength})`);
    g.addColorStop(1, "rgba(60,48,32,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  };
  band(0, size, 0, size * 0.72, bottom);
  band(0, 0, size * 0.1, 0, sides);
  band(size, 0, size * 0.9, 0, sides);
  band(0, 0, 0, size * 0.08, top);
  return canvas;
}

/** A shading texture mapped across a panel `width` × `height` built in its own frame (x centred, y from 0). */
function shadeTexture(canvas: HTMLCanvasElement, width: number, height: number) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  // Extruded shapes take their plan coordinates, in cm, as UVs.
  t.repeat.set(1 / width, 1 / height);
  t.offset.set(0.5, 0);
  return t;
}

const WALL_SHADE = typeof document === "undefined" ? null : edgeShade(0.2, 0.1, 0.06);
const FLAT_SHADE = typeof document === "undefined" ? null : edgeShade(0.12, 0.12, 0.12);

interface Openness {
  open: boolean;
  slice: Slice;
}

/**
 * One panel of the tent, built in its own frame (x across, y up, +z out of the
 * tent) and turned into place. The border is always drawn; the zipped panel
 * inside it, and anything sewn onto it (`children`), fades while open.
 */
function Panel({ width, height, position, rotation, door = false, shade, palette, state, bakeKey = "", fixed, children }: {
  width: number;
  height: number;
  position: V3;
  rotation: V3;
  door?: boolean;
  shade: HTMLCanvasElement | null;
  palette: Palette;
  /** Whether it is open, and which side is sliced, for the current view. */
  state: () => Openness;
  /** Anything besides the panel's size that changes what is sewn onto it. */
  bakeKey?: string;
  /** Sewn on but never faded: a port with a duct through it stays, so the duct never ends in the air. */
  fixed?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const panel = useRef<THREE.Group>(null);
  const border = useRef<THREE.Mesh>(null);
  const zip = useRef<THREE.Mesh>(null);
  const zipMat = useRef<THREE.MeshStandardMaterial>(null);
  const shown = useRef(1);
  const slice = useRef<Slice>("none");

  const geo = useMemo(() => {
    const o = opening(width, height);
    const inner = new THREE.Shape();
    roundedRect(inner, o.x, o.y, o.w, o.h, o.r);
    // Flush with the border on both faces, so a closed panel shows no seam.
    const infill = new THREE.ExtrudeGeometry(inner, { depth: PANEL_CM, bevelEnabled: false, curveSegments: 6 });
    infill.translate(0, 0, -PANEL_CM);
    const slices: Slice[] = ["none", "left", "right"];
    return {
      infill,
      border: Object.fromEntries(slices.map((k) => [k, borderGeometry(width, height, k)])) as Record<Slice, THREE.BufferGeometry>,
      zip: Object.fromEntries(slices.map((k) => [k, zipGeometry(width, height, k)])) as Record<Slice, THREE.BufferGeometry>,
      texture: shade ? shadeTexture(shade, width, height) : null,
    };
  }, [width, height, shade]);
  useEffect(() => () => {
    geo.infill.dispose();
    Object.values(geo.border).forEach((g) => g.dispose());
    Object.values(geo.zip).forEach((g) => g.dispose());
    geo.texture?.dispose();
  }, [geo]);

  useFrame((frame) => {
    const { open, slice: want } = state();
    if (want !== slice.current) {
      slice.current = want;
      if (border.current) border.current.geometry = geo.border[want];
      if (zip.current) zip.current.geometry = geo.zip[want];
    }
    const target = open ? 0 : 1;
    let v = shown.current;
    if (Math.abs(v - target) > 0.01) {
      v += (target - v) * 0.25;
      frame.invalidate();
    } else {
      v = target;
    }
    if (v === shown.current && panel.current?.userData.applied === v) return;
    shown.current = v;
    const g = panel.current;
    if (g) {
      g.userData.applied = v;
      g.visible = v > 0.01;
      // Only opacity changes: switching `transparent` would recompile the
      // shaders, a visible stall the first time each panel opens.
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        if (!m.transparent) m.transparent = true;
        m.opacity = v;
        m.depthWrite = v > 0.99;
      });
    }
    // A side's zip only shows while it is open; the door's always does.
    if (zipMat.current && !door) {
      zipMat.current.opacity = 1 - v;
      zipMat.current.visible = v < 0.99;
    }
  });

  const o = opening(width, height);
  return (
    <group position={position} rotation={rotation}>
      <mesh ref={border} geometry={geo.border.none} receiveShadow>
        <meshStandardMaterial color={palette.fabric} map={geo.texture} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={zip} geometry={geo.zip.none}>
        <meshStandardMaterial ref={zipMat} color={palette.zip} roughness={0.6} transparent={!door} />
      </mesh>
      {door && <ZipPulls at={[0, o.y + o.h, 0]} palette={palette} />}
      <group ref={panel}>
        <mesh geometry={geo.infill} receiveShadow>
          <meshStandardMaterial color={palette.fabric} map={geo.texture} roughness={0.95} side={THREE.DoubleSide} transparent />
        </mesh>
        {children && <Baked version={`${width}|${height}|${bakeKey}`}>{children}</Baked>}
      </group>
      {fixed}
    </group>
  );
}

/** The door's two sliders, met at the top of the zip, their pulls hanging. */
function ZipPulls({ at, palette }: { at: V3; palette: Palette }) {
  return (
    <group position={at}>
      {[-1.6, 1.6].map((x) => (
        <group key={x} position={[x, 0, 0.7]} rotation={[0, 0, x * 0.06]}>
          <Box size={[1.6, 1.6, 0.8]} at={[0, 0, 0]} color={palette.zip} r={0.3} shadow={false} />
          <Box size={[0.9, 3.6, 0.4]} at={[0, -2.4, 0.2]} color={palette.frame} r={0.2} shadow={false} />
        </group>
      ))}
    </group>
  );
}

/**
 * A vent window low on a wall: a charcoal frame round dark mesh, and a fabric
 * flap hinged along its top, hanging a little open as on the reference. The
 * view mostly sees walls from inside (a wall facing the camera is open), so
 * the frame and mesh are sewn through to the inside face too.
 */
function Vent({ at, scale = 1, palette }: { at: V3; scale?: number; palette: Palette }) {
  const w = 24 * scale;
  const h = 16 * scale;
  const strands = Math.max(1, Math.round((w - 4) / 3) - 1);
  return (
    <group position={at}>
      <Box size={[w, h, 0.8]} at={[0, 0, 0.4]} color={palette.frame} r={1.2} />
      <Box size={[w - 4, h - 4, 0.4]} at={[0, 0, 0.9]} color={palette.zip} r={0.6} />
      <Box size={[w, h, 0.8]} at={[0, 0, -PANEL_CM - 0.4]} color={palette.frame} r={1.2} />
      <Box size={[w - 4, h - 4, 0.4]} at={[0, 0, -PANEL_CM - 0.9]} color={palette.zip} r={0.6} />
      {/* The mesh's weave, seen from inside. */}
      {Array.from({ length: strands }, (_, i) => (
        <Box key={i} size={[0.25, h - 4.4, 0.2]} at={[-(w - 4) / 2 + ((i + 1) * (w - 4)) / (strands + 1), 0, -PANEL_CM - 1.15]} color={palette.frame} r={0} shadow={false} />
      ))}
      {/* The flap, hinged at the top edge and swung out. */}
      <group position={[0, h / 2 - 0.6, 1.2]} rotation={[-0.22, 0, 0]}>
        <Box size={[w - 2, h - 2.5, 0.7]} at={[0, -(h - 2.5) / 2, 0.35]} color={palette.fabric} r={0.35} />
        <Box size={[w - 2, 1.4, 0.9]} at={[0, -(h - 2.5) + 0.7, 0.4]} color={palette.frame} r={0.4} />
      </group>
      {/* Toggle straps either side, for rolling the flap up. */}
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[1.6, 4, 0.5]} at={[sx * (w / 2 - 3), h / 2 + 1.2, 0.5]} color={palette.frame} r={0.25} />
      ))}
    </group>
  );
}

/**
 * A round duct port: a charcoal collar sewn to the panel and the fabric sock
 * tied off with its drawstring outside; inside, the collar round the opening.
 * With a duct through it (`connected`), the sock is open, drawn up round the
 * duct, and there is no opening to see.
 */
function DuctPort({ at, connected = false, palette }: { at: V3; connected?: boolean; palette: Palette }) {
  if (connected) {
    return (
      <group position={at}>
        <mesh position={[0, 0, -PANEL_CM - 0.6]}>
          <torusGeometry args={[8.5, 1.3, 8, 24]} />
          <meshStandardMaterial color={palette.frame} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.6]} castShadow>
          <torusGeometry args={[8.5, 1.3, 8, 24]} />
          <meshStandardMaterial color={palette.frame} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0, 4]} rotation={ALONG_Z}>
          <cylinderGeometry args={[8.3, 8.6, 7, 20, 1, true]} />
          <meshStandardMaterial color={palette.fabric} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 6.6]}>
          <torusGeometry args={[8.3, 0.4, 6, 24]} />
          <meshStandardMaterial color={palette.zip} roughness={0.6} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={at}>
      <mesh position={[0, 0, -PANEL_CM - 0.6]}>
        <torusGeometry args={[8.5, 1.3, 8, 24]} />
        <meshStandardMaterial color={palette.frame} roughness={0.7} />
      </mesh>
      <Cyl r={7.4} h={0.3} at={[0, 0, -PANEL_CM - 0.2]} rotation={ALONG_Z} color={palette.zip} seg={24} />
      <mesh position={[0, 0, 0.6]} castShadow>
        <torusGeometry args={[8.5, 1.3, 8, 24]} />
        <meshStandardMaterial color={palette.frame} roughness={0.7} />
      </mesh>
      <Cyl r={7.8} r2={7} h={5} at={[0, 0, 3]} rotation={ALONG_Z} color={palette.fabric} seg={20} />
      <Cyl r={7.2} r2={4.5} h={3} at={[0, 0, 6.8]} rotation={ALONG_Z} color={palette.fabric} seg={20} />
      <mesh position={[0, 0, 5.4]}>
        <torusGeometry args={[7.3, 0.35, 6, 24]} />
        <meshStandardMaterial color={palette.zip} roughness={0.6} />
      </mesh>
      <Box size={[0.6, 4, 0.6]} at={[0.8, -8.5, 5.6]} color={palette.zip} r={0.25} shadow={false} />
    </group>
  );
}

/**
 * A moulded corner joint, where three seams meet: a rounded block with a
 * short sleeve down each seam into the tent.
 */
function Joint({ at, dir, palette }: { at: V3; dir: V3; palette: Palette }) {
  const [sx, sy, sz] = dir;
  const arm = JOINT_CM * 0.9;
  const r = PIPING_CM * 1.45;
  return (
    <group position={at}>
      <Box size={[JOINT_CM, JOINT_CM, JOINT_CM]} at={[0, 0, 0]} color={palette.frame} r={2} shadow={false} />
      <Cyl r={r} h={arm} at={[sx * arm / 2, 0, 0]} rotation={ALONG_X} color={palette.frame} seg={12} shadow={false} />
      <Cyl r={r} h={arm} at={[0, sy * arm / 2, 0]} color={palette.frame} seg={12} shadow={false} />
      <Cyl r={r} h={arm} at={[0, 0, sz * arm / 2]} rotation={ALONG_Z} color={palette.frame} seg={12} shadow={false} />
    </group>
  );
}

/**
 * Everything on the tent's edges that never moves: the roof seams, the floor
 * tray round the bottom, the corner joints and the roof rails inside.
 * The uprights are drawn by `Corner`, so a corner can be sliced away.
 */
function Edges({ dims, palette }: { dims: EnclosureDimensions; palette: Palette }) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const inset = RAIL_DROP_CM;
  const rail = h - inset;
  return (
    <group>
      {/* Roof seams */}
      {[-d / 2, d / 2].map((z) => <Cyl key={`x${z}`} r={PIPING_CM} h={w} at={[0, h, z]} rotation={ALONG_X} color={palette.frame} seg={10} shadow={false} />)}
      {[-w / 2, w / 2].map((x) => <Cyl key={`z${x}`} r={PIPING_CM} h={d} at={[x, h, 0]} rotation={ALONG_Z} color={palette.frame} seg={10} shadow={false} />)}
      {/* The floor tray: a charcoal band round the bottom. */}
      {[-d / 2, d / 2].map((z) => <Box key={`tx${z}`} size={[w + 1, TRAY_CM, 2]} at={[0, TRAY_CM / 2, z]} color={palette.frame} r={0.9} shadow={false} />)}
      {[-w / 2, w / 2].map((x) => <Box key={`tz${x}`} size={[2, TRAY_CM, d + 1]} at={[x, TRAY_CM / 2, 0]} color={palette.frame} r={0.9} shadow={false} />)}
      {[-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [
        <Joint key={`t${sx}${sz}`} at={[sx * w / 2, h, sz * d / 2]} dir={[-sx, -1, -sz]} palette={palette} />,
        <Joint key={`b${sx}${sz}`} at={[sx * w / 2, JOINT_CM / 2, sz * d / 2]} dir={[-sx, 1, -sz]} palette={palette} />,
      ]))}
      {/* Roof rails */}
      {[-(d / 2 - inset), d / 2 - inset].map((z) => <Cyl key={`rx${z}`} r={POLE_CM} h={w - 2 * inset} at={[0, rail, z]} rotation={ALONG_X} color={palette.pole} seg={8} shadow={false} />)}
      {[-(w / 2 - inset), w / 2 - inset].map((x) => <Cyl key={`rz${x}`} r={POLE_CM} h={d - 2 * inset} at={[x, rail, 0]} rotation={ALONG_Z} color={palette.pole} seg={8} shadow={false} />)}
    </group>
  );
}

/** One upright corner: the seam's piping outside and the frame's pole inside, hidden while the corner is sliced. */
function Corner({ dims, sx, sz, palette, yaw, cutaway }: {
  dims: EnclosureDimensions; sx: 1 | -1; sz: 1 | -1; palette: Palette; yaw: React.RefObject<YawState>;
  cutaway: React.RefObject<boolean>;
}) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const c = cameraDir(yaw.current.current);
    if (group.current) group.current.visible = !(cutaway.current && facing([sx, 0], c) && facing([0, sz], c));
  });
  const top = h - RAIL_DROP_CM;
  return (
    <group ref={group}>
      <Cyl r={PIPING_CM} h={h} at={[sx * w / 2, h / 2, sz * d / 2]} color={palette.frame} seg={10} shadow={false} />
      <Cyl r={POLE_CM} h={top} at={[sx * (w / 2 - RAIL_DROP_CM), top / 2, sz * (d / 2 - RAIL_DROP_CM)]} color={palette.pole} seg={8} shadow={false} />
    </group>
  );
}

/** The key light's way across the floor plan, for a yaw: from over the viewer's right shoulder (see `Lights`). */
const KEY_TURN = 0.55;
/** How long the tent's shadow is, as a share of its height. */
const SHADOW_REACH = 0.38;
const SHADOW_ALPHA = 0.26;

/** The convex hull of points in the plane, anticlockwise. */
function hull(points: THREE.Vector2[]): THREE.Vector2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: THREE.Vector2[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The tent's shadow on the ground: its box cast along the key light, which
 * turns with the camera, so the shadow always falls away from the light on
 * screen. Drawn as a soft-edged polygon, not by a shadow map, so a turn costs
 * a handful of vertices rather than redrawing the scene.
 */
function CastShadow({ dims, yaw }: { dims: EnclosureDimensions; yaw: React.RefObject<YawState> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const last = useRef<number | null>(null);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => { last.current = null; }, [dims]);

  useFrame(() => {
    const m = mesh.current;
    const yawNow = yaw.current.current;
    if (!m || (last.current !== null && Math.abs(last.current - yawNow) < 1e-4)) return;
    last.current = yawNow;
    const { widthCm: w, depthCm: d, heightCm: h } = dims;
    const light = cameraDir(yawNow + KEY_TURN, 1);
    const away = new THREE.Vector2(-light.x, -light.z).normalize().multiplyScalar(h * SHADOW_REACH);
    const corners: THREE.Vector2[] = [];
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) {
      corners.push(new THREE.Vector2(x, z), new THREE.Vector2(x, z).add(away));
    }
    const ring = hull(corners);
    const feather = Math.max(12, Math.min(w, d) * 0.18);
    const centre = ring.reduce((c, p) => c.add(p), new THREE.Vector2()).multiplyScalar(1 / ring.length);
    // Each corner pushed out along the average of its two edges' outward normals.
    const outer = ring.map((p, i) => {
      const prev = ring[(i + ring.length - 1) % ring.length]!;
      const next = ring[(i + 1) % ring.length]!;
      const n1 = new THREE.Vector2(p.y - prev.y, prev.x - p.x).normalize();
      const n2 = new THREE.Vector2(next.y - p.y, p.x - next.x).normalize();
      return p.clone().addScaledVector(n1.add(n2).normalize(), feather);
    });
    const position: number[] = [];
    const color: number[] = [];
    const vert = (p: THREE.Vector2, a: number) => {
      position.push(p.x, 0, p.y);
      color.push(0.12, 0.1, 0.08, a);
    };
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      vert(centre, SHADOW_ALPHA); vert(ring[j]!, SHADOW_ALPHA); vert(ring[i]!, SHADOW_ALPHA);
      vert(ring[i]!, SHADOW_ALPHA); vert(ring[j]!, SHADOW_ALPHA); vert(outer[j]!, 0);
      vert(ring[i]!, SHADOW_ALPHA); vert(outer[j]!, 0); vert(outer[i]!, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(color, 4));
    m.geometry.dispose();
    m.geometry = g;
  });

  return <mesh ref={mesh} position={[0, -0.5, 0]} renderOrder={-1} material={material} />;
}

/** A grid tile: one cell's two edges, so tiles repeat into lines. */
function gridTile(color: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, 0, 2, size);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Opaque in the middle, gone at the edge: how far the grid reaches before it fades into the background. */
function radialFade(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size / 2);
  g.addColorStop(0, "#fff");
  g.addColorStop(1, "#000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * The ground the tent stands on: a grid in cm, square to the tent, fading
 * into the background, in a colour that follows the theme.
 */
function GroundGrid({ dims, lineColor }: { dims: EnclosureDimensions; lineColor: string }) {
  const anisotropy = useThree((st) => st.gl.capabilities.getMaxAnisotropy());
  const span = Math.max(dims.widthCm, dims.depthCm);
  const size = span * 3.4 + 200;
  const step = span <= 200 ? 25 : span <= 400 ? 50 : 100;
  const textures = useMemo(() => {
    const lines = gridTile(lineColor);
    lines.anisotropy = anisotropy;
    // Lines fall on the tent's edges: offset so a tent wall sits on a line.
    lines.repeat.set(size / step, size / step);
    lines.offset.set(((size / 2 - dims.widthCm / 2) / step) % 1, ((size / 2 - dims.depthCm / 2) / step) % 1);
    return { lines, fade: radialFade() };
  }, [lineColor, anisotropy, size, step, dims.widthCm, dims.depthCm]);
  useEffect(() => () => { textures.lines.dispose(); textures.fade.dispose(); }, [textures]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]} renderOrder={-2}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={textures.lines} alphaMap={textures.fade} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** The floor, shaded into its edges. */
function Floor({ dims, palette }: { dims: EnclosureDimensions; palette: Palette }) {
  const texture = useMemo(() => {
    if (!FLAT_SHADE) return null;
    const t = new THREE.CanvasTexture(FLAT_SHADE);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture?.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} receiveShadow>
      <planeGeometry args={[dims.widthCm, dims.depthCm]} />
      <meshStandardMaterial color={palette.floor} map={texture} roughness={1} />
    </mesh>
  );
}

/** A duct port: which panel it is sewn into, where (in the panel's frame and the scene's), and the way out of the tent. */
export interface PortSpot {
  key: string;
  panel: "back" | "roof";
  local: V3;
  world: V3;
  normal: V3;
}

/**
 * The tent's duct ports: one in the roof toward the back right, and one or two
 * high on the back wall, as tents of these sizes have them. Inline fans'
 * ducts are routed through them (ducts.tsx).
 */
export function ductPorts(dims: EnclosureDimensions): PortSpot[] {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const out: PortSpot[] = [];
  if (w >= 70 && d >= 70) {
    // The roof's frame runs front (y = 0) to back (y = d), its +z up.
    out.push({ key: "roof", panel: "roof", local: [w / 2 - 20, d - 20, 0], world: [w / 2 - 20, h, -d / 2 + 20], normal: [0, 1, 0] });
  }
  if (h >= 90) {
    const y = h - Math.max(14, Math.min(28, h * 0.14));
    const xs = w >= 90 ? [-w / 2 + 22, w / 2 - 22] : [0];
    // The back wall is turned half round, so its +x is the scene's -x.
    xs.forEach((x, i) => out.push({ key: `back${i}`, panel: "back", local: [x, y, 0], world: [-x, y, -d / 2], normal: [0, 0, -1] }));
  }
  return out;
}

/** Where a wall's vents go: low down, toward the front on the sides, and across the back. */
function ventsFor(width: number, height: number, kind: "side" | "back"): { at: V3; scale: number }[] {
  const o = opening(width, height);
  const scale = Math.min(1, (o.w - 6) / 30, (o.h - 6) / 40);
  if (scale < 0.5) return [];
  const y = o.y + 8 * scale + 4;
  if (kind === "side") return [{ at: [-(o.w / 2) + 12 * scale + 6, y, 0], scale }];
  const count = width >= 160 ? 2 : 1;
  return Array.from({ length: count }, (_, i) => ({ at: [count === 1 ? 0 : (i ? 1 : -1) * width * 0.25, y, 0], scale }));
}

export function Tent({ dims, palette, yaw, roofOpen, cutaway, connected, gridColor }: {
  dims: EnclosureDimensions;
  palette: Palette;
  yaw: React.RefObject<YawState>;
  roofOpen: boolean;
  /** Walls facing the camera open; off, the tent stays closed but for its door. */
  cutaway: boolean;
  /** Keys of the duct ports a fan's duct goes through. */
  connected: ReadonlySet<string>;
  /** The ground grid's line colour, which follows the theme as the background does. */
  gridColor: string;
}) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const roof = useRef(roofOpen);
  roof.current = roofOpen;
  const cut = useRef(cutaway);
  cut.current = cutaway;

  // Each wall opens while it faces the camera; on a corner view the corner
  // between two open walls is sliced, so each loses its border on that side.
  // With the cutaway off only the door is open, from every side.
  const wallState = (n: N2) => (): Openness => {
    if (!cut.current) return { open: n[0] === 0 && n[1] === 1, slice: "none" };
    const c = cameraDir(yaw.current.current);
    const open = facing(n, c);
    // A wall's +x side, in its own frame, is toward the wall with normal (nz, -nx).
    const right = open && facing([n[1], -n[0]], c);
    const left = open && facing([-n[1], n[0]], c);
    return { open, slice: right ? "right" : left ? "left" : "none" };
  };
  const ports = ductPorts(dims);
  // Free ports fade with their panel; a port in use is drawn outside the fade.
  const portsOn = (panel: PortSpot["panel"], inUse: boolean) =>
    ports.filter((pt) => pt.panel === panel && connected.has(pt.key) === inUse).map((pt) => (
      <DuctPort key={pt.key} at={pt.local} connected={inUse} palette={palette} />
    ));
  const used = (panel: PortSpot["panel"]) => ports.filter((pt) => pt.panel === panel && connected.has(pt.key)).map((pt) => pt.key).join(",");

  return (
    <group>
      <GroundGrid dims={dims} lineColor={gridColor} />
      <CastShadow dims={dims} yaw={yaw} />
      <Floor dims={dims} palette={palette} />
      <Panel width={w} height={h} position={[0, 0, d / 2]} rotation={[0, 0, 0]} door shade={WALL_SHADE} palette={palette} state={wallState([0, 1])} />
      <Panel
        width={w} height={h} position={[0, 0, -d / 2]} rotation={[0, Math.PI, 0]} shade={WALL_SHADE} palette={palette}
        state={wallState([0, -1])} bakeKey={used("back")} fixed={portsOn("back", true)}
      >
        {ventsFor(w, h, "back").map((v, i) => <Vent key={i} at={v.at} scale={v.scale} palette={palette} />)}
        {portsOn("back", false)}
      </Panel>
      {/* On the left wall +x is toward the front, on the right toward the back. */}
      <Panel width={d} height={h} position={[-w / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]} shade={WALL_SHADE} palette={palette} state={wallState([-1, 0])}>
        {ventsFor(d, h, "side").map((v, i) => <Vent key={i} at={[-v.at[0], v.at[1], 0]} scale={v.scale} palette={palette} />)}
      </Panel>
      <Panel width={d} height={h} position={[w / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]} shade={WALL_SHADE} palette={palette} state={wallState([1, 0])}>
        {ventsFor(d, h, "side").map((v, i) => <Vent key={i} at={v.at} scale={v.scale} palette={palette} />)}
      </Panel>
      {/* The roof, built like a wall lying down: its +z is up, its y runs from the front to the back. */}
      <Panel
        width={w}
        height={d}
        position={[0, h, d / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        shade={FLAT_SHADE}
        palette={palette}
        state={() => ({ open: roof.current, slice: "none" })}
        bakeKey={used("roof")}
        fixed={portsOn("roof", true)}
      >
        {portsOn("roof", false)}
      </Panel>
      {([1, -1] as const).flatMap((sx) => ([1, -1] as const).map((sz) => (
        <Corner key={`${sx}${sz}`} dims={dims} sx={sx} sz={sz} palette={palette} yaw={yaw} cutaway={cut} />
      )))}
      <Baked version={JSON.stringify(dims)}>
        <Edges dims={dims} palette={palette} />
      </Baked>
    </group>
  );
}

/**
 * Daylight that turns with the camera: a sky-and-ground fill, and a key light
 * over the viewer's shoulder, so every one of the eight views is lit the same
 * way. Shadows come only from the overhead light, which never moves, so a
 * turn redraws the scene once a frame and no shadow map at all.
 */
export function Lights({ dims, yaw, growLight }: {
  dims: EnclosureDimensions;
  yaw: React.RefObject<YawState>;
  /** The grow light's colour when the tent has one; without, the overhead light is plain daylight. */
  growLight: string | undefined;
}) {
  const key = useRef<THREE.DirectionalLight>(null);
  const centre = useMemo(() => new THREE.Vector3(0, dims.heightCm / 2, 0), [dims.heightCm]);

  useFrame(() => {
    const l = key.current;
    if (!l) return;
    l.position.copy(cameraDir(yaw.current.current + KEY_TURN, 1.0).multiplyScalar(2500).add(centre));
    l.target.position.copy(centre);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      <hemisphereLight args={["#ffffff", "#d6cdbf", 1.75]} />
      <directionalLight ref={key} intensity={1.9} color="#fffaf2" />
      <OverheadLight dims={dims} color={growLight ?? "#fffaf2"} intensity={growLight ? 0.9 : 0.6} />
    </>
  );
}

/**
 * One light straight down over the whole footprint, and the only one casting
 * shadows: the grow lights' warm light however many panels hang there, or
 * daylight in a tent without one. It never moves, so its shadow map is redrawn
 * only when what is in the tent changes (any render of this component), not
 * on every frame of a turn; nine panels do not cost nine shadow maps.
 */
function OverheadLight({ dims, color, intensity }: { dims: EnclosureDimensions; color: string; intensity: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const invalidate = useThree((s) => s.invalidate);
  const reach = Math.max(dims.widthCm, dims.depthCm) / 2 + 10;

  useEffect(() => {
    const l = light.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.near = 1;
    cam.far = dims.heightCm + 100;
    cam.updateProjectionMatrix();
    l.shadow.autoUpdate = false;
  }, [reach, dims.heightCm]);

  useEffect(() => {
    if (light.current) light.current.shadow.needsUpdate = true;
    invalidate();
  });

  return (
    <directionalLight
      ref={light}
      // A hair off vertical: straight down leaves the shadow camera no "up".
      position={[0, dims.heightCm + 50, 0.01]}
      color={color}
      intensity={intensity}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.4}
    />
  );
}
