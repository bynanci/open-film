// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  lstat,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createExportProfile,
  type CaptionTrack,
  type Composition,
  type ExportRatio,
} from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { ExportProfileService } from "../../packages/application/src/export-profiles.js";
import { FFmpegRenderer } from "@openfilm/render";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: Array<() => Promise<unknown> | void> = [];
const exec = promisify(execFile);
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture(duration = 12) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-export-profiles-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projectPath = join(root, "家庭輸出 # &.openfilm");
  const imagePath = join(root, "合成原圖 # &.png");
  const narrationPath = join(root, "合成旁白.wav");
  const musicPath = join(root, "合成音樂.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=1:d=1",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    imagePath,
  ]);
  for (const [path, frequency] of [
    [narrationPath, 660],
    [musicPath, 440],
  ] as const)
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
      "-ac",
      path === narrationPath ? "1" : "2",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      path,
    ]);
  const assets = await Promise.all(
    [imagePath, narrationPath, musicPath].map(async (path) =>
      inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: path.split("/").at(-1)!,
      }),
    ),
  );
  const [photo, narration, music] = assets;
  const app = await OpenFilmApplication.create(projectPath, "Synthetic export");
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    app.close();
  };
  cleanup.push(close);
  app.project.settings = { width: 160, height: 90, frameRate: 12 };
  for (const asset of assets) app.catalog.upsertAsset(asset);
  const composition: Composition = {
    id: "synthetic-film",
    storyId: "synthetic-story",
    duration,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "synthetic-shot",
            assetId: photo!.id,
            timelineStart: 0,
            timelineDuration: duration,
          },
        ],
      },
      {
        id: "narration",
        type: "audio",
        timing: "overlay",
        clips: [
          {
            id: "voice",
            assetId: narration!.id,
            timelineStart: 0,
            timelineDuration: duration,
            audioAutomation: {
              version: 1,
              role: "narration",
              fadeIn: 0.8,
              fadeOut: 1,
              points: [
                { time: 0, gain: 0.8 },
                { time: duration, gain: 0.8 },
              ],
            },
          },
        ],
      },
      {
        id: "music",
        type: "music",
        timing: "overlay",
        clips: [
          {
            id: "music-bed",
            assetId: music!.id,
            timelineStart: 0,
            timelineDuration: duration,
            audioAutomation: {
              version: 1,
              role: "music",
              fadeIn: 0.5,
              fadeOut: 0.8,
              points: [
                { time: 0, gain: 0.6 },
                { time: duration, gain: 0.6 },
              ],
              ducking: [
                {
                  start: Math.min(4, duration * 0.35),
                  end: Math.min(7, duration * 0.6),
                  gain: 0.2,
                  attack: 0.1,
                  release: 0.15,
                },
              ],
            },
          },
        ],
      },
    ],
  };
  app.project.stories.push({
    id: "synthetic-story",
    title: "Synthetic story",
    beats: [],
  });
  app.project.timelines.push(composition);
  await app.save();
  return {
    app,
    root,
    projectPath,
    composition: app.project.timelines.find(
      (item) => item.id === composition.id,
    )!,
    imagePath,
    narrationPath,
    musicPath,
    close,
  };
}

async function probe(path: string) {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,sample_rate,channels",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(result.stdout.toString("utf8")) as {
    format: { duration: string };
    streams: Array<Record<string, string>>;
  };
}

async function decodedRgb(path: string, time?: number): Promise<Buffer> {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      ...(time === undefined ? [] : ["-ss", String(time)]),
      "-i",
      path,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ])
  ).stdout;
}

