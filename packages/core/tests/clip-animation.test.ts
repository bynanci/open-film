import { describe, expect, it } from "vitest";
import {
  evaluateClipVisualAnimation,
  splitClipAnimationAtFrame,
  trimClipAnimationToFrameCount,
  validateClipAnimation,
} from "../src/clip-animation.js";
import type { ClipAnimationV1 } from "../src/models.js";

const animation: ClipAnimationV1 = {
  version: 1,
  visualTracks: [
    {
      property: "x",
      keys: [
        { frame: 0, value: 0 },
        { frame: 8, value: 80, interpolation: "linear" },
      ],
    },
    {
      property: "opacity",
      keys: [
        { frame: 2, value: 0.25, interpolation: "hold" },
        { frame: 5, value: 1 },
      ],
    },
  ],
};

describe("clip visual animation", () => {
  it("keeps a single keyed value stable when seeking beyond its frame", () => {
    const oneKey = validateClipAnimation({
      version: 1,
      visualTracks: [{ property: "x", keys: [{ frame: 0, value: 24 }] }],
    });

    expect(evaluateClipVisualAnimation(oneKey, 48).x).toBe(24);
  });

  it("evaluates absolute keyed properties from the requested frame", () => {
    expect(evaluateClipVisualAnimation(animation, 4, { x: 12, y: 3 })).toEqual({
      x: 40,
      y: 3,
      scale: 1,
      rotation: 0,
      opacity: 0.25,
    });
    expect(evaluateClipVisualAnimation(animation, 2, { x: 12 })).toMatchObject({
      x: 20,
      opacity: 0.25,
    });
    expect(evaluateClipVisualAnimation(animation, 5, { x: 12 })).toMatchObject({
      x: 50,
      opacity: 1,
    });
    expect(
      evaluateClipVisualAnimation(animation, 999, { x: 12 }),
    ).toMatchObject({
      x: 80,
      opacity: 1,
    });
  });

  it("solves cubic bezier easing deterministically and supports random seek order", () => {
    const curved = validateClipAnimation({
      version: 1,
      visualTracks: [
        {
          property: "scale",
          keys: [
            {
              frame: 0,
              value: 1,
              interpolation: {
                kind: "cubic-bezier",
                x1: 0.42,
                y1: 0,
                x2: 0.58,
                y2: 1,
              },
            },
            { frame: 10, value: 3 },
          ],
        },
      ],
    });
    const frames = [8, 1, 5, 9, 0, 5, 2];
    const first = new Map(
      frames.map((frame) => [
        frame,
        evaluateClipVisualAnimation(curved, frame).scale,
      ]),
    );
    for (const frame of [...frames].reverse())
      expect(evaluateClipVisualAnimation(curved, frame).scale).toBe(
        first.get(frame),
      );
    expect(first.get(5)).toBeCloseTo(2, 5);
  });

  it("preserves sampled seam values and rebases the right side when split", () => {
    const split = splitClipAnimationAtFrame(animation, 4, 10);
    expect(split.left!.visualTracks?.[0]?.keys.at(-1)).toMatchObject({
      frame: 3,
      value: 30,
    });
    expect(split.right!.visualTracks?.[0]?.keys[0]).toMatchObject({
      frame: 0,
      value: 40,
    });
    expect(split.right!.visualTracks?.[0]?.keys.at(-1)).toMatchObject({
      frame: 4,
      value: 80,
    });
    for (let frame = 0; frame < 10; frame++) {
      const fromOriginal = evaluateClipVisualAnimation(animation, frame);
      const fromSplit =
        frame < 4
          ? evaluateClipVisualAnimation(split.left!, frame)
          : evaluateClipVisualAnimation(split.right!, frame - 4);
      expect(fromSplit.x).toBeCloseTo(fromOriginal.x, 8);
      expect(fromSplit.opacity).toBe(fromOriginal.opacity);
    }
  });

  it("preserves the last retained visible sample when a trim shortens the clip", () => {
    const trimmed = trimClipAnimationToFrameCount(animation, 4);
    expect(trimmed!.visualTracks?.[0]?.keys.at(-1)).toMatchObject({
      frame: 3,
      value: 30,
    });
    expect(() =>
      validateClipAnimation(trimmed!, { maxFrame: 3 }),
    ).not.toThrow();
    expect(() => validateClipAnimation(animation, { maxFrame: 3 })).toThrow(
      /visible clip frame range/,
    );
  });

  it("rejects duplicate tracks, unordered keys, out-of-range values and unknown fields", () => {
    const invalid = [
      {
        version: 1,
        visualTracks: [
          { property: "x", keys: [{ frame: 0, value: 0 }] },
          { property: "x", keys: [{ frame: 1, value: 1 }] },
        ],
      },
      {
        version: 1,
        visualTracks: [
          {
            property: "x",
            keys: [
              { frame: 2, value: 0 },
              { frame: 1, value: 1 },
            ],
          },
        ],
      },
      {
        version: 1,
        visualTracks: [{ property: "opacity", keys: [{ frame: 0, value: 2 }] }],
      },
      { version: 1, executable: "not allowed", visualTracks: [] },
    ];
    for (const value of invalid)
      expect(() => validateClipAnimation(value)).toThrow();
  });
});
