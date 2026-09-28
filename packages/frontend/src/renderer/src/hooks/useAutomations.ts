import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { Automation, AutomationPatch } from "@canopy/shared-types";

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

/**
 * Writes all invalidate the one list query.
 *
 * The controller re-arms its rule cache on every automation write and
 * recomputes `nextRunAt` on every read, so refetching the list is what makes a
 * saved change visible — there is nothing worth patching in locally that the
 * server would not immediately contradict.
 */
function useAutomationMutation<TArgs>(
  workspaceId: string,
  mutationFn: (args: TArgs) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["automations", workspaceId] }),
  });
}

export function useCreateAutomation(workspaceId: string) {
  return useAutomationMutation(workspaceId, (body: Partial<Automation>) =>
    api("POST /workspaces/:workspaceId/automations", { params: { workspaceId }, body }),
  );
}

export function useUpdateAutomation(workspaceId: string) {
  return useAutomationMutation(
    workspaceId,
    ({ id, ...patch }: AutomationPatch & { id: string }) =>
      api("PATCH /workspaces/:workspaceId/automations/:id", {
        params: { workspaceId, id },
        body: patch,
      }),
  );
}

export function useDeleteAutomation(workspaceId: string) {
  return useAutomationMutation(workspaceId, (id: string) =>
    api("DELETE /workspaces/:workspaceId/automations/:id", { params: { workspaceId, id } }),
  );
}
