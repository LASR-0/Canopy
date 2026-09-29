import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { PlaceDeviceBody, PlantBody, WorkspaceLayout } from "@canopy/shared-types";

const layoutKey = (workspaceId: string | undefined) => ["layout", workspaceId] as const;

/** Everything placed in the workspace's tent: device placements and plants. */
export function useLayout(workspaceId: string | undefined) {
  return useQuery({
    queryKey: layoutKey(workspaceId),
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/layout", { params: { workspaceId: workspaceId! }, signal }),
    enabled: !!workspaceId,
  });
}

/**
 * Apply an edit to the cached layout before the server answers.
 *
 * Dragging a pin commits on release, and without this the pin would snap back
 * to its old spot for the length of the round trip and then jump forward.
 */
function useOptimistic(workspaceId: string) {
  const qc = useQueryClient();
  return {
    apply: async (edit: (layout: WorkspaceLayout) => WorkspaceLayout) => {
      await qc.cancelQueries({ queryKey: layoutKey(workspaceId) });
      const previous = qc.getQueryData<WorkspaceLayout>(layoutKey(workspaceId));
      if (previous) qc.setQueryData(layoutKey(workspaceId), edit(previous));
      return { previous };
    },
    rollback: (context: { previous?: WorkspaceLayout | undefined } | undefined) => {
      if (context?.previous) qc.setQueryData(layoutKey(workspaceId), context.previous);
    },
    settle: () => void qc.invalidateQueries({ queryKey: layoutKey(workspaceId) }),
  };
}

export function usePlaceDevice(workspaceId: string) {
  const o = useOptimistic(workspaceId);
  return useMutation({
    mutationFn: ({ deviceId, ...body }: PlaceDeviceBody & { deviceId: string }) =>
      api("PUT /workspaces/:workspaceId/placements/:deviceId", { params: { workspaceId, deviceId }, body }),
    onMutate: ({ deviceId, ...body }) =>
      o.apply((layout) => {
        const existing = layout.placements.find((p) => p.deviceId === deviceId);
        // A new placement is left to the server, which picks its defaults.
        if (!existing) return layout;
        return {
          ...layout,
          placements: layout.placements.map((p) => (p.deviceId === deviceId ? { ...p, ...body } : p)),
        };
      }),
    onError: (_e, _v, context) => o.rollback(context),
    onSettled: o.settle,
  });
}

export function useUnplaceDevice(workspaceId: string) {
  const o = useOptimistic(workspaceId);
  return useMutation({
    mutationFn: (deviceId: string) =>
      api("DELETE /workspaces/:workspaceId/placements/:deviceId", { params: { workspaceId, deviceId } }),
    onMutate: (deviceId) =>
      o.apply((layout) => ({ ...layout, placements: layout.placements.filter((p) => p.deviceId !== deviceId) })),
    onError: (_e, _v, context) => o.rollback(context),
    onSettled: o.settle,
  });
}

export function useAddPlant(workspaceId: string) {
  const o = useOptimistic(workspaceId);
  return useMutation({
    mutationFn: (body: PlantBody) =>
      api("POST /workspaces/:workspaceId/plants", { params: { workspaceId }, body }),
    onSettled: o.settle,
  });
}

export function useUpdatePlant(workspaceId: string) {
  const o = useOptimistic(workspaceId);
  return useMutation({
    mutationFn: ({ plantId, ...body }: PlantBody & { plantId: string }) =>
      api("PATCH /workspaces/:workspaceId/plants/:plantId", { params: { workspaceId, plantId }, body }),
    onMutate: ({ plantId, ...body }) =>
      o.apply((layout) => ({
        ...layout,
        plants: layout.plants.map((p) => {
          if (p.id !== plantId) return p;
          const { label, ...rest } = body;
          const next = { ...p, ...rest };
          if (label !== undefined) {
            if (label.trim()) next.label = label.trim();
            else delete next.label;
          }
          return next;
        }),
      })),
    onError: (_e, _v, context) => o.rollback(context),
    onSettled: o.settle,
  });
}

export function useRemovePlant(workspaceId: string) {
  const o = useOptimistic(workspaceId);
  return useMutation({
    mutationFn: (plantId: string) =>
      api("DELETE /workspaces/:workspaceId/plants/:plantId", { params: { workspaceId, plantId } }),
    onMutate: (plantId) => o.apply((layout) => ({ ...layout, plants: layout.plants.filter((p) => p.id !== plantId) })),
    onError: (_e, _v, context) => o.rollback(context),
    onSettled: o.settle,
  });
}
