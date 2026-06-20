import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

export function useEvents(workspaceId: string | undefined, limit = 30) {
  return useQuery({
    queryKey: ["events", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/events", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
}
