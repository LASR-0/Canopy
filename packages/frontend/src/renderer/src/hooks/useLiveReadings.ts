import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { wsManager } from "@/lib/ws";
import { api } from "@/lib/http";
import type { Reading } from "@canopy/shared-types";

export type ReadingKey = `${string}:${string}`; // `${deviceId}:${channel}`

export type ReadingsMap = Map<ReadingKey, Reading>;

function keyOf(reading: Reading): ReadingKey {
  return `${reading.deviceId}:${reading.channel}`;
}

/**
 * The latest reading per (deviceId, channel) for a workspace.
 *
 * Two sources, merged: the REST snapshot, so cards are never blank while
 * waiting for the first live push, and the websocket stream on top of it.
 *
 * The snapshot is held in the query cache under `["readings", workspaceId]`
 * rather than in local state. That is deliberate on both counts:
 *
 *  - **Switching workspace.** This hook previously accumulated into a ref that
 *    nothing cleared, so selecting a second tent merged its readings into the
 *    first tent's map — and if the new tent had no readings at all, the fetch
 *    returned nothing to merge and the old tent's sensors simply stayed on
 *    screen. Only a remount cleared it, which is why navigating away and back
 *    showed the correct empty state.
 *  - **Recovering a dropped socket.** The Overview's refresh button invalidates
 *    this exact key. While the snapshot lived in local state the key matched
 *    nothing, so the button could not refetch the readings it claimed to — and
 *    after a dropped socket the numbers could not be recovered without
 *    reopening the app.
 *
 * Live pushes and snapshot rows are reconciled **by `ts`, not by precedence**.
 * Neither source is reliably newer: a push beats a snapshot taken before it, and
 * a refetch beats a push left stale by a socket that dropped.
 */
export function useLiveReadings(workspaceId: string | undefined): ReadingsMap {
  const { data: snapshot } = useQuery({
    queryKey: ["readings", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/readings/latest", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });

  const [live, setLive] = useState<ReadingsMap>(new Map());

  useEffect(() => {
    // Discard the previous workspace's pushes before taking any for this one.
    setLive(new Map());
    if (!workspaceId) return;

    return wsManager.subscribe((msg) => {
      if (msg.type !== "reading") return;
      const reading = msg.payload;
      if (reading.workspaceId !== workspaceId) return;

      setLive((prev) => {
        const next = new Map(prev);
        next.set(keyOf(reading), reading);
        return next;
      });
    });
  }, [workspaceId]);

  return useMemo(() => {
    const merged: ReadingsMap = new Map();

    for (const reading of snapshot ?? []) merged.set(keyOf(reading), reading);

    for (const [key, reading] of live) {
      const existing = merged.get(key);
      if (!existing || reading.ts >= existing.ts) merged.set(key, reading);
    }

    return merged;
  }, [snapshot, live]);
}
