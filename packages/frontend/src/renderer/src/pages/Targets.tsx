import { useMemo, useState } from "react";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Tag } from "@/components/Tag";
import { Toggle } from "@/components/Toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { useLiveReadings } from "@/hooks/useLiveReadings";
import {
  useDeleteThreshold,
  useResetAlertSetting,
  useSaveAlertSetting,
  useSaveThreshold,
  useThresholdAlerts,
  useThresholds,
} from "@/hooks/useThresholds";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { calcGrowStage } from "@/lib/growStage";
import { METRIC_META, metricDecimals, unitLabel } from "@/lib/metrics";
import {
  ALERT_LIMITS,
  alertSettingFor,
  bandProblem,
  thresholdFor,
  type GrowStageName,
  type Metric,
  type SensorThreshold,
  type ThresholdAlertSetting,
  type Unit,
} from "@canopy/shared-types";

/**
 * Starting points, taken from the prototype's own `LG_METRICS` targets.
 *
 * Offered as a prefill on a band that has never been set, never silently saved:
 * a target the grower did not choose would drive alerts and rules they never
 * asked for. Metrics the prototype does not chart have no suggestion here rather
 * than a horticultural figure invented on their behalf.
 */
const SUGGESTED: Partial<Record<Metric, [number, number]>> = {
  temperature:   [22, 26],
  humidity:      [55, 65],
  co2:           [700, 1000],
  soil_moisture: [45, 60],
  ppfd:          [500, 700],
  vpd:           [0.8, 1.2],
};

/** "" is the default band; a stage overrides it while the grow is in that stage. */
type Scope = GrowStageName | "";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "",           label: "All stages" },
  { value: "seedling",   label: "Seedling" },
  { value: "vegetative", label: "Veg" },
  { value: "flowering",  label: "Flower" },
  { value: "flush",      label: "Flush" },
];

/** Delay presets. A select rather than a seconds field: nobody thinks of a door left open in seconds. */
const DELAYS: [number, string][] = [
  [0, "Immediately"], [30, "30 s"], [60, "1 min"], [120, "2 min"], [300, "5 min"],
  [600, "10 min"], [900, "15 min"], [1800, "30 min"], [3600, "1 hour"],
];

const fmt = (metric: Metric, v: number) => v.toFixed(metricDecimals(metric));

interface MetricRow {
  metric: Metric;
  unit: Unit | undefined;
  /** Reported by a sensor right now, as opposed to only having a stored band. */
  live: boolean;
}

// ── Ranges ────────────────────────────────────────────────────────────────────

function CellEditor({ metric, unit, initial, suggestion, busy, onSave, onCancel }: {
  metric: Metric;
  unit: string;
  initial?: SensorThreshold | undefined;
  suggestion?: [number, number] | undefined;
  busy: boolean;
  onSave: (min: number, max: number) => void;
  onCancel: () => void;
}) {
  const [min, setMin] = useState(initial ? String(initial.minValue) : "");
  const [max, setMax] = useState(initial ? String(initial.maxValue) : "");
  const [error, setError] = useState<string | null>(null);
  const step = metricDecimals(metric) > 0 ? 0.1 : 1;

  const save = () => {
    const problem = min.trim() === "" || max.trim() === "" ? "Enter both a minimum and a maximum" : bandProblem(Number(min), Number(max));
    if (problem) return setError(problem);
    onSave(Number(min), Number(max));
  };

  return (
    <div
      className="tr-edit"
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="tr-edit-row">
        <input
          className="au-num"
          type="number"
          step={step}
          autoFocus
          value={min}
          placeholder={suggestion ? String(suggestion[0]) : "min"}
          aria-label={`${METRIC_META[metric].label} minimum`}
          onChange={(e) => { setMin(e.target.value); setError(null); }}
        />
        <span className="th-dash">–</span>
        <input
          className="au-num"
          type="number"
          step={step}
          value={max}
          placeholder={suggestion ? String(suggestion[1]) : "max"}
          aria-label={`${METRIC_META[metric].label} maximum`}
          onChange={(e) => { setMax(e.target.value); setError(null); }}
        />
        <span className="th-unit">{unit}</span>
      </div>
      {error && <div className="th-error"><Icon name="alert" size={11} /> {error}</div>}
      <div className="tr-edit-row">
        {suggestion && !initial && (
          <button className="th-suggest" onClick={() => { setMin(String(suggestion[0])); setMax(String(suggestion[1])); }}>
            use {suggestion[0]}–{suggestion[1]}
          </button>
        )}
        <span className="spacer" />
        <button className="btn sm" onClick={onCancel}>Cancel</button>
        <button className="btn primary sm" disabled={busy} onClick={save}>
          <Icon name="check" size={12} /> Save
        </button>
      </div>
    </div>
  );
}

