import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

/**
 * Automations for a workspace.
 *
 * Each carries a `nextRunAt` computed by the controller on read, so the UI does
 * not need a cron parser or the workspace timezone to say what is coming up.
 */
export function useAutomations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["automations", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/automations", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
    // Next-run times age in real time; a minute is the scheduler's own tick.
    refetchInterval: 60_000,
  });
}
