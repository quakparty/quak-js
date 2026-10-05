# Repository guidelines

`@quak/js`, the JavaScript/TypeScript client for the Quak API. Public repository, MIT.

## Language

Everything in this repository is in English: code, comments, error messages, README, CHANGELOG, these notes and
commit messages. The package is for third parties. This holds for all public Quak repositories (rule of 03.10.2026,
quak-api `docs/repos.md`): German planning notes are removed, not translated.

## Planning

There is one backlog for all Quak repositories, in quak-api `docs/backlog.md` (private). This repository has no planning
files of its own (no plan.md, todo.md or backlog sections). New open items go to the Claude session quak-api, which
enters them there.

## Structure

- `DEVELOPMENT.md`: commands and the release flow, on purpose not linked from the README. Keep it in sync when scripts
  or the release change.
- `src/index.ts`: public exports.
- `src/client.ts`: the `Quak` class, the thin hand-written layer over `openapi-fetch`: headers, `play.*`, `stop`,
  `plays.*` (with `replay` and `save`), `workspace.get()` (scope `play`, for credits and `limits`), `keys.current()` (any key, the setup check), `credits`,
  `watch()`
  and the lookups for everything a play can name (`speakers`, `voices`, `sounds`, `clips`, `effects`, each an object
  with `list()` etc.). The workspace's own groups are part of `speakers`, `/v1/groups` is management. Management (keys,
  workspace settings, groups, members, invites, Sonos, integrations, user, creating, changing and deleting clips) is not
  wrapped and stays on the raw client `quak.api`.
- `src/watch.ts`: the live status (`GET /v1/plays/watch`) behind `quak.watch()`: auth message, reconnect with growing
  pauses, no reconnect after 4001/4401, a dead connection after 60 s of silence. Only the global `WebSocket` or the
  one passed in, never a dependency.
- `src/types.ts`: all parameter and response types, **only derived** from `src/generated/schema.ts`, never rebuilt by
  hand. When the schema lacks a type, fix it in the API, not here.
- `src/errors.ts`: `QuakError` and `unwrap`.
- `src/client-header.ts`: `X-Quak-Client`, `js/<version>` plus `(<os>; <arch>)` outside browsers. Extra `headers`
  cannot override it (plays made through this package must stay recognisable in the history). The only exception is
  the internal option `client` for Quak's own clients built on this package (the Raycast extension: `raycast/<version>`),
  documented in JSDoc only, never in the README. Never send a host name.
- `src/generated/schema.ts` and `openapi.json`: generated and committed, never edit by hand.
- `src/version.ts`: written from `package.json` (`scripts/sync-version.ts`, runs on `build` and `release`).
- `scripts/`: `generate.ts`, `docs.ts`, `sync-version.ts`, `release.ts`, `smoke.mjs` (the built package on Node and
  Deno).
- `README.md`: `bun docs` writes the parameter tables of the play kinds between `<!-- params:<kind> -->` and
  `<!-- /params:<kind> -->` from `openapi.json`, never edit them by hand. CI checks that they are up to date.
- `test/`: `bun:test`. `fetch` is always replaced through the `fetch` option, never real requests.

## Commands

- `bun install`, `bun run lint` (`tsc --noEmit`), `bun test`, `bun run build` (`dist/`), `bun run format`.
- `bun generate [url|file]`: fetches the schema (default: production, `https://api.quak.party/openapi/json`; release
  snapshots always come from there, a local dev API only for trying things out; `QUAK_OPENAPI_URL` works too), writes
  `openapi.json` and `src/generated/schema.ts`, then the README tables via `bun docs`. Run lint and tests afterwards
  and commit everything.
- Before every commit that touches code: `bun run lint && bun test && bun run build`. Never pipe the test output
  through a filter.

## Release

1. Add the changes under `## Unreleased` in `CHANGELOG.md`.
2. `bun release patch|minor|major|x.y.z`: bumps the version, dates the section, checks, commits `release: vX.Y.Z` and
   tags.
3. `git push origin main vX.Y.Z`: `.github/workflows/release.yml` checks the tag against `package.json`, runs the
   complete CI (`ci.yml` as a reusable workflow), publishes the tarball CI packed and tested via npm Trusted Publishing
   (OIDC, no token, provenance included) and creates the GitHub release.

Notifications: announcements on, for successful and failed releases. The job `announce` in `release.yml` plays the clip
`quak-js-released` or `quak-js-failed` on Mike's Sonos (secret `QUAK_API_KEY`, scheme in
`quak-api/docs/deploy-notifications.md`), exactly one per release; `ci.yml` announces nothing.

Versions stay on 0.9.x for now, like the web app and the CLI, also after the launch; when to move to 1.0 is decided
later. The first version, 0.9.0, is
published by hand, since trusted publishing needs an existing package. Until 29.09.2026 the package was called
`@quak/api`; that name belonged to the obsolete v1 client and was deleted.

## Rules

- **Order of the play kinds** is the same everywhere (code, types, tests, README): text, talk, sound, clip, file, url.
- **Dependencies:** at runtime only `openapi-fetch`. Always the newest **stable** version, pinned exactly, never beta,
  RC or canary (check `npm view <package> versions`, the `latest` tag can point to an RC). Agree on major updates
  first. TypeScript stays on 6.x for now: `openapi-typescript` needs the compiler API, which TypeScript 7 no longer
  ships.
- Runs on Node ≥ 20, Bun, Deno and in browsers: no Node APIs in `src/`, only `fetch`, `FormData` and `Blob`.
- New wrapper methods only for common calls, everything else stays on the raw client.
- Never publish except through the release workflow (apart from the first version).
