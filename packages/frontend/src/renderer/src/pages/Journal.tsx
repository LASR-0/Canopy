import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { EmptyState } from "@/components/EmptyState";
import { Icon, type IconName } from "@/components/Icon";
import { DeleteButton } from "@/components/DeleteButton";
import { exportPdf } from "@/lib/pdf";
import {
  EntryPhotos,
  PhotoEditor,
  draftPhotosFrom,
  photoDropProps,
  photoRefs,
  uploading,
  usePhotoAdder,
  type DraftPhoto,
} from "./journal/Photos";
import { Tag } from "@/components/Tag";
import { Tip } from "@/components/Tip";
import { STAGE_DEFS, calcGrowStage, growTotalPlannedDays } from "@/lib/growStage";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { useRoles } from "@/hooks/useDevices";
import { useGrows } from "@/hooks/useGrows";
import {
  useCreateEntry,
  useCreateMilestone,
  useDeleteEntry,
  useDeleteMilestone,
  useJournal,
  useMilestones,
  useUpdateEntry,
  useUpdateMilestone,
} from "@/hooks/useJournal";
import { useLiveReadings, type ReadingsMap } from "@/hooks/useLiveReadings";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { computeVpd } from "@canopy/shared-types";
import type {
  GrowCycle,
  GrowMilestone,
  JournalEntry,
  JournalEntryBody,
  JournalEntryType,
  RoleAssignment,
} from "@canopy/shared-types";

// ── Entry types ───────────────────────────────────────────────────────────────

/** Labels, icons and tints — the prototype's own. */
const J_TYPE: Record<JournalEntryType, { label: string; icon: IconName; tint: string }> = {
  observation: { label: "Observation", icon: "eye",      tint: "#2f81f7" },
  experiment:  { label: "Experiment",  icon: "beaker",   tint: "#a371f7" },
  technique:   { label: "Technique",   icon: "scissors", tint: "#3fb950" },
  measurement: { label: "Measurement", icon: "ruler",    tint: "#d29922" },
  photo:       { label: "Photo",       icon: "camera",   tint: "#f78166" },
};

/** Types the composer offers. Every type can hold photos; "Photo" is for an entry that is mostly photos. */
const COMPOSER_TYPES: JournalEntryType[] = ["observation", "experiment", "technique", "measurement", "photo"];

/** Oldest live reading the composer will preview. Matches the server's stamp. */
const ENV_MAX_AGE_MS = 15 * 60 * 1000;

const fmtFull = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

/** 1-based grow day of a moment, the arithmetic the server stamps with. */
function growDayOf(grow: GrowCycle, at: Date): number {
  if (!grow.startedAt) return 1;
  return Math.max(1, Math.floor((at.getTime() - new Date(grow.startedAt).getTime()) / 86_400_000) + 1);
}

// ── Environment preview ───────────────────────────────────────────────────────

interface EnvPreview {
  tempC?: number;
  rhPct?: number;
  vpdKpa?: number;
}

/**
 * What the next entry will be stamped with, for the composer to show.
 *
 * A preview only — the server stamps the entry itself, from the same roles and
 * with the same freshness limit, so the two agree unless a reading lands between
 * the preview and the write.
 */
function envPreview(roles: RoleAssignment[], readings: ReadingsMap, now: number): EnvPreview {
  const fresh = (key: `${string}:${string}`) => {
    const reading = readings.get(key);
    if (!reading || now - Date.parse(reading.ts) > ENV_MAX_AGE_MS) return undefined;
    return reading.value;
  };
  const preview: EnvPreview = {};
  for (const role of roles) {
    if (role.role === "canopy_temp" && preview.tempC === undefined) {
      const v = fresh(`${role.deviceId}:${role.channel}`);
      if (v !== undefined) preview.tempC = v;
    }
    if (role.role === "canopy_rh" && preview.rhPct === undefined) {
      const v = fresh(`${role.deviceId}:${role.channel}`);
      if (v !== undefined) preview.rhPct = v;
    }
  }
  // Computed from the pair rather than read from the derived series, which is
  // what the server stamps — so the preview and the entry cannot disagree.
  if (preview.tempC !== undefined && preview.rhPct !== undefined) {
    const vpd = computeVpd(preview.tempC, preview.rhPct);
    if (vpd !== null) preview.vpdKpa = vpd;
  }
  return preview;
}

