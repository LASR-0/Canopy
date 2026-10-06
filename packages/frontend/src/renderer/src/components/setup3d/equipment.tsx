/**
 * Devices, generated from simple shapes at their real size, in the tent's
 * low-poly gray style. Grow equipment is missing from the CC0 packs, and an
 * inline fan or an LED bar light is a few boxes and cylinders anyway.
 *
 * Each model is drawn in its own frame: the origin at the middle of its base,
 * y up, and +z the way it faces (`rotationDeg` turns it in the tent).
 */
import type { EnclosureDimensions } from "@canopy/shared-types";
import type { ModelKind } from "./models";
import type { Palette } from "./palette";

type V3 = [number, number, number];

const UPRIGHT: V3 = [0, 0, 0];
const ALONG_Z: V3 = [Math.PI / 2, 0, 0];
const ALONG_X: V3 = [0, 0, Math.PI / 2];

function Mat({ color }: { color: string }) {
  return <meshStandardMaterial color={color} flatShading roughness={1} />;
}

function Box({ size, at, color }: { size: V3; at: V3; color: string }) {
  return (
    <mesh position={at}>
      <boxGeometry args={size} />
      <Mat color={color} />
    </mesh>
  );
}

/** A cylinder, upright unless turned onto its side with `rotation`. */
function Cyl({ r, r2 = r, h, at, color, rotation = UPRIGHT, seg = 12 }: {
  r: number; r2?: number; h: number; at: V3; color: string; rotation?: V3; seg?: number;
}) {
  return (
    <mesh position={at} rotation={rotation}>
      <cylinderGeometry args={[r, r2, h, seg]} />
      <Mat color={color} />
    </mesh>
  );
}

/** Cords from the model's top up to the roof bars, at each [x, z]. */
function Cords({ at, fromY, toY, color }: { at: [number, number][]; fromY: number; toY: number; color: string }) {
  const length = toY - fromY;
  if (length < 1) return null;
  return (
    <>
      {at.map(([x, z], i) => (
        <Cyl key={i} r={0.35} h={length} at={[x, fromY + length / 2, z]} color={color} seg={4} />
      ))}
    </>
  );
}

interface ModelProps {
  p: Palette;
  dims: EnclosureDimensions;
  /** The roof bars' height in the model's frame, for anything hung on cords. */
  roofY: number;
}

/** A 6" inline duct fan on its side, blowing toward +z, on two straps. */
function InlineFan({ p, roofY }: ModelProps) {
  return (
    <>
      <Cyl r={12.5} h={22} at={[0, 12.5, 0]} rotation={ALONG_Z} color={p.device} seg={16} />
      <Cyl r={13.2} h={1.6} at={[0, 12.5, -7]} rotation={ALONG_Z} color={p.accent} seg={16} />
      <Cyl r={13.2} h={1.6} at={[0, 12.5, 7]} rotation={ALONG_Z} color={p.accent} seg={16} />
      <Cyl r={7.5} h={6} at={[0, 12.5, -14]} rotation={ALONG_Z} color={p.device} seg={12} />
      <Cyl r={7.5} h={6} at={[0, 12.5, 14]} rotation={ALONG_Z} color={p.device} seg={12} />
      <Box size={[6, 3, 8]} at={[0, 26, 0]} color={p.accent} />
      <Cords at={[[0, -6], [0, 6]]} fromY={27.5} toY={roofY} color={p.rope} />
    </>
  );
}

/** A clip-on circulation fan: clamp, neck and a caged head facing +z. */
function ClipFan({ p }: ModelProps) {
  return (
    <>
      <Box size={[4, 6, 5]} at={[0, 3, 0]} color={p.accent} />
      <Cyl r={0.9} h={9} at={[0, 10.5, 0]} color={p.accent} seg={6} />
      <Cyl r={9.5} h={5} at={[0, 22, 0]} rotation={ALONG_Z} color={p.device} seg={16} />
      <Cyl r={3} h={6.5} at={[0, 22, 0.5]} rotation={ALONG_Z} color={p.accent} seg={10} />
      <Cyl r={4} h={4} at={[0, 22, -3.5]} rotation={ALONG_Z} color={p.device} seg={10} />
    </>
  );
}

