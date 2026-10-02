import { useState, useEffect, useCallback } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { ContentHeader } from "@/components/ContentHeader";
import { PageBody } from "@/components/PageBody";
import { Icon } from "@/components/Icon";
import { DeleteButton } from "@/components/DeleteButton";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/Tag";
import { SignalBars } from "@/components/SignalBars";
import { BrokerSettings } from "@/components/BrokerSettings";
import { DeviceCredential } from "@/components/DeviceCredential";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/theme/ThemeProvider";
import { ProvisionModal } from "@/components/ProvisionModal";
import { ImportModal } from "@/components/ImportModal";
import { Tip } from "@/components/Tip";
import {
  useWorkspaces,
  useActiveWorkspace,
  useAppSettings,
  usePatchWorkspace,
  useDeleteWorkspace,
  useArchiveWorkspace,
  useStoredWorkspaces,
  useRestoreWorkspace,
  usePurgeWorkspace,
} from "@/hooks/useWorkspace";
import { useDevices, useRoles, useAssignRole, useScan } from "@/hooks/useDevices";
import { actuatorKey, useActuatorStates, type ActuatorStatesMap } from "@/hooks/useActuatorStates";
import { ActuatorStateTag } from "@/components/ActuatorStateTag";
import { ROLE_META, isControlDevice, roleChannel, rolesFor } from "@/lib/roles";
import { useControllerStatus, useHealthStatus } from "@/hooks/useBackend";
import { api, BACKEND_URL } from "@/lib/http";
import { cn } from "@/lib/utils";
import { LUX_TO_PPFD, type Device, type RoleAssignment, type AppSettings, type GrowLightType } from "@canopy/shared-types";


// ── Device card ───────────────────────────────────────────────────────────────
function DeviceCard({ device, states, onRemove }: { device: Device; states: ActuatorStatesMap; onRemove: (id: string) => void }) {
  const isControl = device.capabilities.some((c) => c.kind === "actuator");
  const metrics = device.capabilities.filter((c) => c.kind === "sensor");
  const controls = device.capabilities.filter((c) => c.kind === "actuator");

  return (
    <div className={cn("dev-card", !device.online && "off")} data-search-id={device.id}>
      <div className="dev-head">
        <span className={cn("online-dot", !device.online && "off")} />
        <div className="dev-id">
          <div className="dev-name">
            {device.name}
            {device.detachedAt ? (
              <Tip content="Imported copy: this hardware belongs to a device in another workspace, so it is not read from or driven here">
                <span className="tag b-warn" style={{ fontSize: 10 }}>detached</span>
              </Tip>
            ) : !device.online && <span className="tag b-idle" style={{ fontSize: 10 }}>offline</span>}
          </div>
          <div className="dev-host">
            {/* First, because the line is cut off at the end when it is long. */}
            {device.mqttAuth === "anonymous" && (
              <Tip content="Connects without a broker password. Open Broker login below for the one to enter in its MQTT settings">
                <span className="dev-nopass"><Icon name="alert" size={11} /> no password</span>
              </Tip>
            )}
            {device.mqttAuth === "anonymous" && (device.model || device.address.host || device.address.mqttTopicPrefix) && <span className="sep">·</span>}
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
        <DeleteButton onDelete={() => onRemove(device.id)} confirmLabel="Remove?" ariaLabel={`Remove ${device.name}`} />
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
                <ActuatorStateTag state={states.get(actuatorKey(device.id, c.channel))} online={device.online} />
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
        {/* Only an MQTT device connects to the broker; a detached copy is not in use. */}
        {device.address.protocol === "mqtt" && !device.detachedAt && <DeviceCredential device={device} />}
      </div>
    </div>
  );
}

