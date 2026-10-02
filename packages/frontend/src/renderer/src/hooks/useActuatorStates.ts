import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { wsManager } from "@/lib/ws";
import { api } from "@/lib/http";
import type { ActuatorState } from "@canopy/shared-types";

/** `${deviceId}:${channel}` */
export type ActuatorKey = `${string}:${string}`;

export type ActuatorStatesMap = Map<ActuatorKey, ActuatorState>;

export const actuatorKey = (deviceId: string, channel: string): ActuatorKey => `${deviceId}:${channel}`;

/**
 * What each actuator channel in a workspace last reported, live.
 *
 * Built like `useLiveReadings`: the REST snapshot under its own query key, so
 * the titlebar's Refresh refetches it, with the websocket's pushes on top. The
 * controller pushes a state only when it changes, so the two are reconciled by
 * `since`, newest first, rather than by which arrived last: a snapshot answered
 * just before a push would otherwise overwrite it with the older state.
 */
export function useActuatorStates(workspaceId: string | undefined): ActuatorStatesMap {
  const { data: snapshot } = useQuery({
    queryKey: ["actuator-states", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/actuators/state", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });

  const [live, setLive] = useState<ActuatorStatesMap>(new Map());

  useEffect(() => {
    setLive(new Map());
    if (!workspaceId) return;

    return wsManager.subscribe((msg) => {
      if (msg.type !== "actuator.state") return;
      const state = msg.payload;
      if (state.workspaceId !== workspaceId) return;

      setLive((prev) => new Map(prev).set(actuatorKey(state.deviceId, state.channel), state));
    });
  }, [workspaceId]);

  return useMemo(() => {
    const merged: ActuatorStatesMap = new Map();
    for (const state of snapshot ?? []) merged.set(actuatorKey(state.deviceId, state.channel), state);
    for (const [key, state] of live) {
      const held = merged.get(key);
      if (!held || state.since >= held.since) merged.set(key, state);
    }
    return merged;
  }, [snapshot, live]);
}

/** "On", "Off", or a dimmer's "40%". */
export function actuatorStateLabel(state: ActuatorState): string {
  if (!state.on) return "Off";
  return state.level !== undefined ? `${state.level}%` : "On";
}
