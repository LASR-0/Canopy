/**
 * Plants in their pots, sized by the active grow's stage.
 *
 * The pot is generated at its real size from `POT_SIZES`. The plant's size
 * follows the stage and how far through it the grow is, so a plant grows
 * through veg and stretches in early flower rather than jumping between three
 * sizes. Its shape is a stand-in: the CC0 plant models replace `PlantShape`,
 * fitted to the same height and spread.
 */
import type { EnclosureDimensions, GrowStageName, Plant } from "@canopy/shared-types";
import { potSize } from "@canopy/shared-types";
import type { Palette } from "./palette";

export interface Growth {
  /** No active grow leaves this undefined, and the plant is drawn mid-veg. */
  stage: GrowStageName | undefined;
  /** 0–1 through the stage. */
  pct: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Height and spread in cm, kept under the light whatever the tent's height. */
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
  return { heightCm, spreadCm: heightCm * (growth.stage === "seedling" ? 0.9 : 0.6) };
}

/** The stand-in shape: a stem with tiers of foliage narrowing to the top. */
function PlantShape({ heightCm, spreadCm, flowering, color }: {
  heightCm: number; spreadCm: number; flowering: boolean; color: string;
}) {
  const tiers = heightCm < 15 ? 1 : Math.min(6, Math.max(2, Math.round(heightCm / 15)));
  return (
    <>
      <mesh position={[0, heightCm / 2, 0]}>
        <cylinderGeometry args={[Math.max(0.4, heightCm * 0.012), Math.max(0.6, heightCm * 0.018), heightCm, 5]} />
        <meshStandardMaterial color={color} flatShading roughness={1} />
      </mesh>
      {Array.from({ length: tiers }, (_, i) => {
        const t = tiers === 1 ? 1 : i / (tiers - 1);
        const r = (spreadCm / 2) * (tiers === 1 ? 1 : 1 - 0.6 * t);
        const y = tiers === 1 ? heightCm * 0.8 : heightCm * (0.3 + 0.62 * t);
        return (
          <mesh key={i} position={[0, y, 0]} scale={[1, 0.45, 1]} rotation={[0, i * 0.9, 0]}>
            <icosahedronGeometry args={[r, 0]} />
            <meshStandardMaterial color={color} flatShading roughness={1} />
          </mesh>
        );
      })}
      {flowering && (
        <mesh position={[0, heightCm, 0]} scale={[1, 1.8, 1]}>
          <icosahedronGeometry args={[Math.max(1.5, spreadCm * 0.09), 0]} />
          <meshStandardMaterial color={color} flatShading roughness={1} />
        </mesh>
      )}
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
  const rim = pot.diameterCm / 2;
  const size = plantSize(growth, dims, pot.heightCm);
  const flowering = growth.stage === "flowering" || growth.stage === "flush" || growth.stage === "harvest";
  return (
    <group position={position}>
      <mesh position={[0, pot.heightCm / 2, 0]}>
        <cylinderGeometry args={[rim, rim * 0.85, pot.heightCm, 12]} />
        <meshStandardMaterial color={palette.pot} flatShading roughness={1} />
      </mesh>
      <group position={[0, pot.heightCm - 1, 0]}>
        <PlantShape {...size} flowering={flowering} color={palette.plant} />
      </group>
    </group>
  );
}
