import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { MaintenanceTask } from "@canopy/shared-types";

export function useMaintenance(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["maintenance", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/maintenance", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });
}

/** Tasks due today (nextDueAt <= today's date). */
export function useMaintenanceToday(workspaceId: string | undefined): MaintenanceTask[] {
  const { data } = useMaintenance(workspaceId);
  if (!data) return [];
  const today = new Date().toISOString().slice(0, 10);
  return data.filter((t) => t.nextDueAt && t.nextDueAt.slice(0, 10) <= today);
}

export function useCompleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api("POST /workspaces/:workspaceId/maintenance/:id/complete", {
        params: { workspaceId, id },
        body: { ...(note ? { note } : {}) },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["maintenance", workspaceId] }),
  });
}
