import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication, type ImportResult } from "@openfilm/application";
import type { MediaAsset } from "@openfilm/core";
import { generateProposalMedia } from "../../fixtures/proposal-film/generate.mjs";

let root: string;
let fixture: Awaited<ReturnType<typeof generateProposalMedia>>;
let app: OpenFilmApplication;
let ordinaryImport: ImportResult;
let rawImport: ImportResult;
let assets: MediaAsset[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-device-reference-"));
  fixture = await generateProposalMedia(join(root, "originals"));
  app = await OpenFilmApplication.create(
    join(root, "devices.openfilm"),
    "A generated device library",
  );
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  ordinaryImport = await app.importFolder(fixture.mediaDirectory);
  rawImport = await app.importFolder(fixture.rawDirectory);
  assets = app.catalog.listAssets({ limit: 100 });
});

afterAll(async () => {
  app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

function asset(id: string): MediaAsset {
  const name = basename(fixture.byId[id]!);
  const found = assets.find((item) => item.name === name);
  expect(
    found,
    `Imported ${name}; import failures: ${JSON.stringify([...(ordinaryImport.job.errors ?? []), ...(rawImport.job.errors ?? [])])}`,
  ).toBeDefined();
  return found!;
}

describe("generated Pixel and Insta360 reference library", () => {
  it("imports real tagged photos and videos with camera, time, GPS, orientation and experimental motion evidence", () => {
    expect(ordinaryImport.imported).toBe(10);
    expect(ordinaryImport.failed).toBe(0);
    const photo = asset("pixel-photo");
    expect(photo.source).toMatchObject({
      manufacturer: "Google",
      device: "Pixel 8 Pro",
    });
    expect(photo.capturedAt).toBe("2024-06-15T12:06:00.000Z");
    expect(photo.timezone).toBe("+08:00");
    expect(photo.gps!.latitude).toBeCloseTo(37.4219999, 6);
    expect(photo.gps!.longitude).toBeCloseTo(-122.0840575, 6);
    expect(photo.metadata["openfilm.exif"]).toMatchObject({
      Make: "Google",
      Model: "Pixel 8 Pro",
      Orientation: 6,
      MicroVideo: 1,
      MicroVideoOffset: 0,
    });
    expect(photo.metadata["openfilm.pixel"]).toMatchObject({
      recognized: true,
      motionPhoto: {
        detected: true,
        kind: "metadata-reference",
        experimental: true,
      },
    });
    const video = asset("pixel-video");
    expect(video.metadata["openfilm.pixel"]).toMatchObject({
      recognized: true,
    });
    expect(video.duration).toBeCloseTo(3, 1);
    expect(video.frameRate).toBe(24);
    expect(video.codec).toBe("h264");
    expect(video.proxyUri).toBeTruthy();
    const missing = asset("missing-metadata");
    expect(missing.capturedAt).toBe("2024-06-15T12:05:00.000Z");
    expect(missing.capturedAtSource).toBe("filesystem:mtime");
    expect(missing.metadata["openfilm.pixel"]).toMatchObject({
      recognized: false,
    });
    expect(asset("landscape").dimensions).toEqual({ width: 320, height: 180 });
    expect(asset("portrait").dimensions).toEqual({ width: 180, height: 320 });
  });

  it("retains metadata for unsupported raw sources and associates playable exports without claiming stitching", () => {
    expect(rawImport.imported).toBe(5);
    expect(rawImport.failed).toBe(0);
    expect(assets).toHaveLength(15);
    const dng = asset("pixel-dng");
    expect(dng.metadata["openfilm.pixel"]).toMatchObject({ recognized: true });
    expect(dng.metadata["openfilm.exif"]).toMatchObject({
      FileType: "DNG",
      Make: "Google",
      Model: "Pixel 8 Pro",
      DNGVersion: "1 4 0 0",
    });
    expect(dng.capturedAt).toBe("2024-06-15T12:11:00.000Z");
    expect(dng.metadata["openfilm.preview"]).toMatchObject({
      supported: false,
      reason: expect.any(String),
    });
    expect(dng.proxyUri).toBeUndefined();
    expect(
      asset("pixel-sidecar-photo").metadata["openfilm.pixel"],
    ).toMatchObject({
      recognized: true,
      motionPhoto: {
        detected: true,
        kind: "sidecar",
        experimental: true,
        sidecarUri: pathToFileURL(fixture.byId["pixel-sidecar-video"]!).href,
      },
    });
    for (const [exportId, rawId] of [
      ["insta360-photo", "insta360-raw-photo"],
      ["insta360-video", "insta360-raw-video"],
    ]) {
      const exported = asset(exportId!);
      const raw = asset(rawId!);
      expect(exported.metadata["openfilm.insta360"]).toMatchObject({
        level: 1,
        requiresReframedExport: false,
        original360Sources: [pathToFileURL(fixture.byId[rawId!]!).href],
      });
      expect(raw.metadata["openfilm.insta360"]).toMatchObject({
        level: 2,
        requiresReframedExport: true,
      });
      expect(raw.metadata["openfilm.preview"]).toMatchObject({
        supported: false,
        reason: expect.stringMatching(/refram|export/i),
      });
      expect(raw.thumbnailUri).toBeUndefined();
      expect(raw.proxyUri).toBeUndefined();
    }
    expect(asset("insta360-raw-video").mediaType).toBe("360-video");
    expect(asset("insta360-video").proxyUri).toBeTruthy();
  });

  it("finds the generated duplicate, composes only supported sources and preserves every original byte", async () => {
    const analysis = app.analyze();
    const original = asset("landscape");
    const duplicate = asset("duplicate");
    expect(
      analysis.duplicates.some(
        (group) =>
          group.kind === "exact" &&
          group.assetIds.includes(original.id) &&
          group.assetIds.includes(duplicate.id),
      ),
    ).toBe(true);
    const story = app.generateStory({
      title: "Our generated proposal",
      template: "proposal-film",
      targetDuration: 24,
      maxDuration: 30,
    });
    const composed = app.compose(story.id);
    expect(composed.duration).toBeGreaterThan(0);
    expect(composed.duration).toBeLessThanOrEqual(30);
    const unsupported = new Set([
      asset("pixel-dng").id,
      asset("insta360-raw-photo").id,
      asset("insta360-raw-video").id,
    ]);
    expect(
      story.beats
        .flatMap((beat) => [
          ...(beat.candidateAssetIds ?? []),
          ...(beat.selectedAssetIds ?? []),
        ])
        .some((id) => unsupported.has(id)),
    ).toBe(false);
    expect(
      composed.tracks
        .flatMap((track) => track.clips)
        .some((clip) => unsupported.has(clip.assetId)),
    ).toBe(false);
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
    expect(manifest).toMatchObject({ license: "CC0-1.0", synthetic: true });
    expect(manifest.files).toHaveLength(15);
    for (const file of fixture.files)
      expect(
        createHash("sha256")
          .update(await readFile(file.path))
          .digest("hex"),
        file.id,
      ).toBe(file.sha256);
  });
});
