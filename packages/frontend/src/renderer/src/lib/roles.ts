/**
 * The role catalogue — display names and which roles sense versus act.
 *
 * Shared because two screens now depend on agreeing about it: Settings assigns
 * a role to a device, and Automation targets one. A second copy would drift,
 * and the drift would show up as an automation naming a role the assignment
 * screen never offers.
 *
 * `RoleKind` is the source of truth for which roles exist; this adds only what
 * the UI needs on top of it, so a role added to the type and missed here fails
 * the exhaustiveness check in `ROLE_META`.
 */
import type { Metric, RoleKind } from "@canopy/shared-types";
import type { AutomationSubsystem } from "@canopy/shared-types";

export interface RoleMeta {
  name: string;
  /** `sense` roles feed automations; `control` roles are what an action drives. */
  kind: "sense" | "control";
  /** What assigning this role makes possible. Control roles only. */
  unlocks?: string;
  /** The metric a sensing role reports, used to pre-fill a rule trigger. */
  metric?: Metric;
  /** Which group an automation driving this role belongs to. */
  subsystem?: AutomationSubsystem;
}

/**
 * Keyed by `RoleKind` with no index signature, so adding a role to the type
 * without describing it here is a compile error rather than a blank dropdown.
 */
export const ROLE_META: Record<RoleKind, RoleMeta> = {
  // ── Sensing ────────────────────────────────────────────────────────────────
  canopy_temp:   { name: "Canopy temp",        kind: "sense",   metric: "temperature" },
  canopy_rh:     { name: "Canopy humidity",    kind: "sense",   metric: "humidity" },
  canopy_light:  { name: "Canopy light level", kind: "sense",   metric: "lux" },
  rootzone:      { name: "Root-zone moisture", kind: "sense",   metric: "soil_moisture" },
  co2_probe:     { name: "CO₂ probe",          kind: "sense",   metric: "co2" },
  res_temp:      { name: "Reservoir temp",     kind: "sense",   metric: "temperature" },
  res_ph:        { name: "Reservoir pH",       kind: "sense",   metric: "ph" },
  res_ec:        { name: "Reservoir EC",       kind: "sense",   metric: "ec" },
  power_draw:    { name: "Power draw",         kind: "sense",   metric: "power" },

  // ── Equipment ──────────────────────────────────────────────────────────────
  exhaust:       { name: "Exhaust fan",     kind: "control", unlocks: "VPD / temp control",   subsystem: "airflow" },
  intake:        { name: "Intake fan",      kind: "control", unlocks: "fresh-air exchange",   subsystem: "airflow" },
  circ:          { name: "Circulation fan", kind: "control", unlocks: "air mixing",           subsystem: "airflow" },
  light:         { name: "Grow light",      kind: "control", unlocks: "photoperiod schedule", subsystem: "lighting" },
  pump:          { name: "Water pump",      kind: "control", unlocks: "irrigation cycles",    subsystem: "irrigation" },
  humidifier:    { name: "Humidifier",      kind: "control", unlocks: "humidity hold",        subsystem: "climate" },
  dehumidifier:  { name: "Dehumidifier",    kind: "control", unlocks: "humidity hold",        subsystem: "climate" },
  co2_valve:     { name: "CO₂ valve",       kind: "control", unlocks: "CO₂ dosing",           subsystem: "co2" },
  heater:        { name: "Heater",          kind: "control", unlocks: "temp floor",           subsystem: "climate" },
};

/** Every role id, in catalogue order — sensing first, then equipment. */
export const ROLE_IDS = Object.keys(ROLE_META) as RoleKind[];

export const CONTROL_ROLES = ROLE_IDS.filter((id) => ROLE_META[id].kind === "control");
export const SENSE_ROLES = ROLE_IDS.filter((id) => ROLE_META[id].kind === "sense");

/** Display name, falling back to the raw id so an unknown value is still legible. */
export function roleName(role: string): string {
  return ROLE_META[role as RoleKind]?.name ?? role;
}

/**
 * Which group an automation belongs to, from the equipment it drives.
 *
 * Derived rather than asked: a grower picking "Grow light" has already said this
 * is a lighting automation, and a second question that can contradict the first
 * is a way for the list to end up mis-grouped.
 */
export function subsystemForRole(role: RoleKind | undefined): AutomationSubsystem {
  return (role && ROLE_META[role]?.subsystem) ?? "lighting";
}
