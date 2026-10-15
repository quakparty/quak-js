# Changelog

All notable changes to `@quak/js`. 0.9.x follows the API while it still changes.

## Unreleased

- `voices.list({ maxCredits?, limit?, offset? })`: voices come in pages now, 500 by default, `limit` up to 5000, with
  `meta: { total, limit, offset }`. Before, only the first 500 of about 1,850 came back
- New types `Effect`, `VoiceLanguage` and `VoiceModel`; OpenAPI snapshot updated (`PlayClient`, `PlayUser`, `PlayKey`,
  `LoginStart` under `components["schemas"]`)
- OpenAPI snapshot updated: query parameters with their plain type (`maxCredits` a number); `GET /v1/sonos`,
  `/v1/groups` and `/v1/keys` always return everything (`meta: { total }`, no `limit`/`offset`); trigger calls up to
  1000 per page

## 0.9.17 - 2026-10-15

- **Breaking for the helper types:** the API's operationIds are hand-picked now, so `operations[...]` and the helpers
  take the new names: `JsonBody<"playText">`, `Query<"listPlays">`, `Success<"getPlay">` (was `postV1PlayText`,
  `getV1Plays`, `getV1PlaysById`). The shortcut types (`Play`, `PlayTextParams` …) keep their names
- `Play`, `Speaker`, `Voice`, `Sound`, `Clip` and `Workspace` come from the API's components now; new `PlayPlayer` and
  `SpeakerPlayer`
- OpenAPI snapshot updated: the objects as `components["schemas"]` (`Play`, `Key`, `Trigger`, `Member` …),
  `workspace.get()` has `platforms`, `GET /v1/clips` (500) and `/v1/groups` (100) with `meta: { total, limit, offset }`

## 0.9.16 - 2026-10-15

**Breaking, following the API's cleanup of errors and answers (quak-api, 15.10.2026):**

- Plays: `credits` is `creditsUsed`, `length` is `seconds` (also clips and sounds)
- Talk live: `credits` in `onReady`, `onDone` and `onSkipped` is `creditsUsed`; the warning before the credits run out
  is `ERROR_INSUFFICIENT_CREDITS` (was `ERROR_NOT_ENOUGH_CREDITS`)
- Merged error codes, e.g. `ERROR_TRIGGER_NOT_FOUND` and the other `…_NOT_FOUND` are `ERROR_NOT_FOUND`, names taken are
  `ERROR_NAME_TAKEN`, schema violations are 400 `ERROR_INVALID_PARAMS` (no 422 any more)
- Raw client: the play routes are `/v1/plays/{id}`, clips `/v1/clips/{id}` (id or slug); lists have no `meta.count`;
  `POST /v1/play-tokens` and `/v1/upload-tickets` answer 201; the user's routes answer in `{ data }`
- OpenAPI snapshot updated: OpenAPI 3.1 (nullable fields as `| null`), platform `BOARD`, `field: "workspace"` when
  the `X-Quak-Workspace` header is the problem

## 0.9.15 - 2026-10-14

