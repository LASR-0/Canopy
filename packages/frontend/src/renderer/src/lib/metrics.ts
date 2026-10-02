/**
 * Metric display catalogue — the name, colour and icon for each measured
 * quantity.
 *
 * Shared for the same reason the role catalogue is: Overview labels a reading
 * card with it and Automation labels the metric a rule watches, and the two
 * naming the same quantity differently would be a bug the type system cannot
 * see. Keyed by `Metric` with no index signature, so a metric added to the
 * domain and missed here is a compile error.
 *
 * Value *formatting* — units and decimal places — stays with the reading cards
 * that do the formatting; this is the display identity of the metric only.
 */
import type { Metric } from "@canopy/shared-types";
import type { IconName } from "@/components/Icon";

export interface MetricMeta {
  label: string;
  color: string;
  icon: IconName;
  /**
   * Which scale this metric shares in overlay mode.
   *
   * Metrics on the same axis are drawn against one set of bounds — humidity and
   * soil moisture are both percentages, so they compare directly. Metrics on
   * different axes get their own. This is what keeps overlay from being a
   * dual-axis chart in the misleading sense: the grouping is by what the numbers
   * *are*, not by what happens to be plotted together.
   */
  axis: string;
  /** Which side that axis is labelled on, so several can be read at once. */
  side: "left" | "right";
  /** Computed by the controller rather than read from a device. */
  derived?: boolean;
}

/**
 * Colours are Primer steps taken from the prototype, which is the design of
 * record. The app previously carried invented hexes that appear nowhere in it —
 * that drift is why they failed contrast on the light theme.
 *
 * Seven come straight from the prototype's own Logging palette. `ph`, `ec`,
 * `power` and `water_level` are metrics it does not chart; those were stepped to
 * Primer values and checked with the dataviz validator for separation against the
 * seven.
 *
 * The palette cannot carry every metric at once, and does not pretend to: with
 * all ten on one plot the validator fails `vpd` against `humidity` for
 * protanopia and `ppfd` against `soil_moisture` for normal vision. Overlay mode
 * therefore never relies on colour alone — the legend carries each name and
 * value, the metric panel shows a swatch per row, and lines are labelled at their
 * end. Stack mode is the answer for many metrics at once: one lane each, one hue
 * per lane, nothing to tell apart.
 *
 * `lux` and `ppfd` are the same quantity in different units, so a device reports
 * one or the other and never both; they are stepped apart but are not expected to
 * share a plot.
 */
export const METRIC_META: Record<Metric, MetricMeta> = {
  temperature:    { label: "Air temp", color: "#f78166", icon: "temp", axis: "temp", side: "left" },
  humidity:       { label: "Humidity", color: "#2f81f7", icon: "drop", axis: "pct", side: "left" },
  co2:            { label: "CO\u2082", color: "#3fb950", icon: "co2", axis: "co2", side: "right" },
  vpd:            { label: "VPD", color: "#a371f7", icon: "vpd", axis: "vpd", side: "left", derived: true },
  soil_moisture:  { label: "Soil moisture", color: "#d29922", icon: "leaf", axis: "pct", side: "left" },
  ph:             { label: "pH", color: "#39c5cf", icon: "beaker", axis: "ph", side: "left" },
  ec:             { label: "EC", color: "#d2a8ff", icon: "beaker", axis: "ec", side: "right" },
  lux:            { label: "Lux", color: "#ffa657", icon: "sun", axis: "lux", side: "right" },
  ppfd:           { label: "Light \u00b7 PPFD", color: "#e3b341", icon: "sun", axis: "ppfd", side: "right" },
  power:          { label: "Power", color: "#f85149", icon: "power", axis: "power", side: "right" },
  water_level:    { label: "Water level", color: "#79c0ff", icon: "ruler", axis: "pct", side: "left" },
  // The prototype's own DLI colour and axis. One point per day, never stored
  // (backend device-manager/dli.ts).
  dli:            { label: "DLI", color: "#56d364", icon: "sun", axis: "dli", side: "right", derived: true },
};

export function metricLabel(metric: Metric): string {
  return METRIC_META[metric]?.label ?? metric;
}

/** Unit symbols for display. Keyed loosely: the API's unit strings are data. */
export const UNIT_DISPLAY: Record<string, string> = {
  C: "°C", F: "°F", percent: "%", ppm: "ppm", kPa: "kPa",
  pH: "pH", mS_cm: "mS/cm", lux: "lux", umol_m2s: "µmol/m²s",
  W: "W", L: "L", mol_m2d: "mol/m²/d",
};

export function unitLabel(unit: string): string {
  return UNIT_DISPLAY[unit] ?? unit;
}

/**
 * Significant decimals per metric.
 *
 * A pH to one decimal loses the distinction the grower is managing; a CO₂ ppm to
 * two invents precision the sensor does not have.
 */
const METRIC_DECIMALS: Partial<Record<Metric, number>> = {
  temperature: 1, humidity: 1, vpd: 2, ph: 2, ec: 2, soil_moisture: 1, water_level: 1, dli: 1,
};

export function metricDecimals(metric: Metric): number {
  return METRIC_DECIMALS[metric] ?? 0;
}

export function formatMetricValue(value: number, metric: Metric): string {
  return value.toFixed(metricDecimals(metric));
}