/**
 * A bar-style LED light, sized to the tent as growers size theirs: about 70 %
 * of the footprint, between 40 and 110 cm. Its base is the emitting face, so
 * the mounting height is the light's height above the floor.
 */
function LedLight({ p, dims, roofY }: ModelProps) {
  const s = Math.min(110, Math.max(40, Math.min(dims.widthCm, dims.depthCm) * 0.7));
  const bars = Math.max(4, Math.round(s / 18));
  const pitch = (s - 6) / bars;
  return (
    <>
      {Array.from({ length: bars }, (_, i) => (
        <Box key={i} size={[pitch * 0.55, 2.5, s - 6]} at={[-s / 2 + 3 + pitch * (i + 0.5), 1.25, 0]} color={p.device} />
      ))}
      <Box size={[s, 3, 3]} at={[0, 2.5 + 1.5, -s / 2 + 1.5]} color={p.accent} />
      <Box size={[s, 3, 3]} at={[0, 2.5 + 1.5, s / 2 - 1.5]} color={p.accent} />
      <Box size={[18, 4, 10]} at={[0, 2.5 + 3 + 2, 0]} color={p.accent} />
      <Cords
        at={[[-s / 2 + 3, -s / 2 + 1.5], [s / 2 - 3, -s / 2 + 1.5], [-s / 2 + 3, s / 2 - 1.5], [s / 2 - 3, s / 2 - 1.5]]}
        fromY={5.5}
        toY={roofY}
        color={p.rope}
      />
    </>
  );
}

/** A temperature and humidity sensor hung at canopy height on a cord. */
function Sensor({ p, roofY }: ModelProps) {
  return (
    <>
      <Box size={[7, 10, 3]} at={[0, 5, 0]} color={p.device} />
      {[3, 5, 7].map((y) => <Box key={y} size={[5, 0.6, 0.4]} at={[0, y, 1.6]} color={p.accent} />)}
      <Cords at={[[0, 0]]} fromY={10} toY={roofY} color={p.rope} />
    </>
  );
}

