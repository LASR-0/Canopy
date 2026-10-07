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
import { mergeGeometries } from "./bake";
import { fanLeafGeometry } from "./leaf";

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
  // Flower stretches a plant to about 1.4× its height at the end of veg, so
  // the change between the two is growth, not a jump.
  const vegMax = Math.min(85, room * 0.55);
  const flowerMax = Math.min(140, room * 0.78);
  // Veg grows fastest early: most of a plant's veg height is reached by halfway.
  const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;
  let heightCm: number;
  // Spread to height: bushy through veg, narrowing as flower stretches it.
  let shape: number;
  switch (growth.stage) {
    case "seedling":   heightCm = lerp(6, 14, growth.pct); shape = 1.1; break;
    case "vegetative": heightCm = lerp(14, vegMax, easeOut(growth.pct)); shape = 1; break;
    // Most of the stretch comes in the first half of flower.
    case "flowering":  heightCm = lerp(vegMax, flowerMax, growth.pct * 2); shape = lerp(1, 0.85, growth.pct * 2); break;
    case "flush":
    case "harvest":    heightCm = flowerMax; shape = 0.85; break;
    default:           heightCm = vegMax * 0.8; shape = 1;
  }
  const spreadCm = Math.min(heightCm * shape, Math.min(dims.widthCm, dims.depthCm) * 0.85);
  return { heightCm, spreadCm };
}

/**
 * Three finishes for everything in a pot, so a tent of plants bakes into
 * three draws (TentView bakes them together): colour goes into the vertices,
 * only the finish separates draws.
 */
const FOLIAGE = { roughness: 0.7, side: THREE.DoubleSide } as const;
const MATTE = { roughness: 0.95, flatShading: true, side: THREE.DoubleSide } as const;
const FABRIC = { roughness: 0.95, side: THREE.DoubleSide } as const;

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
  // Five teeth a side read as serrated at any size the view draws a plant, at
  // two-thirds the triangles of seven: a full 6 m tent is 36 plants.
  const leafUnit = fanLeafGeometry(1, seedling ? 5 : 7, 5);

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
  // Veg plants are denser, a node every 6 cm, with side shoots up to the top
  // node: the leafy bush flower then stretches.
  const veg = !seedling && !flowering;
  const nodes = seedling ? 2 : veg ? Math.min(12, Math.max(3, Math.round(heightCm / 6))) : Math.min(11, Math.max(3, Math.round(heightCm / 7)));
  const top = new THREE.Vector3(0, heightCm, 0);
  stalk(new THREE.Vector3(0, 0, 0), top, stemR, stemR * 0.35);

  const turn0 = rand() * Math.PI;
  for (let i = 0; i < nodes; i++) {
    const t = nodes === 1 ? 1 : i / (nodes - 1);
    const y = heightCm * (seedling ? 0.55 + 0.35 * t : 0.14 + 0.78 * t);
    const az = turn0 + (i * Math.PI) / 2 + (rand() - 0.5) * 0.4;
    const leafLen = spreadCm * (seedling ? 0.38 : veg ? 0.46 : 0.42) * (1 - 0.45 * t);
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
      if (!seedling && i < nodes - (veg ? 1 : 2) && heightCm > 20) {
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
  const leaf = FOLIAGE;
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
        <meshStandardMaterial color={p.stem} {...MATTE} />
      </mesh>
      {parts.buds && (
        <mesh geometry={parts.buds} castShadow>
          <meshStandardMaterial color={p.bud} {...MATTE} />
        </mesh>
      )}
    </>
  );
}

/** The soil's surface, as a share of the pot's height: just below the rim. */
const SOIL_TOP = 0.93;

/**
 * A fabric pot after the reference: eight soft sides with a slight belly, a
 * rolled rim, a strap handle each side, and the soil mounded toward the stem,
 * with clumps and a few white specks of perlite scattered by the plant's seed.
 */
