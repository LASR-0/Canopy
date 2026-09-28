import { useMemo, useState } from "react";
import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";
import { Icon, type IconName } from "@/components/Icon";
import { Toggle } from "@/components/Toggle";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { useDevices } from "@/hooks/useDevices";
import {
  isDoneToday,
  isOverdue,
  localDateKey,
  useCompleteTask,
  useCreateTask,
  useDeleteTask,
  useMaintenance,
  useMaintenanceHistory,
  useSkipTask,
  useUpdateTask,
} from "@/hooks/useMaintenance";
import type {
  Device,
  MaintenanceCadence,
  MaintenanceCompletion,
  MaintenanceGroupTime,
  MaintenanceTask,
} from "@canopy/shared-types";

type TabId = "today" | "week" | "history";

const TABS: { id: TabId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "history", label: "History" },
];

const CADENCE: Record<MaintenanceCadence, { label: string; cls: string }> = {
  daily:   { label: "Daily",      cls: "cad-daily" },
  weekly:  { label: "Weekly",     cls: "cad-weekly" },
  stage:   { label: "By stage",   cls: "cad-stage" },
  runtime: { label: "By runtime", cls: "cad-runtime" },
  custom:  { label: "Custom",     cls: "cad-custom" },
};

const GROUPS: { id: MaintenanceGroupTime; label: string; sub: string }[] = [
  { id: "morning", label: "Morning", sub: "06:00 – 12:00" },
  { id: "today",   label: "Anytime today", sub: "due before end of day" },
  { id: "evening", label: "Evening", sub: "after lights-off" },
];

/**
 * Repeat options offered when adding a task.
 *
 * "Monthly" is not a cadence in the domain — it is a 30-day interval, which the
 * existing model already expresses. Offering the word the grower thinks in, and
 * storing what the scheduler understands, beats adding a fifth cadence that
 * means the same as the fourth.
 */
const REPEAT_PRESETS: {
  id: string;
  label: string;
  cadence: MaintenanceCadence;
  intervalDays?: number;
}[] = [
  { id: "daily",   label: "Daily",   cadence: "daily" },
  { id: "weekly",  label: "Weekly",  cadence: "weekly", intervalDays: 7 },
  { id: "monthly", label: "Monthly", cadence: "weekly", intervalDays: 30 },
  { id: "stage",   label: "By stage", cadence: "stage" },
];

/** A rough icon per task, picked from the name. Cosmetic only. */
function taskIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (n.includes("ph") || n.includes("calibrat")) return "beaker";
  if (n.includes("water") || n.includes("reservoir") || n.includes("nutrient")) return "drop";
  if (n.includes("filter") || n.includes("fan") || n.includes("airflow")) return "fan";
  if (n.includes("inspect") || n.includes("check")) return "eye";
  if (n.includes("prune") || n.includes("trim")) return "scissors";
  if (n.includes("light") || n.includes("lamp")) return "sun";
  if (n.includes("clean")) return "refresh";
  return "target";
}

