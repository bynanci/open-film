// SPDX-License-Identifier: Apache-2.0
import type { RecordAudioPreviewDescriptor } from "@openfilm/application";
export type RecordAudioPlaybackState =
  "preparing" | "ready" | "playing" | "buffering" | "failed";
export interface RecordAudioPlayback {
  load(descriptor: RecordAudioPreviewDescriptor): void;
  play(startSample: number): Promise<void>;
  pause(): void;
  seek(sample: number): Promise<void>;
  dispose(): void;
}
export interface RecordAudioPlaybackOptions {
  context: AudioContext;
  readPcm: (
    id: string,
    start: number,
    count: number,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
  onTime: (sample: number) => void;
  onState: (state: RecordAudioPlaybackState, diagnostic?: string) => void;
  getHidden?: () => boolean;
  subscribeVisibility?: (listener: () => void) => () => void;
}
const RATE = 48000,
  BLOCK = 96000,
  BUDGET = 384000,
  LOOKAHEAD = 0.25;
function descriptorValue(
  value: RecordAudioPreviewDescriptor,
): RecordAudioPreviewDescriptor {
  const keys = [
    "version",
    "id",
    "revision",
    "sourceKeyDigest",
    "sampleRate",
    "channels",
    "format",
    "lengthSamples",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    throw new Error("Invalid Record PCM descriptor.");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key))
      throw new Error("Invalid Record PCM descriptor field.");
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if (!field.enumerable || !("value" in field))
      throw new Error("Invalid Record PCM descriptor data.");
  }
  if (
    value.version !== 1 ||
    value.sampleRate !== RATE ||
    value.channels !== 2 ||
    value.format !== "pcm_s24le" ||
    typeof value.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.id) ||
    typeof value.revision !== "string" ||
    !value.revision ||
    value.revision.length > 256 ||
    typeof value.sourceKeyDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceKeyDigest) ||
    !Number.isSafeInteger(value.lengthSamples) ||
    value.lengthSamples < 1 ||
    value.lengthSamples > 3600 * RATE
  )
    throw new Error("Invalid Record PCM descriptor shape or budget.");
  return { ...value };
}
/** Full rendered DSP is already in these samples. No gain, tempo or limiter is applied here. */
export function createRecordAudioPlayback(
  options: RecordAudioPlaybackOptions,
): RecordAudioPlayback {
  const context = options.context,
    hidden =
      options.getHidden ??
      (() => typeof document !== "undefined" && document.hidden);
  const subscribe =
    options.subscribeVisibility ??
    ((listener: () => void) => {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    });
  let descriptor: RecordAudioPreviewDescriptor | undefined,
    disposed = false,
    generation = 0,
    intent = false,
    state: RecordAudioPlaybackState = "ready",
    position = 0,
    nextRead = 0,
    scheduledEnd = 0,
    nextWhen = 0,
    anchor: { sample: number; time: number } | undefined;
  let controller = new AbortController(),
    timer: ReturnType<typeof setInterval> | undefined,
    pending: { count: number; promise: Promise<void> } | undefined;
  const queued: { start: number; count: number; buffer: AudioBuffer }[] = [],
    scheduled: {
      start: number;
      end: number;
      when: number;
      node: AudioBufferSourceNode;
      count: number;
    }[] = [];
  const current = (stamp: number) => !disposed && stamp === generation;
  const publishState = (
    value: RecordAudioPlaybackState,
    key = `editor.soundTiming.${value}`,
  ) => {
    if (disposed || state === value) return;
    state = value;
    options.onState(value, key);
  };
  function currentPosition() {
    return anchor
      ? Math.min(
          scheduledEnd,
          anchor.sample +
            Math.floor(
              Math.max(0, context.currentTime - anchor.time) * RATE + 1e-7,
            ),
        )
      : position;
  }
  function removeNode(entry: (typeof scheduled)[number], stop: boolean) {
    entry.node.onended = null;
    if (stop)
      try {
        entry.node.stop();
      } catch {
        /* Ended nodes need only disconnect. */
      }
    try {
      entry.node.disconnect();
      entry.node.buffer = null;
    } catch {
      /* Context teardown can retire a node first. */
    }
  }
  function retire() {
    generation++;
    controller.abort();
    controller = new AbortController();
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    for (const entry of scheduled) removeNode(entry, true);
    scheduled.length = 0;
    queued.length = 0;
    pending = undefined;
    anchor = undefined;
    intent = false;
  }
  function failure(error: unknown, key = "editor.soundTiming.previewFailed") {
    position = currentPosition();
    retire();
    if (!disposed) {
      options.onTime(position);
      publishState("failed", key);
    }
    return error;
  }
  function validatePosition(sample: number) {
    if (
      !descriptor ||
      !Number.isSafeInteger(sample) ||
      sample < 0 ||
      sample > descriptor.lengthSamples
    )
      throw new Error("Invalid Record PCM sample position.");
  }
  function buffered() {
    return (
      queued.reduce((sum, b) => sum + b.count, 0) +
      scheduled.reduce((sum, b) => sum + b.count, 0) +
      (pending?.count ?? 0)
    );
  }
  function scheduleBlock(block: (typeof queued)[number], when: number) {
    const node = context.createBufferSource();
    node.buffer = block.buffer;
    node.connect(context.destination);
    const entry = {
      start: block.start,
      end: block.start + block.count,
      when,
      node,
      count: block.count,
    };
    scheduled.push(entry);
    node.onended = () => {
      if (!disposed) pump();
    };
    node.start(when);
    scheduledEnd = entry.end;
    nextWhen = when + block.count / RATE;
  }
  function requestMore(): Promise<void> {
    if (
      !descriptor ||
      !intent ||
      disposed ||
      hidden() ||
      nextRead >= descriptor.lengthSamples
    )
      return Promise.resolve();
    if (pending) return pending.promise;
    const count = Math.min(BLOCK, descriptor.lengthSamples - nextRead);
    if (buffered() + count > BUDGET) return Promise.resolve();
    const stamp = generation,
      start = nextRead,
      signal = controller.signal,
      id = descriptor.id;
    const promise = Promise.resolve()
      .then(() => options.readPcm(id, start, count, signal))
      .then((bytes) => {
        if (!current(stamp) || signal.aborted) return;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== count * 6)
          throw new Error(
            "Record PCM byte length/shape does not match the requested range.",
          );
        const buffer = context.createBuffer(2, count, RATE),
          left = buffer.getChannelData(0),
          right = buffer.getChannelData(1);
        for (let frame = 0; frame < count; frame++)
          for (let channel = 0; channel < 2; channel++) {
            const index = (frame * 2 + channel) * 3;
            let value =
              bytes[index]! |
              (bytes[index + 1]! << 8) |
              (bytes[index + 2]! << 16);
            if (value & 0x800000) value -= 0x1000000;
            (channel ? right : left)[frame] = value / 8388608;
          }
        queued.push({ start, count, buffer });
        nextRead += count;
      })
      .catch((error) => {
        if (current(stamp) && !signal.aborted) {
          failure(error);
          throw error;
        }
      })
      .finally(() => {
        if (current(stamp)) {
          pending = undefined;
          pump();
        }
      });
    pending = { count, promise };
    return promise;
  }
  function pump() {
    if (disposed || !intent || !descriptor) return;
    const stamp = generation;
    if (hidden()) {
      pause();
      return;
    }
    for (let i = scheduled.length - 1; i >= 0; i--)
      if (
        scheduled[i]!.when + scheduled[i]!.count / RATE <=
        context.currentTime
      ) {
        removeNode(scheduled[i]!, false);
        scheduled.splice(i, 1);
      }
    if (anchor) {
      position = currentPosition();
      options.onTime(position);
      if (!current(stamp)) return;
      if (context.currentTime >= nextWhen) {
        if (scheduledEnd >= descriptor.lengthSamples) {
          position = descriptor.lengthSamples;
          retire();
          options.onTime(position);
          publishState("ready");
          return;
        }
        position = scheduledEnd;
        anchor = undefined;
        publishState("buffering");
        if (!current(stamp)) return;
      } else if (context.currentTime >= anchor.time) {
        publishState("playing");
        if (!current(stamp)) return;
      }
    }
    if (!anchor && queued[0]?.start === position) {
      anchor = { sample: position, time: context.currentTime + LOOKAHEAD };
      scheduleBlock(queued.shift()!, anchor.time);
      publishState("buffering");
      if (!current(stamp)) return;
    }
    if (
      anchor &&
      nextWhen - context.currentTime <= LOOKAHEAD &&
      queued[0]?.start === scheduledEnd
    )
      scheduleBlock(queued.shift()!, nextWhen);
    if (!pending && nextRead < descriptor.lengthSamples)
      void requestMore().catch(() => {
        /* Failure already retired this generation. */
      });
  }
  async function play(sample: number) {
    validatePosition(sample);
    position = sample;
    retire();
    position = sample;
    nextRead = sample;
    scheduledEnd = sample;
    if (disposed || hidden()) return;
    if (sample === descriptor!.lengthSamples) {
      options.onTime(sample);
      publishState("ready");
      return;
    }
    intent = true;
    const stamp = generation;
    publishState("preparing");
    options.onTime(position);
    try {
      if (context.state === "suspended") await context.resume();
      if (!current(stamp)) return;
      if (context.state === "closed")
        throw new Error("AudioContext is closed.");
      timer = setInterval(pump, 25);
      await requestMore();
      if (current(stamp)) pump();
    } catch (error) {
      if (current(stamp))
        failure(
          error,
          context.state !== "running"
            ? "editor.soundTiming.resumeRequired"
            : "editor.soundTiming.previewFailed",
        );
      throw error;
    }
  }
  function pause() {
    if (disposed) return;
    position = currentPosition();
    retire();
    options.onTime(position);
    if (state !== "failed") publishState("ready");
  }
  function load(value: RecordAudioPreviewDescriptor) {
    if (disposed) return;
    position = currentPosition();
    retire();
    try {
      descriptor = descriptorValue(value);
    } catch (error) {
      descriptor = undefined;
      failure(error, "editor.soundTiming.invalidPcm");
      throw error;
    }
    position = 0;
    options.onTime(0);
    state = "preparing";
    publishState("ready");
  }
  async function seek(sample: number) {
    validatePosition(sample);
    const playing = intent;
    if (playing) await play(sample);
    else {
      pause();
      position = sample;
      options.onTime(sample);
    }
  }
  const unsubscribe = subscribe(() => {
    if (hidden()) pause();
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    retire();
    unsubscribe();
    descriptor = undefined;
  }
  return { load, play, pause, seek, dispose };
}
