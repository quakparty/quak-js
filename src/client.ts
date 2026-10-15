import createClient, { type Client } from "openapi-fetch";
import { clientHeader } from "./client-header.js";
import { QuakError, unwrap } from "./errors.js";
import { idempotent, newIdempotencyKey, type Replayable, type RequestOptions } from "./idempotency.js";
import { startTalkLive, type TalkLive, type TalkLiveOptions } from "./talk-live.js";
import { watchPlays, type Watch, type WatchOptions } from "./watch.js";
import type {
  Paths,
  PlayClipParams,
  PlayFileParams,
  PlayItemResponse,
  PlayQuery,
  PlayResponse,
  PlaysQuery,
  PlaysResponse,
  PlayStopResponse,
  ReplayParams,
  ReplayResponse,
  SaveParams,
  SaveResponse,
  WorkspaceResponse,
  CurrentKeyResponse,
  PlaySoundParams,
  PlayTalkParams,
  PlayTextParams,
  PlayUrlParams,
  ClipsResponse,
  EffectsQuery,
  EffectsResponse,
  SoundsQuery,
  SoundsResponse,
  SoundTagsResponse,
  SpeakersQuery,
  SpeakersResponse,
  VoiceLanguagesResponse,
  VoiceLocalesQuery,
  VoiceLocalesResponse,
  VoiceModelsResponse,
  VoicesQuery,
  VoicesResponse,
  StopParams,
  StopResponse,
  Upload,
} from "./types.js";

/** The production API. */
export const DEFAULT_BASE_URL = "https://api.quak.party";

export type QuakOptions = {
  /**
   * An API key (`qk_key_…`) or, in a browser, a play token (`qk_ptk_…`, `POST /v1/play-tokens`), sent as
   * `Authorization: Bearer <key>`. Optional only for the public routes.
   */
  apiKey?: string | undefined;
  /** Defaults to the production API, `https://api.quak.party`. */
  baseUrl?: string | undefined;
  /** A custom fetch (tests, proxies, retries). Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch | undefined;
  /** Extra headers for every request. They cannot replace `X-Quak-Client`. */
  headers?: Record<string, string> | undefined;
  /**
   * Internal, for Quak's own clients built on this package (like `"raycast/1.0.0"`): the `<name>/<version>` sent in
   * `X-Quak-Client` instead of `js/<version>`, so their plays show up as themselves in the history. The library still
   * adds `(<os>; <arch>)`.
   */
  client?: string | undefined;
  /**
   * Plays, `plays.replay()` and `plays.save()` with an `Idempotency-Key`: each call gets its own key and, after a
   * network error, a 503 or while the first try still runs, sends the same request again with it, up to 3 times. The
   * API never plays or charges a key twice; an answer it repeats has `replayed: true`. For integrations and scripts
   * that must not play twice. Default: off, or per call with `{ idempotencyKey }`.
   */
  idempotency?: boolean | undefined;
};

export type RawClient = Client<Paths>;

/**
 * The Quak API client.
 *
 * ```ts
 * const quak = new Quak({ apiKey: process.env.QUAK_API_KEY });
 * await quak.play.text({ text: "Meeting in 5 minutes", to: "office" });
 * ```
 */
export class Quak {
  /** The typed openapi-fetch client for every route of the API (`quak.api.GET("/v1/sounds")`). */
  readonly api: RawClient;

  /**
   * The workspace's credit balance from the `X-Quak-Credits` header of the latest answer that had one (every
   * authenticated answer does), or null before the first request.
   */
  credits: number | null = null;

