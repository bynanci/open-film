import { describe, expect, it } from "vitest";
import {
  CLIP_GEOMETRY_CONTRACT_VERSION,
  fitFrameToViewport,
  geometryTranslationForViewport,
  resolveClipGeometry,
  resolvePreviewClipGeometry,
} from "../src/geometry";

describe("clip geometry contract", () => {
  it("uses stable identity defaults", () => {
    expect(CLIP_GEOMETRY_CONTRACT_VERSION).toBe("1.0.0");
    expect(resolveClipGeometry()).toEqual({
      scale: 1,
      rotation: 0,
      x: 0,
      y: 0,
    });
  });

  it("fits the composition frame without changing its aspect ratio", () => {
    expect(
      fitFrameToViewport(
        { width: 1920, height: 1080 },
        { width: 800, height: 800 },
      ),
    ).toEqual({
      scale: 800 / 1920,
      width: 800,
      height: 450,
      offsetX: 0,
      offsetY: 175,
    });
  });

  it("keeps source aspect separate from the composition frame in preview geometry", () => {
    const mapped = resolvePreviewClipGeometry(
      { scale: 1.25, rotation: 90, x: 192, y: -108 },
      { width: 4000, height: 2000 },
      { width: 1920, height: 1080 },
      { width: 960, height: 720 },
    );
    expect(mapped.frame).toEqual({
      scale: 0.5,
      width: 960,
      height: 540,
      offsetX: 0,
      offsetY: 90,
    });
    expect(mapped.media).toEqual({ width: 960, height: 480 });
    expect(mapped.x).toBe(96);
    expect(mapped.y).toBe(-54);
    expect(mapped.scale).toBe(1.25);
    expect(mapped.rotation).toBe(90);
  });

  it("maps frame-pixel translation into preview pixels", () => {
    const mapped = geometryTranslationForViewport(
      { scale: 1.4, rotation: 12, x: 192, y: -108 },
      { width: 1920, height: 1080 },
      { width: 960, height: 540 },
    );
    expect(mapped.x).toBe(96);
    expect(mapped.y).toBe(-54);
    expect(mapped.frame.scale).toBe(0.5);
  });

  it("rejects invalid geometry instead of producing divergent adapters", () => {
    expect(() => resolveClipGeometry({ scale: 0 })).toThrow(/scale/);
    expect(() =>
      fitFrameToViewport(
        { width: 0, height: 1080 },
        { width: 960, height: 540 },
      ),
    ).toThrow(/Frame width/);
  });
});
