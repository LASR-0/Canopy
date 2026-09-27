import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { MaintenanceTask, MaintenanceCompletion } from "@canopy/shared-types";

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

/**
 * Completion history, newest first.
 *
 * Separate from the task list because a task only carries its *last*
 * completion: anything done twice, or skipped, is invisible there.
 */
export function useMaintenanceHistory(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["maintenance-history", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/maintenance/completions", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });
}

/** Local date, not UTC — "due today" means the grower's today. */
export function localDateKey(at: Date = new Date()): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** Tasks due on or before today. */
export function useMaintenanceToday(workspaceId: string | undefined): MaintenanceTask[] {
  const { data } = useMaintenance(workspaceId);
  if (!data) return [];
  const today = localDateKey();
  return data.filter((t) => t.nextDueAt && t.nextDueAt.slice(0, 10) <= today);
}

/** True when the task's last completion falls on today's date. */
export function isDoneToday(task: MaintenanceTask): boolean {
  if (!task.lastDoneAt) return false;
  return localDateKey(new Date(task.lastDoneAt)) === localDateKey();
}

/** True when the task fell due before today and has not been dealt with since. */
export function isOverdue(task: MaintenanceTask): boolean {
  if (!task.nextDueAt || isDoneToday(task)) return false;
  return task.nextDueAt.slice(0, 10) < localDateKey();
}

/** Every maintenance query that a write can invalidate. */
function invalidateAll(qc: ReturnType<typeof useQueryClient>, workspaceId: string) {
  void qc.invalidateQueries({ queryKey: ["maintenance", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["maintenance-history", workspaceId] });
}

export function useCompleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api("POST /workspaces/:workspaceId/maintenance/:id/complete", {
        params: { workspaceId, id },
        body: { ...(note ? { note } : {}) },
      }),
    onSuccess: () => invalidateAll(qc, workspaceId),
  });
}

export function useSkipTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api("POST /workspaces/:workspaceId/maintenance/:id/skip", {
        params: { workspaceId, id },
        body: { ...(note ? { note } : {}) },
      }),
    onSuccess: () => invalidateAll(qc, workspaceId),
  });
}

export function useCreateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: Partial<MaintenanceTask>) =>
      api("POST /workspaces/:workspaceId/maintenance", { params: { workspaceId }, body: task }),
    onSuccess: () => invalidateAll(qc, workspaceId),
  });
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<MaintenanceTask> & { id: string }) =>
      api("PATCH /workspaces/:workspaceId/maintenance/:id", {
        params: { workspaceId, id },
        body: patch,
      }),
    onSuccess: () => invalidateAll(qc, workspaceId),
  });
}

export function useDeleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api("DELETE /workspaces/:workspaceId/maintenance/:id", { params: { workspaceId, id } }),
    onSuccess: () => invalidateAll(qc, workspaceId),
  });
}

export type { MaintenanceCompletion };