  /** Plays: kinds always in this order: text, talk, sound, clip, file, url. */
  readonly play: {
    /** Speak a text (`POST /v1/play/text`). */
    text(params: PlayTextParams, options?: RequestOptions): Promise<Replayable<PlayResponse>>;
    /** Play what someone said into a mic, after release (`POST /v1/play/talk`, multipart). */
    talk(params: PlayTalkParams, options?: RequestOptions): Promise<Replayable<PlayResponse>>;
    /** Play a built-in sound (`POST /v1/play/sound`). */
    sound(params: PlaySoundParams, options?: RequestOptions): Promise<Replayable<PlayResponse>>;
    /** Play one of the workspace's clips (`POST /v1/play/clip`). */
    clip(params: PlayClipParams, options?: RequestOptions): Promise<Replayable<PlayResponse>>;
    /** Upload and play an audio file (`POST /v1/play/file`, multipart). */
    file(params: PlayFileParams, options?: RequestOptions): Promise<Replayable<PlayResponse>>;
    /** Play audio from a URL (`POST /v1/play/url`). */
    url(params: PlayUrlParams, options?: RequestOptions): Promise<Replayable<PlayResponse>>;
  };

  /** The history. */
  readonly plays: {
    /** List the plays of this key, newest first (`GET /v1/plays`); `keys: "all"` for the whole workspace. */
    list(query?: PlaysQuery): Promise<PlaysResponse>;
    /** One play (`GET /v1/plays/{id}`). */
    get(id: string, query?: PlayQuery): Promise<PlayItemResponse>;
    /**
     * The newest play of this key (`GET /v1/plays/last`), `keys: "all"` for the workspace's; a 404 QuakError when there
     * is none.
     */
    last(query?: PlayQuery): Promise<PlayItemResponse>;
    /** Stop one play while it runs (`POST /v1/plays/{id}/stop`). */
    stop(id: string): Promise<PlayStopResponse>;
    /**
     * Play a play's audio once more, on its speakers or the ones in `to` (`POST /v1/plays/{id}/replay`, `"last"`
     * for your newest). While `canReplay` is true.
     */
    replay(id: string, params?: ReplayParams, options?: RequestOptions): Promise<Replayable<ReplayResponse>>;
    /**
     * Keep a play's audio as a clip (`POST /v1/plays/{id}/save`, `"last"` for your newest). Needs a key with scope
     * `create`; while `canSave` is true.
     */
    save(id: string, params?: SaveParams, options?: RequestOptions): Promise<Replayable<SaveResponse>>;
  };

  /** The key itself. */
  readonly keys: {
    /**
     * The key of this client with its scope, user and workspace (the same object as `workspace.get()`), for any key:
     * the check when a client is set up (`GET /v1/keys/current`).
     */
    current(): Promise<CurrentKeyResponse>;
  };

  /** The workspace of the key. */
  readonly workspace: {
    /** Name, credits, playback defaults, time zone and `limits` (`GET /v1/workspace`). */
    get(): Promise<WorkspaceResponse>;
  };

  // Lookups: what a play can name (play scope). Management routes (keys, workspace settings, members, Sonos, clip
  // uploads etc.) stay on the raw client `api`.

  /** Where to play: the slugs for `to`. */
  readonly speakers: {
    /** Rooms, groups, locations and `all` (`GET /v1/speakers`). */
    list(query?: SpeakersQuery): Promise<SpeakersResponse>;
  };

  /** Voices for `play.text` (`voice`, `language`). */
  readonly voices: {
    /**
     * List voices, filtered by provider, gender, locale, model, language or `maxCredits` (`GET /v1/voices`). In pages:
     * 500 by default, `limit` up to 5000, `meta.total` for all.
     */
    list(query?: VoicesQuery): Promise<VoicesResponse>;
    /** The languages voices speak (`GET /v1/voices/languages`). */
    languages(): Promise<VoiceLanguagesResponse>;
    /** The locales of the voices (`GET /v1/voices/locales`). */
    locales(query?: VoiceLocalesQuery): Promise<VoiceLocalesResponse>;
    /** The TTS models (`GET /v1/voices/models`). */
    models(): Promise<VoiceModelsResponse>;
  };

