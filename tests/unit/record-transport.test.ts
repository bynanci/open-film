import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveCompositionFrame,
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
} from "@openfilm/core";
import {
  useRecordTransport,
  type RecordTransport,
} from "../../apps/desktop/src/composables/useRecordTransport";

const { shallowRef, effectScope, watch } = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as {
  shallowRef: <T>(value: T) => { value: T };
  effectScope: () => { run: (fn: () => void) => void; stop: () => void };
  watch: <T>(
    source: { readonly value: T },
    callback: (value: T) => void,
    options: { flush: "sync" },
  ) => () => void;
};
const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 30000,
  rateDenominator: 1001,
  dropFrame: false,
};
const composition: Composition = {
  id: "cut",
  storyId: "story",
  duration: 4.004,
  tracks: [
    {
      id: "primary",
      type: "video",
      clips: [
        {
          id: "a",
          assetId: "video",
          timelineStart: 0,
          timelineDuration: 1.001,
        },
        {
          id: "b",
          assetId: "video",
          timelineStart: 1.001,
          timelineDuration: 1.001,
          sourceIn: 2,
        },
        {
          id: "c",
          assetId: "video",
          timelineStart: 2.002,
          timelineDuration: 2.002,
          sourceIn: 4,
        },
      ],
    },
  ],
};
const video: MediaAsset = {
  id: "video",
  uri: "file:///video.mp4",
  name: "video",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: {},
};

// Only platform time, scheduled work and visibility are replaced. The transport,
// Vue reactivity and Composition resolver run as production code.
function fakeClock() {
  let time = 0;
  let nextId = 0;
  let hidden = false;
  let unsubscribeCalls = 0;
  const pending = new Map<number, (time: number) => void>();
  const listeners = new Set<() => void>();
  const historicalCallbacks: Array<(time: number) => void> = [];
  const historicalListeners: Array<() => void> = [];
  return {
    now: () => time,
    requestFrame: (callback: (time: number) => void) => {
      pending.set(++nextId, callback);
      historicalCallbacks.push(callback);
      return nextId;
    },
    cancelFrame: (id: number) => void pending.delete(id),
    getHidden: () => hidden,
    subscribeVisibility: (listener: () => void) => {
      listeners.add(listener);
      historicalListeners.push(listener);
      return () => {
        unsubscribeCalls++;
        listeners.delete(listener);
      };
    },
    at: (value: number) => {
      time = value;
    },
    tick: (value: number) => {
      time = value;
      const work = [...pending.values()];
      pending.clear();
      for (const callback of work) callback(time);
    },
    visibility: (value: boolean) => {
      hidden = value;
      for (const listener of [...listeners]) listener();
    },
    pending,
    listeners,
    historicalCallbacks,
    historicalListeners,
    get unsubscribeCalls() {
      return unsubscribeCalls;
    },
  };
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});
function setup(saved = composition, rate = timebase) {
  const clock = fakeClock();
  const inputs = {
    composition: shallowRef(structuredClone(saved)),
    timebase: shallowRef({ ...rate }),
    active: shallowRef(true),
    ownerKey: shallowRef("project:cut:r1:rate"),
  };
  const transport = useRecordTransport({
    composition: () => inputs.composition.value,
    timebase: () => inputs.timebase.value,
    active: () => inputs.active.value,
    ownerKey: () => inputs.ownerKey.value,
    ...clock,
  });
  cleanup.push(() => {
    transport.dispose();
    expect(clock.pending.size).toBe(0);
    expect(clock.listeners.size).toBe(0);
    expect(clock.unsubscribeCalls).toBe(1);
  });
  return { clock, inputs, transport };
}

