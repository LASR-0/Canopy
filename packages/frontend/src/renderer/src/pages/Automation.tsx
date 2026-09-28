import { useMemo, useState } from "react";
import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";
import { Icon, type IconName } from "@/components/Icon";
import { Tag } from "@/components/Tag";
import { Toggle } from "@/components/Toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useUpdateAutomation,
} from "@/hooks/useAutomations";
import { useRoles } from "@/hooks/useDevices";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { CONTROL_ROLES, ROLE_META, SENSE_ROLES, roleName, subsystemForRole } from "@/lib/roles";
import { METRIC_META } from "@/lib/metrics";
import type {
  ActuatorCommand,
  Automation as AutomationRecord,
  AutomationAction,
  AutomationSubsystem,
  AutomationTrigger,
  Comparator,
  Metric,
  RoleKind,
} from "@canopy/shared-types";

// ── Display catalogues ────────────────────────────────────────────────────────

const SUBSYSTEMS: { id: AutomationSubsystem; label: string; icon: IconName }[] = [
  { id: "lighting",   label: "Lighting",   icon: "sun"        },
  { id: "climate",    label: "Climate",    icon: "temp"       },
  { id: "airflow",    label: "Airflow",    icon: "fan"        },
  { id: "co2",        label: "CO₂",        icon: "co2"        },
  { id: "irrigation", label: "Irrigation", icon: "drop"       },
  { id: "failsafe",   label: "Failsafe",   icon: "alert"      },
];

type TriggerKind = AutomationTrigger["kind"];

/**
 * The three trigger shapes, described by what they are *for* rather than by
 * their mechanism. The difference between a window and a cron matters — one is
 * recoverable across a restart and the other is not — so the hint says so
 * instead of leaving the grower to find out after a power cut.
 */
const TRIGGER_KINDS: { id: TriggerKind; label: string; icon: IconName; hint: string }[] = [
  {
    id: "window",
    label: "Daily window",
    icon: "clock",
    hint: "On at one time, off at another. Re-derived after a restart, so a reboot mid-cycle cannot leave the tent dark.",
  },
  {
    id: "schedule",
    label: "At a time",
    icon: "refresh",
    hint: "A one-shot pulse. Skipped rather than fired late if the controller was down when it was due.",
  },
  {
    id: "rule",
    label: "When a sensor…",
    icon: "radar",
    hint: "Fires on a reading crossing your threshold, and re-arms once it lapses.",
  },
];

const COMPARATORS: { id: Comparator; label: string }[] = [
  { id: "gt",  label: "rises above" },
  { id: "gte", label: "reaches" },
  { id: "lt",  label: "falls below" },
  { id: "lte", label: "drops to" },
];

/** Metrics worth writing a rule about: the ones a sensing role reports. */
const RULE_METRICS: Metric[] = [
  ...new Set(SENSE_ROLES.map((id) => ROLE_META[id].metric).filter((m): m is Metric => !!m)),
];

/** Dwell presets. A rule with no dwell fires on a single noisy sample. */
const DWELL_PRESETS: { label: string; seconds: number | undefined }[] = [
  { label: "Immediately", seconds: undefined },
  { label: "1 min",       seconds: 60 },
  { label: "5 min",       seconds: 300 },
  { label: "15 min",      seconds: 900 },
];

// ── Trigger and action prose ──────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Hours a window covers, honouring the midnight crossing. */
function windowHours(on: string, off: string): number {
  const [onH = 0, onM = 0] = on.split(":").map(Number);
  const [offH = 0, offM = 0] = off.split(":").map(Number);
  const start = onH * 60 + onM;
  const end = offH * 60 + offM;
  // Equal times mean always on — a real 24h seedling setting, not a zero window.
  if (start === end) return 24;
  const span = end > start ? end - start : 1440 - start + end;
  return Math.round((span / 60) * 10) / 10;
}

/** A cron this page could have produced, read back into words. */
function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  const [minute, hour] = parts;
  if (parts.length === 5 && hour?.startsWith("*/")) {
    const every = hour.slice(2);
    return `Every ${every}h`;
  }
  if (parts.length === 5 && /^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "")) {
    return `Daily at ${pad2(Number(hour))}:${pad2(Number(minute))}`;
  }
  return cron;
}

