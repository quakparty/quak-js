import { QuakError } from "./errors.js";

// Safe retries with the API's `Idempotency-Key` (plays, replay, save): one key per logical call, the same key on every
// try. The API answers a repeat of a finished request with the stored answer (`Idempotent-Replayed: true`, no new play,
// no credits), one still running with 409 `ERROR_IDEMPOTENCY_IN_PROGRESS`.

/** Options of a single play, replay or save. */
export type RequestOptions = {
  /**
   * The `Idempotency-Key` for this call (1–255 visible ASCII characters, e.g. a UUID), for retries across processes.
   * With it, the call itself also retries like with the client's `idempotency` option.
   */
  idempotencyKey?: string | undefined;
};

/** The answer of a call that may have been sent with an `Idempotency-Key`. */
export type Replayable<T> = T & {
  /**
   * Only with an idempotency key: true when the API answered with the stored answer of an earlier call with the same
   * key, so nothing played again and nothing was charged.
   */
  replayed?: boolean;
};

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/** Tries after the first one. */
const RETRIES = 3;
const MAX_WAIT_S = 10;

export async function idempotent<T>(
  call: (headers: Record<string, string>) => Promise<FetchResult<T>>,
  key: string,
): Promise<Replayable<T>> {
  for (let attempt = 0; ; attempt++) {
    let error: QuakError;
    try {
      const { data, error: body, response } = await call({ "Idempotency-Key": key });
      if (response.ok) {
        return { ...(data as T), replayed: response.headers.get("idempotent-replayed") === "true" };
      }
      error = QuakError.fromResponse(response, body);
    } catch (cause) {
      error = cause instanceof QuakError ? cause : QuakError.network(cause);
    }
    // a timeout or a drop may have played: only the same key can tell, so ask again
    const retry =
      error.code === "ERROR_NETWORK" || error.status === 503 || error.code === "ERROR_IDEMPOTENCY_IN_PROGRESS";
    if (!retry || attempt >= RETRIES) {
      throw error;
    }
    await sleep(Math.min(error.retryAfter ?? 2 ** attempt, MAX_WAIT_S));
  }
}

export function newIdempotencyKey(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  // insecure browser contexts have getRandomValues, not randomUUID
  const bytes = crypto!.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sleep(seconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
}
