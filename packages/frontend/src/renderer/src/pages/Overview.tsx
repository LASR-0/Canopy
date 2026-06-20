import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";
import { Sparkline } from "@/components/Sparkline";
import { Icon, type IconName } from "@/components/Icon";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { useLiveReadings } from "@/hooks/useLiveReadings";
import { useThresholds } from "@/hooks/useThresholds";
import { useEvents } from "@/hooks/useEvents";
import { useMaintenanceToday, useCompleteTask } from "@/hooks/useMaintenance";
import { useDevices, useScan } from "@/hooks/useDevices";
import { evalThreshold } from "@/lib/thresholds";
import { calcGrowStage } from "@/lib/growStage";
import { api } from "@/lib/http";
import type { Reading, SensorThreshold, GrowCycle, AppEvent, MaintenanceTask, Device, ReadingResolution } from "@canopy/shared-types";
import type { Metric } from "@canopy/shared-types";

// ── Metric display config ────────────────────────────────────────────────

type MetricMeta = { label: string; color: string; icon: IconName };

const METRIC_META: Record<Metric, MetricMeta> = {
  temperature:   { label: "Temperature",   color: "#e07b39", icon: "temp"    },
  humidity:      { label: "Humidity",      color: "#4a9eda", icon: "drop"    },
  co2:           { label: "CO₂",           color: "#4caf7d", icon: "co2"     },
  vpd:           { label: "VPD",           color: "#a67cd6", icon: "vpd"     },
  soil_moisture: { label: "Soil Moisture", color: "#8d7a5f", icon: "leaf"    },
  ph:            { label: "pH",            color: "#26b8c8", icon: "beaker"  },
  ec:            { label: "EC",            color: "#f5a623", icon: "beaker"  },
  lux:           { label: "Lux",           color: "#e8c53a", icon: "sun"     },
  ppfd:          { label: "PPFD",          color: "#e8c53a", icon: "sun"     },
  power:         { label: "Power",         color: "#e05252", icon: "power"   },
  water_level:   { label: "Water Level",   color: "#4a9eda", icon: "ruler"   },
};

const UNIT_DISPLAY: Record<string, string> = {
  C: "°C", F: "°F", percent: "%", ppm: "ppm", kPa: "kPa",
  pH: "pH", mS_cm: "mS/cm", lux: "lux", umol_m2s: "µmol/m²s",
  W: "W", L: "L",
};

const METRIC_DECIMALS: Partial<Record<Metric, number>> = {
  temperature: 1, humidity: 1, vpd: 2, ph: 2, ec: 2, soil_moisture: 1, water_level: 1,
};

function fmtValue(value: number, metric: Metric): string {
  return value.toFixed(METRIC_DECIMALS[metric] ?? 0);
}

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
      <div className="gb-right">
        <div className="gb-stages">
          {STAGE_ORDER.map((s, i) => (
            <div
              key={s}
              className={`gb-stage-seg${i < currentIdx ? " done" : i === currentIdx ? " active" : ""}`}
            >
              <div className="gb-stage-name">{STAGE_LABELS[s]}</div>
              {i === currentIdx && (
                <div className="gb-stage-bar">
                  <div className="gb-stage-fill" style={{ width: `${Math.round(info.pctInStage * 100)}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SensorCard({
  reading,
  thresholds,
  stage,
  range,
}: {
  reading: Reading;
  thresholds: SensorThreshold[];
  stage?: string;
  range: RangeKey;
}) {
  const meta   = METRIC_META[reading.metric];
  const status = evalThreshold(reading.value, reading.metric, thresholds, stage);
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
      {series && series.points.length >= 2 ? (
        <div className="s-spark">
          <Sparkline data={series.points.map((p) => p.value)} color={sparkColor} height={30} />
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

  const { data: grow }              = useActiveGrow();
  const { data: thresholds = [] }   = useThresholds(workspace?.id);
  const { data: events = [] }       = useEvents(workspace?.id);
  const maintenanceToday            = useMaintenanceToday(workspace?.id);
  const { data: devices = [] }      = useDevices(workspace?.id);
  const scan                        = useScan(workspace?.id);

  const stageInfo    = grow ? calcGrowStage(grow) : undefined;
  const currentStage = stageInfo?.stage;
  const readingList  = useMemo(() => Array.from(readings.values()), [readings]);

  const automationEvents = useMemo(() => events.filter((e) => e.type === "automation_fired"), [events]);
  const recentEvents     = useMemo(() => events.filter((e) => e.type !== "automation_fired"), [events]);

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
        <div className="scroll">
          <EmptyState
            icon="overview"
            title="No workspace selected"
            description="Create a workspace in Settings to get started."
            hint="Settings → Workspaces"
          />
        </div>
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
      <div className="scroll">
        <div className="canvas-pad">
          {grow && <GrowBanner grow={grow} />}

          <div className="ov-layout">
            {/* ── Left column: sensors + devices ─────────── */}
            <div>
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
              </div>

              {readingList.length > 0 ? (
                <div className="sensor-grid">
                  {readingList.map((r) => (
                    <SensorCard
                      key={`${r.deviceId}:${r.channel}`}
                      reading={r}
                      thresholds={thresholds}
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

              <div className="box">
                <div className="box-head">
                  <Icon name="automation" size={14} />
                  <h3>Automation Activity</h3>
                  {automationEvents.length > 0 && <span className="count">{automationEvents.length}</span>}
                </div>
                {automationEvents.length > 0 ? (
                  <div className="feed">
                    {automationEvents.slice(0, 15).map((e) => <FeedRow key={e.id} event={e} />)}
                  </div>
                ) : (
                  <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--fg-subtle)", textAlign: "center" }}>
                    No automation activity yet
                  </div>
                )}
              </div>

              <div className="box">
                <div className="box-head">
                  <Icon name="clock" size={14} />
                  <h3>Recent Activity</h3>
                  {recentEvents.length > 0 && <span className="count">{recentEvents.length}</span>}
                </div>
                {recentEvents.length > 0 ? (
                  <div className="feed">
                    {recentEvents.slice(0, 15).map((e) => <FeedRow key={e.id} event={e} />)}
                  </div>
                ) : (
                  <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--fg-subtle)", textAlign: "center" }}>
                    No activity yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
