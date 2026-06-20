/**
 * Every HTTP response is wrapped so the UI has one consistent shape to handle.
 * Success carries `data`; failure carries a coded error.
 */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type ApiErrorCode =
  | "not_found"
  | "validation_failed"
  | "device_unreachable"
  | "conflict"
  | "controller_paused"
  | "internal";
