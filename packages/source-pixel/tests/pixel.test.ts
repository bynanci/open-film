import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { MediaAsset } from "@openfilm/core";
import type { MediaSourceAdapter } from "@openfilm/plugin-sdk";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import {
  enrichPixelAsset,
  inspectPixelDng,
  PixelSource,
  type PixelMetadata,
} from "../src/index.js";

const uri = (path: string): string => pathToFileURL(path).href;
const candidate = (path: string) => ({
  path,
  uri: uri(path),
  name: path.split("/").at(-1)!,
});
function asset(patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "durable-id",
    uri: "file:///missing/PXL_20240101.MP.jpg",
    name: "PXL_20240101.MP.jpg",
    mediaType: "image",
    tags: ["user-tag"],
    rating: 5,
    state: { locked: true, favorite: true },
    contentHash: "original-sha256",
    metadata: {
      "openfilm.exif": { Make: "Google", Model: "Pixel 8 Pro" },
      "user.notes": "Preserve me",
    },
    ...patch,
  };
}
const pixel = (asset: MediaAsset): PixelMetadata =>
  asset.metadata["openfilm.pixel"] as PixelMetadata;
let fixtures: string, scratch: string;
let exifScript: string;
beforeAll(async () => {
  fixtures = await mkdtemp(join(tmpdir(), "openfilm-pixel-fixtures-"));
  const require = createRequire(import.meta.url);
  exifScript = join(
    dirname(require.resolve("exiftool-vendored.pl/package.json")),
    "bin",
    "exiftool",
  );
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=64x96",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    join(fixtures, "pixel.jpg"),
  ]);
  await runProcess("perl", [
    exifScript,
    "-overwrite_original",
    "-Make=Google",
    "-Model=Pixel 8 Pro",
    "-DateTimeOriginal=2024:07:08 09:10:11",
    "-OffsetTimeOriginal=+08:00",
    "-Orientation#=6",
    "-GPSLatitude=33.86",
    "-GPSLatitudeRef=S",
    "-GPSLongitude=151.21",
    "-GPSLongitudeRef=E",
    "-XMP-GCamera:MicroVideo=1",
    "-XMP-GCamera:MicroVideoOffset=0",
    join(fixtures, "pixel.jpg"),
  ]);
  // Synthetic TIFF IFD with dimensions but no strips: real metadata, no camera pixel payload.
  const tiff = Buffer.alloc(38);
  tiff.write("II", 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  for (const [index, tag] of [256, 257].entries()) {
    const offset = 10 + index * 12;
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(4, offset + 2);
    tiff.writeUInt32LE(1, offset + 4);
    tiff.writeUInt32LE(16, offset + 8);
  }
  await writeFile(join(fixtures, "metadata-only.dng"), tiff);
  await runProcess("perl", [
    exifScript,
    "-overwrite_original",
    "-DNGVersion=1.4.0.0",
    "-DNGBackwardVersion=1.1.0.0",
    "-Make=Google",
    "-Model=Pixel 8 Pro",
    "-UniqueCameraModel=Google Pixel 8 Pro",
    "-DateTimeOriginal=2024:07:08 09:10:11",
    "-OffsetTimeOriginal=+08:00",
    "-ImageDescription=Synthetic CC0 metadata-only fixture; no pixel data",
    join(fixtures, "metadata-only.dng"),
  ]);
});
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "openfilm-pixel-test-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(fixtures, { recursive: true, force: true });
});

