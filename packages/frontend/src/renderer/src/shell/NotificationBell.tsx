import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { useMarkSeen, useNotifications } from "@/hooks/useNotifications";
import { cn, timeAgo } from "@/lib/utils";
import { useNavigate } from "./navigation";
import type { AppNotification, NotificationChannel } from "@canopy/shared-types";

const CHANNEL: Record<NotificationChannel, { icon: IconName; label: string }> = {
  logging:     { icon: "alert",       label: "Logging" },
  automation:  { icon: "automation",  label: "Automation" },
  maintenance: { icon: "maintenance", label: "Maintenance" },
  settings:    { icon: "plug",        label: "Devices" },
};

/**
 * Pages that can scroll to the thing a notification is about. A threshold
 * alert's source is a device, but the Logging page has nothing to land on.
 */
const FOCUSABLE: ReadonlySet<NotificationChannel> = new Set(["automation", "maintenance", "settings"]);

/**
 * The titlebar bell: recent notifications from every page, newest first.
 *
 * Opening it marks everything seen, the same as visiting each page. The items
 * that were unseen when it opened stay highlighted until it closes, so marking
 * them seen does not also hide which ones were new.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const workspace = useActiveWorkspace();
  const { data } = useNotifications(workspace?.id);
  const markSeen = useMarkSeen(workspace?.id);
  const [open, setOpen] = useState(false);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());

  const total = data ? Object.values(data.unseen).reduce((a, b) => a + b, 0) : 0;
  const recent = data?.recent ?? [];

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setFreshIds(new Set(recent.filter((r) => !r.seen).map((r) => r.id)));
      if (total > 0) markSeen.mutate(undefined);
    }
  };

  const go = (n: AppNotification) => {
    navigate(n.channel, FOCUSABLE.has(n.channel) ? n.sourceId : undefined);
    setOpen(false);
  };

  const label = total > 0 ? `Notifications, ${total} unseen` : "Notifications";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip content="Notifications" side="bottom">
        <PopoverTrigger asChild>
          <button className="tb-icon-btn tb-bell" aria-label={label}>
            <Icon name="bell" size={15} />
            {total > 0 && <span className="tb-bell-count">{total > 99 ? "99+" : total}</span>}
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="nb p-0" side="bottom" align="end" sideOffset={6}>
        <div className="nb-head">
          <span>Notifications</span>
          <span className="nb-sub">alerts, failed runs, due tasks, devices offline</span>
        </div>
        <div className="nb-list">
          {recent.length === 0 && (
            <div className="nb-empty">
              <Icon name="check" size={16} />
              Nothing needs your attention.
            </div>
          )}
          {recent.map((n) => {
            const ch = CHANNEL[n.channel];
            return (
              <button key={n.id} className={cn("nb-item", freshIds.has(n.id) && "fresh")} onClick={() => go(n)}>
                <span className={cn("nb-ico", n.severity)}>
                  <Icon name={ch.icon} size={13} />
                </span>
                <span className="nb-body">
                  <span className="nb-desc">{n.description}</span>
                  <span className="nb-meta">
                    {ch.label}
                    {n.sourceLabel && <> · {n.sourceLabel}</>}
                    {" · "}
                    {timeAgo(n.occurredAt)}
                  </span>
                </span>
                {freshIds.has(n.id) && <span className="nb-dot" aria-label="new" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
