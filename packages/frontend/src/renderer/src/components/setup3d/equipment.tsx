/**
 * Devices, generated from simple shapes at their real size. Grow equipment is
 * missing from the CC0 packs, and an inline fan or an LED panel is a few
 * rounded boxes and cylinders anyway.
 *
 * One style throughout, after the design reference: dark moulded housings for
 * fans and the light, white for appliances, blue for the small sensors, and
 * the leaf mark on the front of anything that would carry a logo.
 *
 * Each model is drawn in its own frame: the origin at the middle of its base,
 * y up, and +z the way it faces (`rotationDeg` turns it in the tent).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { EnclosureDimensions } from "@canopy/shared-types";
import type { ModelKind } from "./models";
import type { Palette } from "./palette";
import { LeafMark, mergeGeometries } from "./leaf";
import { Box, Cords, Cyl, ALONG_X, ALONG_Z, type V3 } from "./shapes";

export interface Duct {
  /** From the fan's collar to the wall it leaves through, in cm. */
  lengthCm: number;
  /** +1 out of the fan's face (exhaust), -1 out of its back (intake). */
  dir: 1 | -1;
}

interface ModelProps {
  p: Palette;
  dims: EnclosureDimensions;
  /** The roof rails' height in the model's frame, for anything hung on cords. */
  roofY: number;
  /** Inline fans only: the duct to the nearest wall. */
  duct?: Duct | undefined;
}

/** An LCD panel facing +z, left blank: the view shows the setup, not its readings. */
function Screen({ size, at, p }: { size: [number, number]; at: V3; p: Palette }) {
  return (
    <mesh position={at}>
      <planeGeometry args={size} />
      <meshStandardMaterial color={p.screen} roughness={0.35} />
    </mesh>
  );
}

/**
 * Flexible ducting along +z from `from`, `length` long: alternating ribs, with
 * the tent's port collar where it passes through the wall and a short run
 * outside it.
 */
function Ducting({ from, length, radius, p }: { from: number; length: number; radius: number; p: Palette }) {
  const outside = 14;
  const total = length + outside;
  const pitch = 2.4;
  // Merged into one geometry per material: a long duct is a hundred ribs.
  const geometry = useMemo(() => {
    const ribs = Math.max(1, Math.floor(total / pitch));
    const ringParts: THREE.BufferGeometry[] = [];
    const troughParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < ribs; i++) {
      const z = from + (i + 0.5) * (total / ribs);
      ringParts.push(new THREE.CylinderGeometry(radius, radius, pitch * 0.55, 14).rotateX(Math.PI / 2).translate(0, 0, z - pitch * 0.2));
      troughParts.push(new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, pitch * 0.45, 14).rotateX(Math.PI / 2).translate(0, 0, z + pitch * 0.3));
    }
    const ring = mergeGeometries(ringParts);
    const trough = mergeGeometries(troughParts);
    [...ringParts, ...troughParts].forEach((g) => g.dispose());
    return { ring, trough };
  }, [from, total, radius]);
  useEffect(() => () => { geometry.ring.dispose(); geometry.trough.dispose(); }, [geometry]);
  return (
    <group>
      <mesh geometry={geometry.ring} castShadow receiveShadow>
        <meshStandardMaterial color={p.duct} roughness={0.5} metalness={0.15} />
      </mesh>
      <mesh geometry={geometry.trough} receiveShadow>
        <meshStandardMaterial color={p.applianceTrim} roughness={0.6} />
      </mesh>
      <Cyl r={radius + 2} h={5} at={[0, 0, from + length]} rotation={ALONG_Z} color={p.frame} seg={16} />
    </group>
  );
}

/**
 * A 6" inline duct fan: an octagonal moulded body between two round collars,
 * on two straps, with its ducting to the nearest wall.
 */
