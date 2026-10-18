import { describe, expect, it } from "vitest";
import {
  evaluateAudioGain,
  assetDisplayDimensions,
  evaluateClipAtTime,
  resolvePhotoPlan,
  validateAudioAutomation,
  validateComposition,
  validatePhotoLayout,
  validatePhotoMotion,
  validateTitleStyle,
  type AudioAutomation,
  type Clip,
  type Composition,
} from "../src/index.js";

const frame = { width: 1920, height: 1080 };
const sources = {
  portrait: { width: 1000, height: 2000 },
  landscape: { width: 4000, height: 2000 },
};
const clip: Clip = {
  id: "photo",
  assetId: "portrait",
  timelineStart: 0,
  timelineDuration: 4,
};
const identity = { scale: 1, x: 0, y: 0 };

describe("photo presentation contract", () => {
  it("uses decoded display dimensions for EXIF rotation, SAR and saved display metadata", () => {
    const dimensions = { width: 80, height: 40 };
    expect(
      assetDisplayDimensions({
        dimensions,
        metadata: { "openfilm.exif": { Orientation: 6 } },
      }),
    ).toEqual({ width: 40, height: 80 });
    expect(
      assetDisplayDimensions({
        dimensions,
        metadata: {
          "openfilm.ffprobe": {
            streams: [
              {
                codec_type: "video",
                sample_aspect_ratio: "2:1",
                side_data_list: [{ rotation: 90 }],
              },
            ],
          },
        },
      }),
    ).toEqual({ width: 40, height: 160 });
    expect(
      assetDisplayDimensions({
        dimensions,
        metadata: {
          "openfilm.display": { version: 1, width: 30, height: 90 },
          "openfilm.exif": { Orientation: 6 },
        },
      }),
    ).toEqual({ width: 30, height: 90 });
    expect(assetDisplayDimensions({ metadata: {} })).toBeUndefined();
  });
  it("keeps legacy contain framing with identity motion", () => {
    expect(resolvePhotoPlan(clip, sources, frame)).toEqual({
      layers: [{ assetId: "portrait", x: 690, y: 0, width: 540, height: 1080 }],
      motion: { from: identity, to: identity, easing: "linear" },
      warnings: [],
    });
  });

  it("uses focal cover positioning but contains an oversized protected region", () => {
    const hero: Clip = {
      ...clip,
      assetId: "landscape",
      layout: {
        version: 1,
        preset: "hero",
        focalPoint: { x: 0, y: 0.5 },
      },
    };
    expect(resolvePhotoPlan(hero, sources, frame).layers[0]).toEqual({
      assetId: "landscape",
      x: 0,
      y: 0,
      width: 2160,
      height: 1080,
    });
    hero.layout!.protectedRegion = { x: 0, y: 0, width: 1, height: 1 };
    const safe = resolvePhotoPlan(hero, sources, frame);
    expect(safe.layers[0]).toEqual({
      assetId: "landscape",
      x: 0,
      y: 60,
      width: 1920,
      height: 960,
    });
    expect(safe.warnings).toContain("PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK");
  });

  it("keeps two portraits separate with an explicit gap", () => {
    const result = resolvePhotoPlan(
      {
        ...clip,
        layout: {
          version: 1,
          preset: "diptych",
          gap: 40,
          secondary: { assetId: "portrait" },
        },
      },
      sources,
      frame,
    );
    expect(result.layers).toEqual([
      { assetId: "portrait", x: 200, y: 0, width: 540, height: 1080 },
      { assetId: "portrait", x: 1180, y: 0, width: 540, height: 1080 },
    ]);
  });

  it("evaluates motion deterministically at arbitrary seek positions", () => {
    const moving: Clip = {
      ...clip,
      motion: {
        version: 1,
        preset: "push-in",
        easing: "ease-in-out",
        from: identity,
        to: { scale: 1.1, x: 10, y: -20 },
      },
    };
    expect(evaluateClipAtTime(moving, -1, sources, frame).transform).toEqual(
      identity,
    );
    expect(evaluateClipAtTime(moving, 2, sources, frame).transform).toEqual({
      scale: 1.05,
      x: 5,
      y: -10,
    });
    expect(evaluateClipAtTime(moving, 10, sources, frame).transform).toEqual(
      moving.motion!.to,
    );
  });

  it.each(["linear", "ease-in-out"])(
    "validates a pull-out and deterministically eases from close framing to the whole photo (%s)",
    (easing) => {
      const motion = validatePhotoMotion({
        version: 1,
        preset: "pull-out",
        easing,
        from: { scale: 1.06, x: 0, y: 0 },
        to: identity,
      });
      const moving: Clip = { ...clip, motion };
      const before = structuredClone(moving);
      expect(evaluateClipAtTime(moving, -1, sources, frame).transform).toEqual(
        motion.from,
      );
      expect(evaluateClipAtTime(moving, 0, sources, frame).transform).toEqual(
        motion.from,
      );
      expect(evaluateClipAtTime(moving, 2, sources, frame).transform).toEqual({
        scale: 1.03,
        x: 0,
        y: 0,
      });
      expect(evaluateClipAtTime(moving, 4, sources, frame).transform).toEqual(
        identity,
      );
      expect(evaluateClipAtTime(moving, 10, sources, frame).transform).toEqual(
        identity,
      );
      expect(moving).toEqual(before);
      expect(resolvePhotoPlan(moving, sources, frame).warnings).toEqual([]);
    },
  );

  it("holds a pull-out if its initial close framing would crop a protected region", () => {
    const motion = validatePhotoMotion({
      version: 1,
      preset: "pull-out",
      easing: "ease-in-out",
      from: { scale: 1.06, x: 0, y: 0 },
      to: identity,
    });
    const result = resolvePhotoPlan(
      {
        ...clip,
        motion,
        layout: {
          version: 1,
          preset: "contain",
          protectedRegion: { x: 0, y: 0, width: 1, height: 1 },
        },
      },
      sources,
      frame,
    );
    expect(result.motion).toEqual({
      from: identity,
      to: identity,
      easing: "linear",
    });
    expect(result.warnings).toContain("PHOTO_MOTION_PROTECTED_REGION_HOLD");
  });

  it("keeps pull-out validation bounded rather than accepting unsupported presets or empty frame scales", () => {
    const valid = {
      version: 1,
      preset: "pull-out",
      easing: "linear",
      from: { scale: 1.06, x: 0, y: 0 },
      to: identity,
    };
    expect(validatePhotoMotion(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, preset: "zoom-magic" },
      { ...valid, to: { ...identity, scale: 0.9 } },
      { ...valid, from: { ...identity, scale: Infinity } },
      { ...valid, to: { ...identity, x: NaN } },
    ])
      expect(() => validatePhotoMotion(invalid)).toThrow();
  });

  it("holds unsafe motion instead of moving a protected subject out of frame", () => {
    const result = resolvePhotoPlan(
      {
        ...clip,
        layout: {
          version: 1,
          preset: "contain",
          protectedRegion: { x: 0, y: 0, width: 1, height: 1 },
        },
        motion: {
          version: 1,
          preset: "pan",
          easing: "linear",
          from: identity,
          to: { scale: 1.2, x: 0, y: 100 },
        },
      },
      sources,
      frame,
    );
    expect(result.motion.to).toEqual(identity);
    expect(result.warnings).toContain("PHOTO_MOTION_PROTECTED_REGION_HOLD");
  });

  it("holds panning beyond the zoom crop bounds instead of relying on renderer clamping", () => {
    const result = resolvePhotoPlan(
      {
        ...clip,
        motion: {
          version: 1,
          preset: "pan",
          easing: "linear",
          from: identity,
          to: { scale: 1.01, x: 100, y: 0 },
        },
      },
      sources,
      frame,
    );
    expect(result.motion.to).toEqual(identity);
    expect(result.warnings).toContain("PHOTO_MOTION_BOUNDS_HOLD");
  });

  it("rejects missing dimensions and nonfinite sampling times", () => {
    expect(() => resolvePhotoPlan(clip, {}, frame)).toThrow(/portrait/);
    expect(() => evaluateClipAtTime(clip, NaN, sources, frame)).toThrow(
      /time/i,
    );
  });

  it("protects separated subjects and reports manual transform overrides", () => {
    const protectedClip: Clip = {
      ...clip,
      assetId: "landscape",
      layout: {
        version: 1,
        preset: "hero",
        focalPoint: { x: 0, y: 0.5 },
        protectedRegion: { x: 0.05, y: 0.1, width: 0.9, height: 0.8 },
      },
    };
    const contained = resolvePhotoPlan(protectedClip, sources, frame);
    expect(contained.warnings).toContain(
      "PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK",
    );
    const overridden = resolvePhotoPlan(
      { ...protectedClip, transform: { scale: 1, x: 1000 } },
      sources,
      frame,
    );
    expect(overridden.warnings).toContain(
      "PHOTO_STATIC_TRANSFORM_PROTECTED_REGION",
    );
    expect(overridden.layers).toEqual(contained.layers);
  });

  it("repositions a hero crop to keep a protected region instead of blindly centering the focal point", () => {
    const result = resolvePhotoPlan(
      {
        ...clip,
        assetId: "landscape",
        layout: {
          version: 1,
          preset: "hero",
          focalPoint: { x: 0, y: 0.5 },
          protectedRegion: { x: 0.9, y: 0.3, width: 0.1, height: 0.4 },
        },
      },
      sources,
      frame,
    );
    expect(result.layers[0]!.x).toBe(-240);
    expect(result.warnings).toEqual([]);
  });
});

