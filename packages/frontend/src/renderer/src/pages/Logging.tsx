import { useMemo, useRef, useState } from "react";
import { useElementSize } from "@/hooks/useElementWidth";
import { useQueries } from "@tanstack/react-query";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { api } from "@/lib/http";
import { METRIC_META, formatMetricValue, unitLabel } from "@/lib/metrics";
import { calcGrowStage } from "@/lib/growStage";
import { thresholdFor } from "@/lib/thresholds";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { useAutomations } from "@/hooks/useAutomations";
import {
  useChartLayouts,
  useCreateChartLayout,
  useDeleteChartLayout,
} from "@/hooks/useChartLayouts";
import { useEventsInWindow } from "@/hooks/useEvents";
import { useLiveReadings } from "@/hooks/useLiveReadings";
import { useThresholds } from "@/hooks/useThresholds";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import type { AppEvent, Metric, ReadingResolution, ReadingSeries } from "@canopy/shared-types";

// ── Ranges ────────────────────────────────────────────────────────────────────

type RangeKey = "6H" | "24H" | "7D" | "30D";

const RANGES: { key: RangeKey; ms: number; resolution: ReadingResolution; ticks: number }[] = [
  { key: "6H",  ms: 6 * 3_600_000,   resolution: "raw",    ticks: 6 },
  { key: "24H", ms: 86_400_000,      resolution: "hourly", ticks: 5 },
  { key: "7D",  ms: 7 * 86_400_000,  resolution: "hourly", ticks: 7 },
  { key: "30D", ms: 30 * 86_400_000, resolution: "daily",  ticks: 5 },
];

// ── Geometry ──────────────────────────────────────────────────────────────────

/**
 * Width before the chart has been measured. After that the chart draws at its
 * real pixel width (see useElementWidth), so text never scales with the window.
 */
const DEFAULT_W = 860;
const PAD_L = 46;
const PAD_R = 52;
const STACK_LANE_H = 86;
const STACK_GAP = 16;
/**
 * Overlay height when there is nothing to size it by. In practice the overlay
 * fills the height of the metric panel beside it (see `.chart-canvas.fill`),
 * so the two columns end level; this is the floor.
 */
const OVERLAY_MIN_LANE_H = 280;
/** Space in the SVG above the lane (event markers) and below it (time ticks). */
const OVERLAY_TOP = 6;
const OVERLAY_BOTTOM = 24;

/** Pad bounds by 12 % so a line never runs along the edge of its lane. */
function niceBounds(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.12;
  return [min - pad, max + pad];
}

interface Point { t: number; v: number; min?: number; max?: number }

/**
 * An SVG path for points placed by **time**, not by index.
 *
 * The prototype spaced its generated samples evenly. Real readings do not arrive
 * evenly, and a device that drops out for an hour would otherwise have that hour
 * compressed to the width of one sample — the gap would vanish instead of showing.
 */
