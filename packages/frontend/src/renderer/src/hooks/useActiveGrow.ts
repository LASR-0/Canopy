import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { useActiveWorkspace } from "./useWorkspace";

export function useActiveGrow() {
  const workspace = useActiveWorkspace();
  const growId = workspace?.activeGrowId;

  return useQuery({
    queryKey: ["grow", growId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/grows/:growId", {
        params: { workspaceId: workspace!.id, growId: growId! },
        signal,
      }),
    enabled: !!workspace && !!growId,
  });
}