function RangesView({ workspaceId, rows, thresholds, currentStage }: {
  workspaceId: string;
  rows: MetricRow[];
  thresholds: SensorThreshold[];
  currentStage: GrowStageName | undefined;
}) {
  const save = useSaveThreshold(workspaceId);
  const remove = useDeleteThreshold(workspaceId);
  const [editing, setEditing] = useState<{ metric: Metric; scope: Scope } | null>(null);

  const stored = (metric: Metric, scope: Scope) =>
    thresholds.find((t) => t.metric === metric && (t.stage ?? "") === scope);

  return (
    <>
      <p className="th-intro">
        A target range decides when a reading counts as drifting or breached. It colours the sensor
        cards on the Overview, draws the bands on Logging, and is what a threshold alert fires
        against — nothing is judged until one is set. <b>All stages</b> is the default; a stage
        column overrides it while the grow is in that stage.
      </p>

      <div className="tr-grid" role="table" aria-label="Target ranges by grow stage">
        <div className="tr-row tr-head" role="row">
          <span role="columnheader">Metric</span>
          {SCOPES.map((s) => (
            <span
              role="columnheader"
              key={s.value || "default"}
              className={s.value && s.value === currentStage ? "tr-now" : undefined}
            >
              {s.label}
              {s.value && s.value === currentStage && <span className="tr-now-tag">now</span>}
            </span>
          ))}
        </div>

        {rows.map(({ metric, unit: reportedUnit, live }) => {
          const meta = METRIC_META[metric];
          const unit = unitLabel(reportedUnit ?? thresholds.find((t) => t.metric === metric)?.unit ?? "");
          const fallback = stored(metric, "");
          const inForce = thresholdFor(metric, thresholds, currentStage);

          return (
            <div className="tr-row" role="row" key={metric}>
              <span className="tr-metric" role="rowheader">
                <span className="th-ico" style={{ background: `${meta.color}22`, color: meta.color }}>
                  <Icon name={meta.icon} size={13} />
                </span>
                <span>
                  <span className="th-name">{meta.label}</span>
                  <span className="th-sub">{live ? unit || "—" : "no sensor reporting"}</span>
                </span>
              </span>

              {SCOPES.map(({ value: scope }) => {
                const band = stored(metric, scope);
                const isEditing = editing?.metric === metric && editing.scope === scope;
                const now = scope !== "" && scope === currentStage;
                // Marks the one band judging readings right now: the current
                // stage's override if it has one, otherwise the default.
                const applies = !!band && band.id === inForce?.id;

                if (isEditing) {
                  return (
                    <span role="cell" key={scope || "default"} className={`tr-cell editing${now ? " tr-now" : ""}`}>
                      <CellEditor
                        metric={metric}
                        unit={unit}
                        initial={band}
                        suggestion={scope === "" ? SUGGESTED[metric] : fallback ? [fallback.minValue, fallback.maxValue] : SUGGESTED[metric]}
                        busy={save.isPending}
                        onCancel={() => setEditing(null)}
                        onSave={(minValue, maxValue) =>
                          save.mutate(
                            {
                              // The server upserts by metric and stage; the id is used only for a new band.
                              id: band?.id ?? crypto.randomUUID(),
                              workspaceId,
                              metric,
                              minValue,
                              maxValue,
                              unit: reportedUnit ?? band?.unit ?? fallback?.unit ?? "percent",
                              ...(scope ? { stage: scope } : {}),
                            },
                            { onSuccess: () => setEditing(null) },
                          )
                        }
                      />
                    </span>
                  );
                }

                return (
                  <span
                    role="cell"
                    key={scope || "default"}
                    className={`tr-cell${band ? " set" : ""}${now ? " tr-now" : ""}${applies ? " applies" : ""}`}
                  >
                    <button
                      className="tr-value"
                      onClick={() => setEditing({ metric, scope })}
                      title={band ? "Edit" : scope ? "Override the default for this stage" : "Set a default range"}
                    >
                      {band ? (
                        <>{fmt(metric, band.minValue)}–{fmt(metric, band.maxValue)} <small>{unit}</small></>
                      ) : scope && fallback ? (
                        <span className="tr-inherit">↳ default</span>
                      ) : (
                        <span className="tr-unset">{scope ? "—" : "not set"}</span>
                      )}
                    </button>
                    {band && (
                      <button
                        className="tr-clear"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(band.id)}
                        title={scope ? "Clear override — this stage uses the default again" : "Remove the default range"}
                        aria-label={scope ? `Clear ${meta.label} ${scope} override` : `Remove ${meta.label} default range`}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="tr-legend">
        <span><i className="tr-swatch applies" /> in force right now</span>
        <span><span className="tr-inherit">↳ default</span> stage uses the All stages range</span>
        <span><Icon name="x" size={10} /> clear an override</span>
        {!currentStage && <span>No grow is running, so the All stages column is the one in force.</span>}
      </div>
    </>
  );
}

// ── Alerts ────────────────────────────────────────────────────────────────────

function MarginField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) { setLastValue(value); setDraft(String(value)); }

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === "") return setDraft(String(value));
    const clamped = Math.min(ALERT_LIMITS.maxWarnMarginPct, Math.max(0, Math.round(n)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <span className="pe-num tr-margin">
      <input
        type="number"
        min={0}
        max={ALERT_LIMITS.maxWarnMarginPct}
        value={draft}
        aria-label="Warning margin in percent"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="pu">%</span>
    </span>
  );
}

function AlertsView({ workspaceId, rows, thresholds, settings, currentStage }: {
  workspaceId: string;
  rows: MetricRow[];
  thresholds: SensorThreshold[];
  settings: ThresholdAlertSetting[];
  currentStage: GrowStageName | undefined;
}) {
  const save = useSaveAlertSetting(workspaceId);
  const reset = useResetAlertSetting(workspaceId);

  return (
    <>
      <p className="th-intro">
        How each metric's alerts behave once it has a range. Alerts are the lines in the activity
        feed when a reading drifts or breaches, and again when it recovers. Turning a metric's
        alerts off silences the feed only — the card still colours and the band still draws.
      </p>

      <div className="tr-grid tr-alerts" role="table" aria-label="Alert behaviour by metric">
        <div className="tr-row tr-head" role="row">
          <span role="columnheader">Metric</span>
          <span role="columnheader">Alerts</span>
          <span role="columnheader">Drifting warning</span>
          <span role="columnheader">Report after</span>
          <span role="columnheader" />
        </div>
        {rows.map(({ metric, unit: reportedUnit }) => {
          const meta = METRIC_META[metric];
          const behaviour = alertSettingFor(metric, settings);
          const custom = settings.some((s) => s.metric === metric);
          const band = thresholdFor(metric, thresholds, currentStage);
          const unit = unitLabel(reportedUnit ?? band?.unit ?? "");
          const shoulder = band ? ((band.maxValue - band.minValue) * behaviour.warnMarginPct) / 100 : undefined;

          return (
            <div className={`tr-row${behaviour.enabled ? "" : " off"}`} role="row" key={metric}>
              <span className="tr-metric" role="rowheader">
                <span className="th-ico" style={{ background: `${meta.color}22`, color: meta.color }}>
                  <Icon name={meta.icon} size={13} />
                </span>
                <span>
                  <span className="th-name">{meta.label}</span>
                  <span className="th-sub">{band ? `${fmt(metric, band.minValue)}–${fmt(metric, band.maxValue)} ${unit}` : "no range set — nothing to alert on"}</span>
                </span>
              </span>

              <span role="cell">
                <Toggle on={behaviour.enabled} onChange={(enabled) => save.mutate({ metric, enabled })} />
              </span>

              <span role="cell" className="tr-margin-cell">
                <MarginField value={behaviour.warnMarginPct} onCommit={(warnMarginPct) => save.mutate({ metric, warnMarginPct })} />
                <span className="th-sub">
                  {behaviour.warnMarginPct === 0
                    ? "breaches only"
                    : shoulder !== undefined
                      ? `within ${fmt(metric, shoulder)} ${unit} of an edge`
                      : "of the range width"}
                </span>
              </span>

              <span role="cell">
                <Select value={String(behaviour.delaySec)} onValueChange={(v) => save.mutate({ metric, delaySec: Number(v) })}>
                  <SelectTrigger style={{ width: 140 }} aria-label={`${meta.label} alert delay`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DELAYS.map(([sec, label]) => <SelectItem key={sec} value={String(sec)}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </span>

              <span role="cell" className="tr-reset">
                {custom && (
                  <button className="tr-reset-btn" onClick={() => reset.mutate(metric)} disabled={reset.isPending}>
                    reset
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="tr-legend">
        <span>Defaults: alerts on, a 10 % drifting margin, reported immediately.</span>
        <span>A delay holds back a worse reading until it has lasted that long; recoveries are reported at once.</span>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Targets() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const readings = useLiveReadings(workspace?.id);
  const { data: thresholds = [] } = useThresholds(workspace?.id);
  const { data: settings = [] } = useThresholdAlerts(workspace?.id);
  const { data: grow } = useActiveGrow();
  const [view, setView] = useState<"ranges" | "alerts">("ranges");

  const currentStage = grow ? calcGrowStage(grow)?.stage : undefined;

  /**
   * One row per metric: those a sensor reports now, then any with a stored band
   * but no sensor — so a range left behind by a removed sensor can still be seen
   * and cleared. Deduplicated: two temperature sensors share one band.
   */
  const rows = useMemo(() => {
    const byMetric = new Map<Metric, MetricRow>();
    for (const r of readings.values()) {
      if (!byMetric.has(r.metric)) byMetric.set(r.metric, { metric: r.metric, unit: r.unit, live: true });
    }
    for (const t of thresholds) {
      if (!byMetric.has(t.metric)) byMetric.set(t.metric, { metric: t.metric, unit: t.unit, live: false });
    }
    const order = Object.keys(METRIC_META) as Metric[];
    return [...byMetric.values()].sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric));
  }, [readings, thresholds]);

  const setCount = new Set(thresholds.map((t) => t.metric)).size;

  return (
    <>
      <ContentHeader
        title="Target ranges"
        crumbs={[workspace?.name ?? "Workspace", currentStage ? `In ${currentStage}` : "No grow running", "Target ranges"]}
        badge={<Tag variant={setCount ? "info" : "idle"}>{setCount} of {rows.length} set</Tag>}
        actions={
          <div className="sv-modes">
            <button className={view === "ranges" ? "on" : ""} onClick={() => setView("ranges")}>
              <Icon name="target" size={13} /> Ranges
            </button>
            <button className={view === "alerts" ? "on" : ""} onClick={() => setView("alerts")}>
              <Icon name="bell" size={13} /> Alerts
            </button>
          </div>
        }
      />
      <PageBody>
        {!workspace ? null : rows.length === 0 ? (
          <EmptyState
            icon="target"
            title="Nothing to set a range for yet"
            description="Ranges are set per metric, and the metrics come from your sensors. Once a sensor is reporting, its metric appears here."
          />
        ) : view === "ranges" ? (
          <RangesView workspaceId={workspaceId} rows={rows} thresholds={thresholds} currentStage={currentStage} />
        ) : (
          <AlertsView
            workspaceId={workspaceId}
            rows={rows}
            thresholds={thresholds}
            settings={settings}
            currentStage={currentStage}
          />
        )}
      </PageBody>
    </>
  );
}
