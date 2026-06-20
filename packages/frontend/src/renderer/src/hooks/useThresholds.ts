import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

export function useThresholds(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["thresholds", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/thresholds", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });
}
