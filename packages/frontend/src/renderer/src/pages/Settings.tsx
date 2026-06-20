import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { ContentHeader } from "@/components/ContentHeader";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/Tag";
import { SignalBars } from "@/components/SignalBars";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/theme/ThemeProvider";
import { ProvisionModal } from "@/components/ProvisionModal";
import {
  useWorkspaces,
  useActiveWorkspace,
  useAppSettings,
  usePatchWorkspace,
  useDeleteWorkspace,
} from "@/hooks/useWorkspace";
import { useDevices, useRoles, useAssignRole, useScan } from "@/hooks/useDevices";
import { useHealthStatus } from "@/hooks/useBackend";
import { api } from "@/lib/http";
import { wsManager } from "@/lib/ws";
import { cn } from "@/lib/utils";
import type { Device, RoleAssignment, AppSettings } from "@canopy/shared-types";

// ── Role definitions (mirrors prototype ROLES) ────────────────────────────────
const ROLES: { id: RoleAssignment["role"]; name: string; kind: "sense" | "control"; unlocks?: string }[] = [
  { id: "canopy_temp",   name: "Canopy temp",        kind: "sense" },
  { id: "canopy_rh",    name: "Canopy humidity",    kind: "sense" },
  { id: "rootzone",     name: "Root-zone moisture", kind: "sense" },
  { id: "co2_probe",    name: "CO₂ probe",          kind: "sense" },
  { id: "res_temp",     name: "Reservoir temp",     kind: "sense" },
  { id: "exhaust",      name: "Exhaust fan",        kind: "control", unlocks: "VPD / temp control" },
  { id: "intake",       name: "Intake fan",         kind: "control", unlocks: "fresh-air exchange" },
  { id: "circ",         name: "Circulation fan",    kind: "control", unlocks: "air mixing" },
  { id: "light",        name: "Grow light",         kind: "control", unlocks: "photoperiod schedule" },
  { id: "pump",         name: "Water pump",         kind: "control", unlocks: "irrigation cycles" },
  { id: "humidifier",   name: "Humidifier",         kind: "control", unlocks: "humidity hold" },
  { id: "dehumidifier", name: "Dehumidifier",       kind: "control", unlocks: "humidity hold" },
  { id: "co2_valve",    name: "CO₂ valve",          kind: "control", unlocks: "CO₂ dosing" },
  { id: "heater",       name: "Heater",             kind: "control", unlocks: "temp floor" },
];

// ── Device card ───────────────────────────────────────────────────────────────
function DeviceCard({ device, onRemove }: { device: Device; onRemove: (id: string) => void }) {
  const isControl = device.capabilities.some((c) => c.kind === "actuator");
  const metrics = device.capabilities.filter((c) => c.kind === "sensor");
  const controls = device.capabilities.filter((c) => c.kind === "actuator");

  return (
    <div className={cn("dev-card", !device.online && "off")}>
      <div className="dev-head">
        <span className={cn("online-dot", !device.online && "off")} />
        <div className="dev-id">
          <div className="dev-name">
            {device.name}
            {!device.online && <span className="tag b-idle" style={{ fontSize: 10 }}>offline</span>}
          </div>
          <div className="dev-host">
            {device.model && <span>{device.model}</span>}
            {device.model && device.address.host && <span className="sep">·</span>}
            {device.address.host && <span>{device.address.host}</span>}
            {device.address.mqttTopicPrefix && <span className="sep">·</span>}
            {device.address.mqttTopicPrefix && <span>{device.address.mqttTopicPrefix}</span>}
          </div>
        </div>
        <span className="proto-badge">{device.address.protocol}</span>
        <SignalBars
          strength={device.signalPct != null ? (Math.min(4, Math.max(0, Math.round(device.signalPct / 25))) as 0|1|2|3|4) : 0}
        />
        <button className="icon-ghost" onClick={() => onRemove(device.id)} title="Remove device">
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="dev-caps">
        {metrics.length > 0 && (
          <div className="cap-group">
            <span className="cap-label">Reads</span>
            {metrics.map((c) => (
              <span key={c.channel} className="cap-chip" style={{ fontSize: 11.5 }}>
                {c.metric}
              </span>
            ))}
          </div>
        )}
        {controls.length > 0 && (
          <div className="cap-group">
            <span className="cap-label">Controls</span>
            {controls.map((c) => (
              <span key={c.channel} className="ctrl-chip" style={{ fontSize: 11.5 }}>
                {"label" in c ? c.label ?? c.actuator : c.actuator}
                <span className="res-tag">{c.variable ? "variable" : "on/off"}</span>
              </span>
            ))}
          </div>
        )}
        {metrics.length === 0 && controls.length === 0 && (
          <span className="cap-none">no capabilities detected</span>
        )}
      </div>
      <div className="dev-foot">
        <span className="dev-kind">{isControl ? "Controllable equipment" : "Read-only sensor"}</span>
      </div>
    </div>
  );
}