// ── Retention value entry ─────────────────────────────────────────────────────
/**
 * Typed entry for a retention setting, beside its slider.
 *
 * The draft is held as text while the field has focus and only committed on
 * blur or Enter. Clamping every keystroke sounds safer and is not: with a
 * 30–365 range, typing "50" snaps the leading "5" up to 30 and the rest of the
 * number can never be entered. Escape abandons the draft.
 *
 * On commit the value is snapped to the slider's step and clamped to its range,
 * so the two controls cannot disagree about what is representable, and anything
 * unparseable falls back to the stored value rather than writing NaN.
 */
function RetentionInput({ value, min, max, step, unit, onCommit }: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // Follow the slider while it is being dragged, but never overwrite a draft
  // the user is part-way through typing.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const parsed = Number(draft.trim());
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const snapped = Math.round(parsed / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <span className="retention-field">
      <input
        className="retention-input"
        type="text"
        inputMode="numeric"
        aria-label={`${unit} (${min}–${max})`}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(String(value));
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
      />
      <span className="retention-unit">{unit}</span>
    </span>
  );
}

// ── Role assignment row ───────────────────────────────────────────────────────
function RoleRow({ device, roles, onAssign }: {
  device: Device;
  roles: RoleAssignment[];
  onAssign: (deviceId: string, channel: string, role: RoleAssignment["role"] | "") => void;
}) {
  const isControl = isControlDevice(device);
  const assigned = roles.find((r) => r.deviceId === device.id);
  const roleInfo = assigned ? ROLE_META[assigned.role] : undefined;
  const [localRole, setLocalRole] = useState(assigned?.role ?? "");
  const caps = [
    ...device.capabilities.filter((c) => c.kind === "sensor").map((c) => c.metric),
    ...device.capabilities.filter((c) => c.kind === "actuator").map((c) => ("label" in c ? c.label ?? c.actuator : c.actuator)),
  ].join(" · ") || "—";

  const channel = roleChannel(device);
  const compatibleRoles = rolesFor(device);

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
            {compatibleRoles.map((id) => (
              <SelectItem key={id} value={id}>{ROLE_META[id].name}</SelectItem>
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

/** For DLI from a lux sensor: what lights the tent decides how lux converts to PPFD. */
const GROW_LIGHT_OPTIONS: { value: GrowLightType; label: string }[] = [
  { value: "white_led", label: `White LED (× ${LUX_TO_PPFD.white_led})` },
  { value: "hps", label: `HPS (× ${LUX_TO_PPFD.hps})` },
  { value: "sunlight", label: `Sunlight (× ${LUX_TO_PPFD.sunlight})` },
  { value: "custom", label: "Custom factor" },
];

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
  const [light, setLight] = useState<GrowLightType>(workspace.growLight.type);
  const [factor, setFactor] = useState(String(workspace.growLight.luxToPpfd));
  const patch = usePatchWorkspace(workspace.id);

  useEffect(() => {
    setName(workspace.name);
    setTz(workspace.timezone);
    setLight(workspace.growLight.type);
    setFactor(String(workspace.growLight.luxToPpfd));
  }, [workspace.name, workspace.timezone, workspace.growLight.type, workspace.growLight.luxToPpfd]);

  const customFactor = Number(factor);
  const factorOk = light !== "custom" || (Number.isFinite(customFactor) && customFactor > 0 && customFactor < 1);

  return (
    <div className="ws-mgmt-row" style={{ borderBottom: isLast ? "none" : "1px solid var(--border-muted)" }}>
      {/* The three buttons set the width, and the header and both fields match
          it, so the form reads as one block rather than two inputs of unrelated
          sizes. The block centres in the row. */}
      <div className="ws-mgmt-form">
        <div className="ws-mgmt-header">
          <span className="ws-mgmt-name">{workspace.name}</span>
          {isActive && <span className="tag b-ok" style={{ fontSize: 10 }}>active</span>}
        </div>
        <div className="gc-field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="gc-field">
          <label>Timezone</label>
          <input
            value={tz}
            placeholder="e.g. Australia/Sydney"
            onChange={(e) => setTz(e.target.value)}
          />
        </div>
        <div className="gc-field">
          <Tip content="Only used when the canopy light sensor reads lux: it converts lux to PPFD for DLI, and depends on the light's spectrum. DLI from lux is shown as an estimate.">
            <label>Grow light</label>
          </Tip>
          <select className="role-select ws-light" value={light} onChange={(e) => setLight(e.target.value as GrowLightType)}>
            {GROW_LIGHT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {light === "custom" && (
            <input
              value={factor}
              inputMode="decimal"
              placeholder="µmol/m²/s per lux, e.g. 0.016"
              aria-label="Lux to PPFD factor"
              aria-invalid={!factorOk}
              onChange={(e) => setFactor(e.target.value)}
            />
          )}
        </div>
        <div className="ws-mgmt-actions">
          {/* No countdown: a deleted workspace can be restored for 7 days.
              The countdown belongs to "Delete now", which cannot be undone. */}
          <DeleteButton
            label="Delete"
            onDelete={() => onDelete(workspace.id)}
            disabled={isOnly}
            title={isOnly ? "Keep at least one workspace" : "Moves it to Recently deleted, where it can be restored for 7 days"}
          />

          {/* Archive — single click, no confirmation (reversible action) */}
          <Tip content={isOnly ? "Keep at least one workspace" : "Put it away; restore it any time. Nothing runs for it meanwhile."}>
            <button
              className="btn archive sm"
              onClick={() => onArchive(workspace.id)}
              disabled={isOnly}
            >
              <Icon name="archive" size={13} /> Archive
            </button>
          </Tip>

          <button
            className="btn primary sm"
            onClick={() => patch.mutate({
              name,
              timezone: tz,
              growLight: { type: light, luxToPpfd: light === "custom" ? customFactor : LUX_TO_PPFD[light] },
            })}
            disabled={patch.isPending || !factorOk}
          >
            <Icon name="check" size={13} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Archived and recently deleted workspaces ─────────────────────────────────

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/**
 * The workspaces put away, under the live ones: Archived, each restorable at
 * any time, and Recently deleted, each restorable until it is purged. Both
 * start collapsed; they are what you come looking for, not what you work in.
 */
function StoredWorkspaces() {
  const { data } = useStoredWorkspaces();
  const restore = useRestoreWorkspace();
  const purge = usePurgeWorkspace();
  const [open, setOpen] = useState<{ archived: boolean; deleted: boolean }>({ archived: false, deleted: false });
  const [note, setNote] = useState("");

  const onRestore = (id: string, name: string) =>
    restore.mutate(id, {
      onSuccess: ({ detachedDevices }) =>
        setNote(detachedDevices > 0
          ? `${name} is back. ${detachedDevices} of its devices ${detachedDevices === 1 ? "is" : "are"} now used by another workspace, so ${detachedDevices === 1 ? "it comes" : "they come"} back detached.`
          : `${name} is back.`),
    });

  // The note outlives the lists: restoring the last one empties them.
  if (!data || (data.archived.length === 0 && data.deleted.length === 0 && !note)) return null;

  const group = (key: "archived" | "deleted", title: string, list: typeof data.archived) =>
    list.length > 0 && (
      <div className="ws-stored">
        <button className="ws-stored-head" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} aria-expanded={open[key]}>
          <span className="ash-chev" style={{ transform: open[key] ? "none" : "rotate(-90deg)" }}><Icon name="chevron" size={13} /></span>
          {title}
          <span className="count">{list.length}</span>
        </button>
        {open[key] && list.map((w) => (
          <div key={w.id} className="ws-stored-row">
            <div className="ws-stored-meta">
              <span className="ws-mgmt-name">{w.name}</span>
              <span className="ws-stored-when">
                {key === "archived"
                  ? `archived ${fmtDate(w.archivedAt!)}`
                  : `deleted ${fmtDate(w.deletedAt!)} · ${daysLeft(w.purgeAt!) === 0 ? "removed today" : `${daysLeft(w.purgeAt!)} day${daysLeft(w.purgeAt!) === 1 ? "" : "s"} left`}`}
              </span>
            </div>
            <button className="btn sm" onClick={() => onRestore(w.id, w.name)} disabled={restore.isPending}>
              <Icon name="refresh" size={12} /> Restore
            </button>
            {key === "deleted" && (
              <DeleteButton
                label="Delete now"
                countdown
                onDelete={() => purge.mutate(w.id)}
                title="Removes it and everything in it for good"
              />
            )}
          </div>
        ))}
      </div>
    );

  return (
    <div className="box ws-stored-box">
      {group("archived", "Archived", data.archived)}
      {group("deleted", "Recently deleted", data.deleted)}
      {note && <div className="ws-stored-note">{note}</div>}
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
  const actuatorStates = useActuatorStates(workspace?.id);
  const { data: roleList = [] } = useRoles(workspace?.id);
  const { online, version, uptimeSec } = useHealthStatus();
  // What the controller says about itself, rather than what this window assumes.
  const { data: controller } = useControllerStatus();
  const mqttPort = controller?.mqttPort ?? "—";
  const { state: scanState, found: scanFound, startScan, resetScan } = useScan(workspace?.id);
  const assignRole = useAssignRole(workspace?.id ?? "");
  const deleteWorkspace = useDeleteWorkspace();
  const archiveWorkspace = useArchiveWorkspace();
  const qc = useQueryClient();
  const [showProvision, setShowProvision] = useState(false);
  const [showImport, setShowImport] = useState(false);

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

      <PageBody>
        

          {/* ── Top grid: Connection + devices (left) · Notifications, Preferences, Workspaces (right) */}
          <div className={settings ? "settings-layout" : undefined}>
            <div>
          {/* ── Connection ─────────────────────────────────────────── */}
          <div className="box conn-box">
            <div className="box-head">
              <h3>Connection</h3>
              <span className="count">local network</span>
              {online && (
                <span className="net-meta">
                  <Icon name="wifi" size={13} /> controller {new URL(BACKEND_URL).hostname}
                  <span className="sep">·</span>
                  MQTT :{mqttPort}
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
                      <span className="scan-proto"><span className="sp-dot" />MQTT<span className="sp-tip">broker :{mqttPort}</span></span>
                    </div>
                    <div className="scan-bar"><i /></div>
                  </div>
                ) : (
                  <div className="cc-actions">
                    <button className="btn primary" onClick={handleScan}>
                      <Icon name="radar" size={14} /> {hasDevices ? "Re-scan network" : "Scan network"}
                    </button>
                    {hasDevices && (
                      <DeleteButton
                        label="Forget all"
                        countdown
                        size="md"
                        onDelete={() => forgetAll.mutate()}
                        disabled={forgetAll.isPending}
                      />
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
                  <DeviceCard key={d.id} device={d} states={actuatorStates} onRemove={handleRemoveDevice} />
                ))}
              </div>

            </>
          )}

            </div>{/* end left column */}

            {/* ── Right aside: Notifications · Preferences · Workspaces */}
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
              {workspaceList.length > 0 && (
                <div>
                  <div className="sec-head ws-section-head">
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
                        onArchive={(id) => archiveWorkspace.mutate(id)}
                      />
                    ))}
                  </div>
                  <StoredWorkspaces />
                </div>
              )}
              </div>
            )}
          </div>{/* end settings-layout */}

          {/* ── Full width: Device roles · Data & Storage ─────────── */}
              {/* Roles belong to the devices that are adopted, not to the scan
                  that found them: gating this on scan state made the only way
                  to assign a role the few seconds after a scan completed, and
                  it vanished on the next remount. */}
          {hasDevices && deviceList.length > 0 && (
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
            {settings && (
              <div>
                <div className="sec-head" style={{ marginTop: 0 }}>
                  <h2>Device connections</h2><span className="rule" />
                </div>
                <BrokerSettings />
                <div className="sec-head" style={{ marginTop: 28 }}>
                  <h2>Data &amp; Storage</h2><span className="rule" />
                </div>
                <div className="box">
                  <div className="auto-list storage-grid">
                    {([
                      ["rawRetentionDays",    "Raw readings kept",     3,  30,  1,  "days" ],
                      ["hourlyRetentionDays", "Hourly rollup kept",    30, 365, 5,  "days" ],
                      ["eventRetentionDays",  "Events & alerts kept",  7,  365, 1,  "days" ],
                      ["archiveAfterDays",    "Auto-archive after",    7,  90,  1,  "days" ],
                      ["backupIntervalDays",  "Backup every",          1,  30,  1,  "days" ],
                    ] as [keyof typeof settings, string, number, number, number, string][]).map(([key, label, min, max, step, unit]) => (
                      <div key={key} className="auto-row">
                        <div className="auto-meta">
                          <div className="auto-name">{label}</div>
                          <div className="auto-desc">{min}–{max} {unit}</div>
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
                        <RetentionInput
                          value={settings[key] as number}
                          min={min}
                          max={max}
                          step={step}
                          unit={unit}
                          onCommit={(next) => {
                            qc.setQueryData(["settings"], (old: typeof settings) =>
                              old ? { ...old, [key]: next } : old,
                            );
                            patchSettings.mutate({ [key]: next } as never);
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
                    <div className="auto-row">
                      <div className="auto-meta">
                        <div className="auto-name">Export everything</div>
                        <div className="auto-desc">Every workspace with its history and photos, in one .canopy file</div>
                      </div>
                      {/* A native download: Electron streams it to disk and asks where. */}
                      <a className="btn sm" href={`${BACKEND_URL}/data/export`}>
                        <Icon name="external" size={13} /> Export…
                      </a>
                    </div>
                    <div className="auto-row">
                      <div className="auto-meta">
                        <div className="auto-name">Import workspaces</div>
                        <div className="auto-desc">Add the workspaces from a .canopy file beside yours; nothing here changes</div>
                      </div>
                      <button className="btn sm" onClick={() => setShowImport(true)}>
                        <Icon name="arrow-down" size={13} /> Import…
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}


          {/* ── About ──────────────────────────────────────────────── */}
          <div style={{ marginTop: 24 }}>
            <div className="sec-head" style={{ marginTop: 0 }}>
              <h2>About</h2><span className="rule" />
            </div>
            <div className="box">
              <div className="env-summary">
                <div className="env-cell">
                  <div className="env-k">Controller</div>
                  <div className="env-v" style={{ fontSize: 14, textTransform: "capitalize" }}>
                    {online ? controller?.state ?? "running" : "offline"}
                  </div>
                  <div className="env-s">
                    {version ? `v${version}` : "—"}
                    {controller && (controller.installed ? " · service" : " · from the repo")}
                  </div>
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
                  <div className="env-v" style={{ fontSize: 14 }}>:{mqttPort}</div>
                  {/* Every interface, not loopback: devices on the LAN connect to it. */}
                  <div className="env-s">all interfaces · for devices</div>
                </div>
                <div className="env-cell">
                  <div className="env-k">API</div>
                  <div className="env-v" style={{ fontSize: 14 }}>:{controller?.httpPort ?? "—"}</div>
                  <div className="env-s">this computer only · HTTP + WebSocket</div>
                </div>
                <div className="env-cell" style={{ gridColumn: "1 / -1" }}>
                  <div className="env-k">Data</div>
                  <div className="env-v" style={{ fontSize: 13, fontFamily: "var(--mono)", fontWeight: 400, wordBreak: "break-all" }}>
                    {controller?.dataDir ?? "—"}
                  </div>
                  <div className="env-s">database, journal photos and backups</div>
                </div>
              </div>
            </div>
          </div>

        
      </PageBody>

      {showProvision && (
        <ProvisionModal
          onClose={() => setShowProvision(false)}
          {...(workspace?.id ? { workspaceId: workspace.id } : {})}
        />
      )}
      <ImportModal open={showImport} onClose={() => setShowImport(false)} />
    </>
  );
}
