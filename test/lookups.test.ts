import { describe, expect, test } from "bun:test";
import { json, mockQuak } from "./helpers.js";

describe("lookups", () => {
  test("each lookup hits its route with its query", async () => {
    const { quak, calls } = mockQuak({}, () => json({ data: [] }));
    await quak.speakers.list({ type: "ALL" });
    await quak.voices.list({ language: "en", gender: "FEMALE" });
    await quak.voices.languages();
    await quak.voices.locales({ language: "en" });
    await quak.voices.models();
    await quak.sounds.list({ q: "duck", limit: 10 });
    await quak.sounds.tags();
    await quak.clips.list();
    await quak.effects.list({ kind: "ambience" });

    expect(calls.map(({ request, url }) => `${request.method} ${url.pathname}${url.search}`)).toEqual([
      "GET /v1/speakers?type=ALL",
      "GET /v1/voices?language=en&gender=FEMALE",
      "GET /v1/voices/languages",
      "GET /v1/voices/locales?language=en",
      "GET /v1/voices/models",
      "GET /v1/sounds?q=duck&limit=10",
      "GET /v1/sounds/tags",
      "GET /v1/clips",
      "GET /v1/effects?kind=ambience",
    ]);
    for (const { request } of calls) {
      expect(request.headers.get("authorization")).toBe("Bearer qk_key_test");
    }
  });

  test("returns the parsed body", async () => {
    const sound = { slug: "quakquak", name: "Quak quak" };
    const { quak } = mockQuak({}, () => json({ data: [sound], meta: { total: 1 } }));
    const result = await quak.sounds.list();
    expect(result.data[0]?.slug).toBe("quakquak");
  });

  test("throws a QuakError on errors", async () => {
    const { quak } = mockQuak({}, () =>
      json({ error: { code: "ERROR_SERVICE_UNAVAILABLE", message: "voices are down" } }, 503),
    );
    const error = await quak.voices.list().catch((error: unknown) => error);
    expect(error).toMatchObject({ status: 503, message: "voices are down" });
  });
});
