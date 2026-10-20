import { describe, expect, it } from "vitest";
import {
  createExportProfile,
  validateExportProfile,
  type ExportProfile,
} from "../src/index.js";

describe("versioned export profiles", () => {
  it("preserves PNG intermediate encoding quality and rejects it for audio-only profiles", () => {
    const png = createExportProfile({
      ratio: "16:9",
      frameRate: 12,
      format: "png",
      quality: "high-detail",
    });
    expect(png.quality).toBe("high-detail");
    for (const format of ["wav", "audio-stems"] as const)
      expect(() => validateExportProfile({ ...png, format })).toThrow(
        /quality/u,
      );
  });

  it.each([
    ["16:9", 1920, 1080],
    ["9:16", 1080, 1920],
    ["1:1", 1080, 1080],
  ] as const)(
    "creates the %s size without changing project settings",
    (ratio, width, height) => {
      const profile = createExportProfile({ ratio, frameRate: 30000 / 1001 });

      expect(profile).toMatchObject({
        version: 1,
        ratio,
        width,
        height,
        frameRate: 30000 / 1001,
        framing: "contain",
        subtitleStrategy: "preserve",
        format: "mp4",
        quality: "standard",
      });
    },
  );

  it("marks an explicit crop for review and preserves the selected format", () => {
    const profile = createExportProfile({
      ratio: "9:16",
      frameRate: 30,
      framing: "crop",
      format: "png",
      quality: "standard",
    });

    expect(profile.subtitleStrategy).toBe("review-crop");
    expect(validateExportProfile(profile)).toEqual(profile);
  });

  it.each([
    { width: 1919 },
    { width: 4096, height: 2304 },
    { frameRate: 0 },
    { frameRate: 61 },
    { framing: "stretch" },
    { format: "gif" },
    { subtitleStrategy: "ignore" },
  ])("rejects invalid or unsafe profile field changes: %o", (change) => {
    const profile = createExportProfile({ ratio: "16:9", frameRate: 30 });
    expect(() => validateExportProfile({ ...profile, ...change })).toThrow();
  });

  it("rejects a profile that claims to preserve captions while center cropping", () => {
    const profile: ExportProfile = {
      ...createExportProfile({ ratio: "1:1", frameRate: 30 }),
      framing: "crop",
      subtitleStrategy: "preserve",
    };
    expect(() => validateExportProfile(profile)).toThrow(/subtitleStrategy/u);
  });
});
