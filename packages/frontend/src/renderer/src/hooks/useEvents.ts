import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { AppEvent } from "@canopy/shared-types";

/**
 * Timeline events, newest first.
 *
 * `limit` is part of the query key as well as the request. It was previously
 * neither: the parameter was declared, never sent, and left out of the key — so
 * every caller silently got the route's default of 50 and shared one cache entry
 * regardless of how many it asked for.
 */
export function useEvents(workspaceId: string | undefined, limit = 30) {
  return useQuery({
    queryKey: ["events", workspaceId, limit],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/events", {
        params: { workspaceId: workspaceId! },
        query: { limit },
        signal,
      }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
}

/**
 * Events inside a time window, for a chart.
 *
 * The chart used the newest-200 feed, so any range longer than the last few
 * hours of activity showed markers for only its right-hand end. Keyed by the
 * range name rather than the exact bounds, which move every render.
 */
export function useEventsInWindow(workspaceId: string | undefined, rangeKey: string, from: number, to: number) {
  return useQuery({
    queryKey: ["events", workspaceId, "window", rangeKey],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/events", {
        params: { workspaceId: workspaceId! },
        query: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), limit: 1000 },
        signal,
      }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
}

/** Rows per page of the Activity tab. */
export const ACTIVITY_PAGE = 100;

/**
 * The whole event record, newest first, a page at a time. The next page starts
 * below the oldest row so far (`before`), so rows arriving meanwhile never
 * shift a page boundary and repeat a row.
 */
export function useActivity(workspaceId: string | undefined, types: AppEvent["type"][]) {
  return useInfiniteQuery({
    queryKey: ["events", workspaceId, "activity", [...types].sort().join(",")],
    // No abort signal, unlike the other queries: a first page cancelled by a
    // remount (StrictMode's double mount in dev) left the infinite query
    // pending for good instead of fetching again. A page is small.
    queryFn: ({ pageParam }) =>
      api("GET /workspaces/:workspaceId/events", {
        params: { workspaceId: workspaceId! },
        query: {
          limit: ACTIVITY_PAGE,
          types: types.join(","),
          ...(pageParam ? { before: pageParam } : {}),
        },
      }),
    initialPageParam: "",
    getNextPageParam: (last) => (last.length < ACTIVITY_PAGE ? undefined : last[last.length - 1]!.occurredAt),
    enabled: !!workspaceId && types.length > 0,
    refetchInterval: 30_000,
  });
}

/** Out-of-range periods and other problems in a window, for the Logs tab. */
export function useLogs(workspaceId: string | undefined, rangeKey: string, from: number, to: number) {
  return useQuery({
    queryKey: ["logs", workspaceId, rangeKey],
    queryFn: ({ signal }) =>
      api("GET /workspaces/:workspaceId/logs", {
        params: { workspaceId: workspaceId! },
        query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
        signal,
      }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
}
