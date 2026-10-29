import { describe, expect, it } from "vitest";
import {
  moveClipTransform,
  resizeClipTransform,
  type ClipTransformDraft,
  type TransformCorner,
} from "../../apps/desktop/src/clipTransformInteraction";

const identity: ClipTransformDraft = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
};
const media = { width: 400, height: 200 };
const corners: TransformCorner[] = ["nw", "ne", "se", "sw"];
const opposite: Record<TransformCorner, TransformCorner> = {
  nw: "se",
  ne: "sw",
  se: "nw",
  sw: "ne",
};

function cornerPosition(
  transform: ClipTransformDraft,
  corner: TransformCorner,
  size = media,
  viewportScale = 0.5,
) {
  const x =
    (corner.endsWith("w") ? -1 : 1) * size.width * transform.scale * 0.5;
  const y =
    (corner.startsWith("n") ? -1 : 1) * size.height * transform.scale * 0.5;
  const radians = (transform.rotation * Math.PI) / 180;
  return {
    x:
      transform.x * viewportScale +
      x * Math.cos(radians) -
      y * Math.sin(radians),
    y:
      transform.y * viewportScale +
      x * Math.sin(radians) +
      y * Math.cos(radians),
  };
}

function expectPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("clip transform movement", () => {
  it("converts CSS pointer deltas into composition-frame pixels", () => {
    const initial = { x: 120, y: -40, scale: 1.5, rotation: 35 };

    expect(moveClipTransform(initial, { x: 25, y: -10 }, 0.5)).toEqual({
      x: 170,
      y: -60,
      scale: 1.5,
      rotation: 35,
    });
    expect(initial).toEqual({ x: 120, y: -40, scale: 1.5, rotation: 35 });
  });
});

describe("proportional clip transform resize", () => {
  for (const corner of corners) {
    it.each([0, 37, 90, 180, -25])(
      `keeps ${opposite[corner]} fixed while dragging ${corner} at %s degrees`,
      (rotation) => {
        const initial = { x: 120, y: -40, scale: 1.25, rotation };
        const anchored = cornerPosition(initial, opposite[corner]);
        const dragged = cornerPosition(initial, corner);
        const delta = {
          x: (dragged.x - anchored.x) * 0.4,
          y: (dragged.y - anchored.y) * 0.4,
        };

        const resized = resizeClipTransform(initial, delta, corner, media, 0.5);

        expect(resized.scale).toBeCloseTo(1.75, 10);
        expect(resized.rotation).toBe(rotation);
        expectPoint(cornerPosition(resized, opposite[corner]), anchored);
        expectPoint(cornerPosition(resized, corner), {
          x: dragged.x + delta.x,
          y: dragged.y + delta.y,
        });
      },
    );
  }

  it("clamps at a positive minimum without flipping", () => {
    const anchored = cornerPosition(identity, "nw");
    const resized = resizeClipTransform(
      identity,
      { x: -1000, y: -500 },
      "se",
      media,
      0.5,
    );

    expect(resized.scale).toBe(0.01);
    expectPoint(cornerPosition(resized, "nw"), anchored);
  });
});

describe("clip transform interaction validation", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid viewport scale %s",
    (scale) => {
      expect(() => moveClipTransform(identity, { x: 1, y: 2 }, scale)).toThrow(
        /viewport.*scale/i,
      );
      expect(() =>
        resizeClipTransform(identity, { x: 1, y: 2 }, "se", media, scale),
      ).toThrow(/viewport.*scale/i);
    },
  );

  it.each([
    { x: Number.NaN, y: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY },
    { x: Number.NEGATIVE_INFINITY, y: 1 },
  ])("rejects non-finite pointer movement %j", (delta) => {
    expect(() => moveClipTransform(identity, delta, 0.5)).toThrow(/delta/i);
    expect(() =>
      resizeClipTransform(identity, delta, "se", media, 0.5),
    ).toThrow(/delta/i);
  });

  it.each([
    ["x", Number.NaN],
    ["y", Number.POSITIVE_INFINITY],
    ["rotation", Number.NaN],
    ["scale", 0],
    ["scale", -1],
  ] as const)("rejects invalid initial %s=%s", (field, value) => {
    const initial = { ...identity, [field]: value };
    expect(() => moveClipTransform(initial, { x: 0, y: 0 }, 0.5)).toThrow(
      new RegExp(field, "i"),
    );
  });

  it("rejects invalid media dimensions and unsupported corners", () => {
    expect(() =>
      resizeClipTransform(
        identity,
        { x: 0, y: 0 },
        "se",
        {
          width: 0,
          height: 200,
        },
        0.5,
      ),
    ).toThrow(/media/i);
    expect(() =>
      resizeClipTransform(
        identity,
        { x: 0, y: 0 },
        "center" as TransformCorner,
        media,
        0.5,
      ),
    ).toThrow(/corner/i);
  });
});
