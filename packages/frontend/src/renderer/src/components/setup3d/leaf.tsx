/**
 * The fan leaf: leaflets spread from one point, longest in the middle. Used
 * full size on the plants, and small and white as the mark on equipment.
 *
 * A leaf lies in its own x–y plane, its stalk at the origin and its middle
 * leaflet pointing up +y, facing +z.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "./bake";

/**
 * One leaflet: a long pointed blade, widest a third of the way up. Serrated
 * edges (`teeth` per side) read as a cannabis leaf at plant size; the mark
 * leaves them out.
 */
export function leafletShape(length: number, width: number, teeth = 0): THREE.Shape {
  const half = width / 2;
  const s = new THREE.Shape();
  // Half-width along the blade, 0 at both ends.
  const at = (t: number) => half * Math.sin(Math.PI * Math.pow(t, 0.75));
  const steps = Math.max(8, teeth * 2);
  s.moveTo(0, 0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const out = teeth && i % 2 === 1 && i < steps ? 1.25 : 1;
    s.lineTo(at(t) * out, t * length);
  }
  for (let i = steps - 1; i >= 1; i--) {
    const t = i / steps;
    const out = teeth && i % 2 === 1 ? 1.25 : 1;
    s.lineTo(-at(t) * out, t * length);
  }
  s.lineTo(0, 0);
  return s;
}

/** The leaflets of a fan leaf of `count` (odd), as length scale and angle from the middle. */
function leaflets(count: number) {
  const out: { scale: number; angle: number }[] = [{ scale: 1, angle: 0 }];
  const side = (count - 1) / 2;
  for (let i = 1; i <= side; i++) {
    const scale = 1 - (0.55 * i) / side;
    const angle = (i / side) * 1.35;
    out.push({ scale, angle }, { scale, angle: -angle });
  }
  return out;
}

/** A fan leaf `length` long (the middle leaflet), as one geometry. */
export function fanLeafGeometry(length: number, count = 7, teeth = 0): THREE.BufferGeometry {
  const parts = leaflets(count).map(({ scale, angle }) => {
    const g = new THREE.ShapeGeometry(leafletShape(length * scale, length * scale * 0.2, teeth));
    g.rotateZ(angle);
    return g;
  });
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * One leaflet of a plant's fan leaf, `length` long and `width` across at its
 * widest: folded up along the midrib into a shallow V (`fold`, as a share of
 * the half-width) and arching down toward the tip (`droop`, as a share of
 * its length), with `teeth` serrations a side. Flat-shaded, the two halves
 * of the fold catch the light differently, as in the reference, and the
 * leaf keeps its body seen edge-on.
 */
function leafletGeometry(length: number, width: number, teeth: number, fold: number, droop: number): THREE.BufferGeometry {
  const steps = Math.max(4, teeth * 2);
  const position: number[] = [];
  const mid: THREE.Vector3[] = [];
  const edge: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * length;
    const z = -droop * length * t * t;
    const serrate = i % 2 === 1 && i < steps ? 1.24 : 1;
    const half = (width / 2) * Math.sin(Math.PI * Math.pow(t, 0.75)) * serrate;
    mid.push(new THREE.Vector3(0, y, z));
    // A tooth points forward along the blade, as a cannabis leaflet's do.
    edge.push(new THREE.Vector3(half, y + (serrate > 1 ? length * 0.02 : 0), z + fold * half));
  }
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => position.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const mirror = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
  for (let i = 0; i < steps; i++) {
    tri(mid[i]!, edge[i]!, edge[i + 1]!);
    tri(mid[i]!, edge[i + 1]!, mid[i + 1]!);
    tri(mid[i]!, mirror(edge[i + 1]!), mirror(edge[i]!));
    tri(mid[i]!, mid[i + 1]!, mirror(edge[i + 1]!));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A plant's fan leaf, one unit long (its middle leaflet), as one geometry:
 * `count` folded, arching leaflets (odd) fanned from the stalk, the outer
 * ones shorter and swept back. Lies in the x–y plane, middle leaflet up +y,
 * its top face +z; plants scale and turn it into place.
 */
export function plantLeafGeometry(count: number, teeth = 4): THREE.BufferGeometry {
  const side = (count - 1) / 2;
  const sweep = count >= 9 ? 1.6 : count >= 7 ? 1.45 : 1.2;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = -side; i <= side; i++) {
    const k = side ? Math.abs(i) / side : 0;
    const length = 1 - 0.62 * Math.pow(k, 1.3);
    const g = leafletGeometry(length, length * 0.27, teeth, 0.5, 0.16 + 0.1 * k);
    g.rotateZ((-i / (side || 1)) * sweep);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** The mark on equipment: a small white five-leaflet leaf, facing +z. */
export function LeafMark({ size, at, rotation = [0, 0, 0], color = "#ffffff" }: {
  size: number; at: [number, number, number]; rotation?: [number, number, number]; color?: string;
}) {
  const geometry = useMemo(() => {
    const g = fanLeafGeometry(size * 0.6, 5);
    g.translate(0, -size * 0.3, 0);
    return g;
  }, [size]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={at} rotation={rotation}>
      <meshStandardMaterial color={color} roughness={0.6} side={THREE.DoubleSide} />
    </mesh>
  );
}
