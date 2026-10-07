/**
 * Plants in their pots, sized by the active grow's stage.
 *
 * The pot is a fabric pot at its real size from `POT_SIZES`. The plant is
 * generated: a stem with pairs of serrated fan leaves at each node, each pair
 * turned a quarter from the last, side shoots below the top, and buds once it
 * flowers. Its size follows the stage and how far through it the grow is, so
 * a plant grows through veg and stretches in early flower rather than jumping
 * between three sizes. Each plant varies a little, seeded by its id, so a tent
 * of them does not look stamped out.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { EnclosureDimensions, GrowStageName, Plant } from "@canopy/shared-types";
import { potSize } from "@canopy/shared-types";
import type { Palette } from "./palette";
import { fanLeafGeometry, mergeGeometries } from "./leaf";
import { Box, Cyl } from "./shapes";

export interface Growth {
  /** No active grow leaves this undefined, and the plant is drawn mid-veg. */
  stage: GrowStageName | undefined;
  /** 0–1 through the stage. */
  pct: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Height and spread in cm, kept under the light and inside the walls whatever the tent's size. */
export function plantSize(growth: Growth, dims: EnclosureDimensions, potHeightCm: number) {
  const room = Math.max(20, dims.heightCm - potHeightCm - 25);
  const vegMax = Math.min(70, room * 0.45);
  const flowerMax = Math.min(130, room * 0.7);
  let heightCm: number;
  switch (growth.stage) {
    case "seedling":   heightCm = lerp(6, 14, growth.pct); break;
    case "vegetative": heightCm = lerp(14, vegMax, growth.pct); break;
    // Most of the stretch comes in the first half of flower.
    case "flowering":  heightCm = lerp(vegMax, flowerMax, growth.pct * 2); break;
    case "flush":
    case "harvest":    heightCm = flowerMax; break;
    default:           heightCm = vegMax * 0.7;
  }
  const spreadCm = Math.min(heightCm * (growth.stage === "seedling" ? 1.1 : 0.85), Math.min(dims.widthCm, dims.depthCm) * 0.85);
  return { heightCm, spreadCm };
}

