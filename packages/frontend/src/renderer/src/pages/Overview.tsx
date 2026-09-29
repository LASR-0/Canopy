import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { EmptyState } from "@/components/EmptyState";
import { Sparkline } from "@/components/Sparkline";
import { Icon, type IconName } from "@/components/Icon";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { useLiveReadings } from "@/hooks/useLiveReadings";
import { useThresholdAlerts, useThresholds } from "@/hooks/useThresholds";
import { useEvents } from "@/hooks/useEvents";
import { useMaintenanceToday, useCompleteTask } from "@/hooks/useMaintenance";
import { useDevices, useScan } from "@/hooks/useDevices";
import { useAutomations } from "@/hooks/useAutomations";
import { useControllerStatus } from "@/hooks/useBackend";
import { statusOf } from "@/lib/thresholds";
import { STAGE_DEFS, calcGrowStage, growTotalPlannedDays } from "@/lib/growStage";
import { api } from "@/lib/http";
import type { Reading, SensorThreshold, GrowCycle, AppEvent, MaintenanceTask, Device, ReadingResolution } from "@canopy/shared-types";
import type { Metric, GrowStageName, Automation, ThresholdAlertSetting } from "@canopy/shared-types";
import { METRIC_META, UNIT_DISPLAY, formatMetricValue } from "@/lib/metrics";
import { useNavigate } from "@/shell/navigation";

// ── Metric display config ────────────────────────────────────────────────
// The metric catalogue itself lives in lib/metrics.ts, shared with Automation.
// Units and decimals stay here, with the cards that do the formatting.

// Units and decimals moved to lib/metrics.ts alongside the catalogue, now that
// Logging formats the same values.
const fmtValue = formatMetricValue;

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type RangeKey = "1H" | "24H" | "7D" | "30D";
const RANGES: RangeKey[] = ["1H", "24H", "7D", "30D"];
const RANGE_CONFIG: Record<RangeKey, { ms: number; resolution: ReadingResolution }> = {
  "1H":  { ms: 3_600_000,       resolution: "raw"    },
  "24H": { ms: 86_400_000,      resolution: "hourly" },
  "7D":  { ms: 7 * 86_400_000,  resolution: "hourly" },
  "30D": { ms: 30 * 86_400_000, resolution: "daily"  },
};

const SKELETON_METRICS: Metric[] = ["temperature", "humidity", "vpd", "co2", "soil_moisture", "ppfd"];

const STAGE_LABELS: Record<string, string> = {
  seedling: "Seedling", vegetative: "Veg", flowering: "Flowering", flush: "Flush",
};
const STAGE_ORDER = ["seedling", "vegetative", "flowering", "flush"] as const;

// ── Sub-components ──────────────────────────────────────────────────────

