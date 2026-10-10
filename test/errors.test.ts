import { describe, expect, test } from "bun:test";
import { QuakError, unwrap } from "../src/index.js";
import { json, mockQuak } from "./helpers.js";

describe("errors", () => {
  test("maps the API error body", async () => {
    const { quak } = mockQuak({}, () =>
      json(
        {
          error: {
            code: "ERROR_INSUFFICIENT_SCOPE",
            message: "this key may not play",
            details: { required: "play" },
            requestId: "req-1",
          },
        },
        403,
        { "X-Request-Id": "req-1" },
      ),
    );

    const error = await quak.play.text({ text: "Hi" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(QuakError);
    expect(error).toBeInstanceOf(Error);
    const quakError = error as QuakError;
    expect(quakError.name).toBe("QuakError");
    expect(quakError.status).toBe(403);
    expect(quakError.code).toBe("ERROR_INSUFFICIENT_SCOPE");
    expect(quakError.message).toBe("this key may not play");
    expect(quakError.details).toEqual({ required: "play" });
    expect(quakError.requestId).toBe("req-1");
    expect(quakError.response?.status).toBe(403);
  });

  test("keeps the field of a validation error", async () => {
    const { quak } = mockQuak({}, () =>
      json({ error: { code: "ERROR_INVALID_PARAMS", message: "volume must be 10-100", field: "volume" } }, 400),
    );
    const error = (await quak.play.text({ text: "Hi", volume: 500 }).catch((error: unknown) => error)) as QuakError;
    expect(error.field).toBe("volume");
  });

  test("falls back to the status and the X-Request-Id header without an error body", async () => {
    const { quak } = mockQuak(
      {},
      () => new Response("Service Unavailable", { status: 503, headers: { "X-Request-Id": "req-2" } }),
    );
    const error = (await quak.speakers.list().catch((error: unknown) => error)) as QuakError;
    expect(error.status).toBe(503);
    expect(error.code).toBe("HTTP_503");
    expect(error.requestId).toBe("req-2");
  });

  test("wraps network failures", async () => {
    const { quak } = mockQuak({}, () => {
      throw new TypeError("fetch failed");
    });
    const error = (await quak.speakers.list().catch((error: unknown) => error)) as QuakError;
    expect(error).toBeInstanceOf(QuakError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("ERROR_NETWORK");
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test("unwrap works on the raw client", async () => {
    const { quak } = mockQuak({}, (request) =>
      new URL(request.url).pathname === "/v1/sounds"
        ? json({ data: [], meta: { total: 0 } })
        : json({ error: { code: "ERROR_NOT_FOUND", message: "no such clip" } }, 404),
    );
    expect((await unwrap(quak.api.GET("/v1/sounds"))).data).toEqual([]);
    const error = (await unwrap(quak.api.DELETE("/v1/clips/{slug}", { params: { path: { slug: "x" } } })).catch(
      (error: unknown) => error,
    )) as QuakError;
    expect(error.code).toBe("ERROR_NOT_FOUND");
  });
});
