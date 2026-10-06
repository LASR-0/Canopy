import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { Icon, type IconName } from "@/components/Icon";
import { Tag } from "@/components/Tag";
import { Tip } from "@/components/Tip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDevices, useRoles, useAssignRole } from "@/hooks/useDevices";
import { useElementWidth } from "@/hooks/useElementWidth";
import {
  useAddPlant,
  useLayout,
  usePlaceDevice,
  useRemovePlant,
  useUnplaceDevice,
  useUpdatePlant,
} from "@/hooks/useLayout";
import { useActiveWorkspace, usePatchWorkspace } from "@/hooks/useWorkspace";
import { ROLE_META, isControlDevice, roleChannel, rolesFor } from "@/lib/roles";
import {
  DEFAULT_ENCLOSURE,
  DEFAULT_POT_LITRES,
  ENCLOSURE_LIMITS,
  POT_SIZES,
  clampCm,
  dimensionsProblem,
  potSize,
  type Device,
  type DevicePlacement,
  type EnclosureDimensions,
  type Plant,
  type RoleAssignment,
  type RoleKind,
} from "@canopy/shared-types";

// ── Markers ───────────────────────────────────────────────────────────────────

/** Pin colour by role — the prototype's palette. Sensors cool, equipment warm. */
const ROLE_COLOR: Record<RoleKind, string> = {
  canopy_temp: "#f78166", canopy_rh: "#2f81f7", canopy_light: "#e3b341", rootzone: "#d29922",
  co2_probe: "#3fb950", res_temp: "#56d364", res_ph: "#56d364", res_ec: "#56d364", power_draw: "#8b949e",
  exhaust: "#2f81f7", intake: "#79c0ff", circ: "#a371f7", light: "#e3b341", pump: "#56d364",
  humidifier: "#2f81f7", dehumidifier: "#a371f7", co2_valve: "#3fb950", heater: "#f85149",
};
const UNASSIGNED_COLOR = "#8b949e";
const PLANT_COLOR = "#3fb950";

function roleIcon(role: RoleKind | undefined, device: Device): IconName {
  switch (role) {
    case "light": case "canopy_light": return "sun";
    case "exhaust": case "intake": case "circ": return "fan";
    case "pump": case "res_temp": case "res_ph": case "res_ec": return "drop";
    case "co2_probe": case "co2_valve": return "co2";
    case "rootzone": return "seedling";
    case "humidifier": case "dehumidifier": case "canopy_rh": return "drop";
    case "heater": case "canopy_temp": return "temp";
    case "power_draw": return "power";
    default: return isControlDevice(device) ? "plug" : "target";
  }
}

const potLabel = (litres: number) => {
  const pot = potSize(litres);
  return pot ? `${pot.litres} L · ⌀${pot.diameterCm} cm` : `${litres} L`;
};

const fmtCm = (v: number) => String(Math.round(v));

/** A plant's name: its label, or its position in the list. */
const plantName = (plant: Plant, index: number) => plant.label ?? `Plant ${index + 1}`;

// ── Selection ─────────────────────────────────────────────────────────────────

type Selection = { kind: "device"; id: string } | { kind: "plant"; id: string } | null;

const isSel = (sel: Selection, kind: "device" | "plant", id: string) => sel?.kind === kind && sel.id === id;

/** What the side list can drop onto the plan. */
const DRAG_DEVICE = "application/x-canopy-device";
const DRAG_PLANT = "application/x-canopy-plant-litres";

// ── Number field ──────────────────────────────────────────────────────────────

/**
 * A number input that commits on blur or Enter, not per keystroke.
 *
 * Per keystroke would be wrong here, not just wasteful: typing "150" over "120"
 * passes through "1" and "15", and a tent resized to 15 cm rescales every pin
 * in it before the grower has finished typing.
 */