describe("presentation persistence validation", () => {
  it("returns independent clones and rejects unsupported or unsafe values", () => {
    const input = {
      version: 1,
      preset: "hero",
      focalPoint: { x: 0.5, y: 0.5 },
    };
    const value = validatePhotoLayout(input);
    value.focalPoint!.x = 0;
    expect(input.focalPoint.x).toBe(0.5);
    for (const invalid of [
      { ...input, version: 2 },
      { ...input, focalPoint: { x: 2, y: 0 } },
      { ...input, protectedRegion: { x: 0.8, y: 0, width: 0.4, height: 1 } },
      { version: 1, preset: "diptych" },
      { ...input, magicEffect: true },
    ])
      expect(() => validatePhotoLayout(invalid)).toThrow();
    expect(() =>
      validatePhotoMotion({
        version: 1,
        preset: "pan",
        easing: "linear",
        from: identity,
        to: { ...identity, scale: 0 },
      }),
    ).toThrow();
    expect(() =>
      validatePhotoMotion({
        version: 1,
        preset: "pan",
        easing: "linear",
        from: identity,
        to: { ...identity, scale: 0.9 },
      }),
    ).toThrow();
    expect(() =>
      validatePhotoMotion({
        version: 1,
        preset: "push-in",
        easing: "linear",
        from: identity,
        to: { ...identity, scale: 11 },
      }),
    ).toThrow();
    expect(() =>
      validateTitleStyle({ version: 1, role: "subtitle", fontSize: 0 }),
    ).toThrow();
    expect(() =>
      validateAudioAutomation({
        version: 1,
        role: "music",
        points: [
          { time: 1, gain: 1 },
          { time: 1, gain: 0 },
        ],
      }),
    ).toThrow();
  });

  it("validates secondary asset references, overlay timing and duration-bounded automation", () => {
    const value: Composition = {
      id: "c",
      storyId: "s",
      duration: 4,
      tracks: [
        {
          id: "v",
          type: "video",
          timing: "overlay",
          clips: [
            {
              ...clip,
              layout: {
                version: 1,
                preset: "diptych",
                secondary: { assetId: "other" },
              },
            },
          ],
        },
      ],
    };
    expect(() =>
      validateComposition(value, { assetIds: ["portrait"] }),
    ).toThrow(/other/);
    expect(
      validateComposition(value, { assetIds: ["portrait", "other"] }).tracks[0]!
        .timing,
    ).toBe("overlay");
    value.tracks[0]!.clips[0] = {
      ...clip,
      audioAutomation: { version: 1, role: "music", fadeIn: 5 },
    };
    expect(() => validateComposition(value)).toThrow(/fadeIn/);
  });
});