/** A small seeded generator, so a plant looks the same every time it is drawn. */
function random(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

interface PlantParts {
  /** Fan leaves, split between two greens so the canopy is not one flat colour. */
  leaves: THREE.BufferGeometry;
  leavesDark: THREE.BufferGeometry;
  /** Lower leaves yellowing in flush. */
  leavesOld: THREE.BufferGeometry | null;
  /** Stems, side shoots and leaf stalks. */
  stems: THREE.BufferGeometry;
  buds: THREE.BufferGeometry | null;
}

/** Builds one plant's geometry, merged by material so a plant is a handful of draw calls. */
function buildPlant(heightCm: number, spreadCm: number, stage: GrowStageName | undefined, seed: string): PlantParts {
  const rand = random(seed);
  const seedling = stage === "seedling";
  const flowering = stage === "flowering" || stage === "flush" || stage === "harvest";
  const late = stage === "flush" || stage === "harvest";
  const leafUnit = fanLeafGeometry(1, seedling ? 5 : 7, 7);

  const leaves: THREE.BufferGeometry[] = [];
  const leavesDark: THREE.BufferGeometry[] = [];
  const leavesOld: THREE.BufferGeometry[] = [];
  const stems: THREE.BufferGeometry[] = [];
  const buds: THREE.BufferGeometry[] = [];
  const o = new THREE.Object3D();

  /** A fan leaf at `base`, pointing out along azimuth `az`, raised by `tilt`. */
  const leaf = (base: THREE.Vector3, az: number, tilt: number, length: number, into: THREE.BufferGeometry[]) => {
    o.position.copy(base);
    o.rotation.set(0, az, 0, "YXZ");
    o.rotateX(-Math.PI / 2 + tilt);
    o.scale.setScalar(length);
    o.updateMatrix();
    into.push(leafUnit.clone().applyMatrix4(o.matrix));
  };
  /** A tapered stalk from `a` to `b`. */
  const stalk = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number) => {
    const len = a.distanceTo(b);
    if (len < 0.05) return;
    const g = new THREE.CylinderGeometry(r1, r0, len, 5);
    o.position.copy(a).add(b).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    o.scale.setScalar(1);
    o.updateMatrix();
    stems.push(g.applyMatrix4(o.matrix));
  };
  /** A bud: a cluster of rough lumps, `size` across, elongated upward. */
  const bud = (at: THREE.Vector3, size: number) => {
    for (let i = 0; i < 4; i++) {
      const g = new THREE.IcosahedronGeometry(size * (0.5 - i * 0.07), 0);
      g.scale(1, 1.3, 1);
      g.translate(at.x + (rand() - 0.5) * size * 0.3, at.y + i * size * 0.38, at.z + (rand() - 0.5) * size * 0.3);
      buds.push(g);
    }
  };

  const stemR = Math.max(0.35, heightCm * 0.012);
  const nodes = seedling ? 2 : Math.min(11, Math.max(3, Math.round(heightCm / 7)));
  const top = new THREE.Vector3(0, heightCm, 0);
  stalk(new THREE.Vector3(0, 0, 0), top, stemR, stemR * 0.35);

  const turn0 = rand() * Math.PI;
  for (let i = 0; i < nodes; i++) {
    const t = nodes === 1 ? 1 : i / (nodes - 1);
    const y = heightCm * (seedling ? 0.55 + 0.35 * t : 0.14 + 0.78 * t);
    const az = turn0 + (i * Math.PI) / 2 + (rand() - 0.5) * 0.4;
    const leafLen = spreadCm * (seedling ? 0.38 : 0.42) * (1 - 0.45 * t);
    const reach = spreadCm * (seedling ? 0.05 : 0.17) * (1 - 0.55 * t);
    // Lower leaves droop; upper ones reach for the light.
    const tilt = lerp(-0.15, 0.6, t) + (rand() - 0.5) * 0.2;
    for (const side of [0, Math.PI]) {
      const a = az + side;
      const dir = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
      const node = new THREE.Vector3(0, y, 0);
      const tip = node.clone().addScaledVector(dir, reach).add(new THREE.Vector3(0, reach * 0.35, 0));
      stalk(node, tip, stemR * 0.35, stemR * 0.2);
      const into = late && i < 2 ? leavesOld : (i + (side ? 1 : 0)) % 2 ? leavesDark : leaves;
      leaf(tip, a, tilt, leafLen, into);

      // Side shoots from the lower nodes, a quarter turn round, each with a small leaf and, in flower, a bud.
      if (!seedling && i < nodes - 2 && heightCm > 25) {
        const b = a + Math.PI / 2;
        const bdir = new THREE.Vector3(-Math.sin(b), 0, -Math.cos(b));
        const len = spreadCm * 0.3 * (1 - 0.5 * t);
        const end = node.clone().addScaledVector(bdir, len).add(new THREE.Vector3(0, len * 0.9, 0));
        const mid = node.clone().lerp(end, 0.5);
        stalk(node, end, stemR * 0.45, stemR * 0.25);
        leaf(end, b, 0.8, leafLen * 0.6, (i % 2 ? leaves : leavesDark));
        leaf(mid, b - 0.9, 0.2, leafLen * 0.7, (i % 2 ? leavesDark : leaves));
        leaf(mid, b + 0.9, 0.2, leafLen * 0.7, (i % 2 ? leaves : leavesDark));
        if (flowering) bud(end, spreadCm * 0.07 * (late ? 1.3 : 1));
      }
    }
  }
  // The crown: small leaves gathered at the top, and the main cola once it flowers.
  for (let k = 0; k < 4; k++) {
    leaf(top, turn0 + (k * Math.PI) / 2, 1.0, spreadCm * (seedling ? 0.22 : 0.16), k % 2 ? leaves : leavesDark);
  }
  if (flowering) bud(top.clone().add(new THREE.Vector3(0, -heightCm * 0.04, 0)), spreadCm * 0.13 * (late ? 1.3 : 1));

  const merge = (parts: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return g;
  };
  leafUnit.dispose();
  return {
    leaves: merge(leaves),
    leavesDark: merge(leavesDark),
    leavesOld: leavesOld.length ? merge(leavesOld) : null,
    stems: merge(stems),
    buds: buds.length ? merge(buds) : null,
  };
}

