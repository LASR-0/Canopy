/**
 * The fan leaf: leaflets spread from one point, longest in the middle. Used
 * full size on the plants, and small and white as the mark on equipment.
 *
 * A leaf lies in its own x–y plane, its stalk at the origin and its middle
 * leaflet pointing up +y, facing +z.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";

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

/** Joins non-indexed copies of simple geometries (positions and normals only). */
export function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const count = flat.reduce((n, g) => n + g.attributes.position!.count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  let offset = 0;
  for (const g of flat) {
    position.set(g.attributes.position!.array as Float32Array, offset * 3);
    normal.set(g.attributes.normal!.array as Float32Array, offset * 3);
    offset += g.attributes.position!.count;
  }
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  return out;
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
