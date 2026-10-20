import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashFile } from "@openfilm/media";
import { inspectMedia, runProcess } from "@openfilm/media";
import { createPhotoRelationship } from "@openfilm/story";
import {
  graphicNode,
  graphicScene,
} from "../../../tests/fixtures/graphic-scene.js";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

describe("named project versions", () => {
  it("restores and renders captions, graphics, two synthetic photos, and audio across sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-version-render-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    let app = await OpenFilmApplication.create(
      directory,
      "Synthetic version render",
    );
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test closes and reopens the application to exercise durable state.
      }
    });

    const videoPath = join(directory, "synthetic-video-audio.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x202020:s=320x180:r=12:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-t",
      "4",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-y",
      videoPath,
    ]);
    const video = await inspectMedia({
      path: videoPath,
      uri: pathToFileURL(videoPath).href,
      name: "Synthetic picture and tone",
    });
    app.catalog.upsertAsset(video);

    const photos = [];
    const sourcePaths = new Map<string, string>([[video.id, videoPath]]);
    for (const [id, color] of [
      ["photo-red", "red"],
      ["photo-blue", "blue"],
    ] as const) {
      const path = join(directory, `${id}.png`);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=96x54:d=1`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-update",
        "1",
        "-y",
        path,
      ]);
      const asset = await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: `${id}.png`,
      });
      app.catalog.upsertAsset(asset);
      photos.push(asset);
      sourcePaths.set(asset.id, path);
    }

    app.project.settings = { width: 320, height: 180, frameRate: 12 };
    app.project.stories.push({
      id: "synthetic-story",
      title: "Synthetic story",
      beats: [
        {
          id: "synthetic-beat",
          title: "Synthetic beat",
          candidateAssetIds: [video.id, ...photos.map((photo) => photo.id)],
          selectedAssetIds: [video.id],
        },
      ],
    });
    const photoScene = createPhotoRelationship({
      sceneId: "version-photos",
      start: 2,
      duration: 2,
      frame: { width: 320, height: 180 },
      relationship: "compare",
      photos: photos.map((photo) => ({
        assetId: photo.id,
        contentHash: photo.contentHash,
        focalPoint: { x: 0.5, y: 0.5 },
      })),
    });
    const composition = {
      id: "synthetic-composition",
      storyId: "synthetic-story",
      duration: 4,
      tracks: [
        {
          id: "video-track",
          type: "video" as const,
          clips: [
            {
              id: "synthetic-clip",
              assetId: video.id,
              beatId: "synthetic-beat",
              timelineStart: 0,
              timelineDuration: 4,
              sourceIn: 0,
              sourceOut: 4,
              audioAutomation: {
                version: 1 as const,
                role: "ambience" as const,
                points: [
                  { time: 0, gain: 0.25 },
                  { time: 4, gain: 0.25 },
                ],
              },
            },
          ],
        },
      ],
      captionTracks: [
        {
          version: 1 as const,
          id: "synthetic-caption-track",
          name: "Synthetic captions",
          style: {
            version: 1 as const,
            role: "subtitle" as const,
            fontSize: 18,
            background: "none" as const,
          },
          cues: [
            {
              version: 1 as const,
              id: "synthetic-caption-cue",
              startMs: 500,
              endMs: 1500,
              text: "Original caption",
              source: { kind: "manual" as const },
              manualRevision: 0,
            },
          ],
        },
      ],
      graphicScenes: [
        graphicScene({
          id: "version-shape",
          name: "Versioned shape",
          duration: 4,
          nodes: [graphicNode({ id: "versioned-red-shape", end: 4 })],
        }),
        photoScene.scene,
      ],
      graphicSceneTemplates: [photoScene.record],
    };
    app.project.timelines.push(composition);
    await app.save();
    const sourceHashes = new Map(
      await Promise.all(
        [...sourcePaths].map(
          async ([id, path]) => [id, await hashFile(path)] as const,
        ),
      ),
    );

    const first = await app.versions.create({
      name: "Original caption and mix",
      baseRevision: app.versions.currentRevision(),
      requestId: "40000000-0000-4000-8000-000000000001",
    });
    const revisedComposition = app.project.timelines[0]!;
    revisedComposition.captionTracks![0]!.cues[0]!.text =
      "Revised synthetic caption";
    revisedComposition.tracks[0]!.clips[0]!.audioAutomation!.points![0]!.gain = 0.6;
    revisedComposition.tracks[0]!.clips[0]!.audioAutomation!.points![1]!.gain = 0.6;
    revisedComposition.graphicScenes![0]!.nodes[0]!.x = 48;
    const revisedPhotos = createPhotoRelationship({
      sceneId: "version-photos",
      start: 2,
      duration: 2,
      frame: { width: 320, height: 180 },
      relationship: "compare",
      photos: photos.map((photo, index) => ({
        assetId: photo.id,
        contentHash: photo.contentHash,
        focalPoint: { x: index === 0 ? 0.35 : 0.65, y: 0.5 },
      })),
    });
    revisedComposition.graphicScenes![1] = revisedPhotos.scene;
    revisedComposition.graphicSceneTemplates![0] = revisedPhotos.record;
    await app.save();
    const second = await app.versions.create({
      name: "Revised caption and mix",
      baseRevision: app.versions.currentRevision(),
      requestId: "40000000-0000-4000-8000-000000000002",
    });

    app.close();
    app = await OpenFilmApplication.open(directory);
    const diff = app.versions.diff(first.id, second.id);
    expect(diff.entries.map((entry) => entry.category)).toEqual(
      expect.arrayContaining([
        "captions",
        "audio",
        "graphicScenes",
        "templates",
      ]),
    );
    const restore = await app.versions.restore(first.id, {
      baseRevision: app.versions.currentRevision(),
      confirmed: true,
      requestId: "40000000-0000-4000-8000-000000000003",
    });
    const restored = app.project.timelines[0]!;
    expect(restored.captionTracks?.[0]?.cues[0]?.text).toBe("Original caption");
    expect(restored.graphicScenes?.[0]?.nodes[0]?.x).toBe(0);
    expect(restored.graphicSceneTemplates?.[0]).toEqual(photoScene.record);
    expect(
      restored.tracks[0]?.clips[0]?.audioAutomation?.points?.[0]?.gain,
    ).toBe(0.25);

    const rendered = await app.exportMp4(composition.id, {
      quality: "standard",
    });
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,nb_frames,avg_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      rendered.path,
    ]);
    const details = JSON.parse(probe.stdout.toString("utf8")) as {
      streams: {
        codec_type: string;
        codec_name: string;
        width?: number;
        height?: number;
        nb_frames?: string;
        avg_frame_rate?: string;
      }[];
      format: { duration: string };
    };
    expect(details.streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codec_type: "video",
          codec_name: "h264",
          width: 320,
          height: 180,
          nb_frames: "48",
          avg_frame_rate: "12/1",
        }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]),
    );
    expect(Number(details.format.duration)).toBeCloseTo(4, 1);
    const decodeFrame = async (seconds: number) => {
      const decoded = await runProcess("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(seconds),
        "-i",
        rendered.path,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      expect(decoded.stdout).toHaveLength(320 * 180 * 3);
      return decoded.stdout;
    };
    const pixel = (frame: Buffer, x: number, y: number) => {
      const offset = (y * 320 + x) * 3;
      return [...frame.subarray(offset, offset + 3)];
    };
    const whitePixelsBelow = (frame: Buffer, startY: number) => {
      let count = 0;
      for (let y = startY; y < 180; y++)
        for (let x = 0; x < 320; x++) {
          const [red, green, blue] = pixel(frame, x, y);
          if (red! > 220 && green! > 220 && blue! > 220) count++;
        }
      return count;
    };
    const earlyFrame = await decodeFrame(0.1);
    expect(whitePixelsBelow(earlyFrame, 90)).toBe(0);
    const captionFrame = await decodeFrame(1);
    const brightCaptionPixels = whitePixelsBelow(captionFrame, 90);
    expect(brightCaptionPixels).toBeGreaterThan(20);
    expect(pixel(captionFrame, 160, 75)[0]).toBeGreaterThan(180);
    const photoFrame = await decodeFrame(2.5);
    expect(pixel(photoFrame, 80, 90)[0]).toBeGreaterThan(180);
    expect(pixel(photoFrame, 240, 90)[2]).toBeGreaterThan(180);
    const audio = await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      rendered.path,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "f32le",
      "pipe:1",
    ]);
    let squareSum = 0;
    for (let offset = 0; offset + 4 <= audio.stdout.length; offset += 4) {
      const sample = audio.stdout.readFloatLE(offset);
      squareSum += sample * sample;
    }
    const audioRms = Math.sqrt(squareSum / (audio.stdout.length / 4));
    expect(audioRms).toBeGreaterThan(0.015);
    expect(audioRms).toBeLessThan(0.04);
    const outputSha256 = await hashFile(rendered.path);
    expect(outputSha256).toMatch(/^[a-f0-9]{64}$/u);
    const manifest = JSON.parse(
      await readFile(`${rendered.path}.manifest.json`, "utf8"),
    ) as {
      sources: { assetId: string; sha256: string }[];
      warnings: string[];
    };
    for (const [id, hash] of sourceHashes) {
      expect(await hashFile(sourcePaths.get(id)!)).toBe(hash);
      expect(
        manifest.sources.find((source) => source.assetId === id)?.sha256,
      ).toBe(hash);
    }
    expect(rendered.report.warnings).toEqual(manifest.warnings);
    if (process.env.OPENFILM_VERSION_RENDER_EVIDENCE)
      await writeFile(
        process.env.OPENFILM_VERSION_RENDER_EVIDENCE,
        `${JSON.stringify(
          {
            outputSha256,
            audioRms,
            durationSeconds: Number(details.format.duration),
            video: details.streams.find(
              (stream) => stream.codec_type === "video",
            ),
            audio: details.streams.find(
              (stream) => stream.codec_type === "audio",
            ),
            sourceHashes: [...sourceHashes].map(([assetId, sha256]) => ({
              assetId,
              sha256,
            })),
            warnings: manifest.warnings,
            decodedFramesSeconds: [0.1, 1, 2.5],
          },
          null,
          2,
        )}\n`,
      );

    app.close();
    app = await OpenFilmApplication.open(directory);
    await app.versions.restore(second.id, {
      baseRevision: app.versions.currentRevision(),
      confirmed: true,
      requestId: "40000000-0000-4000-8000-000000000004",
    });
    const restoredSecond = app.project.timelines[0]!;
    expect(restoredSecond.captionTracks?.[0]?.cues[0]?.text).toBe(
      "Revised synthetic caption",
    );
    expect(restoredSecond.graphicScenes?.[0]?.nodes[0]?.x).toBe(48);
    expect(
      restoredSecond.tracks[0]?.clips[0]?.audioAutomation?.points?.[0]?.gain,
    ).toBe(0.6);
    expect(restoredSecond.graphicSceneTemplates?.[0]).toEqual(
      revisedPhotos.record,
    );
    expect(app.versions.list().map((version) => version.id)).toEqual(
      expect.arrayContaining([
        first.id,
        second.id,
        restore.checkpointVersionId,
      ]),
    );
  }, 120_000);

  it("creates durable versions, compares them, and restores with a checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-named-versions-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    let app = await OpenFilmApplication.create(directory, "Synthetic film");
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The assertions close and reopen the same application during the test.
      }
    });
    const firstRevision = app.versions.currentRevision();
    const first = await app.versions.create({
      name: "Opening",
      description: "Keep this note when renaming.",
      baseRevision: firstRevision,
      requestId: "10000000-0000-4000-8000-000000000001",
    });
    const immutableRecord = await readFile(
      join(directory, "versions", first.id, "record.json"),
      "utf8",
    );
    expect(
      await app.versions.create({
        name: "Opening",
        description: "Keep this note when renaming.",
        baseRevision: firstRevision,
        requestId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ id: first.id });
    app.project.title = "Synthetic film — second cut";
    await app.save();
    const second = await app.versions.create({
      name: "Second cut",
      baseRevision: app.versions.currentRevision(),
      requestId: "10000000-0000-4000-8000-000000000002",
    });

    expect(app.versions.list()).toHaveLength(2);
    expect(app.versions.diff(first.id, second.id)).toMatchObject({
      beforeVersionId: first.id,
      afterVersionId: second.id,
      entries: expect.arrayContaining([
        expect.objectContaining({ category: "project", change: "changed" }),
      ]),
    });
    app.versions.rename(first.id, { name: "Opening · approved" });
    expect(
      await readFile(
        join(directory, "versions", first.id, "record.json"),
        "utf8",
      ),
    ).toBe(immutableRecord);
    expect(app.versions.list()[0]?.name).toBe("Opening · approved");
    expect(app.versions.list()[0]?.description).toBe(
      "Keep this note when renaming.",
    );
    app.versions.rename(first.id, {
      name: "Opening · cleared",
      description: null,
    });
    expect(app.versions.list()[0]?.description).toBeUndefined();
    app.close();
    app = await OpenFilmApplication.open(directory);
    const restoreRequest = {
      baseRevision: app.versions.currentRevision(),
      confirmed: true,
      requestId: "10000000-0000-4000-8000-000000000003",
    };
    const restored = await app.versions.restore(first.id, restoreRequest);
    expect(restored.restoredVersionId).toBe(first.id);
    expect(restored.checkpointVersionId).not.toBe(second.id);
    expect(
      app.versions.inspect(restored.checkpointVersionId).summary.title,
    ).toBe("Synthetic film — second cut");
    expect(app.project.title).toBe("Synthetic film");
    expect(app.versions.list()).toHaveLength(3);
    expect(await app.versions.restore(first.id, restoreRequest)).toEqual(
      restored,
    );
    expect(app.versions.list()).toHaveLength(3);
    app.close();
    app = await OpenFilmApplication.open(directory);
    expect(app.project.title).toBe("Synthetic film");
    expect(app.versions.list()).toHaveLength(3);
    app.close();
  });

  it("records only referenced source hashes and blocks stale or changed-source restores", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-version-source-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const source = join(root, "synthetic-source.png");
    await writeFile(source, Buffer.from("synthetic source bytes"));
    const app = await OpenFilmApplication.create(directory, "Source film");
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // Assertions may close and reopen the application.
      }
    });
    const sha256 = await hashFile(source);
    app.catalog.upsertAsset({
      id: "synthetic-source",
      uri: pathToFileURL(source).href,
      name: "Synthetic source",
      mediaType: "image",
      contentHash: sha256,
      tags: [],
      state: {},
      metadata: {},
    });
    app.project.stories.push({
      id: "story",
      title: "Synthetic story",
      beats: [
        {
          id: "beat",
          title: "Synthetic beat",
          candidateAssetIds: ["synthetic-source"],
          selectedAssetIds: ["synthetic-source"],
        },
      ],
    });
    await app.save();
    const baseRevision = app.versions.currentRevision();
    const version = await app.versions.create({
      name: "Source checkpoint",
      baseRevision,
      requestId: "20000000-0000-4000-8000-000000000001",
    });
    expect(version.sourceReferences).toEqual([
      {
        assetId: "synthetic-source",
        sha256,
        sizeBytes: Buffer.byteLength("synthetic source bytes"),
        mediaType: "image",
        kind: "external",
      },
    ]);
    expect(JSON.stringify(version)).not.toContain(source);
    expect(JSON.stringify(app.versions.inspect(version.id))).not.toContain(
      source,
    );

    app.project.title = "Changed after the checkpoint";
    await app.save();
    await expect(
      app.versions.create({
        name: "Stale request",
        baseRevision,
        requestId: "20000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ status: 409, code: "story.planConflict" });
    await writeFile(source, Buffer.from("changed source bytes"));
    await expect(
      app.versions.restore(version.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: true,
        requestId: "20000000-0000-4000-8000-000000000003",
      }),
    ).rejects.toMatchObject({ status: 409, code: "media.missing" });
    expect(app.project.title).toBe("Changed after the checkpoint");
    expect(app.versions.list()).toHaveLength(1);
  });

  it("requires confirmation and refuses to overwrite a source that became locked", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-version-lock-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const source = join(root, "locked-source.png");
    await writeFile(source, Buffer.from("locked synthetic source"));
    const app = await OpenFilmApplication.create(
      directory,
      "Locked source film",
    );
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test may already have closed the app.
      }
    });
    app.catalog.upsertAsset({
      id: "locked-source",
      uri: pathToFileURL(source).href,
      name: "Locked source",
      mediaType: "image",
      contentHash: await hashFile(source),
      tags: [],
      state: {},
      metadata: {},
    });
    app.project.stories.push({
      id: "story",
      title: "Story",
      beats: [
        { id: "beat", title: "Beat", candidateAssetIds: ["locked-source"] },
      ],
    });
    await app.save();
    const version = await app.versions.create({
      name: "Unlocked state",
      baseRevision: app.versions.currentRevision(),
      requestId: "30000000-0000-4000-8000-000000000001",
    });
    await expect(
      app.versions.restore(version.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: false,
        requestId: "30000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ code: "request.invalid" });
    app.catalog.updateAsset("locked-source", { state: { locked: true } });
    await expect(
      app.versions.restore(version.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: true,
        requestId: "30000000-0000-4000-8000-000000000003",
      }),
    ).rejects.toMatchObject({ status: 409, code: "timeline.conflict" });
    expect(app.versions.list()).toHaveLength(1);
  });

  it("refuses to restore any changed fields on an asset locked in both versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-version-locked-edit-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const source = join(root, "locked-source.png");
    await writeFile(source, Buffer.from("unchanged locked synthetic source"));
    const app = await OpenFilmApplication.create(
      directory,
      "Locked asset film",
    );
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test may already have closed the app.
      }
    });
    app.catalog.upsertAsset({
      id: "locked-source",
      uri: pathToFileURL(source).href,
      name: "Locked source",
      mediaType: "image",
      contentHash: await hashFile(source),
      tags: ["before"],
      state: { locked: true },
      metadata: {},
    });
    app.project.stories.push({
      id: "story",
      title: "Story",
      beats: [
        { id: "beat", title: "Beat", candidateAssetIds: ["locked-source"] },
      ],
    });
    await app.save();
    const version = await app.versions.create({
      name: "Locked asset checkpoint",
      baseRevision: app.versions.currentRevision(),
      requestId: "31000000-0000-4000-8000-000000000001",
    });
    app.catalog.updateAsset("locked-source", { tags: ["after"] });

    await expect(
      app.versions.restore(version.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: true,
        requestId: "31000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ status: 409, code: "timeline.conflict" });
    expect(app.catalog.getAsset("locked-source")?.tags).toEqual(["after"]);
  });

  it("does not restore a locked clip into a different track", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-version-locked-clip-track-"),
    );
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const source = join(root, "clip-source.png");
    await writeFile(source, Buffer.from("locked clip source"));
    const app = await OpenFilmApplication.create(
      directory,
      "Locked clip track",
    );
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test may already have closed the application.
      }
    });
    app.catalog.upsertAsset({
      id: "clip-source",
      uri: pathToFileURL(source).href,
      name: "Clip source",
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    });
    app.project.stories.push({ id: "story", title: "Story", beats: [] });
    const lockedClip = {
      id: "locked-clip",
      assetId: "clip-source",
      timelineStart: 0,
      timelineDuration: 1,
      locked: true,
    };
    app.project.timelines.push({
      id: "composition",
      storyId: "story",
      duration: 1,
      tracks: [
        { id: "track-a", type: "video", clips: [lockedClip] },
        { id: "track-b", type: "video", clips: [] },
      ],
    });
    await app.save();
    const version = await app.versions.create({
      name: "Locked clip on track A",
      baseRevision: app.versions.currentRevision(),
      requestId: "31500000-0000-4000-8000-000000000001",
    });

    app.project.timelines[0]!.tracks[0]!.clips = [];
    app.project.timelines[0]!.tracks[1]!.clips = [lockedClip];
    await app.save();

    await expect(
      app.versions.restore(version.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: true,
        requestId: "31500000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ status: 409, code: "timeline.conflict" });
    expect(app.project.timelines[0]!.tracks[0]!.clips).toEqual([]);
    expect(app.project.timelines[0]!.tracks[1]!.clips).toEqual([lockedClip]);
  });

  it("keeps an external manifest edit made after restore preflight instead of overwriting it", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-version-restore-race-"),
    );
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(directory, "Original title");
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test may already have closed the app.
      }
    });
    const version = await app.versions.create({
      name: "Original title",
      baseRevision: app.versions.currentRevision(),
      requestId: "32000000-0000-4000-8000-000000000001",
    });
    app.project.title = "Current title";
    await app.save();
    const currentRevision = app.versions.currentRevision();
    const originalRestore = app.catalog.restoreFromSnapshot.bind(app.catalog);
    vi.spyOn(app.catalog, "restoreFromSnapshot").mockImplementation(
      (path, publishManifest, assertCurrent) => {
        const external = JSON.parse(
          readFileSync(join(directory, "project.json"), "utf8"),
        ) as { title: string };
        external.title = "External edit after preflight";
        writeFileSync(
          join(directory, "project.json"),
          `${JSON.stringify(external, null, 2)}\n`,
        );
        originalRestore(path, publishManifest, assertCurrent);
      },
    );

    await expect(
      app.versions.restore(version.id, {
        baseRevision: currentRevision,
        confirmed: true,
        requestId: "32000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ status: 409, code: "story.planConflict" });
    expect(
      JSON.parse(readFileSync(join(directory, "project.json"), "utf8")).title,
    ).toBe("External edit after preflight");
  });

  it("rolls back staged catalog rows if the manifest changes before restore publication", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-version-restore-publish-race-"),
    );
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(directory, "Original title");
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test may already have closed the application.
      }
    });
    app.catalog.upsertAsset({
      id: "catalog-row",
      uri: pathToFileURL(join(root, "catalog-row.png")).href,
      name: "Catalog row",
      mediaType: "image",
      tags: ["version"],
      state: {},
      metadata: {},
    });
    const version = await app.versions.create({
      name: "Original catalog row",
      baseRevision: app.versions.currentRevision(),
      requestId: "32500000-0000-4000-8000-000000000001",
    });
    app.catalog.updateAsset("catalog-row", { tags: ["current"] });
    app.project.title = "Current title";
    await app.save();
    const originalRestore = app.catalog.restoreFromSnapshot.bind(app.catalog);
    vi.spyOn(app.catalog, "restoreFromSnapshot").mockImplementation(
      (path, publishManifest, assertCurrent) =>
        originalRestore(
          path,
          () => {
            const external = JSON.parse(
              readFileSync(join(directory, "project.json"), "utf8"),
            ) as { title: string };
            external.title = "External edit during publication";
            writeFileSync(
              join(directory, "project.json"),
              `${JSON.stringify(external, null, 2)}\n`,
            );
            publishManifest?.();
          },
          assertCurrent,
        ),
    );

    await expect(
      app.versions.restore(version.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: true,
        requestId: "32500000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ status: 409, code: "story.planConflict" });
    expect(app.catalog.getAsset("catalog-row")?.tags).toEqual(["current"]);
    expect(
      JSON.parse(readFileSync(join(directory, "project.json"), "utf8")).title,
    ).toBe("External edit during publication");
  });

  it.each(["sources", "sources/nested"])(
    "rejects managed media reached through a symlinked %s directory",
    async (symlinkedPath) => {
      const root = await mkdtemp(
        join(tmpdir(), "openfilm-version-source-symlink-"),
      );
      cleanup.push(() => rm(root, { recursive: true, force: true }));
      const directory = join(root, "film.openfilm");
      const externalDirectory = join(root, "external");
      const sourceRelativePath = "sources/nested/synthetic.png";
      const externalSource =
        symlinkedPath === "sources"
          ? join(externalDirectory, "nested/synthetic.png")
          : join(externalDirectory, "synthetic.png");
      const app = await OpenFilmApplication.create(
        directory,
        "Symlinked managed source",
      );
      cleanup.push(() => {
        try {
          app.close();
        } catch {
          // The test may already have closed the application.
        }
      });
      await mkdir(join(externalDirectory, "nested"), { recursive: true });
      await writeFile(externalSource, Buffer.from("outside managed source"));
      if (symlinkedPath === "sources") {
        await symlink(externalDirectory, join(directory, "sources"), "dir");
      } else {
        await mkdir(join(directory, "sources"), { recursive: true });
        await symlink(
          externalDirectory,
          join(directory, "sources/nested"),
          "dir",
        );
      }
      const managedUri = pathToFileURL(
        join(directory, sourceRelativePath),
      ).href;
      app.catalog.upsertAsset({
        id: "symlinked-source",
        uri: managedUri,
        name: "Synthetic source",
        mediaType: "image",
        tags: [],
        state: {},
        metadata: {
          "openfilm.managedSource": {
            relativePath: sourceRelativePath,
            uri: managedUri,
          },
        },
      });
      app.project.stories.push({
        id: "story",
        title: "Story",
        beats: [
          {
            id: "beat",
            title: "Beat",
            candidateAssetIds: ["symlinked-source"],
          },
        ],
      });
      await app.save();

      await expect(
        app.versions.create({
          name: "Reject symlink source",
          baseRevision: app.versions.currentRevision(),
          requestId: "33500000-0000-4000-8000-000000000001",
        }),
      ).rejects.toMatchObject({ status: 409, code: "media.missing" });
      expect(app.versions.list()).toEqual([]);
    },
  );

  it("rebases managed sources when restoring a version after moving the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-version-relocation-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const originalDirectory = join(root, "original.openfilm");
    const movedDirectory = join(root, "moved.openfilm");
    const relativePath = "sources/synthetic.png";
    const originalSource = join(originalDirectory, relativePath);
    const sourceBytes = Buffer.from("synthetic managed image bytes");
    let app = await OpenFilmApplication.create(
      originalDirectory,
      "Managed relocation film",
    );
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test closes and reopens the project across the relocation.
      }
    });
    await mkdir(join(originalDirectory, "sources"), { recursive: true });
    await writeFile(originalSource, sourceBytes);
    const originalRootUri = pathToFileURL(
      join(originalDirectory, "sources"),
    ).href;
    const originalSourceUri = pathToFileURL(originalSource).href;
    app.project.mediaLibraries.push({
      id: "managed-library",
      name: "Managed sources",
      uri: originalRootUri,
    });
    app.catalog.upsertAsset({
      id: "managed-source",
      name: "Synthetic managed image",
      uri: originalSourceUri,
      mediaType: "image",
      contentHash: await hashFile(originalSource),
      tags: [],
      state: {},
      metadata: {
        "openfilm.managedSource": {
          relativePath,
          uri: originalSourceUri,
        },
        "openfilm.reference": {
          mediaLibraryId: "managed-library",
          rootUri: originalRootUri,
          relativePath: "synthetic.png",
          originalUri: originalSourceUri,
        },
      },
    });
    app.project.stories.push({
      id: "story",
      title: "Story",
      beats: [
        { id: "beat", title: "Beat", candidateAssetIds: ["managed-source"] },
      ],
    });
    await app.save();
    const version = await app.versions.create({
      name: "Before move",
      baseRevision: app.versions.currentRevision(),
      requestId: "33000000-0000-4000-8000-000000000001",
    });
    app.close({ requireSave: true });
    await rename(originalDirectory, movedDirectory);
    app = await OpenFilmApplication.open(movedDirectory);

    await app.versions.restore(version.id, {
      baseRevision: app.versions.currentRevision(),
      confirmed: true,
      requestId: "33000000-0000-4000-8000-000000000002",
    });
    const movedSourceUri = pathToFileURL(
      join(movedDirectory, relativePath),
    ).href;
    expect(app.catalog.getAsset("managed-source")?.uri).toBe(movedSourceUri);
    expect(
      app.catalog.getAsset("managed-source")?.metadata[
        "openfilm.managedSource"
      ],
    ).toMatchObject({ relativePath, uri: movedSourceUri });
    expect(app.project.mediaLibraries[0]?.uri).toBe(
      pathToFileURL(join(movedDirectory, "sources")).href,
    );
    expect(await readFile(join(movedDirectory, relativePath))).toEqual(
      sourceBytes,
    );
  });

  it("rejects symlinked version storage and rolls an interrupted publication back to its checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-version-recovery-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(
      directory,
      "Before interruption",
    );
    cleanup.push(() => {
      try {
        app.close();
      } catch {
        // The test may already have closed the app.
      }
    });
    const target = await app.versions.create({
      name: "Target",
      baseRevision: app.versions.currentRevision(),
      requestId: "40000000-0000-4000-8000-000000000001",
    });
    app.project.title = "Current checkpoint state";
    await app.save();
    const originalRestore = app.catalog.restoreFromSnapshot.bind(app.catalog);
    let failOnce = true;
    const restoreSpy = vi
      .spyOn(app.catalog, "restoreFromSnapshot")
      .mockImplementation((path, publish) => {
        originalRestore(path, publish);
        if (failOnce) {
          failOnce = false;
          throw new Error("simulated lost publication response");
        }
      });
    await expect(
      app.versions.restore(target.id, {
        baseRevision: app.versions.currentRevision(),
        confirmed: true,
        requestId: "40000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toThrow("simulated lost publication response");
    expect(app.project.title).toBe("Current checkpoint state");
    expect(app.versions.list()).toHaveLength(2);
    restoreSpy.mockRestore();

    const outside = join(root, "outside-versions");
    await rm(join(directory, "versions"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(directory, "versions"));
    expect(() => app.versions.list()).toThrow("versions folder is unsafe");
  });
});
