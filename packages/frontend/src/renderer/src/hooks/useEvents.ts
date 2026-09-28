import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

/**
 * Timeline events, newest first.
 *
 * `limit` is part of the query key as well as the request. It was previously
 * neither: the parameter was declared, never sent, and left out of the key — so
 * every caller silently got the route's default of 50 and shared one cache entry
 * regardless of how many it asked for.
 */
export function useEvents(workspaceId: string | undefined, limit = 30) {
  return useQuery({
    queryKey: ["events", workspaceId, limit],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/events", {
        params: { workspaceId: workspaceId! },
        query: { limit },
        signal,
      }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
}
