import type { ApiSuccess, ApiError, ApiErrorCode } from "@canopy/shared-types";

export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function err(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): ApiError {
  return { ok: false, error: { code, message, details } };
}
