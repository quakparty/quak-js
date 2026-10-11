import { QuakError } from "./errors.js";
import type { PlayTextParams, Play } from "./types.js";
import type { WebSocketConstructor } from "./watch.js";

// Talk live over the API's WebSocket `GET /v1/play/talk/live`: a start message with the key or a ticket, the
// audio as binary frames, `update` while talking, `end`, then `done` and close 1000. The protocol is in the
// description of the route in the OpenAPI; it has no schema of its own, so the messages are typed here.

/** Effects that need the whole take and cannot run live. */
type NotLive = "faster" | "slower" | "reverse";

/** What a live talk takes from the other plays: speakers, volume and the sound design. */
export type TalkLiveParams = Omit<
  Pick<
    PlayTextParams,
    | "to"
    | "volume"
    | "volumes"
    | "intro"
    | "outro"
    | "gap"
    | "effect"
    | "effectIntensity"
    | "ambience"
    | "ambienceIntensity"
    | "priority"
    | "quietHours"
  >,
  "effect"
> & { effect?: Exclude<PlayTextParams["effect"], NotLive> };

/** The audio sent as binary frames: Opus one raw 20 ms packet per frame, PCM mono little endian. */
export type TalkLiveFormat = {
  encoding: "opus" | "pcm_s16le" | "pcm_f32le";
  sampleRate: 16000 | 24000 | 44100 | 48000;
};

/** What can change while talking. `muted` keeps ambience and reverb running. */
export type TalkLiveUpdate = Pick<TalkLiveParams, "effect" | "effectIntensity" | "ambience" | "ambienceIntensity"> & {
  muted?: boolean;
};

export type TalkLiveReady = { play: Play; credits: number; maxSeconds: number };
export type TalkLiveDone = {
  play: Play;
  credits: number;
  /** The workspace's credits after the charge. */
  balance: number;
  endedBy: "client" | "disconnected" | "limit" | "credits";
};
export type TalkLiveWarning = { code: string; message: string; secondsLeft?: number };

/** Where the audio comes from, e.g. `microphone()`: it names the format and starts sending once the talk is ready. */
export type TalkLiveSource = {
  readonly format: TalkLiveFormat;
  start(send: (frame: ArrayBuffer) => void): void;
  /** Stops sending and sends what is left (an encoder's last packets). */
  stop(): Promise<void>;
  /** Mutes the input itself, next to the `muted` update to the API. */
  setMuted?(muted: boolean): void;
};

export type TalkLiveOptions = TalkLiveParams & {
  /** A one-time ticket (`qk_wst_…`, `POST /v1/ws/tickets` with purpose `talk-live`) instead of the client's key. */
  ticket?: string | undefined;
  /** For a login key: the workspace (slug or id). Defaults to `X-Quak-Workspace` from the client's `headers`. */
  workspace?: string | undefined;
  /** The audio: a source such as `microphone()`, which sends by itself, or a format for frames sent with `send()`. */
  source?: TalkLiveSource | undefined;
  /** The format of frames sent with `send()`; ignored with a `source`. Default: the API's, `pcm_s16le` at 44.1 kHz. */
  format?: TalkLiveFormat | undefined;
  /** The speakers play: the talk is live now (`maxSeconds` at most). */
  onReady?: ((ready: TalkLiveReady) => void) | undefined;
  /** The current values after an `update()`. */
  onUpdated?: ((state: TalkLiveUpdate) => void) | undefined;
  /** `LIMIT_SOON` 30 s before the time limit, `ERROR_NOT_ENOUGH_CREDITS` before it ends for lack of credits. */
  onWarning?: ((warning: TalkLiveWarning) => void) | undefined;
  /** Quiet hours: nothing played, nothing charged, the socket closes. */
  onSkipped?: ((skipped: { play: Play; credits: number }) => void) | undefined;
  /** Reverb and outro are through: the play with its credits. */
  onDone?: ((done: TalkLiveDone) => void) | undefined;
  /** An error from the API (on start it also ends the talk, e.g. `ERROR_PLAN_REQUIRED`) or a dropped connection. */
  onError?: ((error: QuakError) => void) | undefined;
  /** The socket closed, after `done`, an error or a drop. */
  onClose?: ((info: { code: number; reason: string }) => void) | undefined;
  /** Defaults to the global WebSocket. */
  WebSocket?: WebSocketConstructor | undefined;
};

export type TalkLiveState = "connecting" | "live" | "ending" | "closed";

