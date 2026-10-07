/**
 * Devices, generated from simple shapes at their real size. Grow equipment is
 * missing from the CC0 packs, and an inline fan or an LED panel is a few
 * rounded boxes and cylinders anyway.
 *
 * One style throughout, after the design reference: dark moulded housings for
 * fans and the light, white for appliances, and the leaf mark on the front of
 * anything that would carry a logo. Sensors take their role's colour, the one
 * Layout's pins use, so two sensors sharing a model can be told apart.
 *
 * Each model is drawn in its own frame: the origin at the middle of its base,
 * y up, and +z the way it faces (`rotationDeg` turns it in the tent).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { EnclosureDimensions } from "@canopy/shared-types";
import { ledPanelSize, type ModelKind } from "./models";
import type { Palette } from "./palette";
import { LeafMark } from "./leaf";
import { Box, Cable, Cords, Cyl, ALONG_X, ALONG_Z, type V3 } from "./shapes";

interface ModelProps {
  p: Palette;
  dims: EnclosureDimensions;
  /** The roof rails' height in the model's frame, for anything hung on cords. */
  roofY: number;
  /**
   * How it is held: as its model normally is, or flat against a wall, its
   * back (-z) to the wall, with a bracket in place of its cord.
   */
  mount: "hung" | "standing" | "wall";
  /** The role's colour (Layout's pin colour), worn by sensors. */
  accent: string;
  /** Whether it is switched on, where that shows: a lit LED panel, a heater's lamp. Unknown counts as on. */
  on: boolean;
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
 * A 6" inline duct fan: an octagonal moulded body between two round collars,
 * on two straps. Its ducting is routed through the tent (ducts.tsx).
 */
