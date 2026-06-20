import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { wsManager } from "@/lib/ws";
import { useEffect, useState } from "react";
import type { Device, RoleAssignment } from "@canopy/shared-types";

/** Fetch all devices for the given workspace. */
export function useDevices(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["devices", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/devices", { signal, params: { workspaceId: workspaceId! } }),
    enabled: !!workspaceId,
  });
}

/** Fetch all role assignments for the given workspace. */
export function useRoles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["roles", workspaceId],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/roles" as never, { signal, params: { workspaceId: workspaceId! } } as never) as Promise<RoleAssignment[]>,
    enabled: !!workspaceId,
  });
}

/** Assign a role to a device capability. */
export function useAssignRole(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { role: RoleAssignment["role"]; deviceId: string; channel: string }) =>
      api("POST /workspaces/:workspaceId/roles", { params: { workspaceId }, body }),
    onMutate: (body) => {
      const previous = qc.getQueryData(["roles", workspaceId]);
      qc.setQueryData(["roles", workspaceId], (old: RoleAssignment[] | undefined) => {
        if (!old) return old;
        const without = old.filter((r) => r.deviceId !== body.deviceId);
        return [...without, { id: `__opt_${body.deviceId}`, workspaceId, deviceId: body.deviceId, role: body.role, channel: body.channel } as RoleAssignment];
      });
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context?.previous) qc.setQueryData(["roles", workspaceId], context.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["roles", workspaceId] }),
  });
}

/** Rename a device. */
export function useRenameDevice(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, name }: { deviceId: string; name: string }) =>
      api("PATCH /devices/:deviceId" as never, { params: { deviceId }, body: { name } } as never) as Promise<Device>,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["devices", workspaceId] }),
  });
}

/** Remove a device from the workspace. */
export function useRemoveDevice(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      api("DELETE /devices/:deviceId" as never, { params: { deviceId } } as never) as Promise<{ deleted: true }>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["devices", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["roles", workspaceId] });
    },
  });
}

export type ScanState = "idle" | "scanning" | "done";

/** Manages a network scan lifecycle with real-time WS device arrival. */
export function useScan(workspaceId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<ScanState>("idle");
  const [found, setFound] = useState(0);

  // Listen for WS scan events
  useEffect(() => {
    if (!workspaceId) return;
    return wsManager.subscribe((msg) => {
      if (msg.type === "scan.device_found") {
        setFound((n) => n + 1);
        void qc.invalidateQueries({ queryKey: ["devices", workspaceId] });
      } else if (msg.type === "scan.complete") {
        setState("done");
      } else if (msg.type === "scan.error") {
        setState("idle");
      }
    });
  }, [workspaceId, qc]);

  const startScan = async () => {
    if (!workspaceId || state === "scanning") return;
    setState("scanning");
    setFound(0);
    try {
      await api("POST /workspaces/:workspaceId/scan", {
        params: { workspaceId },
        body: {},
      });
    } catch {
      setState("idle");
    }
  };

  const resetScan = () => {
    setState("idle");
    setFound(0);
  };

  return { state, found, startScan, resetScan };
}