function GrowBanner({ grow }: { grow: GrowCycle }) {
  const info = calcGrowStage(grow);
  if (!info) return null;
  const currentIdx = STAGE_ORDER.indexOf(info.stage as typeof STAGE_ORDER[number]);
  const segments = STAGE_DEFS
    .map((d, i) => ({
      ...d,
      weeks: d.weeks(grow),
      state: i < currentIdx ? "done" : i === currentIdx ? "active" : "upcoming",
    }))
    .filter((d) => d.weeks > 0);
  const totalDays = growTotalPlannedDays(grow);

  return (
    <div className="grow-banner">
      <div className="gb-left">
        <div className="gb-name">{grow.name}</div>
        {grow.strain && <div className="gb-strain">{grow.strain}</div>}
      </div>
      <div className="gb-center">
        <span className="gb-stage-badge">{STAGE_LABELS[info.stage]}</span>
        <span className="gb-day">Day {info.totalDay}</span>
      </div>
      {/* The Grow Cycle timeline in miniature: segments sized by planned weeks,
          so where "today" sits reads as how far through the grow it is. The
          fixed-width chips this replaces clipped "Flowering", and a 0 %-full
          progress bar on day 1 left a stray dot under the current stage. */}
      <div className="gb-right">
        <div className="gb-track" role="img" aria-label={`Day ${info.totalDay} of ${totalDays}, in ${STAGE_LABELS[info.stage]}`}>
          {segments.map((seg) => (
            <div
              key={seg.stage}
              className={`gb-seg ${seg.state}`}
              style={{ flexGrow: seg.weeks, "--stage": seg.color } as React.CSSProperties}
              title={`${seg.label} · ${seg.weeks} week${seg.weeks === 1 ? "" : "s"}`}
            >
              <span>{seg.label}</span>
            </div>
          ))}
          {totalDays > 0 && (
            <span className="gb-today" style={{ left: `${Math.min(100, ((info.totalDay - 0.5) / totalDays) * 100)}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}

function SensorCard({
  reading,
  thresholds,
  alertSettings,
  stage,
  range,
}: {
  reading: Reading;
  thresholds: SensorThreshold[];
  alertSettings: ThresholdAlertSetting[];
  stage?: GrowStageName;
  range: RangeKey;
}) {
  const meta   = METRIC_META[reading.metric];
  const status = statusOf(reading, thresholds, stage, alertSettings);
  const sparkColor =
    status === "err"  ? "var(--danger-fg)"    :
    status === "warn" ? "var(--attention-fg)" :
    meta.color;

  const { ms, resolution } = RANGE_CONFIG[range];
  const { data: series } = useQuery({
    queryKey: ["series", reading.workspaceId, reading.metric, reading.deviceId, range],
    queryFn: () =>
      api("POST /readings/series", {
        body: {
          workspaceId: reading.workspaceId,
          metric: reading.metric,
          deviceId: reading.deviceId,
          from: new Date(Date.now() - ms).toISOString(),
          to: new Date().toISOString(),
          resolution,
        },
      }),
    staleTime: 5 * 60_000,
  });

  const spark = series?.devices[0]?.points.map((p) => p.value);

  return (
    <div className="s-card">
      <div className="s-top">
        <div className="s-ico" style={{ background: meta.color + "22", color: meta.color }}>
          <Icon name={meta.icon} size={14} />
        </div>
        <span className="s-label">{meta.label}</span>
        <span className={`s-status ${status}`} />
      </div>
      <div className="s-valrow">
        <span className="s-val">{fmtValue(reading.value, reading.metric)}</span>
        <span className="s-unit">{UNIT_DISPLAY[reading.unit] ?? reading.unit}</span>
      </div>
      {/* One device is requested by id, so there is at most one line here. */}
      {spark && spark.length >= 2 ? (
        <div className="s-spark">
          <Sparkline data={spark} color={sparkColor} height={30} />
        </div>
      ) : (
        <div className="skel-spark" />
      )}
    </div>
  );
}

function SkeletonSensorCard({ metric }: { metric: Metric }) {
  const meta = METRIC_META[metric];
  return (
    <div className="s-card skel">
      <div className="s-top">
        <div className="s-ico" style={{ background: "var(--canvas-subtle)", color: "var(--fg-subtle)" }}>
          <Icon name={meta.icon} size={14} />
        </div>
        <span className="s-label">{meta.label}</span>
        <span className="s-status" style={{ background: "var(--border-default)" }} />
      </div>
      <div className="s-valrow">
        <span className="s-val skel-dash">—</span>
      </div>
      <div className="skel-spark" />
      <div className="s-foot">
        <span className="s-target">No sensor</span>
        <span className="s-badge b-idle">Awaiting</span>
      </div>
    </div>
  );
}

function FeedRow({ event }: { event: AppEvent }) {
  const iconName: IconName =
    event.type === "threshold_alert"  ? "alert"       :
    event.type === "failsafe_trip"    ? "alert"       :
    event.type === "device_online"    ? "plug"        :
    event.type === "device_offline"   ? "plug"        :
    event.type === "automation_fired" ? "automation"  :
    event.type === "stage_changed"    ? "cycle"       :
    event.type === "maintenance_done" ? "maintenance" :
    "info";

  const iconColor =
    event.severity === "err"              ? "var(--danger-fg)"    :
    event.severity === "warn"             ? "var(--attention-fg)" :
    event.type    === "device_online"     ? "var(--success-fg)"   :
    event.type    === "automation_fired"  ? "var(--accent-fg)"    :
    "var(--fg-muted)";

  return (
    <div className="feed-row">
      <div
        className="feed-ico"
        style={{ color: iconColor, borderColor: "transparent", background: iconColor + "18" }}
      >
        <Icon name={iconName} size={13} />
      </div>
      <div className="feed-body">
        <div className="feed-text">{event.description}</div>
        {event.sourceLabel && (
          <div className="feed-meta">
            <span className="src">{event.sourceLabel}</span>
          </div>
        )}
      </div>
      <div className="feed-time">{relTime(event.occurredAt)}</div>
    </div>
  );
}


/** "in 3h 42m", or "now" when it is due within the minute. */
function untilText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 60_000) return "now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function uptimeText(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  return `${mins}m`;
}

/**
 * The four-cell summary from the prototype, backed by real state.
 *
 * Every figure here is measured, not placeholder: metrics judged against their
 * configured bands, automations that are actually enabled, the soonest
 * scheduled fire time the controller computed, and the controller's own uptime.
 */
function SummaryStrip({
  readings, thresholds, alertSettings, stage, automations, uptimeSec, brokerOnline,
}: {
  readings: Reading[];
  thresholds: SensorThreshold[];
  alertSettings: ThresholdAlertSetting[];
  stage?: GrowStageName;
  automations: Automation[];
  uptimeSec?: number;
  brokerOnline?: boolean;
}) {
  const offTarget = readings.filter(
    (r) => statusOf(r, thresholds, stage, alertSettings) !== "ok",
  ).length;
  const breached = readings.filter(
    (r) => statusOf(r, thresholds, stage, alertSettings) === "err",
  ).length;

  const enabled = automations.filter((a) => a.enabled);

  const next = enabled
    .filter((a) => a.nextRunAt)
    .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];

  const environmentLabel = breached > 0 ? "Off target" : offTarget > 0 ? "Drifting" : "Stable";
  const environmentTag = breached > 0 ? "b-err" : offTarget > 0 ? "b-warn" : "b-ok";

  return (
    <div className="summary-strip">
      <div className="summary-cell">
        <div className="sc-label">Environment</div>
        <div className="sc-val">
          {environmentLabel}
          <span className={`tag ${environmentTag}`}>
            {breached > 0 ? "Breached" : offTarget > 0 ? "Watch" : "Nominal"}
          </span>
        </div>
        <div className="sc-sub">
          {thresholds.length === 0
            ? "no thresholds configured"
            : `${offTarget} metric${offTarget === 1 ? "" : "s"} outside target`}
        </div>
      </div>

      <div className="summary-cell">
        <div className="sc-label">Automations</div>
        <div className="sc-val">
          {enabled.length}
          <span style={{ fontSize: 13, color: "var(--fg-muted)", fontWeight: 400 }}>
            / {automations.length} active
          </span>
        </div>
        <div className="sc-sub">
          {automations.length === 0 ? "none configured" : `${automations.length - enabled.length} paused`}
        </div>
      </div>

      <div className="summary-cell">
        <div className="sc-label">Next event</div>
        <div className="sc-val">{next?.name ?? "—"}</div>
        <div className="sc-sub">
          {next?.nextRunAt ? `${untilText(next.nextRunAt)} · ${next.subsystem}` : "nothing scheduled"}
        </div>
      </div>

      <div className="summary-cell">
        <div className="sc-label">Uptime</div>
        <div className="sc-val">{uptimeSec != null ? uptimeText(uptimeSec) : "—"}</div>
        <div className="sc-sub">controller · broker {brokerOnline ? "online" : "offline"}</div>
      </div>
    </div>
  );
}

/**
 * Activity feed.
 *
 * One box showing one kind of activity at a time. The two feeds used to sit
 * stacked in the sidebar, which pushed the page far past the readings it exists
 * to show. The arrow switches between them and the count button cycles how much
 * is shown, so the default stays a summary and opens up only when something
 * needs chasing.
 */
const FEED_LIMITS = [5, 10, 15, 0] as const;
type FeedLimit = (typeof FEED_LIMITS)[number];

const FEED_VIEWS = [
  { id: "automation", label: "Automation", icon: "automation" as IconName },
  { id: "system", label: "Activity", icon: "clock" as IconName },
] as const;

function ActivityFeed({ events }: { events: AppEvent[] }) {
  const [viewIndex, setViewIndex] = useState(0);
  const [limitIndex, setLimitIndex] = useState(0);

  const view = FEED_VIEWS[viewIndex]!;
  const limit = FEED_LIMITS[limitIndex]!;

  const visible = useMemo(
    () =>
      events.filter((e) =>
        view.id === "automation"
          ? e.type === "automation_fired"
          : e.type !== "automation_fired",
      ),
    [events, view.id],
  );

  const shown = limit === 0 ? visible : visible.slice(0, limit);

  return (
    <div className="box">
      <div className="box-head">
        <Icon name={view.icon} size={14} />
        <h3>{view.label}</h3>
        <span className="count">{visible.length}</span>

        {/* Pinned right and adjacent, so the controls stay put when the feed
            switches and the title's width changes underneath them. */}
        <span className="feed-actions">
          <button
            className="feed-switch"
            onClick={() => setViewIndex((i) => (i + 1) % FEED_VIEWS.length)}
            title={`Show ${FEED_VIEWS[(viewIndex + 1) % FEED_VIEWS.length]!.label.toLowerCase()}`}
          >
            <Icon name="arrow-right" size={13} />
          </button>

          <button
            className="feed-limit"
            onClick={() => setLimitIndex((i) => (i + 1) % FEED_LIMITS.length)}
            title="Change how many are shown"
          >
            {limit === 0 ? "All" : limit}
          </button>
        </span>
      </div>

      {visible.length > 0 ? (
        <div className="feed">
          {shown.map((e) => <FeedRow key={e.id} event={e} />)}
        </div>
      ) : (
        <div className="feed-empty">
          {view.id === "automation" ? "No automation activity yet" : "Nothing else has happened yet"}
        </div>
      )}
    </div>
  );
}

function DevicePill({ device }: { device: Device }) {
  return (
    <div className="device-pill">
      <span className={`dp-dot ${device.online ? "online" : "offline"}`} />
      <span>{device.name}</span>
    </div>
  );
}

function MaintenanceRow({ task, workspaceId }: { task: MaintenanceTask; workspaceId: string }) {
  const complete = useCompleteTask(workspaceId);
  return (
    <div className="maint-row">
      <input
        type="checkbox"
        style={{ accentColor: "var(--accent-fg)", cursor: "pointer", flexShrink: 0 }}
        disabled={complete.isPending}
        onChange={() => complete.mutate({ id: task.id })}
      />
      <span className="maint-name">{task.name}</span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

export function Overview() {
  const qc       = useQueryClient();
  const workspace = useActiveWorkspace();
  const readings  = useLiveReadings(workspace?.id);
  const [range, setRange] = useState<RangeKey>("24H");
  const navigate = useNavigate();

  const { data: grow }              = useActiveGrow();
  const { data: thresholds = [] }   = useThresholds(workspace?.id);
  const { data: alertSettings = [] } = useThresholdAlerts(workspace?.id);
  const { data: events = [] }       = useEvents(workspace?.id);
  const maintenanceToday            = useMaintenanceToday(workspace?.id);
  const { data: devices = [] }      = useDevices(workspace?.id);
  const { data: automations = [] }  = useAutomations(workspace?.id);
  const { data: controller }        = useControllerStatus();
  const scan                        = useScan(workspace?.id);

  const stageInfo    = grow ? calcGrowStage(grow) : undefined;
  const currentStage = stageInfo?.stage;
  const readingList  = useMemo(() => Array.from(readings.values()), [readings]);

  const crumbs = workspace
    ? grow && stageInfo
      ? [workspace.name, `${STAGE_LABELS[stageInfo.stage]} · Day ${stageInfo.totalDay}`, grow.name]
      : [workspace.name, "Not configured"]
    : undefined;

  const devicesOnline = devices.some((d) => d.online);
  const statusBadge = devicesOnline ? (
    <span className="tag b-ok">
      <span className="dot-live" style={{ width: 7, height: 7 }} /> All systems nominal
    </span>
  ) : (
    <span className="tag b-idle">
      <span className="online-dot off" style={{ width: 7, height: 7 }} /> Not connected
    </span>
  );

  const handleRefresh = () => {
    if (!workspace) return;
    void qc.invalidateQueries({ queryKey: ["readings", workspace.id] });
    void qc.invalidateQueries({ queryKey: ["series", workspace.id] });
    void qc.invalidateQueries({ queryKey: ["events", workspace.id] });
    void qc.invalidateQueries({ queryKey: ["devices", workspace.id] });
    void qc.invalidateQueries({ queryKey: ["maintenance", workspace.id] });
  };

  const headerActions = (
    <>
      <div className="segmented">
        {RANGES.map((r) => (
          <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
        ))}
      </div>
      <button className="btn btn-icon" title="Refresh" onClick={handleRefresh}>
        <Icon name="refresh" size={15} />
      </button>
      <button className="btn primary">
        <Icon name="plus" size={14} /> New automation
      </button>
    </>
  );

  if (!workspace) {
    return (
      <>
        <ContentHeader title="Overview" />
        <PageBody>
          <EmptyState
            icon="overview"
            title="No workspace selected"
            description="Create a workspace in Settings to get started."
            hint="Settings → Workspaces"
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <ContentHeader
        title="Overview"
        {...(crumbs ? { crumbs } : {})}
        badge={statusBadge}
        actions={headerActions}
      />
      <PageBody>
        
          {grow && <GrowBanner grow={grow} />}

          <div className="ov-layout">
            {/* ── Left column: summary, sensors, devices ─── */}
            {/* The strip lives inside the grid rather than above it, so the
                activity column starts level with it at the top of the page
                instead of below a full-width band. */}
            <div>
              <SummaryStrip
                readings={readingList}
                thresholds={thresholds}
                alertSettings={alertSettings}
                {...(currentStage ? { stage: currentStage } : {})}
                automations={automations}
                {...(controller ? { uptimeSec: controller.uptimeSec, brokerOnline: controller.brokerOnline } : {})}
              />

              {readingList.length === 0 && (
                <div className="set-empty">
                  <div className="se-ico"><Icon name="leaf" size={30} /></div>
                  <h2>Waiting for your first readings</h2>
                  <p>
                    No devices are connected yet. Open <span style={{ color: "var(--accent-fg)" }}>Settings</span> and
                    scan your local network — once sensors and equipment are paired, their live readings, recent
                    activity, and active automations show up here automatically.
                  </p>
                  <div className="se-actions">
                    <button
                      className="btn primary"
                      disabled={scan.state === "scanning"}
                      onClick={() => void scan.startScan()}
                    >
                      <Icon name="radar" size={14} />
                      {scan.state === "scanning" ? `Scanning… (${scan.found} found)` : "Scan network"}
                    </button>
                  </div>
                  <div className="se-steps">
                    <div className="se-step"><span className="ses-n">1</span> Pair sensors &amp; equipment</div>
                    <span className="ses-arrow">→</span>
                    <div className="se-step"><span className="ses-n">2</span> Assign grow roles</div>
                    <span className="ses-arrow">→</span>
                    <div className="se-step"><span className="ses-n">3</span> Live overview</div>
                  </div>
                </div>
              )}

              <div className="sec-head" style={{ marginTop: readingList.length === 0 ? 24 : 0 }}>
                <h2>Current readings</h2>
                <span className="count">
                  {readingList.length > 0 ? readingList.length : "awaiting probes"}
                </span>
                <span className="rule" />
                {/* The prototype's own entry point for target ranges. Not a
                    detail screen: nothing is judged until a band is set, so
                    without it every card reads "ok" whatever the reading. */}
                <span className="link" onClick={() => navigate("targets")}>
                  Configure thresholds
                </span>
              </div>

              {readingList.length > 0 ? (
                <div className="sensor-grid">
                  {readingList.map((r) => (
                    <SensorCard
                      key={`${r.deviceId}:${r.channel}`}
                      reading={r}
                      thresholds={thresholds}
                      alertSettings={alertSettings}
                      range={range}
                      {...(currentStage ? { stage: currentStage } : {})}
                    />
                  ))}
                </div>
              ) : (
                <div className="sensor-grid">
                  {SKELETON_METRICS.map((m) => <SkeletonSensorCard key={m} metric={m} />)}
                </div>
              )}

              {devices.length > 0 && (
                <>
                  <div className="sec-head" style={{ marginTop: 24 }}>
                    <h2>Devices</h2>
                    <span className="count">{devices.length}</span>
                    <span className="rule" />
                  </div>
                  <div className="box">
                    <div className="device-strip">
                      {devices.map((d) => <DevicePill key={d.id} device={d} />)}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── Right sidebar: maintenance + activity ───── */}
            <div className="ov-sidebar">
              {maintenanceToday.length > 0 && (
                <div className="box">
                  <div className="box-head">
                    <Icon name="maintenance" size={14} />
                    <h3>Today</h3>
                    <span className="count">{maintenanceToday.length}</span>
                  </div>
                  {maintenanceToday.map((t) => (
                    <MaintenanceRow key={t.id} task={t} workspaceId={workspace.id} />
                  ))}
                </div>
              )}

              <ActivityFeed events={events} />
            </div>
          </div>
        
      </PageBody>

    </>
  );
}
