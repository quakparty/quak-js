# @quak/js

JavaScript and TypeScript client for the [Quak](https://quak.party) API: text-to-speech announcements, sounds, clips,
files and URLs on your Sonos speakers.

> **Status: beta.** 0.9.x follows the API while it is still changing, so methods and types may change in any 0.9
> release.

- Types for every route, generated from the API's OpenAPI schema
- A small wrapper for the common calls, the typed raw client for everything else
- Node 20+, Bun, Deno and browsers, ESM only, one dependency ([`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/))

## Install

```sh
npm install @quak/js
bun add @quak/js
pnpm add @quak/js
deno add npm:@quak/js
```

## Quick start

```ts
import { Quak } from "@quak/js";

const quak = new Quak({ apiKey: process.env.QUAK_API_KEY });

const { data: play } = await quak.play.text({ text: "Meeting in 5 minutes", to: "office" });
console.log(play.status, play.credits, quak.credits);
```

Create an API key in the [web app](https://quak.party/app/settings/keys) under Settings → API keys (or with
`POST /v1/keys`). A key belongs to one workspace and has a scope: `play` (play, costs credits, plus speakers, voices,
sounds and history) < `create` (and upload and save clips) < `manage` (and settings). `play` is enough for announcements. Keys look like `qk_key_…`;
keep them out of browser code you ship to others.

## Playing

Every play method takes the fields of its route and returns the parsed answer, `{ data: Play }`. The
[parameters](#parameters) of each kind follow below the examples.

### text

Speak a text with a voice from `quak.voices.list()`.

```ts
// The simplest play: the workspace defaults pick voice, speakers and volume
await quak.play.text({ text: "Dinner is ready!" });

// Two rooms, a chosen voice and a quieter volume
await quak.play.text({
  text: "The meeting starts in 5 minutes.",
  to: ["kitchen", "office"],
  voice: "elevenlabs-flash-v2-5-eric",
  volume: 25,
});

// A radio DJ in a café, with the quak sound before and no outro
await quak.play.text({
  text: "Good morning, everyone!",
  language: "en",
  effect: "radiodj",
  ambience: "cafe",
  ambienceIntensity: "weak",
  intro: "quakquak",
  outro: "none",
});

// Louder in the kitchen than in the bedroom, even during quiet hours
await quak.play.text({
  text: "The laundry is done.",
  to: ["kitchen", "bedroom"],
  volumes: { kitchen: 40, bedroom: 10 },
  quietHours: "none",
});

// Starts in 30 seconds (status SCHEDULED) and can be stopped until then
const { data: scheduled } = await quak.play.text({
  text: "Pizza is out of the oven.",
  startIn: 30,
});
await quak.plays.stop(scheduled.id);

// Only make the audio, nothing plays on Sonos
const { data: preview } = await quak.play.text({
  text: "Just a test.",
  preview: true,
});
console.log(preview.audioUrl);
```

### talk

Play what someone said into a mic, after release. The upload is sent as multipart.

```ts
// A recording, e.g. the Blob from a MediaRecorder, on every speaker
await quak.play.talk({ file: recording, to: "all" });

// With a voice effect for the whole take
await quak.play.talk({
  file: recording,
  effect: "megaphone",
  effectIntensity: "strong",
});

// Effects that change during the take: stadium from the start,
// a strong robot voice after 2.4 s, back to normal after 5 s
await quak.play.talk({
  file: recording,
  effects: [
    { at: 0, ambience: "stadium" },
    { at: 2.4, effect: "robot", effectIntensity: "strong" },
    { at: 5, effect: "none" },
  ],
});
```

### sound

Play a built-in sound from `quak.sounds.list()`.

```ts
// Sonos fetches the sound from the CDN (1 credit)
await quak.play.sound({ sound: "quakquak", to: "office" });

// Priority: replaces every clip right away, also a running priority clip (see Priority)
await quak.play.sound({
  sound: "quakquak",
  to: "all",
  priority: true,
  volume: 50,
});

// Mixed on the server with an echo and your clip as the intro (2 credits)
await quak.play.sound({
  sound: "quakquak",
  process: true,
  effect: "echo",
  intro: "clip:front-door",
});
```

### clip

Play one of the workspace's own clips from `quak.clips.list()`. A clip has to be there first: record or upload it in
the [web app](https://quak.party/app/play/clip), save a play as a clip (`POST /v1/plays/{uuid}/save`), or upload one
with the raw client (`POST /v1/clips`, see [Everything else](#everything-else-the-raw-client)).

```ts
// The doorbell with priority: normal plays can't cut it off (see Priority)
await quak.play.clip({ clip: "front-door", priority: true });

// Only in the living room, quietly, and also during quiet hours
await quak.play.clip({
  clip: "front-door",
  to: "living-room",
  volume: 15,
  quietHours: "none",
});
```

### file

Upload and play an audio file, max. 10 MB and 180 s, as multipart. A `File` brings its own name; for raw bytes pass
`filename`. Lists go as CSV (`to`), objects as JSON (`volumes`).

```ts
// A File, e.g. from an <input type="file">
await quak.play.file({ file, to: "office" });

// Raw bytes from disk (Bun, Node: fs.readFile), with a name so the server knows the format
await quak.play.file({
  file: await Bun.file("bell.mp3").bytes(),
  filename: "bell.mp3",
  volume: 20,
});

// A voice memo in the rain, with a pause before and after the quak sound
await quak.play.file({
  file: memo,
  filename: "memo.m4a",
  ambience: "rain",
  intro: "quakquak",
  gap: 300,
});
```

### url

Play audio from a public URL.

```ts
// The server downloads and converts it, intro, outro and effects apply
await quak.play.url({ url: "https://example.com/news.mp3" });

// Sonos fetches the MP3 itself: faster, 1 credit, no processing
await quak.play.url({
  url: "https://example.com/gong.mp3",
  process: false,
  to: ["kitchen", "office"],
});

// Download again instead of using the cache, e.g. for a file that changes
await quak.play.url({
  url: "https://example.com/weather-today.mp3",
  skipCache: true,
  effect: "telephone",
});
```

### Priority

Sonos plays one clip at a time per speaker, and a new clip replaces the running one. `priority` decides who may
replace whom:

- **Default, `priority: false`** (Sonos `LOW`): replaces a running normal clip, from Quak or another app. While a
  priority clip plays, the speaker refuses it: that speaker is `SKIPPED`, and when all are busy the play is `SKIPPED`
  with `skipReason: "BUSY"` (status 200, no credits).
- **`priority: true`** (Sonos `HIGH`): replaces every running clip at once, whatever its priority. While it plays,
  normal plays are refused. Use it sparingly, for things that must not be cut off.

There is no workspace default, a play only has priority when it asks for it. Other apps' clips (doorbells, alarms)
follow the same Sonos rules.

## Parameters

The tables are generated from the API's OpenAPI schema; the [API reference](https://quak.party/docs/api) has
the full details, the answers and the errors.

### Common parameters

Every play kind takes these. Missing ones come from the workspace defaults (`PATCH /v1/workspace/defaults`).

<!-- params:common -->

| Name                | Type                                            | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intro`             | `string`                                        |          | sound slug, "clip:&lt;slug>" for one of your clips or "none", default: the user default                                                                                                                                                                                                                                                                                                                                |
| `outro`             | `string`                                        |          | sound slug, "clip:&lt;slug>" for one of your clips or "none", default: the user default                                                                                                                                                                                                                                                                                                                                |
| `gap`               | `number` 0-1000                                 |          | pause between intro, content and outro in ms: 0, 100, ..., 1000, default: the user default                                                                                                                                                                                                                                                                                                                             |
| `effect`            | `string`                                        |          | Beta, may change without notice. voice effect, default: the workspace default (sounds and clips only with process: true). One of `none`, `vibrato`, `megaphone`, `bitcrush`, `radiodj`, `robot`, `helium`, `monster`, `lofi`, `echo`, `telephone`, `chorus`, `underwater`, `announcement`, `faster`, `slower`, `reverse`                                                                                               |
| `effectIntensity`   | `"off"` \| `"weak"` \| `"medium"` \| `"strong"` |          | Beta, may change without notice. strength of the voice effect, default: the workspace default (medium). off = no effect for this play, the effect stays chosen (a bypass, only per play). What each level means is tuned per effect.                                                                                                                                                                                   |
| `ambience`          | `string`                                        |          | Beta, may change without notice. place behind the voice, combinable with effect, default: the workspace default (sounds and clips only with process: true). One of `none`, `station`, `stadium`, `f1`, `airport`, `tennis`, `pool`, `cafe`, `rain`, `beach`, `forest`, `office`, `church`, `christmas`, `cabin`, `supermarket`, `spaceship`                                                                            |
| `ambienceIntensity` | `"off"` \| `"weak"` \| `"medium"` \| `"strong"` |          | Beta, may change without notice. level of the ambience, default: the workspace default (medium). off = no ambience for this play, the ambience stays chosen (only per play)                                                                                                                                                                                                                                            |
| `volume`            | `number` 1-100                                  |          | 1-100, default: the workspace's volume                                                                                                                                                                                                                                                                                                                                                                                 |
| `volumes`           | `Record<string, number>`                        |          | volume per speaker, overrides volume for the players of that speaker: an object speaker slug → 1-100 (multipart: a JSON string). The most specific speaker wins per player (room before group, location, "all"), players without an entry get volume. The volume each player got is in params.volumeBySpeaker.                                                                                                         |
| `to`                | `string[]` \| `string`                          |          | speaker slugs from GET /v1/speakers (rooms, groups, locations, all) as array or CSV, default: the workspace's default speakers                                                                                                                                                                                                                                                                                         |
| `quietHours`        | `string`                                        |          | when nothing plays, overrides the user default (22-7), e.g. "22-7", "su-th 22-7, fr-sa 23-9" or "none"                                                                                                                                                                                                                                                                                                                 |
| `priority`          | `boolean`                                       |          | Default false (Sonos priority LOW): replaces a running LOW clip, of Quak or another app, but a speaker playing a HIGH clip refuses it and is skipped (all speakers busy: status SKIPPED, skipReason BUSY, 200, no credits). true (HIGH): replaces every running clip at once, also HIGH clips of other apps such as a doorbell, and new LOW plays are refused while it plays. Use sparingly, for urgent announcements. |
| `startIn`           | `number` 0-60                                   |          | seconds until the play goes to Sonos, 0-60, decimals allowed; the audio is made right away, the answer is 202 with status SCHEDULED and startsAt, credits are charged at the start. Stop it with POST /v1/plays/:id/stop before. Not with preview or talk live.                                                                                                                                                        |
| `preview`           | `boolean`                                       |          | true: only produce the audio (audioUrl), nothing plays on Sonos                                                                                                                                                                                                                                                                                                                                                        |

<!-- /params:common -->

### `text` parameters

<!-- params:text -->

| Name        | Type      | Required | Description                                                                                                         |
| ----------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `text`      | `string`  | yes      | the text, 1-1000 characters (about 60-70 s spoken)                                                                  |
| `voice`     | `string`  |          | voice slug from /v1/voices, default: the user default                                                               |
| `language`  | `string`  |          | multi-language voices only: the language to speak, e.g. en or en-GB                                                 |
| `skipCache` | `boolean` |          | true: produce the audio again instead of using the cache, for text also a new synthesis. Ignored without processing |
| `process`   | `boolean` |          | always processed: true changes nothing, false is an error (400)                                                     |

Plus the [common parameters](#common-parameters): `intro`, `outro`, `gap`, `effect`, `effectIntensity`, `ambience`, `ambienceIntensity`, `volume`, `volumes`, `to`, `quietHours`, `priority`, `startIn`, `preview`.

<!-- /params:text -->

### `talk` parameters

<!-- params:talk -->

| Name       | Type                                    | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`     | `Blob` \| `Uint8Array` \| `ArrayBuffer` | yes      | the spoken audio, max. 10 MB, any common audio format (browser MediaRecorder WebM/Opus, iOS M4A, WAV etc.), mono is enough, Opus or M4A keep the upload small                                                                                                                                                                                                                                                                                                                                                                                            |
| `filename` | `string`                                |          | name of the upload, helps the server tell the format of raw bytes; default: the File's name or "audio"                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `process`  | `boolean`                               |          | always processed: true changes nothing, false is an error (400)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `effects`  | `object[]`                              |          | change the voice effect and the ambience during the take, instead of effect, effectIntensity, ambience and ambienceIntensity (never together): a JSON array of up to 100 changes {"at": seconds since the start of the recording, "effect"?, "effectIntensity"?, "ambience"?, "ambienceIntensity"?}, ascending. A change sets only what it names, the rest stays; before the first change no effect and no ambience, intensities medium. Faster, slower and reverse work for parts too (the take gets longer or shorter, the ambience is not stretched). |

Plus the [common parameters](#common-parameters): `intro`, `outro`, `gap`, `effect`, `effectIntensity`, `ambience`, `ambienceIntensity`, `volume`, `volumes`, `to`, `quietHours`, `priority`, `startIn`, `preview`.

<!-- /params:talk -->

### `sound` parameters

<!-- params:sound -->

| Name        | Type      | Required | Description                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sound`     | `string`  | yes      | sound slug from /v1/sounds                                                                                                                                                                                                                                                                                                                         |
| `process`   | `boolean` |          | true: intro, outro, gap, effect and ambience like a processed URL, mixed on the server and cached (2 credits). The account defaults (intro, outro, gap, effect, ambience) apply, fields in the request override them, none turns one off. Default false: played as stored, Sonos fetches it from the CDN (1 credit), processing fields are ignored |
| `skipCache` | `boolean` |          | true: produce the audio again instead of using the cache, for text also a new synthesis. Ignored without processing                                                                                                                                                                                                                                |

Plus the [common parameters](#common-parameters): `intro`, `outro`, `gap`, `effect`, `effectIntensity`, `ambience`, `ambienceIntensity`, `volume`, `volumes`, `to`, `quietHours`, `priority`, `startIn`, `preview`.

<!-- /params:sound -->

### `clip` parameters

<!-- params:clip -->

| Name        | Type      | Required | Description                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clip`      | `string`  | yes      | clip slug from /v1/clips                                                                                                                                                                                                                                                                                                                           |
| `process`   | `boolean` |          | true: intro, outro, gap, effect and ambience like a processed URL, mixed on the server and cached (2 credits). The account defaults (intro, outro, gap, effect, ambience) apply, fields in the request override them, none turns one off. Default false: played as stored, Sonos fetches it from the CDN (1 credit), processing fields are ignored |
| `skipCache` | `boolean` |          | true: produce the audio again instead of using the cache, for text also a new synthesis. Ignored without processing                                                                                                                                                                                                                                |

Plus the [common parameters](#common-parameters): `intro`, `outro`, `gap`, `effect`, `effectIntensity`, `ambience`, `ambienceIntensity`, `volume`, `volumes`, `to`, `quietHours`, `priority`, `startIn`, `preview`.

<!-- /params:clip -->

### `file` parameters

<!-- params:file -->

| Name        | Type                                    | Required | Description                                                                                                                                                  |
| ----------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `file`      | `Blob` \| `Uint8Array` \| `ArrayBuffer` | yes      | the audio file, max. 10 MB and 180 s, any common audio format (MP3, M4A/AAC, Opus, WAV, FLAC etc.), mono is enough, compressed formats keep the upload small |
| `filename`  | `string`                                |          | name of the upload, helps the server tell the format of raw bytes; default: the File's name or "audio"                                                       |
| `skipCache` | `boolean`                               |          | true: produce the audio again instead of using the cache, for text also a new synthesis. Ignored without processing                                          |
| `process`   | `boolean`                               |          | always processed: true changes nothing, false is an error (400)                                                                                              |

Plus the [common parameters](#common-parameters): `intro`, `outro`, `gap`, `effect`, `effectIntensity`, `ambience`, `ambienceIntensity`, `volume`, `volumes`, `to`, `quietHours`, `priority`, `startIn`, `preview`.

<!-- /params:file -->

### `url` parameters

<!-- params:url -->

| Name        | Type      | Required | Description                                                                                                                                                                                                               |
| ----------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`       | `string`  | yes      | http(s) URL of an audio file                                                                                                                                                                                              |
| `process`   | `boolean` |          | false: Sonos fetches the URL itself, without intro, outro, effect and ambience (those fields are then ignored). Then it must be MP3 (or WAV) on a public HTTPS URL, use MP3: Sonos skips WAV files shorter than about 1 s |
| `skipCache` | `boolean` |          | true: produce the audio again instead of using the cache, for text also a new synthesis. Ignored without processing                                                                                                       |

Plus the [common parameters](#common-parameters): `intro`, `outro`, `gap`, `effect`, `effectIntensity`, `ambience`, `ambienceIntensity`, `volume`, `volumes`, `to`, `quietHours`, `priority`, `startIn`, `preview`.

<!-- /params:url -->

## Stop, history and lookups

### Stop

```ts
// Whatever plays on these speakers, also other apps
await quak.stop({ to: "kitchen" });

// Everything, on all speakers
await quak.stop();

// Just this play
await quak.plays.stop(play.id);
```

`quak.stop()` sends a silent priority clip, so it always works. For about a second afterwards the speakers refuse
normal plays. `quak.plays.stop(id)` stops with the play's own priority.

### History

```ts
const { data: plays, meta } = await quak.plays.list({ limit: 20, type: "TEXT" });
const { data: one } = await quak.plays.get(plays[0]!.id);
const { data: last } = await quak.plays.last(); // your newest play
```

### Replay and save

```ts
// Once more, in another room (only the base fee); "last" is your newest play
await quak.plays.replay(play.id, { to: "kitchen" });
await quak.plays.replay("last");

// Keep what played as a clip, e.g. a recorded talk (needs a key with scope create)
const { data: clip } = await quak.plays.save(play.id, { name: "Doorbell" });
await quak.play.clip({ clip: clip.slug });
```

Both work while the play's audio is still there: `play.canReplay` and `play.canSave` tell.

### Live status

```ts
const watch = quak.watch({
  onPlay: (play) => console.log(play.id, play.status), // every running play once, then every change
  onReady: () => console.log("connected"),
  onError: (error) => console.error(error.code), // e.g. ERROR_INVALID_API_KEY, which also ends the watch
});

// later
watch.close();
```

A WebSocket to `GET /v1/plays/watch`. After a drop it connects again by itself (pauses from 1 to 30 s) and gets the
running plays again. It needs the global `WebSocket` (Node 22 or newer, Bun, Deno, browsers); on Node 20 pass one,
e.g. `quak.watch({ WebSocket: (await import("ws")).WebSocket, onPlay })`.

### Lookups

Everything a play can name, read-only (scope `play`). Each returns the parsed answer, `{ data, … }`.

| Method                                                                                 | Route                                             | For                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------ |
| `quak.speakers.list({ type? })`                                                        | `GET /v1/speakers`                                | the slugs for `to`             |
| `quak.voices.list({ provider?, gender?, locale?, model?, multiLanguage?, language? })` | `GET /v1/voices`                                  | `voice`                        |
| `quak.voices.languages()`, `.locales({ language? })`, `.models()`                      | `GET /v1/voices/languages`, `/locales`, `/models` | `language`, filters            |
| `quak.sounds.list({ q?, tags?, limit?, offset? })`, `quak.sounds.tags()`               | `GET /v1/sounds`, `/v1/sounds/tags`               | `sound`, `intro`, `outro`      |
| `quak.clips.list()`                                                                    | `GET /v1/clips`                                   | `clip`, `intro: "clip:<slug>"` |
| `quak.effects.list({ kind? })`                                                         | `GET /v1/effects`                                 | `effect`, `ambience`           |

```ts
// Speak with the first English voice
const { data: voices } = await quak.voices.list({ language: "en" });
await quak.play.text({ text: "Hello everyone!", voice: voices[0]!.slug });

// Play the first sound the search finds
const { data: sounds } = await quak.sounds.list({ q: "bell" });
if (sounds[0]) {
  await quak.play.sound({ sound: sounds[0].slug });
}

// Find a speaker by its name, else play everywhere
const { data: speakers } = await quak.speakers.list();
const office = speakers.find((speaker) => speaker.name === "Office");
await quak.play.text({ text: "Coffee is ready.", to: office?.slug ?? "all" });

// Show the ambiences with what they sound like
const { data: ambiences } = await quak.effects.list({ kind: "ambience" });
for (const ambience of ambiences) {
  console.log(`${ambience.id}: ${ambience.description}`);
}
```

## Triggers

A trigger is a secret URL (`https://api.quak.party/t/qk_trg_…`) that plays a fixed announcement, made in the
[web app](https://quak.party/app). `fireTrigger` calls it, with no API key, from servers and browsers alike:

```ts
import { fireTrigger } from "@quak/js";

// the URL or just the token; body fields fill the trigger's {{variables}}
const { data } = await fireTrigger(process.env.QUAK_TRIGGER_URL!, { body: { name: "Ben" } });
if (data.status === "skipped") {
  console.log(data.reason); // COOLDOWN, QUIET_HOURS, DAILY_LIMIT etc., not an error
}
```

Options: `body` (sent as JSON, wins over `query` on the same name), `query`, `baseUrl` (for a bare token) and
`fetch`. Errors are QuakErrors, e.g. `ERROR_TRIGGER_NOT_FOUND` or `ERROR_ORIGIN_NOT_ALLOWED`. Triggers are managed in
the web app only.

## Credits and limits

Every authenticated answer carries the workspace's balance in `X-Quak-Credits`. The client keeps the latest one in
`quak.credits` (`null` before the first request). What a play cost is in `play.credits`.

When a client is set up, `quak.keys.current()` (`GET /v1/keys/current`, any key) checks the key in one call: its
name and scope, the user and the workspace.

```ts
const { data } = await quak.keys.current();
console.log(`Key "${data.name}", scope ${data.scope}, workspace "${data.workspace.name}"`);
```

`quak.workspace.get()` (`GET /v1/workspace`) has the balance too, plus the time zone, the playback defaults and the
`limits`, to check a text or an upload before sending it:

```ts
const { data: workspace } = await quak.workspace.get();
const { textCharacters, audioSeconds, uploadBytes } = workspace.limits;
```

## Everything else: the raw client

`quak.api` is a typed [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) client with the same key and headers,
for every route of the API. The wrapper covers playing and the lookups only; managing keys, the workspace, members,
invites, groups (already part of `speakers.list()`), Sonos accounts, integrations, the user and clips (upload, rename, delete) stays on the raw client. It returns `{ data, error, response }` and does not throw on API errors; wrap it in
`unwrap` to get the body or a `QuakError`:

```ts
import { unwrap } from "@quak/js";

const { data: sounds } = await unwrap(quak.api.GET("/v1/sounds"));
const { data: key } = await unwrap(quak.api.POST("/v1/keys", { body: { name: "Doorbell" } }));
```

The generated types are exported too (`paths`, `operations`, `components`), plus shortcuts such as `Play`,
`Speaker`, `PlayTextParams` and the helpers `JsonBody<"postV1Keys">`, `Query<"getV1Plays">`, `Success<"getV1Sounds">`.

## Errors

The wrapper methods and `unwrap` throw a `QuakError`:

```ts
import { QuakError } from "@quak/js";

try {
  await quak.play.text({ text: "Hi" });
} catch (error) {
  if (error instanceof QuakError) {
    error.status; // 403
    error.code; // "ERROR_INSUFFICIENT_SCOPE"
    error.message; // what went wrong
    error.details; // { required: "play" }
    error.field; // the parameter, for validation errors
    error.requestId; // X-Request-Id, quote it in a bug report
  }
}
```

When no answer arrives at all (offline, DNS, CORS, aborted), the error is a `QuakError` with `status` 0 and `code`
`ERROR_NETWORK`, the original error in `cause`. A play during quiet hours is not an error: it answers with status
`SKIPPED`.

## Client name

The API records which client sent a play. This library always sends `X-Quak-Client: js/<version> (<os>; <arch>)` in
Node, Bun and Deno and `js/<version>` in browsers, never a host name, so plays sent through it show up as `js` in the
history. Extra `headers` cannot replace it.

## Options

| Option    | Default        | What it does                                               |
| --------- | -------------- | ---------------------------------------------------------- |
| `apiKey`  |                | `Authorization: Bearer <key>`                              |
| `fetch`   | global `fetch` | a custom fetch (tests, proxies, retries)                   |
| `headers` |                | extra headers for every request (e.g. your `X-Request-Id`) |

## Runtimes

Node 20 or newer, Bun, Deno (`npm:@quak/js`) and current browsers: anything with `fetch`, `FormData` and `Blob`. CI
runs the built package on Node 20, 22, 24 and Deno.

`quak.watch()` also needs a WebSocket, see [Live status](#live-status).

**Not yet:** talk live (`GET /v1/play/talk/live`, a WebSocket). Use the raw WebSocket of your runtime for now, see the
API reference.

## License

MIT for this library. The Quak API itself is a proprietary service, see [quak.party/terms](https://quak.party/terms).
