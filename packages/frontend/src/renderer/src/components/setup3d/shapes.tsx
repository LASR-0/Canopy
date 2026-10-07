/**
 * The few shapes everything in the 3D view is built from. Boxes have rounded
 * edges, which catch the light the way moulded plastic and stitched fabric
 * do; `faceted` keeps a shape's facets flat-shaded, for the deliberately
 * low-poly parts (the octagonal fan housing, the fabric pot).
 */
import { extend, type ThreeElement } from "@react-three/fiber";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

extend({ RoundedBoxGeometry });

declare module "@react-three/fiber" {
  interface ThreeElements {
    roundedBoxGeometry: ThreeElement<typeof RoundedBoxGeometry>;
  }
}

export type V3 = [number, number, number];

export const UPRIGHT: V3 = [0, 0, 0];
export const ALONG_Z: V3 = [Math.PI / 2, 0, 0];
export const ALONG_X: V3 = [0, 0, Math.PI / 2];

export function Mat({ color, faceted = false, emissive, roughness = 0.75 }: {
  color: string; faceted?: boolean; emissive?: string | undefined; roughness?: number | undefined;
}) {
  return (
    <meshStandardMaterial
      color={color}
      flatShading={faceted}
      roughness={roughness}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={emissive ? 1 : 0}
    />
  );
}

/** A box with rounded edges; `r` is the radius, held under half the thinnest side. */
export function Box({ size, at, color, r = 0.8, rotation = UPRIGHT, emissive, roughness, shadow = true }: {
  size: V3; at: V3; color: string; r?: number; rotation?: V3; emissive?: string; roughness?: number; shadow?: boolean;
}) {
  const radius = Math.min(r, Math.min(...size) / 2 - 0.01);
  return (
    <mesh position={at} rotation={rotation} castShadow={shadow} receiveShadow>
      {radius > 0.05
        ? <roundedBoxGeometry args={[size[0], size[1], size[2], 2, radius]} />
        : <boxGeometry args={size} />}
      <Mat color={color} emissive={emissive} roughness={roughness} />
    </mesh>
  );
}

/** A cylinder, upright unless turned onto its side with `rotation`. */
export function Cyl({ r, r2 = r, h, at, color, rotation = UPRIGHT, seg = 16, faceted = false, emissive, shadow = true }: {
  r: number; r2?: number; h: number; at: V3; color: string; rotation?: V3; seg?: number; faceted?: boolean; emissive?: string; shadow?: boolean;
}) {
  return (
    <mesh position={at} rotation={rotation} castShadow={shadow} receiveShadow>
      <cylinderGeometry args={[r, r2, h, seg]} />
      <Mat color={color} faceted={faceted} emissive={emissive} />
    </mesh>
  );
}

/** Cords from `fromY` up to the roof bars, at each [x, z]. */
export function Cords({ at, fromY, toY, color }: { at: [number, number][]; fromY: number; toY: number; color: string }) {
  const length = toY - fromY;
  if (length < 1) return null;
  return (
    <>
      {at.map(([x, z], i) => (
        <Cyl key={i} r={0.3} h={length} at={[x, fromY + length / 2, z]} color={color} seg={5} shadow={false} />
      ))}
    </>
  );
}
