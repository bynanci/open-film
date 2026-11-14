import { expect, it, vi } from "vitest";
import {
  VersionComparisonPlayback,
  type ComparisonSide,
} from "../../apps/desktop/src/versionComparisonPlayback.js";
import type { VersionComparisonPreviewDescriptor } from "@openfilm/application";

function player(duration: number) {
  return {
    currentTime: 0,
    duration,
    paused: true,
    ended: false,
    muted: true,
    pause() {
      this.paused = true;
    },
    play: vi.fn(async function (this: ReturnType<typeof player>) {
      this.paused = false;
      this.ended = false;
    }),
  };
}
const descriptor = (
  aDuration = 4,
  bDuration = 6,
  hasAudioA = true,
  hasAudioB = true,
) =>
  ({
    version: 1,
    id: "pair",
    projectId: "project",
    expiresAt: "2030-01-01T00:00:00.000Z",
    a: { duration: aDuration, hasAudio: hasAudioA },
    b: { duration: bDuration, hasAudio: hasAudioB },
  }) as VersionComparisonPreviewDescriptor;

function setup(value = descriptor()) {
  const a = player(value.a.duration),
    b = player(value.b.duration),
    state = {
      time: 0,
      duration: 0,
      playing: false,
      starting: false,
      audibleSide: null as ComparisonSide | null,
      muted: false,
      ended: { a: false, b: false },
    },
    failed = vi.fn(),
    playback = new VersionComparisonPlayback(() => ({ a, b }), state, failed);
  playback.configure(value);
  return { a, b, state, failed, playback };
}

it("uses one seconds clock and keeps the longer side running after the shorter ends", async () => {
  const { a, b, state, playback } = setup();
  await playback.play();
  expect(state.playing).toBe(true);
  b.currentTime = 4.2;
  playback.onTimeUpdate("b");
  expect(state.time).toBeCloseTo(4.2);
  expect(a.currentTime).toBe(4);
  expect(a.paused).toBe(true);
  expect(state.ended.a).toBe(true);
  expect(b.paused).toBe(false);
  b.currentTime = 5.9;
  playback.onTimeUpdate("b");
  expect(state.time).toBeCloseTo(5.9);
  b.currentTime = 6;
  b.ended = true;
  playback.onEnded("b");
  expect(state.playing).toBe(false);
  expect(state.time).toBe(6);
  expect(a.paused).toBe(true);
  expect(b.paused).toBe(true);
});

it("seeks both versions in seconds and seeks backward out of the shorter ending", async () => {
  const { a, b, state, playback } = setup();
  await playback.seek(5);
  expect(a.currentTime).toBe(4);
  expect(b.currentTime).toBe(5);
  expect(state.ended.a).toBe(true);
  expect(state.ended.b).toBe(false);
  await playback.seek(2.5);
  expect(a.currentTime).toBe(2.5);
  expect(b.currentTime).toBe(2.5);
  expect(state.ended).toEqual({ a: false, b: false });
});

it("allows one audible version and mutes every other player", async () => {
  const { a, b, playback } = setup();
  playback.selectAudio("b");
  await playback.play();
  expect(a.muted).toBe(true);
  expect(b.muted).toBe(false);
  playback.setMuted(true);
  expect(a.muted).toBe(true);
  expect(b.muted).toBe(true);
  playback.setMuted(false);
  expect(a.muted).toBe(true);
  expect(b.muted).toBe(false);
});

it("does not unmute a side without audio and keeps audio off after that side ends", async () => {
  const { a, b, state, playback } = setup(descriptor(4, 6, true, false));
  playback.selectAudio("b");
  expect(state.audibleSide).toBe("a");
  await playback.play();
  expect(a.muted).toBe(false);
  expect(b.muted).toBe(true);
  b.currentTime = 4.1;
  playback.onTimeUpdate("b");
  expect(a.muted).toBe(true);
});

it("pauses both players when either browser play request is rejected", async () => {
  const { a, b, state, failed, playback } = setup();
  b.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
  await playback.play();
  expect(failed).toHaveBeenCalledOnce();
  expect(state.playing).toBe(false);
  expect(a.paused).toBe(true);
  expect(b.paused).toBe(true);
  expect(a.muted).toBe(true);
  expect(b.muted).toBe(true);
});

it("invalidates a late play acknowledgement after the preview is unloaded", async () => {
  const { a, state, playback } = setup();
  let finish!: () => void;
  a.play.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const pending = playback.play();
  playback.unload();
  finish();
  await pending;
  expect(state.playing).toBe(false);
  expect(state.duration).toBe(0);
  expect(a.paused).toBe(true);
  expect(a.muted).toBe(true);
});