  /** Built-in sounds for `play.sound`, `intro` and `outro`. */
  readonly sounds: {
    /** Search and list sounds (`GET /v1/sounds`). */
    list(query?: SoundsQuery): Promise<SoundsResponse>;
    /** The sound tags (`GET /v1/sounds/tags`). */
    tags(): Promise<SoundTagsResponse>;
  };

  /** The workspace's clips for `play.clip`, `intro` and `outro`. */
  readonly clips: {
    /** List the clips (`GET /v1/clips`). */
    list(): Promise<ClipsResponse>;
  };

  /** Voice effects and ambiences (`effect`, `ambience`). */
  readonly effects: {
    /** List effects and ambiences with their descriptions (`GET /v1/effects`). */
    list(query?: EffectsQuery): Promise<EffectsResponse>;
  };

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly workspaceHeader: string | undefined;
  private readonly idempotency: boolean;

  constructor(options: QuakOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.idempotency = options.idempotency === true;
    // headers are case-insensitive, and a WebSocket cannot send them: watch() puts it into the auth message
    this.workspaceHeader = Object.entries(options.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "x-quak-workspace",
    )?.[1];
    const headers: Record<string, string> = {
      ...options.headers,
      "X-Quak-Client": clientHeader(undefined, options.client),
    };
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }

    this.api = createClient<Paths>({
      baseUrl: this.baseUrl,
      headers,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.api.use({
      onResponse: ({ response }) => {
        const credits = response.headers.get("x-quak-credits");
        if (credits !== null && credits !== "" && Number.isFinite(Number(credits))) {
          this.credits = Number(credits);
        }
        return undefined;
      },
    });

    const api = this.api;
    // a call that may be retried: with a key (the call's own, or a new one with `idempotency`) it goes through
    // idempotent(), else straight to the API as before
    const send = <T>(
      options: RequestOptions | undefined,
      call: (headers: Record<string, string>) => Promise<{ data?: T; error?: unknown; response: Response }>,
    ): Promise<Replayable<T>> => {
      const key = options?.idempotencyKey ?? (this.idempotency ? newIdempotencyKey() : undefined);
      return key ? idempotent(call, key) : (unwrap(call({})) as Promise<Replayable<T>>);
    };
    this.play = {
      text: (params, options) => send(options, (headers) => api.POST("/v1/play/text", { body: params, headers })),
      talk: (params, options) =>
        send(options, (headers) =>
          api.POST("/v1/play/talk", { body: {} as never, bodySerializer: () => toFormData(params), headers }),
        ),
      sound: (params, options) => send(options, (headers) => api.POST("/v1/play/sound", { body: params, headers })),
      clip: (params, options) => send(options, (headers) => api.POST("/v1/play/clip", { body: params, headers })),
      file: (params, options) =>
        send(options, (headers) =>
          api.POST("/v1/play/file", { body: {} as never, bodySerializer: () => toFormData(params), headers }),
        ),
      url: (params, options) => send(options, (headers) => api.POST("/v1/play/url", { body: params, headers })),
    };
    this.plays = {
      list: (query) => unwrap(api.GET("/v1/plays", { params: { query } })),
      get: (id, query) => unwrap(api.GET("/v1/plays/{id}", { params: { path: { id }, query } })),
      last: (query) => unwrap(api.GET("/v1/plays/{id}", { params: { path: { id: "last" }, query } })),
      stop: (id) => unwrap(api.POST("/v1/plays/{id}/stop", { params: { path: { id } } })),
      replay: (id, params = {}, options) =>
        send(options, (headers) =>
          api.POST("/v1/plays/{id}/replay", { params: { path: { id } }, body: params, headers }),
        ),
      save: (id, params = {}, options) =>
        send(options, (headers) =>
          api.POST("/v1/plays/{id}/save", { params: { path: { id } }, body: params, headers }),
        ),
    };
    this.keys = {
      current: () => unwrap(api.GET("/v1/keys/current")),
    };
    this.workspace = {
      get: () => unwrap(api.GET("/v1/workspace")),
    };
    this.speakers = {
      list: (query) => unwrap(api.GET("/v1/speakers", { params: { query } })),
    };
    this.voices = {
      list: (query) => unwrap(api.GET("/v1/voices", { params: { query } })),
      languages: () => unwrap(api.GET("/v1/voices/languages")),
      locales: (query) => unwrap(api.GET("/v1/voices/locales", { params: { query } })),
      models: () => unwrap(api.GET("/v1/voices/models")),
    };
    this.sounds = {
      list: (query) => unwrap(api.GET("/v1/sounds", { params: { query } })),
      tags: () => unwrap(api.GET("/v1/sounds/tags")),
    };
    this.clips = {
      list: () => unwrap(api.GET("/v1/clips")),
    };
    this.effects = {
      list: (query) => unwrap(api.GET("/v1/effects", { params: { query } })),
    };
  }

  /**
   * Stop whatever plays on the speakers in `to`, also clips of other apps; without `to` on all speakers
   * (`POST /v1/play/stop`).
   */
  stop(params: StopParams = {}): Promise<StopResponse> {
    return unwrap(this.api.POST("/v1/play/stop", { body: params }));
  }

  /**
   * The live status of your plays over a WebSocket (`GET /v1/plays/watch`): every running play once, then every
   * change, reconnecting after a drop. Needs the global WebSocket (Node 22+, Bun, Deno, browsers) or `WebSocket`.
   *
   * ```ts
   * const watch = quak.watch({ onPlay: (play) => console.log(play.id, play.status) });
   * watch.close();
   * ```
   */
  watch(options: WatchOptions): Watch {
    if (!this.apiKey) {
      throw new QuakError({ status: 0, code: "ERROR_MISSING_API_KEY", message: "watch() needs an apiKey" });
    }
    // the API reads keys from the URL only, not from the auth message
    const query = options.keys ? `?keys=${options.keys}` : "";
    const url = `${this.baseUrl.replace(/^http/, "ws")}/v1/plays/watch${query}`;
    return watchPlays(url, this.apiKey, { ...options, workspace: options.workspace ?? this.workspaceHeader });
  }

  /**
   * Talk live (`GET /v1/play/talk/live`, beta): the speakers play while someone speaks. With the client's key, in
   * a browser a play token. Needs the Family plan or higher, else `onError` gets `ERROR_PLAN_REQUIRED`.
   *
   * ```ts
   * const live = quak.talkLive({ to: ["kitchen"], source: await microphone(), onDone: (done) => {} });
   * await live.end();
   * ```
   */
  talkLive(options: TalkLiveOptions): TalkLive {
    const url = `${this.baseUrl.replace(/^http/, "ws")}/v1/play/talk/live`;
    return startTalkLive(url, this.apiKey, { ...options, workspace: options.workspace ?? this.workspaceHeader });
  }
}

// Multipart fields: strings as they are, numbers and booleans as text, lists of plain values as CSV (`to`), other
// objects and lists as JSON (`volumes`, `effects`), which is what the API reads from form fields.
function toFormData(params: { file: Upload; filename?: string } & Record<string, unknown>): FormData {
  const { file, filename, ...fields } = params;
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }
    form.append(key, formValue(value));
  }
  form.append(
    "file",
    toBlob(file),
    filename ?? (typeof File !== "undefined" && file instanceof File ? file.name : "audio"),
  );
  return form;
}

function formValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) && value.every((item) => ["string", "number"].includes(typeof item))) {
    return value.join(",");
  }
  return JSON.stringify(value);
}

function toBlob(file: Upload): Blob {
  if (file instanceof Blob) {
    return file;
  }
  return new Blob([file instanceof Uint8Array ? new Uint8Array(file) : file]);
}