function InlineFan({ p, roofY }: ModelProps) {
  const c = 12.5;
  return (
    <>
      <group position={[0, c, 0]}>
        <Cyl r={12} h={18} at={[0, 0, 0]} rotation={[Math.PI / 2, Math.PI / 8, 0]} color={p.housing} seg={8} faceted />
        <Cyl r={8.6} h={5} at={[0, 0, -11.5]} rotation={ALONG_Z} color={p.housingDark} seg={18} />
        <Cyl r={8.6} h={5} at={[0, 0, 11.5]} rotation={ALONG_Z} color={p.housingDark} seg={18} />
        <LeafMark size={7} at={[11.2, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
        <LeafMark size={7} at={[-11.2, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
      </group>
      <Box size={[4, 1.6, 20]} at={[0, 25, 0]} color={p.housingDark} r={0.6} />
      <Cords at={[[0, -8], [0, 8]]} fromY={25.8} toY={roofY} color={p.cord} />
    </>
  );
}

/**
 * A 6" clip-on circulation fan, after the reference: a deep octagonal housing
 * with a wire grille over five broad blades, the motor behind, on a knuckle
 * joint above a clamp, its face toward +z.
 */
function ClipFan({ p }: ModelProps) {
  const blades = 5;
  const octagonZ: V3 = [Math.PI / 2, Math.PI / 8, 0];
  return (
    <>
      {/* The clamp, its jaws open toward -z as if round a pole, and its screw. */}
      <Box size={[5, 8, 1.8]} at={[0, 4, -1.2]} color={p.housingDark} r={0.7} />
      <Box size={[5, 1.6, 5]} at={[0, 0.8, -3.2]} color={p.housingDark} r={0.6} />
      <Box size={[5, 1.6, 5]} at={[0, 7.2, -3.2]} color={p.housingDark} r={0.6} />
      <Cyl r={0.6} h={4} at={[0, 0.8, -4.5]} color={p.metal} seg={8} />
      <Cyl r={1.3} h={0.8} at={[0, -1.4, -4.5]} color={p.housing} seg={10} />
      {/* Neck and knuckle */}
      <Cyl r={0.9} h={7} at={[0, 11.5, -1.2]} color={p.housing} seg={10} />
      <mesh position={[0, 15.4, -1.2]} castShadow>
        <sphereGeometry args={[1.7, 14, 10]} />
        <meshStandardMaterial color={p.housing} roughness={0.6} />
      </mesh>
      <Cyl r={1.2} h={4.4} at={[0, 15.4, -1.2]} rotation={ALONG_X} color={p.housingDark} seg={12} />
      <group position={[0, 25, 0]}>
        {/* Housing: a front lip and a back ring joined by an octagonal shell. */}
        <mesh rotation={[0, 0, Math.PI / 8]} position={[0, 0, 0.6]} castShadow>
          <torusGeometry args={[10.4, 1.7, 8, 8]} />
          <meshStandardMaterial color={p.housing} roughness={0.6} flatShading />
        </mesh>
        <mesh rotation={octagonZ} position={[0, 0, -1.6]} castShadow>
          <cylinderGeometry args={[11, 10, 4.4, 8, 1, true]} />
          <meshStandardMaterial color={p.housing} roughness={0.6} flatShading side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 8]} position={[0, 0, -3.8]}>
          <torusGeometry args={[9.6, 1.1, 6, 8]} />
          <meshStandardMaterial color={p.housingDark} roughness={0.6} flatShading />
        </mesh>
        {/* Rear grille spokes and the motor behind them, with the mark. */}
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI) / 2 + Math.PI / 4]}>
            <Box size={[0.5, 7.5, 0.5]} at={[0, 6.2, -3.8]} color={p.housingDark} r={0.2} />
          </group>
        ))}
        <Cyl r={4.4} r2={3.6} h={4.5} at={[0, 0, -6]} rotation={ALONG_Z} color={p.housing} seg={18} />
        <LeafMark size={3.6} at={[0, 0, -8.3]} rotation={[0, Math.PI, 0]} />
        {/* Blades: broad, pitched, round a domed hub. */}
        {Array.from({ length: blades }, (_, i) => (
          <group key={i} rotation={[0, 0, (i * 2 * Math.PI) / blades]}>
            <mesh position={[0, 4.9, -1]} rotation={[0, 0.55, 0.25]} scale={[3.3, 4.6, 0.35]} castShadow>
              <sphereGeometry args={[1, 14, 8]} />
              <meshStandardMaterial color={p.fanBlade} roughness={0.5} />
            </mesh>
          </group>
        ))}
        <Cyl r={2.2} h={2} at={[0, 0, -0.6]} rotation={ALONG_Z} color={p.housingDark} seg={16} />
        <mesh position={[0, 0, 0.4]} scale={[1, 1, 0.5]}>
          <sphereGeometry args={[2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={p.housingDark} roughness={0.5} />
        </mesh>
        {/* Front grille: three wire rings on four spokes. */}
        {[3.6, 6.4, 9].map((r) => (
          <mesh key={r} position={[0, 0, 1.6]}>
            <torusGeometry args={[r, 0.2, 4, 36]} />
            <meshStandardMaterial color={p.housingDark} roughness={0.5} />
          </mesh>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI) / 2]}>
            <Box size={[0.4, 8.6, 0.4]} at={[0, 5.6, 1.6]} color={p.housingDark} r={0} shadow={false} />
          </group>
        ))}
      </group>
      <Cable points={[[1.6, 9, -1.8], [2.2, 4, -2.8], [2.4, -1, -3.2], [2.6, -6, -3.4]]} r={0.3} color={p.cord} />
    </>
  );
}

/**
 * An LED panel light, sized to the tent as growers size theirs: about 70 % of
 * the width, between 40 and 110 cm across and inside the walls. Its base is the emitting face, so
 * the mounting height is the light's height above the floor. Switched on, the
 * face glows and `LightBeams` (TentView) draws its light falling;
 * the light it gives is the tent's one overhead light (`Lights` in tent.tsx),
 * however many panels there are.
 */
function LedLight({ p, dims, roofY, on }: ModelProps) {
  const { widthCm: s, depthCm: depth } = ledPanelSize(dims);
  const hang: [number, number][] = [[-s / 2 + 4, 0], [s / 2 - 4, 0]];
  return (
    <>
      <Box size={[s - 1, 1.8, depth - 1]} at={[0, 0.9, 0]} color={on ? p.led : p.ledOff} emissive={on ? p.led : undefined} r={0.6} shadow={false} />
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
    </>
  );
}

