import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMqttBroker, usePatchMqttBroker, useRegenerateMqttPassword } from "@/hooks/useMqtt";

const ALL = "0.0.0.0";

export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Tip content={copied ? "Copied" : `Copy ${label}`}>
      <button
        className="btn btn-icon"
        aria-label={`Copy ${label}`}
        onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
      >
        <Icon name={copied ? "check" : "copy"} size={13} />
      </button>
    </Tip>
  );
}

/**
 * A new password disconnects the devices on the old one until they are given
 * it, so the first click only asks, and the question stands for five seconds.
 */
export function NewPasswordButton({ onConfirm, pending, question = "Disconnect every device?" }: {
  onConfirm: () => void;
  pending: boolean;
  question?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      className="btn sm"
      disabled={pending}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? question : "New password"}
    </button>
  );
}

/**
 * Settings → Device connections: what a device needs to connect to Canopy's
 * MQTT broker, and who may connect without it (Phase 8 F).
 */
export function BrokerSettings() {
  const { data: broker } = useMqttBroker();
  const patch = usePatchMqttBroker();
  const regenerate = useRegenerateMqttPassword();
  const [reveal, setReveal] = useState(false);

  if (!broker) return null;

  const addresses = broker.interfaces.filter((i) => i.family === "IPv4");
  const without = broker.devicesWithoutCredential;
  const onShared = broker.devicesOnShared;
  const listenValue = broker.bind.setting ?? ALL;

  return (
    <div className="box">
      <div className="auto-list">
        <div className="auto-row">
          <div className="auto-meta">
            <div className="auto-name">Broker address</div>
            <div className="auto-desc">Enter this in each device's MQTT settings</div>
          </div>
          <div className="broker-values">
            {addresses.length === 0 && <span className="broker-value">no network address</span>}
            {addresses.map((i) => (
              <span key={i.address} className="broker-pair">
                <code className="broker-value">{i.address}:{broker.port}</code>
                <CopyValue value={i.address} label={`address ${i.address}`} />
              </span>
            ))}
          </div>
        </div>

        <div className="auto-row">
          <div className="auto-meta">
            <div className="auto-name">Shared username</div>
          </div>
          <span className="broker-pair">
            <code className="broker-value">{broker.username}</code>
            <CopyValue value={broker.username} label="username" />
          </span>
        </div>

        <div className="auto-row">
          <div className="auto-meta">
            <div className="auto-name">Password</div>
            <div className="auto-desc">Any device may use it. Each device also has its own, on its card.</div>
          </div>
          <span className="broker-pair">
            <code className="broker-value">{reveal ? broker.password : "•".repeat(broker.password.length)}</code>
            <Tip content={reveal ? "Hide" : "Show"}>
              <button className="btn btn-icon" aria-label={reveal ? "Hide password" : "Show password"} onClick={() => setReveal(!reveal)}>
                <Icon name="eye" size={13} />
              </button>
            </Tip>
            <CopyValue value={broker.password} label="password" />
            <NewPasswordButton onConfirm={() => regenerate.mutate()} pending={regenerate.isPending} />
          </span>
        </div>

        <div className="auto-row">
          <div className="auto-meta">
            <div className="auto-name">Require the password</div>
            <div className="auto-desc">
              {broker.requireCredentials
                ? "A device without it can connect only during a scan, to be found."
                : "Anything on your network can connect and send readings."}
            </div>
          </div>
          <Switch
            checked={broker.requireCredentials}
            disabled={patch.isPending}
            onCheckedChange={(on) => patch.mutate({ requireCredentials: on })}
          />
        </div>

        {without.length > 0 && (
          <div className="broker-note warn">
            <Icon name="alert" size={14} />
            <span>
              {without.length === 1 ? "1 device still connects" : `${without.length} devices still connect`} without the password:{" "}
              <b>{without.map((d) => d.name).join(", ")}</b>.{" "}
              {broker.requireCredentials
                ? "They stay offline until they are given it."
                : "Give them the username and password before you require it, or they go offline."}
            </span>
          </div>
        )}

        {onShared.length > 0 && (
          <div className="broker-note">
            <Icon name="lock" size={14} />
            <span>
              {onShared.length === 1 ? "1 device connects" : `${onShared.length} devices connect`} with this shared password:{" "}
              <b>{onShared.map((d) => d.name).join(", ")}</b>. Give each its own, from its card, to limit it to its own readings.
            </span>
          </div>
        )}

        <details className="broker-advanced">
          <summary>Advanced</summary>
          <div className="auto-row">
            <div className="auto-meta">
              <div className="auto-name">Listen on</div>
              <div className="auto-desc">
                {broker.bind.envOverride
                  ? `Set to ${broker.bind.envOverride} by MQTT_HOST, which overrides this`
                  : "Narrow it to the network your devices are on. Every device reconnects when it changes."}
              </div>
            </div>
            <Select
              value={listenValue}
              disabled={!!broker.bind.envOverride || patch.isPending}
              onValueChange={(value) => patch.mutate({ bindHost: value === ALL ? null : value })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Every interface</SelectItem>
                {broker.interfaces.map((i) => (
                  <SelectItem key={i.address} value={i.address}>{i.name} · {i.address}</SelectItem>
                ))}
                {/* Still selectable after it disappears, so the select shows what was asked for. */}
                {broker.bind.setting && !broker.interfaces.some((i) => i.address === broker.bind.setting) && (
                  <SelectItem value={broker.bind.setting}>{broker.bind.setting} (not on this machine)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          {broker.bind.unavailable && (
            <div className="broker-note warn">
              <Icon name="alert" size={14} />
              <span>{broker.bind.unavailable} is not an address on this machine any more, so the broker is listening on every interface.</span>
            </div>
          )}
        </details>

        <div className="broker-note">
          <Icon name="lock" size={14} />
          <span>The password crosses your network unencrypted, so keep devices on a network you trust. Encryption comes in a later version.</span>
        </div>
      </div>
    </div>
  );
}
