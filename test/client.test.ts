import { describe, expect, test } from "bun:test";
import { DEFAULT_BASE_URL, Quak, VERSION } from "../src/index.js";
import { json, mockQuak, play } from "./helpers.js";

describe("headers", () => {
  test("sends the API key, the client and JSON", async () => {
    const { quak, calls } = mockQuak();
    await quak.play.text({ text: "Meeting in 5 minutes", to: "office" });

    const { request } = calls[0]!;
    expect(request.headers.get("authorization")).toBe("Bearer qk_key_test");
    expect(request.headers.get("x-quak-client")).toMatch(new RegExp(`^js/${VERSION.replaceAll(".", "\\.")}`));
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("x-quak-workspace")).toBeNull();
  });

  test("keeps its own X-Quak-Client over extra headers", async () => {
    const { quak, calls } = mockQuak({ headers: { "X-Quak-Client": "my-app/1.2.3" } });
    await quak.speakers.list();
    expect(calls[0]!.request.headers.get("x-quak-client")).toStartWith(`js/${VERSION}`);
  });

  test("Quak's own clients name themselves with client", async () => {
    const { quak, calls } = mockQuak({ client: "raycast/1.0.0", headers: { "X-Quak-Client": "my-app/1.2.3" } });
    await quak.speakers.list();
    const header = calls[0]!.request.headers.get("x-quak-client")!;
    expect(header).toStartWith("raycast/1.0.0");
    expect(header).not.toContain("js/");
  });

  test("sends no Authorization without a key", async () => {
    const { quak, calls } = mockQuak({ apiKey: undefined }, () => json({ status: "ok" }));
    await quak.api.GET("/health");
    expect(calls[0]!.request.headers.has("authorization")).toBe(false);
  });

  test("passes extra headers", async () => {
    const { quak, calls } = mockQuak({ headers: { "X-Request-Id": "abc" } });
    await quak.speakers.list();
    expect(calls[0]!.request.headers.get("x-request-id")).toBe("abc");
  });
});

describe("base URL", () => {
  test("defaults to production", async () => {
    const urls: string[] = [];
    const quak = new Quak({
      apiKey: "k",
      fetch: (async (request: Request) => {
        urls.push(request.url);
        return json({ data: [] });
      }) as typeof fetch,
    });
    await quak.speakers.list();
    expect(DEFAULT_BASE_URL).toBe("https://api.quak.party");
    expect(urls[0]).toBe("https://api.quak.party/v1/speakers");
  });

  test("drops a trailing slash", async () => {
    const { quak, calls } = mockQuak({ baseUrl: "https://api.example.test/" });
    await quak.speakers.list();
    expect(calls[0]!.url.href).toBe("https://api.example.test/v1/speakers");
  });
});