async function audioRms(
  path: string,
  start: number,
  duration = 0.2,
): Promise<number> {
  const samples = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(start),
      "-t",
      String(duration),
      "-i",
      path,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-",
    ])
  ).stdout;
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset + 4 <= samples.length; offset += 4) {
    const sample = samples.readFloatLE(offset);
    sum += sample * sample;
    count++;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

const postJson = (base: string, route: string, body: unknown) =>
  fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("professional profile exports", () => {
  it("requires a crop preview bound to the current frame, render choices and saved revision", async () => {
    const { app, composition, projectPath, close } = await fixture(1);
    const profile = createExportProfile({
      ratio: "9:16",
      width: 90,
      height: 160,
      frameRate: 12,
      framing: "crop",
      format: "png",
      quality: "high-detail",
    });
    const input = {
      compositionId: composition.id,
      profile,
      time: 0.25,
      requestId: "bound-crop-preview-001",
      confirmCrop: true,
      captionTrackId: null,
    };
    await expect(app.exportStill(input)).rejects.toThrow(
      /reviewed export frame/u,
    );
    await expect(
      app.exportMp4(composition.id, {
        exportProfile: { ...profile, format: "mp4" },
        confirmCrop: true,
        captionTrackId: null,
      }),
    ).rejects.toThrow(/reviewed export frame/u);
    const preview = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: input.time,
      captionTrackId: null,
    });
    const reviewed = { ...input, cropPreviewToken: preview.token };
    const changed = [
      { time: 0.5 },
      { profile: { ...profile, quality: "standard" as const } },
      {
        profile: createExportProfile({
          ratio: "1:1",
          width: 120,
          height: 120,
          frameRate: 12,
          framing: "crop",
          format: "png",
          quality: "high-detail",
        }),
      },
      {
        lookOverride: {
          version: 1 as const,
          preset: "retro" as const,
          strength: 1,
        },
      },
      { captionTrackId: undefined },
    ];
    for (const difference of changed)
      await expect(
        app.exportStill({ ...reviewed, ...difference }),
      ).rejects.toThrow(/reviewed export frame/u);
    composition.defaultLook = { version: 1, preset: "natural", strength: 1 };
    await expect(app.exportStill(reviewed)).rejects.toThrow(
      /stale|reviewed export frame/u,
    );
    delete composition.defaultLook;
    close();
    const previewApp = await OpenFilmApplication.openForExport(projectPath);
    const current = await previewApp.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: input.time,
      captionTrackId: null,
    });
    const previewBytes = await readFile(
      await previewApp.exportProfiles.previewPath(current.token),
    );
    previewApp.close();
    const reopened = await OpenFilmApplication.openForExport(projectPath);
    cleanup.push(() => reopened.close());
    const saved = await reopened.exportStill({
      ...input,
      cropPreviewToken: current.token,
    });
    expect(await readFile(saved.path)).toEqual(previewBytes);
    const mp4 = await reopened.exportMp4(composition.id, {
      exportProfile: { ...profile, format: "mp4" },
      confirmCrop: true,
      cropPreviewToken: current.token,
      captionTrackId: null,
    });
    expect((await probe(mp4.path)).streams[0]!.width).toBe(90);
  });

  it("exports audio with an offline picture-only source while MP4 still rejects that source", async () => {
    const { app, composition, imagePath } = await fixture(1);
    await rm(imagePath);
    for (const format of ["wav", "audio-stems"] as const) {
      const result = await app.exportProfileAudio({
        compositionId: composition.id,
        profile: createExportProfile({ ratio: "16:9", frameRate: 12, format }),
        requestId: `offline-picture-${format}`,
      });
      expect(result.files.length).toBe(format === "wav" ? 1 : 2);
      expect(
        result.files.every(
          (file) => file.channels === 2 && file.sampleCount === 48000,
        ),
      ).toBe(true);
    }
    await expect(app.exportMp4(composition.id)).rejects.toThrow(
      /Missing Media/u,
    );
  });

  it("uses profile quality for actual encoder settings even when a separate quality disagrees", async () => {
    const { app, composition } = await fixture(1);
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 12,
      quality: "high-detail",
    });
    for (const quality of [undefined, "standard"] as const) {
      const result = await app.exportMp4(composition.id, {
        exportProfile: profile,
        ...(quality ? { quality } : {}),
      });
      const receipt = JSON.parse(
        await readFile(`${result.path}.manifest.json`, "utf8"),
      );
      expect(receipt.exportProfile.quality).toBe("high-detail");
      expect(receipt.encoding.quality).toBe("high-detail");
      expect(receipt.encoding.crf).toBe(18);
    }
  });

  it("treats a null still look as the saved look in receipts and repeat requests", async () => {
    const { app, composition } = await fixture(1);
    composition.defaultLook = { version: 1, preset: "retro", strength: 1 };
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 12,
      format: "png",
    });
    const input = {
      compositionId: composition.id,
      profile,
      time: 0.25,
      requestId: "null-saved-look-001",
    };
    const result = await app.exportStill({ ...input, lookOverride: null });
    const receipt = JSON.parse(
      await readFile(`${result.path}.manifest.json`, "utf8"),
    );
    expect(receipt.renderSelection.lookOverride).toEqual({ mode: "saved" });
    expect((await app.exportStill(input)).path).toBe(result.path);
  });

  it("rejects times beyond the last complete profile frame before attempting an extraction", async () => {
    const { app, composition } = await fixture(1.05);
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 10,
      format: "png",
    });
    await expect(
      app.previewExportFrame({
        compositionId: composition.id,
        profile,
        time: 1.01,
      }),
    ).rejects.toThrow(/final output frame/u);
    await expect(
      app.exportStill({
        compositionId: composition.id,
        profile,
        time: 1.01,
        requestId: "partial-last-frame-001",
      }),
    ).rejects.toThrow(/final output frame/u);
    const last = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 0.99,
    });
    expect(last.frameIndex).toBe(9);
  });

  it("rejects differing hashes for a shared source across sequential real stem renders", async () => {
    const { app, composition, narrationPath } = await fixture(1);
    const voice = composition.tracks.find((track) => track.id === "narration")!
      .clips[0]!;
    composition.tracks.find((track) => track.id === "music")!.clips = [
      {
        ...structuredClone(voice),
        id: "shared-music",
        audioAutomation: { version: 1, role: "music" },
      },
    ];
    const assets = app.catalog
      .listAssets({ limit: 100 })
      .filter(
        (asset) => asset.id === voice.assetId || asset.mediaType === "image",
      );
    const service = new ExportProfileService({
      directory: app.directory,
      getProject: () => app.project,
      getComposition: () => composition,
      getAssets: () => assets,
      render: async (id, output, options) => {
        const result = await new FFmpegRenderer().render(
          composition,
          assets,
          output,
          app.project.settings,
          options,
        );
        if (options.audioRole === "narration") {
          const bytes = await readFile(narrationPath);
          bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
          await writeFile(narrationPath, bytes);
        }
        return result;
      },
    });
    await expect(
      service.exportAudio({
        compositionId: composition.id,
        profile: createExportProfile({
          ratio: "16:9",
          frameRate: 12,
          format: "audio-stems",
        }),
        requestId: "conflicting-stem-source-001",
      }),
    ).rejects.toThrow(/Source changed between audio stem renders/u);
    expect(await readdir(join(app.directory, "exports"))).not.toContain(
      "stems-conflicting-stem-source-001",
    );
  });

  it("prunes expired previews left by a previous service instance without following unrelated entries", async () => {
    const { app, composition, root } = await fixture(1);
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 12,
    });
    const first = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 0.25,
    });
    const oldPath = await app.exportProfiles.previewPath(first.token);
    const expired = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(oldPath, expired, expired);
    const cache = join(app.directory, "cache", "export-preview");
    await writeFile(join(cache, "unrelated.png"), "keep");
    const orphan = `${randomUUID()}.json`;
    await writeFile(join(cache, orphan), "{}");
    for (let index = 0; index < 13; index++) {
      const path = join(cache, `${randomUUID()}.png`);
      await writeFile(path, await readFile(oldPath));
      const modified = new Date(Date.now() - (index + 1) * 1000);
      await utimes(path, modified, modified);
    }
    const outside = join(root, "outside.png");
    await writeFile(outside, "source stays untouched");
    await symlink(
      outside,
      join(cache, "00000000-0000-4000-8000-000000000000.png"),
    );
    const reopened = new ExportProfileService({
      directory: app.directory,
      getProject: () => app.project,
      getComposition: () => composition,
      getAssets: () => app.catalog.listAssets({ limit: 100 }),
      render: async (id, path, options) =>
        new FFmpegRenderer().render(
          composition,
          app.catalog.listAssets({ limit: 100 }),
          path,
          app.project.settings,
          options,
        ),
    });
    await reopened.previewFrame({
      compositionId: composition.id,
      profile,
      time: 0.25,
    });
    const names = await readdir(cache);
    expect(names).not.toContain(`${first.token}.png`);
    expect(names).not.toContain(`${first.token}.json`);
    expect(names).not.toContain(orphan);
    expect(names).toContain("unrelated.png");
    const regularPreviews = await Promise.all(
      names
        .filter((name) => /^[a-f0-9-]{36}\.png$/u.test(name))
        .map(async (name) => (await lstat(join(cache, name))).isFile()),
    );
    expect(regularPreviews.filter(Boolean)).toHaveLength(12);
    expect(await readFile(outside, "utf8")).toBe("source stays untouched");
  });

  it("expires a persisted crop approval before it can publish a still", async () => {
    const { app, composition } = await fixture(1);
    const profile = createExportProfile({
      ratio: "9:16",
      width: 90,
      height: 160,
      frameRate: 12,
      framing: "crop",
      format: "png",
    });
    const preview = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 0.25,
    });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
    try {
      await expect(
        app.exportStill({
          compositionId: composition.id,
          profile,
          time: 0.25,
          requestId: "expired-crop-proof-001",
          confirmCrop: true,
          cropPreviewToken: preview.token,
        }),
      ).rejects.toThrow(/expired/u);
    } finally {
      clock.mockRestore();
    }
    expect(
      await readdir(join(app.directory, "cache", "export-preview")),
    ).not.toContain(`${preview.token}.json`);
  });

  it("renders a real 12-second MP4 in all three ratios without changing Composition or source files", async () => {
    const { app, composition, imagePath, narrationPath, musicPath } =
      await fixture();
    const before = structuredClone(app.project);
    const sourceHashes = await Promise.all(
      [imagePath, narrationPath, musicPath].map((path) => hashFile(path)),
    );
    const dimensions: Record<ExportRatio, [number, number]> = {
      "16:9": [160, 90],
      "9:16": [90, 160],
      "1:1": [120, 120],
    };
    for (const ratio of ["16:9", "9:16", "1:1"] as const) {
      const [width, height] = dimensions[ratio];
      const profile = createExportProfile({
        ratio,
        width,
        height,
        frameRate: 12,
      });
      const result = await app.exportMp4(composition.id, {
        exportProfile: profile,
      });
      const media = await probe(result.path);
      expect(media.streams[0]).toMatchObject({
        codec_type: "video",
        codec_name: "h264",
        r_frame_rate: "12/1",
        nb_read_frames: "144",
      });
      expect(Number(media.streams[0]!.width)).toBe(width);
      expect(Number(media.streams[0]!.height)).toBe(height);
      expect(Number(media.format.duration)).toBeCloseTo(12, 3);
      const first = await decodedRgb(result.path, 0);
      const middle = await decodedRgb(result.path, 6);
      const last = await decodedRgb(result.path, 11.9);
      for (const frame of [first, middle, last]) {
        expect(frame).toHaveLength(width * height * 3);
        expect(frame.some((value) => value > 16)).toBe(true);
      }
      const manifest = JSON.parse(
        await readFile(`${result.path}.manifest.json`, "utf8"),
      ) as {
        exportProfile: unknown;
        sources: Array<{ sha256: string }>;
        warnings: string[];
      };
      expect(manifest.exportProfile).toEqual(profile);
      expect(manifest.sources.map((source) => source.sha256).sort()).toEqual(
        [...sourceHashes].sort(),
      );
      if (ratio !== "16:9")
        expect(manifest.warnings).toContain(
          "Profile letterboxes the saved Composition frame with black padding.",
        );
    }
    expect(app.project).toEqual(before);
    expect(
      await Promise.all(
        [imagePath, narrationPath, musicPath].map((path) => hashFile(path)),
      ),
    ).toEqual(sourceHashes);
  }, 120_000);

  it("previews the decoded selected-caption frame, preserves its cue receipt and deduplicates a still retry", async () => {
    const { app, composition, imagePath } = await fixture();
    const captions: CaptionTrack = {
      version: 1,
      id: "zh-TW-track",
      name: "繁體字幕",
      language: "zh-TW",
      style: {
        version: 1,
        role: "subtitle",
        fontFamily: "Noto Sans CJK TC",
        fontSize: 24,
        position: "bottom",
        background: "scrim",
        safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.15 },
      },
      cues: [
        {
          version: 1,
          id: "manual-zh-cue",
          startMs: 3_000,
          endMs: 8_000,
          text: "繁體字幕",
          source: { kind: "manual" },
          manualRevision: 0,
        },
      ],
    };
    const film = app.project.timelines.find(
      (item) => item.id === composition.id,
    )!;
    film.captionTracks = [captions];
    await app.save();
    const profile = createExportProfile({
      ratio: "9:16",
      width: 90,
      height: 160,
      frameRate: 12,
      format: "png",
    });
    const selected = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 4.57,
      captionTrackId: captions.id,
    });
    expect(selected.frameIndex).toBe(54);
    expect(selected.time).toBe(4.5);
    const previewPath = await app.exportProfiles.previewPath(selected.token);
    const previewProbe = await probe(previewPath);
    expect(previewProbe.streams[0]).toMatchObject({ codec_name: "png" });
    expect(Number(previewProbe.streams[0]!.width)).toBe(90);
    expect(Number(previewProbe.streams[0]!.height)).toBe(160);

    const noCaptions = await app.exportStill({
      compositionId: composition.id,
      profile,
      time: 4.57,
      requestId: "still-no-caption-001",
      captionTrackId: null,
    });
    const still = await app.exportStill({
      compositionId: composition.id,
      profile,
      time: 4.57,
      requestId: "still-with-caption-001",
      captionTrackId: captions.id,
    });
    expect(still).toMatchObject({ time: 4.5, frameIndex: 54, profile });
    expect(await decodedRgb(still.path)).toEqual(await decodedRgb(previewPath));
    const plainPixels = await decodedRgb(noCaptions.path);
    const captionPixels = await decodedRgb(still.path);
    const bottomStart = Math.floor(160 * 0.68) * 90 * 3;
    let lowerFrameDifferences = 0;
    for (let i = bottomStart; i < captionPixels.length; i++)
      if (captionPixels[i] !== plainPixels[i]) lowerFrameDifferences++;
    expect(lowerFrameDifferences).toBeGreaterThan(20);

    const receipt = JSON.parse(
      await readFile(`${still.path}.manifest.json`, "utf8"),
    ) as {
      frame: { time: number; index: number };
      renderSelection: { captionTrackId: string };
      sources: Array<{ sha256: string }>;
      output: { sha256: string; alpha: boolean };
    };
    expect(receipt.frame).toEqual({ time: 4.5, index: 54 });
    expect(receipt.renderSelection.captionTrackId).toBe(captions.id);
    expect(receipt.output).toMatchObject({
      width: 90,
      height: 160,
      alpha: false,
    });
    expect(receipt.output.sha256).toBe(await hashFile(still.path));
    expect(receipt.sources.map((source) => source.sha256)).toContain(
      await hashFile(imagePath),
    );
    const retry = await app.exportStill({
      compositionId: composition.id,
      profile,
      time: 4.57,
      requestId: "still-with-caption-001",
      captionTrackId: captions.id,
    });
    expect(retry.path).toBe(still.path);
    expect(await hashFile(retry.path)).toBe(await hashFile(still.path));
  }, 120_000);

  it("exports aligned 48 kHz WAV mix and role stems with current fades, gain and ducking", async () => {
    const { app, composition } = await fixture();
    const mix = await app.exportProfileAudio({
      compositionId: composition.id,
      profile: createExportProfile({
        ratio: "16:9",
        frameRate: 12,
        format: "wav",
      }),
      requestId: "audio-mix-receipt-001",
    });
    const stems = await app.exportProfileAudio({
      compositionId: composition.id,
      profile: createExportProfile({
        ratio: "16:9",
        frameRate: 12,
        format: "audio-stems",
      }),
      requestId: "audio-stems-receipt-001",
    });
    expect(mix.files).toHaveLength(1);
    expect(stems.files.map((file) => file.role)).toEqual([
      "narration",
      "music",
    ]);
    const allFiles = [...mix.files, ...stems.files];
    for (const file of allFiles) {
      expect(file).toMatchObject({
        sampleRate: 48_000,
        channels: 2,
        sampleCount: 576_000,
      });
      expect(file.duration).toBeCloseTo(12, 3);
      expect(await hashFile(file.path)).toBe(file.sha256);
      const media = await probe(file.path);
      expect(media.streams[0]).toMatchObject({
        codec_name: "pcm_s24le",
        sample_rate: "48000",
      });
      expect(Number(media.streams[0]!.channels)).toBe(2);
      expect(Number(media.format.duration)).toBeCloseTo(12, 3);
    }
    const narrationStem = stems.files.find(
      (file) => file.role === "narration",
    )!;
    const musicStem = stems.files.find((file) => file.role === "music")!;
    expect(await audioRms(narrationStem.path, 0.1)).toBeLessThan(
      await audioRms(narrationStem.path, 2),
    );
    expect(await audioRms(narrationStem.path, 11.7)).toBeLessThan(
      await audioRms(narrationStem.path, 9),
    );
    expect(await audioRms(musicStem.path, 5.3)).toBeLessThan(
      await audioRms(musicStem.path, 3),
    );
    expect(
      stems.files.every((file) =>
        file.path.startsWith(
          `${app.directory}/exports/stems-audio-stems-receipt-001/`,
        ),
      ),
    ).toBe(true);
  }, 120_000);

  it("fences canceled retries, stale previews and output collisions without exposing cache files", async () => {
    const { app, composition, imagePath } = await fixture(2);
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 12,
      format: "png",
    });
    const controller = new AbortController();
    const canceled = app.exportStill({
      compositionId: composition.id,
      profile,
      time: 0.5,
      requestId: "cancel-retry-profile-001",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    await expect(canceled).rejects.toThrow();
    const retry = await app.exportStill({
      compositionId: composition.id,
      profile,
      time: 0.5,
      requestId: "cancel-retry-profile-001",
    });
    const retryInfo = (await probe(retry.path)).streams[0]!;
    expect(retryInfo.codec_name).toBe("png");
    expect(Number(retryInfo.width)).toBe(160);
    expect(Number(retryInfo.height)).toBe(90);
    const sourceHash = await hashFile(imagePath);
    const collisionPath = join(
      app.directory,
      "exports",
      "still-export-collision-001.png",
    );
    await symlink(imagePath, collisionPath);
    await expect(
      app.exportStill({
        compositionId: composition.id,
        profile,
        time: 0.5,
        requestId: "export-collision-001",
      }),
    ).rejects.toThrow(/symlink/u);
    expect(await hashFile(imagePath)).toBe(sourceHash);
    const preview = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 0.5,
    });
    const previewPath = await app.exportProfiles.previewPath(preview.token);
    expect(previewPath.startsWith(`${app.directory}/cache/`)).toBe(true);
    expect((await stat(previewPath)).mode & 0o777).toBe(0o600);
    expect(
      (await stat(join(app.directory, "cache", "export-preview"))).mode & 0o777,
    ).toBe(0o700);
    expect((await stat(join(app.directory, "exports"))).mode & 0o777).toBe(
      0o700,
    );
    await writeFile(
      imagePath,
      Buffer.concat([await readFile(imagePath), Buffer.from("changed")]),
    );
    await expect(app.exportProfiles.previewPath(preview.token)).rejects.toThrow(
      /source changed/u,
    );
  }, 120_000);

  it("serves preview, MP4, PNG, WAV and role stems through the shared HTTP application service", async () => {
    const { root, projectPath, composition, close } = await fixture(1);
    close();
    const runtime = await startServer({ port: 0, project: projectPath });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    const cropMp4 = createExportProfile({
      ratio: "9:16",
      width: 90,
      height: 160,
      frameRate: 12,
      framing: "crop",
    });
    const previewResponse = await postJson(base, "/api/export/frame-preview", {
      compositionId: composition.id,
      profile: cropMp4,
      time: 0.25,
      captionTrackId: null,
    });
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      token: string;
      frameIndex: number;
    };
    expect(preview.frameIndex).toBe(3);
    const frameResponse = await fetch(
      `${base}/api/export/frame-preview/${preview.token}`,
    );
    expect(frameResponse.status).toBe(200);
    expect(frameResponse.headers.get("content-type")).toContain("image/png");
    expect(
      Buffer.from(await frameResponse.arrayBuffer())
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");

    const pngProfile = createExportProfile({
      ratio: "9:16",
      width: 90,
      height: 160,
      frameRate: 12,
      framing: "crop",
      format: "png",
    });
    const rejectedCrop = await postJson(base, "/api/export/still", {
      compositionId: composition.id,
      profile: pngProfile,
      time: 0.25,
      requestId: "http-still-profile-001",
    });
    expect(rejectedCrop.status).toBe(400);
    const stillResponse = await postJson(base, "/api/export/still", {
      compositionId: composition.id,
      profile: pngProfile,
      time: 0.25,
      requestId: "http-still-profile-001",
      confirmCrop: true,
      cropPreviewToken: preview.token,
      captionTrackId: null,
    });
    expect(stillResponse.status).toBe(200);
    const still = (await stillResponse.json()) as {
      filename: string;
      profile: unknown;
    };
    expect(still.profile).toEqual(pngProfile);
    const stillDownload = await fetch(
      `${base}/api/export/file?${new URLSearchParams({ name: still.filename })}`,
    );
    expect(stillDownload.status).toBe(200);
    const stillBytes = Buffer.from(await stillDownload.arrayBuffer());
    expect(stillBytes.subarray(1, 4).toString()).toBe("PNG");
    const receiptDownload = await fetch(
      `${base}/api/export/file?${new URLSearchParams({ name: `${still.filename}.manifest.json` })}`,
    );
    expect(receiptDownload.status).toBe(200);
    const receipt = (await receiptDownload.json()) as {
      output: { width: number; height: number; alpha: boolean };
    };
    expect(receipt.output).toMatchObject({
      width: 90,
      height: 160,
      alpha: false,
    });
    expect(
      (
        await fetch(
          `${base}/api/export/file?${new URLSearchParams({ name: "../outside.wav" })}`,
        )
      ).status,
    ).toBe(400);

    const mp4Profile = createExportProfile({
      ratio: "1:1",
      width: 120,
      height: 120,
      frameRate: 12,
    });
    const mp4Response = await postJson(base, "/api/export", {
      compositionId: composition.id,
      format: "mp4",
      exportProfile: mp4Profile,
    });
    expect(mp4Response.status).toBe(200);
    const mp4 = (await mp4Response.json()) as { path: string };
    const mp4Info = (await probe(mp4.path)).streams[0]!;
    expect(Number(mp4Info.width)).toBe(120);
    expect(Number(mp4Info.height)).toBe(120);

    const mixResponse = await postJson(base, "/api/export/audio", {
      compositionId: composition.id,
      profile: createExportProfile({
        ratio: "16:9",
        frameRate: 12,
        format: "wav",
      }),
      requestId: "http-audio-mix-001",
    });
    expect(mixResponse.status).toBe(200);
    const mix = (await mixResponse.json()) as {
      files: Array<{ filename: string; sampleCount: number }>;
    };
    expect(mix.files[0]?.sampleCount).toBe(48_000);
    expect(
      (
        await fetch(
          `${base}/api/export/file?${new URLSearchParams({ name: mix.files[0]!.filename })}`,
        )
      ).status,
    ).toBe(200);

    const stemsResponse = await postJson(base, "/api/export/audio", {
      compositionId: composition.id,
      profile: createExportProfile({
        ratio: "16:9",
        frameRate: 12,
        format: "audio-stems",
      }),
      requestId: "http-audio-stems-001",
    });
    expect(stemsResponse.status).toBe(200);
    const stems = (await stemsResponse.json()) as {
      requestId: string;
      files: Array<{ filename: string; role: string }>;
    };
    expect(stems.files.map((file) => file.role)).toEqual([
      "narration",
      "music",
    ]);
    const firstStem = `stems-${stems.requestId}/${stems.files[0]!.filename}`;
    const stemDownload = await fetch(
      `${base}/api/export/file?${new URLSearchParams({ name: firstStem })}`,
    );
    expect(stemDownload.status).toBe(200);
    expect((await stemDownload.arrayBuffer()).byteLength).toBeGreaterThan(44);

    const secondProjectPath = join(root, "second.openfilm");
    const second = await OpenFilmApplication.create(
      secondProjectPath,
      "Second synthetic project",
    );
    second.close();
    const switched = await postJson(base, "/api/project/open", {
      path: secondProjectPath,
    });
    expect(switched.status).toBe(200);
    expect(
      (await fetch(`${base}/api/export/frame-preview/${preview.token}`)).status,
    ).not.toBe(200);
  }, 120_000);

  it("runs the same still, MP4 and audio profile logic from the CLI on Unicode project paths", async () => {
    const { app, root, projectPath, close } = await fixture(1);
    const sourceHash = await hashFile(join(root, "合成原圖 # &.png"));
    close();
    const cli = (args: string[]) =>
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("apps/cli/src/index.ts"),
          ...args,
          "--project",
          projectPath,
          "--user-data-dir",
          join(root, "cli-user-data"),
        ],
        { timeout: 30_000, maxBuffer: 1024 * 1024 },
      );
    const still = JSON.parse(
      (
        await cli([
          "export",
          "--format",
          "png",
          "--ratio",
          "9:16",
          "--width",
          "90",
          "--height",
          "160",
          "--fps",
          "12",
          "--time",
          "0.25",
          "--request-id",
          "cli-still-profile-001",
        ])
      ).stdout,
    ) as {
      path: string;
      profile: { width: number; height: number };
      frameIndex: number;
    };
    expect(still.profile).toMatchObject({ width: 90, height: 160 });
    expect(still.frameIndex).toBe(3);
    const mp4 = JSON.parse(
      (
        await cli([
          "export",
          "--format",
          "mp4",
          "--ratio",
          "1:1",
          "--width",
          "120",
          "--height",
          "120",
          "--fps",
          "12",
        ])
      ).stdout,
    ) as { path: string };
    const videoInfo = (await probe(mp4.path)).streams[0]!;
    expect(Number(videoInfo.width)).toBe(120);
    expect(Number(videoInfo.height)).toBe(120);
    const audio = JSON.parse(
      (
        await cli([
          "export",
          "--format",
          "audio-stems",
          "--request-id",
          "cli-stems-profile-001",
        ])
      ).stdout,
    ) as { files: Array<{ role: string; sampleCount: number }> };
    expect(audio.files.map((file) => file.role)).toEqual([
      "narration",
      "music",
    ]);
    expect(audio.files.every((file) => file.sampleCount === 48_000)).toBe(true);
    await expect(
      cli([
        "export",
        "--format",
        "png",
        "--ratio",
        "9:16",
        "--width",
        "90",
        "--height",
        "160",
        "--fps",
        "12",
        "--time",
        "0.25",
        "--framing",
        "crop",
        "--request-id",
        "cli-crop-profile-001",
      ]),
    ).rejects.toThrow();
    await expect(
      cli([
        "export",
        "--format",
        "png",
        "--ratio",
        "9:16",
        "--width",
        "90",
        "--height",
        "160",
        "--fps",
        "12",
        "--time",
        "0.25",
        "--framing",
        "crop",
        "--confirm-crop",
        "--request-id",
        "cli-unreviewed-crop-001",
      ]),
    ).rejects.toThrow();
    const cropArgs = [
      "export",
      "--format",
      "png",
      "--ratio",
      "9:16",
      "--width",
      "90",
      "--height",
      "160",
      "--fps",
      "12",
      "--time",
      "0.25",
      "--framing",
      "crop",
      "--quality",
      "high-detail",
    ];
    const preview = JSON.parse(
      (await cli([...cropArgs, "--preview"])).stdout,
    ) as { token: string; path: string };
    expect((await probe(preview.path)).streams[0]!.codec_name).toBe("png");
    const cropped = JSON.parse(
      (
        await cli([
          ...cropArgs,
          "--confirm-crop",
          "--crop-preview-token",
          preview.token,
          "--request-id",
          "cli-reviewed-crop-001",
        ])
      ).stdout,
    ) as { path: string };
    expect(await readFile(cropped.path)).toEqual(await readFile(preview.path));
    expect(await hashFile(join(root, "合成原圖 # &.png"))).toBe(sourceHash);
    const persisted = JSON.parse(
      await readFile(join(projectPath, "project.json"), "utf8"),
    ) as {
      settings: unknown;
      timelines: unknown;
    };
    expect(persisted.settings).toEqual(app.project.settings);
    expect(persisted.timelines).toEqual(app.project.timelines);
  }, 120_000);
});
