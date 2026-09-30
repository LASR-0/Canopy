import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { NotificationChannel, NotificationSummary } from "@canopy/shared-types";

const key = (workspaceId: string | undefined) => ["notifications", workspaceId];

/**
 * Unseen counts per page (the sidebar badges) and the recent notifications
 * (the bell). Polled: the controller pushes no event messages over the
 * websocket yet, and a badge a few seconds late is fine.
 */
export function useNotifications(workspaceId: string | undefined) {
  return useQuery({
    queryKey: key(workspaceId),
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/notifications", {
        params: { workspaceId: workspaceId! },
        signal,
      }),
    enabled: !!workspaceId,
    refetchInterval: 15_000,
  });
}

/**
 * Mark pages' notifications seen; all of them when no channels are given.
 *
 * Optimistic, so a badge clears the moment it is hovered rather than a round
 * trip later. The server answers with the new summary, which replaces the guess.
 */
export function useMarkSeen(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channels?: NotificationChannel[]) =>
      api("POST /workspaces/:workspaceId/notifications/seen", {
        params: { workspaceId: workspaceId! },
        body: channels ? { channels } : {},
      }),
    onMutate: async (channels) => {
      await qc.cancelQueries({ queryKey: key(workspaceId) });
      const previous = qc.getQueryData<NotificationSummary>(key(workspaceId));
      if (previous) {
        const hit = (c: NotificationChannel) => !channels || channels.includes(c);
        qc.setQueryData<NotificationSummary>(key(workspaceId), {
          unseen: Object.fromEntries(
            Object.entries(previous.unseen).map(([c, n]) => [c, hit(c as NotificationChannel) ? 0 : n]),
          ) as NotificationSummary["unseen"],
          recent: previous.recent.map((r) => (hit(r.channel) ? { ...r, seen: true } : r)),
        });
      }
      return { previous };
    },
    onError: (_err, _channels, context) => {
      if (context?.previous) qc.setQueryData(key(workspaceId), context.previous);
    },
    onSuccess: (summary) => qc.setQueryData(key(workspaceId), summary),
  });
}
