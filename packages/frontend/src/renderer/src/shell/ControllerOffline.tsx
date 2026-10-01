import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { BACKEND_URL } from "@/lib/http";

interface Step {
  label: string;
  command: string;
}

/**
 * How to check on the controller from here. The window never starts it: the
 * controller is an OS service the window does not own, and starting one
 * needs privileges the window deliberately does not have.
 */
function steps(): { intro: string; steps: Step[] } {
  // Run from the repo, the controller is `pnpm dev`'s other half, not a service.
  if (import.meta.env.DEV) {
    return {
      intro: "This is a development build, so the controller runs from the repo rather than as a service.",
      steps: [
        { label: "Start it", command: "pnpm dev:backend" },
        { label: "Or both halves", command: "pnpm dev" },
      ],
    };
  }
  switch (window.canopyWindow.platform) {
    case "linux":
      return {
        intro: "It runs as the systemd service canopy.",
        steps: [
          { label: "Check it", command: "systemctl status canopy" },
          { label: "Start it", command: "sudo systemctl start canopy" },
          { label: "Read its log", command: "journalctl -u canopy -n 50" },
        ],
      };
    case "win32":
      return {
        intro: "It runs as the Windows service Canopy. Start it from Services, or from an administrator PowerShell.",
        steps: [
          { label: "Check it", command: "Get-Service Canopy" },
          { label: "Start it", command: "Start-Service Canopy" },
        ],
      };
    default:
      return { intro: "It runs as a system service, separately from this window.", steps: [] };
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Tip content={copied ? "Copied" : "Copy"}>
      <button
        className="btn btn-icon"
        aria-label={`Copy ${text}`}
        onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
      </button>
    </Tip>
  );
}

/**
 * Shown in place of the page while the controller does not answer.
 *
 * Without it every page falls back to its empty state, which is wrong in a
 * way that misleads: "No workspace selected, create one" or "No devices
 * connected yet", when the workspace and the devices are there and only the
 * controller holding them is out of reach.
 */
export function ControllerOffline({ checking, onRecheck }: { checking: boolean; onRecheck: () => void }) {
  const { intro, steps: list } = steps();
  const address = new URL(BACKEND_URL).host;
  // Only a check someone asked for says so. The background poll runs every
  // few seconds, and flashing "Checking…" each time would be noise.
  const [asked, setAsked] = useState(false);
  useEffect(() => { if (!checking) setAsked(false); }, [checking]);

  return (
    <div className="empty">
      <div className="empty-inner offline">
        <div className="empty-ico">
          <Icon name="power" size={28} />
        </div>
        <h2>The controller isn't answering</h2>
        <p>
          The controller is the service that runs your devices, schedules and rules, whether or
          not this window is open. Canopy can't reach it at <span className="offline-addr">{address}</span>.
          While it is stopped, nothing is being automated.
        </p>
        <p className="offline-intro">{intro}</p>

        {list.length > 0 && (
          <div className="offline-steps">
            {list.map((step) => (
              <div key={step.command} className="offline-step">
                <span className="offline-label">{step.label}</span>
                <code>{step.command}</code>
                <CopyButton text={step.command} />
              </div>
            ))}
          </div>
        )}

        <div className="offline-foot">
          <span>{asked ? "Checking…" : "Checking again every few seconds"}</span>
          <button className="btn sm" onClick={() => { setAsked(true); onRecheck(); }} disabled={asked}>
            <Icon name="refresh" size={13} /> Check now
          </button>
        </div>
      </div>
    </div>
  );
}