function PlantShape({ heightCm, spreadCm, stage, seed, p }: {
  heightCm: number; spreadCm: number; stage: GrowStageName | undefined; seed: string; p: Palette;
}) {
  // Rebuilt in 1 cm steps, not on every fraction of a day.
  const h = Math.round(heightCm);
  const s = Math.round(spreadCm);
  const parts = useMemo(() => buildPlant(h, s, stage, seed), [h, s, stage, seed]);
  useEffect(() => () => {
    for (const g of Object.values(parts)) g?.dispose();
  }, [parts]);
  const leaf = { roughness: 0.7, side: THREE.DoubleSide } as const;
  return (
    <>
      <mesh geometry={parts.leaves} castShadow receiveShadow>
        <meshStandardMaterial color={p.leaf} {...leaf} />
      </mesh>
      <mesh geometry={parts.leavesDark} castShadow receiveShadow>
        <meshStandardMaterial color={p.leafDark} {...leaf} />
      </mesh>
      {parts.leavesOld && (
        <mesh geometry={parts.leavesOld} castShadow receiveShadow>
          <meshStandardMaterial color={p.leafOld} {...leaf} />
        </mesh>
      )}
      <mesh geometry={parts.stems} castShadow>
        <meshStandardMaterial color={p.stem} roughness={0.8} flatShading />
      </mesh>
      {parts.buds && (
        <mesh geometry={parts.buds} castShadow>
          <meshStandardMaterial color={p.bud} roughness={0.9} flatShading />
        </mesh>
      )}
    </>
  );
}

/** A fabric pot: eight soft sides, a stitched rim, a handle each side and the soil showing. */
function FabricPot({ diameterCm, heightCm, p }: { diameterCm: number; heightCm: number; p: Palette }) {
  const r = diameterCm / 2;
  return (
    <>
      <Cyl r={r} r2={r * 0.9} h={heightCm} at={[0, heightCm / 2, 0]} color={p.pot} seg={8} faceted />
      <Cyl r={r * 1.015} h={Math.max(1, heightCm * 0.06)} at={[0, heightCm - heightCm * 0.03, 0]} color={p.potRim} seg={8} faceted />
      <Cyl r={r * 0.94} h={0.6} at={[0, heightCm * 0.94, 0]} color={p.soil} seg={8} faceted />
      {[1, -1].map((side) => (
        <Box key={side} size={[1.2, heightCm * 0.18, r * 0.5]} at={[side * r * 1.0, heightCm * 0.82, 0]} color={p.potRim} r={0.5} />
      ))}
    </>
  );
}

export function PlantInPot({ plant, dims, growth, palette, position }: {
  plant: Plant;
  dims: EnclosureDimensions;
  growth: Growth;
  palette: Palette;
  position: [number, number, number];
}) {
  const pot = potSize(plant.potLitres) ?? { diameterCm: 25, heightCm: 22 };
  const size = plantSize(growth, dims, pot.heightCm);
  return (
    <group position={position}>
      <FabricPot diameterCm={pot.diameterCm} heightCm={pot.heightCm} p={palette} />
      <group position={[0, pot.heightCm * 0.94, 0]}>
        <PlantShape {...size} stage={growth.stage} seed={plant.id} p={palette} />
      </group>
    </group>
  );
}
