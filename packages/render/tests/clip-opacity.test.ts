import { describe, expect, it } from "vitest";
import {
  evaluateClipVisualAnimation,
  type ClipAnimationV1,
  type ProjectTimebaseV1,
} from "@openfilm/core";
import {
  compileClipOpacityFilters,
  MAX_CLIP_OPACITY_SAMPLES_PER_RENDER,
} from "../src/clip-opacity.js";

const timebase: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 30,
  rateDenominator: 1,
  dropFrame: false,
};

describe("FFmpeg opacity animation plan", () => {
  it("samples the shared cubic evaluator once per changed output frame", () => {
    const animation: ClipAnimationV1 = {
      version: 1,
      visualTracks: [
        {
          property: "opacity",
          keys: [
            {
              frame: 0,
              value: 0.25,
              interpolation: {
                kind: "cubic-bezier",
                x1: 0.42,
                y1: 0,
                x2: 0.58,
                y2: 1,
              },
            },
            { frame: 3, value: 1 },
          ],
        },
      ],
    };

    const plan = compileClipOpacityFilters(animation, timebase, "opacity0");
    expect(plan.commandCount).toBe(3);
    expect(plan.sampleCount).toBe(3);
    expect(plan.filters[0]).toMatch(/^sendcmd=c='/u);
    expect(plan.filters[1]).toBe("colorchannelmixer@opacity0=aa=0.25");
    const commands = plan.filters[0]!.slice("sendcmd=c='".length, -1).split(
      ";",
    );
    expect(commands).toHaveLength(3);
    for (let frame = 1; frame <= 3; frame++) {
      const [range, event, target, option, value] =
        commands[frame - 1]!.split(" ");
      const [start, end] = range!.split("-");
      expect(Number(start)).toBeCloseTo(frame / 30, 14);
      expect(Number(end)).toBeCloseTo((frame + 1) / 30, 14);
      expect([event, target, option]).toEqual([
        "[enter]",
        "colorchannelmixer@opacity0",
        "aa",
      ]);
      expect(Number(value)).toBeCloseTo(
        evaluateClipVisualAnimation(animation, frame).opacity,
        12,
      );
    }
  });

  it("emits only value changes for held segments and rejects excessive work", () => {
    const held: ClipAnimationV1 = {
      version: 1,
      visualTracks: [
        {
          property: "opacity",
          keys: [
            { frame: 0, value: 0.5, interpolation: "hold" },
            { frame: 1_000, value: 0.25 },
          ],
        },
      ],
    };
    const heldPlan = compileClipOpacityFilters(held, timebase, "opacity1", 1);
    expect(heldPlan.commandCount).toBe(1);
    expect(heldPlan.sampleCount).toBe(1);
    expect(heldPlan.filters[0]).toContain(
      "33.3333333333333-33.3666666666667 [enter] colorchannelmixer@opacity1 aa 0.25",
    );

    const changing: ClipAnimationV1 = {
      version: 1,
      visualTracks: [
        {
          property: "opacity",
          keys: [
            { frame: 0, value: 0.25 },
            { frame: MAX_CLIP_OPACITY_SAMPLES_PER_RENDER + 1, value: 1 },
          ],
        },
      ],
    };
    expect(() =>
      compileClipOpacityFilters(changing, timebase, "opacity2"),
    ).toThrow(/frame-sample render limit/);

    expect(() =>
      compileClipOpacityFilters(held, timebase, "opacity3", 10, 32),
    ).toThrow(/byte FFmpeg graph budget/);
  });
});
