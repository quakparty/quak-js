import { clientHeader } from "./client-header.js";
import { DEFAULT_BASE_URL } from "./client.js";
import { QuakError } from "./errors.js";
import type { components } from "./generated/schema.js";
import type { Play } from "./types.js";

type Result = components["schemas"]["TriggerCallResult"]["data"];

/** What a trigger did: `played` with its play, or `skipped` with the `reason` (cooldown, quiet hours etc.). */
export type TriggerResult = Omit<Result, "play"> & { play: Play | null };
export type TriggerResponse = { data: TriggerResult };

export type FireTriggerOptions = {
  /** Fields for the trigger's `{{variables}}` and `event`, sent as JSON; on the same name they win over `query`. */
  body?: Record<string, unknown> | undefined;
  /** Fields sent in the query string. */
  query?: Record<string, string | number | boolean> | undefined;
  /** For a bare token: the API to send it to. Defaults to `https://api.quak.party`. */
  baseUrl?: string | undefined;
  /** A custom fetch (tests, proxies). Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch | undefined;
};

/**
 * Fire a trigger: its secret URL or just its token (`qk_trg_…`), no API key needed. Skipped calls (cooldown, quiet
 * hours etc.) are no error, see `data.status` and `data.reason`.
 *
 * ```ts
 * const { data } = await fireTrigger(process.env.QUAK_TRIGGER_URL!, { body: { name: "Ben" } });
 * ```
 */
export async function fireTrigger(urlOrToken: string, options: FireTriggerOptions = {}): Promise<TriggerResponse> {
  const url = new URL(triggerUrl(urlOrToken.trim(), options.baseUrl));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { "X-Quak-Client": clientHeader() };
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    throw QuakError.network(error);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw QuakError.fromResponse(response, body);
  }
  return body as TriggerResponse;
}

function triggerUrl(urlOrToken: string, baseUrl = DEFAULT_BASE_URL): string {
  if (urlOrToken.startsWith("qk_trg_")) {
    return `${baseUrl.replace(/\/+$/, "")}/t/${urlOrToken}`;
  }
  if (/^https?:\/\//.test(urlOrToken)) {
    return urlOrToken;
  }
  throw new QuakError({
    status: 0,
    code: "ERROR_INVALID_PARAMS",
    message: "fireTrigger() needs a trigger URL or a token (qk_trg_…)",
  });
}
