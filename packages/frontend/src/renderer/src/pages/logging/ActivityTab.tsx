import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/EmptyState";
import { useDevices } from "@/hooks/useDevices";
import { useActivity } from "@/hooks/useEvents";
import { EVENT_GROUP, EVENT_GROUPS, eventColor, eventIcon, eventText, typesIn, type EventGroup } from "@/lib/events";
import { cn, dayLabel, formatWhen } from "@/lib/utils";
import type { AppEvent } from "@canopy/shared-types";

/**
 * The full record: every event, newest first, grouped by day and read a page
 * at a time. The Logs tab is the problems; this is everything that happened.
 */
export function ActivityTab({ workspaceId }: { workspaceId: string }) {
  const [groups, setGroups] = useState<ReadonlySet<EventGroup>>(new Set(EVENT_GROUPS.map((g) => g.key)));
  const types = useMemo(() => typesIn(groups), [groups]);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useActivity(workspaceId, types);
  const { data: devices = [] } = useDevices(workspaceId);
  const deviceName = useMemo(() => new Map(devices.map((d) => [d.id, d.name])), [devices]);

  const events = useMemo(() => data?.pages.flat() ?? [], [data]);

  /** Consecutive runs of the same day, so each gets one heading. */
  const days = useMemo(() => {
    const out: { label: string; events: AppEvent[] }[] = [];
    for (const e of events) {
      const label = dayLabel(e.occurredAt);
      const last = out[out.length - 1];
      if (last?.label === label) last.events.push(e);
      else out.push({ label, events: [e] });
    }
    return out;
  }, [events]);

  const toggle = (g: EventGroup) =>
    setGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(g)) next.add(g);
      return next;
    });

  const source = (e: AppEvent) =>
    EVENT_GROUP[e.type] === "devices" && e.sourceId ? deviceName.get(e.sourceId) ?? e.sourceLabel : e.sourceLabel;

  return (
    <div className="at">
      <div className="chart-toolbar">
        <div className="lt-kinds">
          {EVENT_GROUPS.map((g) => (
            <button
              key={g.key}
              className={cn("copt", groups.has(g.key) && "on")}
              aria-pressed={groups.has(g.key)}
              onClick={() => toggle(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="ct-spacer" />
        <span className="lt-summary" style={{ margin: 0 }}>
          {events.length}{hasNextPage ? "+" : ""} event{events.length === 1 ? "" : "s"}
        </span>
      </div>

      {groups.size === 0 ? (
        <EmptyState icon="clock" title="Nothing selected" description="Pick at least one kind of event to show." />
      ) : !isLoading && events.length === 0 ? (
        <EmptyState icon="clock" title="Nothing recorded yet" description="Automation runs, alerts, device changes and grow events will appear here as they happen." />
      ) : (
        <>
          {days.map((day) => (
            <div key={day.label} className="at-day">
              <div className="sec-head"><h2>{day.label}</h2><span className="count">{day.events.length}</span><span className="rule" /></div>
              <div className="box">
                {day.events.map((e) => {
                  const color = eventColor(e);
                  return (
                    <div key={e.id} className="at-row">
                      <span className="lt-when">{formatWhen(e.occurredAt).slice(-5)}</span>
                      <span className="feed-ico" style={{ color, borderColor: "transparent", background: color + "18" }}>
                        <Icon name={eventIcon(e.type)} size={13} />
                      </span>
                      <span className="lt-desc">{eventText(e.description, e.metric)}</span>
                      <span className="lt-src">{source(e)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {hasNextPage && (
            <div className="at-more">
              <button className="btn sm" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Loading…" : "Load older"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