function InlineFan({ p, roofY, duct }: ModelProps) {
  const c = 12.5;
  return (
    <>
      <group position={[0, c, 0]}>
        <Cyl r={12} h={18} at={[0, 0, 0]} rotation={[Math.PI / 2, Math.PI / 8, 0]} color={p.housing} seg={8} faceted />
        <Cyl r={8.6} h={5} at={[0, 0, -11.5]} rotation={ALONG_Z} color={p.housingDark} seg={18} />
        <Cyl r={8.6} h={5} at={[0, 0, 11.5]} rotation={ALONG_Z} color={p.housingDark} seg={18} />
        <LeafMark size={7} at={[11.2, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
        <LeafMark size={7} at={[-11.2, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
        {duct && duct.lengthCm > 1 && (
          <group rotation={[0, duct.dir === 1 ? 0 : Math.PI, 0]}>
            <Ducting from={14} length={duct.lengthCm} radius={7.6} p={p} />
          </group>
        )}
      </group>
      <Box size={[4, 1.6, 20]} at={[0, 25, 0]} color={p.housingDark} r={0.6} />
      <Cords at={[[0, -8], [0, 8]]} fromY={25.8} toY={roofY} color={p.cord} />
    </>
  );
}

/** A clip-on circulation fan: clamp and neck, and an octagonal head with its blades facing +z. */
function ClipFan({ p }: ModelProps) {
  const blades = 5;
  return (
    <>
      <Box size={[5, 6, 5]} at={[0, 3, -1]} color={p.housingDark} r={1} />
      <Cyl r={0.9} h={8} at={[0, 10, -1]} color={p.housingDark} seg={8} />
      <group position={[0, 22, 0]}>
        <mesh rotation={[0, 0, Math.PI / 8]} castShadow receiveShadow>
          <torusGeometry args={[10, 1.8, 6, 8]} />
          <meshStandardMaterial color={p.housing} roughness={0.7} flatShading />
        </mesh>
        <Cyl r={10} h={1} at={[0, 0, -1.6]} rotation={ALONG_Z} color={p.housingDark} seg={8} faceted />
        <Cyl r={4.5} h={5} at={[0, 0, -4]} rotation={ALONG_Z} color={p.housing} seg={14} />
        <Cyl r={2.4} h={2.6} at={[0, 0, 0.2]} rotation={ALONG_Z} color={p.housing} seg={12} />
        {Array.from({ length: blades }, (_, i) => (
          <group key={i} rotation={[0, 0, (i * 2 * Math.PI) / blades]}>
            <Box size={[3.4, 6.6, 0.4]} at={[0, 5, 0]} rotation={[0, 0.45, 0]} color={p.housingDark} r={0.15} />
          </group>
        ))}
      </group>
    </>
  );
}

/**
 * An LED panel light, sized to the tent as growers size theirs: about 70 % of
 * the width, between 40 and 110 cm across and inside the walls. Its base is the emitting face, so
 * the mounting height is the light's height above the floor. The face glows,
 * and casts a warm, shadowed light down onto the canopy.
 */
function LedLight({ p, dims, roofY }: ModelProps) {
  const across = Math.min(dims.widthCm, dims.depthCm);
  // Never wider than the tent leaves room for, however small it is.
  const s = Math.min(110, across - 8, Math.max(40, across * 0.7));
  const depth = s * 0.55;
  const target = useMemo(() => new THREE.Object3D(), []);
  const spread = Math.atan2(Math.max(dims.widthCm, dims.depthCm) * 0.6, Math.max(40, roofY + 40));
  const hang: [number, number][] = [[-s / 2 + 4, 0], [s / 2 - 4, 0]];
  return (
    <>
      <Box size={[s - 1, 1.8, depth - 1]} at={[0, 0.9, 0]} color={p.led} emissive={p.led} r={0.6} shadow={false} />
      <Box size={[s, 2.4, depth]} at={[0, 2.2, 0]} color={p.housing} r={1} />
      <Box size={[s - 6, 1.2, depth - 6]} at={[0, 3.6, 0]} color={p.housingDark} r={0.5} />
      <Box size={[s * 0.28, 2.6, depth * 0.4]} at={[0, 5.2, 0]} color={p.housingDark} r={0.8} />
      {/* Two hangers, each a V of cord up to a ratchet below the rail. */}
      {hang.map(([x], i) => (
        <group key={i}>
          <Cyl r={0.3} h={Math.hypot(depth / 4, 9)} at={[x, 8.5, -depth / 8]} rotation={[-Math.atan2(depth / 4, 9), 0, 0]} color={p.cord} seg={5} shadow={false} />
          <Cyl r={0.3} h={Math.hypot(depth / 4, 9)} at={[x, 8.5, depth / 8]} rotation={[Math.atan2(depth / 4, 9), 0, 0]} color={p.cord} seg={5} shadow={false} />
          <Box size={[1.6, 3, 1.2]} at={[x, 14.5, 0]} color={p.housingDark} r={0.4} />
        </group>
      ))}
      <Cords at={hang} fromY={16} toY={roofY} color={p.cord} />
      <primitive object={target} position={[0, -100, 0]} />
      <spotLight
        position={[0, -0.5, 0]}
        target={target}
        color={p.led}
        intensity={1.3}
        decay={0}
        angle={Math.min(1.2, spread + 0.25)}
        penumbra={0.9}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.4}
      />
    </>
  );
}

/** A temperature and humidity sensor: a white square with its display, hung at canopy height. */
function Sensor({ p, roofY }: ModelProps) {
  return (
    <>
      <Box size={[7.5, 7.5, 2.4]} at={[0, 3.75, 0]} color={p.appliance} r={1.2} />
      <Screen size={[5.6, 4.6]} at={[0, 4.1, 1.21]} p={p} />
      <Cyl r={0.3} h={6} at={[1.8, -3, 0]} color={p.cord} seg={5} shadow={false} />
      <Cords at={[[0, 0]]} fromY={7.5} toY={roofY} color={p.cord} />
    </>
  );
}

/** A light sensor: a white puck with its diffuser dome facing up. */
function LightSensor({ p, roofY }: ModelProps) {
  return (
    <>
      <Cyl r={3.2} h={2} at={[0, 1, 0]} color={p.appliance} seg={18} />
      <mesh position={[0, 2, 0]} castShadow>
        <sphereGeometry args={[2.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#ffffff" roughness={0.2} transparent opacity={0.85} />
      </mesh>
      <Cords at={[[2.6, 0]]} fromY={2} toY={roofY} color={p.cord} />
    </>
  );
}

/** A CO₂ monitor: white, its display facing +z. */
function Co2Sensor({ p, roofY }: ModelProps) {
  return (
    <>
      <Box size={[8, 12, 3.4]} at={[0, 6, 0]} color={p.appliance} r={1.4} />
      <Screen size={[6, 4.4]} at={[0, 8, 1.71]} p={p} />
      {[-2, 0, 2].map((x) => <Box key={x} size={[1, 1, 0.3]} at={[x, 3, 1.72]} color={p.applianceTrim} r={0.2} />)}
      <Cords at={[[0, 0]]} fromY={12} toY={roofY} color={p.cord} />
    </>
  );
}

/** A soil-moisture sensor: a metal stake in the medium under a blue head with the mark. */
function SoilProbe({ p }: ModelProps) {
  return (
    <>
      <Box size={[2.2, 12, 0.5]} at={[0, 6, 0]} color={p.metal} r={0.2} />
      <Box size={[4.6, 8, 2.6]} at={[0, 16, 0]} color={p.sensor} r={1} />
      <LeafMark size={2.6} at={[0, 17.2, 1.32]} />
      <Cyl r={0.3} h={5} at={[-1, 11, 0]} color={p.cord} seg={5} />
      <Cyl r={0.3} h={5} at={[1, 11, 0]} color={p.cord} seg={5} />
    </>
  );
}

/** A reservoir meter: a blue controller with its display, and its pen probe beside it. */
function ResProbe({ p }: ModelProps) {
  return (
    <>
      <Box size={[8, 12, 3.4]} at={[-3, 6, 0]} color={p.sensor} r={1.2} />
      <Screen size={[6, 3.4]} at={[-3, 8.6, 1.71]} p={p} />
      <LeafMark size={2.4} at={[-3, 3.6, 1.71]} />
      <Cyl r={1.1} h={15} at={[4, 7.5, 0]} color={p.appliance} seg={12} />
      <Cyl r={1.4} h={2.5} at={[4, 16, 0]} color={p.sensor} seg={12} />
    </>
  );
}

/** A metering smart plug: a white block with its socket facing +z and a status light. */
function SmartPlug({ p }: ModelProps) {
  return (
    <>
      <Box size={[6, 8, 4]} at={[0, 4, 0]} color={p.appliance} r={1.4} />
      <Cyl r={1.8} h={0.5} at={[0, 3.8, 2.05]} rotation={ALONG_Z} color={p.applianceTrim} seg={18} />
      <Cyl r={0.35} h={0.4} at={[0, 7, 2.05]} rotation={ALONG_Z} color={p.sensor} emissive={p.sensor} seg={8} />
    </>
  );
}

/** A 20 L reservoir: a white bucket with a dark lid and the pump's line rising out of it. */
function ReservoirPump({ p }: ModelProps) {
  return (
    <>
      <Cyl r={15} r2={13} h={36} at={[0, 18, 0]} color={p.appliance} seg={24} />
      <Cyl r={15.6} h={2} at={[0, 37, 0]} color={p.housing} seg={24} />
      <Box size={[2, 10, 0.4]} at={[0, 18, 14.1]} rotation={[-0.055, 0, 0]} color={p.water} r={0.15} />
      <Cyl r={0.9} h={12} at={[6, 44, 0]} color={p.cord} seg={8} />
      <Cyl r={0.9} h={8} at={[6, 50, 4]} rotation={ALONG_Z} color={p.cord} seg={8} />
    </>
  );
}

/** An ultrasonic humidifier: a white body on a dark base, a water window on its front, the mist nozzle on top. */
function Humidifier({ p }: ModelProps) {
  return (
    <>
      <Box size={[18, 3, 14]} at={[0, 1.5, 0]} color={p.housingDark} r={1} />
      <Box size={[18, 22, 14]} at={[0, 14, 0]} color={p.appliance} r={3} />
      <Box size={[1.6, 11, 0.4]} at={[4.5, 13, 7]} color={p.water} r={0.2} />
      <Cyl r={2.6} h={1.6} at={[-2, 25.6, 0]} color={p.applianceTrim} seg={16} />
      <Cyl r={1.4} h={0.6} at={[-2, 26.6, 0]} color={p.housingDark} seg={12} />
    </>
  );
}

/** A dehumidifier: a white cabinet with grilles on its front and top. */
function Dehumidifier({ p }: ModelProps) {
  return (
    <>
      <Box size={[32, 50, 22]} at={[0, 25, 0]} color={p.appliance} r={3} />
      <Box size={[26, 0.6, 15]} at={[0, 50.1, 0]} color={p.housing} r={0.3} />
      {[30, 33, 36, 39, 42].map((y) => <Box key={y} size={[22, 1.2, 0.6]} at={[0, y, 11]} color={p.housing} r={0.3} />)}
      <Box size={[20, 9, 0.6]} at={[0, 12, 11]} color={p.applianceTrim} r={0.4} />
      <Box size={[6, 2, 0.6]} at={[0, 46, 11]} color={p.housingDark} r={0.4} />
    </>
  );
}

/** An oil-filled radiator: seven white fins on two dark feet, its controls on the side. */
function Heater({ p }: ModelProps) {
  const fins = 7;
  return (
    <>
      {Array.from({ length: fins }, (_, i) => (
        <Box key={i} size={[2.8, 48, 14]} at={[(i - (fins - 1) / 2) * 4.6, 33, 0]} color={p.appliance} r={1.3} />
      ))}
      <Cyl r={1.2} h={fins * 4.6} at={[0, 10, 0]} rotation={ALONG_X} color={p.applianceTrim} seg={8} />
      <Cyl r={1.2} h={fins * 4.6} at={[0, 56, 0]} rotation={ALONG_X} color={p.applianceTrim} seg={8} />
      <Box size={[4, 3, 22]} at={[-11, 1.5, 0]} color={p.housingDark} r={1} />
      <Box size={[4, 3, 22]} at={[11, 1.5, 0]} color={p.housingDark} r={1} />
      <Box size={[4, 10, 8]} at={[fins * 2.3 + 2, 50, 0]} color={p.applianceTrim} r={1} />
    </>
  );
}

/** A CO₂ cylinder with its regulator and gauge facing +z. */
function Co2Tank({ p }: ModelProps) {
  return (
    <>
      <Cyl r={7} h={55} at={[0, 27.5, 0]} color={p.housing} seg={24} />
      <mesh position={[0, 55, 0]} castShadow receiveShadow>
        <sphereGeometry args={[7, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={p.housing} roughness={0.6} />
      </mesh>
      <Cyl r={1.5} h={5} at={[0, 64, 0]} color={p.metal} seg={10} />
      <Box size={[6, 5, 4]} at={[0, 68, 0]} color={p.metal} r={0.8} />
      <Cyl r={2.6} h={1.4} at={[0, 68, 2.6]} rotation={ALONG_Z} color={p.appliance} seg={18} />
    </>
  );
}

/** A device with no role: a plain white block with a nub on the side it faces. */
function Block({ p }: ModelProps) {
  return (
    <>
      <Box size={[12, 12, 12]} at={[0, 6, 0]} color={p.appliance} r={2} />
      <Box size={[4, 4, 3]} at={[0, 6, 7]} color={p.applianceTrim} r={1} />
    </>
  );
}

const MODELS: Record<ModelKind, (props: ModelProps) => React.JSX.Element> = {
  inline_fan: InlineFan,
  clip_fan: ClipFan,
  led_light: LedLight,
  sensor: Sensor,
  light_sensor: LightSensor,
  co2_sensor: Co2Sensor,
  soil_probe: SoilProbe,
  res_probe: ResProbe,
  smart_plug: SmartPlug,
  reservoir_pump: ReservoirPump,
  humidifier: Humidifier,
  dehumidifier: Dehumidifier,
  heater: Heater,
  co2_tank: Co2Tank,
  block: Block,
};

export function Equipment({ kind, ...props }: ModelProps & { kind: ModelKind }) {
  const Model = MODELS[kind];
  return <Model {...props} />;
}
