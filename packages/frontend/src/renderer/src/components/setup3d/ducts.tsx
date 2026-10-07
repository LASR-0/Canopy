/**
 * Inline fans' ducting, routed through the tent.
 *
 * The tent has duct ports (`ductPorts` in tent.tsx): the roof's, and one or
 * two high on the back wall. Fans are given ports exhausts first, then
 * intakes, each to the nearest port still free, roof or wall. A port in use
 * stays drawn when its panel opens, so a duct never ends in the air. A fan with a port is
 * turned to face it, and its duct bends from the fan's collar into the port
 * and out a little way beyond. A fan left without one (more fans than ports)
 * keeps the way it was placed, and its duct runs straight to the wall it
 * points at, through a collar of its own there.
 *
 * Ducts are drawn in the scene's own frame, not the fan's, since one end is
 * on the tent.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Palette } from "./palette";
import type { V3 } from "./shapes";

/** A fan's duct: from its collar, leaving along `dir`, to `end` on a wall or the roof, leaving the tent along `normal`. */
export interface DuctRoute {
  start: V3;
  dir: V3;
  end: V3;
  normal: V3;
  /** The tent port it goes through; none for a fan that found no free port. */
  port: string | undefined;
}

/** Duct radius: 6" ducting. */
const DUCT_R = 7.6;
/** Rib pitch of flexible ducting. */
const PITCH = 2.4;
/** How far the duct runs on outside the tent. */
const OUTSIDE_CM = 14;

const v = (a: V3) => new THREE.Vector3(...a);

/** The duct's centre line: a smooth bend from the collar into the wall, then straight out. */
function ductCurve(route: DuctRoute): THREE.CurvePath<THREE.Vector3> {
  const start = v(route.start);
  const end = v(route.end);
  const dir = v(route.dir).normalize();
  const normal = v(route.normal).normalize();
  const reach = Math.min(80, Math.max(8, start.distanceTo(end) * 0.45));
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.CubicBezierCurve3(
    start,
    start.clone().addScaledVector(dir, reach),
    end.clone().addScaledVector(normal, -reach),
    end,
  ));
  path.add(new THREE.LineCurve3(end, end.clone().addScaledVector(normal, OUTSIDE_CM)));
  return path;
}

/**
 * Flexible ducting along a curve: a tube whose radius swells and narrows with
 * the ribs, as one geometry however long it is.
 */
function ribbedTube(curve: THREE.Curve<THREE.Vector3>, radius: number): THREE.BufferGeometry {
  const length = curve.getLength();
  const rings = Math.min(1200, Math.max(8, Math.ceil(length / (PITCH / 4))));
  const radial = 14;
  const frames = curve.computeFrenetFrames(rings, false);
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    curve.getPointAt(u, p);
    const r = radius * (1 + 0.06 * Math.cos((2 * Math.PI * u * length) / PITCH));
    const n = frames.normals[i]!;
    const b = frames.binormals[i]!;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      d.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      position.push(p.x + d.x * r, p.y + d.y * r, p.z + d.z * r);
      normal.push(d.x, d.y, d.z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  return g;
}

function Duct({ route, p }: { route: DuctRoute; p: Palette }) {
  // Keyed by value: the plan is rebuilt whenever Setup View re-renders.
  const key = JSON.stringify(route);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => ribbedTube(ductCurve(route), DUCT_R), [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Without a tent port, the duct goes through a collar of its own in the wall.
  const collar = useMemo(() => {
    if (route.port) return null;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), v(route.normal).normalize());
    return new THREE.Euler().setFromQuaternion(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={p.duct} roughness={0.45} metalness={0.15} />
      </mesh>
      {collar && (
        <mesh position={route.end} rotation={collar}>
          <torusGeometry args={[DUCT_R + 1.4, 1.3, 8, 24]} />
          <meshStandardMaterial color={p.frame} roughness={0.7} />
        </mesh>
      )}
    </>
  );
}

export function Ducts({ routes, p }: { routes: DuctRoute[]; p: Palette }) {
  return (
    <>
      {routes.map((r, i) => <Duct key={`${r.port ?? "wall"}${i}`} route={r} p={p} />)}
    </>
  );
}
