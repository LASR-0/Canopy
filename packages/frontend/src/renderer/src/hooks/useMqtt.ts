import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MqttBrokerPatch } from "@canopy/shared-types";
import { api } from "@/lib/http";

/** The broker's credential and connection rules (Settings → Device connections). */
export function useMqttBroker() {
  return useQuery({
    queryKey: ["mqtt"],
    queryFn: ({ signal }) => api("GET /mqtt", { signal }),
  });
}

export function usePatchMqttBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MqttBrokerPatch) => api("PATCH /mqtt", { body }),
    onSuccess: (data) => qc.setQueryData(["mqtt"], data),
  });
}

/** A new broker password. Every device on the old one is disconnected. */
export function useRegenerateMqttPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /mqtt/password"),
    onSuccess: (data) => qc.setQueryData(["mqtt"], data),
  });
}

/**
 * A device's own broker credential (Phase 8 G), fetched when its card asks.
 * Polled while a credential is being sent to a Shelly, which happens in the
 * background after pairing.
 */
export function useDeviceCredential(deviceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["device-mqtt", deviceId],
    queryFn: ({ signal }) => api("GET /devices/:deviceId/mqtt", { params: { deviceId }, signal }),
    enabled,
    refetchInterval: (query) => (query.state.data?.push?.state === "sending" ? 1000 : false),
  });
}

/** A new password for one device; it is disconnected until it has it. */
export function useRegenerateDevicePassword(deviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /devices/:deviceId/mqtt/password", { params: { deviceId } }),
    onSuccess: (data) => qc.setQueryData(["device-mqtt", deviceId], data),
  });
}

/** Send a Shelly its credential over its HTTP API. Resolves once the device has answered. */
export function usePushDeviceCredential(deviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /devices/:deviceId/mqtt/push", { params: { deviceId } }),
    onSuccess: (data) => qc.setQueryData(["device-mqtt", deviceId], data),
  });
}
