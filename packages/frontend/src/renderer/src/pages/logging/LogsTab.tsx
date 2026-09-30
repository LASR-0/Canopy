import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDevices } from "@/hooks/useDevices";
import { useLogs } from "@/hooks/useEvents";
import { METRIC_META } from "@/lib/metrics";
import { eventText } from "@/lib/events";
import { cn, formatDuration, formatWhen } from "@/lib/utils";
import type { AppEvent, Metric, OutOfRangePeriod } from "@canopy/shared-types";

/** Windows the Logs tab offers. Events are kept 90 days by default. */
const WINDOWS = [
  { key: "24H", ms: 86_400_000 },
  { key: "7D", ms: 7 * 86_400_000 },
  { key: "30D", ms: 30 * 86_400_000 },
  { key: "90D", ms: 90 * 86_400_000 },
] as const;
type WindowKey = (typeof WINDOWS)[number]["key"];

type Kind = "range" | "automation" | "device" | "maintenance";

const KINDS: { key: Kind; label: string }[] = [
  { key: "range", label: "Out of range" },
  { key: "automation", label: "Automations" },
  { key: "device", label: "Devices" },
  { key: "maintenance", label: "Maintenance" },
];

export function kindOf(event: AppEvent): Kind {
  if (event.type === "device_offline" || event.type === "device_online") return "device";
  if (event.type === "maintenance_due") return "maintenance";
  return "automation";
}

/** The tag a non-alert row carries: what happened, coloured by how much it matters. */
export const EVENT_TAG: Partial<Record<AppEvent["type"], { label: string; cls: string }>> = {
  automation_failed: { label: "Failed run", cls: "b-err" },
  failsafe_trip:     { label: "Failsafe", cls: "b-err" },
  device_offline:    { label: "Offline", cls: "b-warn" },
  device_online:     { label: "Back online", cls: "b-ok" },
  maintenance_due:   { label: "Due", cls: "b-warn" },
};

export type LogRow =
  | { kind: "range"; at: string; period: OutOfRangePeriod }
  | { kind: Exclude<Kind, "range">; at: string; event: AppEvent };