describe("audio automation", () => {
  it("ends an abrupt duck at the exclusive region boundary", () => {
    const automation: AudioAutomation = {
      version: 1,
      role: "music",
      ducking: [{ start: 1, end: 2, gain: 0.2, attack: 0, release: 0 }],
    };
    expect(evaluateAudioGain(automation, 0.99, 4)).toBe(1);
    expect(evaluateAudioGain(automation, 1, 4)).toBe(0.2);
    expect(evaluateAudioGain(automation, 1.99, 4)).toBe(0.2);
    expect(evaluateAudioGain(automation, 2, 4)).toBe(1);
  });

  it("combines fades, interpolated gain and manual ducking without timeline changes", () => {
    const automation: AudioAutomation = {
      version: 1,
      role: "music",
      fadeIn: 2,
      fadeOut: 2,
      points: [
        { time: 0, gain: 1 },
        { time: 10, gain: 0.5 },
      ],
      ducking: [{ start: 2, end: 8, gain: 0.2, attack: 1, release: 1 }],
    };
    expect(evaluateAudioGain(automation, 0, 10)).toBe(0);
    expect(evaluateAudioGain(automation, 1, 10)).toBeCloseTo(0.475);
    expect(evaluateAudioGain(automation, 2.5, 10)).toBeCloseTo(0.525);
    expect(evaluateAudioGain(automation, 5, 10)).toBeCloseTo(0.15);
    expect(evaluateAudioGain(automation, 9, 10)).toBeCloseTo(0.275);
    expect(evaluateAudioGain(automation, 10, 10)).toBe(0);
    expect(evaluateAudioGain(undefined, 5, 10)).toBe(1);
  });
});
