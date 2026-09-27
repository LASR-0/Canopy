import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

/**
 * Polls GET /health every 30 s to determine whether the controller service
 * is reachable. The sidebar footer reads this to show "live" / "offline".
 */
export function useHealthStatus() {
  const { data, isError } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api("GET /health", { signal }),
    refetchInterval: 30_000,
    retry: false,
  });

  return {
    online: !isError && data !== undefined,
    version: data?.version,
    uptimeSec: data?.uptimeSec,
  };
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
