import type { ApiRoutes, ApiResponse } from "@canopy/shared-types";

export const BACKEND_URL =
  (import.meta.env["VITE_BACKEND_URL"] as string | undefined) ??
  "http://127.0.0.1:7001";

type RouteKey = keyof ApiRoutes;
type RouteRes<K extends RouteKey> = ApiRoutes[K]["res"];
type RouteBody<K extends RouteKey> = ApiRoutes[K] extends { body: infer B } ? B : never;

/** Extract method and path from a route key like "POST /tents/:tentId/roles". */
function parseKey(key: RouteKey): { method: string; path: string } {
  const space = key.indexOf(" ");
  return { method: key.slice(0, space), path: key.slice(space + 1) };
}

/** Append a query string, skipping keys whose value is undefined. */
function applyQuery(url: string, query?: Record<string, string | number | undefined>): string {
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `${url}?${rendered}` : url;
}

/** Replace :param placeholders in the path. */
function applyParams(path: string, params?: Record<string, string>): string {
  if (!params) return path;
  return Object.entries(params).reduce(
    (p, [k, v]) => p.replace(`:${k}`, encodeURIComponent(v)),
    path,
  );
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Type-safe fetch against `ApiRoutes`. Unwraps the `ApiResponse<T>` envelope
 * and throws `ApiError` on error responses.
 *
 * @example
 *   const tents = await api("GET /tents");
 *   const tent  = await api("POST /tents", { body: { name: "Tent 1" } });
 */
export async function api<K extends RouteKey>(
  route: K,
  options?: {
    body?: RouteBody<K>;
    params?: Record<string, string>;
    /**
     * Query string values. Not part of `ApiRoutes`, which types paths and
     * bodies: these are the optional knobs a route reads off the querystring,
     * such as a result limit.
     */
    query?: Record<string, string | number | undefined>;
    signal?: AbortSignal;
  },
): Promise<RouteRes<K>> {
  const { method, path } = parseKey(route);
  const url = applyQuery(BACKEND_URL + applyParams(path, options?.params), options?.query);

  const init: RequestInit = { method };
  if (options?.body)   init.body    = JSON.stringify(options.body);
  if (options?.body)   init.headers = { "Content-Type": "application/json" };
  if (options?.signal) init.signal  = options.signal;

  const res = await fetch(url, init);

  const json = (await res.json()) as ApiResponse<RouteRes<K>>;

  if (!json.ok) {
    throw new ApiError(json.error.code, json.error.message, json.error.details);
  }

  return json.data;
}