/** A temperature and humidity sensor: a square in its role's colour, a white face with the display, hung at canopy height. */
function Sensor({ p, roofY, accent, mount }: ModelProps) {
  return (
    <>
      <Box size={[7.5, 7.5, 2.4]} at={[0, 3.75, 0]} color={accent} r={1.2} />
      <Box size={[6.6, 6.6, 0.4]} at={[0, 3.75, 1.1]} color={p.appliance} r={0.15} />
      <Screen size={[5.2, 4.2]} at={[0, 4.2, 1.32]} p={p} />
      <Cyl r={0.3} h={6} at={[1.8, -3, 0]} color={p.cord} seg={5} shadow={false} />
      {mount === "wall"
        ? <WallBracket size={[4.6, 4.6]} at={[0, 3.75, -1.2]} p={p} />
        : <Cords at={[[0, 0]]} fromY={7.5} toY={roofY} color={p.cord} />}
    </>
  );
}

/** What holds a wall-mounted device: a flat plate on the wall behind it, `at` its front face, and two screws. */
function WallBracket({ size, at, p }: { size: [number, number]; at: V3; p: Palette }) {
  const [w, h] = size;
  return (
    <group position={at}>
      <Box size={[w, h, 0.6]} at={[0, 0, -0.3]} color={p.applianceTrim} r={0.25} />
      {[-1, 1].map((sy) => <Cyl key={sy} r={0.35} h={0.3} at={[0, sy * (h / 2 - 0.8), -0.75]} rotation={ALONG_Z} color={p.metal} seg={8} shadow={false} />)}
    </group>
  );
}

