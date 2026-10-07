/**
 * The tent, generated from its dimensions, and the lights it is shown under.
 *
 * Fabric panels with charcoal piping on every seam and caps on the corners,
 * over a thin metal frame inside. Every wall is a fabric border around a
 * zipped panel; while a wall faces the camera its panel is unzipped (faded
 * out), so the tent reads as a cutaway from whichever side it is turned to.
 * Only the front's zip is a door, so only the front shows it while closed.
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
const PIPING_CM = 1.25;
const CAP_CM = 4.5;
/** The roof rails sit this far below the roof; hung equipment's cords end there. */
export const RAIL_DROP_CM = 3;
const POLE_CM = 1.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

function disposeOnChange(...things: { dispose(): void }[]) {
  return () => things.forEach((t) => t.dispose());
}

/**
 * One wall, built in its own frame (x across, y up, +z out of the tent) and
 * turned into place. The border is always drawn; the panel inside it, and
 * anything sewn onto it (`children`), fades while the wall faces the camera.
 */
function Wall({ width, height, position, normal, door = false, palette, yaw, children }: {
  width: number;
  height: number;
  position: V3;
  normal: [number, number];
  door?: boolean;
  palette: Palette;
  yaw: React.RefObject<YawState>;
  children?: React.ReactNode;
}) {
  const panel = useRef<THREE.Group>(null);
  const zip = useRef<THREE.MeshStandardMaterial>(null);
  const shown = useRef(1);

  const { border, infill, zipPath } = useMemo(() => {
    const o = opening(width, height);
    const hole = new THREE.Path();
    roundedRect(hole, o.x, o.y, o.w, o.h, o.r);
    const outer = new THREE.Shape();
    outer.moveTo(-width / 2, 0);
    outer.lineTo(width / 2, 0);
    outer.lineTo(width / 2, height);
    outer.lineTo(-width / 2, height);
    outer.lineTo(-width / 2, 0);
    outer.holes.push(hole);
    const border = new THREE.ExtrudeGeometry(outer, { depth: PANEL_CM, bevelEnabled: false, curveSegments: 6 });
    border.translate(0, 0, -PANEL_CM);
    const inner = new THREE.Shape();
    roundedRect(inner, o.x, o.y, o.w, o.h, o.r);
    // Flush with the border on both faces, so a closed wall shows no seam.
    const infill = new THREE.ExtrudeGeometry(inner, { depth: PANEL_CM, bevelEnabled: false, curveSegments: 6 });
    infill.translate(0, 0, -PANEL_CM);
    const pts = hole.getSpacedPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0.15));
    const zipPath = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.1), 128, 0.55, 5, true);
    return { border, infill, zipPath };
  }, [width, height]);
  useEffect(() => disposeOnChange(border, infill, zipPath), [border, infill, zipPath]);

  useFrame((state) => {
    const c = cameraDir(yaw.current.current);
    const facing = normal[0] * c.x + normal[1] * c.z > 0.01;
    const want = facing ? 0 : 1;
    let v = shown.current;
    if (Math.abs(v - want) > 0.01) {
      v += (want - v) * 0.25;
      state.invalidate();
    } else {
      v = want;
    }
    if (v === shown.current && panel.current?.userData.applied === v) return;
    shown.current = v;
    const g = panel.current;
    if (g) {
      g.userData.applied = v;
      g.visible = v > 0.01;
      // Only opacity changes: switching `transparent` would recompile the
      // shaders, a visible stall the first time each wall opens.
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        if (!m.transparent) m.transparent = true;
        m.opacity = v;
        m.depthWrite = v > 0.99;
      });
    }
    // A side's zip only shows while it is open; the door's always does.
    if (zip.current && !door) {
      zip.current.opacity = 1 - v;
      zip.current.visible = v < 0.99;
    }
  });

  return (
    <group position={position} rotation={[0, Math.atan2(normal[0], normal[1]), 0]}>
      <mesh geometry={border} receiveShadow>
        <meshStandardMaterial color={palette.fabric} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={zipPath}>
        <meshStandardMaterial ref={zip} color={palette.zip} roughness={0.6} transparent={!door} />
      </mesh>
      <group ref={panel}>
        <mesh geometry={infill} receiveShadow>
          <meshStandardMaterial color={palette.fabric} roughness={0.95} side={THREE.DoubleSide} transparent />
        </mesh>
        {children}
      </group>
    </group>
  );
}

/** A vent window low on a wall: a framed mesh panel with its flap rolled shut. */
function Vent({ at, palette }: { at: V3; palette: Palette }) {
  return (
    <group position={at}>
      <Box size={[22, 15, 1.2]} at={[0, 0, 0.6]} color={palette.frame} r={1} />
      <Box size={[17, 10, 1]} at={[0, -0.5, 1.2]} color={palette.zip} r={0.6} />
      <Box size={[18, 2.2, 2]} at={[0, 5.2, 1.6]} color={palette.frame} r={0.9} />
    </group>
  );
}

