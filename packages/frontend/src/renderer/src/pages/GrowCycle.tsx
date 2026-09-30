import { useMemo, useState } from "react";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { Icon } from "@/components/Icon";
import { Tag } from "@/components/Tag";
import { Tip } from "@/components/Tip";
import { STAGE_DEFS, calcGrowStage } from "@/lib/growStage";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { useAutomations } from "@/hooks/useAutomations";
import { useCreateGrow, useGrowTemplates, useGrows, usePatchGrow } from "@/hooks/useGrows";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import type { GrowCycle, GrowStageName } from "@canopy/shared-types";

// ── Stage definitions ─────────────────────────────────────────────────────────

/**
 * The four planned stages, in order, with the colours the prototype uses.
 *
 * `harvest` is in `GrowStageName` but is not here: it is an end state, not a span
 * with a length, so it has no weeks to plan.
 */
const WEEKS_KEYS: WeeksKey[] = ["plannedSeedlingWeeks", "plannedVegWeeks", "plannedFlowerWeeks", "plannedFlushWeeks"];

const STAGES: { stage: GrowStageName; label: string; color: string; weeksKey: WeeksKey }[] =
  STAGE_DEFS.map((d, i) => ({ stage: d.stage, label: d.label, color: d.color, weeksKey: WEEKS_KEYS[i]! }));

type WeeksKey =
  | "plannedSeedlingWeeks"
  | "plannedVegWeeks"
  | "plannedFlowerWeeks"
  | "plannedFlushWeeks";

/** Why a grow was ended early. The prototype's own list. */
const ABORT_REASONS = [
  "Crop failure",
  "Pests / disease",
  "Mold / rot",
  "Switching strains",
  "Nutrient lockout",
  "Other",
];

const MAX_WEEKS = 20;

// ── Dates ─────────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): Date {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d;
}

const fmtShort = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric" });
const fmtFull = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