function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case "window":
      return `${trigger.on} → ${trigger.off} · ${windowHours(trigger.on, trigger.off)}h`;
    case "schedule":
      return describeCron(trigger.cron);
    case "rule": {
      const comparator = COMPARATORS.find((c) => c.id === trigger.comparator)?.label ?? trigger.comparator;
      const dwell = trigger.forSeconds
        ? ` for ${trigger.forSeconds >= 60 ? `${Math.round(trigger.forSeconds / 60)} min` : `${trigger.forSeconds}s`}`
        : "";
      return `${METRIC_META[trigger.metric]?.label ?? trigger.metric} ${comparator} ${trigger.threshold}${dwell}`;
    }
  }
}

function describeCommand(command: ActuatorCommand): string {
  if (command.op === "level") return `${command.value}%`;
  return command.op === "on" ? "on" : "off";
}

function describeActions(actions: AutomationAction[]): string {
  if (actions.length === 0) return "does nothing";
  return actions.map((a) => `${roleName(a.role)} ${describeCommand(a.command)}`).join(", ");
}

// ── Editor ────────────────────────────────────────────────────────────────────

interface Draft {
  name: string;
  kind: TriggerKind;
  /** Window */
  on: string;
  off: string;
  /** Cron, expressed as the two shapes this page offers */
  cronMode: "daily" | "everyN";
  cronTime: string;
  cronEveryHours: number;
  /** Rule */
  metric: Metric;
  comparator: Comparator;
  threshold: number;
  forSeconds: number | undefined;
  actions: AutomationAction[];
}

function blankDraft(): Draft {
  return {
    name: "",
    kind: "window",
    on: "06:00",
    off: "18:00",
    cronMode: "daily",
    cronTime: "08:00",
    cronEveryHours: 6,
    metric: "temperature",
    comparator: "gt",
    threshold: 28,
    forSeconds: 300,
    actions: [{ role: "light", command: { op: "on" } }],
  };
}

/** Load an existing automation back into the editor's shape. */
function draftFrom(automation: AutomationRecord): Draft {
  const draft = blankDraft();
  draft.name = automation.name;
  draft.actions = automation.actions.length > 0 ? automation.actions : draft.actions;

  const trigger = automation.trigger;
  draft.kind = trigger.kind;
  if (trigger.kind === "window") {
    draft.on = trigger.on;
    draft.off = trigger.off;
  } else if (trigger.kind === "schedule") {
    const parts = trigger.cron.trim().split(/\s+/);
    if (parts[1]?.startsWith("*/")) {
      draft.cronMode = "everyN";
      draft.cronEveryHours = Number(parts[1].slice(2)) || 6;
    } else {
      draft.cronMode = "daily";
      draft.cronTime = `${pad2(Number(parts[1] ?? 8))}:${pad2(Number(parts[0] ?? 0))}`;
    }
  } else {
    draft.metric = trigger.metric;
    draft.comparator = trigger.comparator;
    draft.threshold = trigger.threshold;
    draft.forSeconds = trigger.forSeconds;
  }
  return draft;
}

/** The domain trigger a draft describes. */
function triggerFrom(draft: Draft): AutomationTrigger {
  if (draft.kind === "window") return { kind: "window", on: draft.on, off: draft.off };
  if (draft.kind === "schedule") {
    const [h = "8", m = "0"] = draft.cronTime.split(":");
    const cron = draft.cronMode === "everyN"
      ? `0 */${draft.cronEveryHours} * * *`
      : `${Number(m)} ${Number(h)} * * *`;
    return { kind: "schedule", cron };
  }
  return {
    kind: "rule",
    metric: draft.metric,
    comparator: draft.comparator,
    threshold: draft.threshold,
    ...(draft.forSeconds ? { forSeconds: draft.forSeconds } : {}),
  };
}

/**
 * Everything the engines need that the grower was not asked for.
 *
 * `kind`, `subsystem`, `driver` and `controlRes` are all implied by the trigger
 * and the equipment being driven. Asking would mean two answers that can
 * contradict each other — a "lighting" automation driving a pump — and the list
 * would group itself wrongly with no way to tell which answer was meant.
 */
function derivedFields(draft: Draft): Partial<AutomationRecord> {
  const trigger = triggerFrom(draft);
  const primaryRole = draft.actions[0]?.role;
  const variable = draft.actions.some((a) => a.command.op === "level");

  return {
    name: draft.name.trim(),
    trigger,
    actions: draft.actions,
    kind: trigger.kind === "rule" ? "rule" : "schedule",
    subsystem: subsystemForRole(primaryRole),
    driver: trigger.kind === "rule" ? "any" : "schedule",
    controlRes: variable ? "variable" : "on-off",
    ...(primaryRole ? { actuatorRole: primaryRole, requiresRole: primaryRole } : {}),
  };
}