function NumField({ value, onCommit, className, ariaLabel, min, max }: {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  ariaLabel: string;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(fmtCm(value));
  useEffect(() => setDraft(fmtCm(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(fmtCm(value));
    if (Math.round(n) !== Math.round(value)) onCommit(n);
  };

  return (
    <input
      type="number"
      className={className}
      value={draft}
      min={min}
      max={max}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(fmtCm(value)); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

// ── Enclosure bar ─────────────────────────────────────────────────────────────

function DimBar({ dims, busy, error, onCommit }: {
  dims: EnclosureDimensions;
  busy: boolean;
  error: string | null;
  onCommit: (next: EnclosureDimensions) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const commit = (key: keyof EnclosureDimensions, value: number) => {
    const next = { ...dims, [key]: Math.round(value) };
    const why = dimensionsProblem(next);
    setProblem(why);
    if (!why) onCommit(next);
  };
  const { minCm, maxFootprintCm, maxHeightCm } = ENCLOSURE_LIMITS;
  const fields: [keyof EnclosureDimensions, string, number][] = [
    ["widthCm", "W", maxFootprintCm],
    ["depthCm", "D", maxFootprintCm],
    ["heightCm", "H", maxHeightCm],
  ];

  return (
    <div className="dim-bar">
      <span className="dim-title"><Icon name="cube" size={15} /> Enclosure</span>
      <div className="dim-fields">
        {fields.map(([key, label, max], i) => (
          <span key={key} style={{ display: "contents" }}>
            {i > 0 && <span className="dim-x">×</span>}
            <div className="dim-field">
              <label>{label}</label>
              <span className="dim-input">
                <NumField
                  value={dims[key]}
                  min={minCm}
                  max={max}
                  ariaLabel={`${label === "W" ? "Width" : label === "D" ? "Depth" : "Height"} in cm`}
                  onCommit={(v) => commit(key, v)}
                />
                <span className="du">cm</span>
              </span>
            </div>
          </span>
        ))}
      </div>
      <div className="dim-meta">
        {problem || error ? (
          <span className="dim-error">{problem ?? error}</span>
        ) : (
          <Tip content="Resizing moves everything in the tent proportionally">
            <span>
              max {maxFootprintCm}×{maxFootprintCm}×{maxHeightCm}
            </span>
          </Tip>
        )}
        <span>footprint <b>{((dims.widthCm * dims.depthCm) / 1e4).toFixed(2)} m²</b></span>
        <span>volume <b>{((dims.widthCm * dims.depthCm * dims.heightCm) / 1e6).toFixed(2)} m³</b></span>
        {busy && <span>saving…</span>}
      </div>
    </div>
  );
}

// ── Plan canvas ───────────────────────────────────────────────────────────────

/**
 * The plan draws at its real pixel width, measured, so pin labels stay at their
 * CSS size whatever the window: a fixed viewBox scaled them with it, huge on a
 * wide screen and unreadable on a narrow one. The height follows the width, held
 * between a floor that keeps a small window usable and a ceiling that keeps a
 * wide one from pushing the plan off the screen.
 */
const DEFAULT_VW = 560;
const MIN_VH = 380;
const MAX_VH = 760;
const PAD = 34;

/** Grid spacing that keeps the plan legible from a 30 cm cube to a 6 m room. */
function gridStep(dims: EnclosureDimensions): number {
  const longest = Math.max(dims.widthCm, dims.depthCm);
  return longest <= 300 ? 30 : longest <= 500 ? 50 : 100;
}

interface DevicePin {
  placement: DevicePlacement;
  device: Device;
  role: RoleKind | undefined;
}

interface Drag {
  kind: "device" | "plant";
  id: string;
  xCm: number;
  yCm: number;
  moved: boolean;
}

function PlanCanvas({ dims, pins, plants, sel, onSelect, onMove, onDropDevice, onDropPlant }: {
  dims: EnclosureDimensions;
  pins: DevicePin[];
  plants: Plant[];
  sel: Selection;
  onSelect: (sel: Selection) => void;
  onMove: (kind: "device" | "plant", id: string, xCm: number, yCm: number) => void;
  onDropDevice: (deviceId: string, xCm: number, yCm: number) => void;
  onDropPlant: (litres: number, xCm: number, yCm: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const VW = useElementWidth(stageRef, DEFAULT_VW);
  const VH = Math.min(MAX_VH, Math.max(MIN_VH, Math.round(VW * 0.8)));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropping, setDropping] = useState(false);

  const plotW = VW - PAD * 2;
  const plotH = VH - PAD * 2;
  const sc = Math.min(plotW / dims.widthCm, plotH / dims.depthCm);
  const boxW = dims.widthCm * sc;
  const boxH = dims.depthCm * sc;
  const ox = PAD + (plotW - boxW) / 2;
  const oy = PAD + (plotH - boxH) / 2;
  const px = (xCm: number) => ox + xCm * sc;
  const py = (yCm: number) => oy + yCm * sc;

  const step = gridStep(dims);
  const vlines: number[] = [];
  for (let c = 0; c <= dims.widthCm; c += step) vlines.push(c);
  const hlines: number[] = [];
  for (let c = 0; c <= dims.depthCm; c += step) hlines.push(c);

  /** A pointer or drop position, in cm, clamped to the floor. */
  const toCm = (clientX: number, clientY: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * VW;
    const y = ((clientY - r.top) / r.height) * VH;
    return [clampCm((x - ox) / sc, 0, dims.widthCm), clampCm((y - oy) / sc, 0, dims.depthCm)];
  };

  const startDrag = (e: PointerEvent, kind: "device" | "plant", id: string, xCm: number, yCm: number) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    onSelect({ kind, id });
    setDrag({ kind, id, xCm, yCm, moved: false });
  };
  const moveDrag = (e: PointerEvent) => {
    if (!drag) return;
    const [xCm, yCm] = toCm(e.clientX, e.clientY);
    setDrag({ ...drag, xCm, yCm, moved: true });
  };
  // Committed once, on release: a write per pointer move would send hundreds.
  const endDrag = () => {
    if (drag?.moved) onMove(drag.kind, drag.id, drag.xCm, drag.yCm);
    setDrag(null);
  };
  const at = (kind: "device" | "plant", id: string, xCm: number, yCm: number): [number, number] =>
    drag && drag.kind === kind && drag.id === id ? [drag.xCm, drag.yCm] : [xCm, yCm];

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const [xCm, yCm] = toCm(e.clientX, e.clientY);
    const deviceId = e.dataTransfer.getData(DRAG_DEVICE);
    const litres = e.dataTransfer.getData(DRAG_PLANT);
    if (deviceId) onDropDevice(deviceId, xCm, yCm);
    else if (litres) onDropPlant(Number(litres), xCm, yCm);
  };

  return (
    <div
      className={`plan-canvas${dropping ? " drop-active" : ""}`}
      onDragOver={(e) => {
        if (![DRAG_DEVICE, DRAG_PLANT].some((t) => e.dataTransfer.types.includes(t))) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={onDrop}
    >
      <div className="drop-hint"><span><Icon name="target" size={15} /> Drop to place on plan</span></div>
      <div className="plan-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className="plan-svg"
          viewBox={`0 0 ${VW} ${VH}`}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={() => setDrag(null)}
          onClick={() => onSelect(null)}
        >
          {vlines.map((c) => (
            <line key={`v${c}`} className={c % (step * 2) === 0 ? "plan-grid-major" : "plan-grid-line"} x1={px(c)} y1={oy} x2={px(c)} y2={oy + boxH} />
          ))}
          {hlines.map((c) => (
            <line key={`h${c}`} className={c % (step * 2) === 0 ? "plan-grid-major" : "plan-grid-line"} x1={ox} y1={py(c)} x2={ox + boxW} y2={py(c)} />
          ))}
          <rect className="plan-wall" x={ox} y={oy} width={boxW} height={boxH} rx="3" fillOpacity="0" />
          <path
            className="plan-door"
            d={`M ${ox + boxW * 0.3} ${oy + boxH} A ${boxW * 0.4} ${boxW * 0.4} 0 0 1 ${ox + boxW * 0.7} ${oy + boxH}`}
          />
          <text className="plan-axis" x={ox + boxW / 2} y={oy + boxH + 22} textAnchor="middle">front · access</text>
          <text className="plan-dim-label" x={ox + boxW / 2} y={oy - 12} textAnchor="middle">{dims.widthCm} cm wide</text>
          <text
            className="plan-dim-label"
            x={ox - 12}
            y={oy + boxH / 2}
            textAnchor="middle"
            transform={`rotate(-90 ${ox - 12} ${oy + boxH / 2})`}
          >
            {dims.depthCm} cm deep
          </text>

          {/* Plants first, so device pins mounted above them stay clickable. */}
          {plants.map((plant, i) => {
            const [x, y] = at("plant", plant.id, plant.xCm, plant.yCm);
            // To scale: the pot is drawn at its real diameter, with a floor so a
            // 1 L pot in a 6 m room is still something to grab.
            const r = Math.max(7, ((potSize(plant.potLitres)?.diameterCm ?? 20) / 2) * sc);
            const selected = isSel(sel, "plant", plant.id);
            return (
              <g
                key={plant.id}
                className={`pin plant-pin${selected ? " sel" : ""}`}
                transform={`translate(${px(x)}, ${py(y)})`}
                onPointerDown={(e) => startDrag(e, "plant", plant.id, plant.xCm, plant.yCm)}
                onClick={(e) => e.stopPropagation()}
              >
                <title>{`${plantName(plant, i)} · ${potLabel(plant.potLitres)}`}</title>
                {selected && <circle className="pin-ring" r={r + 5} />}
                <circle className="plant-pot" r={r} />
                {r >= 9 && (
                  <g transform="translate(-6.5, -6.5)" style={{ color: PLANT_COLOR }}>
                    <Icon name="leaf" size={13} />
                  </g>
                )}
                <text className="pin-z" y={r + 11} textAnchor="middle">{plantName(plant, i)}</text>
              </g>
            );
          })}

          {pins.map(({ placement, device, role }) => {
            const [x, y] = at("device", device.id, placement.xCm, placement.yCm);
            const selected = isSel(sel, "device", device.id);
            const color = role ? ROLE_COLOR[role] : UNASSIGNED_COLOR;
            // Facing: 0° points at the door, clockwise seen from above.
            const rad = (placement.rotationDeg * Math.PI) / 180;
            const facing = isControlDevice(device);
            const labelW = device.name.length * 5.6 + 4;
            const flip = px(x) + 15 + labelW > VW;
            return (
              <g
                key={device.id}
                className={`pin${selected ? " sel" : ""}`}
                transform={`translate(${px(x)}, ${py(y)})`}
                onPointerDown={(e) => startDrag(e, "device", device.id, placement.xCm, placement.yCm)}
                onClick={(e) => e.stopPropagation()}
              >
                {selected && <circle className="pin-ring" r="16" />}
                {facing && (
                  <line
                    className="pin-facing"
                    x1={0}
                    y1={0}
                    x2={-Math.sin(rad) * 19}
                    y2={Math.cos(rad) * 19}
                    stroke={color}
                  />
                )}
                <circle className="pin-dot" r="11" fill={color} />
                <g transform="translate(-6.5, -6.5)" style={{ color: "#fff" }}>
                  <Icon name={roleIcon(role, device)} size={13} />
                </g>
                {/* Labels flip to the left near the right wall, where they would run off the plan. */}
                <g transform={`translate(${flip ? -15 : 15}, -6)`}>
                  <rect
                    className="pin-label-bg"
                    x={flip ? -labelW + 2 : -2}
                    y="-9"
                    width={labelW}
                    height="14"
                    rx="3"
                  />
                  <text className="pin-label" x="0" y="2" textAnchor={flip ? "end" : "start"}>{device.name}</text>
                  <text className="pin-z" x="0" y="14" textAnchor={flip ? "end" : "start"}>z {fmtCm(placement.zCm)}cm</text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Editors ───────────────────────────────────────────────────────────────────

function CmField({ label, value, max, onCommit }: {
  label: string;
  value: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div className="pe-field">
      <label>{label}</label>
      <span className="pe-num">
        <NumField value={value} min={0} max={max} ariaLabel={`${label} in cm`} onCommit={(v) => onCommit(clampCm(v, 0, max))} />
        <span className="pu">cm</span>
      </span>
    </div>
  );
}

/** Eight compass points are enough to aim a fan or square up a light. */
const FACINGS: [number, string][] = [
  [0, "Front"], [45, "Front-left"], [90, "Left"], [135, "Back-left"],
  [180, "Back"], [225, "Back-right"], [270, "Right"], [315, "Front-right"],
];

function PinEditor({ pin, dims, role, roleBusy, onChange, onRole, onRemove, onClose }: {
  pin: DevicePin;
  dims: EnclosureDimensions;
  role: RoleKind | undefined;
  roleBusy: boolean;
  onChange: (patch: Partial<Pick<DevicePlacement, "xCm" | "yCm" | "zCm" | "rotationDeg">>) => void;
  onRole: (role: RoleKind) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { placement, device } = pin;
  const meta = role ? ROLE_META[role] : undefined;
  const facing = FACINGS.reduce((best, f) =>
    Math.abs(f[0] - placement.rotationDeg) < Math.abs(best[0] - placement.rotationDeg) ? f : best,
  );

  return (
    <div className="pin-editor">
      <div className="pe-head">
        <span className="pe-dot" style={{ background: role ? ROLE_COLOR[role] : UNASSIGNED_COLOR }}>
          <Icon name={roleIcon(role, device)} size={13} />
        </span>
        <span className="pe-name">{device.name}</span>
        <Tip content="Close">
          <button className="icon-ghost2" onClick={onClose} aria-label="Close editor">
            <Icon name="x" size={13} />
          </button>
        </Tip>
      </div>
      <div className="pe-grid">
        <CmField label="X · width" value={placement.xCm} max={dims.widthCm} onCommit={(xCm) => onChange({ xCm })} />
        <CmField label="Y · depth" value={placement.yCm} max={dims.depthCm} onCommit={(yCm) => onChange({ yCm })} />
        <CmField label="Z · height" value={placement.zCm} max={dims.heightCm} onCommit={(zCm) => onChange({ zCm })} />
      </div>
      {isControlDevice(device) && (
        <div className="pe-role">
          <label>Facing</label>
          <Select value={String(facing[0])} onValueChange={(v) => onChange({ rotationDeg: Number(v) })}>
            <SelectTrigger style={{ width: "100%" }}><SelectValue /></SelectTrigger>
            <SelectContent>
              {FACINGS.map(([deg, name]) => <SelectItem key={deg} value={String(deg)}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="pe-role">
        <label>Assigned role</label>
        {/* The same route and the same role list as Settings, so the two cannot disagree. */}
        <Select
          value={role ?? ""}
          disabled={!device.online || roleBusy}
          onValueChange={(v) => onRole(v as RoleKind)}
        >
          <SelectTrigger style={{ width: "100%" }}><SelectValue placeholder="Unassigned" /></SelectTrigger>
          <SelectContent>
            {rolesFor(device).map((id) => <SelectItem key={id} value={id}>{ROLE_META[id].name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="pe-foot">
        <span className="pr-meta">
          {meta
            ? <>drives <b style={{ color: "var(--fg-default)" }}>{meta.unlocks ?? meta.name}</b></>
            : device.online ? "no automation role" : "offline — role locked"}
        </span>
        <span className="spacer" />
        <button className="btn ghost-danger sm" onClick={onRemove}>
          <Icon name="trash" size={13} /> Remove
        </button>
      </div>
    </div>
  );
}

function PotSelect({ value, onChange, width = "100%" }: {
  value: number;
  onChange: (litres: number) => void;
  width?: string | number;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger style={{ width }} aria-label="Pot size"><SelectValue /></SelectTrigger>
      <SelectContent>
        {POT_SIZES.map((pot) => (
          <SelectItem key={pot.litres} value={String(pot.litres)}>
            {pot.litres} L · ⌀{pot.diameterCm} × {pot.heightCm} cm
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PlantEditor({ plant, name, dims, onChange, onRemove, onClose }: {
  plant: Plant;
  name: string;
  dims: EnclosureDimensions;
  onChange: (patch: { xCm?: number; yCm?: number; potLitres?: number; label?: string }) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(plant.label ?? "");
  useEffect(() => setLabel(plant.label ?? ""), [plant.label]);

  return (
    <div className="pin-editor">
      <div className="pe-head">
        <span className="pe-dot" style={{ background: PLANT_COLOR }}><Icon name="leaf" size={13} /></span>
        <span className="pe-name">{name}</span>
        <Tip content="Close">
          <button className="icon-ghost2" onClick={onClose} aria-label="Close editor">
            <Icon name="x" size={13} />
          </button>
        </Tip>
      </div>
      <div className="pe-role">
        <label htmlFor={`plant-label-${plant.id}`}>Label</label>
        <input
          id={`plant-label-${plant.id}`}
          className="pe-text"
          value={label}
          placeholder={name}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label.trim() !== (plant.label ?? "") && onChange({ label })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="pe-role">
        <label>Pot size</label>
        <PotSelect value={plant.potLitres} onChange={(potLitres) => onChange({ potLitres })} />
      </div>
      <div className="pe-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <CmField label="X · width" value={plant.xCm} max={dims.widthCm} onCommit={(xCm) => onChange({ xCm })} />
        <CmField label="Y · depth" value={plant.yCm} max={dims.depthCm} onCommit={(yCm) => onChange({ yCm })} />
      </div>
      <div className="pe-foot">
        <span className="spacer" />
        <button className="btn ghost-danger sm" onClick={onRemove}>
          <Icon name="trash" size={13} /> Remove
        </button>
      </div>
    </div>
  );
}

// ── Side panels ───────────────────────────────────────────────────────────────

/**
 * A side panel (Placed, Plants, Available) that collapses to its header.
 * Whether each is open is remembered per viewer: a convenience, so browser
 * storage, and the page works without it.
 */
function Panel({ icon, title, count, children }: { icon: IconName; title: string; count: number; children: ReactNode }) {
  const key = `canopy.setup.closed.${title}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== "1"; } catch { return true; }
  });
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key, o ? "1" : "0"); } catch { /* storage unavailable */ }
      return !o;
    });
  };
  return (
    <div className={`sv-panel${open ? "" : " closed"}`}>
      <button className="svp-head" onClick={toggle} aria-expanded={open}>
        <span className="ash-chev" style={{ transform: open ? "none" : "rotate(-90deg)" }}><Icon name="chevron" size={13} /></span>
        <Icon name={icon} size={13} /><h3>{title}</h3><span className="svp-count">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

/** three.js is large, so the 3D view loads only when it is opened. */
const TentView = lazy(() => import("@/components/setup3d/TentView"));

// ── Page ──────────────────────────────────────────────────────────────────────

export function SetupView() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const dims = workspace?.dimensions;

  const { data: devices = [] } = useDevices(workspace?.id);
  const { data: roles = [] } = useRoles(workspace?.id);
  const { data: layout } = useLayout(dims ? workspace?.id : undefined);

  const patchWorkspace = usePatchWorkspace(workspaceId);
  const placeDevice = usePlaceDevice(workspaceId);
  const unplaceDevice = useUnplaceDevice(workspaceId);
  const addPlant = useAddPlant(workspaceId);
  const updatePlant = useUpdatePlant(workspaceId);
  const removePlant = useRemovePlant(workspaceId);
  const assignRole = useAssignRole(workspaceId);

  const [mode, setMode] = useState<"layout" | "3d">("layout");
  const [sel, setSel] = useState<Selection>(null);
  const [newPot, setNewPot] = useState(DEFAULT_POT_LITRES);

  useEffect(() => setSel(null), [workspaceId]);

  const roleOf = useMemo(() => {
    const byDevice = new Map<string, RoleAssignment["role"]>();
    for (const r of roles) byDevice.set(r.deviceId, r.role);
    return (deviceId: string) => byDevice.get(deviceId);
  }, [roles]);

  const pins: DevicePin[] = useMemo(() => {
    const byId = new Map(devices.map((d) => [d.id, d]));
    return (layout?.placements ?? []).flatMap((placement) => {
      const device = byId.get(placement.deviceId);
      return device ? [{ placement, device, role: roleOf(device.id) }] : [];
    });
  }, [devices, layout?.placements, roleOf]);

  const plants = layout?.plants ?? [];
  const placedIds = new Set(pins.map((p) => p.device.id));
  const available = devices.filter((d) => !placedIds.has(d.id));

  const place = (deviceId: string, xCm?: number, yCm?: number) => {
    placeDevice.mutate({ deviceId, ...(xCm !== undefined && yCm !== undefined ? { xCm, yCm } : {}) });
    setSel({ kind: "device", id: deviceId });
  };
  const plant = (potLitres: number, xCm?: number, yCm?: number) =>
    addPlant.mutate(
      { potLitres, ...(xCm !== undefined && yCm !== undefined ? { xCm, yCm } : {}) },
      { onSuccess: (p) => setSel({ kind: "plant", id: p.id }) },
    );

  const errorText = (e: unknown) => (e instanceof Error ? e.message : null);

  const crumbs = [workspace?.name ?? "Workspace", dims ? `${dims.widthCm}×${dims.depthCm}×${dims.heightCm} cm` : "Not configured", "Setup View"];

  // ── No tent yet ──
  if (workspace && !dims) {
    return (
      <>
        <ContentHeader
          title="Setup View"
          crumbs={crumbs}
          badge={<Tag variant="idle">No space</Tag>}
          actions={
            <button className="btn primary" disabled={patchWorkspace.isPending} onClick={() => patchWorkspace.mutate({ dimensions: DEFAULT_ENCLOSURE })}>
              <Icon name="plus" size={14} /> Define space
            </button>
          }
        />
        <PageBody>
          <div className="set-empty">
            <div className="se-ico"><Icon name="cube" size={28} /></div>
            <h2>No grow space defined yet</h2>
            <p>
              Set up your tent to place devices and plants in it. It starts as a 120 × 120 × 200 cm
              tent — change the width, depth and height to match yours, up to{" "}
              {ENCLOSURE_LIMITS.maxFootprintCm} × {ENCLOSURE_LIMITS.maxFootprintCm} ×{" "}
              {ENCLOSURE_LIMITS.maxHeightCm} cm — then drag your devices onto the to-scale plan, give
              each a mounting height, and mark where your plants stand.
            </p>
            <div className="se-actions">
              <button className="btn primary" disabled={patchWorkspace.isPending} onClick={() => patchWorkspace.mutate({ dimensions: DEFAULT_ENCLOSURE })}>
                <Icon name="ruler" size={14} /> Define space &amp; place devices
              </button>
            </div>
          </div>
        </PageBody>
      </>
    );
  }

  const selectedPin = sel?.kind === "device" ? pins.find((p) => p.device.id === sel.id) : undefined;
  const selectedPlantIndex = sel?.kind === "plant" ? plants.findIndex((p) => p.id === sel.id) : -1;

  return (
    <>
      <ContentHeader
        title="Setup View"
        crumbs={crumbs}
        badge={
          <Tag variant="info">
            {pins.length} device{pins.length === 1 ? "" : "s"} · {plants.length} plant{plants.length === 1 ? "" : "s"}
          </Tag>
        }
        actions={
          <div className="sv-modes">
            <button className={mode === "layout" ? "on" : ""} onClick={() => setMode("layout")}>
              <Icon name="map" size={13} /> Layout
            </button>
            <button className={mode === "3d" ? "on" : ""} onClick={() => setMode("3d")}>
              <Icon name="cube" size={13} /> 3D view
            </button>
          </div>
        }
      />

      <PageBody>
        {!workspace || !dims ? null : (
          <>
            <DimBar
              dims={dims}
              busy={patchWorkspace.isPending}
              error={errorText(patchWorkspace.error)}
              onCommit={(next) => patchWorkspace.mutate({ dimensions: next })}
            />

            {mode === "3d" ? (
              <Suspense fallback={<div className="plan-box tent-3d-loading">Loading 3D view…</div>}>
                <TentView dims={dims} devices={pins.map((p) => ({ placement: p.placement, role: p.role }))} plants={plants} />
              </Suspense>
            ) : (
              <div className="sv-layout">
                <div className="plan-box">
                  <div className="plan-head">
                    <Icon name="map" size={14} /><h3>Top-down plan</h3>
                    <span className="ph-hint"><Icon name="move" size={12} /> drag to move · drag devices and plants in from the right</span>
                  </div>
                  <PlanCanvas
                    dims={dims}
                    pins={pins}
                    plants={plants}
                    sel={sel}
                    onSelect={setSel}
                    onMove={(kind, id, xCm, yCm) =>
                      kind === "device"
                        ? placeDevice.mutate({ deviceId: id, xCm, yCm })
                        : updatePlant.mutate({ plantId: id, xCm, yCm })
                    }
                    onDropDevice={(id, x, y) => place(id, x, y)}
                    onDropPlant={(litres, x, y) => plant(litres, x, y)}
                  />
                  <div className="plan-foot">
                    <span className="plan-legend"><span className="pl-dot" style={{ background: "#f78166" }} /> Sensor</span>
                    <span className="plan-legend"><span className="pl-dot" style={{ background: "#2f81f7" }} /> Climate</span>
                    <span className="plan-legend"><span className="pl-dot" style={{ background: "#e3b341" }} /> Light</span>
                    <span className="plan-legend"><span className="pl-dot" style={{ background: "#56d364" }} /> Water</span>
                    <span className="plan-legend"><span className="pl-dot plant" /> Plant · pot to scale</span>
                    <span className="pf-scale"><Icon name="ruler" size={12} /> grid = {gridStep(dims)} cm</span>
                  </div>
                </div>

                <div className="sv-side">
                  <Panel icon="layers" title="Placed" count={pins.length}>
                    {pins.length === 0 && (
                      <div className="avail-empty">No devices placed yet.<br />Drag one from Available onto the plan.</div>
                    )}
                    {pins.map((pin) => {
                      const selected = isSel(sel, "device", pin.device.id);
                      return (
                        <div key={pin.device.id}>
                          <div
                            className={`placed-row${selected ? " sel" : ""}`}
                            onClick={() => setSel(selected ? null : { kind: "device", id: pin.device.id })}
                          >
                            <span className="pr-dot" style={{ background: pin.role ? ROLE_COLOR[pin.role] : UNASSIGNED_COLOR }}>
                              <Icon name={roleIcon(pin.role, pin.device)} size={12} />
                            </span>
                            <div className="pr-info">
                              <div className="pr-name">{pin.device.name}</div>
                              <div className="pr-meta">
                                {pin.role ? ROLE_META[pin.role].name : "unassigned"} · {fmtCm(pin.placement.xCm)},{fmtCm(pin.placement.yCm)}
                              </div>
                            </div>
                            <span className="pr-z"><Icon name="layers" size={11} /> {fmtCm(pin.placement.zCm)}cm</span>
                          </div>
                          {selected && selectedPin && (
                            <PinEditor
                              pin={selectedPin}
                              dims={dims}
                              role={selectedPin.role}
                              roleBusy={assignRole.isPending}
                              onChange={(patch) => placeDevice.mutate({ deviceId: pin.device.id, ...patch })}
                              onRole={(role) => assignRole.mutate({ role, deviceId: pin.device.id, channel: roleChannel(pin.device) })}
                              onRemove={() => { unplaceDevice.mutate(pin.device.id); setSel(null); }}
                              onClose={() => setSel(null)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </Panel>

                  <Panel icon="leaf" title="Plants" count={plants.length}>
                    {plants.map((p, i) => {
                      const selected = isSel(sel, "plant", p.id);
                      return (
                        <div key={p.id}>
                          <div
                            className={`placed-row${selected ? " sel" : ""}`}
                            onClick={() => setSel(selected ? null : { kind: "plant", id: p.id })}
                          >
                            <span className="pr-dot" style={{ background: PLANT_COLOR }}><Icon name="leaf" size={12} /></span>
                            <div className="pr-info">
                              <div className="pr-name">{plantName(p, i)}</div>
                              <div className="pr-meta">{potLabel(p.potLitres)} · {fmtCm(p.xCm)},{fmtCm(p.yCm)}</div>
                            </div>
                          </div>
                          {selected && selectedPlantIndex === i && (
                            <PlantEditor
                              plant={p}
                              name={plantName(p, i)}
                              dims={dims}
                              onChange={(patch) => updatePlant.mutate({ plantId: p.id, ...patch })}
                              onRemove={() => { removePlant.mutate(p.id); setSel(null); }}
                              onClose={() => setSel(null)}
                            />
                          )}
                        </div>
                      );
                    })}
                    <Tip content="Drag onto the plan, or press + to add mid-floor">
                      <div
                        className="avail-row plant-add"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_PLANT, String(newPot));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                      >
                        <span className="ar-grip"><Icon name="dots" size={13} /></span>
                        <span className="ar-kind" style={{ background: PLANT_COLOR }}><Icon name="leaf" size={12} /></span>
                        <div className="ar-i" onPointerDown={(e) => e.stopPropagation()} draggable={false} onDragStart={(e) => e.preventDefault()}>
                          <PotSelect value={newPot} onChange={setNewPot} />
                        </div>
                        <Tip content="Add a plant">
                          <button className="ar-add" aria-label="Add a plant" disabled={addPlant.isPending} onClick={() => plant(newPot)}>
                            <Icon name="plus" size={13} />
                          </button>
                        </Tip>
                      </div>
                    </Tip>
                    {addPlant.error && <div className="avail-empty dim-error">{errorText(addPlant.error)}</div>}
                  </Panel>

                  <Panel icon="plug" title="Available" count={available.length}>
                    {available.length === 0 && (
                      <div className="avail-empty">
                        {devices.length === 0 ? "No devices yet — scan for them in Settings." : "All devices are placed."}
                      </div>
                    )}
                    {available.map((d) => {
                      const role = roleOf(d.id);
                      return (
                        <div
                          key={d.id}
                          className="avail-row"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_DEVICE, d.id);
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                        >
                          <span className="ar-grip"><Icon name="dots" size={13} /></span>
                          <span className="ar-kind" style={{ background: role ? ROLE_COLOR[role] : UNASSIGNED_COLOR }}>
                            <Icon name={roleIcon(role, d)} size={12} />
                          </span>
                          <div className="ar-i">
                            <div className="ar-n">
                              {d.name}
                              {!d.online && <span className="tag b-idle" style={{ fontSize: 9, marginLeft: 5 }}>offline</span>}
                            </div>
                            <div className="ar-m">{role ? ROLE_META[role].name : d.model ?? d.family}</div>
                          </div>
                          <Tip content="Place on plan">
                            <button className="ar-add" aria-label={`Place ${d.name}`} onClick={() => place(d.id)}>
                              <Icon name="plus" size={13} />
                            </button>
                          </Tip>
                        </div>
                      );
                    })}
                  </Panel>
                </div>
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
