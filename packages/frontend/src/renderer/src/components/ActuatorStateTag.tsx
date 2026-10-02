import { Tip } from "@/components/Tip";
import { actuatorStateLabel } from "@/hooks/useActuatorStates";
import { cn, formatWhen } from "@/lib/utils";
import type { ActuatorState } from "@canopy/shared-types";

/**
 * What an actuator channel last reported: "On", "Off" or a level. Nothing until
 * it has reported, since a guess from the last command would be the one thing
 * this exists to avoid. An offline device's last report is shown faded.
 */
export function ActuatorStateTag({ state, online, label }: {
  state: ActuatorState | undefined;
  online: boolean;
  /** The channel's name, for a device with more than one. */
  label?: string;
}) {
  if (!state) return null;

  const what = `${label ? `${label} ` : ""}${state.on ? "on" : "off"}${state.on && state.level !== undefined ? ` at ${state.level}%` : ""}`;
  const tip = online
    ? `${what} since ${formatWhen(state.since)}, as reported by the device`
    : `${what} when last heard from. The device is offline, so this may have changed`;

  return (
    <Tip content={tip}>
      <span className={cn("act-state", state.on ? "on" : "off", !online && "stale")}>
        {actuatorStateLabel(state)}
      </span>
    </Tip>
  );
}