- `QuakError.retryAfter`: the seconds from `Retry-After`, on 429 `ERROR_RATE_LIMITED` (the API's new rate limits)
- OpenAPI snapshot updated: one `Error` schema for every error answer (`ErrorBody` now derives from it), validation
  errors of the framework in the same shape (422 `ERROR_INVALID_PARAMS` with `field`), `ERROR_RATE_LIMITED` for every
  429; `ERROR_TOO_MANY_REQUESTS` is gone (resending an invitation too soon is `ERROR_RATE_LIMITED` now)

## 0.9.14 - 2026-10-13

- **Breaking for talk live:** the `ticket` option of `talkLive()` is gone, the API no longer has WebSocket tickets
  (`POST /v1/ws/tickets`). In a browser use a play token as the key: `new Quak({ apiKey: token })`
  (`POST /v1/play-tokens`, 5 minutes, plays, `watch()` and `talkLive()`), see "In a browser" in the README
- `onReady` of `talkLive()` has `balance`; OpenAPI snapshot updated (play tokens, `ERROR_INVALID_TOKEN`)
- OpenAPI snapshot updated: `speakers.list()` comes in the workspace's order (`PUT /v1/speakers/order`), renaming
  locations (`PATCH /v1/locations/{id}`) and the user's display name, both on the raw client `quak.api`

## 0.9.13 - 2026-10-11

- `quak.talkLive({ ticket?, to, effect, …, source?, format?, onReady, onDone, onError, … })`: talk live over
  `GET /v1/play/talk/live` (beta), with `send(frame)`, `update({ effect, ambience, muted, … })`, `end()` and `close()`
- `microphone({ encoding?, onLevel?, stream? })`: the browser's microphone as the source of a talk live, Opus in 20 ms
  packets with WebCodecs, 16-bit PCM where the browser cannot encode Opus

- OpenAPI snapshot updated: the plan limits effects and ambiences. `effects.list()` has `plan` (the smallest plan with
  it) and `available` per entry; a play with one the plan lacks is a 403 `ERROR_PLAN_REQUIRED` with
  `details.requiredPlan`. `workspace.get()` has `features` (`talkLive`, `slack`)

- `watch({ keys: "current" })`: only the plays of the client's key, also the running ones on connect; without it the
  whole workspace as before

## 0.9.12 - 2026-10-11

- **Behaviour change in the API:** `plays.list()` and `plays.last()` without a parameter now return only the plays of
  the request's key; `{ keys: "all" }` returns the whole workspace's. `keys=current|all` replaces `scope=key|all`
  (still accepted, deprecated); the same for the `"last"` routes of stop, replay and save

## 0.9.11 - 2026-10-10

- OpenAPI snapshot updated: `volume` and `volumes` take 10-100 (was 1-100), in plays, workspace defaults and
  triggers; below 10 the API answers 400

## 0.9.10 - 2026-10-10

- `watch({ workspace })`: the workspace to watch (slug or id), sent in the auth message; defaults to
  `X-Quak-Workspace` from the client's `headers`, so a login key watches the same workspace as its other requests

- OpenAPI snapshot updated: stored `effectIntensity` and `ambienceIntensity` (workspace defaults, triggers) are
  `weak`, `medium` or `strong` only, no effect is `none`; plays keep `off` as a bypass for that one play. Platform
  `STREAM_DECK`; credit grants need scope `manage`; `returnTo` for connecting Slack is gone; `speakers` is required when
  changing a group's speakers

## 0.9.9 - 2026-10-09

- OpenAPI snapshot updated: `audioCacheMinutes` moves into `PATCH /v1/workspace`, `PATCH /v1/workspace/audio-cache` is gone
- `fireTrigger(urlOrToken, { body?, query?, baseUrl?, fetch? })`: fire a trigger URL or token without an API key
- Stricter types from the API: numbers and booleans in play params are `number` and `boolean` only, no longer also
  `string` (`volume: "20"` is a type error now; uploads still send them as form text)
- OpenAPI snapshot updated: plays carry `test` (trigger tests, hidden from the history); trigger fields (rules, limits,
  sound settings), `POST /v1/triggers/{id}/test`, `GET /v1/triggers/{id}/calls`, billing changes and their error codes
  for the raw client. `watch()` skips message types it does not know, like `trigger_call`
- OpenAPI snapshot updated: platform `TRIGGER` (plays from a trigger URL); new management routes on the raw client:
  triggers (`/v1/triggers`), billing (`/v1/workspace/billing`) and credit grants (`GET /v1/workspace/credits/grants`);
  error codes for billing and triggers
- OpenAPI snapshot updated: plays carry `user` (who triggered it), `key` (which key, never its token) and `requestId`
  (beta); public invitation routes `GET /v1/invites/{token}` and `POST /v1/invites/{token}/accept` (raw client); error
  codes `ERROR_NO_WORKSPACE`, `ERROR_INVITE_NOT_FOUND`, `ERROR_INVITE_EXPIRED`, without `ERROR_FORBIDDEN_ORIGIN`
- `watch()` no longer treats close code 4403 as final: the API accepts every browser origin and no longer sends it

## 0.9.8 - 2026-10-05

- English examples throughout: README, and the OpenAPI snapshot (kitchen, living-room, bedroom instead of German room
  names, en-GB as the first language)
- OpenAPI snapshot updated: platform `GITHUB`; sounds and sound tags are public (no 401 any more)

## 0.9.7 - 2026-10-03

- No changes to the package: the release workflow runs on ubuntu-26.04 and announces releases

## 0.9.6 - 2026-10-01

- `quak.keys.current()` (`GET /v1/keys/current`, any key): the key with its scope, user and workspace, the setup check

## 0.9.5 - 2026-10-01

- `quak.plays.replay(id, params?)` and `quak.plays.save(id, { name? })`, also with `"last"`
- `quak.workspace.get()`: balance, time zone, playback defaults and `limits`
- `quak.watch({ onPlay, onReady?, onClose?, onError? })`: the live status over the global WebSocket, reconnecting after
  a drop, with `close()` and `connected`

## 0.9.4 - 2026-09-30

- OpenAPI snapshot updated, **breaking in the API:** key scopes are `play` < `create` < `manage`, `read` is gone;
  uploading and saving clips needs `create`. The lookups need `play`
- `quak.stop()` without `to` stops all speakers (API change, the client already sent no `to`)
- Platform `JS` for plays made through this package (was `API_JS`), new platforms `MACOS`, `IOS`, `IPADOS`, `RAYCAST`,
  `HOME_ASSISTANT`
- Plays carry `canReplay` and `canSave`; new error codes `ERROR_NO_TESTERS` and `ERROR_NOT_VOTED`

## 0.9.3 - 2026-09-30

- OpenAPI snapshot updated: new limits (text 1,000 characters, talk and talk live 180 s, file, processed url and clips
  180 s with 10 MB uploads), `limits` on the workspace (`GET /v1/workspace` on the raw client)
- OpenAPI snapshot updated: upload tickets (`POST /v1/upload-tickets`, a single-use `qk_upt_…` key for browser uploads,
  usable as `apiKey` for `play.file`, `play.talk` and `POST /v1/clips`), resending invites, the profile name, the error
  codes `ERROR_INVITE_ACCEPTED` and `ERROR_TOO_MANY_REQUESTS`

## 0.9.2 - 2026-09-29

- Internal option `client` for Quak's own clients built on this package: their `<name>/<version>` in `X-Quak-Client`
  instead of `js/<version>`

## 0.9.1 - 2026-09-29

- Package description names quak.party and text-to-speech
- OpenAPI snapshot updated: `POST /v1/workspaces` documents the new limits (20 own workspaces, 100 starting credits)

## 0.9.0 - 2026-09-29

First release of the new client for the Quak API v1 routes (`/v1/...`).

- `new Quak({ apiKey, fetch, headers })`
- Plays in the order text, talk, sound, clip, file, url: `quak.play.text()` … `quak.play.url()`, uploads as multipart
- `quak.stop()`, history with `quak.plays.list()`, `.get()`, `.last()`, `.stop()`
- Lookups for everything a play can name: `quak.speakers.list()`, `quak.voices.list()`,
  `.languages()`, `.locales()`, `.models()`, `quak.sounds.list()`, `.tags()`, `quak.clips.list()`,
  `quak.effects.list()`; management routes stay on the raw client
- README with the parameters of every play kind, generated from the OpenAPI schema (`bun docs`)
- Credit balance from `X-Quak-Credits` in `quak.credits`
- `QuakError` with `status`, `code`, `details`, `field` and `requestId`, network failures as `ERROR_NETWORK`
- `X-Quak-Client: js/<version> (<os>; <arch>)` on every request, `js/<version>` in browsers
- Strict types from the API schema: play params with required fields and enums (effects, ambiences), response enums
  (play type and status), `QuakError.code` as `ErrorCode` with all API error codes
- Typed raw client `quak.api` for every route, `unwrap()` for its results, all types generated from the OpenAPI schema