/** Periods and events as one list, newest first. */
export function logRows(periods: OutOfRangePeriod[], events: AppEvent[]): LogRow[] {
  return [
    ...periods.map((period) => ({ kind: "range" as const, at: period.startedAt, period })),
    ...events.map((event) => ({ kind: kindOf(event), at: event.occurredAt, event }) as LogRow),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

/** A period's headline: the step that reached its worst level says what it was about. */
export function periodText(p: OutOfRangePeriod): string {
  const worst = p.steps.find((st) => st.severity === p.worst) ?? p.steps[0]!;
  return eventText(worst.description, p.metric);
}

export function periodTag(p: OutOfRangePeriod): { label: string; cls: string } {
  return p.worst === "err" ? { label: "Out of range", cls: "b-err" } : { label: "Near the edge", cls: "b-warn" };
}

const ALL_METRICS = "all";

/**
 * What went wrong in a window: readings out of range (one row per
 * excursion), failed runs, devices dropping off, tasks falling due.
 */
export function LogsTab({ workspaceId }: { workspaceId: string }) {
  const [windowKey, setWindowKey] = useState<WindowKey>("24H");
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(new Set(KINDS.map((k) => k.key)));
  const [metric, setMetric] = useState<Metric | typeof ALL_METRICS>(ALL_METRICS);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const bounds = useMemo(() => {
    const to = Date.now();
    return { from: to - WINDOWS.find((w) => w.key === windowKey)!.ms, to };
  }, [windowKey]);

  const { data, isFetching } = useLogs(workspaceId, windowKey, bounds.from, bounds.to);
  const { data: devices = [] } = useDevices(workspaceId);
  const deviceName = useMemo(() => new Map(devices.map((d) => [d.id, d.name])), [devices]);

  const periods = data?.periods ?? [];
  const events = data?.events ?? [];
  const metricsSeen = useMemo(
    () => [...new Set(periods.map((p) => p.metric).filter((m): m is Metric => !!m))],
    [periods],
  );

  const rows = useMemo(
    () =>
      logRows(periods, events)
        .filter((r) => kinds.has(r.kind))
        // A metric only narrows out-of-range rows: nothing else is about a metric.
        .filter((r) => metric === ALL_METRICS || (r.kind === "range" && r.period.metric === metric)),
    [periods, events, kinds, metric],
  );

  const ongoing = periods.filter((p) => !p.endedAt).length;
  const counts = {
    range: periods.length,
    automation: events.filter((e) => kindOf(e) === "automation").length,
    device: events.filter((e) => kindOf(e) === "device").length,
    maintenance: events.filter((e) => kindOf(e) === "maintenance").length,
  };

  const toggleKind = (k: Kind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const toggleRow = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const source = (deviceId?: string, channel?: string) =>
    [deviceId ? deviceName.get(deviceId) ?? "Removed device" : null, channel].filter(Boolean).join(" · ");

  return (
    <div className="lt">
      <div className="chart-toolbar">
        <div className="segmented">
          {WINDOWS.map((w) => (
            <button key={w.key} className={windowKey === w.key ? "on" : ""} onClick={() => setWindowKey(w.key)}>
              {w.key}
            </button>
          ))}
        </div>
        <div className="lt-kinds">
          {KINDS.map((k) => (
            <button
              key={k.key}
              className={cn("copt", kinds.has(k.key) && "on")}
              aria-pressed={kinds.has(k.key)}
              onClick={() => toggleKind(k.key)}
            >
              {k.label} <span className="lt-n">{counts[k.key]}</span>
            </button>
          ))}
        </div>
        <div className="ct-spacer" />
        <Select value={metric} onValueChange={(v) => setMetric(v as Metric | typeof ALL_METRICS)}>
          <SelectTrigger className="lt-metric" aria-label="Metric">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_METRICS}>All metrics</SelectItem>
            {metricsSeen.map((m) => (
              <SelectItem key={m} value={m}>{METRIC_META[m].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="lt-summary">
        {counts.range} out-of-range period{counts.range === 1 ? "" : "s"}
        {ongoing > 0 && <span className="lt-ongoing"> · {ongoing} ongoing</span>}
        {" · "}{counts.automation} automation problem{counts.automation === 1 ? "" : "s"}
        {" · "}{counts.device} device change{counts.device === 1 ? "" : "s"}
        {" · "}{counts.maintenance} task{counts.maintenance === 1 ? "" : "s"} due
        {metric !== ALL_METRICS && <span className="lt-note"> · filtered to {METRIC_META[metric].label}, so only out-of-range rows show</span>}
      </div>

      {data && rows.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing to show"
          description={
            periods.length + events.length === 0
              ? `Nothing went wrong in the last ${windowKey}.`
              : "Nothing matches these filters."
          }
        />
      ) : (
        <div className="box lt-table" style={{ opacity: isFetching && !data ? 0.6 : 1 }}>
          <div className="lt-row lt-head">
            <span />
            <span>When</span>
            <span>What</span>
            <span>Source</span>
            <span className="lt-right">Duration</span>
          </div>
          {rows.map((row) => {
            if (row.kind === "range") {
              const p = row.period;
              const open = expanded.has(p.id);
              const tag = periodTag(p);
              return (
                <div key={p.id} className="lt-group">
                  <button className={cn("lt-row lt-click", open && "open")} onClick={() => toggleRow(p.id)} aria-expanded={open}>
                    <span className="lt-chev" style={{ transform: open ? "none" : "rotate(-90deg)" }}>
                      <Icon name="chevron" size={12} />
                    </span>
                    <span className="lt-when">{formatWhen(p.startedAt)}</span>
                    <span className="lt-what">
                      <span className={cn("tag", tag.cls)}>{tag.label}</span>
                      <span className="lt-desc">{periodText(p)}</span>
                    </span>
                    <span className="lt-src">{source(p.deviceId, p.channel)}</span>
                    <span className="lt-right">
                      {p.endedAt ? formatDuration(Date.parse(p.endedAt) - Date.parse(p.startedAt)) : <span className="tag b-err">ongoing</span>}
                    </span>
                  </button>
                  {open && (
                    <div className="lt-steps">
                      {p.steps.map((step, i) => (
                        <div key={i} className="lt-step">
                          <span className="lt-when">{formatWhen(step.at)}</span>
                          <span className={cn("lt-dot", step.severity ?? "ok")} />
                          <span>{eventText(step.description, p.metric)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            const e = row.event;
            const tag = EVENT_TAG[e.type];
            const src = row.kind === "device" ? source(e.sourceId) : e.sourceLabel ?? "";
            return (
              <div key={e.id} className="lt-row">
                <span />
                <span className="lt-when">{formatWhen(e.occurredAt)}</span>
                <span className="lt-what">
                  {tag && <span className={cn("tag", tag.cls)}>{tag.label}</span>}
                  <span className="lt-desc">{e.description}</span>
                </span>
                <span className="lt-src">{src}</span>
                <span className="lt-right" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
