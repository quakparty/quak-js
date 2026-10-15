import { beforeEach, describe, expect, test } from "bun:test";
import type { QuakError, TalkLiveSource, WebSocketConstructor } from "../src/index.js";
import { mockQuak, play } from "./helpers.js";

/** A WebSocket that records what the client sends and lets the test play the server. */
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  readyState = 0;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: unknown) {
    this.sent.push(typeof data === "string" ? JSON.parse(data) : data);
  }

  close() {
    this.drop(1005);
  }

  // the server's side
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(body: unknown) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
  drop(code: number, reason = "") {
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
  }
}

const WebSocket = FakeSocket as unknown as WebSocketConstructor;
const last = () => FakeSocket.all.at(-1)!;

beforeEach(() => {
  FakeSocket.all = [];
});

describe("talkLive", () => {
  test("starts with the key, the params and the format, frames before open follow the start", () => {
    const { quak } = mockQuak({ headers: { "X-Quak-Workspace": "home" } });
    const live = quak.talkLive({
      WebSocket,
      to: ["kitchen"],
      volume: 30,
      effect: "robot",
      format: { encoding: "pcm_s16le", sampleRate: 48000 },
    });

    expect(last().url).toBe("wss://api.test/v1/play/talk/live");
    expect(last().binaryType).toBe("arraybuffer");
    const frame = new Int16Array(960).buffer;
    live.send(frame);
    last().open();
    expect(last().sent).toEqual([
      {
        type: "start",
        data: {
          apiKey: "qk_key_test",
          workspace: "home",
          to: ["kitchen"],
          volume: 30,
          effect: "robot",
          format: { encoding: "pcm_s16le", sampleRate: 48000 },
        },
      },
      frame,
    ]);
    expect(live.state).toBe("connecting");
  });

  test("a play token goes in as token, without a key it throws", () => {
    mockQuak({ apiKey: "qk_ptk_1" }).quak.talkLive({ WebSocket });
    last().open();
    expect(last().sent).toEqual([{ type: "start", data: { token: "qk_ptk_1" } }]);
    expect(() => mockQuak({ apiKey: undefined }).quak.talkLive({ WebSocket })).toThrow("talkLive() needs an apiKey");
  });

  test("a source sends from ready on, mutes with the update and gets its last packets out before end", async () => {
    const { quak } = mockQuak();
    const events: string[] = [];
    let send: ((frame: ArrayBuffer) => void) | undefined;
    const source: TalkLiveSource = {
      format: { encoding: "opus", sampleRate: 48000 },
      start: (sender) => {
        send = sender;
        events.push("start");
      },
      stop: async () => {
        send?.(new Uint8Array([9]).buffer);
        events.push("stop");
      },
      setMuted: (muted) => events.push(`muted ${muted}`),
    };
    const live = quak.talkLive({
      WebSocket,
      source,
      onReady: ({ maxSeconds }) => events.push(`ready ${maxSeconds}`),
      onUpdated: ({ muted }) => events.push(`updated ${muted}`),
      onDone: ({ creditsUsed, endedBy }) => events.push(`done ${creditsUsed} ${endedBy}`),
      onClose: ({ code }) => events.push(`close ${code}`),
    });
    last().open();
    expect(last().sent[0]).toMatchObject({ type: "start", data: { format: { encoding: "opus", sampleRate: 48000 } } });
    expect(events).toEqual([]);

    last().message({ type: "ready", data: { play: play(), creditsUsed: 2, balance: 98, maxSeconds: 180 } });
    expect(live.state).toBe("live");
    send!(new Uint8Array([1]).buffer);
    live.update({ muted: true });
    last().message({ type: "updated", data: { muted: true } });
    await live.end();
    expect(live.state).toBe("ending");
    last().message({ type: "done", data: { play: play(), creditsUsed: 3, balance: 97, endedBy: "CLIENT" } });
    last().drop(1000);

    expect(last().sent.slice(1)).toEqual([
      new Uint8Array([1]).buffer,
      { type: "update", data: { muted: true } },
      new Uint8Array([9]).buffer,
      { type: "end" },
    ]);
    expect(events).toEqual(["start", "ready 180", "muted true", "updated true", "stop", "done 3 CLIENT", "close 1000"]);
    expect(live.state).toBe("closed");
  });

  test("an error on start ends it with the API's code, a drop is an ERROR_NETWORK", () => {
    const { quak } = mockQuak();
    const errors: QuakError[] = [];
    quak.talkLive({ WebSocket, onError: (error) => errors.push(error) });
    last().open();
    last().message({
      type: "error",
      error: { code: "ERROR_PLAN_REQUIRED", message: "From the family plan.", requestId: "r1" },
    });
    last().drop(4403);

    quak.talkLive({ WebSocket, onError: (error) => errors.push(error) });
    last().open();
    last().drop(1006);

    // close() is no drop
    quak.talkLive({ WebSocket, onError: (error) => errors.push(error) }).close();

    expect(errors.map((error) => [error.code, error.requestId])).toEqual([
      ["ERROR_PLAN_REQUIRED", "r1"],
      ["ERROR_NETWORK", undefined],
    ]);
  });

  test("quiet hours: skipped, no error", () => {
    const { quak } = mockQuak();
    const events: string[] = [];
    quak.talkLive({
      WebSocket,
      onSkipped: () => events.push("skipped"),
      onError: (error) => events.push(error.code),
    });
    last().open();
    last().message({ type: "skipped", data: { play: play(), creditsUsed: 0 } });
    last().drop(1000);
    expect(events).toEqual(["skipped"]);
  });
});
