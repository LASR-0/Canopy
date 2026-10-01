import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { wsManager } from "@/lib/ws";

/**
 * How often /health is polled. Slowly while the controller answers; quickly
 * while it does not, because the usual reason is a service restarting (after
 * an upgrade, say) and the window should come back within seconds of it.
 */
const ONLINE_POLL_MS = 30_000;
const OFFLINE_POLL_MS = 3_000;

/**
 * Polls GET /health to determine whether the controller service is
 * reachable. `online` and `offline` are both false until the first answer.
 */
export function useHealthStatus() {
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api("GET /health", { signal }),
    refetchInterval: (query) => (query.state.status === "error" ? OFFLINE_POLL_MS : ONLINE_POLL_MS),
    retry: false,
  });

  return {
    online: !isError && data !== undefined,
    offline: isError,
    checking: isFetching,
    recheck: () => void refetch(),
    version: data?.version,
    uptimeSec: data?.uptimeSec,
  };
}

/**
 * The window's connection to the controller. Mounted once, by the shell.
 *
 * - Opens the live stream at start: every page's live data rides on it.
 * - A dropped or restored socket re-checks health at once, rather than at the
 *   next poll, which may be 30 s away.
 * - Coming back online refetches everything, so a page does not stay on the
 *   errors it got while the controller was gone.
 */
export function useControllerConnection(): { online: boolean; offline: boolean; checking: boolean; recheck: () => void } {
  const qc = useQueryClient();
  const health = useHealthStatus();

  useEffect(() => { wsManager.connect(); }, []);

  useEffect(
    () => wsManager.onConnectionChange(() => void qc.invalidateQueries({ queryKey: ["health"] })),
    [qc],
  );

  const wasOffline = useRef(false);
  useEffect(() => {
    if (health.offline) {
      wasOffline.current = true;
    } else if (health.online && wasOffline.current) {
      wasOffline.current = false;
      void qc.invalidateQueries();
    }
  }, [health.offline, health.online, qc]);

  return health;
}

/**
 * Controller status: lifecycle state, broker liveness, device count, uptime.
 *
 * Separate from the health probe above, which only answers "is it reachable".
 * Polled on the scheduler's own cadence, since uptime is the only value that
 * moves continuously.
 */
export function useControllerStatus() {
  return useQuery({
    queryKey: ["controller-status"],
    queryFn: ({ signal }) => api("GET /controller/status", { signal }),
    refetchInterval: 60_000,
    retry: false,
  });
}