function EnvValues({ tempC, rhPct, vpdKpa, className }: {
  tempC?: number | undefined;
  rhPct?: number | undefined;
  vpdKpa?: number | undefined;
  className?: string;
}) {
  const dash = "—";
  return (
    <>
      <span className={className}><Icon name="temp" size={11} />{tempC !== undefined ? `${tempC.toFixed(1)}°C` : dash}</span>
      <span className={className}><Icon name="drop" size={11} />{rhPct !== undefined ? `${Math.round(rhPct)}%` : dash}</span>
      <span className={className}><Icon name="vpd" size={11} />{vpdKpa !== undefined ? `${vpdKpa.toFixed(2)} kPa` : dash}</span>
    </>
  );
}

// ── Activity graph ────────────────────────────────────────────────────────────

/** Shade for an activity level. -1 is a day that has not happened yet. */
function cellStyle(level: number): CSSProperties {
  if (level < 0) return { background: "transparent", borderColor: "var(--border-muted)" };
  if (level === 0) return { background: "var(--canvas-subtle)" };
  const pct = [0, 38, 58, 78, 100][level];
  return { background: `color-mix(in srgb, var(--success-fg) ${pct}%, var(--canvas-subtle))` };
}

/**
 * Level per day: entries set the shade, a milestone reached that day lifts an
 * otherwise empty day to the first step.
 *
 * The prototype padded quiet days with invented activity. Here a day with
 * nothing recorded is shown as nothing, because the graph is a record of what
 * the grower did, and a pattern of fake activity would hide the gaps it exists
 * to show.
 */
function activityLevel(entries: number, milestone: boolean): number {
  if (entries >= 3) return 4;
  if (entries === 2) return 3;
  if (entries === 1) return 2;
  return milestone ? 1 : 0;
}

