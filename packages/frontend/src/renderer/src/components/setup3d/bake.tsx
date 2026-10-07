/**
 * Merging, because draw calls are what the 3D view runs out of first. On the
 * WSL work machine each one goes through ANGLE to D3D12 and costs far more than
 * its triangles: a 6 m tent of separate parts drew at 25 fps, with the devices
 * (a few hundred small meshes, ~110k triangles) costing more than 36 plants
 * (~480k triangles in a handful of meshes each).
 *
 * `Baked` keeps models written as plain JSX parts, and draws them as one mesh
 * per distinct material.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

/** Joins copies of simple geometries into one (positions and normals only; nothing here is textured). */
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

/** Meshes that can share one draw: everything that shows on screen about their material, and their shadow flags. */
function bucketKey(mesh: THREE.Mesh): string | null {
  const m = mesh.material;
  if (Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial)) return null;
  return [
    m.color.getHex(), m.emissive.getHex(), m.emissiveIntensity, m.roughness, m.metalness,
    m.flatShading, m.side, m.transparent, m.opacity, mesh.castShadow, mesh.receiveShadow,
  ].join("|");
}

/**
 * Draws its children merged: one mesh per distinct material, in place of one
 * per part. The parts stay mounted, hidden, as the source; they are merged
 * again whenever `version` changes, so pass whatever the parts are built from.
 * Anything that is not a plain standard-material mesh is left drawn as it is.
 */
export function Baked({ version, children }: { version: string; children: ReactNode }) {
  const source = useRef<THREE.Group>(null);
  const [baked, setBaked] = useState<THREE.Group | null>(null);

  useLayoutEffect(() => {
    const root = source.current;
    if (!root) return;
    root.updateMatrixWorld(true);
    const toLocal = root.matrixWorld.clone().invert();
    const buckets = new Map<string, { mesh: THREE.Mesh; parts: THREE.BufferGeometry[] }>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const key = bucketKey(mesh);
      if (!key) return;
      const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
      const bucket = buckets.get(key);
      if (bucket) bucket.parts.push(g);
      else buckets.set(key, { mesh, parts: [g] });
      mesh.userData.baked = true;
    });
    const group = new THREE.Group();
    for (const { mesh, parts } of buckets.values()) {
      const merged = new THREE.Mesh(mergeGeometries(parts), mesh.material);
      parts.forEach((p) => p.dispose());
      merged.castShadow = mesh.castShadow;
      merged.receiveShadow = mesh.receiveShadow;
      group.add(merged);
    }
    // Hide what was merged; anything left out keeps drawing from the source.
    root.traverse((o) => { if (o.userData.baked) o.visible = false; });
    setBaked(group);
    return () => {
      root.traverse((o) => {
        if (o.userData.baked) { o.visible = true; delete o.userData.baked; }
      });
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    };
  }, [version]);

  return (
    <>
      <group ref={source}>{children}</group>
      {baked && <primitive object={baked} />}
    </>
  );
}
