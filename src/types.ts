// Types for the wrapper, all derived from the generated schema (src/generated/schema.ts). Nothing here copies a
// shape by hand: when the API changes, `bun generate` changes these too.

import type { components, operations, paths } from "./generated/schema.js";

export type { components, operations, paths } from "./generated/schema.js";

type Content<T> = T extends { content: infer C } ? C : never;

/** The JSON request body of an operation. */
export type JsonBody<Op extends keyof operations> =
  Content<NonNullable<operations[Op]["requestBody"]>> extends {
    "application/json": infer B;
  }
    ? B
    : never;

/** The multipart request body of an operation (uploads). */
export type MultipartBody<Op extends keyof operations> =
  Content<NonNullable<operations[Op]["requestBody"]>> extends {
    "multipart/form-data": infer B;
  }
    ? B
    : never;

/** The query parameters of an operation. */
export type Query<Op extends keyof operations> = NonNullable<operations[Op]["parameters"]["query"]>;

type Responses<Op extends keyof operations> = operations[Op]["responses"];
type JsonOf<R> = Content<R> extends { "application/json": infer B } ? B : never;

/** The parsed JSON body of a successful (2xx) answer. */
export type Success<Op extends keyof operations> = {
  [S in keyof Responses<Op>]: S extends 200 | 201 | 202 ? JsonOf<Responses<Op>[S]> : never;
}[keyof Responses<Op>];

/** A file for an upload: a Blob or File (browsers, Node, Bun, Deno) or raw bytes. */
export type Upload = Blob | ArrayBuffer | Uint8Array;

/** Extra fields of an upload: the file itself and, for raw bytes, a file name (helps the server pick the format). */
type UploadFields = { file: Upload; filename?: string };

// Play kinds, always in this order: text, talk, sound, clip, file, url

export type PlayTextParams = JsonBody<"playText">;
export type PlayTalkParams = Omit<MultipartBody<"playTalk">, "file"> & UploadFields;
export type PlaySoundParams = JsonBody<"playSound">;
export type PlayClipParams = JsonBody<"playClip">;
export type PlayFileParams = Omit<MultipartBody<"playFile">, "file"> & UploadFields;
export type PlayUrlParams = JsonBody<"playUrl">;

/** The answer of every play route: `{ data: Play }`. */
export type PlayResponse = Success<"playText">;
/** One play, as in the history (`GET /v1/plays/{id}`). */
export type Play = components["schemas"]["Play"];
/** One speaker of a play, with its own status. */
export type PlayPlayer = components["schemas"]["PlayPlayer"];

export type StopParams = JsonBody<"stopSpeakers">;
export type StopResponse = Success<"stopSpeakers">;

// Lookups: what to name in a play

export type SpeakersQuery = Query<"listSpeakers">;
export type SpeakersResponse = Success<"listSpeakers">;
export type Speaker = components["schemas"]["Speaker"];
/** One player (a Sonos speaker) of a speaker. */
export type SpeakerPlayer = components["schemas"]["SpeakerPlayer"];

export type VoicesQuery = Query<"listVoices">;
export type VoicesResponse = Success<"listVoices">;
export type Voice = components["schemas"]["Voice"];
export type VoiceLanguagesResponse = Success<"listVoiceLanguages">;
export type VoiceLanguage = components["schemas"]["VoiceLanguage"];
export type VoiceLocalesQuery = Query<"listVoiceLocales">;
export type VoiceLocalesResponse = Success<"listVoiceLocales">;
export type VoiceModelsResponse = Success<"listVoiceModels">;
export type VoiceModel = components["schemas"]["VoiceModel"];

export type SoundsQuery = Query<"listSounds">;
export type SoundsResponse = Success<"listSounds">;
export type Sound = components["schemas"]["Sound"];
export type SoundTagsResponse = Success<"listSoundTags">;

export type ClipsResponse = Success<"listClips">;
export type Clip = components["schemas"]["Clip"];

export type EffectsQuery = Query<"listEffects">;
export type EffectsResponse = Success<"listEffects">;
/** An effect or ambience, with the plan it needs. */
export type Effect = components["schemas"]["Effect"];

export type PlaysQuery = Query<"listPlays">;
export type PlaysResponse = Success<"listPlays">;
export type PlayQuery = Query<"getPlay">;
export type PlayItemResponse = Success<"getPlay">;
export type PlayStopResponse = Success<"stopPlay">;
export type ReplayParams = JsonBody<"replayPlay">;
export type ReplayResponse = Success<"replayPlay">;
export type SaveParams = JsonBody<"savePlayAsClip">;
export type SaveResponse = Success<"savePlayAsClip">;

// The workspace of the key

export type WorkspaceResponse = Success<"getWorkspace">;
export type Workspace = components["schemas"]["Workspace"];
export type CurrentKeyResponse = Success<"getCurrentKey">;

/** The error body every route answers with on 4xx and 5xx. */
export type ErrorBody = components["schemas"]["Error"];

/**
 * The code of a QuakError: one of the API's codes, `ERROR_NETWORK` when no answer came, or a newer code the API added
 * after this version (hence `string & {}`, which keeps the autocompletion).
 */
export type ErrorCode = ErrorBody["error"]["code"] | "ERROR_NETWORK" | (string & {});

/** All paths of the API, for the raw client. */
export type Paths = paths;