function pathFor(
  points: Point[], from: number, to: number, y0: number, h: number, lo: number, hi: number, PLOT_W: number,
): string {
  const span = to - from || 1;
  const range = hi - lo || 1;
  return points
    .map((p, i) => {
      const x = PAD_L + ((p.t - from) / span) * PLOT_W;
      const y = y0 + (1 - (p.v - lo) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** The envelope between each bucket's min and max, as a closed path. */
function bandPath(
  points: Point[], from: number, to: number, y0: number, h: number, lo: number, hi: number, PLOT_W: number,
): string {
  const banded = points.filter((p) => p.min != null && p.max != null);
  if (banded.length < 2) return "";
  const span = to - from || 1;
  const range = hi - lo || 1;
  const x = (t: number) => (PAD_L + ((t - from) / span) * PLOT_W).toFixed(1);
  const y = (v: number) => (y0 + (1 - (v - lo) / range) * h).toFixed(1);

  const top = banded.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t)} ${y(p.max!)}`);
  const bottom = [...banded].reverse().map((p) => `L${x(p.t)} ${y(p.min!)}`);
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

/**
 * Average, minimum and maximum over a window.
 *
 * The extremes come from each bucket's own band where the resolution has one, so
 * a 24-hour view reports the day's real peak rather than the highest hourly
 * average — which is the whole reason the rollups store them.
 */
function stats(points: Point[]): { avg: number; min: number; max: number } | null {
  if (points.length === 0) return null;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    sum += p.v;
    min = Math.min(min, p.min ?? p.v);
    max = Math.max(max, p.max ?? p.v);
  }
  return { avg: sum / points.length, min, max };
}

/** Flatten a series to the points a lane draws, across every device it holds. */
function toPoints(series: ReadingSeries | undefined): Point[] {
  if (!series) return [];
  return series.devices
    .flatMap((device) =>
      device.points.map((p) => ({
        t: Date.parse(p.ts),
        v: p.value,
        ...(p.min != null ? { min: p.min } : {}),
        ...(p.max != null ? { max: p.max } : {}),
      })),
    )
    .sort((a, b) => a.t - b.t);
}

/**
 * Lights-off spans inside the window, derived from the photoperiod automation.
 *
 * Read off the real schedule rather than assumed. A window trigger driving the
 * `light` role already states when the lights are on, so the shading agrees with
 * what the tent actually does; the prototype's mock hard-coded a six-hour night,
 * which here would draw a confident lie. No such automation means no shading.
 */
function nightSpans(on: string, off: string, from: number, to: number): { start: number; end: number }[] {
  const minutes = (hhmm: string) => {
    const [h = "0", m = "0"] = hhmm.split(":");
    return Number(h) * 60 + Number(m);
  };
  const onMin = minutes(on);
  const offMin = minutes(off);
  if (onMin === offMin) return []; // equal times mean always on

  const spans: { start: number; end: number }[] = [];
  const DAY = 86_400_000;

  const first = new Date(from);
  first.setHours(0, 0, 0, 0);

  for (let day = first.getTime(); day < to + DAY; day += DAY) {
    // Dark runs from lights-off to the next lights-on, crossing midnight when
    // the photoperiod does.
    const darkStart = day + offMin * 60_000;
    const darkEnd = offMin < onMin ? day + onMin * 60_000 : day + DAY + onMin * 60_000;

    const start = Math.max(darkStart, from);
    const end = Math.min(darkEnd, to);
    if (end <= start) continue;

    // Times, not pixels: the chart places them at whatever width it is drawn.
    spans.push({ start, end });
  }
  return spans;
}

function tickLabels(range: RangeKey, from: number, to: number, PLOT_W: number): { x: number; label: string }[] {
  const count = RANGES.find((r) => r.key === range)!.ticks;
  const span = to - from || 1;
  const format: Intl.DateTimeFormatOptions =
    range === "6H" || range === "24H"
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short" };

  return Array.from({ length: count }, (_, i) => ({
    x: PAD_L + (i / (count - 1)) * PLOT_W,
    label: new Date(from + (i / (count - 1)) * span).toLocaleString([], format),
  }));
}

// ── Metric panel row ──────────────────────────────────────────────────────────

function MetricRow({ metric, on, series, latest, onToggle }: {
  metric: Metric;
  on: boolean;
  series: ReadingSeries | undefined;
  latest: number | undefined;
  onToggle: (metric: Metric) => void;
}) {
  const meta = METRIC_META[metric];
  const points = useMemo(() => toPoints(series), [series]);
  const summary = stats(points);
  const [lo, hi] = summary ? niceBounds(summary.min, summary.max) : [0, 1];

  // The row's sparkline has its own tiny coordinate space, so it is drawn against
  // the points' own extent rather than the chart's window.
  const sparkFrom = points[0]?.t ?? 0;
  const sparkTo = points[points.length - 1]?.t ?? 1;
  const sparkSpan = sparkTo - sparkFrom || 1;
  const sparkPath = points
    .map((p, i) => {
      const x = 1 + ((p.t - sparkFrom) / sparkSpan) * 44;
      const y = 1 + (1 - (p.v - lo) / (hi - lo || 1)) * 16;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div
      className={`metric-row ${on ? "on" : "off"}`}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onClick={() => onToggle(metric)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(metric); }
      }}
    >
      <span
        className="mr-swatch"
        style={{
          background: on ? meta.color : "transparent",
          borderColor: on ? meta.color : "var(--border-default)",
        }}
      />
      <div className="mr-info">
        <div className="mr-name">
          {meta.label}
          {meta.derived && <span className="mr-deriv">derived</span>}
        </div>
        <div className="mr-val">
          {latest != null
            ? `${formatMetricValue(latest, metric)} ${unitLabel(series?.unit ?? "")}`
            : "—"}
        </div>
      </div>
      <svg className="mr-spark" viewBox="0 0 46 18" preserveAspectRatio="none" aria-hidden>
        {points.length >= 2 && (
          <path
            d={sparkPath}
            fill="none"
            stroke={on ? meta.color : "var(--fg-subtle)"}
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span className="mr-eye"><Icon name={on ? "eye" : "minus"} size={15} /></span>
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────────────

// ── Event markers ─────────────────────────────────────────────────────────────

/**
 * Which toggle an event type falls under.
 *
 * Alerts are their own group, and off by default: the out-of-range marks
 * already show when a reading left its band, and drawing every alert as a line
 * as well is what buried the chart under dashes.
 */
type EventGroup = "automations" | "alerts" | "devices" | "grow";

const EVENT_GROUP: Record<AppEvent["type"], EventGroup> = {
  automation_fired: "automations",
  automation_failed: "automations",
  failsafe_trip: "automations",
  threshold_alert: "alerts",
  device_online: "devices",
  device_offline: "devices",
  stage_changed: "grow",
  mode_changed: "grow",
  milestone_reached: "grow",
  maintenance_done: "grow",
  maintenance_due: "grow",
};

const EVENT_GROUPS: { key: EventGroup; label: string }[] = [
  { key: "automations", label: "Automations" },
  { key: "alerts", label: "Alerts" },
  { key: "devices", label: "Devices" },
  { key: "grow", label: "Grow" },
];

/** Markers closer than this (in viewBox units) merge into one. Wider than a count marker (12), so two never overlap. */
const CLUSTER_GAP = 14;

interface EventCluster {
  x: number;
  events: AppEvent[];
  severity: "err" | "warn" | undefined;
}

/**
 * Merge markers that would sit on top of each other.
 *
 * At a week's range an hour is a few units wide, so a dozen events in an hour
 * would otherwise draw a dozen overlapping dashes. One marker with a count
 * says the same thing, and the tooltip lists what it holds.
 */
export function clusterEvents(
  events: AppEvent[],
  from: number,
  to: number,
  plotX: number,
  plotW: number,
  gap = CLUSTER_GAP,
): EventCluster[] {
  const span = to - from || 1;
  const placed = events
    .map((event) => ({ event, x: plotX + ((Date.parse(event.occurredAt) - from) / span) * plotW }))
    .filter(({ x }) => x >= plotX && x <= plotX + plotW)
    .sort((a, b) => a.x - b.x);

  const clusters: EventCluster[] = [];
  let group: { x: number; event: AppEvent }[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const severity = group.some((g) => g.event.severity === "err")
      ? "err"
      : group.some((g) => g.event.severity === "warn") ? "warn" : undefined;
    clusters.push({
      x: group.reduce((sum, g) => sum + g.x, 0) / group.length,
      events: group.map((g) => g.event).reverse(),
      severity,
    });
    group = [];
  };
  for (const item of placed) {
    if (group.length && item.x - group[0]!.x > gap) flush();
    group.push(item);
  }
  flush();
  return clusters;
}

function ChartPanel({
  metrics, seriesFor, mode, range, from, to, latest,
  opts, night, targets, events, eventGroups, onToggleEventGroup, onToggleOpt, svgRef,
}: {
  metrics: Metric[];
  seriesFor: (m: Metric) => ReadingSeries | undefined;
  mode: "overlay" | "stack";
  range: RangeKey;
  from: number;
  to: number;
  latest: Map<Metric, number>;
  opts: { night: boolean; targets: boolean; oor: boolean };
  night: { start: number; end: number }[];
  targets: Map<Metric, [number, number]>;
  events: AppEvent[];
  eventGroups: Set<EventGroup>;
  onToggleEventGroup: (group: EventGroup) => void;
  onToggleOpt: (key: "night" | "targets" | "oor") => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvas = useElementSize(canvasRef, { width: DEFAULT_W, height: OVERLAY_MIN_LANE_H + OVERLAY_TOP + OVERLAY_BOTTOM });
  const W = canvas.width;
  const PLOT_W = W - PAD_L - PAD_R;

  const lanes = mode === "stack" ? metrics.map((m) => [m]) : [metrics];
  // Overlay fills whatever height the row gives it; stack lanes keep their
  // fixed height, so the chart grows with the number of metrics instead.
  const laneH = mode === "stack"
    ? STACK_LANE_H
    : Math.max(OVERLAY_MIN_LANE_H, canvas.height - OVERLAY_TOP - OVERLAY_BOTTOM);
  const laneGap = mode === "stack" ? STACK_GAP : 0;
  const totalH = lanes.length * laneH + Math.max(0, lanes.length - 1) * laneGap;
  const ticks = tickLabels(range, from, to, PLOT_W);
  const span = to - from || 1;

  const clusters = useMemo(
    () => clusterEvents(events.filter((e) => eventGroups.has(EVENT_GROUP[e.type] ?? "grow")), from, to, PAD_L, PLOT_W),
    [events, eventGroups, from, to, PLOT_W],
  );

  /**
   * Bounds per axis, so metrics sharing a scale are drawn against one.
   *
   * This is what stops overlay being a dual-axis chart in the misleading sense:
   * humidity and soil moisture are both percentages and compare directly, while
   * CO₂ keeps its own scale.
   */
  const boundsFor = (laneMetrics: Metric[]): Map<string, [number, number]> => {
    const byAxis = new Map<string, [number, number]>();
    for (const axis of new Set(laneMetrics.map((m) => METRIC_META[m].axis))) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const metric of laneMetrics.filter((m) => METRIC_META[m].axis === axis)) {
        for (const p of toPoints(seriesFor(metric))) {
          min = Math.min(min, p.min ?? p.v);
          max = Math.max(max, p.max ?? p.v);
        }
        // A target band has to be visible even when the reading never reaches it.
        const target = targets.get(metric);
        if (opts.targets && target) {
          min = Math.min(min, target[0]);
          max = Math.max(max, target[1]);
        }
      }
      byAxis.set(axis, niceBounds(min, max));
    }
    return byAxis;
  };

  const inPlot = hoverX != null && hoverX >= PAD_L && hoverX <= PAD_L + PLOT_W;
  const hoverCluster = inPlot
    ? clusters.find((c) => Math.abs(c.x - hoverX!) <= CLUSTER_GAP / 2 + 2)
    : undefined;
  const hoverTime = inPlot ? from + ((hoverX! - PAD_L) / PLOT_W) * span : null;

  /** The reading nearest the crosshair, per metric. */
  const readout = hoverTime == null
    ? []
    : metrics.map((metric) => {
        let best: Point | undefined;
        let bestGap = Number.POSITIVE_INFINITY;
        for (const p of toPoints(seriesFor(metric))) {
          const gap = Math.abs(p.t - hoverTime);
          if (gap < bestGap) { bestGap = gap; best = p; }
        }
        return { metric, point: best };
      });

  return (
    <div className="chart-box">
      <div className="chart-head">
        <div className="ch-legend">
          {metrics.map((metric) => {
            const value = latest.get(metric);
            return (
              <span className="cl-item" key={metric}>
                <span className="cl-line" style={{ background: METRIC_META[metric].color }} />
                <b>{METRIC_META[metric].label}</b>
                {value != null &&
                  ` ${formatMetricValue(value, metric)}${unitLabel(seriesFor(metric)?.unit ?? "")}`}
              </span>
            );
          })}
          {metrics.length === 0 && (
            <span className="cl-item">No metrics selected — toggle some on the left</span>
          )}
        </div>
        <div className="chart-opts">
          <Tip content={night.length === 0
              ? "Needs a photoperiod automation to know when the lights are off"
              : "Shade lights-off periods"}>
            <button
              className={`copt${opts.night ? " on" : ""}`}
              onClick={() => onToggleOpt("night")}
              disabled={night.length === 0}
            >
              <span className="swatch-sq cf-hatch" /> Night
            </button>
          </Tip>
          <Tip content="Draw target bands from your thresholds">
            <button
              className={`copt${opts.targets ? " on" : ""}`}
              onClick={() => onToggleOpt("targets")}
            >
              <Icon name="target" size={12} /> Targets
            </button>
          </Tip>
          <Tip content="Mark readings outside their target">
            <button
              className={`copt${opts.oor ? " on" : ""}`}
              onClick={() => onToggleOpt("oor")}
            >
              Out-of-range
            </button>
          </Tip>
          <span className="copt-sep" aria-hidden />
          {EVENT_GROUPS.map(({ key, label }) => (
            <Tip key={key} content={`${eventGroups.has(key) ? "Hide" : "Show"} ${label.toLowerCase()} on the timeline`}>
              <button
                className={`copt${eventGroups.has(key) ? " on" : ""}`}
                onClick={() => onToggleEventGroup(key)}
                aria-pressed={eventGroups.has(key)}
              >
                <span className="copt-tick" /> {label}
              </button>
            </Tip>
          ))}
        </div>
      </div>

      <div className={`chart-canvas${mode === "overlay" ? " fill" : ""}`} ref={canvasRef}>
        <svg
          ref={svgRef}
          className="chart-svg"
          // Overlay draws in exactly the measured box (lane + the 6 px above it +
          // the tick row below), so the browser never rescales it.
          viewBox={`0 0 ${W} ${mode === "overlay" ? laneH + OVERLAY_TOP + OVERLAY_BOTTOM : totalH + 24}`}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoverX(((e.clientX - rect.left) / rect.width) * W);
          }}
          onPointerLeave={() => setHoverX(null)}
        >
          <defs>
            <pattern
              id="nightHatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="transparent" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--fg-muted)" strokeWidth="1" opacity="0.25" />
            </pattern>
          </defs>

          {lanes.map((laneMetrics, laneIndex) => {
            const y0 = laneIndex * (laneH + laneGap) + 6;
            const axisBounds = boundsFor(laneMetrics);
            const leftMetric = laneMetrics.find((m) => METRIC_META[m].side === "left");
            const rightMetric = laneMetrics.find((m) => METRIC_META[m].side === "right");

            return (
              <g key={laneIndex}>
                {opts.night && night.map((band, i) => (
                  <rect key={i} className="night-hatch" x={PAD_L + ((band.start - from) / span) * PLOT_W} y={y0}
                    width={((band.end - band.start) / span) * PLOT_W} height={laneH} />
                ))}

                {/* Solid hairlines. The prototype dashed these; a dashed grid
                    reads as a threshold or a projection when it is neither, and
                    the target bands are what should carry a dash. */}
                {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                  <line
                    key={g}
                    className="grid-line"
                    x1={PAD_L}
                    y1={y0 + g * laneH}
                    x2={PAD_L + PLOT_W}
                    y2={y0 + g * laneH}
                  />
                ))}

                {opts.targets && laneMetrics.map((metric) => {
                  const target = targets.get(metric);
                  const bounds = axisBounds.get(METRIC_META[metric].axis);
                  if (!target || !bounds) return null;
                  const [lo, hi] = bounds;
                  const scale = hi - lo || 1;
                  const yTop = y0 + (1 - (target[1] - lo) / scale) * laneH;
                  const yBottom = y0 + (1 - (target[0] - lo) / scale) * laneH;
                  const color = METRIC_META[metric].color;
                  return (
                    <g key={`target-${metric}`}>
                      <rect
                        x={PAD_L}
                        y={yTop}
                        width={PLOT_W}
                        height={Math.max(0, yBottom - yTop)}
                        fill={color}
                        opacity="0.07"
                      />
                      <line className="target-band-l" x1={PAD_L} y1={yTop} x2={PAD_L + PLOT_W} y2={yTop}
                        stroke={color} opacity="0.5" />
                      <line className="target-band-l" x1={PAD_L} y1={yBottom} x2={PAD_L + PLOT_W} y2={yBottom}
                        stroke={color} opacity="0.5" />
                    </g>
                  );
                })}

                {laneMetrics.map((metric) => {
                  const meta = METRIC_META[metric];
                  const bounds = axisBounds.get(meta.axis);
                  if (!bounds) return null;
                  const [lo, hi] = bounds;
                  const scale = hi - lo || 1;
                  const points = toPoints(seriesFor(metric));
                  if (points.length < 2) return null;
                  const target = targets.get(metric);
                  const last = points[points.length - 1]!;

                  return (
                    <g key={metric}>
                      {/* One lane per metric leaves room for the rollup's
                          min–max envelope; overlaying several would be mud. */}
                      {mode === "stack" && (
                        <path
                          d={bandPath(points, from, to, y0, laneH, lo, hi, PLOT_W)}
                          fill={meta.color}
                          opacity="0.12"
                          stroke="none"
                        />
                      )}
                      <path
                        d={pathFor(points, from, to, y0, laneH, lo, hi, PLOT_W)}
                        fill="none"
                        stroke={meta.color}
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      {opts.oor && target && points.map((p, i) => {
                        const low = p.min ?? p.v;
                        const high = p.max ?? p.v;
                        if (low >= target[0] && high <= target[1]) return null;
                        return (
                          <circle
                            key={i}
                            cx={PAD_L + ((p.t - from) / span) * PLOT_W}
                            cy={y0 + (1 - (p.v - lo) / scale) * laneH}
                            r="2.5"
                            fill="var(--danger-fg)"
                            stroke="var(--canvas-default)"
                            strokeWidth="1"
                          />
                        );
                      })}
                      {/* A direct end-label, so identity never rests on colour
                          alone. It matters most in overlay, where the palette
                          cannot separate every metric. */}
                      {mode === "overlay" && (
                        <text
                          className="lane-end-label"
                          x={PAD_L + PLOT_W + 5}
                          y={y0 + (1 - (last.v - lo) / scale) * laneH + 3}
                          fill={meta.color}
                        >
                          {meta.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Axis units: the first metric on each side names the scale. */}
                {leftMetric && (
                  <text className="axis-unit" x={PAD_L - 6} y={y0 + 9} textAnchor="end">
                    {unitLabel(seriesFor(leftMetric)?.unit ?? "")}
                  </text>
                )}
                {rightMetric && mode === "overlay" && (
                  <text className="axis-unit" x={PAD_L + PLOT_W + 6} y={y0 + 9}>
                    {unitLabel(seriesFor(rightMetric)?.unit ?? "")}
                  </text>
                )}
                {mode === "stack" && laneMetrics[0] && (
                  <text className="lane-label" x={PAD_L + 5} y={y0 + 12}>
                    {METRIC_META[laneMetrics[0]].label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Events, placed by when they happened; close ones merged. */}
          {clusters.map((cluster) => {
            const color =
              cluster.severity === "err" ? "var(--danger-fg)"
              : cluster.severity === "warn" ? "var(--attention-fg)"
              : "var(--fg-muted)";
            const many = cluster.events.length > 1;
            return (
              <g key={cluster.events[0]!.id}>
                <line x1={cluster.x} y1={6} x2={cluster.x} y2={totalH} stroke={color} strokeWidth="1"
                  strokeDasharray="2 3" opacity="0.5" />
                <circle cx={cluster.x} cy={6} r={many ? 6 : 3} fill={color} />
                {many && (
                  <text className="ev-count" x={cluster.x} y={9} textAnchor="middle">
                    {cluster.events.length > 99 ? "99+" : cluster.events.length}
                  </text>
                )}
              </g>
            );
          })}

          {/* The crosshair finds the time, so the reader never aims at a 2px line. */}
          {inPlot && (
            <line x1={hoverX!} y1={6} x2={hoverX!} y2={totalH} stroke="var(--fg-subtle)" strokeWidth="1" />
          )}

          {ticks.map((tick, i) => (
            <text key={i} className="axis-tick" x={tick.x} y={totalH + 18} textAnchor="middle">
              {tick.label}
            </text>
          ))}
        </svg>

        {hoverTime != null && (
          <div
            className="lg-tip"
            style={{
              left: `${((hoverX! + 14) / W) * 100}%`,
              top: 10,
              // Flip left near the right edge so the readout is never clipped.
              ...(hoverX! > PAD_L + PLOT_W * 0.72 ? { transform: "translateX(-108%)" } : {}),
            }}
          >
            <div className="lg-tip-when">{new Date(hoverTime).toLocaleString()}</div>
            {hoverCluster && (
              <div className="lg-tip-events">
                {hoverCluster.events.slice(0, 5).map((e) => (
                  <div key={e.id} className={`lg-tip-event${e.severity ? ` ${e.severity}` : ""}`}>
                    <span>{new Date(e.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    {/* An automation's description is only what it did ("on (06:00–18:00)"),
                        so it needs its name; device events and alerts carry their own. */}
                    {EVENT_GROUP[e.type] === "automations" && e.sourceLabel ? <b>{e.sourceLabel} · </b> : null}
                    {e.description}
                  </div>
                ))}
                {hoverCluster.events.length > 5 && (
                  <div className="lg-tip-event more">+{hoverCluster.events.length - 5} more</div>
                )}
              </div>
            )}
            {readout.map(({ metric, point }) =>
              point == null ? null : (
                <div className="lg-tip-row" key={metric}>
                  <span className="lg-tip-key" style={{ background: METRIC_META[metric].color }} />
                  <b>{formatMetricValue(point.v, metric)}</b>
                  <span className="lg-tip-unit">{unitLabel(seriesFor(metric)?.unit ?? "")}</span>
                  <span className="lg-tip-name">{METRIC_META[metric].label}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** One row per timestamp, one column per metric — the shape a spreadsheet wants. */
function toCsv(metrics: Metric[], seriesFor: (m: Metric) => ReadingSeries | undefined): string {
  const rows = new Map<string, Map<Metric, number>>();
  for (const metric of metrics) {
    for (const device of seriesFor(metric)?.devices ?? []) {
      for (const point of device.points) {
        const row = rows.get(point.ts) ?? new Map<Metric, number>();
        row.set(metric, point.value);
        rows.set(point.ts, row);
      }
    }
  }
  const header = [
    "timestamp",
    ...metrics.map((m) => `${METRIC_META[m].label} (${unitLabel(seriesFor(m)?.unit ?? "")})`),
  ];
  const body = [...rows.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ts, row]) => [ts, ...metrics.map((m) => row.get(m) ?? "")].join(","));
  return [header.join(","), ...body].join("\n");
}

/**
 * Rasterise the chart's own SVG.
 *
 * No extra dependency: the markup is already in the document, so it is cloned,
 * given an opaque surface — a transparent PNG of a dark-theme chart is unreadable
 * wherever it lands — and drawn to a canvas at 2× for legibility.
 */
async function exportPng(svg: SVGSVGElement | null, name: string): Promise<void> {
  if (!svg) return;

  const surface = getComputedStyle(document.body).backgroundColor || "#0d1117";
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("style", `background:${surface}`);

  const source = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("could not rasterise the chart"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  });

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = (svg.viewBox.baseVal.width || DEFAULT_W) * scale;
  canvas.height = (svg.viewBox.baseVal.height || OVERLAY_MIN_LANE_H) * scale;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = surface;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => { if (blob) download(name, blob); }, "image/png");
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Logging() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";

  const [range, setRange] = useState<RangeKey>("24H");
  const [mode, setMode] = useState<"overlay" | "stack">("overlay");
  const [hidden, setHidden] = useState<Set<Metric>>(new Set());
  const [opts, setOpts] = useState({ night: true, targets: true, oor: true });
  const [eventGroups, setEventGroups] = useState<Set<EventGroup>>(
    () => new Set<EventGroup>(["automations", "devices", "grow"]),
  );
  const [saving, setSaving] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const [activeLayout, setActiveLayout] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const readings = useLiveReadings(workspace?.id);
  const { data: thresholds = [] } = useThresholds(workspace?.id);
  const { data: automations = [] } = useAutomations(workspace?.id);
  const { data: layouts = [] } = useChartLayouts(workspace?.id);
  const { data: grow } = useActiveGrow();
  const createLayout = useCreateChartLayout(workspaceId);
  const deleteLayout = useDeleteChartLayout(workspaceId);

  const growStage = grow ? calcGrowStage(grow) : undefined;

  /** Metrics the tent actually reports, in catalogue order, with latest values. */
  const { available, latest } = useMemo(() => {
    const seen = new Map<Metric, number>();
    for (const reading of readings.values()) {
      if (!seen.has(reading.metric)) seen.set(reading.metric, reading.value);
    }
    return {
      available: (Object.keys(METRIC_META) as Metric[]).filter((m) => seen.has(m)),
      latest: seen,
    };
  }, [readings]);

  const visible = available.filter((m) => !hidden.has(m));

  const window_ = useMemo(() => {
    const config = RANGES.find((r) => r.key === range)!;
    const to = Date.now();
    return { from: to - config.ms, to, resolution: config.resolution };
  }, [range]);

  const { data: events = [] } = useEventsInWindow(workspace?.id, range, window_.from, window_.to);

  const results = useQueries({
    queries: visible.map((metric) => ({
      queryKey: ["series", workspaceId, metric, range],
      queryFn: () =>
        api("POST /readings/series", {
          body: {
            workspaceId,
            metric,
            from: new Date(window_.from).toISOString(),
            to: new Date(window_.to).toISOString(),
            resolution: window_.resolution,
          },
        }),
      enabled: !!workspaceId,
      staleTime: 60_000,
    })),
  });

  // Built each render rather than memoised: `useQueries` returns a fresh array
  // every time, so any dependency list over it would either lie or never hit.
  // It is a handful of entries.
  const seriesByMetric = new Map<Metric, ReadingSeries>();
  visible.forEach((metric, i) => {
    const data = results[i]?.data;
    if (data) seriesByMetric.set(metric, data);
  });
  const seriesFor = (metric: Metric) => seriesByMetric.get(metric);
  // Refetching holds the previous render at reduced opacity rather than showing a
  // skeleton, so changing range never blanks the page or reflows it.
  const fetching = results.some((r) => r.isFetching);

  /** Target bands, from the thresholds in force for the current stage. */
  const targets = useMemo(() => {
    const map = new Map<Metric, [number, number]>();
    for (const metric of available) {
      const band = thresholdFor(metric, thresholds, growStage?.stage);
      if (band) map.set(metric, [band.minValue, band.maxValue]);
    }
    return map;
  }, [available, thresholds, growStage?.stage]);

  /** Lights-off spans, from the photoperiod automation if one exists. */
  const night = useMemo(() => {
    const photoperiod = automations.find(
      (a) => a.enabled && a.trigger.kind === "window" && a.actions.some((x) => x.role === "light"),
    );
    if (!photoperiod || photoperiod.trigger.kind !== "window") return [];
    return nightSpans(photoperiod.trigger.on, photoperiod.trigger.off, window_.from, window_.to);
  }, [automations, window_]);

  const toggle = (metric: Metric) => {
    setActiveLayout(null);
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  };

  const applyLayout = (id: string, metrics: Metric[]) => {
    setActiveLayout(id);
    setHidden(new Set(available.filter((m) => !metrics.includes(m))));
  };

  const saveLayout = () => {
    const name = layoutName.trim();
    if (!name) return;
    createLayout.mutate(
      { name, metrics: visible },
      {
        onSuccess: (created) => {
          setActiveLayout(created.id);
          setSaving(false);
          setLayoutName("");
        },
      },
    );
  };

  const rawMetrics = available.filter((m) => !METRIC_META[m].derived);
  const derivedMetrics = available.filter((m) => METRIC_META[m].derived);

  return (
    <>
      <ContentHeader
        title="Logging"
        crumbs={[
          workspace?.name ?? "Workspace",
          ...(grow && growStage ? [`${grow.name} · Day ${growStage.totalDay}`] : []),
          "Logging",
        ]}
        badge={
          available.length > 0 ? (
            <span className="tag b-info">
              {visible.length} metric{visible.length === 1 ? "" : "s"} · {range}
            </span>
          ) : null
        }
        actions={
          available.length > 0 ? (
            <>
              <button
                className="btn sm"
                disabled={visible.length === 0}
                onClick={() =>
                  download(
                    `canopy-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
                    new Blob([toCsv(visible, seriesFor)], { type: "text/csv;charset=utf-8" }),
                  )
                }
              >
                <Icon name="external" size={13} /> CSV
              </button>
              <button
                className="btn sm"
                disabled={visible.length === 0}
                onClick={() => void exportPng(svgRef.current, `canopy-${range}.png`)}
              >
                <Icon name="camera" size={13} /> PNG
              </button>
            </>
          ) : null
        }
      />

      <PageBody>
        {!workspace ? null : available.length === 0 ? (
          <EmptyState
            icon="logging"
            title="No sensor history yet"
            description="Charts are drawn from the readings your devices report. Once a sensor is paired and sending, its history appears here."
          />
        ) : (
          <>
            <div className="chart-toolbar">
              <div className="segmented">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    className={range === r.key ? "on" : ""}
                    onClick={() => setRange(r.key)}
                  >
                    {r.key}
                  </button>
                ))}
              </div>

              <div className="seg-mode">
                <button className={mode === "overlay" ? "on" : ""} onClick={() => setMode("overlay")}>
                  <Icon name="logging" size={13} /> Overlay
                </button>
                <button className={mode === "stack" ? "on" : ""} onClick={() => setMode("stack")}>
                  <Icon name="journal" size={13} /> Stack
                </button>
              </div>

              <div className="ct-spacer" />

              <div className="layout-tabs">
                {layouts.map((layout) => (
                  <button
                    key={layout.id}
                    className={`layout-chip${activeLayout === layout.id ? " on" : ""}`}
                    onClick={() => applyLayout(layout.id, layout.metrics)}
                  >
                    <Icon name="pin" size={11} /> {layout.name}
                    <span
                      className="lc-x"
                      onClick={(e) => { e.stopPropagation(); deleteLayout.mutate(layout.id); }}
                    >
                      <Icon name="x" size={10} />
                    </span>
                  </button>
                ))}
                <Tip content="Save the current selection as a layout">
                  <button
                    className="layout-add"
                    onClick={() => setSaving((v) => !v)}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                </Tip>
              </div>
            </div>

            {saving && (
              <div className="save-layout-row">
                <Icon name="pin" size={14} />
                <input
                  className="tf-name"
                  autoFocus
                  placeholder="Layout name (e.g. Climate, Root zone)…"
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveLayout();
                    if (e.key === "Escape") { setSaving(false); setLayoutName(""); }
                  }}
                />
                <span className="mr-val">{visible.length} metrics</span>
                <button className="btn primary sm" onClick={saveLayout} disabled={!layoutName.trim()}>
                  <Icon name="check" size={13} /> Save layout
                </button>
                <button className="btn sm" onClick={() => { setSaving(false); setLayoutName(""); }}>
                  Cancel
                </button>
              </div>
            )}

            {visible.length > 0 && (
              <div className="stat-strip">
                {visible.map((metric) => {
                  const summary = stats(toPoints(seriesFor(metric)));
                  const meta = METRIC_META[metric];
                  const unit = unitLabel(seriesFor(metric)?.unit ?? "");
                  return (
                    <div className="stat-card" key={metric}>
                      <div className="sc-top">
                        <span className="sc-sw" style={{ background: meta.color }} />
                        <span className="sc-name">{meta.label}</span>
                        {/* The unit sits by the name, not after the average, where a
                            five-digit lux reading pushed it onto a second line. */}
                        {unit && <span className="sc-unit">{unit}</span>}
                        {meta.derived && <span className="sc-deriv">deriv</span>}
                      </div>
                      <div className="sc-stats">
                        {([
                          ["avg", summary?.avg, "var(--fg-default)"],
                          ["min", summary?.min, "var(--accent-fg)"],
                          ["max", summary?.max, "var(--danger-fg)"],
                        ] as const).map(([key, value, color]) => {
                          const text = value != null ? formatMetricValue(value, metric) : "—";
                          return (
                            <div className="sc-stat" key={key}>
                              <span className="sc-k">{key}</span>
                              {/* Truncates only as a last resort; the full value is on hover. */}
                              <Tip content={value != null ? `${text} ${unit}` : undefined}>
                                <span className="sc-v" style={{ color }}>
                                  {text}
                                </span>
                              </Tip>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className={`log-layout${mode === "overlay" ? " overlay" : ""}`}>
              <div className="metric-panel">
                <div className="mp-head">
                  <Icon name="logging" size={13} />
                  <h3>Metrics</h3>
                  <span className="mp-count">{visible.length}/{available.length}</span>
                </div>

                <div className="mp-group-l">Raw channels</div>
                {rawMetrics.map((metric) => (
                  <MetricRow
                    key={metric}
                    metric={metric}
                    on={!hidden.has(metric)}
                    series={seriesFor(metric)}
                    latest={latest.get(metric)}
                    onToggle={toggle}
                  />
                ))}

                <div className="mp-group-l">Derived</div>
                {derivedMetrics.length === 0 ? (
                  <div className="mp-empty">
                    VPD appears once the canopy temperature and humidity roles are assigned in
                    Settings.
                  </div>
                ) : (
                  derivedMetrics.map((metric) => (
                    <MetricRow
                      key={metric}
                      metric={metric}
                      on={!hidden.has(metric)}
                      series={seriesFor(metric)}
                      latest={latest.get(metric)}
                      onToggle={toggle}
                    />
                  ))
                )}

                <div className="mp-foot">
                  <span className="mr-val" style={{ color: "var(--fg-subtle)" }}>
                    Axis grouping {mode === "overlay" ? "shares similar scales" : "one lane per metric"}
                  </span>
                </div>
              </div>

              <div
                className="chart-wrap"
                style={{ opacity: fetching ? 0.6 : 1, transition: "opacity .15s" }}
              >
                <ChartPanel
                  metrics={visible}
                  seriesFor={seriesFor}
                  mode={mode}
                  range={range}
                  from={window_.from}
                  to={window_.to}
                  latest={latest}
                  opts={opts}
                  night={night}
                  targets={targets}
                  events={events}
                  eventGroups={eventGroups}
                  onToggleEventGroup={(group) =>
                    setEventGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                  onToggleOpt={(key) => setOpts((p) => ({ ...p, [key]: !p[key] }))}
                  svgRef={svgRef}
                />
              </div>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
