import createClient, { type Client } from "openapi-fetch";
import { clientHeader } from "./client-header.js";
import { QuakError, unwrap } from "./errors.js";
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
  /** An API key (`qk_key_…`), sent as `Authorization: Bearer <key>`. Optional only for the public routes. */
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
    text(params: PlayTextParams): Promise<PlayResponse>;
    /** Play what someone said into a mic, after release (`POST /v1/play/talk`, multipart). */
    talk(params: PlayTalkParams): Promise<PlayResponse>;
    /** Play a built-in sound (`POST /v1/play/sound`). */
    sound(params: PlaySoundParams): Promise<PlayResponse>;
    /** Play one of the workspace's clips (`POST /v1/play/clip`). */
    clip(params: PlayClipParams): Promise<PlayResponse>;
    /** Upload and play an audio file (`POST /v1/play/file`, multipart). */
    file(params: PlayFileParams): Promise<PlayResponse>;
    /** Play audio from a URL (`POST /v1/play/url`). */
    url(params: PlayUrlParams): Promise<PlayResponse>;
  };

  /** The history. */
  readonly plays: {
    /** List plays, newest first (`GET /v1/plays`). */
    list(query?: PlaysQuery): Promise<PlaysResponse>;
    /** One play (`GET /v1/plays/{uuid}`). */
    get(uuid: string, query?: PlayQuery): Promise<PlayItemResponse>;
    /** Your newest play (`GET /v1/plays/last`), a 404 QuakError when there is none. */
    last(query?: PlayQuery): Promise<PlayItemResponse>;
    /** Stop one play while it runs (`POST /v1/plays/{uuid}/stop`). */
    stop(uuid: string): Promise<PlayStopResponse>;
    /**
     * Play a play's audio once more, on its speakers or the ones in `to` (`POST /v1/plays/{uuid}/replay`, `"last"`
     * for your newest). While `canReplay` is true.
     */
    replay(uuid: string, params?: ReplayParams): Promise<ReplayResponse>;
    /**
     * Keep a play's audio as a clip (`POST /v1/plays/{uuid}/save`, `"last"` for your newest). Needs a key with scope
     * `create`; while `canSave` is true.
     */
    save(uuid: string, params?: SaveParams): Promise<SaveResponse>;
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
    /** List voices, filtered by provider, gender, locale, model or language (`GET /v1/voices`). */
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

  constructor(options: QuakOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
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
    this.play = {
      text: (params) => unwrap(api.POST("/v1/play/text", { body: params })),
      talk: (params) =>
        unwrap(api.POST("/v1/play/talk", { body: {} as never, bodySerializer: () => toFormData(params) })),
      sound: (params) => unwrap(api.POST("/v1/play/sound", { body: params })),
      clip: (params) => unwrap(api.POST("/v1/play/clip", { body: params })),
      file: (params) =>
        unwrap(api.POST("/v1/play/file", { body: {} as never, bodySerializer: () => toFormData(params) })),
      url: (params) => unwrap(api.POST("/v1/play/url", { body: params })),
    };
    this.plays = {
      list: (query) => unwrap(api.GET("/v1/plays", { params: { query } })),
      get: (uuid, query) => unwrap(api.GET("/v1/plays/{uuid}", { params: { path: { uuid }, query } })),
      last: (query) => unwrap(api.GET("/v1/plays/{uuid}", { params: { path: { uuid: "last" }, query } })),
      stop: (uuid) => unwrap(api.POST("/v1/plays/{uuid}/stop", { params: { path: { uuid } } })),
      replay: (uuid, params = {}) =>
        unwrap(api.POST("/v1/plays/{uuid}/replay", { params: { path: { uuid } }, body: params })),
      save: (uuid, params = {}) =>
        unwrap(api.POST("/v1/plays/{uuid}/save", { params: { path: { uuid } }, body: params })),
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
    const url = `${this.baseUrl.replace(/^http/, "ws")}/v1/plays/watch`;
    return watchPlays(url, this.apiKey, { ...options, workspace: options.workspace ?? this.workspaceHeader });
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
