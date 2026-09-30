import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import type { EventGroup } from "@/lib/events";
import { useTabRequest } from "@/shell/navigation";
import { LogsTab } from "./logging/LogsTab";
import { ActivityTab } from "./logging/ActivityTab";
import { ReportModal } from "./logging/ReportModal";
import {
  ChartPanel,
  MetricRow,
  RANGES,
  download,
  exportPng,
  nightSpans,
  stats,
  toCsv,
  toPoints,
  type RangeKey,
} from "./logging/chart";
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
import { useActiveWorkspace, useAppSettings } from "@/hooks/useWorkspace";
import type { ChartLayout, Metric, ReadingSeries } from "@canopy/shared-types";

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * Graph is the chart. Logs is what went wrong, Activity is everything that
 * happened; the Overview's previews link into both.
 */
const TABS = [
  { id: "graph", label: "Graph" },
  { id: "logs", label: "Logs" },
  { id: "activity", label: "Activity" },
] as const;
export type LoggingTab = (typeof TABS)[number]["id"];

export function Logging() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";

  const [tab, setTab] = useState<LoggingTab>("graph");
  useTabRequest("logging", (t) => {
    if (TABS.some((x) => x.id === t)) setTab(t as LoggingTab);
  });

  const [range, setRange] = useState<RangeKey>("24H");
  const [mode, setMode] = useState<"overlay" | "stack">("overlay");
  const [hidden, setHidden] = useState<Set<Metric>>(new Set());
  const [opts, setOpts] = useState({ night: true, targets: true, oor: true });
  const [eventGroups, setEventGroups] = useState<Set<EventGroup>>(
    () => new Set<EventGroup>(["automations", "devices", "grow"]),
  );
  const [saving, setSaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { data: settings } = useAppSettings();
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

  /** The photoperiod, from the light's window automation if one exists. */
  const photoperiod = useMemo(() => {
    const auto = automations.find(
      (a) => a.enabled && a.trigger.kind === "window" && a.actions.some((x) => x.role === "light"),
    );
    return auto && auto.trigger.kind === "window" ? { on: auto.trigger.on, off: auto.trigger.off } : undefined;
  }, [automations]);

  /** Lights-off spans in the window. */
  const night = useMemo(
    () => (photoperiod ? nightSpans(photoperiod.on, photoperiod.off, window_.from, window_.to) : []),
    [photoperiod, window_],
  );

  const toggle = (metric: Metric) => {
    setActiveLayout(null);
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) next.delete(metric);
      else next.add(metric);
      return next;
    });
  };

  /** A template sets the metrics and, when it holds one, how the chart is drawn. The range stays. */
  const applyLayout = (layout: ChartLayout) => {
    setActiveLayout(layout.id);
    setHidden(new Set(available.filter((m) => !layout.metrics.includes(m))));
    if (layout.view) {
      setMode(layout.view.mode);
      setOpts(layout.view.options);
      setEventGroups(new Set(layout.view.eventGroups));
    }
  };

  // Changing how the chart is drawn leaves the template it came from.
  const changeView = <T,>(set: (value: T) => void) => (value: T) => {
    setActiveLayout(null);
    set(value);
  };

  const saveLayout = () => {
    const name = layoutName.trim();
    if (!name) return;
    createLayout.mutate(
      { name, metrics: visible, view: { mode, options: opts, eventGroups: [...eventGroups] } },
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
          tab === "graph" && available.length > 0 ? (
            <span className="tag b-info">
              {visible.length} metric{visible.length === 1 ? "" : "s"} · {range}
            </span>
          ) : null
        }
        actions={
          <>
            <div className="j-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "graph" && available.length > 0 ? (
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
              <button className="btn sm" onClick={() => setReportOpen(true)}>
                <Icon name="logging" size={13} /> Report…
              </button>
            </>
            ) : null}
          </>
        }
      />

      {workspace && (
        <ReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          growName={grow?.name}
          growStartedAt={grow?.startedAt}
          available={available}
          initialMetrics={visible}
          targets={targets}
          photoperiod={photoperiod}
          rawRetentionDays={settings?.rawRetentionDays ?? 7}
        />
      )}

      <PageBody>
        {!workspace ? null : tab === "logs" ? (
          <LogsTab workspaceId={workspace.id} />
        ) : tab === "activity" ? (
          <ActivityTab workspaceId={workspace.id} />
        ) : available.length === 0 ? (
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
                <button className={mode === "overlay" ? "on" : ""} onClick={() => changeView(setMode)("overlay")}>
                  <Icon name="logging" size={13} /> Overlay
                </button>
                <button className={mode === "stack" ? "on" : ""} onClick={() => changeView(setMode)("stack")}>
                  <Icon name="journal" size={13} /> Stack
                </button>
              </div>

              <div className="ct-spacer" />

              <div className="layout-tabs">
                {layouts.map((layout) => (
                  <button
                    key={layout.id}
                    className={`layout-chip${activeLayout === layout.id ? " on" : ""}`}
                    onClick={() => applyLayout(layout)}
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
                <Tip content="Save this chart as a template: metrics, mode, options and markers">
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
                  placeholder="Template name (e.g. Climate, Root zone)…"
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveLayout();
                    if (e.key === "Escape") { setSaving(false); setLayoutName(""); }
                  }}
                />
                <span className="mr-val">{visible.length} metrics</span>
                <button className="btn primary sm" onClick={saveLayout} disabled={!layoutName.trim()}>
                  <Icon name="check" size={13} /> Save template
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
                    changeView(setEventGroups)((prev: Set<EventGroup>) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                  onToggleOpt={(key) => changeView(setOpts)((p: typeof opts) => ({ ...p, [key]: !p[key] }))}
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