// ── Role assignment row ───────────────────────────────────────────────────────
function RoleRow({ device, roles, onAssign }: {
  device: Device;
  roles: RoleAssignment[];
  onAssign: (deviceId: string, channel: string, role: RoleAssignment["role"] | "") => void;
}) {
  const isControl = device.capabilities.some((c) => c.kind === "actuator");
  const assigned = roles.find((r) => r.deviceId === device.id);
  const roleInfo = ROLES.find((r) => r.id === assigned?.role);
  const [localRole, setLocalRole] = useState(assigned?.role ?? "");
  const caps = [
    ...device.capabilities.filter((c) => c.kind === "sensor").map((c) => c.metric),
    ...device.capabilities.filter((c) => c.kind === "actuator").map((c) => ("label" in c ? c.label ?? c.actuator : c.actuator)),
  ].join(" · ") || "—";

  const channel = device.capabilities[0]?.channel ?? "default";
  const compatibleRoles = ROLES.filter((r) => isControl ? r.kind === "control" : r.kind === "sense");

  // Keep local state in sync once the server confirms (or rolls back on error)
  useEffect(() => {
    setLocalRole(assigned?.role ?? "");
  }, [assigned?.role]);

  return (
    <div className={cn("role-row", !device.online && "off")}>
      <div className="rr-dev">
        <span className={cn("online-dot", !device.online && "off")} />
        <div className="rr-min">
          <div className="rr-name">{device.name}</div>
          <div className="rr-caps">{caps}</div>
        </div>
      </div>
      <div className="rr-detect">
        <span className={cn("detect-tag", isControl ? "ctl" : "sen")}>
          {isControl ? "Equipment" : "Sensor"}
        </span>
      </div>
      <div className="rr-role">
        <Select
          value={localRole}
          disabled={!device.online}
          onValueChange={(val) => {
            const role = val === "__none__" ? "" : val;
            setLocalRole(role);
            onAssign(device.id, channel, role as RoleAssignment["role"] | "");
          }}
        >
          <SelectTrigger style={{ width: "100%", maxWidth: 185 }}>
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Unassigned</SelectItem>
            {compatibleRoles.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="rr-unlock">
        {roleInfo
          ? <span className="unlock-on"><Icon name="automation" size={11} /> {roleInfo.kind === "control" ? roleInfo.unlocks : "feeds automations"}</span>
          : <span className="unlock-off">assign to enable</span>}
      </div>
    </div>
  );
}

// ── Workspace management row ──────────────────────────────────────────────────
type WsDeleteState = "idle" | "confirm" | "deleting";

function WorkspaceRow({ workspace, isActive, isOnly, isLast, onDelete, onArchive }: {
  workspace: import("@canopy/shared-types").Workspace;
  isActive: boolean;
  isOnly: boolean;
  isLast: boolean;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [tz, setTz] = useState(workspace.timezone);
  const [deleteState, setDeleteState] = useState<WsDeleteState>("idle");
  const patch = usePatchWorkspace(workspace.id);

  // Keep refs so timeout closures always have the latest callbacks + id
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setName(workspace.name);
    setTz(workspace.timezone);
  }, [workspace.name, workspace.timezone]);

  // Clear all timers on unmount to prevent state updates on dead component
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleDeleteClick = () => {
    if (deleteState === "idle") {
      setDeleteState("confirm");
      confirmTimerRef.current = setTimeout(() => setDeleteState("idle"), 5000);
    } else if (deleteState === "confirm") {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setDeleteState("deleting");
      deleteTimerRef.current = setTimeout(() => {
        onDeleteRef.current(workspace.id);
      }, 3000);
    } else if (deleteState === "deleting") {
      // Cancel — clear the pending delete timer and return to idle
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setDeleteState("idle");
    }
  };

  const handleDeleteBlur = () => {
    // If focus leaves while in confirm state, cancel back to idle
    if (deleteState === "confirm") {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setDeleteState("idle");
    }
  };

  const deleteLabel =
    deleteState === "idle" ? "Delete"
    : deleteState === "confirm" ? "Are you sure?"
    : "Deleting…";

  return (
    <div className="ws-mgmt-row" style={{ borderBottom: isLast ? "none" : "1px solid var(--border-muted)" }}>
      <div className="ws-mgmt-header">
        <span className="ws-mgmt-name">{workspace.name}</span>
        {isActive && <span className="tag b-ok" style={{ fontSize: 10 }}>active</span>}
      </div>
      <div className="gc-setup-body" style={{ padding: "0 16px 12px" }}>
        <div className="gc-fields">
          <div className="gc-field grow">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={deleteState === "deleting"} />
          </div>
          <div className="gc-field" style={{ width: 220 }}>
            <label>Timezone</label>
            <input
              value={tz}
              placeholder="e.g. Australia/Sydney"
              onChange={(e) => setTz(e.target.value)}
              disabled={deleteState === "deleting"}
            />
          </div>
        </div>
      </div>
      <div style={{ padding: "0 16px 14px", display: "flex", gap: 8, justifyContent: "flex-end" }}>

        {/* Delete — 3-step confirmation with border trace timer */}
        <span
          style={{ position: "relative", display: "inline-flex", borderRadius: 6 }}
          className={deleteState === "deleting" ? "ws-delete-tracing" : undefined}
        >
          <button
            className="btn sm ghost-danger"
            style={deleteState === "deleting" ? { color: "var(--danger-fg)" } : undefined}
            onClick={handleDeleteClick}
            onBlur={handleDeleteBlur}
            disabled={isOnly}
            title={isOnly ? "Cannot delete the only workspace" : undefined}
          >
            <Icon name="trash" size={13} />
            {deleteLabel}
          </button>
        </span>

                {/* Archive — single click, no confirmation (reversible action) */}
        <button
          className="btn archive sm"
          onClick={() => onArchive(workspace.id)}
          disabled={isOnly || deleteState === "deleting"}
          title="Archive workspace"
        >
          <Icon name="archive" size={13} /> Archive
        </button>

        <button
          className="btn primary sm"
          onClick={() => patch.mutate({ name, timezone: tz })}
          disabled={patch.isPending || deleteState === "deleting"}
        >
          <Icon name="check" size={13} /> Save
        </button>
      </div>
    </div>
  );
}

