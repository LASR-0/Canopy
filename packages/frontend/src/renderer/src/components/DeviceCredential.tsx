import { useState } from "react";
import type { Device } from "@canopy/shared-types";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { CopyValue, NewPasswordButton } from "@/components/BrokerSettings";
import { useDeviceCredential, usePushDeviceCredential, useRegenerateDevicePassword } from "@/hooks/useMqtt";

/** What the card says about how the device connects now. */
function connectionNote(device: Device): string {
  switch (device.mqttAuth) {
    case "device": return "Connects with its own login. It can send only its own readings.";
    case "shared": return "Connects with the shared password. Give it this login to limit it to its own readings.";
    case "anonymous": return "Connects without a password. Give it this login.";
    default: return "Enter this login in the device's MQTT settings.";
  }
}

/**
 * A device's own broker login (Phase 8 G), behind a button on its card: it is
 * fetched only when opened, and created then for a device paired before
 * there were per-device logins. A Shelly can be sent it over its HTTP API.
 */
export function DeviceCredential({ device }: { device: Device }) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const { data: cred, isError } = useDeviceCredential(device.id, open);
  const regenerate = useRegenerateDevicePassword(device.id);
  const push = usePushDeviceCredential(device.id);
  const sending = push.isPending || cred?.push?.state === "sending";

  return (
    <>
      <button className="btn sm dev-cred-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="lock" size={12} />
        Broker login
      </button>
      {open && (
        <div className="dev-cred">
          {isError && <div className="dev-cred-note warn">Could not load its login.</div>}
          {cred && (
            <>
              <div className="dev-cred-note">{connectionNote(device)}</div>
              <div className="dev-cred-row">
                <span className="cap-label">Broker</span>
                {cred.brokerHost ? (
                  <span className="broker-pair">
                    <code className="broker-value">{cred.brokerHost}:{cred.port}</code>
                    <CopyValue value={cred.brokerHost} label="broker address" />
                  </span>
                ) : (
                  <span className="cap-none">no network address</span>
                )}
              </div>
              <div className="dev-cred-row">
                <span className="cap-label">Username</span>
                <span className="broker-pair">
                  <code className="broker-value">{cred.username}</code>
                  <CopyValue value={cred.username} label="username" />
                </span>
              </div>
              <div className="dev-cred-row">
                <span className="cap-label">Password</span>
                <span className="broker-pair">
                  <code className="broker-value">{reveal ? cred.password : "•".repeat(cred.password.length)}</code>
                  <Tip content={reveal ? "Hide" : "Show"}>
                    <button className="btn btn-icon" aria-label={reveal ? "Hide password" : "Show password"} onClick={() => setReveal(!reveal)}>
                      <Icon name="eye" size={13} />
                    </button>
                  </Tip>
                  <CopyValue value={cred.password} label="password" />
                </span>
              </div>
              <div className="dev-cred-actions">
                {cred.canPush && (
                  <button className="btn sm" disabled={sending} onClick={() => push.mutate()}>
                    {sending ? "Sending…" : cred.push?.state === "sent" ? "Send again" : "Send to device"}
                  </button>
                )}
                <NewPasswordButton
                  onConfirm={() => regenerate.mutate()}
                  pending={regenerate.isPending}
                  question="Disconnect this device?"
                />
              </div>
              {cred.push?.state === "sent" && (
                <div className="dev-cred-note">Sent. The device restarts and connects with it.</div>
              )}
              {cred.push?.state === "failed" && <div className="dev-cred-note warn">{cred.push.error}</div>}
            </>
          )}
        </div>
      )}
    </>
  );
}
