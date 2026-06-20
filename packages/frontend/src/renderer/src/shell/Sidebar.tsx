import { Icon, type IconName } from "@/components/Icon";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { useHealthStatus } from "@/hooks/useBackend";
import { cn } from "@/lib/utils";

export type PageId =
  | "overview"
  | "setup"
  | "automation"
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
  count?: number;
}

const NAV: NavItem[] = [
  { id: "overview",    label: "Overview",    icon: "overview",     group: "Monitor" },
  { id: "setup",       label: "Setup View",  icon: "setup",        group: "Monitor" },
  { id: "automation",  label: "Automation",  icon: "automation",   group: "Manage",  count: 6 },
  { id: "grow-cycle",  label: "Grow Cycle",  icon: "cycle",        group: "Manage" },
  { id: "journal",     label: "Journal",     icon: "journal",      group: "Manage",  count: 28 },
  { id: "maintenance", label: "Maintenance", icon: "maintenance",  group: "Service", count: 2 },
  { id: "logging",     label: "Logging",     icon: "logging",      group: "Service" },
  { id: "settings",    label: "Settings",    icon: "settings",     group: "Config",  count: 8 },
];

const GROUPS = ["Monitor", "Manage", "Service", "Config"] as const;

interface SidebarProps {
  active: PageId;
  onNavigate: (page: PageId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const { online } = useHealthStatus();

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
                >
                  <span className="ni-ico">
                    <Icon name={item.icon} size={16} />
                  </span>
                  {item.label}
                  {item.count !== undefined && (
                    <span className="ni-count">{item.count}</span>
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
        <button className="gear" onClick={() => onNavigate("settings")}>
          <Icon name="gear" size={14} />
        </button>
      </div>
    </div>
  );
}
