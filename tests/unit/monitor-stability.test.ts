import { describe, expect, it } from "vitest";
import {
  clampFrameStep,
  formatTimecode,
  frameGuideRect,
  nextStableWorkspaceHeight,
  playbackBoundaryAction,
  roundFrameDimensions,
} from "../../apps/desktop/src/monitor";

describe("monitor geometry and transport helpers", () => {
  it("ignores workspace height noise below two pixels and accepts real changes", () => {
    expect(nextStableWorkspaceHeight(500, 501)).toBe(500);
    expect(nextStableWorkspaceHeight(500, 502)).toBe(502);
    expect(nextStableWorkspaceHeight(undefined, 501)).toBe(501);
  });

  it("rounds preview frame dimensions to physical CSS pixels", () => {
    expect(roundFrameDimensions({ width: 319.6, height: 179.2 })).toEqual({
      width: 320,
      height: 179,
    });
  });

  it("steps on frame boundaries and clamps to the selected source range", () => {
    expect(clampFrameStep(1.5, -1, 30, 0.2, 3)).toBeCloseTo(44 / 30);
    expect(clampFrameStep(1.5, 1, 30, 0.2, 3)).toBeCloseTo(46 / 30);
    expect(clampFrameStep(0.2, -1, 30, 0.2, 3)).toBe(0.2);
    expect(clampFrameStep(3, 1, 30, 0.2, 3)).toBe(3);
  });

  it("formats source time as readable frame timecode", () => {
    expect(formatTimecode(65.5, 30)).toBe("00:01:05:15");
    expect(formatTimecode(1 / 24 - 0.000001, 24)).toBe("00:00:00:01");
    expect(formatTimecode(-1, 30)).toBe("00:00:00:00");
  });

  it("fits a chosen aspect guide inside the monitor without changing its bounds", () => {
    expect(frameGuideRect(640, 360, 9 / 16)).toEqual({
      width: 203,
      height: 360,
    });
    expect(frameGuideRect(640, 360, 1)).toEqual({ width: 360, height: 360 });
  });

  it("only handles an actively playing clip boundary once and respects looping", () => {
    const boundary = {
      currentTime: 2,
      sourceOut: 2,
      frameRate: 30,
      seeking: false,
      handled: false,
      loop: false,
    };
    expect(playbackBoundaryAction({ ...boundary, playing: false })).toBe(
      "ignore",
    );
    expect(
      playbackBoundaryAction({ ...boundary, playing: true, seeking: true }),
    ).toBe("ignore");
    expect(
      playbackBoundaryAction({ ...boundary, currentTime: 1.9, playing: true }),
    ).toBe("continue");
    expect(playbackBoundaryAction({ ...boundary, playing: true })).toBe("stop");
    expect(
      playbackBoundaryAction({ ...boundary, playing: true, loop: true }),
    ).toBe("loop");
    expect(
      playbackBoundaryAction({ ...boundary, playing: true, handled: true }),
    ).toBe("ignore");
  });
});