describe("plays", () => {
  // text, talk, sound, clip, file, url
  test("each JSON kind posts its body to its route", async () => {
    const { quak, calls } = mockQuak();
    await quak.play.text({ text: "Hi", voice: "anna" });
    await quak.play.sound({ sound: "quakquak" });
    await quak.play.clip({ clip: "front-door" });
    await quak.play.url({ url: "https://example.com/a.mp3", process: false });

    expect(calls.map(({ request, url }) => `${request.method} ${url.pathname}`)).toEqual([
      "POST /v1/play/text",
      "POST /v1/play/sound",
      "POST /v1/play/clip",
      "POST /v1/play/url",
    ]);
    expect(await calls[0]!.request.json()).toEqual({ text: "Hi", voice: "anna" });
    expect(await calls[3]!.request.json()).toEqual({ url: "https://example.com/a.mp3", process: false });
  });

  test("returns the parsed body", async () => {
    const { quak } = mockQuak();
    const result = await quak.play.text({ text: "Hi" });
    expect(result).toEqual({ data: play() });
    expect(result.data.status).toBe("PENDING");
  });

  test("replay, save and the workspace hit their routes with their bodies", async () => {
    const { quak, calls } = mockQuak();
    await quak.plays.replay("abc", { to: ["kitchen"], volume: 30 });
    await quak.plays.replay("last");
    await quak.plays.save("abc", { name: "Doorbell" });
    await quak.workspace.get();
    await quak.keys.current();

    expect(calls.map(({ request, url }) => `${request.method} ${url.pathname}`)).toEqual([
      "POST /v1/plays/abc/replay",
      "POST /v1/plays/last/replay",
      "POST /v1/plays/abc/save",
      "GET /v1/workspace",
      "GET /v1/keys/current",
    ]);
    expect(await calls[0]!.request.json()).toEqual({ to: ["kitchen"], volume: 30 });
    expect(await calls[1]!.request.json()).toEqual({});
    expect(await calls[2]!.request.json()).toEqual({ name: "Doorbell" });
  });

  test("stop, speakers and the history hit their routes", async () => {
    const { quak, calls } = mockQuak({}, () => json({ data: [] }));
    await quak.stop({ to: "kitchen" });
    await quak.stop();
    await quak.speakers.list({ type: "ALL" });
    await quak.plays.list({ limit: 5, type: "TEXT" });
    await quak.plays.get("abc");
    await quak.plays.last({ keys: "all" });
    await quak.plays.stop("abc");

    expect(calls.map(({ request, url }) => `${request.method} ${url.pathname}${url.search}`)).toEqual([
      "POST /v1/play/stop",
      "POST /v1/play/stop",
      "GET /v1/speakers?type=ALL",
      "GET /v1/plays?limit=5&type=TEXT",
      "GET /v1/plays/abc",
      "GET /v1/plays/last?keys=all",
      "POST /v1/plays/abc/stop",
    ]);
    expect(await calls[0]!.request.json()).toEqual({ to: "kitchen" });
    // without to: no to in the body, the API stops all speakers
    expect(await calls[1]!.request.json()).toEqual({});
  });
});

describe("uploads", () => {
  test("file sends multipart with the file and the fields", async () => {
    const { quak, calls } = mockQuak();
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    await quak.play.file({
      file: audio,
      filename: "bell.mp3",
      to: ["kitchen", "office"],
      volume: 20,
      preview: true,
      volumes: { kitchen: 40 },
    });

    const { request, url } = calls[0]!;
    expect(url.pathname).toBe("/v1/play/file");
    expect(request.headers.get("content-type")).toStartWith("multipart/form-data; boundary=");
    const form = await request.formData();
    const file = form.get("file") as File;
    expect(file.name).toBe("bell.mp3");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(form.get("to")).toBe("kitchen,office");
    expect(form.get("volume")).toBe("20");
    expect(form.get("preview")).toBe("true");
    expect(form.get("volumes")).toBe('{"kitchen":40}');
  });

  test("talk accepts raw bytes and sends effects as JSON", async () => {
    const { quak, calls } = mockQuak();
    await quak.play.talk({ file: new Uint8Array([9, 9]), effects: [{ at: 0, effect: "robot" }] });

    const { url, request } = calls[0]!;
    expect(url.pathname).toBe("/v1/play/talk");
    const form = await request.formData();
    expect((form.get("file") as File).name).toBe("audio");
    expect(form.get("effects")).toBe('[{"at":0,"effect":"robot"}]');
  });
});

describe("credits", () => {
  test("keeps the balance of the latest answer", async () => {
    let balance = 100;
    const { quak } = mockQuak({}, () => json({ data: play() }, 200, { "X-Quak-Credits": String(balance--) }));
    expect(quak.credits).toBeNull();
    await quak.play.text({ text: "one" });
    expect(quak.credits).toBe(100);
    await quak.play.text({ text: "two" });
    expect(quak.credits).toBe(99);
  });

  test("ignores answers without the header", async () => {
    const { quak } = mockQuak({}, () => json({ data: [] }));
    await quak.speakers.list();
    expect(quak.credits).toBeNull();
  });
});
