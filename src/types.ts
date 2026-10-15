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

export type PlayTextParams = JsonBody<"postV1PlayText">;
export type PlayTalkParams = Omit<MultipartBody<"postV1PlayTalk">, "file"> & UploadFields;
export type PlaySoundParams = JsonBody<"postV1PlaySound">;
export type PlayClipParams = JsonBody<"postV1PlayClip">;
export type PlayFileParams = Omit<MultipartBody<"postV1PlayFile">, "file"> & UploadFields;
export type PlayUrlParams = JsonBody<"postV1PlayUrl">;

/** The answer of every play route: `{ data: Play }`. */
export type PlayResponse = Success<"postV1PlayText">;
/** One play, as in the history (`GET /v1/plays/{id}`). */
export type Play = PlayResponse["data"];

export type StopParams = JsonBody<"postV1PlayStop">;
export type StopResponse = Success<"postV1PlayStop">;

// Lookups: what to name in a play

export type SpeakersQuery = Query<"getV1Speakers">;
export type SpeakersResponse = Success<"getV1Speakers">;
export type Speaker = SpeakersResponse["data"][number];

export type VoicesQuery = Query<"getV1Voices">;
export type VoicesResponse = Success<"getV1Voices">;
export type Voice = VoicesResponse["data"][number];
export type VoiceLanguagesResponse = Success<"getV1VoicesLanguages">;
export type VoiceLocalesQuery = Query<"getV1VoicesLocales">;
export type VoiceLocalesResponse = Success<"getV1VoicesLocales">;
export type VoiceModelsResponse = Success<"getV1VoicesModels">;

export type SoundsQuery = Query<"getV1Sounds">;
export type SoundsResponse = Success<"getV1Sounds">;
export type Sound = SoundsResponse["data"][number];
export type SoundTagsResponse = Success<"getV1SoundsTags">;

export type ClipsResponse = Success<"getV1Clips">;
export type Clip = ClipsResponse["data"][number];

export type EffectsQuery = Query<"getV1Effects">;
export type EffectsResponse = Success<"getV1Effects">;

export type PlaysQuery = Query<"getV1Plays">;
export type PlaysResponse = Success<"getV1Plays">;
export type PlayQuery = Query<"getV1PlaysById">;
export type PlayItemResponse = Success<"getV1PlaysById">;
export type PlayStopResponse = Success<"postV1PlaysByIdStop">;
export type ReplayParams = JsonBody<"postV1PlaysByIdReplay">;
export type ReplayResponse = Success<"postV1PlaysByIdReplay">;
export type SaveParams = JsonBody<"postV1PlaysByIdSave">;
export type SaveResponse = Success<"postV1PlaysByIdSave">;

// The workspace of the key

export type WorkspaceResponse = Success<"getV1Workspace">;
export type Workspace = WorkspaceResponse["data"];
export type CurrentKeyResponse = Success<"getV1KeysCurrent">;

/** The error body every route answers with on 4xx and 5xx. */
export type ErrorBody = components["schemas"]["Error"];

/**
 * The code of a QuakError: one of the API's codes, `ERROR_NETWORK` when no answer came, or a newer code the API added
 * after this version (hence `string & {}`, which keeps the autocompletion).
 */
export type ErrorCode = ErrorBody["error"]["code"] | "ERROR_NETWORK" | (string & {});

/** All paths of the API, for the raw client. */
export type Paths = paths;
