import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { AlertBehaviour, Metric, SensorThreshold } from "@canopy/shared-types";

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

/**
 * Create or update a target band.
 *
 * The route is a single `PUT` that upserts, so a new band is written by PUTting a
 * fresh id — there is no separate create. It also refreshes the controller's
 * cached copy, which is what makes a band you just moved apply to the next
 * reading rather than the next restart.
 */
export function useSaveThreshold(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SensorThreshold) =>
      api("PUT /workspaces/:workspaceId/thresholds/:id", {
        params: { workspaceId, id },
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thresholds", workspaceId] });
      // The Overview colours its cards from these, so its status dots are stale
      // until the bands are re-read.
      void qc.invalidateQueries({ queryKey: ["readings", workspaceId] });
    },
  });
}

/** Remove a band — for a stage override, "clear override"; the default applies again. */
export function useDeleteThreshold(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api("DELETE /workspaces/:workspaceId/thresholds/:id", { params: { workspaceId, id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thresholds", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["readings", workspaceId] });
    },
  });
}

/** Per-metric alert behaviour. Only metrics that differ from the default have a row. */
export function useThresholdAlerts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["threshold-alerts", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/threshold-alerts", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
  });
}

export function useSaveAlertSetting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ metric, ...body }: Partial<AlertBehaviour> & { metric: Metric }) =>
      api("PUT /workspaces/:workspaceId/threshold-alerts/:metric", { params: { workspaceId, metric }, body }),
    // The warning margin changes what the Overview's cards call "drifting".
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["threshold-alerts", workspaceId] }),
  });
}

export function useResetAlertSetting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (metric: Metric) =>
      api("DELETE /workspaces/:workspaceId/threshold-alerts/:metric", { params: { workspaceId, metric } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["threshold-alerts", workspaceId] }),
  });
}
