import { describe, expect, test } from "bun:test";
import type { QuakError } from "../src/index.js";
import { json, mockQuak, play } from "./helpers.js";

const key = (request: Request) => request.headers.get("idempotency-key");

/** Answers in turn with the given responses, the last one for every further request. */
function sequence(...responses: (() => Response)[]) {
  let index = 0;
  return () => {
    const respond = responses[Math.min(index++, responses.length - 1)]!;
    return respond();
  };
}

const busy = () =>
  json({ error: { code: "ERROR_SERVICE_UNAVAILABLE", message: "Sonos is down." } }, 503, { "Retry-After": "0" });
const running = () =>
  json({ error: { code: "ERROR_IDEMPOTENCY_IN_PROGRESS", message: "Still running." } }, 409, { "Retry-After": "0" });
const played =
  (replayed = false) =>
  () =>
    json({ data: play() }, 200, replayed ? { "Idempotent-Replayed": "true" } : { "X-Quak-Credits": "41" });

describe("idempotency", () => {
  test("off by default: no key, no retry, no replayed", async () => {
    const { quak, calls } = mockQuak({}, sequence(busy, played()));
    const error = (await quak.play.text({ text: "Hi" }).catch((error: unknown) => error)) as QuakError;
    expect(error.status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(key(calls[0]!.request)).toBeNull();

    const result = await quak.play.text({ text: "Hi" });
    expect("replayed" in result).toBe(false);
  });

  test("with idempotency: one key per call, the same key on every retry, replayed from the header", async () => {
    const { quak, calls } = mockQuak({ idempotency: true }, sequence(busy, running, played(true), played()));
    const first = await quak.play.text({ text: "Hi" });
    expect(first.replayed).toBe(true);
    expect(first.data.id).toBe(play().id);
    expect(calls).toHaveLength(3);
    const keys = calls.map(({ request }) => key(request));
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(keys).size).toBe(1);

    const second = await quak.plays.replay("last");
    expect(second.replayed).toBe(false);
    expect(key(calls[3]!.request)).not.toBe(keys[0]);
    expect(quak.credits).toBe(41);
  });

  test("a key of the call's own, also without the client option; a reused key is an error, no retry", async () => {
    const { quak, calls } = mockQuak(
      {},
      sequence(() =>
        json({ error: { code: "ERROR_IDEMPOTENCY_KEY_REUSED", message: "Key used for another request." } }, 409),
      ),
    );
    const error = (await quak.plays
      .save("last", { name: "Doorbell" }, { idempotencyKey: "doorbell-1" })
      .catch((error: unknown) => error)) as QuakError;
    expect(error.code).toBe("ERROR_IDEMPOTENCY_KEY_REUSED");
    expect(calls.map(({ request }) => key(request))).toEqual(["doorbell-1"]);
  });

  test("a network error is retried with the same key, a multipart body is sent again in full", async () => {
    let tries = 0;
    const { quak, calls } = mockQuak({}, async (request) => {
      if (tries++ === 0) {
        throw new TypeError("fetch failed");
      }
      expect((await request.formData()).get("file")).toBeInstanceOf(Blob);
      return played()();
    });
    const result = await quak.play.file({ file: new Uint8Array([1, 2, 3]) }, { idempotencyKey: "upload-1" });
    expect(result.replayed).toBe(false);
    expect(calls.map(({ request }) => key(request))).toEqual(["upload-1", "upload-1"]);
  });

  test("gives up after 3 retries with the last error", async () => {
    const { quak, calls } = mockQuak({ idempotency: true }, busy);
    const error = (await quak.play.sound({ sound: "quakquak" }).catch((error: unknown) => error)) as QuakError;
    expect(error.status).toBe(503);
    expect(calls).toHaveLength(4);
  });
});
