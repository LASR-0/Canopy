import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { Tip } from "@/components/Tip";
import { useHealthStatus } from "@/hooks/useBackend";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { useMarkSeen, useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "@canopy/shared-types";

export type PageId =
  | "overview"
  | "setup"
  | "automation"
  | "targets"
  | "grow-cycle"
  | "journal"
  | "maintenance"
  | "logging"
  | "settings";

interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
  group: string;
}

export const NAV: NavItem[] = [
  { id: "overview",    label: "Overview",    icon: "overview",     group: "Monitor" },
  { id: "setup",       label: "Setup View",  icon: "setup",        group: "Monitor" },
  { id: "automation",  label: "Automation",  icon: "automation",   group: "Manage" },
  { id: "targets",     label: "Target ranges", icon: "target",     group: "Manage" },
  { id: "grow-cycle",  label: "Grow Cycle",  icon: "cycle",        group: "Manage" },
  { id: "journal",     label: "Journal",     icon: "journal",      group: "Manage" },
  { id: "maintenance", label: "Maintenance", icon: "maintenance",  group: "Service" },
  { id: "logging",     label: "Logging",     icon: "logging",      group: "Service" },
  { id: "settings",    label: "Settings",    icon: "settings",     group: "Config" },
];

/**
 * How long the pointer rests on a nav item before its notifications count as
 * seen. Long enough that sweeping down the sidebar clears nothing.
 */
const HOVER_SEEN_MS = 500;

function asChannel(page: PageId): NotificationChannel | null {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(page) ? (page as NotificationChannel) : null;
}

const GROUPS = ["Monitor", "Manage", "Service", "Config"] as const;

interface SidebarProps {
  active: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const { online } = useHealthStatus();
  const workspace = useActiveWorkspace();
  const { data: notifications } = useNotifications(workspace?.id);
  const markSeen = useMarkSeen(workspace?.id);
  const unseen = (page: PageId) => {
    const channel = asChannel(page);
    return channel ? notifications?.unseen[channel] ?? 0 : 0;
  };

  // Being on a page is seeing it, including what arrives while you are there.
  const activeUnseen = unseen(active);
  useEffect(() => {
    const channel = asChannel(active);
    if (channel && activeUnseen > 0) markSeen.mutate([channel]);
    // markSeen is a new object each render; the page and its count are what matter.
  }, [active, activeUnseen]);

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const startHover = (page: PageId) => {
    stopHover();
    const channel = asChannel(page);
    if (!channel || unseen(page) === 0) return;
    hoverTimer.current = setTimeout(() => markSeen.mutate([channel]), HOVER_SEEN_MS);
  };
  useEffect(() => stopHover, []);
  const { resolved, toggle } = useTheme();
  // The icon shows where a click goes: the sun in dark mode, the moon in light.
  const next = resolved === "dark" ? "light" : "dark";

  return (
    <div className="sidebar">
      <WorkspaceSelector />

      <nav className="nav">
        {GROUPS.map((group) => {
          const items = NAV.filter((n) => n.group === group);
          return (
            <div key={group}>
              <div className="nav-group-label">{group}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={cn("nav-item", active === item.id && "active")}
                  onClick={() => onNavigate(item.id)}
                  onMouseEnter={() => startHover(item.id)}
                  onMouseLeave={stopHover}
                >
                  <span className="ni-ico">
                    <Icon name={item.icon} size={16} />
                  </span>
                  {item.label}
                  {unseen(item.id) > 0 && (
                    <span className="ni-count" aria-label={`${unseen(item.id)} unseen`}>
                      {unseen(item.id) > 99 ? "99+" : unseen(item.id)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sb-footer">
        <span
          className="dot-live"
          style={online ? undefined : { background: "var(--fg-subtle)", boxShadow: "none", animation: "none" }}
        />
        <span>Controller · {online ? "live" : "offline"}</span>
        <Tip content={`Switch to ${next} mode`}>
          <button
            className="theme-toggle"
            onClick={toggle}
            aria-label={`Switch to ${next} mode`}
          >
            <Icon name={next === "light" ? "sun" : "moon"} size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
