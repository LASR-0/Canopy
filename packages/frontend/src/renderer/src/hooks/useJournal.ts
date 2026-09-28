import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { GrowMilestone, JournalEntry } from "@canopy/shared-types";

/** A grow's notebook, newest first. */
export function useJournal(workspaceId: string | undefined, growId: string | undefined) {
  return useQuery({
    queryKey: ["journal", workspaceId, growId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/grows/:growId/journal", {
        params: { workspaceId: workspaceId!, growId: growId! },
        signal,
      }),
    enabled: !!workspaceId && !!growId,
  });
}

/** A grow's milestones, in day order. */
export function useMilestones(workspaceId: string | undefined, growId: string | undefined) {
  return useQuery({
    queryKey: ["milestones", workspaceId, growId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/grows/:growId/milestones", {
        params: { workspaceId: workspaceId!, growId: growId! },
        signal,
      }),
    enabled: !!workspaceId && !!growId,
  });
}

export function useCreateEntry(workspaceId: string, growId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<JournalEntry>) =>
      api("POST /workspaces/:workspaceId/grows/:growId/journal", {
        params: { workspaceId, growId },
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal", workspaceId, growId] }),
  });
}

export function useUpdateEntry(workspaceId: string, growId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<JournalEntry> & { id: string }) =>
      api("PATCH /workspaces/:workspaceId/grows/:growId/journal/:id", {
        params: { workspaceId, growId, id },
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal", workspaceId, growId] }),
  });
}

export function useDeleteEntry(workspaceId: string, growId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api("DELETE /workspaces/:workspaceId/grows/:growId/journal/:id", {
        params: { workspaceId, growId, id },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal", workspaceId, growId] }),
  });
}

export function useCreateMilestone(workspaceId: string, growId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Pick<GrowMilestone, "label" | "day">) =>
      api("POST /workspaces/:workspaceId/grows/:growId/milestones", {
        params: { workspaceId, growId },
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["milestones", workspaceId, growId] }),
  });
}

export function useUpdateMilestone(workspaceId: string, growId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<GrowMilestone> & { id: string }) =>
      api("PATCH /workspaces/:workspaceId/grows/:growId/milestones/:id", {
        params: { workspaceId, growId, id },
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["milestones", workspaceId, growId] }),
  });
}

export function useDeleteMilestone(workspaceId: string, growId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api("DELETE /workspaces/:workspaceId/grows/:growId/milestones/:id", {
        params: { workspaceId, growId, id },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["milestones", workspaceId, growId] }),
  });
}
