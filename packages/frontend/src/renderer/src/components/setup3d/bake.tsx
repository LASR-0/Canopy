/**
 * Merging, because draw calls are what the 3D view runs out of first. On the
 * WSL work machine each one goes through ANGLE to D3D12 and costs far more than
 * its triangles: a 6 m tent of separate parts drew at 25 fps, with the devices
 * (a few hundred small meshes, ~110k triangles) costing more than 36 plants
 * (~480k triangles in a handful of meshes each).
 *
 * `Baked` keeps models written as plain JSX parts, and draws them as one mesh
 * per distinct finish, with each part's colour in its vertices.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

/**
 * Joins copies of simple geometries into one (positions and normals; nothing
 * here is textured). With `colors`, one per part, each part's colour is
 * written into its vertices.
 */
export function mergeGeometries(parts: THREE.BufferGeometry[], colors?: THREE.Color[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const count = flat.reduce((n, g) => n + g.attributes.position!.count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = colors ? new Float32Array(count * 3) : null;
  let offset = 0;
  flat.forEach((g, i) => {
    const n = g.attributes.position!.count;
    position.set(g.attributes.position!.array as Float32Array, offset * 3);
    normal.set(g.attributes.normal!.array as Float32Array, offset * 3);
    if (color) {
      const c = colors![i]!;
      for (let v = offset; v < offset + n; v++) color.set([c.r, c.g, c.b], v * 3);
    }
    offset += n;
  });
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  if (color) out.setAttribute("color", new THREE.BufferAttribute(color, 3));
  return out;
}

/**
 * Meshes that can share one draw: the same finish and shadow flags. Colour is
 * not part of it; it goes into the vertices.
 */
function bucketKey(mesh: THREE.Mesh): string | null {
  const m = mesh.material;
  if (Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial) || m.map || m.vertexColors) return null;
  return [
    m.emissive.getHex(), m.emissiveIntensity, m.roughness, m.metalness,
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
    const buckets = new Map<string, { mesh: THREE.Mesh; parts: THREE.BufferGeometry[]; colors: THREE.Color[] }>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const key = bucketKey(mesh);
      if (!key) return;
      const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
      const bucket = buckets.get(key);
      const color = (mesh.material as THREE.MeshStandardMaterial).color;
      if (bucket) { bucket.parts.push(g); bucket.colors.push(color); }
      else buckets.set(key, { mesh, parts: [g], colors: [color] });
      mesh.userData.baked = true;
    });
    const group = new THREE.Group();
    for (const { mesh, parts, colors } of buckets.values()) {
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      material.vertexColors = true;
      material.color.set(0xffffff);
      const merged = new THREE.Mesh(mergeGeometries(parts, colors), material);
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
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
    };
  }, [version]);

  return (
    <>
      <group ref={source}>{children}</group>
      {baked && <primitive object={baked} />}
    </>
  );
}