/** `YYYY-MM-DD` in local time, which is what a date input wants. */
function dateInputValue(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

// ── Draft ─────────────────────────────────────────────────────────────────────

interface Draft {
  name: string;
  strain: string;
  startDate: string;
  templateId: string | undefined;
  weeks: Record<WeeksKey, number>;
}

function blankDraft(): Draft {
  return {
    name: "",
    strain: "",
    startDate: dateInputValue(new Date()),
    // Matches the seeded "Photoperiod · Standard" template.
    templateId: "photo",
    weeks: {
      plannedSeedlingWeeks: 2,
      plannedVegWeeks: 4,
      plannedFlowerWeeks: 8,
      plannedFlushWeeks: 1,
    },
  };
}

/** Where each stage falls, in grow-days and in dates. */
interface StageRange {
  stage: GrowStageName;
  label: string;
  color: string;
  weeksKey: WeeksKey;
  weeks: number;
  startDay: number;
  endDay: number;
  from: Date;
  to: Date;
  status: "planned" | "complete" | "active" | "upcoming";
}

function stageRanges(
  weeks: Record<WeeksKey, number>,
  startDate: string,
  currentDay: number | null,
): StageRange[] {
  let elapsed = 0;
  return STAGES.map((definition) => {
    const length = weeks[definition.weeksKey];
    const startDay = elapsed + 1;
    const endDay = elapsed + length * 7;
    elapsed = endDay;

    const status: StageRange["status"] =
      currentDay === null ? "planned"
      : length === 0 ? "upcoming"
      : currentDay > endDay ? "complete"
      : currentDay >= startDay ? "active"
      : "upcoming";

    return {
      ...definition,
      weeks: length,
      startDay,
      endDay,
      from: addDays(startDate, startDay - 1),
      to: addDays(startDate, endDay - 1),
      status,
    };
  });
}

function StageStatus({ status }: { status: StageRange["status"] }) {
  if (status === "active") {
    return (
      <Tag variant="ok">
        <span className="dot-live" style={{ width: 6, height: 6 }} /> Active
      </Tag>
    );
  }
  if (status === "complete") return <Tag variant="idle"><Icon name="check" size={11} /> Complete</Tag>;
  if (status === "planned") return <Tag variant="info">Planned</Tag>;
  return <Tag variant="idle">Upcoming</Tag>;
}

// ── Abort ─────────────────────────────────────────────────────────────────────

function AbortPanel({ busy, onCancel, onConfirm }: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");

  return (
    <div className="abort-panel">
      <div className="abort-head"><Icon name="alert" size={15} /> Abort this grow?</div>
      <p>
        The grow is ended early and kept, so it stays readable in history rather than
        disappearing. Pick a reason:
      </p>
      <div className="reason-chips">
        {ABORT_REASONS.map((option) => (
          <button
            key={option}
            className={`reason${reason === option ? " on" : ""}`}
            aria-pressed={reason === option}
            onClick={() => setReason(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <input
        className="abort-note"
        placeholder="Add a note (optional)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="abort-foot">
        <button className="btn sm" onClick={onCancel}>Keep growing</button>
        <span className="spacer" />
        <button
          className="btn danger sm"
          disabled={!reason || busy}
          onClick={() => reason && onConfirm(reason, note)}
        >
          <Icon name="archive" size={13} /> Archive grow
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function GrowCycle() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";

  const { data: active } = useActiveGrow();
  const { data: grows = [] } = useGrows(workspace?.id);
  const { data: templates = [] } = useGrowTemplates();
  const { data: automations = [] } = useAutomations(workspace?.id);

  const createGrow = useCreateGrow(workspaceId);
  const patchGrow = usePatchGrow(workspaceId);

  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [aborting, setAborting] = useState(false);

  const busy = createGrow.isPending || patchGrow.isPending;

  /**
   * The grow this page is about.
   *
   * The active one if there is one, otherwise the most recent planned grow — so a
   * grow created and not yet started is not lost behind the setup form.
   */
  const planned = grows.find((g) => g.status === "planned");
  const grow: GrowCycle | undefined = active ?? planned;
  const isSetup = !grow || grow.status === "planned";

  const stageInfo = grow?.startedAt ? calcGrowStage(grow) : undefined;
  const currentDay = stageInfo?.totalDay ?? null;

  // Planned weeks come from the grow once one exists, so the steppers edit the
  // real record rather than a copy that could disagree with it.
  const weeks: Record<WeeksKey, number> = grow
    ? {
        plannedSeedlingWeeks: grow.plannedSeedlingWeeks,
        plannedVegWeeks: grow.plannedVegWeeks,
        plannedFlowerWeeks: grow.plannedFlowerWeeks,
        plannedFlushWeeks: grow.plannedFlushWeeks,
      }
    : draft.weeks;

  const startDate = grow?.startedAt ? dateInputValue(new Date(grow.startedAt)) : draft.startDate;

  const totalWeeks = Object.values(weeks).reduce((sum, n) => sum + n, 0);
  const totalDays = totalWeeks * 7;
  const ranges = useMemo(
    () => stageRanges(weeks, startDate, grow?.startedAt ? currentDay : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(weeks), startDate, currentDay, grow?.startedAt],
  );
  const activeStage = ranges.find((r) => r.status === "active");
  const harvest = addDays(startDate, Math.max(0, totalDays - 1));
  const nearEnd = currentDay !== null && totalDays > 0 && currentDay / totalDays >= 0.8;

  /**
   * Automations scoped to a stage while no grow is running.
   *
   * They idle in that state, deliberately — there is no stage for the scope to
   * match. Surfaced rather than left silent, because a forgotten grow otherwise
   * looks like broken automation.
   */
  const idledByNoGrow = useMemo(
    () => (active ? [] : automations.filter((a) => a.enabled && a.stage)),
    [automations, active],
  );

  const bumpWeeks = (key: WeeksKey, delta: number) => {
    const next = Math.max(0, Math.min(MAX_WEEKS, weeks[key] + delta));
    if (next === weeks[key]) return;
    if (grow) patchGrow.mutate({ growId: grow.id, [key]: next });
    else setDraft((d) => ({ ...d, templateId: undefined, weeks: { ...d.weeks, [key]: next } }));
  };

  const applyTemplate = (id: string, w: Record<WeeksKey, number>) => {
    if (grow) patchGrow.mutate({ growId: grow.id, templateId: id, ...w });
    else setDraft((d) => ({ ...d, templateId: id, weeks: w }));
  };

  const startGrow = () => {
    // Started in one step: a grow created as "planned" and started separately
    // leaves a window where the tent has a timeline nothing is following.
    const startedAt = new Date(`${draft.startDate}T00:00:00`).toISOString();
    const body: Partial<GrowCycle> = {
      name: draft.name.trim() || "Unnamed grow",
      status: "active",
      startedAt,
      ...draft.weeks,
      ...(draft.strain.trim() ? { strain: draft.strain.trim() } : {}),
      ...(draft.templateId ? { templateId: draft.templateId } : {}),
    };
    if (grow) patchGrow.mutate({ growId: grow.id, ...body });
    else createGrow.mutate(body, { onSuccess: () => setDraft(blankDraft()) });
  };

  const badge = isSetup ? (
    <Tag variant="info">New grow · setup</Tag>
  ) : (
    <Tag variant="ok">
      <span className="dot-live" style={{ width: 7, height: 7 }} />
      Day {currentDay}{activeStage ? ` · ${activeStage.label}` : ""}
    </Tag>
  );

  return (
    <>
      <ContentHeader
        title="Grow Cycle"
        crumbs={[
          workspace?.name ?? "Workspace",
          isSetup ? "New grow" : grow?.strain || grow?.name || "Grow",
          "Grow Cycle",
        ]}
        badge={badge}
        actions={
          isSetup ? (
            <Tip content={totalWeeks === 0 ? "Give at least one stage a length first" : undefined}>
              <button
                className="btn primary"
                onClick={startGrow}
                disabled={busy || totalWeeks === 0}
              >
                <Icon name="check" size={14} /> Start grow
              </button>
            </Tip>
          ) : (
            <>
              <button className="btn ghost-danger" onClick={() => setAborting((v) => !v)}>
                <Icon name="x" size={13} /> Abort grow
              </button>
              <button
                className={nearEnd ? "btn primary" : "btn"}
                disabled={busy}
                onClick={() =>
                  grow &&
                  patchGrow.mutate({
                    growId: grow.id,
                    status: "completed",
                    completedAt: new Date().toISOString(),
                    // What the stages actually ran to, which is what the harvest
                    // report compares against the plan.
                    actualSeedlingWeeks: grow.plannedSeedlingWeeks,
                    actualVegWeeks: grow.plannedVegWeeks,
                    actualFlowerWeeks: grow.plannedFlowerWeeks,
                    actualFlushWeeks: grow.plannedFlushWeeks,
                  })
                }
              >
                <Icon name="check" size={14} /> {nearEnd ? "Complete · Harvest" : "Complete grow"}
              </button>
            </>
          )
        }
      />

      <PageBody>
        {!workspace ? null : (
          <>
            {aborting && grow && (
              <AbortPanel
                busy={busy}
                onCancel={() => setAborting(false)}
                onConfirm={(reason, note) => {
                  patchGrow.mutate(
                    {
                      growId: grow.id,
                      status: "aborted",
                      completedAt: new Date().toISOString(),
                      abortReason: reason,
                      ...(note.trim() ? { abortNote: note.trim() } : {}),
                    },
                    { onSuccess: () => setAborting(false) },
                  );
                }}
              />
            )}

            <div className="summary-strip">
              <div className="summary-cell">
                <div className="sc-label">Strain</div>
                <div className="sc-val">{(grow?.strain || draft.strain) || "—"}</div>
                <div className="sc-sub">{grow?.name || draft.name || "unnamed grow"}</div>
              </div>
              <div className="summary-cell">
                <div className="sc-label">Started</div>
                <div className="sc-val">
                  {grow?.startedAt ? fmtShort(new Date(grow.startedAt)) : "Not set"}
                </div>
                <div className="sc-sub">
                  {grow?.startedAt ? fmtFull(new Date(grow.startedAt)) : "starts when you begin"}
                </div>
              </div>
              <div className="summary-cell">
                <div className="sc-label">Current day</div>
                <div className="sc-val">
                  {currentDay ?? "—"}
                  <span style={{ fontSize: 13, color: "var(--fg-muted)", fontWeight: 400 }}>
                    / {totalDays}
                  </span>
                </div>
                <div className="sc-sub">
                  {currentDay === null
                    ? "not started"
                    : `week ${Math.ceil(currentDay / 7)} of ${totalWeeks}`}
                </div>
              </div>
              <div className="summary-cell">
                <div className="sc-label">Total length</div>
                <div className="sc-val">
                  {totalWeeks}
                  <span style={{ fontSize: 13, color: "var(--fg-muted)", fontWeight: 400 }}>
                    weeks
                  </span>
                </div>
                <div className="sc-sub">
                  {totalDays} days · {ranges.filter((r) => r.weeks > 0).length} stages
                </div>
              </div>
              <div className="summary-cell">
                <div className="sc-label">Projected harvest</div>
                <div className="sc-val" style={{ color: "var(--success-fg)" }}>
                  {totalDays > 0 ? fmtShort(harvest) : "—"}
                </div>
                <div className="sc-sub">{totalDays > 0 ? fmtFull(harvest) : "set a length"}</div>
              </div>
            </div>

            {isSetup && (
              <div className="box gc-setup" style={{ marginTop: 16 }}>
                <div className="box-head"><h3>New grow</h3><span className="count">setup</span></div>
                <div className="gc-setup-body">
                  <div className="gc-fields">
                    <div className="gc-field grow">
                      <label htmlFor="gc-name">Grow name</label>
                      <input
                        id="gc-name"
                        value={grow?.name ?? draft.name}
                        placeholder="e.g. Grow #4"
                        onChange={(e) =>
                          grow
                            ? patchGrow.mutate({ growId: grow.id, name: e.target.value })
                            : setDraft((d) => ({ ...d, name: e.target.value }))
                        }
                      />
                    </div>
                    <div className="gc-field grow">
                      <label htmlFor="gc-strain">Strain</label>
                      <input
                        id="gc-strain"
                        value={grow?.strain ?? draft.strain}
                        placeholder="e.g. Blue Dream"
                        onChange={(e) =>
                          grow
                            ? patchGrow.mutate({ growId: grow.id, strain: e.target.value })
                            : setDraft((d) => ({ ...d, strain: e.target.value }))
                        }
                      />
                    </div>
                    <div className="gc-field">
                      <label htmlFor="gc-start">Start date</label>
                      <input
                        id="gc-start"
                        type="date"
                        value={draft.startDate}
                        onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="gc-templates">
                    <span className="gc-tpl-label">Start from a template</span>
                    <div className="gc-tpl-row">
                      {templates.map((t) => {
                        const w: Record<WeeksKey, number> = {
                          plannedSeedlingWeeks: t.seedlingWeeks,
                          plannedVegWeeks: t.vegWeeks,
                          plannedFlowerWeeks: t.flowerWeeks,
                          plannedFlushWeeks: t.flushWeeks,
                        };
                        const total = t.seedlingWeeks + t.vegWeeks + t.flowerWeeks + t.flushWeeks;
                        const selected = (grow?.templateId ?? draft.templateId) === t.id;
                        return (
                          <button
                            key={t.id}
                            className={`gc-tpl${selected ? " on" : ""}`}
                            onClick={() => applyTemplate(t.id, w)}
                          >
                            {t.name} <small>{total}w</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="sec-head">
              <h2>{isSetup ? "Plan the timeline" : "Grow timeline"}</h2>
              <span className="count">{totalWeeks} weeks · {totalDays} days</span>
              <span className="rule" />
              <span className="link" style={{ cursor: "default", color: "var(--fg-subtle)" }}>
                widths ∝ weeks · edits reflow live
              </span>
            </div>

            <div className="gc-track">
              <div className="gc-bar">
                {ranges.filter((r) => r.weeks > 0).map((r) => (
                  <Tip key={r.stage} content={`${r.label} · ${r.weeks}w`}>
                    <div
                      className="gc-seg"
                      style={{
                        width: `${(r.weeks / totalWeeks) * 100}%`,
                        ...(r.status === "active"
                          ? { background: r.color, color: "#fff" }
                          : r.status === "complete"
                            ? { background: `${r.color}59`, color: "var(--fg-default)" }
                            : { background: `${r.color}24`, color: "var(--fg-muted)" }),
                      }}
                    >
                      <span className="gc-seg-label">{r.label}</span>
                      <span className="gc-seg-wk">{r.weeks}w</span>
                    </div>
                  </Tip>
                ))}
                {currentDay !== null && totalDays > 0 && (
                  <div
                    className="gc-today"
                    // Clamped: a grow left running past its planned harvest would
                    // otherwise push the marker outside the bar.
                    style={{ left: `${Math.min(100, (currentDay / totalDays) * 100)}%` }}
                  >
                    <span className="gc-today-flag">Day {currentDay}</span>
                  </div>
                )}
              </div>
              <div className="gc-scale">
                <span>{fmtShort(addDays(startDate, 0))} · <b>start</b></span>
                <span><b>harvest</b> · {totalDays > 0 ? fmtFull(harvest) : "—"}</span>
              </div>
            </div>

            <div className="callout" style={{ marginTop: 4 }}>
              <span className="callout-ico"><Icon name="cycle" size={16} /></span>
              <div className="callout-body">
                <div className="callout-title">The cycle drives stage-scoped automation</div>
                <div className="callout-text">
                  {isSetup ? (
                    <>
                      Once this grow is running, an automation scoped to a stage only acts during
                      it. Grow Cycle decides <b>when</b> a stage is active;{" "}
                      <span className="mono-ref">Automation</span> decides what happens in it.
                    </>
                  ) : (
                    <>
                      The tent is in <b>{activeStage ? activeStage.label : "—"}</b>, so automations
                      scoped to that stage are the ones acting. Unscoped automations always run.
                    </>
                  )}
                </div>
              </div>
            </div>

            {idledByNoGrow.length > 0 && (
              <div className="abort-panel" style={{ marginTop: 10 }}>
                <div className="abort-head">
                  <Icon name="alert" size={15} />
                  {idledByNoGrow.length} automation{idledByNoGrow.length === 1 ? "" : "s"} idle
                </div>
                <p>
                  {idledByNoGrow.map((a) => a.name).join(", ")}{" "}
                  {idledByNoGrow.length === 1 ? "is" : "are"} scoped to a grow stage, and no grow is
                  running — so there is no stage to match and {idledByNoGrow.length === 1 ? "it" : "they"}{" "}
                  will not act. Unscoped automations are unaffected. Starting a grow brings{" "}
                  {idledByNoGrow.length === 1 ? "it" : "them"} back.
                </p>
              </div>
            )}

            <div className="sec-head" style={{ marginTop: 26 }}>
              <h2>Stages</h2>
              <span className="count">{ranges.length}</span>
              <span className="rule" />
            </div>

            <div className="gc-list">
              {ranges.map((r) => (
                <div className="gc-row" key={r.stage}>
                  <span className="gc-dot" style={{ background: r.color }} />
                  <div className="gc-row-main">
                    <div className="gc-stage-name">
                      {r.label}
                      <Tip content="Automations scoped to this stage">
                        <span className="gc-mode-chip">
                          {r.stage}
                        </span>
                      </Tip>
                    </div>
                    <div className="gc-range">
                      {r.weeks > 0
                        ? `${fmtShort(r.from)} – ${fmtShort(r.to)} · ${r.weeks * 7} days`
                        : "skipped"}
                    </div>
                  </div>
                  <StageStatus status={r.weeks === 0 ? "upcoming" : r.status} />
                  <div className="gc-stepper">
                    <Tip content="Fewer weeks">
                      <button
                        onClick={() => bumpWeeks(r.weeksKey, -1)}
                        disabled={r.weeks <= 0 || busy}
                      >
                        <Icon name="minus" size={14} />
                      </button>
                    </Tip>
                    <span className="gc-wk">{r.weeks}<small>wk</small></span>
                    <Tip content="More weeks">
                      <button
                        onClick={() => bumpWeeks(r.weeksKey, 1)}
                        disabled={r.weeks >= MAX_WEEKS || busy}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    </Tip>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