/** A light sensor: a flat puck with its dome facing up. */
function LightSensor({ p, roofY }: ModelProps) {
  return (
    <>
      <Cyl r={3} h={2} at={[0, 1, 0]} color={p.device} seg={10} />
      <mesh position={[0, 2, 0]}>
        <sphereGeometry args={[2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Mat color={p.accent} />
      </mesh>
      <Cords at={[[2.5, 0]]} fromY={2} toY={roofY} color={p.rope} />
    </>
  );
}

/** A CO₂ monitor with its display facing +z. */
function Co2Sensor({ p, roofY }: ModelProps) {
  return (
    <>
      <Box size={[8, 12, 4]} at={[0, 6, 0]} color={p.device} />
      <Box size={[6, 4, 0.4]} at={[0, 8, 2.1]} color={p.accent} />
      <Cords at={[[0, 0]]} fromY={12} toY={roofY} color={p.rope} />
    </>
  );
}

/** A soil-moisture stake, its prong in the medium. */
function SoilProbe({ p }: ModelProps) {
  return (
    <>
      <Box size={[2.4, 13, 0.6]} at={[0, 6.5, 0]} color={p.accent} />
      <Box size={[4, 6, 2]} at={[0, 16, 0]} color={p.device} />
    </>
  );
}

/** A reservoir meter: the controller box and its pen probe beside it. */
function ResProbe({ p }: ModelProps) {
  return (
    <>
      <Box size={[8, 12, 4]} at={[-3, 6, 0]} color={p.device} />
      <Box size={[6, 3, 0.4]} at={[-3, 9, 2.1]} color={p.accent} />
      <Cyl r={1.2} h={16} at={[4, 8, 0]} color={p.accent} seg={8} />
      <Cyl r={1.5} h={2} at={[4, 17, 0]} color={p.device} seg={8} />
    </>
  );
}

/** A metering smart plug, its face toward +z. */
function SmartPlug({ p }: ModelProps) {
  return (
    <>
      <Box size={[6, 8, 4]} at={[0, 4, 0]} color={p.device} />
      <Cyl r={1.6} h={0.6} at={[0, 4.5, 2.2]} rotation={ALONG_Z} color={p.accent} seg={10} />
    </>
  );
}

/** A 20 L reservoir bucket with the pump's line rising out of its lid. */
function ReservoirPump({ p }: ModelProps) {
  return (
    <>
      <Cyl r={15} r2={13} h={36} at={[0, 18, 0]} color={p.device} seg={16} />
      <Cyl r={15.6} h={1.6} at={[0, 36.8, 0]} color={p.accent} seg={16} />
      <Cyl r={1} h={12} at={[6, 43.6, 0]} color={p.accent} seg={6} />
      <Cyl r={1} h={8} at={[6, 49.6 - 1, 4]} rotation={ALONG_Z} color={p.accent} seg={6} />
    </>
  );
}

/** An ultrasonic humidifier: base, tank and mist nozzle. */
function Humidifier({ p }: ModelProps) {
  return (
    <>
      <Cyl r={11} h={12} at={[0, 6, 0]} color={p.device} seg={14} />
      <Cyl r={10} r2={10.5} h={18} at={[0, 21, 0]} color={p.accent} seg={14} />
      <Cyl r={2.5} h={6} at={[0, 33, 0]} color={p.device} seg={8} />
    </>
  );
}

/** A dehumidifier: a cabinet with a grille on its front and top. */
function Dehumidifier({ p }: ModelProps) {
  return (
    <>
      <Box size={[32, 50, 22]} at={[0, 25, 0]} color={p.device} />
      <Box size={[26, 1, 16]} at={[0, 50.5, 0]} color={p.accent} />
      {[30, 33, 36, 39, 42].map((y) => <Box key={y} size={[24, 1.2, 0.8]} at={[0, y, 11.2]} color={p.accent} />)}
      <Box size={[30, 0.6, 0.6]} at={[0, 14, 11.2]} color={p.accent} />
    </>
  );
}

/** An oil-filled radiator: seven fins on two feet, controls on the side. */
function Heater({ p }: ModelProps) {
  const fins = 7;
  return (
    <>
      {Array.from({ length: fins }, (_, i) => (
        <Box key={i} size={[2.6, 48, 14]} at={[(i - (fins - 1) / 2) * 4.6, 33, 0]} color={p.device} />
      ))}
      <Cyl r={1.2} h={fins * 4.6} at={[0, 10, 0]} rotation={ALONG_X} color={p.accent} seg={6} />
      <Cyl r={1.2} h={fins * 4.6} at={[0, 56, 0]} rotation={ALONG_X} color={p.accent} seg={6} />
      <Box size={[4, 3, 22]} at={[-11, 1.5, 0]} color={p.accent} />
      <Box size={[4, 3, 22]} at={[11, 1.5, 0]} color={p.accent} />
      <Box size={[4, 10, 8]} at={[fins * 2.3 + 2, 50, 0]} color={p.accent} />
    </>
  );
}

/** A CO₂ cylinder with its regulator and gauge facing +z. */
function Co2Tank({ p }: ModelProps) {
  return (
    <>
      <Cyl r={7} h={55} at={[0, 27.5, 0]} color={p.device} seg={14} />
      <mesh position={[0, 55, 0]}>
        <sphereGeometry args={[7, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Mat color={p.device} />
      </mesh>
      <Cyl r={1.5} h={5} at={[0, 64, 0]} color={p.accent} seg={8} />
      <Box size={[6, 5, 4]} at={[0, 68, 0]} color={p.accent} />
      <Cyl r={2.5} h={1.5} at={[0, 68, 2.6]} rotation={ALONG_Z} color={p.device} seg={12} />
    </>
  );
}

/** A device with no role: a plain block with a nub on the side it faces. */
function Block({ p }: ModelProps) {
  return (
    <>
      <Box size={[12, 12, 12]} at={[0, 6, 0]} color={p.device} />
      <Box size={[4, 4, 3]} at={[0, 6, 7.5]} color={p.device} />
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
