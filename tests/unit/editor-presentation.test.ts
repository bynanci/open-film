import { describe, expect, it } from "vitest";
import { durationStatus } from "../../apps/desktop/src/duration";
import {
  clipControls,
  shorteningAction,
} from "../../apps/desktop/src/editorPresentation";

describe("duration feedback", () => {
  it("separates target, final-quarter headroom and maximum boundaries", () => {
    expect(durationStatus(270, 270, 300)).toBe("ideal");
    expect(durationStatus(270.1, 270, 300)).toBe("near-target");
    expect(durationStatus(292.49, 270, 300)).toBe("near-target");
    expect(durationStatus(292.5, 270, 300)).toBe("near-maximum");
    expect(durationStatus(300, 270, 300)).toBe("near-maximum");
    expect(durationStatus(300.01, 270, 300)).toBe("over-maximum");
  });
  it("handles absent, equal and reversed limits without an invalid zone", () => {
    expect(durationStatus(10)).toBe("ideal");
    expect(durationStatus(11, 10)).toBe("over-maximum");
    expect(durationStatus(10, undefined, 10)).toBe("ideal");
    expect(durationStatus(11, 10, 10)).toBe("over-maximum");
    expect(durationStatus(11, 20, 10)).toBe("over-maximum");
  });
});

describe("contextual editor presentation", () => {
  it("offers only trim and volume media controls for audio", () => {
    expect(clipControls("audio")).toEqual({
      duration: false,
      trim: true,
      speed: false,
      volume: true,
      visual: false,
    });
    expect(clipControls("image")).toEqual({
      duration: true,
      trim: false,
      speed: false,
      volume: false,
      visual: true,
    });
    expect(clipControls("video").speed).toBe(true);
  });
  it("describes Fit by command semantics without parsing English reasons", () => {
    expect(shorteningAction({ type: "delete", clipId: "x" })).toBe("remove");
    expect(
      shorteningAction({ type: "duration", clipId: "x", duration: 2 }),
    ).toBe("photo");
    expect(
      shorteningAction({
        type: "trim",
        clipId: "x",
        sourceIn: 1,
        sourceOut: 3,
      }),
    ).toBe("trim");
  });
});
