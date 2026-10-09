import { Quak, type Play, type QuakOptions } from "../src/index.js";

export type Call = { request: Request; url: URL };

/** A Quak client whose fetch records every request and answers with `respond` (default: a play). */
export function mockQuak(
  options: QuakOptions = {},
  respond: (request: Request) => Response | Promise<Response> = () =>
    json({ data: play() }, 200, { "X-Quak-Credits": "42" }),
) {
  const calls: Call[] = [];
  const fetch = (async (input: Request) => {
    calls.push({ request: input, url: new URL(input.url) });
    return respond(input);
  }) as typeof globalThis.fetch;
  const quak = new Quak({ apiKey: "qk_key_test", baseUrl: "https://api.test", ...options, fetch });
  return { quak, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function play(): Play {
  return {
    id: "0b7a1f7e-4a53-4e0c-9f38-1d0f2a8b9c10",
    type: "TEXT",
    status: "PENDING",
    skipReason: null,
    preview: false,
    params: {},
    players: [],
    audioUrl: null,
    length: 2,
    credits: 3,
    fromCache: false,
    startsAt: null,
    canReplay: false,
    canSave: false,
    user: null,
    key: null,
    requestId: null,
    test: false,
    client: { platform: "JS", name: "js", version: "0.9.0" },
    createdAt: "2026-09-29T10:00:00.000Z",
  };
}
