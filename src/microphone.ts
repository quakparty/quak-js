import { QuakError } from "./errors.js";
import type { TalkLiveFormat, TalkLiveSource } from "./talk-live.js";

// The microphone as a talk live source, browsers only: an AudioWorklet hands over the samples, WebCodecs encodes
// them as Opus in 20 ms packets (~32 kbit/s, the default of Quak's own clients). Without an Opus encoder
// (older Safari) it sends 20 ms frames of 16-bit PCM instead (~770 kbit/s at 48 kHz).

/** A `MediaStream`, typed by what is used, so the types also build without the DOM library (Node). */
export type MicrophoneStream = {
  getTracks(): { stop(): void }[];
  getAudioTracks(): { enabled: boolean }[];
};

export type MicrophoneOptions = {
  /** A stream to use instead of asking for the microphone; it is not stopped at the end. */
  stream?: MicrophoneStream | undefined;
  /** `auto` (default): Opus where the browser can encode it, else PCM. */
  encoding?: "auto" | "opus" | "pcm" | undefined;
  /** The input level, 0 to 1, every 20 ms while sending: for a meter. */
  onLevel?: ((level: number) => void) | undefined;
};

export type Microphone = TalkLiveSource & {
  /** The stream recorded from, e.g. for a visualizer. */
  readonly stream: MicrophoneStream;
  /** Ends recording without a talk (when `talkLive()` never started). */
  close(): Promise<void>;
};

const RATES = [16000, 24000, 44100, 48000];
const OPUS = { codec: "opus", numberOfChannels: 1, bitrate: 32_000, opus: { frameDuration: 20_000 } };

// copies each 128-sample block of the first channel to the main thread
const WORKLET = `registerProcessor("quak-capture", class extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) this.port.postMessage(input.slice(0));
    return true;
  }
});`;

/**
 * Asks for the microphone (call it from a click, browsers want a user gesture) and returns it as a source for
 * `quak.talkLive({ source })`, which starts sending once the talk is ready and stops it at the end.
 */
export async function microphone(options: MicrophoneOptions = {}): Promise<Microphone> {
  const global = globalThis as { navigator?: Navigator; AudioContext?: typeof AudioContext };
  if (!global.AudioContext || (!options.stream && !global.navigator?.mediaDevices?.getUserMedia)) {
    throw new QuakError({ status: 0, code: "ERROR_INVALID_PARAMS", message: "microphone() needs a browser" });
  }

  const stream: MicrophoneStream =
    options.stream ??
    (await global.navigator!.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    }));
  const context = new global.AudioContext({ sampleRate: 48000 });
  // some browsers keep the hardware's rate; anything Talk live does not take is resampled to 48 kHz
  const rate = RATES.includes(context.sampleRate) ? context.sampleRate : 48000;
  const resample = rate === context.sampleRate ? null : resampler(context.sampleRate, rate);
  const opus = options.encoding !== "pcm" && (await opusSupported(rate));
  if (options.encoding === "opus" && !opus) {
    await cleanup();
    throw new QuakError({ status: 0, code: "ERROR_INVALID_PARAMS", message: "this browser cannot encode Opus" });
  }

  const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const input = context.createMediaStreamSource(stream as MediaStream);
  const node = new AudioWorkletNode(context, "quak-capture");

  const frameLength = rate / 50;
  let frame = new Float32Array(frameLength);
  let filled = 0;
  let timestamp = 0;
  let encoder: AudioEncoder | undefined;
  let sending = false;
  let stopped: Promise<void> | undefined;

  function sendFrame(send: (frame: ArrayBuffer) => void, samples: Float32Array<ArrayBuffer>) {
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    options.onLevel?.(Math.min(1, peak));
    if (encoder) {
      const data = new AudioData({
        format: "f32",
        sampleRate: rate,
        numberOfFrames: samples.length,
        numberOfChannels: 1,
        timestamp,
        data: samples,
      });
      encoder.encode(data);
      data.close();
      timestamp += (samples.length / rate) * 1e6;
    } else {
      const pcm = new Int16Array(samples.length);
      samples.forEach((sample, i) => {
        const clamped = Math.max(-1, Math.min(1, sample));
        pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      });
      send(pcm.buffer);
    }
  }

  function stop() {
    stopped ??= (async () => {
      input.disconnect();
      node.port.onmessage = null;
      if (encoder && encoder.state === "configured") {
        await encoder.flush().catch(() => {});
        encoder.close();
      }
      await cleanup();
    })();
    return stopped;
  }

  async function cleanup() {
    stream.getTracks().forEach((track) => {
      if (!options.stream) track.stop();
    });
    if (context.state !== "closed") await context.close();
  }

  return {
    stream,
    format: {
      encoding: opus ? "opus" : "pcm_s16le",
      sampleRate: opus ? 48000 : (rate as TalkLiveFormat["sampleRate"]),
    },
    start(send) {
      if (sending || stopped) return;
      sending = true;
      if (opus) {
        encoder = new AudioEncoder({
          output: (chunk) => {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            send(bytes.buffer);
          },
          error: () => {},
        });
        encoder.configure({ ...OPUS, sampleRate: rate });
      }
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const block = resample ? resample(event.data) : event.data;
        for (const sample of block) {
          frame[filled++] = sample;
          if (filled === frameLength) {
            sendFrame(send, frame);
            frame = new Float32Array(frameLength);
            filled = 0;
          }
        }
      };
      input.connect(node);
      void context.resume();
    },
    setMuted(muted) {
      stream.getAudioTracks().forEach((track) => (track.enabled = !muted));
    },
    stop,
    close: stop,
  };
}

async function opusSupported(sampleRate: number): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
  try {
    return (await AudioEncoder.isConfigSupported({ ...OPUS, sampleRate })).supported === true;
  } catch {
    return false;
  }
}

// linear, good enough for speech
function resampler(from: number, to: number) {
  const step = from / to;
  let position = 0;
  let last = 0;
  return (input: Float32Array) => {
    const output: number[] = [];
    while (position < input.length) {
      const index = Math.floor(position);
      const fraction = position - index;
      const before = index === 0 ? last : input[index - 1]!;
      output.push(before + (input[index]! - before) * fraction);
      position += step;
    }
    position -= input.length;
    last = input[input.length - 1] ?? last;
    return Float32Array.from(output);
  };
}
