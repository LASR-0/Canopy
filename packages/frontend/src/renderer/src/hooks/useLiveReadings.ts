import { useEffect, useRef, useState } from "react";
import { wsManager } from "@/lib/ws";
import { api } from "@/lib/http";
import type { Reading } from "@canopy/shared-types";

export type ReadingKey = `${string}:${string}`; // `${deviceId}:${channel}`

export type ReadingsMap = Map<ReadingKey, Reading>;

/**
 * Subscribes to the workspace WS channel and maintains a map of the latest
 * reading per (deviceId, channel). Hydrates from the REST snapshot on mount
 * so cards are never blank while waiting for the first live push.
 */
export function useLiveReadings(workspaceId: string | undefined): ReadingsMap {
  const [map, setMap] = useState<ReadingsMap>(new Map());
  const mapRef = useRef<ReadingsMap>(new Map());

  useEffect(() => {
    if (!workspaceId) return;

    // Hydrate from snapshot
    api("GET /workspaces/:workspaceId/readings/latest", {
      params: { workspaceId },
    }).then((readings) => {
      const next = new Map(mapRef.current);
      for (const r of readings) {
        next.set(`${r.deviceId}:${r.channel}`, r);
      }
      mapRef.current = next;
      setMap(next);
    }).catch(() => { /* backend may have no readings yet */ });

    // Subscribe to live stream
    const unsub = wsManager.subscribe((msg) => {
      if (msg.type !== "reading") return;
      const r = msg.payload;
      if (r.workspaceId !== workspaceId) return;
      const next = new Map(mapRef.current);
      next.set(`${r.deviceId}:${r.channel}`, r);
      mapRef.current = next;
      setMap(next);
    });

    return unsub;
  }, [workspaceId]);

  return map;
}