describe("Google Pixel metadata recognition", () => {
  it("preserves durable state, manual metadata, and probed technical/color evidence in a detached result", async () => {
    const before = asset({
      mediaType: "video",
      duration: 8,
      dimensions: { width: 1080, height: 1920 },
      codec: "hevc",
      frameRate: 30,
      colorSpace: "bt2020nc",
      hdr: true,
      metadata: {
        "openfilm.exif": {
          Make: "Google",
          Model: "Pixel 9 Pro XL",
          Orientation: 6,
        },
        "openfilm.ffprobe": {
          streams: [
            {
              color_transfer: "arib-std-b67",
              color_primaries: "bt2020",
              pix_fmt: "yuv420p10le",
            },
          ],
        },
        "user.notes": "keep",
      },
    });
    const snapshot = structuredClone(before),
      after = await enrichPixelAsset(before);
    expect(pixel(after)).toMatchObject({
      recognized: true,
      device: "Pixel 9 Pro XL",
      evidence: {
        orientation: 6,
        dimensions: before.dimensions,
        codec: "hevc",
        frameRate: 30,
        colorSpace: "bt2020nc",
        hdr: true,
      },
    });
    expect(after.metadata["openfilm.ffprobe"]).toEqual(
      before.metadata["openfilm.ffprobe"],
    );
    expect(after).toMatchObject({
      id: before.id,
      uri: before.uri,
      contentHash: before.contentHash,
      state: before.state,
      rating: 5,
      tags: before.tags,
      duration: 8,
    });
    expect(before).toEqual(snapshot);
    after.state.locked = false;
    expect(before.state.locked).toBe(true);
  });
  it.each([
    { Make: "Canon", Model: "EOS R5", Software: "Google Photos" },
    { Model: "Pixel 8 Pro" },
    { Make: "Google", Model: "A simulated Pixel-like camera" },
    { Make: "Samsung", Model: "Google Pixel 8" },
    {},
  ])(
    "uses GenericCamera for uncertain or contradictory source tags %j",
    async (exif) => {
      const after = await enrichPixelAsset(
        asset({ metadata: { "openfilm.exif": exif } }),
      );
      expect(pixel(after)).toMatchObject({
        recognized: false,
        fallback: "GenericCamera",
      });
      expect(after.source).toBeUndefined();
      expect(pixel(after).motionPhoto).toBeUndefined();
    },
  );
  it("recognizes QuickTime camera tags and namespaced EXIF without inferring from software tags", async () => {
    const video = asset({
      mediaType: "video",
      metadata: {
        "openfilm.ffprobe": {
          format: {
            tags: {
              "com.android.manufacturer": "Google",
              "com.android.model": "Pixel 8",
            },
          },
        },
      },
    });
    expect(pixel(await enrichPixelAsset(video)).recognized).toBe(true);
    expect(
      pixel(
        await enrichPixelAsset(
          asset({
            metadata: {
              "openfilm.exif": {
                "EXIF:Make": "Google",
                "EXIF:Model": "Pixel Fold",
              },
            },
          }),
        ),
      ).device,
    ).toBe("Pixel Fold");
  });
  it("retains real EXIF date offset, orientation, southern GPS, device and portrait dimensions", async () => {
    const path = join(fixtures, "pixel.jpg"),
      beforeHash = await hashFile(path);
    const raw = await inspectMedia(candidate(path)),
      after = await enrichPixelAsset(raw);
    expect(after.capturedAt).toBe("2024-07-08T01:10:11.000Z");
    expect(after.timezone).toBe("+08:00");
    expect(after.source).toMatchObject({
      manufacturer: "Google",
      device: "Pixel 8 Pro",
    });
    expect(after.dimensions).toEqual({ width: 64, height: 96 });
    expect(after.gps?.latitude).toBeCloseTo(-33.86, 4);
    expect(after.gps?.longitude).toBeCloseTo(151.21, 4);
    expect(pixel(after).evidence.orientation).toBe(6);
    expect(pixel(after).motionPhoto).toMatchObject({
      detected: true,
      kind: "metadata-reference",
      experimental: true,
    });
    expect(after.metadata["openfilm.exif"]).toEqual(
      raw.metadata["openfilm.exif"],
    );
    expect(await hashFile(path)).toBe(beforeHash);
  });
  it("does not overwrite a manually assigned capture time", async () => {
    const before = asset({
      capturedAt: "2020-01-01T00:00:00.000Z",
      capturedAtSource: "user:corrected",
      metadata: {
        "openfilm.exif": {
          Make: "Google",
          Model: "Pixel 8",
          DateTimeOriginal: "2024:01:01 10:00:00",
          OffsetTimeOriginal: "+08:00",
        },
      },
    });
    expect((await enrichPixelAsset(before)).capturedAt).toBe(before.capturedAt);
  });
});

