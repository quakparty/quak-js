import { describe, expect, test } from "bun:test";
import { fireTrigger, VERSION } from "../src/index.js";
import { json, play, type Call } from "./helpers.js";

function recorder(respond: () => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({ request, url: new URL(request.url) });
    return respond();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const played = () =>
  json({ data: { status: "played", reason: null, event: null, text: "Ben is at the door", play: play() } }, 201);

describe("fireTrigger", () => {
  test("a URL as it is, the body as JSON, the query along, no key", async () => {
    const { calls, fetch } = recorder(played);
    const { data } = await fireTrigger("https://api.test/t/qk_trg_abc", {
      body: { name: "Ben" },
      query: { door: "front", floor: 1 },
      fetch,
    });

    const { request, url } = calls[0]!;
    expect(`${request.method} ${url.href}`).toBe("POST https://api.test/t/qk_trg_abc?door=front&floor=1");
    expect(await request.json()).toEqual({ name: "Ben" });
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("x-quak-client")).toStartWith(`js/${VERSION}`);
    expect(request.headers.has("authorization")).toBe(false);
    expect(data.status).toBe("played");
    expect(data.play?.id).toBe(play().id);
  });

  test("a bare token goes to the default API or to baseUrl, without a body", async () => {
    const { calls, fetch } = recorder(() => json({ data: { status: "skipped", reason: "COOLDOWN", play: null } }));
    const { data } = await fireTrigger("qk_trg_abc", { fetch });
    await fireTrigger(" qk_trg_abc ", { baseUrl: "http://localhost:3000/", fetch });

    expect(calls.map(({ url }) => url.href)).toEqual([
      "https://api.quak.party/t/qk_trg_abc",
      "http://localhost:3000/t/qk_trg_abc",
    ]);
    expect(calls[0]!.request.headers.has("content-type")).toBe(false);
    expect(await calls[0]!.request.text()).toBe("");
    expect(data.reason).toBe("COOLDOWN");
  });

  test("errors are QuakErrors", async () => {
    const { fetch } = recorder(() =>
      json({ error: { code: "ERROR_TRIGGER_NOT_FOUND", message: "no such trigger" } }, 404),
    );
    const error = await fireTrigger("qk_trg_gone", { fetch }).catch((error: unknown) => error);
    expect(error).toMatchObject({ status: 404, code: "ERROR_TRIGGER_NOT_FOUND" });

    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    expect(await fireTrigger("qk_trg_abc", { fetch: offline }).catch((error: unknown) => error)).toMatchObject({
      code: "ERROR_NETWORK",
    });

    expect(await fireTrigger("abc").catch((error: unknown) => error)).toMatchObject({ code: "ERROR_INVALID_PARAMS" });
  });
});
