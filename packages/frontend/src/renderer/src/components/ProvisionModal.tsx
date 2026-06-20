import { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

interface WifiNetwork {
  ssid: string;
  signal: number;
  isDeviceAp: boolean;
}

interface BleDevice {
  deviceId: string;
  deviceName: string;
}

type StepId =
  | "intro"
  | "scanning"
  | "not_found"
  | "detected"
  | "softap_guide"
  | "credentials"
  | "connecting"
  | "connect_error"
  | "success";

const BACKEND = "http://localhost:7001";
const SCAN_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 30_000;
const SOFTAP_DEVICE_IP = "192.168.4.1";

const PROGRESS_LABELS = ["Pairing mode", "Device found", "Credentials", "Joining"] as const;

function getProgressIdx(step: StepId): number {
  if (step === "intro" || step === "scanning" || step === "not_found") return 0;
  if (step === "detected" || step === "softap_guide") return 1;
  if (step === "credentials") return 2;
  return 3;
}

export function ProvisionModal({
  onClose,
  workspaceId,
}: {
  onClose: () => void;
  workspaceId?: string;
}) {
  // Step — also held in ref so async callbacks never see stale value
  const [step, _setStep] = useState<StepId>("intro");
  const stepRef = useRef<StepId>("intro");
  const setStep = useCallback((s: StepId) => {
    stepRef.current = s;
    _setStep(s);
  }, []);

  const [foundNetworks, setFoundNetworks] = useState<WifiNetwork[]>([]);
  const [foundBle, setFoundBle] = useState<BleDevice[]>([]);

  const [selectedNetwork, setSelectedNetwork] = useState<WifiNetwork | null>(null);
  const [selectedBle, setSelectedBle] = useState<BleDevice | null>(null);
  const [protocol, setProtocol] = useState<"softap" | "ble" | null>(null);

  const [homeSsid, setHomeSsid] = useState("");
  const [homePassword, setHomePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // BLE: keep the resolved BluetoothDevice for GATT connect in the connecting step
  const bleDeviceObjRef = useRef<BluetoothDevice | null>(null);
  const bleRequestRef = useRef<Promise<BluetoothDevice | null> | null>(null);

  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bleUnsubRef = useRef<(() => void) | null>(null);

  // Cancel any pending BLE scan and timers on unmount
  useEffect(() => {
    return () => {
      window.canopyBle?.cancel();
      bleUnsubRef.current?.();
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    };
  }, []);

  const startScan = useCallback(async () => {
    setStep("scanning");
    setFoundNetworks([]);
    setFoundBle([]);
    bleDeviceObjRef.current = null;
    bleRequestRef.current = null;

    // Timeout: if nothing found in 10s, show not_found
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => {
      if (stepRef.current === "scanning") setStep("not_found");
    }, SCAN_TIMEOUT_MS);

    // BLE: subscribe to device list updates pushed from main process
    bleUnsubRef.current?.();
    bleUnsubRef.current = window.canopyBle.onDevicesUpdated((devices) => {
      if (stepRef.current !== "scanning") return;
      setFoundBle(devices);
      if (devices.length > 0) {
        clearTimeout(scanTimeoutRef.current!);
        setStep("detected");
      }
    });

    // BLE: trigger scanning. requestDevice resolves only when a device is selected
    // (main process intercepts the native picker and sends IPC updates instead)
    bleRequestRef.current = navigator.bluetooth
      .requestDevice({ acceptAllDevices: true, optionalServices: [] })
      .then((d) => d)
      .catch(() => null);

    // SoftAP: ask the backend to scan OS Wi-Fi networks
    try {
      const res = await fetch(`${BACKEND}/provision/wifi-scan`);
      if (res.ok) {
        const { networks } = (await res.json()) as { networks: WifiNetwork[] };
        const deviceNets = networks.filter((n) => n.isDeviceAp);
        if (deviceNets.length > 0 && stepRef.current === "scanning") {
          setFoundNetworks(deviceNets);
          clearTimeout(scanTimeoutRef.current!);
          setStep("detected");
        }
      }
    } catch {
      /* ignore — SoftAP scan failing is non-fatal; BLE scan continues */
    }
  }, [setStep]);

  const handleSelectBle = useCallback(
    async (device: BleDevice) => {
      setProtocol("ble");
      setSelectedBle(device);
      // Tell main process which device to pick — resolves the pending requestDevice promise
      window.canopyBle.selectDevice(device.deviceId);
      bleDeviceObjRef.current = await (bleRequestRef.current ?? Promise.resolve(null));
      setStep("credentials");
    },
    [setStep],
  );

  const handleSendCredentials = useCallback(async () => {
    if (!homeSsid.trim()) return;
    setStep("connecting");
    setErrorMsg("");

    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = setTimeout(() => {
      if (stepRef.current === "connecting") {
        setErrorMsg("The device did not appear on the network in time. Check it is powered on and in range.");
        setStep("connect_error");
      }
    }, CONNECT_TIMEOUT_MS);

    try {
      if (protocol === "softap") {
        const res = await fetch(`${BACKEND}/provision/softap/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceIp: SOFTAP_DEVICE_IP, ssid: homeSsid, password: homePassword }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `Server error ${res.status}`);
        }
      } else if (protocol === "ble" && bleDeviceObjRef.current) {
        const server = await bleDeviceObjRef.current.gatt?.connect();
        if (!server) throw new Error("Could not connect to device GATT server.");
        // TODO: replace service/characteristic UUIDs with your firmware's provisioning profile
        // const service = await server.getPrimaryService("your-provision-service-uuid");
        // const char = await service.getCharacteristic("your-cred-characteristic-uuid");
        // await char.writeValue(new TextEncoder().encode(JSON.stringify({ ssid: homeSsid, password: homePassword })));
        console.log("[BLE provision] GATT connected — credential write not yet implemented");
      }

      // Trigger a network scan so the newly-joined device gets discovered
      if (workspaceId) {
        await fetch(`${BACKEND}/workspaces/${workspaceId}/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }

      clearTimeout(connectTimeoutRef.current!);
      if (stepRef.current === "connecting") setStep("success");
    } catch (e) {
      clearTimeout(connectTimeoutRef.current!);
      if (stepRef.current === "connecting") {
        setErrorMsg(e instanceof Error ? e.message : "An unexpected error occurred.");
        setStep("connect_error");
      }
    }
  }, [protocol, homeSsid, homePassword, workspaceId, setStep]);

  const handleClose = useCallback(() => {
    window.canopyBle?.cancel();
    bleUnsubRef.current?.();
    onClose();
  }, [onClose]);

  const progressIdx = getProgressIdx(step);

  // ── Body content per step ────────────────────────────────────────────────
  const renderBody = () => {
    switch (step) {
      case "intro":
        return (
          <div className="prov-step prov-intro">
            <div className="prov-intro-ico">
              <Icon name="wifi" size={36} />
            </div>
            <p>Hold the device's pairing button for <strong>5 seconds</strong> until the LED blinks. This puts it into pairing mode.</p>
            <p className="prov-hint">Canopy will scan for <strong>SoftAP</strong> (Wi-Fi) and <strong>Bluetooth</strong> signals simultaneously.</p>
          </div>
        );

      case "scanning":
        return (
          <div className="prov-step prov-scanning">
            <div className="prov-scan-rows">
              <div className="prov-scan-row">
                <span className="spinner" />
                <span className="prov-scan-proto"><Icon name="wifi" size={13} /> SoftAP</span>
                <span className="prov-scan-desc">scanning Wi-Fi networks</span>
              </div>
              <div className="prov-scan-row">
                <span className="spinner" />
                <span className="prov-scan-proto"><Icon name="bluetooth" size={13} /> Bluetooth</span>
                <span className="prov-scan-desc">searching nearby devices</span>
              </div>
            </div>
            <div className="prov-scan-bar"><i className="prov-scan-progress" /></div>
          </div>
        );

      case "not_found":
        return (
          <div className="prov-step prov-empty">
            <span className="prov-empty-ico"><Icon name="radar" size={30} /></span>
            <h4>No devices found</h4>
            <p>Make sure the device is in pairing mode — the LED should be blinking blue or white.</p>
          </div>
        );

      case "detected": {
        const hasSelection = selectedNetwork !== null || selectedBle !== null;
        return (
          <div className="prov-step">
            <p className="prov-hint" style={{ marginBottom: 10 }}>Select the device to provision.</p>
            {foundNetworks.length > 0 && (
              <div className="prov-device-group">
                <div className="prov-device-group-label"><Icon name="wifi" size={11} /> SoftAP</div>
                {foundNetworks.map((n) => (
                  <button
                    key={n.ssid}
                    className={cn("prov-device-item", selectedNetwork?.ssid === n.ssid && !selectedBle && "selected")}
                    onClick={() => { setSelectedNetwork(n); setSelectedBle(null); }}
                  >
                    <Icon name="wifi" size={14} />
                    <span className="prov-device-name">{n.ssid}</span>
                    <span className="prov-device-meta">{n.signal}%</span>
                  </button>
                ))}
              </div>
            )}
            {foundBle.length > 0 && (
              <div className="prov-device-group">
                <div className="prov-device-group-label"><Icon name="bluetooth" size={11} /> Bluetooth</div>
                {foundBle.map((d) => (
                  <button
                    key={d.deviceId}
                    className={cn("prov-device-item", selectedBle?.deviceId === d.deviceId && "selected")}
                    onClick={() => { setSelectedBle(d); setSelectedNetwork(null); }}
                  >
                    <Icon name="bluetooth" size={14} />
                    <span className="prov-device-name">{d.deviceName || "Unknown device"}</span>
                  </button>
                ))}
              </div>
            )}
            {!hasSelection && (
              <p className="prov-hint" style={{ marginTop: 8, color: "var(--fg-subtle)" }}>Select a device above to continue.</p>
            )}
          </div>
        );
      }

      case "softap_guide":
        return (
          <div className="prov-step prov-softap-guide">
            <p>Connect your computer to the device's temporary Wi-Fi network using your OS Wi-Fi settings.</p>
            {selectedNetwork && (
              <div className="prov-ssid-chip">
                <Icon name="wifi" size={14} />
                {selectedNetwork.ssid}
              </div>
            )}
            <p className="prov-hint">Once connected, return here and click Continue. Canopy will send your home network credentials directly to the device.</p>
          </div>
        );

      case "credentials":
        return (
          <div className="prov-step prov-creds">
            <p>Enter your home Wi-Fi credentials. The device will use these to join your network.</p>
            <div className="field">
              <label>Network name (SSID)</label>
              <input
                className="prov-input"
                placeholder="My Wi-Fi"
                value={homeSsid}
                onChange={(e) => setHomeSsid(e.target.value)}
                autoFocus
              />
            </div>
            <div className="field">
              <label>Password</label>
              <div className="prov-pw-wrap">
                <input
                  className="prov-input"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={homePassword}
                  onChange={(e) => setHomePassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendCredentials()}
                />
                <button
                  className="icon-ghost prov-pw-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  <Icon name="eye" size={14} />
                </button>
              </div>
            </div>
          </div>
        );

      case "connecting":
        return (
          <div className="prov-step prov-connecting">
            <span className="spinner prov-spinner-lg" />
            <p>Credentials sent. Waiting for the device to join the network…</p>
            <p className="prov-hint">This may take up to 30 seconds.</p>
          </div>
        );

      case "connect_error":
        return (
          <div className="prov-step prov-error">
            <span className="prov-error-ico"><Icon name="alert" size={26} /></span>
            <h4>Could not connect</h4>
            <p>{errorMsg}</p>
          </div>
        );

      case "success":
        return (
          <div className="prov-step prov-success">
            <span className="prov-success-ico"><Icon name="check" size={26} /></span>
            <h4>Device is on your network</h4>
            <p>Canopy is scanning for your new device now. It will appear in the device list shortly.</p>
          </div>
        );
    }
  };

  // ── Footer buttons per step ──────────────────────────────────────────────
  const renderFooter = () => {
    switch (step) {
      case "intro":
        return (
          <>
            <button className="btn" onClick={handleClose}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => void startScan()}>
              <Icon name="radar" size={14} /> Start scan
            </button>
          </>
        );

      case "scanning":
        return (
          <>
            <button className="btn" onClick={handleClose}>Cancel</button>
          </>
        );

      case "not_found":
        return (
          <>
            <button className="btn" onClick={handleClose}>Exit</button>
            <span style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => void startScan()}>
              <Icon name="refresh" size={14} /> Try again
            </button>
          </>
        );

      case "detected": {
        const hasSelection = selectedNetwork !== null || selectedBle !== null;
        return (
          <>
            <button className="btn" onClick={() => void startScan()}>
              <Icon name="refresh" size={13} /> Rescan
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn primary"
              disabled={!hasSelection}
              onClick={() => {
                if (selectedNetwork) {
                  setProtocol("softap");
                  setStep("softap_guide");
                } else if (selectedBle) {
                  void handleSelectBle(selectedBle);
                }
              }}
            >
              Continue <Icon name="arrow-right" size={14} />
            </button>
          </>
        );
      }

      case "softap_guide":
        return (
          <>
            <button className="btn" onClick={() => setStep("detected")}>
              ← Back
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => setStep("credentials")}>
              I'm connected <Icon name="arrow-right" size={14} />
            </button>
          </>
        );

      case "credentials":
        return (
          <>
            <button
              className="btn"
              onClick={() => {
                if (protocol === "softap") setStep("softap_guide");
                else { bleDeviceObjRef.current = null; bleRequestRef.current = null; setStep("intro"); }
              }}
            >
              Back
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn primary"
              disabled={!homeSsid.trim()}
              onClick={() => void handleSendCredentials()}
            >
              Send credentials <Icon name="arrow-right" size={14} />
            </button>
          </>
        );

      case "connecting":
        return null;

      case "connect_error":
        return (
          <>
            <button className="btn" onClick={() => { setStep("intro"); setSelectedNetwork(null); setSelectedBle(null); }}>
              Start over
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => setStep("credentials")}>
              <Icon name="refresh" size={13} /> Try again
            </button>
          </>
        );

      case "success":
        return (
          <>
            <span style={{ flex: 1 }} />
            <button className="btn primary" onClick={handleClose}>
              <Icon name="check" size={13} /> Done
            </button>
          </>
        );
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal prov-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="modal-head">
          <Icon name="wifi" size={16} />
          <h3>Provision a new device</h3>
          <button className="icon-ghost" onClick={handleClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="modal-steps">
          {PROGRESS_LABELS.map((label, i) => (
            <div key={i} className={cn("mstep", i === progressIdx && "on", i < progressIdx && "done")}>
              <span className="mstep-n">
                {i < progressIdx ? <Icon name="check" size={10} /> : i + 1}
              </span>
              {label}
              {i < PROGRESS_LABELS.length - 1 && <span className="mstep-sep" />}
            </div>
          ))}
        </div>

        <div className="modal-body">{renderBody()}</div>

        <div className="modal-foot">{renderFooter()}</div>
      </div>
    </div>
  );
}
