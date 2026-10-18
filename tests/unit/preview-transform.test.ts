import { describe, expect, it } from "vitest";
import {
  movePreviewTransform,
  resizePreviewTransform,
  type Point,
  type PreviewTransform,
  type TransformCorner,
} from "../../apps/desktop/src/previewTransform";

const identity = { x: 0, y: 0, scale: 1, rotation: 0 };
const media = { width: 400, height: 200 };
const corners: TransformCorner[] = ["nw", "ne", "se", "sw"];
const opposite: Record<TransformCorner, TransformCorner> = {
  nw: "se",
  ne: "sw",
  se: "nw",
  sw: "ne",
};

/** Locate a media corner using the renderer's center/rotate/scale contract. */
function cornerPosition(
  transform: PreviewTransform,
  corner: TransformCorner,
  size = media,
  viewportScale = 0.5,
): Point {
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

function expectPoint(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("moving a preview transform", () => {
  it("converts pointer movement to composition pixels without changing scale or rotation", () => {
    const initial = { x: 120, y: -40, scale: 1.5, rotation: 35 };

    expect(movePreviewTransform(initial, { x: 25, y: -10 }, 0.5)).toEqual({
      x: 170,
      y: -60,
      scale: 1.5,
      rotation: 35,
    });
    expect(initial).toEqual({ x: 120, y: -40, scale: 1.5, rotation: 35 });
  });
});

describe("resizing a preview transform", () => {
  it("grows around the opposite corner while storing center movement in composition pixels", () => {
    expect(
      resizePreviewTransform(identity, { x: 200, y: 100 }, "se", media, 0.5),
    ).toEqual({ x: 200, y: 100, scale: 1.5, rotation: 0 });
    expect(identity).toEqual({ x: 0, y: 0, scale: 1, rotation: 0 });
  });

  for (const corner of corners) {
    it.each([0, 37, 90, 180, -25])(
      `keeps the ${opposite[corner]} corner fixed when dragging ${corner} at %s degrees`,
      (rotation) => {
        const initial = { x: 120, y: -40, scale: 1.25, rotation };
        const anchored = cornerPosition(initial, opposite[corner]);
        const dragged = cornerPosition(initial, corner);
        const delta = {
          x: (dragged.x - anchored.x) * 0.4,
          y: (dragged.y - anchored.y) * 0.4,
        };

        const resized = resizePreviewTransform(
          initial,
          delta,
          corner,
          media,
          0.5,
        );

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

  it("ignores movement perpendicular to the rotated diagonal", () => {
    const initial = { x: -75, y: 25, scale: 1.5, rotation: 30 };
    const anchored = cornerPosition(initial, "nw");
    const dragged = cornerPosition(initial, "se");
    const result = resizePreviewTransform(
      initial,
      { x: -(dragged.y - anchored.y), y: dragged.x - anchored.x },
      "se",
      media,
      0.5,
    );

    expect(result.scale).toBeCloseTo(initial.scale, 10);
    expectPoint(result, initial);
  });

  it("preserves portrait proportions and the fixed corner in a narrow viewport", () => {
    const portrait = { width: 120, height: 480 };
    const initial = { x: -100, y: 60, scale: 2, rotation: 90 };
    const anchored = cornerPosition(initial, "se", portrait, 0.2);
    const result = resizePreviewTransform(
      initial,
      { x: 240, y: -60 },
      "nw",
      portrait,
      0.2,
    );

    expect(result.scale).toBeCloseTo(2.5, 10);
    expect(result.rotation).toBe(90);
    expectPoint(cornerPosition(result, "se", portrait, 0.2), anchored);
  });

  it("clamps at minimum scale without flipping when dragged past the fixed corner", () => {
    const anchored = cornerPosition(identity, "nw");
    const result = resizePreviewTransform(
      identity,
      { x: -1000, y: -500 },
      "se",
      media,
      0.5,
    );

    expect(result.scale).toBe(0.01);
    expectPoint(cornerPosition(result, "nw"), anchored);
    const dragged = cornerPosition(result, "se");
    expect(dragged.x).toBeGreaterThan(anchored.x);
    expect(dragged.y).toBeGreaterThan(anchored.y);
  });
});

describe("preview gesture input validation", () => {
  it.each([0, -1, NaN, Infinity])(
    "rejects invalid viewport scale %s",
    (scale) => {
      expect(() =>
        movePreviewTransform(identity, { x: 1, y: 2 }, scale),
      ).toThrow(/viewport.*scale/i);
      expect(() =>
        resizePreviewTransform(identity, { x: 1, y: 2 }, "se", media, scale),
      ).toThrow(/viewport.*scale/i);
    },
  );

  it.each([
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
    { x: -Infinity, y: 1 },
  ])("rejects nonfinite pointer movement %j", (delta) => {
    expect(() => movePreviewTransform(identity, delta, 0.5)).toThrow(/delta/i);
    expect(() =>
      resizePreviewTransform(identity, delta, "se", media, 0.5),
    ).toThrow(/delta/i);
  });

  it.each([
    ["x", NaN],
    ["y", Infinity],
    ["rotation", NaN],
    ["scale", 0],
    ["scale", -1],
    ["scale", Infinity],
  ] as const)("rejects invalid initial %s=%s", (field, value) => {
    const initial = { ...identity, [field]: value };
    expect(() => movePreviewTransform(initial, { x: 0, y: 0 }, 0.5)).toThrow(
      new RegExp(field, "i"),
    );
    expect(() =>
      resizePreviewTransform(initial, { x: 0, y: 0 }, "se", media, 0.5),
    ).toThrow(new RegExp(field, "i"));
  });

  it.each([
    { width: 0, height: 200 },
    { width: 400, height: -1 },
    { width: NaN, height: 200 },
    { width: 400, height: Infinity },
  ])("rejects invalid contained media dimensions %j", (size) => {
    expect(() =>
      resizePreviewTransform(identity, { x: 0, y: 0 }, "se", size, 0.5),
    ).toThrow(/media/i);
  });

  it("rejects an unsupported corner", () => {
    expect(() =>
      resizePreviewTransform(
        identity,
        { x: 0, y: 0 },
        "center" as TransformCorner,
        media,
        0.5,
      ),
    ).toThrow(/corner/i);
  });

  it("rejects movement that would overflow the resulting composition position", () => {
    expect(() =>
      movePreviewTransform(identity, { x: Number.MAX_VALUE, y: 0 }, 0.1),
    ).toThrow(/finite/i);
  });
});