function FabricPot({ diameterCm, heightCm, seed, p }: { diameterCm: number; heightCm: number; seed: string; p: Palette }) {
  const r = diameterCm / 2;
  const h = heightCm;
  const parts = useMemo(() => {
    // The side's profile, bottom to rim: rounded at the foot, a little fuller at the middle.
    const profile = [
      [0, 0], [r * 0.8, 0], [r * 0.86, h * 0.03], [r * 0.9, h * 0.15],
      [r * 0.96, h * 0.5], [r * 0.985, h * 0.85], [r, h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.LatheGeometry(profile, 8, Math.PI / 8);
    const soil = new THREE.LatheGeometry(
      [[0, h * SOIL_TOP + Math.min(2, r * 0.12)], [r * 0.45, h * SOIL_TOP + Math.min(1, r * 0.06)], [r * 0.93, h * SOIL_TOP - 0.3], [r * 0.93, h * SOIL_TOP - 2]]
        .map(([x, y]) => new THREE.Vector2(x, y)),
      // The pot's eight sides, in step with them, so its edge stays inside the flat faces.
      8,
      Math.PI / 8,
    );
    const rand = random(seed + "soil");
    const bits = (count: number, size: number) => Array.from({ length: count }, () => {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r * 0.8;
      const k = size * (0.6 + rand() * 0.8);
      // Sitting on the mound: higher toward the middle.
      const y = h * SOIL_TOP + Math.min(2, r * 0.12) * (1 - d / r) - k * 0.3;
      return { at: [Math.cos(a) * d, y, Math.sin(a) * d] as [number, number, number], size: k, turn: rand() * 3 };
    });
    const scale = Math.max(0.6, r / 14);
    return { body, soil, clumps: bits(Math.round(10 * scale), 0.9 * scale), perlite: bits(Math.round(8 * scale), 0.45 * scale) };
  }, [r, h, seed]);
  useEffect(() => () => { parts.body.dispose(); parts.soil.dispose(); }, [parts]);

  const rimTube = Math.max(0.8, Math.min(1.6, h * 0.045));
  const handle = Math.max(2.2, r * 0.24);
  return (
    <>
      <mesh geometry={parts.body} castShadow receiveShadow>
        <meshStandardMaterial color={p.pot} {...FABRIC} />
      </mesh>
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, Math.PI / 8]} castShadow>
        <torusGeometry args={[r - rimTube * 0.3, rimTube, 8, 8]} />
        <meshStandardMaterial color={p.potRim} {...FABRIC} />
      </mesh>
      <mesh geometry={parts.soil} receiveShadow>
        <meshStandardMaterial color={p.soil} {...MATTE} />
      </mesh>
      {parts.clumps.map((c, i) => (
        <mesh key={`c${i}`} position={c.at} rotation={[c.turn, c.turn * 2, 0]}>
          <icosahedronGeometry args={[c.size, 0]} />
          <meshStandardMaterial color={p.soilDark} {...MATTE} />
        </mesh>
      ))}
      {parts.perlite.map((c, i) => (
        <mesh key={`p${i}`} position={c.at} rotation={[c.turn, 0, c.turn]}>
          <icosahedronGeometry args={[c.size, 0]} />
          <meshStandardMaterial color={p.perlite} {...MATTE} />
        </mesh>
      ))}
      {/* Strap handles: a loop of webbing sewn on at both ends, standing out from each side. */}
      {[-Math.PI / 2, Math.PI / 2].map((turn) => (
        <group key={turn} rotation={[0, turn, 0]}>
          <mesh position={[0, h * 0.8, -r * 0.93]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[handle, Math.max(0.45, r * 0.035), 4, 10, Math.PI]} />
            <meshStandardMaterial color={p.potRim} {...FABRIC} />
          </mesh>
        </group>
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
      <FabricPot diameterCm={pot.diameterCm} heightCm={pot.heightCm} seed={plant.id} p={palette} />
      <group position={[0, pot.heightCm * SOIL_TOP, 0]}>
        <PlantShape {...size} stage={growth.stage} seed={plant.id} p={palette} />
      </group>
    </group>
  );
}
