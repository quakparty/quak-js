import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { QuakError, WebSocketConstructor } from "../src/index.js";
import { mockQuak, play } from "./helpers.js";

/** A WebSocket that records what the client sends and lets the test play the server. */
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.drop(1000);
  }

  // the server's side
  open() {
    this.onopen?.();
  }
  message(body: unknown) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
  drop(code: number, reason = "") {
    if (!this.closed) {
      this.closed = true;
      this.onclose?.({ code, reason });
    }
  }
}

const WebSocket = FakeSocket as unknown as WebSocketConstructor;
const last = () => FakeSocket.all.at(-1)!;

beforeEach(() => {
  FakeSocket.all = [];
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("watch", () => {
  test("logs in with the key, then hands over ready and the plays", () => {
    const { quak } = mockQuak();
    const plays: string[] = [];
    let ready = 0;
    const watch = quak.watch({ WebSocket, onPlay: (p) => plays.push(p.status), onReady: () => ready++ });

    expect(last().url).toBe("wss://api.test/v1/plays/watch");
    last().open();
    expect(last().sent).toEqual([{ type: "auth", apiKey: "qk_key_test" }]);
    expect(watch.connected).toBe(false);

    last().message({ type: "ready" });
    last().message({ type: "ping" });
    // messages this version does not know, like trigger_call for admins, are skipped
    last().message({ type: "trigger_call", data: {} });
    last().message({ type: "play", data: { ...play(), status: "ACTIVE" } });
    last().message({ type: "play", data: { ...play(), status: "DONE" } });
    expect(ready).toBe(1);
    expect(watch.connected).toBe(true);
    expect(plays).toEqual(["ACTIVE", "DONE"]);
  });

  test("reconnects after a drop, with growing pauses, and starts over after ready", () => {
    const { quak } = mockQuak();
    const closes: boolean[] = [];
    quak.watch({ WebSocket, onPlay: () => {}, onClose: ({ reconnecting }) => closes.push(reconnecting) });

    last().drop(1006);
    expect(FakeSocket.all).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);

    last().drop(1006);
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(3);

    last().open();
    last().message({ type: "ready" });
    last().drop(1006);
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(4);
    expect(closes).toEqual([true, true, true]);
  });

  test("a rejected key ends the watch with the API's error", () => {
    const { quak } = mockQuak();
    const errors: QuakError[] = [];
    const closes: boolean[] = [];
    quak.watch({
      WebSocket,
      onPlay: () => {},
      onError: (error) => errors.push(error),
      onClose: ({ reconnecting }) => closes.push(reconnecting),
    });

    last().open();
    last().message({ type: "error", code: "ERROR_INVALID_API_KEY" });
    last().drop(4001);
    jest.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(errors[0]?.code).toBe("ERROR_INVALID_API_KEY");
    expect(closes).toEqual([false]);
  });

  test("close() ends it for good", () => {
    const { quak } = mockQuak();
    const watch = quak.watch({ WebSocket, onPlay: () => {} });
    last().open();
    watch.close();
    jest.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(last().closed).toBe(true);
  });

  test("a silent connection counts as dropped", () => {
    const { quak } = mockQuak();
    quak.watch({ WebSocket, onPlay: () => {} });
    last().open();
    last().message({ type: "ready" });
    jest.advanceTimersByTime(59_000);
    last().message({ type: "ping" });
    jest.advanceTimersByTime(59_000);
    expect(last().closed).toBe(false);
    jest.advanceTimersByTime(1000);
    expect(last().closed).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  test("needs a key and a WebSocket", () => {
    const { quak } = mockQuak({ apiKey: undefined });
    expect(() => quak.watch({ WebSocket, onPlay: () => {} })).toThrow("watch() needs an apiKey");

    const { quak: withKey } = mockQuak();
    const global = globalThis.WebSocket;
    try {
      (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
      expect(() => withKey.watch({ onPlay: () => {} })).toThrow("watch() needs a WebSocket");
    } finally {
      globalThis.WebSocket = global;
    }
  });
});
