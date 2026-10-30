import { afterEach, describe, expect, it, vi } from "vitest";
import * as playbackModule from "../../apps/desktop/src/recordAudioPlayback";
import type { RecordAudioPreviewDescriptor } from "@openfilm/application";
const descriptor: RecordAudioPreviewDescriptor = {
  version: 1,
  id: "12345678-1234-1234-1234-123456789abc",
  revision: "r1",
  sourceKeyDigest: "a".repeat(64),
  sampleRate: 48000,
  channels: 2,
  format: "pcm_s24le",
  lengthSamples: 12 * 48000,
};
function pcm(start: number, count: number) {
  const bytes = new Uint8Array(count * 6),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < count * 2; i++) {
    const value =
      i === 0 && start === 0
        ? -8388608
        : i === 1 && start === 0
          ? 8388607
          : (start + Math.floor(i / 2)) % 1000;
    view.setUint8(i * 3, value & 255);
    view.setUint8(i * 3 + 1, (value >> 8) & 255);
    view.setUint8(i * 3 + 2, (value >> 16) & 255);
  }
  return bytes;
}
class BufferNode {
  channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }
  getChannelData(channel: number) {
    return this.channels[channel]!;
  }
}
class SourceNode {
  buffer: BufferNode | null = null;
  when = -1;
  stopped = false;
  connected = false;
  onended: (() => void) | null = null;
  start(when: number) {
    this.when = when;
  }
  stop() {
    this.stopped = true;
  }
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
}
class Context {
  currentTime = 0;
  state = "running";
  destination = {};
  nodes: SourceNode[] = [];
  createBuffer(channels: number, length: number, rate: number) {
    return new BufferNode(channels, length, rate);
  }
  createBufferSource() {
    const node = new SourceNode();
    this.nodes.push(node);
    return node;
  }
  async resume() {
    this.state = "running";
  }
}
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.splice(0)) f();
  vi.useRealTimers();
});
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function make(
  read?: (
    id: string,
    start: number,
    count: number,
    signal: AbortSignal,
  ) => Promise<Uint8Array>,
) {
  vi.useFakeTimers();
  expect(typeof playbackModule.createRecordAudioPlayback).toBe("function");
  const context = new Context(),
    times: number[] = [],
    states: string[] = [],
    reads: { start: number; count: number; signal: AbortSignal }[] = [];
  let hidden = false,
    visibility = () => {};
  const player = playbackModule.createRecordAudioPlayback({
    context: context as unknown as AudioContext,
    readPcm: async (id, start, count, signal) => {
      reads.push({ start, count, signal });
      return read ? read(id, start, count, signal) : pcm(start, count);
    },
    onTime: (sample) => times.push(sample),
    onState: (state) => states.push(state),
    getHidden: () => hidden,
    subscribeVisibility: (listener) => {
      visibility = listener;
      return () => {
        visibility = () => {};
      };
    },
  });
  clean.push(() => player.dispose());
  player.load(descriptor);
  return {
    player,
    context,
    times,
    states,
    reads,
    async tick(time: number) {
      context.currentTime = time;
      await vi.advanceTimersByTimeAsync(25);
      await flush();
    },
    hide() {
      hidden = true;
      visibility();
    },
  };
}
describe("bounded Record PCM scheduler", () => {
  it("converts signed little-endian 24-bit PCM once and schedules contiguous two-second blocks with 250ms lookahead", async () => {
    const { player, context, reads, tick } = make();
    await player.play(0);
    await flush();
    expect(context.nodes).toHaveLength(1);
    const first = context.nodes[0]!;
    expect(first.buffer!.getChannelData(0)[0]).toBe(-1);
    expect(first.buffer!.getChannelData(1)[0]).toBe(8388607 / 8388608);
    expect(first.buffer!.sampleRate).toBe(48000);
    expect(first.buffer!.length).toBe(96000);
    expect(first.when).toBe(0.25);
    expect(reads.reduce((n, r) => n + r.count, 0)).toBeLessThanOrEqual(384000);
    await tick(1.99);
    expect(context.nodes).toHaveLength(1);
    await tick(2.01);
    expect(context.nodes).toHaveLength(2);
    expect(context.nodes[1]!.when - first.when).toBe(2);
    await tick(4.01);
    expect(
      Math.max(...reads.map((r) => r.start + r.count)) - 180480,
    ).toBeLessThanOrEqual(384000);
  });
  it("holds the canonical playhead on starvation and resumes from the same sample without elapsed hold time", async () => {
    let release!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>((resolve) => {
      release = resolve;
    });
    const { player, times, states, tick, context } = make(
      async (_id, start, count) =>
        start === 96000 ? pending : pcm(start, count),
    );
    await player.play(0);
    await flush();
    await tick(2.5);
    expect(times.at(-1)).toBe(96000);
    expect(states.at(-1)).toBe("buffering");
    await tick(20);
    expect(times.at(-1)).toBe(96000);
    release(pcm(96000, 96000));
    await flush();
    expect(context.nodes.at(-1)!.when).toBe(20.25);
    await tick(20.3);
    expect(times.at(-1)).toBe(98400);
  });
  it("cancels old reads and nodes across seek, descriptor revision, pause, hidden tab and disposal", async () => {
    let resolveOld!: (bytes: Uint8Array) => void;
    const old = new Promise<Uint8Array>((resolve) => {
      resolveOld = resolve;
    });
    const { player, context, reads, states, tick, hide } = make(
      async (_id, start, count) => (start === 0 ? old : pcm(start, count)),
    );
    const playing = player.play(0);
    await flush();
    const oldSignal = reads[0]!.signal;
    const seeking = player.seek(48000);
    await flush();
    expect(oldSignal.aborted).toBe(true);
    resolveOld(pcm(0, 96000));
    await playing;
    await seeking;
    await flush();
    expect(context.nodes).toHaveLength(1);
    expect(reads[1]!.start).toBe(48000);
    await tick(0.3);
    player.pause();
    expect(context.nodes.every((n) => n.stopped && !n.connected)).toBe(true);
    await player.play(48000);
    await flush();
    hide();
    expect(context.nodes.every((n) => n.stopped && !n.connected)).toBe(true);
    player.load({
      ...descriptor,
      revision: "r2",
      sourceKeyDigest: "b".repeat(64),
    });
    expect(states.at(-1)).toBe("ready");
    player.dispose();
    expect(reads.every((r) => r.signal.aborted)).toBe(true);
  });
  it("rejects malformed descriptors and truncated PCM instead of scheduling incomplete buffers", async () => {
    const { player, context, states } = make(async () => new Uint8Array(3));
    expect(() =>
      player.load({ ...descriptor, lengthSamples: Infinity }),
    ).toThrow();
    expect(() =>
      player.load({ ...descriptor, channels: 1 } as never),
    ).toThrow();
    player.load(descriptor);
    await expect(player.play(0)).rejects.toThrow(/PCM|shape|length/i);
    expect(context.nodes).toHaveLength(0);
    expect(states.at(-1)).toBe("failed");
  });
  it("reports browser resume failure and does not emit stale time after disposal", async () => {
    const { player, context, times, states, tick } = make();
    context.state = "suspended";
    context.resume = async () => {
      throw new Error("gesture needed");
    };
    await expect(player.play(0)).rejects.toThrow();
    expect(states.at(-1)).toBe("failed");
    const count = times.length;
    player.dispose();
    await tick(100);
    expect(times).toHaveLength(count);
  });
});
