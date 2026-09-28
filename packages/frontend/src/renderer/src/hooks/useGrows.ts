import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { GrowCycle } from "@canopy/shared-types";

/** Every grow in the workspace, running or finished. */
export function useGrows(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["grows", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/grows", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });
}

/** The four seeded stage-length presets. Static, so cached indefinitely. */
export function useGrowTemplates() {
  return useQuery({
    queryKey: ["grow-templates"],
    queryFn: ({ signal }) => api("GET /grow-templates", { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Anything that changes a grow invalidates more than the grow itself.
 *
 * Which stage the tent is in decides whether stage-scoped automations run and
 * which threshold band is in force, and `workspace.activeGrowId` moves with the
 * status — so the workspace, the active grow and the automations all have to be
 * re-read. Re-planning matters as much as starting: moving the veg weeks moves
 * the stage boundaries under everything scoped to them.
 */
function invalidateGrowState(qc: ReturnType<typeof useQueryClient>, workspaceId: string) {
  void qc.invalidateQueries({ queryKey: ["grows", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["grow"] });
  void qc.invalidateQueries({ queryKey: ["workspaces"] });
  void qc.invalidateQueries({ queryKey: ["automations", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["thresholds", workspaceId] });
}

export function useCreateGrow(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<GrowCycle>) =>
      api("POST /workspaces/:workspaceId/grows", { params: { workspaceId }, body }),
    onSuccess: () => invalidateGrowState(qc, workspaceId),
  });
}

export function usePatchGrow(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ growId, ...body }: Partial<GrowCycle> & { growId: string }) =>
      api("PATCH /workspaces/:workspaceId/grows/:growId", {
        params: { workspaceId, growId },
        body,
      }),
    onSuccess: () => invalidateGrowState(qc, workspaceId),
  });
}
