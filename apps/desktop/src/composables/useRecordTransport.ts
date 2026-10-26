// Modified by OpenFilm contributors on 2026-10-26. See LICENSE/NOTICE.
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import {
  nominalFrameRate,
  primaryEditFrames,
  sequenceFrameAt,
  sequenceTimeAt,
  type Composition,
  type ProjectTimebaseV1,
} from "@openfilm/core";
import { nextShuttleTier } from "../monitor";

export interface RecordTransport {
  frame: Readonly<Ref<number>>;
  playing: Readonly<Ref<boolean>>;
  shuttleRate: Readonly<Ref<number>>;
  /** A presentation hold preserves play intent, but never elapsed hold time. */
  buffering: Ref<boolean>;
  play(): void;
  pause(): void;
  stop(): void;
  seek(frame: number): void;
  step(direction: -1 | 1, seconds?: boolean): void;
  shuttle(direction: -1 | 1): void;
  previousEdit(): void;
  nextEdit(): void;
  dispose(): void;
}

export interface RecordTransportOptions {
  composition: MaybeRefOrGetter<Composition>;
  timebase: MaybeRefOrGetter<ProjectTimebaseV1>;
  active: MaybeRefOrGetter<boolean>;
  /** The monitor constructs this key from project/composition/revision/rate. */
  ownerKey: MaybeRefOrGetter<string>;
  now?: () => number;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (id: number) => void;
  getHidden?: () => boolean;
  subscribeVisibility?: (listener: () => void) => () => void;
}

/** Transient integer sequence clock; Composition remains the timing authority.
 * Reverse changes requested frames only and makes no audio-playback promise.
 */
