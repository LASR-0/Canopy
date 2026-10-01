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