export type TalkLive = {
  readonly state: TalkLiveState;
  /** Sends one frame of audio; before `ready` the API keeps up to 5 s. Not needed with a `source`. */
  send(frame: ArrayBuffer | ArrayBufferView<ArrayBuffer>): void;
  /** Changes the sound while talking; `muted` also mutes the source. */
  update(changes: TalkLiveUpdate): void;
  /** Ends the talk: the source sends what is left, then reverb and outro run out and `onDone` follows. */
  end(): Promise<void>;
  /** Drops the connection at once. The API ends the talk too (`endedBy: "disconnected"`). */
  close(): void;
};

type Message =
  | ({ type: "ready" } & TalkLiveReady)
  | ({ type: "updated" } & TalkLiveUpdate)
  | ({ type: "warning" } & TalkLiveWarning)
  | { type: "skipped"; play: Play; credits: number }
  | ({ type: "done" } & TalkLiveDone)
  | { type: "error"; code: string; message: string; field?: string; requestId?: string }
  | { type: "ping" };

export function startTalkLive(url: string, apiKey: string | undefined, options: TalkLiveOptions): TalkLive {
  const Socket = options.WebSocket ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!Socket) {
    throw new QuakError({
      status: 0,
      code: "ERROR_NETWORK",
      message: "talkLive() needs a WebSocket: Node 22 or newer, Bun, Deno or a browser, or pass one as `WebSocket`",
    });
  }
  if (!options.ticket && !apiKey) {
    throw new QuakError({
      status: 0,
      code: "ERROR_MISSING_API_KEY",
      message: "talkLive() needs an apiKey or a ticket",
    });
  }

  const {
    ticket,
    workspace,
    source,
    format,
    onReady,
    onUpdated,
    onWarning,
    onSkipped,
    onDone,
    onError,
    onClose,
    WebSocket: _,
    ...params
  } = options;
  const socket = new Socket(url);
  socket.binaryType = "arraybuffer";
  let state: TalkLiveState = "connecting";
  // frames sent before the socket is open; the API itself keeps what comes before ready
  const pending: (ArrayBuffer | ArrayBufferView<ArrayBuffer>)[] = [];
  // done, skipped or an error arrived, or close() was called: a close after that is no drop
  let finished = false;

  function send(frame: ArrayBuffer | ArrayBufferView<ArrayBuffer>) {
    if (state === "closed") return;
    if (socket.readyState === 1) socket.send(frame);
    else pending.push(frame);
  }

  // errors on start and at the end close the socket, errors on update do not
  function fail(error: QuakError) {
    if (state !== "live") finished = true;
    onError?.(error);
  }

  let sourceStopped: Promise<void> | undefined;
  function stopSource() {
    sourceStopped ??= source ? source.stop() : Promise.resolve();
    return sourceStopped;
  }

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: "start",
        ...(ticket ? { ticket } : { apiKey }),
        ...(workspace ? { workspace } : {}),
        ...params,
        ...(source ? { format: source.format } : format ? { format } : {}),
      }),
    );
    for (const frame of pending.splice(0)) socket.send(frame);
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message: Message;
    try {
      message = JSON.parse(event.data) as Message;
    } catch {
      return;
    }
    switch (message.type) {
      case "ready": {
        state = "live";
        source?.start(send);
        const { type: _, ...ready } = message;
        onReady?.(ready);
        break;
      }
      case "updated": {
        const { type: _, ...updated } = message;
        onUpdated?.(updated);
        break;
      }
      case "warning": {
        const { type: _, ...warning } = message;
        onWarning?.(warning);
        break;
      }
      case "skipped":
        finished = true;
        void stopSource();
        onSkipped?.({ play: message.play, credits: message.credits });
        break;
      case "done": {
        finished = true;
        const { type: _, ...done } = message;
        onDone?.(done);
        break;
      }
      case "error":
        fail(
          new QuakError({
            status: 0,
            code: message.code,
            message: message.message,
            field: message.field,
            requestId: message.requestId,
          }),
        );
        break;
    }
  };
  socket.onclose = (event) => {
    const dropped = !finished;
    state = "closed";
    void stopSource();
    // a drop without done or an error: tell it, like a failed request
    if (dropped) {
      onError?.(
        new QuakError({ status: 0, code: "ERROR_NETWORK", message: `talk live: connection closed (${event.code})` }),
      );
    }
    onClose?.({ code: event.code, reason: event.reason });
  };

  return {
    get state() {
      return state;
    },
    send,
    update(changes) {
      if (changes.muted !== undefined) source?.setMuted?.(changes.muted);
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "update", ...changes }));
    },
    async end() {
      if (state === "ending" || state === "closed") return;
      state = "ending";
      // the source's last packets go out before end, else the API would cut them off
      await stopSource();
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: "end" }));
      } else {
        finished = true;
        socket.close();
      }
    },
    close() {
      finished = true;
      state = "closed";
      void stopSource();
      socket.close();
    },
  };
}
