import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { Workspace, AppSettings } from "@canopy/shared-types";

/** The live workspaces: not archived, not in Recently deleted. */
export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: ({ signal }) => api("GET /workspaces", { signal }),
  });
}

/** Fetch global app settings (includes activeWorkspaceId). */
export function useAppSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => api("GET /settings", { signal }),
  });
}

/** Return the currently active workspace. */
export function useActiveWorkspace(): Workspace | undefined {
  const { data: workspaces } = useWorkspaces();
  const { data: settings } = useAppSettings();

  if (!workspaces || !settings) return undefined;
  if (settings.activeWorkspaceId) {
    return workspaces.find((w) => w.id === settings.activeWorkspaceId);
  }
  return workspaces[0];
}

/** Patch the active workspace (name, timezone, dimensions). */
export function usePatchWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<Workspace, "name" | "timezone" | "dimensions" | "growLight">>) =>
      api("PATCH /workspaces/:workspaceId", { params: { workspaceId }, body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      // A resize moves everything in the tent proportionally on the server.
      void qc.invalidateQueries({ queryKey: ["layout", workspaceId] });
      // The timezone and grow light decide DLI's days and its lux conversion.
      void qc.invalidateQueries({ queryKey: ["series", workspaceId, "dli"] });
    },
  });
}

/** Create a new workspace and immediately switch to it. */
export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api("POST /workspaces", { body: { name } }),
    onSuccess: async (newWs) => {
      // Optimistically add to list and switch active
      qc.setQueryData<Workspace[]>(["workspaces"], (old) => [...(old ?? []), newWs]);
      qc.setQueryData<AppSettings>(["settings"], (old) =>
        old ? { ...old, activeWorkspaceId: newWs.id } : old,
      );
      await api("PATCH /settings", { body: { activeWorkspaceId: newWs.id } });
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

/** Archived and recently deleted workspaces. Under ["workspaces"], so every change to the list refreshes it. */
export function useStoredWorkspaces() {
  return useQuery({
    queryKey: ["workspaces", "stored"],
    queryFn: ({ signal }) => api("GET /workspaces/stored", { signal }),
  });
}

/**
 * Put a workspace away: archive it, or move it to Recently deleted. Either way
 * it leaves the live list at once, and if it was the active one the app moves
 * to another, as the controller does.
 */
function usePutAwayWorkspace(send: (workspaceId: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: async (workspaceId) => {
      await qc.cancelQueries({ queryKey: ["workspaces"] });
      const prevWorkspaces = qc.getQueryData<Workspace[]>(["workspaces"]);
      const prevSettings = qc.getQueryData<AppSettings>(["settings"]);
      const remaining = (prevWorkspaces ?? []).filter((w) => w.id !== workspaceId);
      qc.setQueryData<Workspace[]>(["workspaces"], remaining);
      if (prevSettings?.activeWorkspaceId === workspaceId) {
        qc.setQueryData<AppSettings>(["settings"], (old) => {
          if (!old) return old;
          const nextId = remaining[0]?.id;
          // `activeWorkspaceId` is optional, not nullable, and the API omits it
          // when unset — so drop the key rather than writing null/undefined,
          // which `exactOptionalPropertyTypes` forbids.
          if (nextId === undefined) {
            const { activeWorkspaceId: _dropped, ...rest } = old;
            return rest;
          }
          return { ...old, activeWorkspaceId: nextId };
        });
      }
      return { prevWorkspaces, prevSettings };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevWorkspaces) qc.setQueryData(["workspaces"], ctx.prevWorkspaces);
      if (ctx?.prevSettings) qc.setQueryData(["settings"], ctx.prevSettings);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

/** Archive: put away indefinitely, restorable at any time. */
export function useArchiveWorkspace() {
  return usePutAwayWorkspace((workspaceId) =>
    api("POST /workspaces/:workspaceId/archive", { params: { workspaceId } }));
}

/** Delete: into Recently deleted, restorable for 7 days. */
export function useDeleteWorkspace() {
  return usePutAwayWorkspace((workspaceId) =>
    api("DELETE /workspaces/:workspaceId", { params: { workspaceId } }));
}

/** Back to live, from archived or Recently deleted. */
export function useRestoreWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api("POST /workspaces/:workspaceId/restore", { params: { workspaceId } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      // A restored device may have come back detached.
      void qc.invalidateQueries({ queryKey: ["devices"] });
    },
  });
}

/** From Recently deleted, for good, now. */
export function usePurgeWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      api("DELETE /workspaces/:workspaceId/permanent", { params: { workspaceId } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

/** Switch the active workspace (optimistic). */
export function useSetActiveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (activeWorkspaceId: string) =>
      api("PATCH /settings", { body: { activeWorkspaceId } }),
    onMutate: (activeWorkspaceId) => {
      const previous = qc.getQueryData(["settings"]);
      qc.setQueryData<AppSettings>(["settings"], (old) =>
        old ? { ...old, activeWorkspaceId } : old,
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(["settings"], ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
