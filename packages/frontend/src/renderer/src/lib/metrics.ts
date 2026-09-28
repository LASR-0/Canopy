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
}

export const METRIC_META: Record<Metric, MetricMeta> = {
  temperature:   { label: "Temperature",   color: "#e07b39", icon: "temp"    },
  humidity:      { label: "Humidity",      color: "#4a9eda", icon: "drop"    },
  co2:           { label: "CO₂",           color: "#4caf7d", icon: "co2"     },
  vpd:           { label: "VPD",           color: "#a67cd6", icon: "vpd"     },
  soil_moisture: { label: "Soil Moisture", color: "#8d7a5f", icon: "leaf"    },
  ph:            { label: "pH",            color: "#26b8c8", icon: "beaker"  },
  ec:            { label: "EC",            color: "#f5a623", icon: "beaker"  },
  lux:           { label: "Lux",           color: "#e8c53a", icon: "sun"     },
  ppfd:          { label: "PPFD",          color: "#e8c53a", icon: "sun"     },
  power:         { label: "Power",         color: "#e05252", icon: "power"   },
  water_level:   { label: "Water Level",   color: "#4a9eda", icon: "ruler"   },
};

export function metricLabel(metric: Metric): string {
  return METRIC_META[metric]?.label ?? metric;
}