describe("experimental Motion Photo evidence", () => {
  it.each([false, 0, ""])(
    "does not label an empty embedded-video field %j as a Motion Photo",
    async (embedded) => {
      const after = await enrichPixelAsset(
        asset({
          metadata: {
            "openfilm.exif": {
              Make: "Google",
              Model: "Pixel 8",
              EmbeddedVideo: embedded,
            },
          },
        }),
      );
      expect(pixel(after).motionPhoto).toBeUndefined();
    },
  );
  it("leaves multiple named sibling videos ambiguous", async () => {
    await writeFile(join(scratch, "photo.mp4"), "first synthetic sidecar");
    await writeFile(join(scratch, "photo.mov"), "second synthetic sidecar");
    const after = await enrichPixelAsset(
      asset({
        uri: uri(join(scratch, "photo.jpg")),
        metadata: {
          "openfilm.exif": { Make: "Google", Model: "Pixel 8", MotionPhoto: 1 },
        },
      }),
    );
    expect(pixel(after).motionPhoto?.kind).toBe("metadata-reference");
    expect(pixel(after).motionPhoto?.sidecarUri).toBeUndefined();
    expect(pixel(after).motionPhoto?.evidence.join(" ")).toContain(
      "Multiple sibling videos",
    );
  });
  it("labels bounded embedded-offset metadata without claiming to extract the movie", async () => {
    const before = asset({
      metadata: {
        "openfilm.exif": {
          Make: "Google",
          Model: "Pixel 8",
          "XMP-GCamera:MicroVideo": 1,
          "XMP-GCamera:MicroVideoOffset": 150,
        },
        "openfilm.filesystem": { size: 1000 },
      },
    });
    const after = await enrichPixelAsset(before);
    expect(pixel(after).motionPhoto).toMatchObject({
      detected: true,
      kind: "embedded",
      experimental: true,
      offsetBytes: 150,
    });
    expect(
      pixel(after).motionPhoto?.evidence.some((item) =>
        item.includes("within the source"),
      ),
    ).toBe(true);
    expect(after.uri).toBe(before.uri);
    expect(after.mediaType).toBe("image");
    expect(after.duration).toBeUndefined();
  });
  it.each([0, -1, 1000, 1500, Number.NaN])(
    "keeps invalid or unverified offset %s as metadata evidence",
    async (offset) => {
      const after = await enrichPixelAsset(
        asset({
          metadata: {
            "openfilm.exif": {
              Make: "Google",
              Model: "Pixel 8",
              MotionPhoto: 1,
              MicroVideoOffset: offset,
            },
            "openfilm.filesystem": { size: 1000 },
          },
        }),
      );
      expect(pixel(after).motionPhoto).toMatchObject({
        kind: "metadata-reference",
        experimental: true,
      });
      expect(pixel(after).motionPhoto?.offsetBytes).toBeUndefined();
    },
  );
  it("finds regular matching sibling videos and keeps the association explicitly experimental", async () => {
    const path = join(scratch, "PXL_test.MP.jpg"),
      sidecar = join(scratch, "PXL_test.MP.mp4");
    await writeFile(path, "synthetic photo marker");
    await writeFile(
      sidecar,
      "synthetic sidecar marker; content is not validated here",
    );
    const after = await enrichPixelAsset(
      asset({
        uri: uri(path),
        metadata: {
          "openfilm.exif": { Make: "Google", Model: "Pixel 8", MotionPhoto: 1 },
        },
      }),
    );
    expect(pixel(after).motionPhoto).toMatchObject({
      kind: "sidecar",
      sidecarUri: uri(sidecar),
      experimental: true,
    });
    expect(pixel(after).motionPhoto?.evidence.join(" ")).toContain(
      "pairing is experimental",
    );
  });
  it("preserves unresolved metadata references while refusing outside-directory and symlink sidecars", async () => {
    await mkdir(join(scratch, "source"));
    const path = join(scratch, "source", "photo.jpg"),
      outside = join(scratch, "outside.mp4");
    await writeFile(outside, "not read");
    await symlink(outside, join(scratch, "source", "photo.mp4"));
    const after = await enrichPixelAsset(
      asset({
        uri: uri(path),
        metadata: {
          "openfilm.exif": {
            Make: "Google",
            Model: "Pixel 8",
            MotionPhoto: 1,
            MotionPhotoVideoFile: "../outside.mp4",
          },
        },
      }),
    );
    expect(pixel(after).motionPhoto).toMatchObject({
      kind: "metadata-reference",
      reference: "../outside.mp4",
      experimental: true,
    });
    expect(pixel(after).motionPhoto?.sidecarUri).toBeUndefined();
  });
  it("does not associate a same-name movie with an ordinary non-motion still", async () => {
    await writeFile(join(scratch, "photo.mp4"), "unrelated video");
    expect(
      pixel(
        await enrichPixelAsset(asset({ uri: uri(join(scratch, "photo.jpg")) })),
      ).motionPhoto,
    ).toBeUndefined();
  });
});