/** Charcoal piping along all twelve seams, and a cap on each corner. */
function Seams({ dims, palette }: { dims: EnclosureDimensions; palette: Palette }) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const pipes: { at: V3; len: number; rotation: V3; r: number }[] = [];
  for (const y of [0, h]) {
    // The floor tray's seam is the heavier one, as on a real tent.
    const r = y === 0 ? PIPING_CM * 1.5 : PIPING_CM;
    const yy = y === 0 ? r : y;
    for (const z of [-d / 2, d / 2]) pipes.push({ at: [0, yy, z], len: w, rotation: ALONG_X, r });
    for (const x of [-w / 2, w / 2]) pipes.push({ at: [x, yy, 0], len: d, rotation: ALONG_Z, r });
  }
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) {
    pipes.push({ at: [x, h / 2, z], len: h, rotation: [0, 0, 0], r: PIPING_CM });
  }
  const caps: V3[] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [CAP_CM / 2, h]) for (const z of [-d / 2, d / 2]) caps.push([x, y, z]);
  return (
    <group>
      {pipes.map((p, i) => <Cyl key={i} r={p.r} h={p.len} at={p.at} rotation={p.rotation} color={palette.frame} seg={10} shadow={false} />)}
      {caps.map((at, i) => <Box key={i} size={[CAP_CM, CAP_CM, CAP_CM]} at={at} color={palette.frame} r={1.6} shadow={false} />)}
    </group>
  );
}

/** The metal frame inside: four uprights and the roof rails the equipment hangs from. */
function Poles({ dims, palette }: { dims: EnclosureDimensions; palette: Palette }) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  const inset = RAIL_DROP_CM;
  const x0 = w / 2 - inset;
  const z0 = d / 2 - inset;
  const top = h - inset;
  return (
    <group>
      {[-x0, x0].flatMap((x) => [-z0, z0].map((z) => (
        <Cyl key={`${x}${z}`} r={POLE_CM} h={top} at={[x, top / 2, z]} color={palette.pole} seg={8} shadow={false} />
      )))}
      {[-z0, z0].map((z) => <Cyl key={`x${z}`} r={POLE_CM} h={w - 2 * inset} at={[0, top, z]} rotation={ALONG_X} color={palette.pole} seg={8} shadow={false} />)}
      {[-x0, x0].map((x) => <Cyl key={`z${x}`} r={POLE_CM} h={d - 2 * inset} at={[x, top, 0]} rotation={ALONG_Z} color={palette.pole} seg={8} shadow={false} />)}
    </group>
  );
}

/** A soft shadow on the ground under the tent, so it stands on something. */
function GroundShadow({ dims }: { dims: EnclosureDimensions }) {
  const pad = 30;
  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const inset = size * (pad / (Math.max(dims.widthCm, dims.depthCm) + 2 * pad));
    ctx.filter = `blur(${Math.round(inset * 0.45)}px)`;
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fillRect(inset, inset, size - 2 * inset, size - 2 * inset);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [dims.widthCm, dims.depthCm]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} renderOrder={-1}>
      <planeGeometry args={[dims.widthCm + 2 * pad, dims.depthCm + 2 * pad]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

export function Tent({ dims, palette, yaw }: { dims: EnclosureDimensions; palette: Palette; yaw: React.RefObject<YawState> }) {
  const { widthCm: w, depthCm: d, heightCm: h } = dims;
  return (
    <group>
      <GroundShadow dims={dims} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={palette.floor} roughness={1} />
      </mesh>
      <mesh position={[0, h - PANEL_CM / 2, 0]} receiveShadow>
        <boxGeometry args={[w, PANEL_CM, d]} />
        <meshStandardMaterial color={palette.fabric} roughness={0.95} />
      </mesh>
      <Wall width={w} height={h} position={[0, 0, d / 2]} normal={[0, 1]} door palette={palette} yaw={yaw} />
      <Wall width={w} height={h} position={[0, 0, -d / 2]} normal={[0, -1]} palette={palette} yaw={yaw} />
      <Wall width={d} height={h} position={[-w / 2, 0, 0]} normal={[-1, 0]} palette={palette} yaw={yaw}>
        {/* +x on the left wall is toward the front. */}
        <Vent at={[d / 2 - 22, Math.min(18, h * 0.15), 0]} palette={palette} />
      </Wall>
      <Wall width={d} height={h} position={[w / 2, 0, 0]} normal={[1, 0]} palette={palette} yaw={yaw} />
      <Baked version={JSON.stringify(dims)}>
        <Seams dims={dims} palette={palette} />
        <Poles dims={dims} palette={palette} />
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
    l.position.copy(cameraDir(yaw.current.current + 0.55, 1.0).multiplyScalar(2500).add(centre));
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