function ActionRow({ action, canRemove, onChange, onRemove }: {
  action: AutomationAction;
  canRemove: boolean;
  onChange: (next: AutomationAction) => void;
  onRemove: () => void;
}) {
  const isLevel = action.command.op === "level";
  const level = isLevel ? (action.command as { value: number }).value : 100;

  return (
    <div className="au-action">
      <Select
        value={action.role}
        onValueChange={(role) => onChange({ ...action, role: role as RoleKind })}
      >
        <SelectTrigger style={{ width: "100%", maxWidth: 190 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONTROL_ROLES.map((id) => (
            <SelectItem key={id} value={id}>{ROLE_META[id].name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="tf-chips">
        {(["on", "off", "level"] as const).map((op) => (
          <button
            key={op}
            className={`tf-chip${action.command.op === op ? " on" : ""}`}
            aria-pressed={action.command.op === op}
            onClick={() =>
              onChange({
                ...action,
                command: op === "level" ? { op: "level", value: level } : { op },
              })
            }
          >
            {op === "level" ? "Level" : op === "on" ? "On" : "Off"}
          </button>
        ))}
      </div>

      {isLevel && (
        <span className="au-level">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={level}
            onChange={(e) =>
              onChange({ ...action, command: { op: "level", value: Number(e.target.value) } })
            }
          />
          <b>{level}%</b>
        </span>
      )}

      <button
        className="tf-close"
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? "Remove this action" : "An automation needs at least one action"}
        aria-label="Remove action"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

function AutomationEditor({ initial, busy, onCancel, onSave }: {
  initial?: AutomationRecord;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: Partial<AutomationRecord>) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (initial ? draftFrom(initial) : blankDraft()));
  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));

  const kindMeta = TRIGGER_KINDS.find((t) => t.id === draft.kind)!;
  const trigger = triggerFrom(draft);
  const valid = draft.name.trim().length > 0 && draft.actions.length > 0;

  return (
    <div className="tf-card" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="tf-head">
        <span className="tf-title">
          <Icon name={initial ? "gear" : "plus"} size={12} />
          {initial ? "Edit automation" : "New automation"}
        </span>
        <button className="tf-close" onClick={onCancel} title="Cancel (Esc)" aria-label="Cancel">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="tf-body">
        <input
          className="tf-name"
          autoFocus
          placeholder="What should this automation do?"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />

        <div className="tf-group">
          <span className="tf-label">Trigger</span>
          <div className="tf-chips">
            {TRIGGER_KINDS.map((t) => (
              <button
                key={t.id}
                className={`tf-chip${draft.kind === t.id ? " on" : ""}`}
                aria-pressed={draft.kind === t.id}
                onClick={() => patch({ kind: t.id })}
              >
                <Icon name={t.icon} size={11} /> {t.label}
              </button>
            ))}
          </div>
          <p className="au-hint">{kindMeta.hint}</p>
        </div>

        {draft.kind === "window" && (
          <div className="tf-grid">
            <div className="tf-group">
              <span className="tf-label">On at</span>
              <input
                className="au-time"
                type="time"
                value={draft.on}
                onChange={(e) => patch({ on: e.target.value })}
              />
            </div>
            <div className="tf-group">
              <span className="tf-label">Off at</span>
              <input
                className="au-time"
                type="time"
                value={draft.off}
                onChange={(e) => patch({ off: e.target.value })}
              />
            </div>
          </div>
        )}

        {draft.kind === "schedule" && (
          <div className="tf-group">
            <span className="tf-label">Repeat</span>
            <div className="tf-chips">
              <button
                className={`tf-chip${draft.cronMode === "daily" ? " on" : ""}`}
                aria-pressed={draft.cronMode === "daily"}
                onClick={() => patch({ cronMode: "daily" })}
              >
                Daily at a time
              </button>
              <button
                className={`tf-chip${draft.cronMode === "everyN" ? " on" : ""}`}
                aria-pressed={draft.cronMode === "everyN"}
                onClick={() => patch({ cronMode: "everyN" })}
              >
                Every few hours
              </button>
            </div>
            <div className="au-inline">
              {draft.cronMode === "daily" ? (
                <input
                  className="au-time"
                  type="time"
                  value={draft.cronTime}
                  onChange={(e) => patch({ cronTime: e.target.value })}
                />
              ) : (
                <>
                  <span className="au-inline-label">every</span>
                  <input
                    className="au-num"
                    type="number"
                    min={1}
                    max={23}
                    value={draft.cronEveryHours}
                    onChange={(e) =>
                      patch({
                        cronEveryHours: Math.min(23, Math.max(1, Number(e.target.value) || 1)),
                      })
                    }
                  />
                  <span className="au-inline-label">hours</span>
                </>
              )}
              {/* The generated expression, shown rather than hidden: it is what
                  the scheduler actually stores. */}
              <code className="au-cron">{(trigger as { cron: string }).cron}</code>
            </div>
          </div>
        )}

        {draft.kind === "rule" && (
          <>
            <div className="au-inline">
              <span className="au-inline-label">When</span>
              <Select value={draft.metric} onValueChange={(m) => patch({ metric: m as Metric })}>
                <SelectTrigger style={{ maxWidth: 170 }}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_METRICS.map((m) => (
                    <SelectItem key={m} value={m}>{METRIC_META[m].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={draft.comparator}
                onValueChange={(c) => patch({ comparator: c as Comparator })}
              >
                <SelectTrigger style={{ maxWidth: 150 }}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPARATORS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                className="au-num"
                type="number"
                value={draft.threshold}
                onChange={(e) => patch({ threshold: Number(e.target.value) })}
              />
            </div>

            <div className="tf-group">
              <span className="tf-label">Hold for</span>
              <div className="tf-chips">
                {DWELL_PRESETS.map((d) => (
                  <button
                    key={d.label}
                    className={`tf-chip${draft.forSeconds === d.seconds ? " on" : ""}`}
                    aria-pressed={draft.forSeconds === d.seconds}
                    onClick={() => patch({ forSeconds: d.seconds })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="au-hint">
                The reading must stay past the threshold this long before anything fires, so one
                noisy sample cannot switch a relay.
              </p>
            </div>
          </>
        )}

        <div className="tf-group">
          <span className="tf-label">
            {draft.kind === "window" ? "Inside the window" : "Then"}
          </span>
          <div className="au-actions-list">
            {draft.actions.map((action, i) => (
              <ActionRow
                key={i}
                action={action}
                canRemove={draft.actions.length > 1}
                onChange={(next) =>
                  patch({ actions: draft.actions.map((a, j) => (j === i ? next : a)) })
                }
                onRemove={() => patch({ actions: draft.actions.filter((_, j) => j !== i) })}
              />
            ))}
          </div>
          <button
            className="tf-chip au-add-action"
            onClick={() =>
              patch({ actions: [...draft.actions, { role: "circ", command: { op: "on" } }] })
            }
          >
            <Icon name="plus" size={11} /> Add equipment
          </button>
          {draft.kind === "window" && (
            <p className="au-hint">
              Outside the window each of these is switched off, so a window describes a state
              rather than a pair of events.
            </p>
          )}
        </div>
      </div>

      <div className="tf-foot">
        <span className="tf-preview">
          <Icon name="clock" size={12} />
          <b>{describeTrigger(trigger)}</b> → {describeActions(draft.actions)}
        </span>
        <span className="tf-actions">
          <span className="tf-hint">esc cancel</span>
          <button className="btn sm" onClick={onCancel}>Cancel</button>
          <button
            className="btn primary sm"
            disabled={!valid || busy}
            onClick={() => onSave(derivedFields(draft))}
          >
            <Icon name="check" size={13} /> {initial ? "Save changes" : "Create automation"}
          </button>
        </span>
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diffMs / 60_000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function AutomationCard({ automation, unassigned, busy, onToggle, onEdit, onDelete, onRelease }: {
  automation: AutomationRecord;
  unassigned: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRelease: () => void;
}) {
  const held = !!automation.overrideUntil && automation.overrideUntil > new Date().toISOString();

  return (
    <div className={`au-card${automation.enabled ? "" : " off"}`}>
      <div className="au-card-main">
        <div className="au-card-head">
          <span className="au-name">{automation.name}</span>
          {held && (
            <Tag variant="warn">
              <Icon name="lock" size={10} /> {automation.overrideState ?? "held"}
            </Tag>
          )}
          {unassigned && (
            <Tag variant="err">
              <Icon name="alert" size={10} /> no device for {roleName(automation.requiresRole!)}
            </Tag>
          )}
        </div>

        <div className="au-detail">
          <span className="au-trigger">
            <Icon
              name={TRIGGER_KINDS.find((t) => t.id === automation.trigger.kind)!.icon}
              size={11}
            />
            {describeTrigger(automation.trigger)}
          </span>
          <span className="au-arrow">→</span>
          <span className="au-effect">{describeActions(automation.actions)}</span>
        </div>
      </div>

      <div className="au-card-side">
        {automation.enabled && automation.nextRunAt && (
          <span className="au-next">{relativeTime(automation.nextRunAt)}</span>
        )}
        {held && (
          <button className="btn sm" onClick={onRelease} disabled={busy}>Release</button>
        )}
        <Toggle on={automation.enabled} disabled={busy} onChange={onToggle} />
        <button className="tf-close" onClick={onEdit} title="Edit" aria-label="Edit automation">
          <Icon name="gear" size={13} />
        </button>
        <button className="tf-close" onClick={onDelete} title="Delete" aria-label="Delete automation">
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Automation() {
  const workspace = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: automations = [], isLoading } = useAutomations(workspace?.id);
  const { data: roleList = [] } = useRoles(workspace?.id);

  const create = useCreateAutomation(workspaceId);
  const update = useUpdateAutomation(workspaceId);
  const remove = useDeleteAutomation(workspaceId);

  const [editing, setEditing] = useState<string | "new" | null>(null);

  const busy = create.isPending || update.isPending || remove.isPending;
  const assignedRoles = useMemo(
    () => new Set(roleList.map((r) => r.role)),
    [roleList],
  );

  const enabledCount = automations.filter((a) => a.enabled).length;

  /** Grouped by the subsystem the controller stored, in catalogue order. */
  const groups = useMemo(
    () =>
      SUBSYSTEMS.map((subsystem) => ({
        ...subsystem,
        items: automations.filter((a) => a.subsystem === subsystem.id),
      })).filter((g) => g.items.length > 0),
    [automations],
  );

  const editingRecord = editing && editing !== "new"
    ? automations.find((a) => a.id === editing)
    : undefined;

  const badge = automations.length > 0 ? (
    <span className="tag b-ok">
      <span className="dot-live" style={{ width: 7, height: 7 }} />
      {enabledCount}/{automations.length} on
    </span>
  ) : null;

  const actions = (
    <button className="btn sm" onClick={() => setEditing(editing === "new" ? null : "new")}>
      <Icon name="plus" size={13} /> New automation
    </button>
  );

  return (
    <>
      <ContentHeader
        title="Automation"
        crumbs={[workspace?.name ?? "Workspace", "Manage"]}
        badge={badge}
        actions={actions}
      />

      <div className="flex-1 overflow-y-auto" style={{ padding: "18px 22px" }}>
        {isLoading || !workspace ? null : (
          <>
            {editing === "new" && (
              <AutomationEditor
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(fields) => {
                  create.mutate(fields, { onSuccess: () => setEditing(null) });
                }}
              />
            )}

            {automations.length === 0 && editing !== "new" && (
              <EmptyState
                icon="automation"
                title="No automations yet"
                description="An automation watches the clock or a sensor and drives your equipment. Create one with the button above — a light on a daily window is the usual first."
              />
            )}

            {groups.map((group) => (
              <div className="mt-group" key={group.id}>
                <div className="mt-group-h">
                  <h4><Icon name={group.icon} size={12} /> {group.label}</h4>
                  <span className="gh-sub">
                    {group.items.filter((a) => a.enabled).length}/{group.items.length} on
                  </span>
                  <span className="rule" />
                </div>

                <div className="au-list">
                  {group.items.map((automation) =>
                    editingRecord?.id === automation.id ? (
                      <AutomationEditor
                        key={automation.id}
                        initial={automation}
                        busy={busy}
                        onCancel={() => setEditing(null)}
                        onSave={(fields) => {
                          update.mutate(
                            { id: automation.id, ...fields },
                            { onSuccess: () => setEditing(null) },
                          );
                        }}
                      />
                    ) : (
                      <AutomationCard
                        key={automation.id}
                        automation={automation}
                        busy={busy}
                        unassigned={
                          !!automation.requiresRole && !assignedRoles.has(automation.requiresRole)
                        }
                        onToggle={(enabled) => update.mutate({ id: automation.id, enabled })}
                        onEdit={() => setEditing(automation.id)}
                        onDelete={() => remove.mutate(automation.id)}
                        onRelease={() =>
                          // Explicit nulls: omitting a key means "leave
                          // unchanged", so this is how a hold is cleared.
                          update.mutate({
                            id: automation.id,
                            overrideUntil: null,
                            overrideState: null,
                          })
                        }
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
