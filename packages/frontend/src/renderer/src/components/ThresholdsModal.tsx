import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { METRIC_META, metricDecimals, unitLabel } from "@/lib/metrics";
import { useSaveThreshold } from "@/hooks/useThresholds";
import type { GrowStageName, Metric, SensorThreshold, Unit } from "@canopy/shared-types";

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

/** `undefined` is the workspace default; a stage narrows it. */
const SCOPES: { value: GrowStageName | ""; label: string }[] = [
  { value: "",           label: "All stages" },
  { value: "seedling",   label: "Seedling" },
  { value: "vegetative", label: "Vegetative" },
  { value: "flowering",  label: "Flowering" },
  { value: "flush",      label: "Flush" },
];

interface Draft { min: string; max: string }

export function ThresholdsModal({ open, onClose, workspaceId, metrics, thresholds, unitFor }: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Metrics the tent actually reports — a band for an unmeasured one does nothing. */
  metrics: Metric[];
  thresholds: SensorThreshold[];
  /** The unit the device reports, so the band is stored in the sensor's own terms. */
  unitFor: (metric: Metric) => Unit | undefined;
}) {
  const [scope, setScope] = useState<GrowStageName | "">("");
  const [drafts, setDrafts] = useState<Map<Metric, Draft>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const save = useSaveThreshold(workspaceId);

  /** The band stored for this exact scope, if any. */
  const storedFor = (metric: Metric) =>
    thresholds.find((t) => t.metric === metric && (t.stage ?? "") === scope);

  /** The band that would apply here today, used to show what is inherited. */
  const inheritedFor = (metric: Metric) =>
    scope === "" ? undefined : thresholds.find((t) => t.metric === metric && !t.stage);

  const draftFor = (metric: Metric): Draft => {
    const draft = drafts.get(metric);
    if (draft) return draft;
    const stored = storedFor(metric);
    return stored
      ? { min: String(stored.minValue), max: String(stored.maxValue) }
      : { min: "", max: "" };
  };

  const setDraft = (metric: Metric, patch: Partial<Draft>) => {
    setError(null);
    setDrafts((prev) => new Map(prev).set(metric, { ...draftFor(metric), ...patch }));
  };

  // Switching scope abandons drafts: they were entered against a different band,
  // and carrying them across would silently write them to the wrong scope.
  const changeScope = (next: GrowStageName | "") => {
    setScope(next);
    setDrafts(new Map());
    setError(null);
  };

  const dirty = useMemo(() => {
    const out: { metric: Metric; min: number; max: number }[] = [];
    for (const [metric, draft] of drafts) {
      if (draft.min.trim() === "" && draft.max.trim() === "") continue;
      const min = Number(draft.min);
      const max = Number(draft.max);
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      const stored = storedFor(metric);
      if (stored && stored.minValue === min && stored.maxValue === max) continue;
      out.push({ metric, min, max });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, thresholds, scope]);

  const commit = async () => {
    // Both halves, and the right way round. A band saved inverted would mark
    // every reading out of range and alert on all of them.
    for (const [metric, draft] of drafts) {
      const hasOne = draft.min.trim() !== "" || draft.max.trim() !== "";
      if (!hasOne) continue;
      if (draft.min.trim() === "" || draft.max.trim() === "") {
        setError(`${METRIC_META[metric].label} needs both a minimum and a maximum.`);
        return;
      }
      if (Number(draft.min) >= Number(draft.max)) {
        setError(`${METRIC_META[metric].label}: the minimum must be below the maximum.`);
        return;
      }
    }

    for (const row of dirty) {
      const stored = storedFor(row.metric);
      await save.mutateAsync({
        // An existing band keeps its id so the upsert updates it rather than
        // adding a second band for the same metric and scope.
        id: stored?.id ?? crypto.randomUUID(),
        workspaceId,
        metric: row.metric,
        minValue: row.min,
        maxValue: row.max,
        unit: unitFor(row.metric) ?? "percent",
        ...(scope ? { stage: scope } : {}),
      });
    }
    setDrafts(new Map());
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Target ranges"
      icon="target"
      footer={
        <>
          {error && <span className="th-error"><Icon name="alert" size={12} /> {error}</span>}
          <span className="rule" />
          <button className="btn sm" onClick={onClose}>Cancel</button>
          <button
            className="btn primary sm"
            onClick={() => void commit()}
            disabled={dirty.length === 0 || save.isPending}
          >
            <Icon name="check" size={13} />
            {dirty.length === 0 ? "Save" : `Save ${dirty.length} change${dirty.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <p className="th-intro">
        A target range decides when a reading counts as drifting or breached. It colours the
        sensor cards on the Overview, draws the bands on Logging, and is what a threshold
        alert fires against — nothing is judged until one is set.
      </p>

      <div className="th-scope">
        <span className="tf-label">Applies to</span>
        <div className="tf-chips">
          {SCOPES.map((option) => (
            <button
              key={option.value || "all"}
              className={`tf-chip${scope === option.value ? " on" : ""}`}
              aria-pressed={scope === option.value}
              onClick={() => changeScope(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="th-hint">
          {scope === ""
            ? "The default band, used whenever no stage-specific one is set."
            : "Overrides the default while the grow is in this stage."}
        </p>
      </div>

      <div className="th-rows">
        {metrics.length === 0 && (
          <div className="th-empty">
            No sensors are reporting yet, so there is nothing to set a target for.
          </div>
        )}
        {metrics.map((metric) => {
          const meta = METRIC_META[metric];
          const draft = draftFor(metric);
          const stored = storedFor(metric);
          const inherited = inheritedFor(metric);
          const suggestion = SUGGESTED[metric];
          const unit = unitLabel(unitFor(metric) ?? "");
          const step = metricDecimals(metric) > 0 ? 0.1 : 1;

          return (
            <div className="th-row" key={metric}>
              <span className="th-ico" style={{ background: `${meta.color}22`, color: meta.color }}>
                <Icon name={meta.icon} size={13} />
              </span>
              <div className="th-meta">
                <div className="th-name">{meta.label}</div>
                <div className="th-sub">
                  {stored
                    ? `set ${stored.minValue}–${stored.maxValue} ${unit}`
                    : inherited
                      ? `inherits ${inherited.minValue}–${inherited.maxValue} ${unit}`
                      : "not set"}
                </div>
              </div>

              <input
                className="au-num"
                type="number"
                step={step}
                placeholder={suggestion ? String(suggestion[0]) : "min"}
                value={draft.min}
                onChange={(e) => setDraft(metric, { min: e.target.value })}
                aria-label={`${meta.label} minimum`}
              />
              <span className="th-dash">–</span>
              <input
                className="au-num"
                type="number"
                step={step}
                placeholder={suggestion ? String(suggestion[1]) : "max"}
                value={draft.max}
                onChange={(e) => setDraft(metric, { max: e.target.value })}
                aria-label={`${meta.label} maximum`}
              />
              <span className="th-unit">{unit}</span>

              {suggestion && !stored && (
                <button
                  className="th-suggest"
                  title={`Use ${suggestion[0]}–${suggestion[1]} ${unit}`}
                  onClick={() =>
                    setDraft(metric, { min: String(suggestion[0]), max: String(suggestion[1]) })
                  }
                >
                  use {suggestion[0]}–{suggestion[1]}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
