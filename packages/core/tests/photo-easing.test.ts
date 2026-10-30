import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

const curve = {
  version: 1 as const,
  kind: "cubic-bezier" as const,
  x1: 0.25,
  y1: 0.1,
  x2: 0.25,
  y2: 1,
};
const motion = {
  version: 2 as const,
  preset: "pan" as const,
  easing: curve,
  from: { scale: 1.1, x: -5, y: 0 },
  to: { scale: 1.1, x: 5, y: 0 },
};
const fill = {
  version: 1 as const,
  kind: "ambient" as const,
  blurSigma: 0.02,
  dim: 0.45,
};
const layout = { version: 2 as const, preset: "contain" as const, fill };
const clip: core.Clip = {
  id: "photo",
  assetId: "portrait",
  timelineStart: 0,
  timelineDuration: 4,
};
const sources = {
  portrait: { width: 1000, height: 2000 },
  other: { width: 1000, height: 2000 },
};
const frame = { width: 320, height: 180 };

describe("versioned photo finishing", () => {
  it("keeps legacy plans and absent optional fields exact", () => {
    expect(core.resolvePhotoPlan(clip, sources, frame)).toEqual({
      layers: [{ assetId: "portrait", x: 115, y: 0, width: 90, height: 180 }],
      motion: {
        from: { scale: 1, x: 0, y: 0 },
        to: { scale: 1, x: 0, y: 0 },
        easing: "linear",
      },
      warnings: [],
    });
    expect(core.evaluatePhotoEasing("linear", 0.25)).toBe(0.25);
    expect(core.evaluatePhotoEasing("ease-in-out", 0.25)).toBe(0.15625);
    expect(clip).not.toHaveProperty("layout");
    expect(clip).not.toHaveProperty("motion");
  });

  it("evaluates the bounded curve independently of seek order with exact clamped endpoints", () => {
    const before = structuredClone(curve);
    const values = [0.5, 1, -1, 0.25, 0.5, 2, 0].map((p) =>
      core.evaluatePhotoEasing(curve, p),
    );
    expect(values[0]).toBeCloseTo(0.802403, 6);
    expect(values[3]).toBeCloseTo(0.408511, 6);
    expect(values[0]).toBe(values[4]);
    expect([values[1], values[2], values[5], values[6]]).toEqual([1, 0, 1, 0]);
    expect(curve).toEqual(before);
    expect(() => core.evaluatePhotoEasing(curve, NaN)).toThrow(/finite/iu);
  });

  it.each([0, 1])(
    "handles endpoint-flat x coordinates %s without Newton division",
    (x) => {
      const value = core.evaluatePhotoEasing(
        { ...curve, x1: x, x2: x, y1: 0, y2: 1 },
        0.5,
      );
      expect(value).toBeCloseTo(x === 0 ? 0.889882 : 0.110118, 6);
    },
  );

  it("validates detached exact v2 recipes and rejects unsupported nested shapes", () => {
    expect(core.validatePhotoLayout(layout)).toEqual(layout);
    expect(core.validatePhotoMotion(motion)).toEqual(motion);
    expect(core.validatePhotoMotion(motion)).not.toBe(motion);
    for (const bad of [
      { ...layout, version: 3 },
      { ...layout, fill: undefined },
      { ...layout, fill: { ...fill, version: 2 } },
      { ...layout, fill: { ...fill, extra: true } },
      { ...layout, fill: { ...fill, blurSigma: 0.050001 } },
      { ...layout, fill: { ...fill, blurSigma: -0.01 } },
      { ...layout, fill: { ...fill, dim: 0.850001 } },
      { ...layout, fill: { ...fill, dim: "0.45" } },
      { ...layout, fill: { ...fill, dim: Infinity } },
      { ...layout, version: 1 },
    ])
      expect(() => core.validatePhotoLayout(bad)).toThrow();
    for (const bad of [
      { ...motion, version: 3 },
      { ...motion, easing: "linear" },
      { ...motion, easing: { ...curve, version: 2 } },
      { ...motion, easing: { ...curve, x1: -0.01 } },
      { ...motion, easing: { ...curve, y2: 1.00001 } },
      { ...motion, easing: { ...curve, x1: 0.8, x2: 0.2 } },
      { ...motion, easing: { ...curve, y1: 0.8, y2: 0.2 } },
      { ...motion, easing: { ...curve, x1: "0.2" } },
      { ...motion, easing: { ...curve, x1: NaN } },
      { ...motion, easing: { ...curve, expression: "while(1,1)" } },
      { ...motion, version: 1 },
    ])
      expect(() => core.validatePhotoMotion(bad)).toThrow();
    expect(
      core.validatePhotoLayout({
        ...layout,
        fill: { ...fill, blurSigma: 0, dim: 0.85 },
      }),
    ).toBeTruthy();
  });

  it("resolves raw ambient geometry independently of focal/protected foreground safety", () => {
    const plan = core.resolvePhotoPlan({ ...clip, layout }, sources, frame);
    expect(plan.layers).toEqual([
      { assetId: "portrait", x: 115, y: 0, width: 90, height: 180 },
    ]);
    expect(plan.ambient).toEqual({
      version: 1,
      sigma: 3.6,
      dim: 0.45,
      layers: [
        {
          assetId: "portrait",
          cell: { x: 0, y: 0, width: 320, height: 180 },
          cover: {
            assetId: "portrait",
            x: 0,
            y: -230,
            width: 320,
            height: 640,
          },
        },
      ],
    });
    const protectedPlan = core.resolvePhotoPlan(
      {
        ...clip,
        layout: {
          ...layout,
          preset: "hero",
          focalPoint: { x: 1, y: 1 },
          protectedRegion: { x: 0, y: 0, width: 1, height: 1 },
        },
        motion,
      },
      sources,
      frame,
    );
    expect(protectedPlan.ambient).toEqual(plan.ambient);
    expect(protectedPlan.warnings).toContain(
      "PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK",
    );
    expect(protectedPlan.warnings).toContain(
      "PHOTO_MOTION_PROTECTED_REGION_HOLD",
    );
  });

  it("keeps separate diptych ambient cells and rejects a cell rounded to zero pixels", () => {
    const paired = {
      ...layout,
      preset: "diptych" as const,
      gap: 8,
      secondary: { assetId: "other" },
    };
    const plan = core.resolvePhotoPlan(
      { ...clip, layout: paired },
      sources,
      frame,
    );
    expect(plan.ambient?.layers.map((layer) => layer.cell)).toEqual([
      { x: 0, y: 0, width: 156, height: 180 },
      { x: 164, y: 0, width: 156, height: 180 },
    ]);
    expect(() =>
      core.resolvePhotoPlan(
        { ...clip, layout: { ...paired, gap: 319 } },
        sources,
        frame,
      ),
    ).toThrow(/pixel/iu);
    expect(
      core.validatePhotoLayout({
        version: 1,
        preset: "diptych",
        gap: 319,
        secondary: { assetId: "other" },
      }),
    ).toBeTruthy();
  });

  it("uses the existing clip-local motion clock with custom easing", () => {
    const moving = { ...clip, layout, motion };
    const middle = core.evaluateClipAtTime(moving, 2, sources, frame);
    expect(middle.transform.x).toBeCloseTo(3.02403, 5);
    expect(
      core.evaluateClipAtTime(
        { ...moving, timelineDuration: 8 },
        4,
        sources,
        frame,
      ).transform,
    ).toEqual(middle.transform);
    expect(
      core.evaluateClipAtTime(moving, 4, sources, frame).transform,
    ).toEqual(motion.to);
  });
});
