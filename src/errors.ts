import type { ErrorBody, ErrorCode } from "./types.js";

export type QuakErrorInit = {
  status: number;
  code: ErrorCode;
  message: string;
  field?: string | undefined;
  details?: unknown;
  requestId?: string | undefined;
  retryAfter?: number | undefined;
  response?: Response | undefined;
  cause?: unknown;
};

/**
 * Every failure of a wrapper method (and of `unwrap`) is a QuakError.
 *
 * - API errors: `status` is the HTTP status, `code` the API's code (e.g. `ERROR_INSUFFICIENT_SCOPE`), `details` its
 *   details (e.g. `{ required: "manage" }`), `requestId` the `X-Request-Id` to quote in a bug report.
 * - Rate limits: 429 `ERROR_RATE_LIMITED`, `retryAfter` the seconds from `Retry-After` until it is worth trying again.
 * - Network failures (no answer at all): `status` 0, `code` `ERROR_NETWORK`, the original error in `cause`.
 */
export class QuakError extends Error {
  override name = "QuakError";
  readonly status: number;
  readonly code: ErrorCode;
  readonly field: string | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;
  /** Seconds to wait before trying again, from the `Retry-After` header (429, sometimes 503). */
  readonly retryAfter: number | undefined;
  readonly response: Response | undefined;

  constructor(init: QuakErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.field = init.field;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
    this.response = init.response;
  }

  /** Builds the error for a failed answer, from the API's error body where there is one. */
  static fromResponse(response: Response, body: unknown): QuakError {
    const error = isErrorBody(body) ? body.error : undefined;
    return new QuakError({
      status: response.status,
      code: error?.code ?? `HTTP_${response.status}`,
      message: error?.message ?? (response.statusText || `request failed with status ${response.status}`),
      field: error?.field,
      details: error?.details,
      requestId: error?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      retryAfter: parseRetryAfter(response.headers.get("retry-after")),
      response,
    });
  }

  /** Wraps an error thrown by fetch itself (offline, DNS, CORS, aborted). */
  static network(cause: unknown): QuakError {
    const message = cause instanceof Error ? cause.message : String(cause);
    return new QuakError({ status: 0, code: "ERROR_NETWORK", message: `network error: ${message}`, cause });
  }
}

// seconds or an HTTP date
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }
  const error = (body as { error: unknown }).error;
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string";
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Turns the result of a raw client call (`quak.api.GET(...)` etc.) into its body, or throws a QuakError.
 *
 * ```ts
 * const { data: sounds } = await unwrap(quak.api.GET("/v1/sounds"));
 * ```
 */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await request;
  } catch (error) {
    throw error instanceof QuakError ? error : QuakError.network(error);
  }
  if (!result.response.ok) {
    throw QuakError.fromResponse(result.response, result.error);
  }
  return result.data as T;
}
