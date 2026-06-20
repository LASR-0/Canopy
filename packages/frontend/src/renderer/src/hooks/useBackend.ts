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