/** A light sensor: a puck in its role's colour, its white diffuser dome facing up. */
function LightSensor({ p, roofY, accent }: ModelProps) {
  return (
    <>
      <Cyl r={3.2} h={2} at={[0, 1, 0]} color={accent} seg={18} />
      <mesh position={[0, 2, 0]} castShadow>
        <sphereGeometry args={[2.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#ffffff" roughness={0.2} transparent opacity={0.85} />
      </mesh>
      <Cords at={[[2.6, 0]]} fromY={2} toY={roofY} color={p.cord} />
    </>
  );
}

/** A CO₂ monitor: its role's colour, a white face with the display facing +z. */
function Co2Sensor({ p, roofY, accent, mount }: ModelProps) {
  return (
    <>
      <Box size={[8, 12, 3.4]} at={[0, 6, 0]} color={accent} r={1.4} />
      <Box size={[7, 11, 0.4]} at={[0, 6, 1.6]} color={p.appliance} r={0.2} />
      <Screen size={[5.6, 4.2]} at={[0, 8, 1.82]} p={p} />
      {[-2, 0, 2].map((x) => <Box key={x} size={[1, 1, 0.3]} at={[x, 3, 1.85]} color={p.applianceTrim} r={0.2} />)}
      {mount === "wall"
        ? <WallBracket size={[5.4, 8]} at={[0, 6, -1.7]} p={p} />
        : <Cords at={[[0, 0]]} fromY={12} toY={roofY} color={p.cord} />}
    </>
  );
}

/** A soil-moisture sensor: a metal stake in the medium under a head in its role's colour, with the mark. */
function SoilProbe({ p, accent }: ModelProps) {
  return (
    <>
      <Box size={[2.2, 12, 0.5]} at={[0, 6, 0]} color={p.metal} r={0.2} />
      <Box size={[4.6, 8, 2.6]} at={[0, 16, 0]} color={accent} r={1} />
      <LeafMark size={2.6} at={[0, 17.2, 1.32]} />
      <Cyl r={0.3} h={5} at={[-1, 11, 0]} color={p.cord} seg={5} />
      <Cyl r={0.3} h={5} at={[1, 11, 0]} color={p.cord} seg={5} />
    </>
  );
}

/** A reservoir meter: a controller in its role's colour with its display, and its pen probe beside it. */
function ResProbe({ p, accent }: ModelProps) {
  return (
    <>
      <Box size={[8, 12, 3.4]} at={[-3, 6, 0]} color={accent} r={1.2} />
      <Screen size={[6, 3.4]} at={[-3, 8.6, 1.71]} p={p} />
      <LeafMark size={2.4} at={[-3, 3.6, 1.71]} />
      <Cyl r={1.1} h={15} at={[4, 7.5, 0]} color={p.appliance} seg={12} />
      <Cyl r={1.4} h={2.5} at={[4, 16, 0]} color={accent} seg={12} />
    </>
  );
}

/**
 * A metering smart plug, Shelly Plug style, in the first socket of a power
 * strip on the floor: a white cube, its socket and LED ring on top, with the
 * plug of whatever it meters in it and that cable trailing off.
 */
function SmartPlug({ p, accent }: ModelProps) {
  const sockets = [-10, -1.5, 7];
  return (
    <>
      {/* The strip, its free sockets, and its own lead off the +x end. */}
      <Box size={[30, 3.4, 7]} at={[0, 1.7, 0]} color={p.appliance} r={1.3} />
      {sockets.slice(1).map((x) => (
        <group key={x} position={[x, 3.45, 0]}>
          <Cyl r={2} h={0.2} at={[0, 0, 0]} color={p.applianceTrim} seg={20} />
          {[-0.8, 0.8].map((dx) => <Cyl key={dx} r={0.32} h={0.25} at={[dx, 0.05, 0]} color={p.ink} seg={8} />)}
        </group>
      ))}
      <Box size={[2.4, 1.2, 1.6]} at={[12, 3.6, 0]} color={p.applianceTrim} r={0.4} />
      <Cable points={[[15, 1.4, 0], [17, 0.5, 0], [22, 0.5, 1], [28, 0.5, 3]]} r={0.5} color={p.cord} />
      {/* The smart plug */}
      <group position={[sockets[0]!, 3.4, 0]}>
        <Box size={[6, 6.4, 6]} at={[0, 3.2, 0]} color={p.appliance} r={2} />
        <Cyl r={2.3} h={0.3} at={[0, 6.45, 0]} color={p.applianceTrim} seg={24} />
        <mesh position={[0, 6.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.55, 0.18, 6, 32]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} roughness={0.4} />
        </mesh>
        <LeafMark size={2.4} at={[0, 3.4, 3.02]} color={p.applianceTrim} />
        {/* Whatever it meters, plugged in, its cable looping back to the floor. */}
        <Box size={[3, 2.6, 2.2]} at={[0, 7.9, 0]} color={p.housingDark} r={0.6} />
        <Cable points={[[0, 9, 0], [0, 11.5, -1], [0, 11, -4.5], [0, 4, -6.5], [0, -2.9, -8], [-1, -2.9, -14], [-4, -2.9, -20]]} r={0.45} color={p.cord} />
      </group>
    </>
  );
}

/**
 * A 20 L reservoir with its submersible pump: a white bucket with a rolled rim
 * and two ribs, a dark lid with the pump's hose and power lead coming out
 * through a grommet, a level window, and the hose arcing over the rim and
 * away across the floor toward +z.
 */
function ReservoirPump({ p }: ModelProps) {
  const parts = useMemo(() => {
    const bucket = new THREE.LatheGeometry(
      [[0, 0], [12.4, 0], [13, 0.8], [13.2, 2], [14.6, 34], [15, 36]].map(([x, y]) => new THREE.Vector2(x, y)),
      32,
    );
    const hose = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(
        [[7, 38.5, -3], [7, 45, 0], [6.5, 46, 8], [6, 40, 15.5], [5, 20, 17.5], [4, 3, 19], [3, 0.9, 26], [1, 0.9, 34]]
          .map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      ),
      48, 0.75, 8, false,
    );
    return { bucket, hose };
  }, []);
  useEffect(() => () => { parts.bucket.dispose(); parts.hose.dispose(); }, [parts]);
  return (
    <>
      <mesh geometry={parts.bucket} castShadow receiveShadow>
        <meshStandardMaterial color={p.appliance} roughness={0.55} side={THREE.DoubleSide} />
      </mesh>
      {[12, 24].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[13.3 + (y / 34) * 1.4, 0.45, 6, 32]} />
          <meshStandardMaterial color={p.appliance} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[0, 36.2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[15.1, 0.9, 8, 32]} />
        <meshStandardMaterial color={p.appliance} roughness={0.55} />
      </mesh>
      {/* Lid, with a raised centre and the grommet the hose and lead come through. */}
      <Cyl r={15} h={1.4} at={[0, 37.3, 0]} color={p.housing} seg={32} />
      <Cyl r={9} r2={10} h={0.9} at={[0, 38.4, 0]} color={p.housing} seg={32} />
      <Cyl r={1.8} h={0.8} at={[7, 38.4, -3]} color={p.housingDark} seg={14} />
      {/* The bail handle, folded down onto the lid, and its lugs. */}
      <group position={[0, 36.6, 0]} rotation={[Math.PI / 2 - 0.25, 0, 0]}>
        <mesh>
          <torusGeometry args={[15.6, 0.35, 5, 28, Math.PI]} />
          <meshStandardMaterial color={p.metal} roughness={0.4} metalness={0.4} />
        </mesh>
      </group>
      {[-1, 1].map((sx) => <Box key={sx} size={[1.2, 2.4, 2.4]} at={[sx * 15.4, 34.8, 0]} color={p.applianceTrim} r={0.5} />)}
      {/* Level window and its scale */}
      <Box size={[2.4, 22, 0.4]} at={[0, 17, 14.2]} rotation={[-0.045, 0, 0]} color={p.water} r={0.2} />
      {[8, 13, 18, 23, 28].map((y) => <Box key={y} size={[1.2, 0.25, 0.3]} at={[-1.9, y, 14.15 + y * 0.045]} color={p.ink} r={0} shadow={false} />)}
      <LeafMark size={4} at={[6, 27, 14.6]} rotation={[-0.045, 0, 0]} color={p.applianceTrim} />
      <mesh geometry={parts.hose} castShadow>
        <meshStandardMaterial color={p.cord} roughness={0.5} />
      </mesh>
      <Cable points={[[7.8, 38.8, -3.6], [10, 41, -4.4], [15.6, 38.4, -6], [16.2, 20, -6.4], [16.4, 1, -6.8], [17, 0.4, -14], [18, 0.4, -24]]} color={p.cord} />
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

/**
 * An oil-filled radiator: seven white fins between their manifolds, a carry
 * bar on top, caster feet, and the control box on its side with a dial and a
 * lamp that is lit while it is on.
 */
function Heater({ p, on }: ModelProps) {
  const fins = 7;
  const pitch = 4.6;
  const span = fins * pitch;
  const bottom = 8;
  const height = 46;
  return (
    <>
      {Array.from({ length: fins }, (_, i) => {
        const x = (i - (fins - 1) / 2) * pitch;
        return (
          <group key={i} position={[x, 0, 0]}>
            <Box size={[2.8, height, 15]} at={[0, bottom + height / 2, 0]} color={p.appliance} r={1.35} />
            {/* The pressed channel down each fin's face. */}
            <Box size={[3.2, height - 10, 3]} at={[0, bottom + height / 2, 0]} color={p.appliance} r={1.4} />
          </group>
        );
      })}
      <Cyl r={1.6} h={span} at={[0, bottom + 3, 0]} rotation={ALONG_X} color={p.applianceTrim} seg={12} />
      <Cyl r={1.6} h={span} at={[0, bottom + height - 3, 0]} rotation={ALONG_X} color={p.applianceTrim} seg={12} />
      {/* Carry bar on two posts */}
      {[-1, 1].map((sx) => <Box key={sx} size={[1.6, 4, 1.6]} at={[sx * (span / 2 - 4), bottom + height + 1.5, 0]} color={p.housingDark} r={0.5} />)}
      <Cyl r={0.9} h={span - 6} at={[0, bottom + height + 3.6, 0]} rotation={ALONG_X} color={p.housingDark} seg={10} />
      {/* Feet with casters */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * (span / 2 - 6), 0, 0]}>
          <Box size={[3, 2.2, 24]} at={[0, 4.6, 0]} color={p.housingDark} r={1} />
          <Box size={[1.6, 4, 1.6]} at={[0, 6.5, 0]} color={p.housingDark} r={0.5} />
          {[-1, 1].map((sz) => (
            <group key={sz} position={[0, 1.8, sz * 10.5]}>
              <Cyl r={1.8} h={1.4} at={[0, 0, 0]} rotation={ALONG_X} color={p.housingDark} seg={14} />
              <Box size={[2.2, 1.6, 1.2]} at={[0, 2.2, 0]} color={p.housing} r={0.4} />
            </group>
          ))}
        </group>
      ))}
      {/* Control box on the +x side: dial, second knob, the lamp, the lead. */}
      <group position={[span / 2 + 2.8, bottom + height - 12, 0]}>
        <Box size={[5, 16, 11]} at={[0, 0, 0]} color={p.appliance} r={1.6} />
        <Box size={[0.4, 13, 8.6]} at={[2.5, 0, 0]} color={p.applianceTrim} r={0.2} />
        <Cyl r={2.1} h={1.6} at={[3.3, 2.6, 0]} rotation={ALONG_X} color={p.housing} seg={20} />
        <Box size={[0.6, 2.4, 0.5]} at={[4.15, 3.4, 0]} color={p.appliance} r={0} shadow={false} />
        <Cyl r={1.3} h={1.4} at={[3.2, -2.6, -2]} rotation={ALONG_X} color={p.housing} seg={16} />
        <Cyl r={0.7} h={0.8} at={[2.9, -2.6, 2.6]} rotation={ALONG_X} color={on ? p.lamp : p.ledOff} emissive={on ? p.lamp : undefined} seg={12} />
        <Cable points={[[1, -8, -4], [1.6, -14, -5], [2, -bottom - height + 12.6, -6], [4, -bottom - height + 12.4, -12], [7, -bottom - height + 12.4, -20]]} r={0.4} color={p.cord} />
      </group>
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

/**
 * A device with no role, drawn as what such a device usually is: a smart
 * controller (a Shelly relay, an ESP board) in a small white enclosure, its
 * dark face toward +z with a status light, a button and the mark, an antenna
 * stub on top and cable glands at the sides. On the floor it stands on a
 * flange; in the air by a wall it is screwed to the wall.
 */
function Block({ p, mount }: ModelProps) {
  return (
    <>
      {mount === "wall"
        ? <WallBracket size={[9, 6]} at={[0, 4.6, -3.3]} p={p} />
        : <Box size={[12, 0.8, 8]} at={[0, 0.4, 0]} color={p.applianceTrim} r={0.3} />}
      <Box size={[11, 7.6, 6.6]} at={[0, 4.6, 0]} color={p.appliance} r={1.6} />
      <Box size={[11.2, 0.4, 6.8]} at={[0, 6.6, 0]} color={p.applianceTrim} r={0.15} />
      <Box size={[8, 4.4, 0.4]} at={[0, 4.2, 3.3]} color={p.housingDark} r={0.6} />
      <Cyl r={0.4} h={0.3} at={[-2.6, 5.3, 3.55]} rotation={ALONG_Z} color={p.ok} emissive={p.ok} seg={10} />
      <Cyl r={0.7} h={0.4} at={[-2.6, 3.2, 3.55]} rotation={ALONG_Z} color={p.housing} seg={12} />
      <LeafMark size={2.6} at={[1.6, 4.2, 3.52]} />
      <Cyl r={0.35} h={4.6} at={[3.6, 10.5, -1.8]} color={p.housingDark} seg={8} />
      <mesh position={[3.6, 12.9, -1.8]}>
        <sphereGeometry args={[0.6, 10, 8]} />
        <meshStandardMaterial color={p.housingDark} roughness={0.5} />
      </mesh>
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Cyl r={0.9} h={1.6} at={[sx * 6.2, 2.6, 0]} rotation={ALONG_X} color={p.housingDark} seg={12} />
          <Cable
            points={mount === "wall"
              // On a wall the leads drop from the glands and run down it.
              ? [[sx * 7, 2.6, 0], [sx * 8.4, 2, -0.6], [sx * 8.8, -2, -2.2], [sx * 8.8, -10, -2.6], [sx * 8.8, -18, -2.6]]
              : [[sx * 7, 2.6, 0], [sx * 8.4, 2.3, 0], [sx * 9.2, 0.4, 0.4], [sx * 12, 0.4, 1.6], [sx * 15, 0.4, 2]]}
            color={p.cord}
          />
        </group>
      ))}
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