// ── Main Settings page ────────────────────────────────────────────────────────
export function Settings() {
  const { theme: currentTheme, setTheme } = useTheme();
  const workspace = useActiveWorkspace();
  const { data: workspaceList = [] } = useWorkspaces();
  const { data: settings } = useAppSettings();
  const { data: deviceList = [] } = useDevices(workspace?.id);
  const { data: roleList = [] } = useRoles(workspace?.id);
  const { online, version, uptimeSec } = useHealthStatus();
  const { state: scanState, found: scanFound, startScan, resetScan } = useScan(workspace?.id);
  const assignRole = useAssignRole(workspace?.id ?? "");
  const deleteWorkspace = useDeleteWorkspace();
  const qc = useQueryClient();
  const [showProvision, setShowProvision] = useState(false);

  // Connect WS when Settings page is mounted
  useEffect(() => { wsManager.connect(); }, []);

  const handleScan = () => {
    resetScan();
    void startScan();
  };

  const handleAssignRole = (deviceId: string, channel: string, role: RoleAssignment["role"] | "") => {
    if (!workspace) return;
    if (!role) return; // unassign not yet in API
    assignRole.mutate({ role, deviceId, channel });
  };

  // Optimistic delete — removes from cache immediately, rolls back on error
  const removeDevice = useMutation({
    mutationFn: (deviceId: string) =>
      api("DELETE /devices/:deviceId" as never, { params: { deviceId } } as never) as Promise<{ deleted: true }>,
    onMutate: async (deviceId) => {
      const key = ["devices", workspace?.id];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Device[]>(key);
      qc.setQueryData<Device[]>(key, (old) => old?.filter((d) => d.id !== deviceId) ?? []);
      return { previous };
    },
    onError: (_err, _deviceId, context) => {
      if (context?.previous) {
        qc.setQueryData(["devices", workspace?.id], context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["devices", workspace?.id] });
      void qc.invalidateQueries({ queryKey: ["roles", workspace?.id] });
    },
  });

  const handleRemoveDevice = useCallback((deviceId: string) => {
    removeDevice.mutate(deviceId);
  }, [removeDevice]);

  const patchSettings = useMutation({
    mutationFn: (body: Partial<AppSettings>) =>
      api("PATCH /settings", { body }),
    onMutate: async (body) => {
      const previous = qc.getQueryData(["settings"]);
      // Update cache synchronously BEFORE any awaits so the UI commits instantly
      qc.setQueryData(["settings"], (old: AppSettings | undefined) =>
        old ? { ...old, ...body } : old,
      );
      await qc.cancelQueries({ queryKey: ["settings"] });
      return { previous };
    },
    onError: (err, _body, context) => {
      console.error("[patchSettings] error:", err);
      if (context?.previous) qc.setQueryData(["settings"], context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const forgetAll = useMutation({
    mutationFn: () =>
      api("POST /workspaces/:workspaceId/devices/forget-all", {
        params: { workspaceId: workspace!.id },
      }),
    onMutate: () => {
      qc.setQueryData(["devices", workspace?.id], []);
      qc.setQueryData(["roles", workspace?.id], []);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["devices", workspace?.id] });
      void qc.invalidateQueries({ queryKey: ["roles", workspace?.id] });
    },
  });

  const onlineCount = deviceList.filter((d) => d.online).length;
  const assignedCount = new Set(roleList.map((r) => r.deviceId)).size;
  const hasDevices = deviceList.length > 0;

  return (
    <>
      <ContentHeader
        title="Settings"
        crumbs={["Config"]}
        badge={hasDevices ? (
          <span className="tag b-ok" style={{ opacity: onlineCount > 0 ? 1 : 0.5 }}>
            <span
              className="dot-live"
              style={{
                width: 7,
                height: 7,
                animation: onlineCount > 0 ? undefined : "none",
              }}
            />
            {onlineCount} online
          </span>
        ) : undefined}
        actions={
          <button className="btn"><Icon name="external" size={14} /> Docs</button>
        }
      />

      <div className="scroll">
        <div className="canvas-pad">

          {/* ── Top grid: Connection/Devices (left) · Notifications/Preferences (right) */}
          <div className={settings ? "settings-layout" : undefined}>
            <div>
          {/* ── Connection ─────────────────────────────────────────── */}
          <div className="box conn-box">
            <div className="box-head">
              <h3>Connection</h3>
              <span className="count">local network</span>
              {online && (
                <span className="net-meta">
                  <Icon name="wifi" size={13} /> controller 127.0.0.1
                  <span className="sep">·</span>
                  MQTT :1883
                </span>
              )}
            </div>
            <div className="conn-grid">
              <div className="conn-card">
                <div className="cc-top">
                  <span className="cc-ico blue"><Icon name="radar" size={16} /></span>
                  <div>
                    <div className="cc-title">Discover on local network</div>
                    <div className="cc-desc">Find devices already on Wi-Fi across mDNS, MQTT and Matter.</div>
                  </div>
                </div>
                <div className="cc-protos">
                  <span className="proto-badge">mDNS</span>
                  <span className="proto-badge">MQTT</span>
                </div>

                {scanState === "scanning" ? (
                  <div className="scan-panel">
                    <div className="scan-top">
                      <span className="spinner" />
                      <span>Scanning local network · <b>{scanFound}</b> device{scanFound !== 1 ? "s" : ""} found</span>
                    </div>
                    <div className="scan-protos">
                      <span className="scan-proto"><span className="sp-dot" />mDNS<span className="sp-tip">zeroconf</span></span>
                      <span className="scan-proto"><span className="sp-dot" />MQTT<span className="sp-tip">broker :1883</span></span>
                    </div>
                    <div className="scan-bar"><i /></div>
                  </div>
                ) : (
                  <div className="cc-actions">
                    <button className="btn primary" onClick={handleScan}>
                      <Icon name="radar" size={14} /> {hasDevices ? "Re-scan network" : "Scan network"}
                    </button>
                    {hasDevices && (
                      <button className="btn ghost-danger" onClick={() => forgetAll.mutate()} disabled={forgetAll.isPending}>
                        <Icon name="trash" size={13} /> Forget all
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="conn-card">
                <div className="cc-top">
                  <span className="cc-ico green"><Icon name="wifi" size={16} /></span>
                  <div>
                    <div className="cc-title">Provision a new device</div>
                    <div className="cc-desc">Onboard a brand-new device and join it to your Wi-Fi network.</div>
                  </div>
                </div>
                <div className="cc-protos">
                  <span className="proto-badge soft">SoftAP</span>
                  <span className="proto-badge soft">BLE</span>
                </div>
                <div className="cc-actions">
                  <button className="btn" onClick={() => setShowProvision(true)}>
                    <Icon name="plus" size={14} /> Start setup
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── No devices yet ────────────────────────────────────── */}
          {!hasDevices && scanState !== "scanning" && (
            <div className="set-empty">
              <div className="se-ico"><Icon name="radar" size={30} /></div>
              <h2>No devices connected yet</h2>
              <p>Connect your sensors and equipment to start monitoring and automating. Canopy detects each device's <b>readable metrics</b> and <b>writable controls</b> — those capabilities unlock automations across the rest of the app.</p>
              <div className="se-actions">
                <button className="btn primary" onClick={handleScan}><Icon name="radar" size={14} /> Scan network</button>
                <button className="btn" onClick={() => setShowProvision(true)}><Icon name="wifi" size={14} /> Provision new device</button>
              </div>
            </div>
          )}

          {/* ── Discovered devices ────────────────────────────────── */}
          {hasDevices && (
            <>
              <div className="callout">
                <span className="callout-ico"><Icon name="automation" size={16} /></span>
                <div className="callout-body">
                  <div className="callout-title">Capabilities unlock automation</div>
                  <div className="callout-text">Pair a <b>sensor role</b> with an <b>equipment role</b> to enable an automation. <span className="mono-ref">Automation</span> shows which rules become available.</div>
                </div>
                <div className="callout-stats">
                  <span><b>{deviceList.length}</b> devices</span>
                  <span className="sep">·</span>
                  <span><b>{assignedCount}</b> roles set</span>
                </div>
              </div>

              <div className="sec-head">
                <h2>Discovered devices</h2>
                <span className="count">{deviceList.length} found{scanState === "scanning" ? " · scanning" : ""}</span>
                <span className="rule" />
              </div>
              <div className="dev-list">
                {deviceList.map((d) => (
                  <DeviceCard key={d.id} device={d} onRemove={handleRemoveDevice} />
                ))}
              </div>

              {scanState === "done" && (
                <>
                  <div className="sec-head" style={{ marginTop: 28 }}>
                    <h2>Device roles</h2>
                    <span className="count">{assignedCount}/{deviceList.length} assigned</span>
                    <span className="rule" />
                    {deviceList.length - assignedCount > 0 && (
                      <Tag variant="warn"><Icon name="alert" size={11} />{deviceList.length - assignedCount} need a role</Tag>
                    )}
                  </div>
                  <div className="roles-box">
                    <div className="roles-head">
                      <span>Device</span><span>Detected as</span><span>Grow role</span><span>Unlocks</span>
                    </div>
                    {deviceList.map((d) => (
                      <RoleRow key={d.id} device={d} roles={roleList} onAssign={handleAssignRole} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

            </div>{/* end left column */}

            {/* ── Right aside: Notifications + Preferences ──────── */}
            {settings && (
              <div className="settings-aside">
                <div className="sec-head" style={{ marginTop: 0 }}>
                  <h2>Notifications</h2><span className="rule" />
                </div>
                <div className="box">
                  <div className="auto-list">
                    {([
                      ["notificationsEnabled",    "OS notifications (global)"],
                      ["notifyThresholdWarn",     "Sensor threshold warnings"],
                      ["notifyThresholdErr",      "Sensor threshold errors"],
                      ["notifyFailsafe",          "Failsafe trips"],
                      ["notifyDeviceOffline",     "Device goes offline"],
                      ["notifyMaintenanceDue",    "Maintenance due"],
                      ["notifyGrowStage",         "Grow stage changes"],
                      ["notifyAutomationOverride","Automation override active"],
                    ] as [keyof typeof settings, string][]).map(([key, label]) => (
                      <div key={key} className="auto-row">
                        <div className="auto-meta">
                          <div className="auto-name">{label}</div>
                        </div>
                        <Switch
                          checked={settings[key] as boolean}
                          onCheckedChange={(val) => patchSettings.mutate({ [key]: val } as never)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="sec-head">
                  <h2>Preferences</h2><span className="rule" />
                </div>
                <div className="box">
                  <div className="auto-list">
                    <div className="auto-row" style={{ gap: 16 }}>
                      <div className="auto-meta"><div className="auto-name">Theme</div></div>
                      <Select
                        value={currentTheme}
                        onValueChange={(val) => {
                          const t = val as AppSettings["theme"];
                          setTheme(t);
                          patchSettings.mutate({ theme: t });
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="system">System</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="auto-row" style={{ gap: 16 }}>
                      <div className="auto-meta"><div className="auto-name">Temperature</div></div>
                      <Select
                        value={settings.unitTemperature}
                        onValueChange={(val) => patchSettings.mutate({ unitTemperature: val as AppSettings["unitTemperature"] })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="C">°C — Celsius</SelectItem>
                          <SelectItem value="F">°F — Fahrenheit</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="auto-row" style={{ gap: 16 }}>
                      <div className="auto-meta"><div className="auto-name">Weight</div></div>
                      <Select
                        value={settings.unitWeight}
                        onValueChange={(val) => patchSettings.mutate({ unitWeight: val as AppSettings["unitWeight"] })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="g">g — grams</SelectItem>
                          <SelectItem value="oz">oz — ounces</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>{/* end settings-layout */}

          {/* ── Bottom pods: Data & Storage · Workspaces ──────────── */}
          <div className="settings-pods" style={{ marginTop: 24 }}>
            {settings && (
              <div>
                <div className="sec-head" style={{ marginTop: 0 }}>
                  <h2>Data &amp; Storage</h2><span className="rule" />
                </div>
                <div className="box">
                  <div className="auto-list">
                    {([
                      ["rawRetentionDays",    "Raw readings kept",     3,  30,  1,  "days" ],
                      ["hourlyRetentionDays", "Hourly rollup kept",    30, 365, 5,  "days" ],
                      ["archiveAfterDays",    "Auto-archive after",    7,  90,  1,  "days" ],
                      ["backupIntervalDays",  "Backup every",          1,  30,  1,  "days" ],
                    ] as [keyof typeof settings, string, number, number, number, string][]).map(([key, label, min, max, step, unit]) => (
                      <div key={key} className="auto-row">
                        <div className="auto-meta">
                          <div className="auto-name">{label}</div>
                          <div className="auto-desc" style={{ fontVariantNumeric: "tabular-nums" }}>
                            <b>{settings[key] as number}</b> {unit}
                          </div>
                        </div>
                        <input
                          type="range"
                          min={min} max={max} step={step}
                          value={settings[key] as number}
                          style={{
                            width: 140,
                            accentColor: "var(--accent-fg)",
                            "--rng": `${((settings[key] as number - min) / (max - min) * 100).toFixed(1)}%`,
                          } as React.CSSProperties}
                          onChange={(e) => {
                            const pct = ((Number(e.target.value) - min) / (max - min) * 100).toFixed(1) + "%";
                            e.currentTarget.style.setProperty("--rng", pct);
                            qc.setQueryData(["settings"], (old: typeof settings) =>
                              old ? { ...old, [key]: Number(e.target.value) } : old,
                            );
                          }}
                          onPointerUp={(e) => {
                            patchSettings.mutate({ [key]: Number((e.target as HTMLInputElement).value) } as never);
                          }}
                        />
                      </div>
                    ))}
                    <div className="auto-row">
                      <div className="auto-meta"><div className="auto-name">Backup enabled</div></div>
                      <Switch
                        checked={settings.backupEnabled}
                        onCheckedChange={(val) => patchSettings.mutate({ backupEnabled: val })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {workspaceList.length > 0 && (
              <div>
                <div className="sec-head" style={{ marginTop: 0 }}>
                  <h2>Workspaces</h2>
                  <span className="count">{workspaceList.length}</span>
                  <span className="rule" />
                </div>
                <div className="box">
                  {workspaceList.map((ws, i) => (
                    <WorkspaceRow
                      key={ws.id}
                      workspace={ws}
                      isActive={ws.id === workspace?.id}
                      isOnly={workspaceList.length === 1}
                      isLast={i === workspaceList.length - 1}
                      onDelete={(id) => deleteWorkspace.mutate(id)}
                      onArchive={(id) => deleteWorkspace.mutate(id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── About ──────────────────────────────────────────────── */}
          <div style={{ marginTop: 24 }}>
            <div className="sec-head" style={{ marginTop: 0 }}>
              <h2>About</h2><span className="rule" />
            </div>
            <div className="box">
              <div className="env-summary">
                <div className="env-cell">
                  <div className="env-k">Controller</div>
                  <div className="env-v" style={{ fontSize: 14 }}>{online ? "Running" : "Offline"}</div>
                  <div className="env-s">{version ? `v${version}` : "—"}</div>
                </div>
                <div className="env-cell">
                  <div className="env-k">Uptime</div>
                  <div className="env-v" style={{ fontSize: 14 }}>
                    {uptimeSec != null ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m` : "—"}
                  </div>
                  <div className="env-s">controller service</div>
                </div>
                <div className="env-cell">
                  <div className="env-k">MQTT broker</div>
                  <div className="env-v" style={{ fontSize: 14 }}>:{1883}</div>
                  <div className="env-s">local only · 127.0.0.1</div>
                </div>
                <div className="env-cell">
                  <div className="env-k">API</div>
                  <div className="env-v" style={{ fontSize: 14 }}>:{7001}</div>
                  <div className="env-s">HTTP + WebSocket</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {showProvision && (
        <ProvisionModal
          onClose={() => setShowProvision(false)}
          {...(workspace?.id ? { workspaceId: workspace.id } : {})}
        />
      )}
    </>
  );
}