export function useRecordTransport(
  options: RecordTransportOptions,
): RecordTransport {
  const now = options.now ?? (() => performance.now());
  const requestFrame =
    options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  const getHidden = options.getHidden ?? (() => document.hidden);
  const subscribeVisibility =
    options.subscribeVisibility ??
    ((listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    });
  const frame = ref(0);
  const playing = ref(false);
  const shuttleRate = ref(0);
  const buffering = ref(false);
  const bounds = computed(() => {
    // A revision key also invalidates snapshots supplied through shallow refs.
    toValue(options.ownerKey);
    const timebase = toValue(options.timebase);
    const composition = toValue(options.composition);
    const count = sequenceFrameAt(composition.duration, timebase, "floor");
    const final = Math.max(0, count - 1);
    const edits = [
      ...new Set([
        0,
        ...primaryEditFrames(composition, timebase).filter(
          (edit) => edit < count,
        ),
        final,
      ]),
    ].sort((a, b) => a - b);
    return { timebase, final, edits };
  });
  let disposed = false;
  let pending: number | undefined;
  let generation = 0;
  let anchor: { frame: number; now: number } | undefined;

  function invalidate() {
    generation++;
    if (pending !== undefined) cancelFrame(pending);
    pending = undefined;
    anchor = undefined;
  }
  function current(stamp: number) {
    return !disposed && stamp === generation;
  }
  // Disposal also uses this path after closing the public-command fence.
  function halt() {
    invalidate();
    const stamp = generation;
    playing.value = false;
    if (stamp === generation) shuttleRate.value = 0;
    return stamp;
  }
  function stop() {
    if (!disposed) halt();
  }
  function eligible() {
    return !disposed && toValue(options.active) && !getHidden();
  }
  function schedule() {
    const stamp = generation;
    pending = requestFrame(() => {
      // A late cancelled callback must not clear a newer request's handle.
      if (disposed || stamp !== generation) return;
      pending = undefined;
      if (!eligible()) {
        stop();
        return;
      }
      if (!playing.value || buffering.value || !anchor) return;
      const { final, timebase } = bounds.value;
      const direction = Math.sign(shuttleRate.value);
      const distance = direction > 0 ? final - anchor.frame : anchor.frame;
      const elapsed = Math.max(0, (now() - anchor.now) / 1000);
      if (!Number.isFinite(elapsed)) {
        stop();
        return;
      }
      // Bound seconds before conversion, keeping even huge clock gaps inside
      // the safe-integer frame domain. Never accumulate callback deltas.
      const advance = sequenceFrameAt(
        Math.min(
          elapsed * Math.abs(shuttleRate.value),
          sequenceTimeAt(distance, timebase),
        ),
        timebase,
      );
      frame.value = anchor.frame + direction * advance;
      // Publishing can synchronously trigger a monitor hold, seek or teardown.
      if (disposed || stamp !== generation) return;
      if (advance >= distance) stop();
      else schedule();
    });
  }
  function reanchor() {
    if (disposed) return;
    invalidate();
    if (!eligible()) {
      stop();
      return;
    }
    if (!playing.value || buffering.value) return;
    const endpoint = shuttleRate.value > 0 ? bounds.value.final : 0;
    if (frame.value === endpoint) {
      stop();
      return;
    }
    anchor = { frame: frame.value, now: now() };
    schedule();
  }
  function start(rate: number) {
    invalidate();
    const stamp = generation;
    // Publish the direction before play intent so consumers see its rate.
    shuttleRate.value = rate;
    if (!current(stamp)) return;
    playing.value = true;
    if (!current(stamp)) return;
    reanchor();
  }
  function play() {
    if (!eligible()) return;
    if (playing.value && shuttleRate.value === 1) return;
    start(1);
  }
  function shuttle(direction: -1 | 1) {
    if (!eligible()) return;
    const tier = nextShuttleTier(shuttleRate.value, direction);
    if (tier === 0) {
      stop();
      return;
    }
    start(tier);
  }
  function seek(value: number) {
    if (disposed || !Number.isSafeInteger(value)) return;
    const stamp = generation;
    frame.value = Math.max(0, Math.min(bounds.value.final, value));
    if (current(stamp)) reanchor();
  }
  function step(direction: -1 | 1, seconds = false) {
    if (disposed) return;
    const stamp = halt();
    if (!current(stamp)) return;
    const amount = seconds ? nominalFrameRate(bounds.value.timebase) : 1;
    const distance =
      direction > 0 ? bounds.value.final - frame.value : frame.value;
    seek(frame.value + direction * Math.min(amount, distance));
  }
  function previousEdit() {
    if (disposed) return;
    seek(bounds.value.edits.findLast((edit) => edit < frame.value) ?? 0);
  }
  function nextEdit() {
    if (disposed) return;
    seek(
      bounds.value.edits.find((edit) => edit > frame.value) ??
        bounds.value.final,
    );
  }
  const stopWatchers = [
    watch(
      () => toValue(options.ownerKey),
      () => {
        if (disposed) return;
        const stamp = halt();
        if (!current(stamp)) return;
        frame.value = 0;
        if (current(stamp)) buffering.value = false;
      },
      { flush: "sync" },
    ),
    watch(
      () => toValue(options.active),
      (active) => {
        if (!active) stop();
      },
      { flush: "sync" },
    ),
    watch(
      bounds,
      () => {
        if (disposed) return;
        const stamp = halt();
        if (!current(stamp)) return;
        frame.value = Math.min(frame.value, bounds.value.final);
      },
      { flush: "sync" },
    ),
    watch(buffering, () => reanchor(), { flush: "sync" }),
  ];
  const unsubscribeVisibility = subscribeVisibility(() => {
    if (!disposed && getHidden()) stop();
  });
  function dispose() {
    if (disposed) return;
    // Close the fence before any reactive publication can reenter commands.
    disposed = true;
    for (const unwatch of stopWatchers) unwatch();
    unsubscribeVisibility();
    halt();
  }
  if (getCurrentScope()) onScopeDispose(dispose);
  return {
    frame: readonly(frame),
    playing: readonly(playing),
    shuttleRate: readonly(shuttleRate),
    buffering,
    play,
    pause: stop,
    stop,
    seek,
    step,
    shuttle,
    previousEdit,
    nextEdit,
    dispose,
  };
}