function describeCadence(task: MaintenanceTask): string {
  switch (task.cadence) {
    case "daily":   return "every day";
    case "weekly":  return `every ${task.intervalDays ?? 7} days`;
    case "custom":  return `every ${task.intervalDays ?? 1} days`;
    case "stage":   return "once per grow stage";
    case "runtime": return `every ${task.runtimeHoursInterval ?? 100} runtime hours`;
  }
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ─────────────────────────── Needs attention ─────────────────────────── */

interface Attention {
  id: string;
  severity: "warn" | "err";
  icon: IconName;
  title: string;
  meta: string;
  source: string;
}

/**
 * Derived from real state rather than a separate health model: a device that
 * stopped reporting, and a task that fell due before today. Both are things the
 * grower has to act on, and both are already known without inventing anything.
 */
function useAttention(tasks: MaintenanceTask[], devices: Device[]): Attention[] {
  return useMemo(() => {
    const items: Attention[] = [];

    for (const device of devices) {
      if (device.online) continue;
      items.push({
        id: `offline-${device.id}`,
        severity: "err",
        icon: "plug",
        title: "Device offline",
        meta: device.lastSeen
          ? `no telemetry since ${new Date(device.lastSeen).toLocaleString()}`
          : "never reported",
        source: device.name,
      });
    }

    for (const task of tasks) {
      if (!isOverdue(task)) continue;
      const due = new Date(task.nextDueAt!);
      const days = Math.max(1, Math.round((Date.now() - due.getTime()) / 86_400_000));
      items.push({
        id: `overdue-${task.id}`,
        severity: days > 3 ? "err" : "warn",
        icon: taskIcon(task.name),
        title: `${task.name} overdue`,
        meta: `due ${days} day${days === 1 ? "" : "s"} ago · ${describeCadence(task)}`,
        source: task.seededBy ?? "You",
      });
    }

    return items;
  }, [tasks, devices]);
}

function AttentionPanel({ items }: { items: Attention[] }) {
  if (items.length === 0) return null;

  return (
    <div className="na-panel">
      <div className="na-head">
        <span className="na-ico"><Icon name="alert" size={14} /></span>
        <h3>Needs attention</h3>
        <span className="na-count">{items.length}</span>
      </div>
      {items.map((item) => (
        <div className="na-row" key={item.id}>
          <span className={`na-sev ${item.severity}`}><Icon name={item.icon} size={15} /></span>
          <div className="na-info">
            <div className="na-title">{item.title}</div>
            <div className="na-meta"><span className="na-dev">{item.source}</span> · {item.meta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────── Task row ──────────────────────────────── */

interface TaskRowProps {
  task: MaintenanceTask;
  deviceName?: string;
  editing: boolean;
  busy: boolean;
  onToggleDone: (task: MaintenanceTask) => void;
  onSkip: (task: MaintenanceTask) => void;
  onToggleBell: (task: MaintenanceTask) => void;
  onEdit: (id: string) => void;
  onSetCadence: (task: MaintenanceTask, cadence: MaintenanceCadence, interval?: number) => void;
  onDelete: (task: MaintenanceTask) => void;
}

function TaskRow({
  task, deviceName, editing, busy,
  onToggleDone, onSkip, onToggleBell, onEdit, onSetCadence, onDelete,
}: TaskRowProps) {
  const done = isDoneToday(task);
  const overdue = isOverdue(task);
  const cadence = CADENCE[task.cadence];

  return (
    <>
      <div className={`task-row${done ? " done" : ""}`}>
        <button
          className={`tcheck${done ? " on" : ""}`}
          onClick={() => onToggleDone(task)}
          disabled={busy || done}
          title={done ? "Completed today" : "Mark done"}
        >
          <Icon name="check" size={13} />
        </button>

        <span className="t-ico" style={{ color: done ? "var(--success-fg)" : "var(--fg-muted)" }}>
          <Icon name={taskIcon(task.name)} size={15} />
        </span>

        <div className="t-info">
          <div className="t-name">
            {task.name}
            {overdue && <span className="tag b-err" style={{ fontSize: 10 }}>overdue</span>}
          </div>
          <div className="t-sub">
            <span>{describeCadence(task)}</span>
            {deviceName && <span className="t-dev">· {deviceName}</span>}
            {/* Only device discovery sets a source, so a task without one was
                made by hand. Saying so beats leaving it anonymous. */}
            <span className="t-dev">· from {task.seededBy ?? "You"}</span>
          </div>
        </div>

        {done && task.lastDoneAt && (
          <span className="t-done-at"><Icon name="check" size={12} /> {timeOfDay(task.lastDoneAt)}</span>
        )}

        <span
          className={`cadence-tag ${cadence.cls}`}
          onClick={() => onEdit(task.id)}
          title="Edit cadence"
        >
          <Icon name="clock" size={11} />{cadence.label}
        </span>

        {!done && (
          <button className="btn sm" onClick={() => onSkip(task)} disabled={busy} title="Skip today">
            Skip
          </button>
        )}

        <button
          className={`t-bell${task.notifications ? " on" : ""}`}
          onClick={() => onToggleBell(task)}
          title={task.notifications ? "Notifications on" : "Notifications off"}
          style={{ opacity: task.notifications ? 1 : 0.45 }}
        >
          <Icon name="bell" size={15} />
        </button>

        <button className="t-del" onClick={() => onDelete(task)} title="Remove task">
          <Icon name="trash" size={14} />
        </button>
      </div>

      {editing && (
        <CadenceEditor
          task={task}
          onSave={(cadence, interval) => { onSetCadence(task, cadence, interval); onEdit(task.id); }}
          onClose={() => onEdit(task.id)}
        />
      )}
    </>
  );
}


/**
 * Cadence editor.
 *
 * Only `weekly` and `runtime` carry a number, so only those show a slider.
 * Showing one for `stage` would imply a schedule that does not exist — the grow
 * moves it on, not a clock.
 */
function CadenceEditor({
  task, onSave, onClose,
}: {
  task: MaintenanceTask;
  onSave: (cadence: MaintenanceCadence, interval?: number) => void;
  onClose: () => void;
}) {
  const [cadence, setCadence] = useState<MaintenanceCadence>(task.cadence);
  const [everyDays, setEveryDays] = useState(task.intervalDays ?? 7);
  const [hours, setHours] = useState(task.runtimeHoursInterval ?? 250);

  const interval =
    cadence === "weekly" || cadence === "custom" ? everyDays
    : cadence === "runtime" ? hours
    : undefined;

  return (
    <div className="cad-pop">
      <div className="cad-opts">
        {(Object.keys(CADENCE) as MaintenanceCadence[]).map((id) => (
          <button
            key={id}
            className={`cad-opt${cadence === id ? " on" : ""}`}
            onClick={() => setCadence(id)}
          >
            {CADENCE[id].label}
          </button>
        ))}
      </div>

      {(cadence === "weekly" || cadence === "custom") && (
        <div className="cad-detail">
          Repeat every
          <input
            type="range" min={1} max={30}
            value={everyDays}
            onChange={(e) => setEveryDays(Number(e.target.value))}
          />
          <b>{everyDays} day{everyDays > 1 ? "s" : ""}</b>
        </div>
      )}
      {cadence === "runtime" && (
        <div className="cad-detail">
          Trigger every
          <input
            type="range" min={50} max={500} step={10}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
          <b>{hours} runtime-hrs</b>
        </div>
      )}
      {cadence === "stage" && (
        <div className="cad-detail">Runs on stage transitions — managed by <b>Grow Cycle</b>.</div>
      )}
      {cadence === "daily" && <div className="cad-detail">Surfaces once every day.</div>}

      <div className="cad-foot">
        <button className="btn primary sm" onClick={() => onSave(cadence, interval)}>
          <Icon name="check" size={13} /> Save cadence
        </button>
        <button className="btn sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ──────────────────────────────── Today ──────────────────────────────── */

function TodayView({
  workspaceId, tasks, devices,
}: {
  workspaceId: string;
  tasks: MaintenanceTask[];
  devices: Device[];
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRepeat, setNewRepeat] = useState("daily");
  const [newGroup, setNewGroup] = useState<MaintenanceGroupTime>("today");

  const complete = useCompleteTask(workspaceId);
  const skip = useSkipTask(workspaceId);
  const update = useUpdateTask(workspaceId);
  const remove = useDeleteTask(workspaceId);
  const create = useCreateTask(workspaceId);

  const attention = useAttention(tasks, devices);
  const deviceNames = useMemo(
    () => new Map(devices.map((d) => [d.id, d.name])),
    [devices],
  );

  const done = tasks.filter(isDoneToday).length;
  const busy = complete.isPending || skip.isPending || update.isPending || remove.isPending;

  const resetForm = () => {
    setNewName("");
    setNewRepeat("daily");
    setNewGroup("today");
    setAdding(false);
  };

  /**
   * What the current selection will actually do, in the grower's words.
   *
   * The two choice sets are independent and their consequence is not obvious
   * from either alone — "by stage" produces no date at all, which is worth
   * saying before the task is created rather than after it fails to appear in
   * the Week view.
   */
  const previewLine = useMemo(() => {
    const preset = REPEAT_PRESETS.find((r) => r.id === newRepeat) ?? REPEAT_PRESETS[0]!;
    const group = GROUPS.find((g) => g.id === newGroup) ?? GROUPS[0]!;

    if (preset.cadence === "stage") {
      return <>No fixed date — moves with the <b>grow stage</b>, shown under <b>{group.label}</b></>;
    }
    const days = preset.intervalDays ?? 1;
    return (
      <>
        First due <b>today</b> · <b>{group.label}</b> ({group.sub}) · then every{" "}
        <b>{days === 1 ? "day" : `${days} days`}</b>
      </>
    );
  }, [newRepeat, newGroup]);

  const addTask = () => {
    const name = newName.trim();
    if (!name) return;

    const preset = REPEAT_PRESETS.find((r) => r.id === newRepeat) ?? REPEAT_PRESETS[0]!;

    create.mutate({
      name,
      cadence: preset.cadence,
      ...(preset.intervalDays ? { intervalDays: preset.intervalDays } : {}),
      groupTime: newGroup,
      notifications: true,
      // Marks it as the grower's own, so the row reads "from You" rather than
      // naming a device that never generated it.
      seededBy: "You",
      // A stage task has no date; anything else starts due now.
      ...(preset.cadence === "stage" ? {} : { nextDueAt: new Date().toISOString() }),
    });
    resetForm();
  };

  return (
    <>
      <AttentionPanel items={attention} />

      <div className="sec-head">
        <h2>Today’s tasks</h2>
        <span className="mt-prog">
          <span className="mt-prog-bar">
            <span
              className="mt-prog-fill"
              style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }}
            />
          </span>
          {done} of {tasks.length} done
        </span>
        <span className="rule" />
        <button className="btn sm" onClick={() => setAdding((a) => !a)}>
          <Icon name="plus" size={13} /> Add task
        </button>
      </div>

      {adding && (
        // Escape is handled on the card rather than the name field: once focus
        // moves to a chip the form should still be dismissable.
        <div className="tf-card" onKeyDown={(e) => { if (e.key === "Escape") resetForm(); }}>
          <div className="tf-head">
            <span className="tf-title"><Icon name="plus" size={12} /> New task</span>
            <button className="tf-close" onClick={resetForm} title="Cancel (Esc)" aria-label="Cancel">
              <Icon name="x" size={13} />
            </button>
          </div>

          <div className="tf-body">
            <input
              className="tf-name"
              autoFocus
              placeholder="What needs doing?"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
            />

            <div className="tf-grid">
              <div className="tf-group">
                <span className="tf-label">Repeat</span>
                <div className="tf-chips">
                  {REPEAT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={`tf-chip${newRepeat === preset.id ? " on" : ""}`}
                      aria-pressed={newRepeat === preset.id}
                      onClick={() => setNewRepeat(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="tf-group">
                <span className="tf-label">When</span>
                <div className="tf-chips">
                  {GROUPS.map((group) => (
                    <button
                      key={group.id}
                      className={`tf-chip${newGroup === group.id ? " on" : ""}`}
                      aria-pressed={newGroup === group.id}
                      onClick={() => setNewGroup(group.id)}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="tf-foot">
            <span className="tf-preview">
              <Icon name="clock" size={12} />
              {previewLine}
            </span>
            <span className="tf-actions">
              <span className="tf-hint">⏎ add · esc cancel</span>
              <button className="btn sm" onClick={resetForm}>Cancel</button>
              <button className="btn primary sm" onClick={addTask} disabled={!newName.trim()}>
                <Icon name="plus" size={13} /> Add task
              </button>
            </span>
          </div>
        </div>
      )}

      {tasks.length === 0 && !adding && (
        <EmptyState
          icon="maintenance"
          title="No maintenance tasks yet"
          description="Nothing is scheduled for this tent. Add a task with the button above and Canopy will track when it next falls due."
        />
      )}

      {GROUPS.map((group) => {
        const inGroup = tasks.filter((t) => t.groupTime === group.id);
        if (inGroup.length === 0) return null;
        const groupDone = inGroup.filter(isDoneToday).length;

        return (
          <div className="mt-group" key={group.id}>
            <div className="mt-group-h">
              <h4>{group.label}</h4>
              <span className="gh-sub">{group.sub} · {groupDone}/{inGroup.length}</span>
              <span className="rule" />
            </div>
            <div className="task-list">
              {inGroup.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  {...(task.deviceId && deviceNames.get(task.deviceId)
                    ? { deviceName: deviceNames.get(task.deviceId)! }
                    : {})}
                  editing={editId === task.id}
                  busy={busy}
                  onToggleDone={(t) => complete.mutate({ id: t.id })}
                  onSkip={(t) => skip.mutate({ id: t.id })}
                  onToggleBell={(t) => update.mutate({ id: t.id, notifications: !t.notifications })}
                  onEdit={(id) => setEditId(editId === id ? null : id)}
                  onSetCadence={(t, cadence, interval) => update.mutate({
                    id: t.id,
                    cadence,
                    ...(interval == null
                      ? {}
                      : cadence === "runtime"
                        ? { runtimeHoursInterval: interval }
                        : { intervalDays: interval }),
                  })}
                  onDelete={(t) => remove.mutate(t.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ───────────────────────────────── Week ───────────────────────────────── */

/**
 * The next seven days, each with what falls due on it.
 *
 * Only cadences with a real schedule can be projected. Stage and runtime tasks
 * have no next date to place, so they are listed separately rather than being
 * guessed onto a day.
 */
function WeekView({ tasks }: { tasks: MaintenanceTask[] }) {
  const days = useMemo(() => {
    const out: { key: string; label: string; tasks: MaintenanceTask[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const key = localDateKey(date);
      out.push({
        key,
        label: i === 0
          ? "Today"
          : date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }),
        // Today also carries anything already overdue. A task that fell due
        // last week has a date outside this window, and dropping it would make
        // the one task most needing attention the only one you cannot see.
        tasks: tasks.filter((t) =>
          i === 0
            ? t.nextDueAt != null && t.nextDueAt.slice(0, 10) <= key
            : t.nextDueAt?.slice(0, 10) === key,
        ),
      });
    }
    return out;
  }, [tasks]);

  const unscheduled = tasks.filter((t) => !t.nextDueAt);

  return (
    <>
      <div className="sec-head">
        <h2>Next seven days</h2>
        <span className="rule" />
      </div>

      {days.map((day) => (
        <div className="mt-group" key={day.key}>
          <div className="mt-group-h">
            <h4>{day.label}</h4>
            <span className="gh-sub">
              {day.tasks.length === 0 ? "nothing due" : `${day.tasks.length} due`}
            </span>
            <span className="rule" />
          </div>
          {day.tasks.length > 0 && (
            <div className="task-list">
              {day.tasks.map((task) => (
                <div className="task-row" key={task.id}>
                  <span className="t-ico"><Icon name={taskIcon(task.name)} size={15} /></span>
                  <div className="t-info">
                    <div className="t-name">
                      {task.name}
                      {isOverdue(task) && (
                        <span className="tag b-err" style={{ fontSize: 10 }}>overdue</span>
                      )}
                    </div>
                    <div className="t-sub"><span>{describeCadence(task)}</span></div>
                  </div>
                  <span className={`cadence-tag ${CADENCE[task.cadence].cls}`}>
                    <Icon name="clock" size={11} />{CADENCE[task.cadence].label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {unscheduled.length > 0 && (
        <div className="mt-group">
          <div className="mt-group-h">
            <h4>Not on a date</h4>
            <span className="gh-sub">driven by grow stage or device runtime</span>
            <span className="rule" />
          </div>
          <div className="task-list">
            {unscheduled.map((task) => (
              <div className="task-row" key={task.id}>
                <span className="t-ico"><Icon name={taskIcon(task.name)} size={15} /></span>
                <div className="t-info">
                  <div className="t-name">{task.name}</div>
                  <div className="t-sub"><span>{describeCadence(task)}</span></div>
                </div>
                <span className={`cadence-tag ${CADENCE[task.cadence].cls}`}>
                  <Icon name="clock" size={11} />{CADENCE[task.cadence].label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ──────────────────────────────── History ──────────────────────────────── */

function HistoryView({
  completions, tasks,
}: {
  completions: MaintenanceCompletion[];
  tasks: MaintenanceTask[];
}) {
  const names = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks]);

  const byDay = useMemo(() => {
    const groups = new Map<string, MaintenanceCompletion[]>();
    for (const c of completions) {
      const day = c.completedAt.slice(0, 10);
      const list = groups.get(day) ?? [];
      list.push(c);
      groups.set(day, list);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [completions]);

  if (completions.length === 0) {
    return (
      <EmptyState
        icon="maintenance"
        title="Nothing logged yet"
        description="Completing or skipping a task writes it here, so you can see what was actually done and when."
      />
    );
  }

  return (
    <>
      <div className="sec-head">
        <h2>Maintenance log</h2>
        <span className="mt-prog">{completions.length} records</span>
        <span className="rule" />
      </div>

      {byDay.map(([day, records]) => (
        <div className="mt-group" key={day}>
          <div className="mt-group-h">
            <h4>{new Date(`${day}T00:00:00`).toLocaleDateString([], {
              weekday: "long", day: "numeric", month: "long",
            })}</h4>
            <span className="gh-sub">{records.length} record{records.length === 1 ? "" : "s"}</span>
            <span className="rule" />
          </div>
          <div className="task-list">
            {records.map((record) => (
              <div className={`task-row${record.status === "completed" ? " done" : ""}`} key={record.id}>
                <span className="t-ico" style={{
                  color: record.status === "completed" ? "var(--success-fg)" : "var(--fg-muted)",
                }}>
                  <Icon name={record.status === "completed" ? "check" : "minus"} size={15} />
                </span>
                <div className="t-info">
                  <div className="t-name">{names.get(record.taskId) ?? "Removed task"}</div>
                  <div className="t-sub">
                    <span>{record.status === "completed" ? "completed" : "skipped"}</span>
                    {record.note && <span className="t-dev">· {record.note}</span>}
                  </div>
                </div>
                <span className="t-done-at">{timeOfDay(record.completedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/* ───────────────────────────────── Page ───────────────────────────────── */

export function Maintenance() {
  const [tab, setTab] = useState<TabId>("today");
  const workspace = useActiveWorkspace();
  const { data: tasks = [], isLoading } = useMaintenance(workspace?.id);
  const { data: completions = [] } = useMaintenanceHistory(workspace?.id);
  const { data: devices = [] } = useDevices(workspace?.id);

  const doneToday = tasks.filter(isDoneToday).length;
  const attention = useAttention(tasks, devices);
  const notifyAll = tasks.length > 0 && tasks.every((t) => t.notifications);
  const update = useUpdateTask(workspace?.id ?? "");

  const badge = (
    <>
      {tab === "today" && tasks.length > 0 && (
        <span className="tag b-ok">
          <span className="dot-live" style={{ width: 7, height: 7 }} /> {doneToday}/{tasks.length} today
        </span>
      )}
      {attention.length > 0 && (
        <span className="tag b-warn">
          <Icon name="alert" size={11} /> {attention.length} attention
        </span>
      )}
    </>
  );

  const actions = (
    <>
      <span className="notif-pref">
        <Icon name="bell" size={14} />
        <span className="notif-label">OS notifications</span>
        <Toggle
          on={notifyAll}
          disabled={tasks.length === 0}
          onChange={(on) => {
            for (const task of tasks) {
              if (task.notifications !== on) update.mutate({ id: task.id, notifications: on });
            }
          }}
        />
      </span>
      <div className="j-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <ContentHeader
        title="Maintenance"
        crumbs={[workspace?.name ?? "Workspace", "Service"]}
        badge={badge}
        actions={actions}
      />

      <div className="flex-1 overflow-y-auto" style={{ padding: "18px 22px" }}>
        {isLoading || !workspace ? null : tab === "today" ? (
          <TodayView workspaceId={workspace.id} tasks={tasks} devices={devices} />
        ) : tab === "week" ? (
          <WeekView tasks={tasks} />
        ) : (
          <HistoryView completions={completions} tasks={tasks} />
        )}
      </div>
    </>
  );
}
