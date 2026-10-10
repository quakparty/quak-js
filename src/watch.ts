import { QuakError } from "./errors.js";
import type { Play } from "./types.js";

// The live status of the plays over the API's WebSocket `GET /v1/plays/watch`: log in with the first message, then
// `ready`, every running play once and every change of a play as `play`, a `ping` every 25 s. After a drop it connects
// again and gets the current state again. Only the global WebSocket (Node 22+, Bun, Deno, browsers) or the one passed
// in, no dependency.

/** A WebSocket constructor: the global one, or e.g. the `ws` package on Node 20. */
export type WebSocketConstructor = new (url: string) => WebSocket;

export type WatchOptions = {
  /** Every running play once after connecting, then every change of a play: the whole play, as `plays.get()`. */
  onPlay: (play: Play) => void;
  /** Logged in; after a reconnect again, followed by the running plays. */
  onReady?: (() => void) | undefined;
  /** The connection closed; `reconnecting` tells whether it connects again by itself. */
  onClose?: ((info: { code: number; reason: string; reconnecting: boolean }) => void) | undefined;
  /** An error from the API (`ERROR_INVALID_API_KEY` etc.); a rejected key also ends the watch. */
  onError?: ((error: QuakError) => void) | undefined;
  /** Connect again after a drop, with growing pauses up to 30 s. Default: true. */
  reconnect?: boolean | undefined;
  /**
   * The workspace to watch (slug or id), for a login key that can reach several. Defaults to `X-Quak-Workspace` from
   * the client's `headers`, else the key's own workspace or, for a login key, the last used one.
   */
  workspace?: string | undefined;
  /** Defaults to the global WebSocket. */
  WebSocket?: WebSocketConstructor | undefined;
};

export type Watch = {
  /** Whether the watch is logged in right now (between `ready` and the next close). */
  readonly connected: boolean;
  /** Ends the watch for good, no reconnect. */
  close(): void;
};

type Message = { type: "ready" } | { type: "play"; data: Play } | { type: "ping" } | { type: "error"; code: string };

// 4001: key missing or rejected, 4401: ticket rejected. Trying again cannot help.
const FINAL_CODES = new Set([4001, 4401]);
const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;
// The server pings every 25 s; this long without any message means the connection is dead without a close.
const SILENCE_MS = 60_000;

export function watchPlays(url: string, apiKey: string, options: WatchOptions): Watch {
  const Found = options.WebSocket ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!Found) {
    throw new QuakError({
      status: 0,
      code: "ERROR_NETWORK",
      message: "watch() needs a WebSocket: Node 22 or newer, Bun, Deno or a browser, or pass one as `WebSocket`",
    });
  }

  let socket: WebSocket | undefined;
  let connected = false;
  let closed = false;
  let retryMs = FIRST_RETRY_MS;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;

  function listen() {
    clearTimeout(silence);
    silence = setTimeout(() => socket?.close(), SILENCE_MS);
  }

  // a const of its own: the closure below no longer sees the check above
  const Socket: WebSocketConstructor = Found;

  function connect() {
    const current = new Socket(url);
    socket = current;
    current.onopen = () => {
      current.send(
        JSON.stringify({ type: "auth", apiKey, ...(options.workspace ? { workspace: options.workspace } : {}) }),
      );
      listen();
    };
    current.onmessage = (event) => {
      listen();
      let message: Message;
      try {
        message = JSON.parse(String(event.data)) as Message;
      } catch {
        return;
      }
      if (message.type === "ready") {
        connected = true;
        retryMs = FIRST_RETRY_MS;
        options.onReady?.();
      } else if (message.type === "play") {
        options.onPlay(message.data);
      } else if (message.type === "error") {
        options.onError?.(new QuakError({ status: 0, code: message.code, message: `watch: ${message.code}` }));
      }
    };
    current.onclose = (event) => {
      if (socket !== current) {
        return;
      }
      clearTimeout(silence);
      connected = false;
      const reconnecting = !closed && options.reconnect !== false && !FINAL_CODES.has(event.code);
      options.onClose?.({ code: event.code, reason: event.reason, reconnecting });
      if (reconnecting) {
        retry = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      }
    };
  }

  connect();
  return {
    get connected() {
      return connected;
    },
    close() {
      closed = true;
      clearTimeout(retry);
      clearTimeout(silence);
      socket?.close();
    },
  };
}