function ActivityGraph({ days, today, entries, milestones, selected, onPick }: {
  days: number;
  today: number;
  entries: JournalEntry[];
  milestones: GrowMilestone[];
  selected: number | null;
  onPick: (day: number) => void;
}) {
  const perDay = useMemo(() => {
    const counts = new Map<number, JournalEntry[]>();
    for (const e of entries) counts.set(e.growDay, [...(counts.get(e.growDay) ?? []), e]);
    return counts;
  }, [entries]);
  const reached = useMemo(() => {
    const doneDays = new Set<number>();
    for (const m of milestones) if (m.done) doneDays.add(m.day);
    return doneDays;
  }, [milestones]);

  return (
    <div className="box jgraph-box">
      <div className="box-head">
        <h3>Activity</h3>
        <span className="count">day 1 → harvest</span>
        <span className="jlegend">
          Less {[0, 1, 2, 3, 4].map((l) => <i key={l} style={cellStyle(l)} />)} More
        </span>
      </div>
      <div className="jgraph-wrap">
        <div className="jgraph">
          {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
            const onDay = perDay.get(day) ?? [];
            const level = day > today ? -1 : activityLevel(onDay.length, reached.has(day));
            const what =
              onDay.length > 0
                ? onDay.map((e) => J_TYPE[e.type].label).join(", ")
                : day > today ? "upcoming"
                : reached.has(day) ? "milestone"
                : "no activity";
            return (
              <Tip key={day} content={`Day ${day} · ${what}`}>
                <button
                  className={`jcell${selected === day ? " sel" : ""}`}
                  style={{ ...cellStyle(level), cursor: onDay.length ? "pointer" : "default" }}
                  aria-label={`Day ${day}: ${what}`}
                  onClick={() => onDay.length && onPick(day)}
                />
              </Tip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Milestones ────────────────────────────────────────────────────────────────

function Milestones({ workspaceId, grow, milestones, today, editable }: {
  workspaceId: string;
  grow: GrowCycle;
  milestones: GrowMilestone[];
  today: number;
  editable: boolean;
}) {
  const create = useCreateMilestone(workspaceId, grow.id);
  const update = useUpdateMilestone(workspaceId, grow.id);
  const remove = useDeleteMilestone(workspaceId, grow.id);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [day, setDay] = useState(String(today));

  const submit = () => {
    const n = Number(day);
    if (!label.trim() || !Number.isInteger(n) || n < 1) return;
    create.mutate(
      { label: label.trim(), day: n },
      { onSuccess: () => { setLabel(""); setAdding(false); } },
    );
  };

  return (
    <>
      <div className="sec-head">
        <h2>Milestones</h2>
        <span className="count">{milestones.filter((m) => m.done).length}/{milestones.length}</span>
        <span className="rule" />
      </div>
      <div className="j-miles">
        {milestones.length === 0 && !adding && (
          <span className="j-none">
            {editable ? "No milestones yet — mark the points you are working toward." : "No milestones."}
          </span>
        )}
        {milestones.map((m) => (
          <div key={m.id} className={`j-mile${m.done ? " done" : ""}`}>
            <Tip content={editable ? (m.done ? "Mark as not reached" : "Mark as reached") : undefined}>
              <button
                className="j-mile-toggle"
                disabled={!editable || update.isPending}
                onClick={() => update.mutate({ id: m.id, done: !m.done })}
              >
                <Icon name="pin" size={11} />
                <b>Day {m.day}</b>
                {m.label}
                {m.done ? (
                  <Icon name="check" size={11} />
                ) : (
                  <span className="up">{m.day < today ? "not reached" : "upcoming"}</span>
                )}
              </button>
            </Tip>
            {editable && (
              <Tip content="Remove milestone">
                <button
                  className="j-mile-del"
                  onClick={() => remove.mutate(m.id)}
                  aria-label={`Remove milestone ${m.label}`}
                >
                  <Icon name="x" size={10} />
                </button>
              </Tip>
            )}
          </div>
        ))}
        {editable && !adding && (
          <button className="j-mile j-mile-add" onClick={() => { setDay(String(today)); setAdding(true); }}>
            <Icon name="plus" size={11} /> Milestone
          </button>
        )}
        {editable && adding && (
          <form
            className="j-mile j-mile-form"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <b>Day</b>
            <input
              type="number"
              min={1}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              aria-label="Grow day"
              className="j-mile-day"
            />
            <input
              autoFocus
              value={label}
              placeholder="e.g. Flip to flower"
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Milestone"
              className="j-mile-label"
            />
            <button type="submit" className="btn sm primary" disabled={!label.trim() || create.isPending}>Add</button>
            <button type="button" className="btn sm" onClick={() => setAdding(false)}>Cancel</button>
          </form>
        )}
      </div>
    </>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────

interface Draft {
  type: JournalEntryType;
  title: string;
  body: string;
  hypothesis: string;
  result: string;
  measurements: [string, string][];
}

function draftFrom(entry?: JournalEntry): Draft {
  return {
    type: entry?.type ?? "observation",
    title: entry?.title ?? "",
    body: entry?.body ?? "",
    hypothesis: entry?.hypothesis ?? "",
    result: entry?.result ?? "",
    measurements: entry?.measurements?.length ? entry.measurements : [["", ""]],
  };
}

/**
 * The fields that go to the server for a draft.
 *
 * Fields that belong to another type are sent empty, which clears them: an
 * entry switched from experiment to observation should not keep a hypothesis
 * nobody can see.
 */
function bodyFrom(draft: Draft, editing: boolean): Partial<JournalEntry> {
  const isExp = draft.type === "experiment";
  const isMeas = draft.type === "measurement";
  const measurements = draft.measurements.filter(([k, v]) => k.trim() || v.trim());
  return {
    type: draft.type,
    // New entries take their title from the body's first line; an edit keeps
    // whatever title the grower sees in the title field.
    ...(editing ? { title: draft.title } : {}),
    body: draft.body,
    hypothesis: isExp ? draft.hypothesis : "",
    result: isExp ? draft.result : "",
    measurements: isMeas ? measurements : [],
  };
}

function hasContent(draft: Draft): boolean {
  if (draft.body.trim()) return true;
  if (draft.type === "experiment" && draft.hypothesis.trim()) return true;
  if (draft.type === "measurement" && draft.measurements.some(([k, v]) => k.trim() && v.trim())) return true;
  return false;
}

function Composer({ workspaceId, entry, stamp, busy, error, onSubmit, onCancel }: {
  workspaceId: string;
  /** The entry being edited; absent for a new one. */
  entry?: JournalEntry;
  stamp?: ReactNode;
  busy: boolean;
  error?: string | undefined;
  onSubmit: (body: JournalEntryBody, reset: () => void) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(entry));
  const [photos, setPhotos] = useState<DraftPhoto[]>(() => draftPhotosFrom(entry?.photos));
  const addPhotos = usePhotoAdder(workspaceId, setPhotos);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const editing = !!entry;
  const types = COMPOSER_TYPES;
  const hasPhotos = photoRefs(photos).length > 0;

  const setPair = (i: number, side: 0 | 1, value: string) =>
    set("measurements", draft.measurements.map((p, j) => (j === i ? (side === 0 ? [value, p[1]] : [p[0], value]) : p)));

  return (
    <div className="j-composer" {...photoDropProps(addPhotos)}>
      {stamp && <div className="jc-stamp">{stamp}</div>}
      <div className="jc-types" role="radiogroup" aria-label="Entry type">
        {types.map((k) => {
          const T = J_TYPE[k];
          const on = draft.type === k;
          return (
            <button
              key={k}
              role="radio"
              aria-checked={on}
              className={`jc-type${on ? " on" : ""}`}
              style={on ? { color: T.tint, borderColor: T.tint } : undefined}
              onClick={() => set("type", k)}
            >
              <Icon name={T.icon} size={12} />{T.label}
            </button>
          );
        })}
      </div>

      {editing && (
        <input
          className="jc-input"
          value={draft.title}
          placeholder="Title (defaults to the first line of the note)"
          onChange={(e) => set("title", e.target.value)}
          aria-label="Title"
        />
      )}

      {draft.type === "experiment" && (
        <div className="jc-exp">
          <label>
            <span>Hypothesis</span>
            <input
              className="jc-input"
              value={draft.hypothesis}
              placeholder="What you expect to happen, and why"
              onChange={(e) => set("hypothesis", e.target.value)}
            />
          </label>
          <label>
            <span>Result</span>
            <input
              className="jc-input"
              value={draft.result}
              placeholder="Fill in once you know — edit the entry later"
              onChange={(e) => set("result", e.target.value)}
            />
          </label>
        </div>
      )}

      {draft.type === "measurement" && (
        <div className="jc-meas">
          {draft.measurements.map(([k, v], i) => (
            <div className="jc-pair" key={i}>
              <input className="jc-input" value={k} placeholder="pH" aria-label="Measurement name" onChange={(e) => setPair(i, 0, e.target.value)} />
              <input className="jc-input" value={v} placeholder="6.2" aria-label="Measurement value" onChange={(e) => setPair(i, 1, e.target.value)} />
              <Tip content="Remove">
                <button
                  className="icon-ghost2"
                  aria-label="Remove measurement"
                  disabled={draft.measurements.length === 1}
                  onClick={() => set("measurements", draft.measurements.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={12} />
                </button>
              </Tip>
            </div>
          ))}
          <button className="btn sm" onClick={() => set("measurements", [...draft.measurements, ["", ""]])}>
            <Icon name="plus" size={12} /> Add reading
          </button>
        </div>
      )}

      <textarea
        className="jc-text"
        placeholder={draft.type === "photo"
          ? "A note to go with the photos (optional)…"
          : "Record an observation, a hypothesis you're testing, a technique, or a measurement…"}
        value={draft.body}
        onChange={(e) => set("body", e.target.value)}
        aria-label="Note"
      />

      <PhotoEditor drafts={photos} onChange={setPhotos} onAdd={addPhotos} />

      <div className="jc-foot">
        {error && <span className="jc-error">{error}</span>}
        <span className="spacer" />
        {onCancel && <button className="btn" onClick={onCancel} style={{ marginRight: 8 }}>Cancel</button>}
        <button
          className="btn primary"
          disabled={!(hasContent(draft) || hasPhotos) || busy || uploading(photos)}
          onClick={() =>
            onSubmit({ ...bodyFrom(draft, editing), photos: photoRefs(photos) }, () => {
              setDraft(draftFrom());
              setPhotos([]);
            })
          }
        >
          {editing ? <><Icon name="check" size={13} /> Save</> : <><Icon name="plus" size={13} /> Add to notebook</>}
        </button>
      </div>
    </div>
  );
}

// ── Entries ───────────────────────────────────────────────────────────────────

/**
 * The body without the line the title was taken from.
 *
 * A new entry's title is its first line, so printing the whole body under it
 * would show that line twice.
 */
function bodyBelowTitle(entry: JournalEntry): string {
  const body = entry.body?.trim() ?? "";
  const [first = "", ...rest] = body.split("\n");
  return first.trim() === entry.title ? rest.join("\n").trim() : body;
}

function EntryCard({ entry, selected, editable, onEdit, onDelete }: {
  entry: JournalEntry;
  selected: boolean;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const T = J_TYPE[entry.type];
  const body = bodyBelowTitle(entry);

  return (
    <div className={`j-entry${selected ? " sel" : ""}`} data-day={entry.growDay} data-search-id={entry.id}>
      <div className="je-rail">
        <div className="je-day">Day {entry.growDay}</div>
        <div className="je-wk">Week {entry.growWeek}</div>
        <Tip content="Canopy conditions when this was written">
          <div className="je-env">
            <EnvValues tempC={entry.envTempC} rhPct={entry.envRhPct} vpdKpa={entry.envVpdKpa} />
          </div>
        </Tip>
      </div>
      <div className="je-body">
        <div className="je-head">
          <span className="je-type" style={{ color: T.tint, background: `${T.tint}1f` }}>
            <Icon name={T.icon} size={12} />{T.label}
          </span>
          <span className="je-title">{entry.title}</span>
          {editable && (
            <span className="je-actions">
              <Tip content="Edit">
                <button className="icon-ghost2" onClick={onEdit} aria-label="Edit entry">
                  <Icon name="pencil" size={13} />
                </button>
              </Tip>
              <DeleteButton onDelete={onDelete} ariaLabel="Delete entry" />
            </span>
          )}
        </div>
        {(entry.hypothesis || entry.result) && (
          <div className="je-exp">
            {entry.hypothesis && (
              <div className="ee-row"><span className="ee-k">Hypothesis</span><span>{entry.hypothesis}</span></div>
            )}
            <div className="ee-row">
              <span className="ee-k">Result</span>
              <span className={entry.result ? undefined : "je-pending"}>{entry.result ?? "not recorded yet"}</span>
            </div>
          </div>
        )}
        {entry.measurements && entry.measurements.length > 0 && (
          <div className="je-meas">
            {entry.measurements.map(([k, v], i) => (
              <span className="meas-chip" key={i}><b>{k}</b> {v}</span>
            ))}
          </div>
        )}
        {body && <div className="je-text">{body}</div>}
        {entry.photos && <EntryPhotos photos={entry.photos} />}
        {entry.updatedAt && <div className="je-edited">edited {fmtFull(new Date(entry.updatedAt))}</div>}
      </div>
    </div>
  );
}

// ── Notebook for one grow ─────────────────────────────────────────────────────

function GrowNotebook({ workspaceId, grow, editable }: {
  workspaceId: string;
  grow: GrowCycle;
  /** False for a finished grow opened from History: its record is read, not written. */
  editable: boolean;
}) {
  const { data: entries = [] } = useJournal(workspaceId, grow.id);
  const { data: milestones = [] } = useMilestones(workspaceId, grow.id);
  const { data: roles = [] } = useRoles(workspaceId);
  const readings = useLiveReadings(editable ? workspaceId : undefined);

  const create = useCreateEntry(workspaceId, grow.id);
  const update = useUpdateEntry(workspaceId, grow.id);
  const remove = useDeleteEntry(workspaceId, grow.id);

  const [selected, setSelected] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A finished grow's "today" is the day it ended, so the graph does not show
  // weeks of empty days after the harvest.
  const end = grow.completedAt ? new Date(grow.completedAt) : new Date();
  const today = grow.startedAt ? growDayOf(grow, end) : 0;
  const latestEntryDay = entries.reduce((max, e) => Math.max(max, e.growDay), 0);
  // A grow left running past its planned harvest keeps its extra days visible.
  const days = Math.max(growTotalPlannedDays(grow), today, latestEntryDay, 1);

  const preview = envPreview(roles, readings, Date.now());

  useEffect(() => {
    if (selected === null) return;
    listRef.current
      ?.querySelector(`[data-day="${selected}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected]);

  const errorOf = (e: unknown) => (e instanceof Error ? e.message : e ? "Could not save the entry" : undefined);

  return (
    <>
      <ActivityGraph
        days={days}
        today={today}
        entries={entries}
        milestones={milestones}
        selected={selected}
        onPick={(day) => setSelected((s) => (s === day ? null : day))}
      />

      <Milestones
        workspaceId={workspaceId}
        grow={grow}
        milestones={milestones}
        today={today}
        editable={editable}
      />

      {editable && (
        <>
          <div className="sec-head no-print" style={{ marginTop: 22 }}><h2>New entry</h2><span className="rule" /></div>
          <Composer
            workspaceId={workspaceId}
            busy={create.isPending}
            error={errorOf(create.error)}
            stamp={
              <>
                <Icon name="clock" size={12} /> Day {today} · Wk {Math.ceil(today / 7)}
                <EnvValues {...preview} className="jc-env" />
                <span className="jc-auto">auto-stamped from sensors</span>
              </>
            }
            onSubmit={(body, reset) => create.mutate(body, { onSuccess: reset })}
          />
        </>
      )}

      <div className="sec-head" style={{ marginTop: 22 }}>
        <h2>Notebook</h2>
        <span className="count">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
        <span className="rule" />
        {selected !== null ? (
          <span className="link" onClick={() => setSelected(null)}>Day {selected} · clear</span>
        ) : (
          <span className="link" style={{ cursor: "default", color: "var(--fg-subtle)" }}>newest first</span>
        )}
      </div>
      <div className="j-entries" ref={listRef}>
        {entries.length === 0 && (
          <div className="j-none">
            {editable ? "Nothing written yet. The first entry is stamped with today's grow day and canopy conditions." : "No entries were written for this grow."}
          </div>
        )}
        {entries.map((entry) =>
          editingId === entry.id ? (
            <Composer
              workspaceId={workspaceId}
              key={entry.id}
              entry={entry}
              busy={update.isPending}
              error={errorOf(update.error)}
              stamp={<><Icon name="clock" size={12} /> Editing · Day {entry.growDay} · Wk {entry.growWeek}</>}
              onCancel={() => setEditingId(null)}
              onSubmit={(body) =>
                update.mutate({ id: entry.id, ...body }, { onSuccess: () => setEditingId(null) })
              }
            />
          ) : (
            <EntryCard
              key={entry.id}
              entry={entry}
              selected={selected === entry.growDay}
              editable={editable}
              onEdit={() => setEditingId(entry.id)}
              onDelete={() => remove.mutate(entry.id)}
            />
          ),
        )}
      </div>
    </>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

const STAGE_COLORS = STAGE_DEFS.map((d) => d.color);
const STAGE_NAMES = STAGE_DEFS.map((d) => d.label);

/** What the stages ran to — actual weeks where recorded, the plan otherwise. */
function stageWeeks(g: GrowCycle): number[] {
  return [
    g.actualSeedlingWeeks ?? g.plannedSeedlingWeeks,
    g.actualVegWeeks ?? g.plannedVegWeeks,
    g.actualFlowerWeeks ?? g.plannedFlowerWeeks,
    g.actualFlushWeeks ?? g.plannedFlushWeeks,
  ];
}

/**
 * How long the grow actually ran, in weeks.
 *
 * From the dates for an aborted grow, whose planned weeks describe a grow that
 * never happened; from the stage weeks for a completed one.
 */
function lengthWeeks(g: GrowCycle): number {
  if (g.status === "aborted" && g.startedAt && g.completedAt) {
    return Math.max(1, Math.round((Date.parse(g.completedAt) - Date.parse(g.startedAt)) / (7 * 86_400_000)));
  }
  return stageWeeks(g).reduce((a, b) => a + b, 0);
}

const range = (min?: number, max?: number, unit = "") =>
  min != null && max != null ? `${min.toFixed(0)}–${max.toFixed(0)}${unit}` : "—";

function MiniStages({ weeks }: { weeks: number[] }) {
  const total = weeks.reduce((a, b) => a + b, 0) || 1;
  return (
    <span className="mini-stages">
      {weeks.map((w, i) =>
        w > 0 ? (
          <Tip key={i} content={`${STAGE_NAMES[i]} ${w}w`}>
            <span style={{ width: `${(w / total) * 100}%`, background: STAGE_COLORS[i] }} />
          </Tip>
        ) : null,
      )}
    </span>
  );
}

function ArchiveRow({ grow, checked, onToggle, onOpen }: {
  grow: GrowCycle;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const done = grow.status === "completed";
  const started = grow.startedAt ? fmtFull(new Date(grow.startedAt)) : "never started";
  const meta = [started, `${lengthWeeks(grow)} weeks`, ...(grow.techniques?.length ? [grow.techniques.join(", ")] : [])];

  return (
    <div className={`ar-row${checked ? " sel" : ""}`}>
      <label className="ar-check">
        {done ? (
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Compare ${grow.name}`} />
        ) : (
          <Tip content="Aborted grows can't be compared">
            <span className="ar-nocmp">–</span>
          </Tip>
        )}
      </label>
      <span className={`ar-badge ${done ? "done" : "abort"}`}>
        <Icon name={done ? "check" : "x"} size={12} />
      </span>
      <div className="ar-main">
        <div className="ar-name">
          {grow.name} {grow.strain && <span className="ar-strain">· {grow.strain}</span>}
        </div>
        <div className="ar-meta">{meta.join(" · ")}</div>
      </div>
      <div className="ar-outcome">
        {done ? (
          <>
            <span className="ar-yield">
              {grow.dryWeightG != null ? <>{grow.dryWeightG} g <small>dry</small></> : <small>no yield recorded</small>}
            </span>
            {grow.rating != null && <span className="ar-rating">{grow.rating}★</span>}
          </>
        ) : (
          <span className="ar-reason">aborted{grow.abortReason ? ` · ${grow.abortReason}` : ""}</span>
        )}
      </div>
      <button className="ar-open" onClick={onOpen}>
        Open journal <Icon name="arrow-right" size={12} />
      </button>
    </div>
  );
}

function ComparePanel({ a, b }: { a: GrowCycle; b: GrowCycle }) {
  const opt = (v: number | undefined, unit: string) => (v != null ? `${v}${unit}` : "—");
  const rows: [string, string, string][] = [
    ["Strain", a.strain ?? "—", b.strain ?? "—"],
    ["Length", `${lengthWeeks(a)} wk`, `${lengthWeeks(b)} wk`],
    ["Dry yield", opt(a.dryWeightG, " g"), opt(b.dryWeightG, " g")],
    ["Wet yield", opt(a.wetWeightG, " g"), opt(b.wetWeightG, " g")],
    ["Rating", opt(a.rating, " ★"), opt(b.rating, " ★")],
    ["Avg VPD", a.envAvgVpd != null ? `${a.envAvgVpd.toFixed(2)} kPa` : "—", b.envAvgVpd != null ? `${b.envAvgVpd.toFixed(2)} kPa` : "—"],
    ["Temp", range(a.envTempMin, a.envTempMax, " °C"), range(b.envTempMin, b.envTempMax, " °C")],
    ["RH", range(a.envRhMin, a.envRhMax, " %"), range(b.envRhMin, b.envRhMax, " %")],
    ["Techniques", a.techniques?.join(", ") || "—", b.techniques?.join(", ") || "—"],
  ];
  return (
    <div className="box cmp-panel">
      <div className="box-head"><h3>Compare</h3><span className="count">{a.name} vs {b.name}</span></div>
      <div className="cmp-table">
        <div className="cmp-trow head">
          <span />
          <span>{a.name}{a.strain ? ` · ${a.strain}` : ""}</span>
          <span>{b.name}{b.strain ? ` · ${b.strain}` : ""}</span>
        </div>
        {rows.map(([k, x, y]) => (
          <div className="cmp-trow" key={k}><span className="cmp-k">{k}</span><span>{x}</span><span>{y}</span></div>
        ))}
        <div className="cmp-trow">
          <span className="cmp-k">Stage weeks</span>
          <span><MiniStages weeks={stageWeeks(a)} /></span>
          <span><MiniStages weeks={stageWeeks(b)} /></span>
        </div>
      </div>
    </div>
  );
}

function History({ archive, workspaceName, onOpen }: {
  archive: GrowCycle[];
  workspaceName: string;
  onOpen: (grow: GrowCycle) => void;
}) {
  const completed = archive.filter((g) => g.status === "completed");
  const [compare, setCompare] = useState<string[]>(() => completed.slice(0, 2).map((g) => g.id));
  const toggle = (id: string) =>
    setCompare((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : [p[1]!, id]));
  const picked = completed.filter((g) => compare.includes(g.id));

  if (archive.length === 0) {
    return (
      <EmptyState
        icon="archive"
        title="No finished grows yet"
        description="Completed and aborted grows are kept here with their journals, so runs can be compared side by side."
      />
    );
  }

  return (
    <>
      <div className="sec-head">
        <h2>Grow history</h2>
        <span className="count">{archive.length} archived · {workspaceName}</span>
        <span className="rule" />
        <span className="link" style={{ cursor: "default", color: "var(--fg-subtle)" }}>
          tick two completed grows to compare
        </span>
      </div>
      <div className="ar-list">
        {archive.map((g) => (
          <ArchiveRow
            key={g.id}
            grow={g}
            checked={compare.includes(g.id)}
            onToggle={() => toggle(g.id)}
            onOpen={() => onOpen(g)}
          />
        ))}
      </div>
      {picked.length === 2 && <ComparePanel a={picked[0]!} b={picked[1]!} />}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "current" | "history";

export function Journal() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: active } = useActiveGrow();
  const { data: grows = [] } = useGrows(workspace?.id);

  const [tab, setTab] = useState<Tab>("current");
  /** A finished grow opened from History, shown read-only in place of the tabs. */
  const [viewing, setViewing] = useState<GrowCycle | null>(null);

  // Most recent first — the order a grower looks back through.
  const archive = useMemo(
    () =>
      grows
        .filter((g) => g.status === "completed" || g.status === "aborted")
        .sort((a, b) => (b.completedAt ?? b.startedAt ?? "").localeCompare(a.completedAt ?? a.startedAt ?? "")),
    [grows],
  );

  // A workspace switch must not leave another tent's grow on screen.
  useEffect(() => setViewing(null), [workspaceId]);

  const stageInfo = active ? calcGrowStage(active) : undefined;
  const shown = viewing ?? (tab === "current" ? active : undefined);

  /**
   * The notebook as a PDF: the page itself, printed (lib/pdf.ts), with the
   * composer and the controls left off by the print styles.
   */
  const [exporting, setExporting] = useState(false);
  const exportJournal = async (grow: GrowCycle) => {
    setExporting(true);
    try {
      const name = (grow.strain || grow.name).replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "grow";
      await exportPdf(`canopy-journal-${name}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  const crumb = viewing
    ? `${viewing.strain || viewing.name} · Archive`
    : tab === "history" ? "Archive"
    : active ? `${active.strain || active.name}${stageInfo ? ` · Day ${stageInfo.totalDay}` : ""}`
    : "No grow running";

  const badge = viewing ? (
    <Tag variant={viewing.status === "completed" ? "done" : "err"}>
      {viewing.status === "completed" ? "Completed" : "Aborted"}
    </Tag>
  ) : tab === "current" && active ? (
    <Tag variant="ok"><span className="dot-live" style={{ width: 7, height: 7 }} /> Live</Tag>
  ) : undefined;

  return (
    <>
      <ContentHeader
        title="Journal"
        crumbs={[workspace?.name ?? "Workspace", crumb, "Journal"]}
        badge={badge}
        actions={
          <>
            {shown && (
              <button className="btn" onClick={() => void exportJournal(shown)} disabled={exporting}>
                <Icon name="external" size={13} /> {exporting ? "Exporting…" : "Export PDF"}
              </button>
            )}
            {viewing ? (
              <button className="btn" onClick={() => setViewing(null)}>
                <Icon name="arrow-left" size={13} /> Back to history
              </button>
            ) : (
              <div className="j-tabs">
                <button className={tab === "current" ? "on" : ""} onClick={() => setTab("current")}>Current</button>
                <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
              </div>
            )}
          </>
        }
      />

      {/* Keyed so switching tab or grow starts at the top, not at the old offset. */}
      <PageBody key={viewing?.id ?? tab}>
        {!workspace ? null : shown ? (
          <GrowNotebook
            key={shown.id}
            workspaceId={workspaceId}
            grow={shown}
            editable={!viewing && shown.status === "active"}
          />
        ) : tab === "current" ? (
          <EmptyState
            icon="journal"
            title="No grow running"
            description="The journal belongs to a grow: each entry is filed under its grow day and stamped with the canopy conditions. Start a grow on the Grow Cycle page to begin one."
            {...(archive.length ? { hint: `${archive.length} finished grow${archive.length === 1 ? "" : "s"} in History` } : {})}
          />
        ) : (
          <History
            archive={archive}
            workspaceName={workspace.name}
            onOpen={(g) => setViewing(g)}
          />
        )}
      </PageBody>
    </>
  );
}
