import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import {
  compactPath,
  sourcePresentation,
} from "../../apps/desktop/src/sourcePresentation";
import enUS from "../../apps/desktop/src/i18n/modules/media/en-US";
import zhTW from "../../apps/desktop/src/i18n/modules/media/zh-TW";
import jaJP from "../../apps/desktop/src/i18n/modules/media/ja-JP";
import {
  flattenMessages,
  translationProblems,
} from "../../apps/desktop/src/i18n/coverage";

const asset: MediaAsset = {
  id: "memory",
  uri: "file:///Media/日本%20%20旅行/%23%20%26/photo.dng",
  name: "日本  旅行 # &.dng",
  mediaType: "image",
  tags: [],
  state: { favorite: true },
  capturedAt: "2026-01-02T12:00:00Z",
  capturedAtSource: "exif",
  timezone: "+09:00",
  dimensions: { width: 3000, height: 2000 },
  source: { manufacturer: "Google", device: "Pixel 9" },
  codec: "hevc",
  hdr: true,
  metadata: {
    "openfilm.pixel": {
      recognized: true,
      device: "Pixel 9",
      motionPhoto: {
        detected: true,
        kind: "sidecar",
        sidecarUri: "file:///Media/日本  旅行/# &/motion.mp4",
        offsetBytes: 1024,
      },
    },
    "openfilm.preview": {
      supported: false,
      reason: "Decoder technical detail",
      warnings: ["Internal codec diagnostic"],
    },
    "openfilm.color": { bitDepth: 10, transfer: "arib-std-b67", hdr: true },
    "openfilm.insta360": {
      original360Sources: ["file:///Media/日本  旅行/# &/original.insv"],
    },
  },
};

function translator(catalog: typeof enUS) {
  const flat = flattenMessages(catalog);
  return (key: string, params: Record<string, string | number> = {}) => {
    const value = flat[key];
    if (value === undefined) throw new Error(`Untranslated ${key}`);
    return value.replace(/\{(\w+)\}/g, (_, name: string) =>
      String(params[name] ?? ""),
    );
  };
}

describe("localized source presentation", () => {
  it.each([
    ["en-US", enUS],
    ["zh-TW", zhTW],
    ["ja-JP", jaJP],
  ] as const)(
    "covers source/recovery messages and placeholders for %s",
    (_, catalog) => {
      expect(translationProblems(enUS, catalog)).toEqual([]);
      const before = structuredClone(asset);
      const presented = sourcePresentation(asset, {
        translate: translator(catalog),
      });
      expect(presented.kindLabel).toBe(catalog.media.source.kindDng);
      expect(
        presented.details.find((item) => item.key === "camera")?.label,
      ).toBe(catalog.media.source.fields.camera);
      expect(presented.previewReason).toBe(catalog.media.source.dngHelp);
      expect(presented.previewWarnings).not.toContain(
        "Internal codec diagnostic",
      );
      expect(presented.technicalWarnings).toEqual([
        "Internal codec diagnostic",
        "Decoder technical detail",
      ]);
      expect(asset).toEqual(before);
    },
  );
  it("preserves stable detail keys and actual CJK paths across language changes", () => {
    const english = sourcePresentation(asset);
    const japanese = sourcePresentation(asset, { translate: translator(jaJP) });
    expect(japanese.details.map((item) => item.key)).toEqual(
      english.details.map((item) => item.key),
    );
    expect(japanese.original360Sources).toEqual([
      "file:///Media/日本  旅行/# &/original.insv",
    ]);
    expect(
      japanese.evidence.find((item) => item.key === "motionSidecar")?.value,
    ).toBe("file:///Media/日本  旅行/# &/motion.mp4");
    expect(compactPath(asset.uri)).toBe("…/日本  旅行/# &/photo.dng");
    expect(compactPath("D:\\Proposal\\日本  旅行\\# &\\photo.jpg")).toBe(
      "…/日本  旅行/# &/photo.jpg",
    );
  });
  it("uses caller date and number formatters without translating protocol values", () => {
    const presented = sourcePresentation(asset, {
      translate: translator(zhTW),
      formatDate: () => "2026年1月2日",
      formatNumber: (value) => new Intl.NumberFormat("zh-TW").format(value),
    });
    expect(
      presented.details.find((item) => item.key === "captureTime")?.value,
    ).toBe("2026年1月2日");
    expect(presented.details.find((item) => item.key === "codec")?.value).toBe(
      "hevc",
    );
    expect(
      presented.evidence.find((item) => item.key === "embeddedOffset")?.value,
    ).toBe("1,024 位元組");
  });
});
