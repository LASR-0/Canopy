import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { ChartLayout } from "@canopy/shared-types";

/**
 * Saved metric selections for the Logging page.
 *
 * The route has been DB-backed since the first commit with nothing reading it —
 * this is the screen it was written for. A layout is just a named set of metrics,
 * so "Climate" reopens temperature, humidity and VPD without rebuilding the
 * selection by hand.
 */
export function useChartLayouts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["chart-layouts", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/chart-layouts", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });
}

export function useCreateChartLayout(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Pick<ChartLayout, "name" | "metrics" | "view">) =>
      api("POST /workspaces/:workspaceId/chart-layouts", { params: { workspaceId }, body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["chart-layouts", workspaceId] }),
  });
}

export function useDeleteChartLayout(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api("DELETE /workspaces/:workspaceId/chart-layouts/:id", { params: { workspaceId, id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["chart-layouts", workspaceId] }),
  });
}