describe("DNG metadata retention and existing source port", () => {
  it("retains the normal preview path for a decodable synthetic TIFF carrying DNG metadata", async () => {
    const path = join(scratch, "decodable.dng");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=gray:s=32x32",
      "-frames:v",
      "1",
      "-c:v",
      "tiff",
      "-f",
      "image2",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      path,
    ]);
    await runProcess("perl", [
      exifScript,
      "-overwrite_original",
      "-DNGVersion=1.4.0.0",
      "-Make=Google",
      "-Model=Pixel 8",
      path,
    ]);
    const after = await inspectPixelDng(candidate(path));
    expect(after.dimensions).toEqual({ width: 32, height: 32 });
    expect(after.mediaType).toBe("image");
    expect(after.metadata["openfilm.preview"]).not.toMatchObject({
      supported: false,
    });
    expect(pixel(after).recognized).toBe(true);
  });
  it("catalogs real EXIF from an undecodable synthetic DNG and reports the required RAW-export path", async () => {
    const path = join(fixtures, "metadata-only.dng"),
      beforeHash = await hashFile(path);
    const after = await inspectPixelDng(candidate(path));
    expect(after.mediaType).toBe("image");
    expect(after.dimensions).toEqual({ width: 16, height: 16 });
    expect(after.capturedAt).toBe("2024-07-08T01:10:11.000Z");
    expect(after.timezone).toBe("+08:00");
    expect(after.metadata["openfilm.exif"]).toMatchObject({
      FileType: "DNG",
      DNGVersion: "1 4 0 0",
      ImageDescription: expect.stringContaining("Synthetic"),
    });
    expect(after.metadata["openfilm.preview"]).toMatchObject({
      supported: false,
      reason: expect.stringContaining("RAW editor"),
    });
    expect(pixel(after)).toMatchObject({
      recognized: true,
      device: "Pixel 8 Pro",
    });
    expect(await hashFile(path)).toBe(beforeHash);
  });
  it("rejects malformed DNGs, wrong extensions, missing sources and cancelled work", async () => {
    const path = join(scratch, "broken.dng");
    await writeFile(path, "not a DNG");
    await expect(inspectPixelDng(candidate(path))).rejects.toThrow(
      "usable DNG metadata",
    );
    await expect(
      inspectPixelDng(candidate(join(fixtures, "pixel.jpg"))),
    ).rejects.toThrow(".dng source");
    await expect(
      inspectPixelDng(candidate(join(scratch, "missing.dng"))),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectPixelDng(
        candidate(join(fixtures, "metadata-only.dng")),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("supports the MediaSourceAdapter port for files and folders with metadata-only DNG retention", async () => {
    const source: MediaSourceAdapter = new PixelSource();
    expect(source.supports({ uri: uri(fixtures), type: "folder" })).toBe(true);
    expect(source.supports({ uri: "https://example.invalid/photo.jpg" })).toBe(
      false,
    );
    const candidates = await source.scan({
      uri: uri(fixtures),
      type: "folder",
    });
    expect(candidates.map((item) => item.name)).toContain("metadata-only.dng");
    const metadata = await source.extractMetadata(
      candidates.find((item) => item.name === "metadata-only.dng")!,
    );
    expect(metadata.metadata?.["openfilm.preview"]).toMatchObject({
      supported: false,
    });
    expect(metadata).not.toHaveProperty("id");
    expect(metadata).not.toHaveProperty("uri");
    expect(metadata).not.toHaveProperty("state");
    const single = await source.scan({
      uri: uri(join(fixtures, "pixel.jpg")),
      type: "file",
    });
    expect(single).toHaveLength(1);
    expect(single[0]?.sourceId).toBe("openfilm.source.pixel");
  });
});
