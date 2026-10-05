import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import type { MediaCandidate } from "@openfilm/media";
import { createThumbnail, inspectMedia, runProcess } from "@openfilm/media";
import type { MediaSourceAdapter } from "@openfilm/plugin-sdk";
import {
  enrichInsta360Asset,
  inspectInsta360Raw,
  Insta360Source,
  isInsta360Raw,
} from "../src/index";

let directory: string;
let genericVideo: MediaAsset;
let exportedVideo: MediaAsset;
let exportedPhoto: MediaAsset;

function candidate(path: string): MediaCandidate {
  return { path, uri: pathToFileURL(path).href, name: basename(path) };
}

async function inFolder(name: string): Promise<string> {
  const folder = join(directory, name);
  await mkdir(folder);
  return folder;
}

function relocated(asset: MediaAsset, path: string): MediaAsset {
  return {
    ...structuredClone(asset),
    uri: pathToFileURL(path).href,
    name: basename(path),
  };
}

function extension(asset: MediaAsset): Record<string, unknown> {
  return asset.metadata["openfilm.insta360"] as Record<string, unknown>;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openfilm-insta360-"));
  // Procedural CC0 fixtures validate container decoding and simulated metadata,
  // not actual camera optics, stitching, or reframing quality.
  const video = join(directory, "generic.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=96x64:rate=12",
    "-t",
    "0.5",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ]);
  const exported = join(directory, "flat-export.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-c",
    "copy",
    "-metadata",
    "make=Insta360",
    "-metadata",
    "model=Insta360 X4",
    "-metadata",
    "software=Insta360 Studio",
    "-movflags",
    "+faststart+use_metadata_tags",
    "-y",
    exported,
  ]);
  const photo = join(directory, "flat-photo.jpg");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=96x64",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    photo,
  ]);
  const require = createRequire(import.meta.url);
  const exiftool = join(
    dirname(require.resolve("exiftool-vendored.pl/package.json")),
    "bin",
    "exiftool",
  );
  await runProcess("perl", [
    exiftool,
    "-overwrite_original",
    "-Make=Arashi Vision",
    "-Model=Insta360 X4",
    "-Software=Insta360 Studio",
    "-DateTimeOriginal=2024:06:15 12:00:00",
    "-OffsetTimeOriginal=+08:00",
    "-GPSLatitude=25",
    "-GPSLatitudeRef=N",
    "-GPSLongitude=121",
    "-GPSLongitudeRef=E",
    photo,
  ]);
  genericVideo = await inspectMedia(candidate(video));
  exportedVideo = await inspectMedia(candidate(exported));
  exportedPhoto = await inspectMedia(candidate(photo));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("Insta360 source adapter", () => {
  it("recognizes raw extensions without confusing flat exports or similarly named files", () => {
    for (const name of ["capture.insv", "capture.INSP", "a space.INSV"]) {
      expect(isInsta360Raw(pathToFileURL(join(directory, name)).href)).toBe(
        true,
      );
    }
    for (const name of [
      "capture.mp4",
      "capture.jpg",
      "capture.insv.mp4",
      "capture.insv.txt",
    ]) {
      expect(isInsta360Raw(pathToFileURL(join(directory, name)).href)).toBe(
        false,
      );
    }
  });

  it("recognizes a real tagged JPEG while retaining time, GPS, source tags, and normal preview", async () => {
    const asset = await enrichInsta360Asset(exportedPhoto);
    expect(extension(asset)).toMatchObject({
      level: 1,
      requiresReframedExport: false,
      original360Sources: [],
    });
    expect(extension(asset).evidence).toBeDefined();
    expect(asset.mediaType).toBe("image");
    expect(asset.dimensions).toEqual({ width: 96, height: 64 });
    expect(asset.capturedAt).toBe("2024-06-15T04:00:00.000Z");
    expect(asset.gps).toMatchObject({ latitude: 25, longitude: 121 });
    expect(asset.metadata["openfilm.exif"]).toEqual(
      exportedPhoto.metadata["openfilm.exif"],
    );
    expect(asset.metadata["openfilm.preview"]).not.toEqual(
      expect.objectContaining({ supported: false }),
    );
    const output = join(directory, "export-thumbnail.jpg");
    await createThumbnail(asset, output);
    expect((await inspectMedia(candidate(output))).mediaType).toBe("image");
  });

  it("recognizes a decodable flat MP4 from preserved container camera metadata", async () => {
    expect(exportedVideo.metadata["openfilm.ffprobe"]).toMatchObject({
      format: { tags: { make: "Insta360", model: "Insta360 X4" } },
    });
    const asset = await enrichInsta360Asset(exportedVideo);
    expect(extension(asset)).toMatchObject({
      level: 1,
      requiresReframedExport: false,
    });
    expect(asset.mediaType).toBe("video");
    expect(asset.duration).toBeCloseTo(0.5, 1);
    expect(asset.codec).toBe("h264");
    expect(asset.metadata["openfilm.ffprobe"]).toEqual(
      exportedVideo.metadata["openfilm.ffprobe"],
    );
    expect(asset.metadata["openfilm.preview"]).not.toEqual(
      expect.objectContaining({ supported: false }),
    );
  });

  it("requires reframing for explicitly spherical Insta360 JPEG and MP4 exports", async () => {
    const cases: { source: MediaAsset; evidence: Record<string, unknown> }[] = [
      {
        source: exportedPhoto,
        evidence: { "openfilm.exif": { ProjectionType: "equirectangular" } },
      },
      {
        source: exportedVideo,
        evidence: { "openfilm.exif": { SphericalVideo: true } },
      },
      {
        source: exportedVideo,
        evidence: {
          "openfilm.ffprobe": {
            streams: [
              {
                side_data_list: [
                  {
                    side_data_type: "Spherical Mapping",
                    projection: "equirectangular",
                  },
                ],
              },
            ],
          },
        },
      },
    ];
    for (const { source, evidence } of cases) {
      const original = structuredClone(source);
      original.source = { manufacturer: "Insta360" };
      Object.assign(original.metadata, evidence);
      const before = structuredClone(original);
      const asset = await enrichInsta360Asset(original);
      expect(extension(asset)).toMatchObject({
        level: 2,
        requiresReframedExport: true,
      });
      expect(asset.mediaType).toBe(
        source.mediaType === "image" ? "image" : "360-video",
      );
      expect(asset.metadata["openfilm.preview"]).toMatchObject({
        supported: false,
        reason: expect.stringMatching(/refram|export/i),
      });
      expect(asset.metadata).toMatchObject(evidence);
      expect(original).toEqual(before);
    }
  });

  it("keeps 2:1 framing and explicitly perspective exports previewable", async () => {
    for (const source of [exportedPhoto, exportedVideo]) {
      for (const projection of [
        {},
        { ProjectionType: "perspective", SphericalVideo: false },
      ]) {
        const original = structuredClone(source);
        original.dimensions = { width: 128, height: 64 };
        original.metadata["openfilm.exif"] = {
          ...(original.metadata["openfilm.exif"] as Record<string, unknown>),
          ...projection,
        };
        const asset = await enrichInsta360Asset(original);
        expect(extension(asset)).toMatchObject({
          level: 1,
          requiresReframedExport: false,
        });
        expect(asset.mediaType).toBe(source.mediaType);
        expect(asset.metadata["openfilm.preview"]).toMatchObject({
          supported: true,
        });
      }
    }
  });

  it("protects explicitly spherical generic video without inventing an Insta360 brand", async () => {
    const evidence: Record<string, unknown>[] = [
      { "openfilm.exif": { ProjectionType: "equirectangular" } },
      { "openfilm.exif": { SphericalVideo: true } },
      {
        "openfilm.ffprobe": {
          streams: [
            {
              side_data_list: [
                {
                  side_data_type: "Spherical Mapping",
                  projection: "equirectangular",
                },
              ],
            },
          ],
        },
      },
    ];
    for (const metadata of evidence) {
      const original = structuredClone(genericVideo);
      Object.assign(original.metadata, metadata);
      const asset = await enrichInsta360Asset(original);
      expect(asset.mediaType).toBe("360-video");
      expect(asset.metadata["openfilm.preview"]).toMatchObject({
        supported: false,
      });
      expect(asset.metadata["openfilm.insta360"]).toBeUndefined();
      expect(asset.metadata).toMatchObject(metadata);
    }
  });

  it("accepts reliable normalized device and inspected Make/Model/Software evidence", async () => {
    const examples: Partial<MediaAsset>[] = [
      { source: { manufacturer: "Arashi Vision" } },
      { source: { device: "Insta360 X5" } },
      { source: { application: "Insta360 Studio 5.0" } },
      { metadata: { "openfilm.exif": { Make: "Insta360" } } },
      { metadata: { "openfilm.exif": { Model: "Insta360 ONE X2" } } },
      { metadata: { "openfilm.exif": { Software: "Insta360 Studio" } } },
      {
        metadata: {
          "openfilm.ffprobe": { format: { tags: { make: "Arashi Vision" } } },
        },
      },
      {
        metadata: {
          "openfilm.ffprobe": {
            streams: [{ tags: { model: "Insta360 X4" } }],
          },
        },
      },
    ];
    for (const evidence of examples) {
      const asset = { ...structuredClone(genericVideo), ...evidence };
      expect(extension(await enrichInsta360Asset(asset))).toMatchObject({
        level: 1,
        requiresReframedExport: false,
      });
    }
  });

  it("leaves generic media generic despite a misleading name, title, or comment", async () => {
    const generic = structuredClone(genericVideo);
    generic.name = "Insta360-camera-export.mp4";
    generic.source = { manufacturer: "Google", device: "Pixel 8" };
    generic.metadata["openfilm.exif"] = {
      UserComment: "Edited next to an Insta360",
    };
    generic.metadata["openfilm.ffprobe"] = {
      format: { tags: { title: "Insta360 review" } },
    };
    const enriched = await enrichInsta360Asset(generic);
    expect(enriched.metadata["openfilm.insta360"]).toBeUndefined();
    expect(enriched).toEqual(generic);
    expect(enriched).not.toBe(generic);
    expect(enriched.metadata).not.toBe(generic.metadata);
    expect(
      (await enrichInsta360Asset(genericVideo)).metadata["openfilm.insta360"],
    ).toBeUndefined();
  });

  it("returns detached assets and preserves nested user and inspector metadata", async () => {
    const original = structuredClone(exportedPhoto);
    original.tags = ["travel"];
    original.state = { favorite: true };
    original.metadata["user.custom"] = { notes: ["retain this"] };
    const before = structuredClone(original);
    const enriched = await enrichInsta360Asset(original);
    expect(original).toEqual(before);
    expect(enriched.metadata["user.custom"]).toEqual(
      before.metadata["user.custom"],
    );
    expect(enriched).not.toBe(original);
    expect(enriched.metadata["openfilm.exif"]).not.toBe(
      original.metadata["openfilm.exif"],
    );
    enriched.tags.push("edited");
    enriched.state.favorite = false;
    (enriched.metadata["user.custom"] as { notes: string[] }).notes.push(
      "new note",
    );
    expect(original).toEqual(before);
  });

  it("associates exact-stem raw siblings while excluding unrelated and symlinked files", async () => {
    const folder = await inFolder("exact-siblings");
    const raw = join(folder, "capture.insv");
    await writeFile(raw, "synthetic raw metadata fixture");
    await writeFile(
      join(folder, "capture-other.insv"),
      "unrelated raw fixture",
    );
    await symlink(raw, join(folder, "capture.insp"));
    const asset = await enrichInsta360Asset(
      relocated(exportedVideo, join(folder, "capture.mp4")),
    );
    expect(extension(asset).original360Sources).toEqual([
      pathToFileURL(raw).href,
    ]);
    expect(extension(asset).evidence).toMatchObject({
      association: [
        expect.objectContaining({
          kind: "named-sibling",
          uri: pathToFileURL(raw).href,
        }),
      ],
    });
    expect(asset.mediaType).toBe("video");
    expect(extension(asset).requiresReframedExport).toBe(false);
  });

  it("associates only the matching timestamp and sequence of a conventional dual-file capture", async () => {
    const folder = await inFolder("paired-siblings");
    const names = [
      "VID_20240615_120000_00_001.insv",
      "VID_20240615_120000_10_001.insv",
    ];
    for (const name of [
      ...names,
      "VID_20240615_120000_00_002.insv",
      "VID_20240615_120001_00_001.insv",
    ]) {
      await writeFile(
        join(folder, name),
        "synthetic dual-file metadata fixture",
      );
    }
    for (const name of [
      "VID_20240615_120000_001_export.mp4",
      "VID_20240615_120000_001_reframed_v2.mp4",
    ]) {
      const asset = await enrichInsta360Asset(
        relocated(exportedVideo, join(folder, name)),
      );
      expect(
        (extension(asset).original360Sources as string[]).toSorted(),
      ).toEqual(
        names.map((raw) => pathToFileURL(join(folder, raw)).href).toSorted(),
      );
      expect(extension(asset).requiresReframedExport).toBe(false);
    }
  });

  it("does not associate raw files from a neighboring sequence or timestamp", async () => {
    const folder = await inFolder("nearby-siblings");
    for (const name of [
      "VID_20240615_120000_00_002.insv",
      "VID_20240615_120001_10_001.insv",
      "VID_20240615_120000_001_notes.insv",
    ]) {
      await writeFile(join(folder, name), "unrelated raw fixture");
    }
    const asset = await enrichInsta360Asset(
      relocated(
        exportedVideo,
        join(folder, "VID_20240615_120000_001_export.mp4"),
      ),
    );
    expect(extension(asset).original360Sources).toEqual([]);
  });

  it("retains explicit raw references as provenance even when originals are offline", async () => {
    const folder = await inFolder("explicit-references");
    const uri = pathToFileURL(join(folder, "offline-original.insv")).href;
    const original = relocated(
      exportedVideo,
      join(folder, "unrelated-export-name.mp4"),
    );
    original.metadata["openfilm.insta360"] = {
      original360Sources: [uri, "https://example.invalid/remote-source.insv"],
      userNote: "preserve evidence",
    };
    const asset = await enrichInsta360Asset(original);
    expect(extension(asset)).toMatchObject({
      original360Sources: [uri],
      requiresReframedExport: false,
      userNote: "preserve evidence",
    });
    expect(extension(asset).evidence).toMatchObject({
      association: [
        expect.objectContaining({ kind: "explicit-metadata", uri }),
      ],
    });
  });

  it("resolves explicit EXIF raw references relative to the flat export", async () => {
    const folder = await inFolder("exif-reference");
    for (const field of ["OriginalFileName", "SourceFile"]) {
      const asset = relocated(exportedPhoto, join(folder, "edited-photo.jpg"));
      asset.metadata["openfilm.exif"] = {
        ...(asset.metadata["openfilm.exif"] as Record<string, unknown>),
        [field]: "original-photo.insp",
      };
      const enriched = await enrichInsta360Asset(asset);
      expect(extension(enriched).original360Sources).toContain(
        pathToFileURL(join(folder, "original-photo.insp")).href,
      );
      expect(extension(enriched).requiresReframedExport).toBe(false);
      expect(enriched.metadata["openfilm.exif"]).toEqual(
        asset.metadata["openfilm.exif"],
      );
    }
  });

  it("keeps a decodable raw video and raw photo unavailable for automatic flat preview", async () => {
    const folder = await inFolder("decodable-raw");
    for (const [source, name, mediaType] of [
      ["flat-export.mp4", "capture.insv", "360-video"],
      ["flat-photo.jpg", "photo.insp", "image"],
    ] as const) {
      const path = join(folder, name);
      await copyFile(join(directory, source), path);
      const asset = await inspectInsta360Raw(candidate(path));
      expect(asset.mediaType).toBe(mediaType);
      expect(asset.dimensions).toEqual({ width: 96, height: 64 });
      expect(extension(asset)).toMatchObject({
        level: 2,
        requiresReframedExport: true,
        original360Sources: expect.arrayContaining([pathToFileURL(path).href]),
      });
      expect(asset.metadata["openfilm.preview"]).toMatchObject({
        supported: false,
        reason: expect.stringMatching(/refram|export/i),
      });
      expect(asset.metadata["openfilm.exif"]).toBeDefined();
      expect(asset.metadata["openfilm.ffprobe"]).toBeDefined();
      expect(asset.proxyUri).toBeUndefined();
    }
  });

  it("keeps corrupt and empty raw files browseable with actionable preview limitations", async () => {
    const folder = await inFolder("undecodable-raw");
    for (const [name, bytes, mediaType] of [
      ["broken.insv", "synthetic undecodable raw bytes", "360-video"],
      ["empty.insp", "", "image"],
    ] as const) {
      const path = join(folder, name);
      await writeFile(path, bytes);
      const asset = await inspectInsta360Raw(candidate(path));
      expect(asset.uri).toBe(pathToFileURL(path).href);
      expect(asset.name).toBe(name);
      expect(asset.mediaType).toBe(mediaType);
      expect(asset.metadata["openfilm.filesystem"]).toMatchObject({
        size: Buffer.byteLength(bytes),
      });
      expect(asset.metadata["openfilm.preview"]).toMatchObject({
        supported: false,
        reason: expect.stringMatching(/refram|export/i),
      });
      expect(extension(asset)).toMatchObject({
        level: 2,
        requiresReframedExport: true,
      });
    }
  });

  it("honors cancellation before raw inspection, discovery, and SDK metadata extraction", async () => {
    const source: MediaSourceAdapter = new Insta360Source();
    const controller = new AbortController();
    controller.abort();
    const path = join(directory, "cancelled.insv");
    await writeFile(path, "synthetic raw fixture");
    await expect(
      inspectInsta360Raw(candidate(path), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      source.scan(
        { uri: pathToFileURL(directory).href, type: "folder" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      source.extractMetadata(candidate(path), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects raw-file symlinks and skips them during directory scans", async () => {
    const folder = await inFolder("raw-symlinks");
    const raw = join(folder, "source.insv");
    const linked = join(folder, "linked.insv");
    await writeFile(raw, "synthetic raw fixture");
    await symlink(raw, linked);
    await expect(inspectInsta360Raw(candidate(linked))).rejects.toThrow(
      /regular|symlink/i,
    );
    const source: MediaSourceAdapter = new Insta360Source();
    const discovered = await source.scan({
      uri: pathToFileURL(folder).href,
      type: "folder",
    });
    expect(discovered.map((item) => item.name)).toContain("source.insv");
    expect(discovered.map((item) => item.name)).not.toContain("linked.insv");
  });

  it("implements the existing SDK source port and omits application-owned metadata fields", async () => {
    const folder = await inFolder("sdk-source");
    const raw = join(folder, "source.insv");
    await writeFile(raw, "synthetic raw fixture");
    await copyFile(
      join(directory, "flat-photo.jpg"),
      join(folder, "export.jpg"),
    );
    const source: MediaSourceAdapter = new Insta360Source();
    const input = { uri: pathToFileURL(folder).href, type: "folder" as const };
    expect(source.id).toEqual(expect.any(String));
    expect(source.supports(input)).toBe(true);
    expect(
      source.supports({
        uri: "https://example.com/movie.insv",
        type: "external",
      }),
    ).toBe(false);
    const progress: number[] = [];
    const discovered = await source.scan(input, {
      onProgress: (value) => progress.push(value),
    });
    expect(discovered.map((item) => item.name).toSorted()).toEqual([
      "export.jpg",
      "source.insv",
    ]);
    expect(progress.at(-1)).toBe(1);
    for (const item of discovered) {
      const metadata = await source.extractMetadata(item, {});
      expect(metadata.metadata?.["openfilm.insta360"]).toBeDefined();
      for (const field of ["id", "uri", "name", "tags", "state"])
        expect(metadata).not.toHaveProperty(field);
    }
  });
});