describe("integer-frame Record clock", () => {
  it("crosses both exact edits without restarting or selecting a clip", () => {
    const { clock, inputs, transport } = setup();
    const saved = structuredClone(inputs.composition.value);
    transport.play();
    for (const [ms, frame, clip] of [
      [1000, 29, "a"],
      [1001, 30, "b"],
      [2001, 59, "b"],
      [2002, 60, "c"],
    ] as const) {
      clock.tick(ms);
      expect(transport.frame.value).toBe(frame);
      expect(
        resolveCompositionFrame(
          inputs.composition.value,
          [video],
          frame,
          timebase,
        ).primary?.clip.id,
      ).toBe(clip);
      expect(transport.playing.value).toBe(true);
      expect(clock.pending.size).toBe(1);
    }
    expect(inputs.composition.value).toEqual(saved);
  });

  it("derives long-running rational playback from the anchor regardless of callback frequency", () => {
    const long: Composition = { ...composition, duration: 20000, tracks: [] };
    const dense = setup(long);
    const sparse = setup(long);
    dense.transport.play();
    sparse.transport.play();
    for (let ms = 17; ms < 10010000; ms += 1237) dense.clock.tick(ms);
    dense.clock.tick(10010000);
    sparse.clock.tick(10010000);
    expect(dense.transport.frame.value).toBe(300000);
    expect(sparse.transport.frame.value).toBe(300000);
  });

  it("steps reverse deterministically from its anchor and stops at zero", () => {
    const { clock, transport } = setup();
    transport.seek(90);
    transport.shuttle(-1);
    for (const [ms, frame] of [
      [1001, 60],
      [2002, 30],
      [3003, 0],
    ] as const) {
      clock.tick(ms);
      expect(transport.frame.value).toBe(frame);
    }
    expect(transport.playing.value).toBe(false);
    expect(transport.shuttleRate.value).toBe(0);
    expect(clock.pending.size).toBe(0);
  });

  it("bounds repeated J/L tiers and reanchors each direction or tier change", () => {
    const { clock, transport } = setup();
    transport.seek(60);
    const tiers = [1, 2, 4, 4, 2, 1, 0, -1, -2, -4, -4];
    const directions = [1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1] as const;
    directions.forEach((direction, index) => {
      transport.shuttle(direction);
      expect(transport.shuttleRate.value).toBe(tiers[index]);
      expect(clock.pending.size).toBe(tiers[index] === 0 ? 0 : 1);
    });
    clock.tick(500.5);
    expect(transport.frame.value).toBe(0);
  });

  it.each(["pause", "stop"] as const)(
    "%s preserves frame and fences an already queued callback",
    (method) => {
      const { clock, transport } = setup();
      transport.play();
      clock.tick(1001);
      const stale = clock.historicalCallbacks.at(-1)!;
      transport[method]();
      clock.at(3003);
      stale(3003);
      expect(transport.frame.value).toBe(30);
      expect(transport.playing.value).toBe(false);
      expect(transport.shuttleRate.value).toBe(0);
      expect(clock.pending.size).toBe(0);
    },
  );

  it("one-second steps use nominal frames instead of fractional elapsed-second counts", () => {
    const { transport } = setup();
    transport.step(1, true);
    expect(transport.frame.value).toBe(30);
    transport.step(1, true);
    expect(transport.frame.value).toBe(60);
    transport.step(-1);
    expect(transport.frame.value).toBe(59);
    transport.step(-1, true);
    expect(transport.frame.value).toBe(29);
  });

  it("arbitrary seek order gives the same Composition output and reanchors ongoing playback", () => {
    const { clock, inputs, transport } = setup();
    for (const [frame, clipId, sourceTime] of [
      [60, "c", 4],
      [0, "a", 0],
      [119, "c", 5.968633333333333],
      [29, "a", 0.967633333333333],
      [90, "c", 5.001],
      [60, "c", 4],
    ] as const) {
      transport.seek(frame);
      expect(transport.frame.value).toBe(frame);
      const resolved = resolveCompositionFrame(
        inputs.composition.value,
        [video],
        transport.frame.value,
        timebase,
      );
      expect(resolved.primary?.clip.id).toBe(clipId);
      expect(resolved.primary?.sourceTime).toBeCloseTo(sourceTime, 10);
    }
    transport.play();
    clock.tick(1001);
    expect(transport.frame.value).toBe(90);
    clock.at(1500);
    transport.seek(30);
    clock.tick(2501);
    expect(transport.frame.value).toBe(60);
  });

  it.each([
    [4.004, 119],
    [4.02, 119],
    [0.01, 0],
    [0, 0],
  ])("stops duration %s on final complete frame %s", (duration, final) => {
    const { clock, transport } = setup({
      ...composition,
      duration,
      tracks: [],
    });
    transport.play();
    clock.tick(100000);
    expect(transport.frame.value).toBe(final);
    expect(transport.playing.value).toBe(false);
    expect(clock.pending.size).toBe(0);
    transport.seek(100000);
    expect(transport.frame.value).toBe(final);
    transport.play();
    expect(transport.playing.value).toBe(false);
    expect(clock.pending.size).toBe(0);
  });

  it("ignores invalid frame requests and clamps integer seeks and steps to sequence bounds", () => {
    const { transport } = setup();
    transport.seek(50);
    for (const invalid of [
      NaN,
      Infinity,
      -Infinity,
      2.2,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      transport.seek(invalid);
      expect(transport.frame.value).toBe(50);
    }
    transport.seek(-10);
    transport.step(-1, true);
    expect(transport.frame.value).toBe(0);
    transport.seek(Number.MAX_SAFE_INTEGER);
    transport.step(1, true);
    expect(transport.frame.value).toBe(119);
    expect(Number.isSafeInteger(transport.frame.value)).toBe(true);
  });

  it("navigates deduplicated primary edits with endpoints and excludes overlays and incomplete tail edits", () => {
    const { transport } = setup({
      ...composition,
      tracks: [
        ...composition.tracks,
        {
          id: "overlay",
          type: "video",
          timing: "overlay",
          clips: [
            {
              id: "overlay",
              assetId: "video",
              timelineStart: 0.5,
              timelineDuration: 0.5,
            },
          ],
        },
      ],
    });
    for (const expected of [30, 60, 119, 119]) {
      transport.nextEdit();
      expect(transport.frame.value).toBe(expected);
    }
    for (const expected of [60, 30, 0, 0]) {
      transport.previousEdit();
      expect(transport.frame.value).toBe(expected);
    }
    const tail = setup({
      ...composition,
      duration: 1.05,
      tracks: [
        {
          id: "primary",
          type: "video",
          clips: [
            {
              id: "a",
              assetId: "video",
              timelineStart: 0,
              timelineDuration: 1.001,
            },
            {
              id: "b",
              assetId: "video",
              timelineStart: 1.001,
              timelineDuration: 0.049,
            },
          ],
        },
      ],
    });
    tail.transport.nextEdit();
    expect(tail.transport.frame.value).toBe(30);
    tail.transport.nextEdit();
    expect(tail.transport.frame.value).toBe(30);
  });

  it("uses sequence endpoints even without a primary track", () => {
    const { transport } = setup({ ...composition, tracks: [] });
    transport.nextEdit();
    expect(transport.frame.value).toBe(119);
    transport.previousEdit();
    expect(transport.frame.value).toBe(0);
  });
});

describe("Record transport cancellation and ownership", () => {
  it.each(["buffering", "pause", "owner", "dispose"] as const)(
    "honors synchronous %s from a frame consumer without scheduling more work",
    (action) => {
      const { clock, inputs, transport } = setup();
      const unwatch = watch(
        transport.frame,
        (frame) => {
          if (frame !== 30) return;
          if (action === "buffering") transport.buffering.value = true;
          if (action === "pause") transport.pause();
          if (action === "owner")
            inputs.ownerKey.value = "consumer-switched-owner";
          if (action === "dispose") transport.dispose();
        },
        { flush: "sync" },
      );
      cleanup.push(unwatch);
      transport.play();
      clock.tick(1001);
      expect(transport.frame.value).toBe(action === "owner" ? 0 : 30);
      expect(clock.pending.size).toBe(0);
      expect(transport.playing.value).toBe(action === "buffering");
    },
  );

  it("inactive target pauses immediately without advancing or auto-resuming", () => {
    const { clock, inputs, transport } = setup();
    transport.play();
    clock.tick(1001);
    clock.at(2002);
    inputs.active.value = false;
    expect(transport.playing.value).toBe(false);
    expect(transport.frame.value).toBe(30);
    expect(clock.pending.size).toBe(0);
    transport.play();
    transport.shuttle(1);
    expect(clock.pending.size).toBe(0);
    inputs.active.value = true;
    clock.tick(3003);
    expect(transport.frame.value).toBe(30);
    transport.play();
    clock.tick(4004);
    expect(transport.frame.value).toBe(60);
  });

  it("visibility loss pauses at current frame and a late callback cannot resume it", () => {
    const { clock, transport } = setup();
    transport.play();
    clock.tick(1001);
    const stale = clock.historicalCallbacks.at(-1)!;
    clock.at(2002);
    clock.visibility(true);
    stale(2002);
    expect(transport.frame.value).toBe(30);
    expect(transport.playing.value).toBe(false);
    expect(clock.pending.size).toBe(0);
    transport.play();
    expect(clock.pending.size).toBe(0);
    clock.visibility(false);
    expect(transport.playing.value).toBe(false);
  });

  it("checks visibility on every frame even without a delivered visibility event", () => {
    const clock = fakeClock();
    let hidden = false;
    const transport = useRecordTransport({
      composition,
      timebase,
      active: true,
      ownerKey: "owner",
      ...clock,
      getHidden: () => hidden,
    });
    cleanup.push(() => transport.dispose());
    transport.play();
    hidden = true;
    clock.tick(1001);
    expect(transport.frame.value).toBe(0);
    expect(transport.playing.value).toBe(false);
    expect(clock.pending.size).toBe(0);
  });

  it("buffering freezes current frame and resumes from a fresh anchor with no hidden catch-up", () => {
    const { clock, transport } = setup();
    transport.play();
    clock.tick(1001);
    const stale = clock.historicalCallbacks.at(-1)!;
    clock.at(1500);
    transport.buffering.value = true;
    expect(clock.pending.size).toBe(0);
    clock.tick(10000);
    stale(10000);
    expect(transport.frame.value).toBe(30);
    expect(transport.playing.value).toBe(true);
    transport.buffering.value = false;
    expect(clock.pending.size).toBe(1);
    clock.tick(11001);
    expect(transport.frame.value).toBe(60);
    transport.buffering.value = true;
    transport.pause();
    transport.buffering.value = false;
    expect(clock.pending.size).toBe(0);
  });

  it("play while already buffering waits for release instead of starting a hidden clock", () => {
    const { clock, transport } = setup();
    transport.buffering.value = true;
    transport.play();
    clock.tick(10000);
    expect(transport.frame.value).toBe(0);
    expect(clock.pending.size).toBe(0);
    transport.buffering.value = false;
    clock.tick(11001);
    expect(transport.frame.value).toBe(30);
  });

  it("owner change synchronously resets frame, buffering, edits and the clock and fences old callbacks", () => {
    const { clock, inputs, transport } = setup();
    transport.play();
    clock.tick(1001);
    const stale = clock.historicalCallbacks.at(-1)!;
    transport.buffering.value = true;
    inputs.composition.value = { ...composition, duration: 2, tracks: [] };
    inputs.timebase.value = {
      ...timebase,
      rateNumerator: 24,
      rateDenominator: 1,
    };
    inputs.ownerKey.value = "project:other:r2:24";
    expect(transport.frame.value).toBe(0);
    expect(transport.buffering.value).toBe(false);
    expect(transport.playing.value).toBe(false);
    expect(transport.shuttleRate.value).toBe(0);
    expect(clock.pending.size).toBe(0);
    transport.play();
    clock.at(5000);
    stale(5000);
    expect(transport.frame.value).toBe(0);
    expect(clock.pending.size).toBe(1);
    clock.tick(5500);
    expect(transport.frame.value).toBe(47);
    transport.seek(0);
    transport.nextEdit();
    expect(transport.frame.value).toBe(47);
  });

  it("owner change cancels active work before resetting the frame", () => {
    const { clock, inputs, transport } = setup();
    transport.play();
    clock.tick(1001);
    inputs.ownerKey.value = "new-owner";
    expect(transport.frame.value).toBe(0);
    expect(transport.playing.value).toBe(false);
    expect(clock.pending.size).toBe(0);
  });

  it("owner change recomputes bounds and edits even for a saved object held in a shallow ref", () => {
    const { inputs, transport } = setup();
    transport.nextEdit();
    expect(transport.frame.value).toBe(30);
    inputs.composition.value.duration = 1.001;
    inputs.composition.value.tracks = [];
    inputs.ownerKey.value = "new-revision";
    expect(transport.frame.value).toBe(0);
    transport.nextEdit();
    expect(transport.frame.value).toBe(29);
  });

  it("recomputes and clamps bounds when the reactive saved Composition shrinks", () => {
    const { inputs, transport } = setup();
    transport.seek(119);
    transport.play();
    inputs.composition.value = { ...composition, duration: 1.001, tracks: [] };
    expect(transport.frame.value).toBe(29);
    transport.nextEdit();
    expect(transport.frame.value).toBe(29);
  });

  it("supports getter inputs without retaining an old active target or owner", () => {
    const clock = fakeClock();
    const state = shallowRef({ active: true, owner: "one" });
    const transport = useRecordTransport({
      composition: () => composition,
      timebase: () => timebase,
      active: () => state.value.active,
      ownerKey: () => state.value.owner,
      ...clock,
    });
    cleanup.push(() => transport.dispose());
    transport.play();
    clock.tick(1001);
    state.value = { active: false, owner: "two" };
    expect(transport.frame.value).toBe(0);
    expect(transport.playing.value).toBe(false);
    expect(clock.pending.size).toBe(0);
  });

  it("dispose is idempotent, releases all work/listeners/watchers and ignores every late callback or method", () => {
    const { clock, inputs, transport } = setup();
    transport.seek(30);
    transport.play();
    transport.dispose();
    transport.dispose();
    const snapshot = [
      transport.frame.value,
      transport.playing.value,
      transport.shuttleRate.value,
    ];
    inputs.ownerKey.value = "late-owner";
    inputs.active.value = false;
    clock.at(10000);
    for (const callback of clock.historicalCallbacks) callback(10000);
    for (const listener of clock.historicalListeners) listener();
    for (const command of [
      () => transport.play(),
      () => transport.pause(),
      () => transport.stop(),
      () => transport.seek(60),
      () => transport.step(1),
      () => transport.shuttle(-1),
      () => transport.nextEdit(),
      () => transport.previousEdit(),
    ])
      command();
    transport.buffering.value = true;
    transport.buffering.value = false;
    expect([
      transport.frame.value,
      transport.playing.value,
      transport.shuttleRate.value,
    ]).toEqual(snapshot);
    expect(clock.pending.size).toBe(0);
    expect(clock.listeners.size).toBe(0);
    expect(clock.unsubscribeCalls).toBe(1);
  });

  it.each(["play", "shuttle"] as const)(
    "%s cannot publish rate or schedule after a playing=true watcher disposes",
    (command) => {
      const { clock, transport } = setup();
      transport.seek(30);
      const unwatch = watch(
        transport.playing,
        (playing) => {
          if (playing) transport.dispose();
        },
        { flush: "sync" },
      );
      cleanup.push(unwatch);
      if (command === "play") transport.play();
      else transport.shuttle(1);
      expect(transport.frame.value).toBe(30);
      expect(transport.playing.value).toBe(false);
      expect(transport.shuttleRate.value).toBe(0);
      expect(clock.pending.size).toBe(0);
      expect(clock.listeners.size).toBe(0);
      expect(clock.unsubscribeCalls).toBe(1);
    },
  );

  it("dispose fences a nested dispose from a playing=false watcher before publishing", () => {
    const { clock, transport } = setup();
    transport.play();
    const unwatch = watch(
      transport.playing,
      (playing) => {
        if (!playing) transport.dispose();
      },
      { flush: "sync" },
    );
    cleanup.push(unwatch);
    transport.dispose();
    expect(clock.unsubscribeCalls).toBe(1);
    expect(clock.listeners.size).toBe(0);
    expect(clock.pending.size).toBe(0);
    expect(transport.shuttleRate.value).toBe(0);
  });

  it("dispose fences reentrant play from a playing=false watcher without leaking rAF", () => {
    const { clock, transport } = setup();
    transport.play();
    const unwatch = watch(
      transport.playing,
      (playing) => {
        if (!playing) transport.play();
      },
      { flush: "sync" },
    );
    cleanup.push(unwatch);
    transport.dispose();
    expect(clock.pending.size).toBe(0);
    expect(clock.listeners.size).toBe(0);
    expect(clock.unsubscribeCalls).toBe(1);
    expect(transport.playing.value).toBe(false);
    expect(transport.shuttleRate.value).toBe(0);
  });

  it.each(["step", "owner"] as const)(
    "%s cannot publish more state after its playing=false watcher disposes",
    (command) => {
      const { clock, inputs, transport } = setup();
      transport.seek(30);
      transport.play();
      const unwatch = watch(
        transport.playing,
        (playing) => {
          if (!playing) transport.dispose();
        },
        { flush: "sync" },
      );
      cleanup.push(unwatch);
      if (command === "step") transport.step(1);
      else inputs.ownerKey.value = "new-owner";
      expect(transport.frame.value).toBe(30);
      expect(transport.playing.value).toBe(false);
      expect(transport.shuttleRate.value).toBe(0);
      expect(clock.pending.size).toBe(0);
      expect(clock.unsubscribeCalls).toBe(1);
    },
  );

  it("owning Vue scope disposal also releases the transport", () => {
    const scope = effectScope();
    let transport!: RecordTransport;
    let clock!: ReturnType<typeof fakeClock>;
    scope.run(() => ({ transport, clock } = setup()));
    transport.play();
    scope.stop();
    expect(clock.pending.size).toBe(0);
    expect(clock.listeners.size).toBe(0);
    expect(clock.unsubscribeCalls).toBe(1);
    expect(transport.playing.value).toBe(false);
  });
});
