// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import {
  mkdtemp,
  copyFile,
  lstat,
  readFile,
  readdir,
  rename,
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
import * as renderModule from "@openfilm/render";
import { RenderPublicationRecoveryError } from "@openfilm/render";
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

function manualCaptions(cueCount: number): CaptionTrack {
  return {
    version: 1,
    id: "manual-captions",
    name: "Manual captions",
    language: "en",
    style: {
      version: 1,
      role: "subtitle",
      fontFamily: "Noto Sans CJK TC",
      fontSize: 24,
      position: "bottom",
      background: "scrim",
      safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.15 },
    },
    cues: Array.from({ length: cueCount }, (_, index) => ({
      version: 1,
      id: `cue-${index}`,
      startMs: index,
      endMs: cueCount === 1 ? 900 : index + 1,
      text: "Hi",
      source: { kind: "manual" },
      manualRevision: 0,
    })),
  };
}

describe("professional profile exports", () => {
  it.each(["wav", "audio-stems"] as const)(
    "cancels a %s request after staging its receipt and permits the same-ID retry",
    async (format) => {
      const { app, composition } = await fixture(1);
      const controller = new AbortController();
      const writer = app.exportProfiles as unknown as {
        writeReceipt: (path: string, value: unknown) => Promise<void>;
      };
      const writeReceipt = writer.writeReceipt;
      const spy = vi
        .spyOn(writer, "writeReceipt")
        .mockImplementation(async function (this: typeof writer, path, value) {
          await writeReceipt.call(this, path, value);
          controller.abort();
        });
      const input = {
        compositionId: composition.id,
        profile: createExportProfile({ ratio: "16:9", format, frameRate: 12 }),
        requestId: `late-cancel-retry-${format}`,
      };
      try {
        await expect(
          app.exportProfileAudio({ ...input, signal: controller.signal }),
        ).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }
      expect(await readdir(join(app.directory, "exports"))).toEqual([]);
      expect(
        await readdir(join(app.directory, "cache", "export-requests")),
      ).toEqual([]);
      const retried = await app.exportProfileAudio(input);
      expect(retried.files).toHaveLength(format === "wav" ? 1 : 2);
    },
  );

  it("binds title, caption and GraphicScene font faces without depending on an environment override", async () => {
    const { app, composition } = await fixture(1);
    vi.stubEnv("OPENFILM_TITLE_FONT", undefined);
    try {
      composition.tracks[0]!.clips[0]!.title = "A";
      composition.tracks[0]!.clips[0]!.titleStyle = {
        version: 1,
        role: "film-title",
        fontFamily: "Noto Sans CJK TC",
        fontWeight: 400,
        fontSize: 18,
      };
      const captions = manualCaptions(1);
      captions.style.fontFamily = "Noto Serif CJK TC";
      captions.style.fontSize = 14;
      composition.captionTracks = [captions];
      composition.graphicScenes = [
        {
          version: 1,
          id: "font-scene",
          name: "Font scene",
          start: 0,
          duration: 1,
          zIndex: 1,
          nodes: [
            {
              id: "scene-text",
              type: "text",
              text: "B",
              fontSize: 14,
              fontFamily: "Noto Serif CJK TC",
              fontWeight: 700,
              x: 0,
              y: 0,
              width: 40,
              height: 30,
              opacity: 1,
              zIndex: 0,
              start: 0,
              end: 1,
            },
          ],
        },
      ];
      await app.save();
      const profile = createExportProfile({
        ratio: "9:16",
        format: "png",
        framing: "crop",
        width: 90,
        height: 160,
        frameRate: 12,
      });
      const preview = await app.previewExportFrame({
        compositionId: composition.id,
        profile,
        time: 0.25,
      });
      const receipt = JSON.parse(
        await readFile(
          join(
            app.directory,
            "cache",
            "export-preview",
            `${preview.token}.json`,
          ),
          "utf8",
        ),
      );
      expect(
        receipt.fonts.map((font: { sha256: string }) => font.sha256).sort(),
      ).toEqual(
        (
          await Promise.all(
            [
              "NotoSansCJK-Regular.ttc",
              "NotoSerifCJK-Regular.ttc",
              "NotoSerifCJK-Bold.ttc",
            ].map((name) =>
              hashFile(join("/usr/share/fonts/opentype/noto", name)),
            ),
          )
        ).sort(),
      );
      const reviewed = await decodedRgb(
        await app.exportProfiles.previewPath(preview.token),
      );
      const still = await app.exportStill({
        compositionId: composition.id,
        profile,
        time: 0.25,
        requestId: "three-font-faces-001",
        confirmCrop: true,
        cropPreviewToken: preview.token,
      });
      const mp4 = await app.exportMp4(composition.id, {
        exportProfile: { ...profile, format: "mp4" },
        confirmCrop: true,
        cropPreviewToken: preview.token,
      });
      expect(await decodedRgb(still.path)).toEqual(reviewed);
      expect(await decodedRgb(mp4.path, 0.25)).toEqual(reviewed);
      for (const path of [still.path, mp4.path]) {
        const delivered = JSON.parse(
          await readFile(`${path}.manifest.json`, "utf8"),
        );
        expect(renderModule.canonicalRenderFonts(delivered.fonts)).toEqual(
          receipt.fonts,
        );
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["staged", "completed"] as const)(
    "retries an actual WAV request after its process dies while %s",
    async (phase) => {
      const { app, composition, projectPath, close } = await fixture(1);
      close();
      const requestId = `process-crash-${phase}`;
      const profile = createExportProfile({
        ratio: "16:9",
        format: "wav",
        frameRate: 12,
      });
      const input = { compositionId: composition.id, profile, requestId };
      const source = `import {OpenFilmApplication} from ${JSON.stringify(pathToFileURL(resolve("packages/application/src/index.ts")).href)};
        const app=await OpenFilmApplication.openForExport(${JSON.stringify(projectPath)});
        const service=app.exportProfiles;
        const pause=async()=>{process.stdout.write("paused\\n");await new Promise(()=>setInterval(()=>{},1000));};
        ${
          phase === "staged"
            ? 'const original=service.writeReceipt.bind(service);service.writeReceipt=async(...args)=>{await original(...args);if(args[1]?.profile?.format==="wav")await pause();};'
            : "const original=service.exportMix.bind(service);service.exportMix=async(...args)=>{const result=await original(...args);await pause();return result;};"
        }
        await app.exportProfileAudio(${JSON.stringify(input)});`;
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", source],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stopped = false;
      const exited = new Promise<void>((accept) =>
        child.once("exit", () => {
          stopped = true;
          accept();
        }),
      );
      let errors = "";
      child.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString()));
      cleanup.push(async () => {
        if (!stopped) child.kill("SIGKILL");
        await exited;
      });
      await new Promise<void>((accept, reject) => {
        child.stdout.once("data", () => accept());
        child.once("error", reject);
        child.once("exit", (code) =>
          reject(new Error(`Export child exited ${code}: ${errors}`)),
        );
      });
      const path = join(app.directory, "exports", `mix-${requestId}.wav`);
      const winner =
        phase === "completed"
          ? await Promise.all([
              hashFile(path),
              hashFile(`${path}.manifest.json`),
            ])
          : undefined;
      child.kill("SIGKILL");
      await exited;
      const reopened = await OpenFilmApplication.openForExport(projectPath);
      cleanup.push(() => reopened.close());
      const result = await reopened.exportProfileAudio(input);
      expect(result.files[0]!.sampleCount).toBe(48_000);
      if (winner)
        expect(
          await Promise.all([
            hashFile(path),
            hashFile(`${path}.manifest.json`),
          ]),
        ).toEqual(winner);
      expect(
        await readdir(join(app.directory, "cache", "export-requests")),
      ).toEqual([]);
    },
  );

  it.each(["png", "wav"] as const)(
    "keeps one completed %s winner immutable across concurrent service instances",
    async (format) => {
      const { app, composition } = await fixture(1);
      const first = app.exportProfiles;
      const second = new ExportProfileService(Reflect.get(first, "options"));
      const profile = createExportProfile({
        ratio: "16:9",
        format,
        width: 160,
        height: 90,
        frameRate: 12,
      });
      const input = {
        compositionId: composition.id,
        profile,
        requestId: `concurrent-winner-${format}`,
        time: 0.25,
      };
      let resume!: () => void;
      const paused = new Promise<void>((accept) => (resume = accept));
      let staged!: () => void;
      const receiptStaged = new Promise<void>((accept) => (staged = accept));
      const writer = first as unknown as {
        writeReceipt: (path: string, value: unknown) => Promise<void>;
      };
      const writeReceipt = writer.writeReceipt;
      const spy = vi
        .spyOn(writer, "writeReceipt")
        .mockImplementation(async function (this: typeof writer, path, value) {
          await writeReceipt.call(this, path, value);
          staged();
          await paused;
        });
      const deliver = (service: ExportProfileService, request: typeof input) =>
        format === "png"
          ? service.exportStill(request)
          : service.exportAudio(request);
      const running = deliver(first, input);
      await receiptStaged;
      const competingInput = {
        ...input,
        profile: { ...profile, frameRate: 24, width: 128, height: 72 },
      };
      const competing = await deliver(second, competingInput).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      const path = join(
        app.directory,
        "exports",
        `${format === "png" ? "still" : "mix"}-${input.requestId}.${format}`,
      );
      const winnerHashes =
        competing.status === "fulfilled"
          ? await Promise.all([
              hashFile(path),
              hashFile(`${path}.manifest.json`),
            ])
          : undefined;
      resume();
      try {
        await running;
        if (winnerHashes)
          expect(
            await Promise.all([
              hashFile(path),
              hashFile(`${path}.manifest.json`),
            ]),
          ).toEqual(winnerHashes);
        expect(competing.status).toBe("rejected");
        if (competing.status === "rejected")
          expect(String(competing.reason)).toMatch(
            /requestId.*running|requestId.*different/u,
          );
        expect((await probe(path)).streams[0]!.codec_type).toBe(
          format === "png" ? "video" : "audio",
        );
        await expect(deliver(second, input)).resolves.toBeDefined();
      } finally {
        resume();
        spy.mockRestore();
      }
    },
  );

  it.each(["png", "wav"] as const)(
    "retains real %s publication backups if restoring the prior pair fails",
    async (format) => {
      const { app, composition } = await fixture(1);
      const publish = renderModule.publishRenderPair;
      let injected = false;
      const spy = vi
        .spyOn(renderModule, "publishRenderPair")
        .mockImplementation(
          async (temporary, manifest, output, work, operations) => {
            await writeFile(output, "prior output bytes");
            await writeFile(`${output}.manifest.json`, "prior receipt bytes");
            injected = true;
            return publish(temporary, manifest, output, work, {
              ...operations,
              rename: async (source, destination) => {
                if (source === manifest || source.includes("previous-video-"))
                  throw Object.assign(new Error("Injected restore failure"), {
                    code: "EIO",
                  });
                await rename(source, destination);
              },
            });
          },
        );
      let failure: unknown;
      try {
        const input = {
          compositionId: composition.id,
          profile: createExportProfile({
            ratio: "16:9",
            format,
            width: 160,
            height: 90,
            frameRate: 12,
          }),
          time: 0.25,
          requestId: `retained-backup-${format}`,
        };
        await (format === "png"
          ? app.exportStill(input)
          : app.exportProfileAudio(input));
      } catch (error) {
        failure = error;
      } finally {
        spy.mockRestore();
      }
      expect(injected).toBe(true);
      expect(failure).toBeInstanceOf(RenderPublicationRecoveryError);
      const recovery = failure as RenderPublicationRecoveryError;
      expect(await stat(recovery.workDirectory)).toMatchObject({
        mode: expect.any(Number),
      });
      expect(recovery.recoveryPaths).toHaveLength(1);
      expect(await readFile(recovery.recoveryPaths[0]!, "utf8")).toBe(
        "prior output bytes",
      );
      expect((await stat(recovery.workDirectory)).mode & 0o777).toBe(0o700);
    },
  );

  it.each([true, false])(
    "reserves empty stem request identities durably (empty first=%s)",
    async (emptyFirst) => {
      const { app, composition, projectPath, close } = await fixture(1);
      const originalTracks = structuredClone(composition.tracks);
      if (emptyFirst) {
        app.project.timelines[0]!.tracks = originalTracks.filter(
          (track) => track.type === "video",
        );
        await app.save();
      }
      const input = {
        compositionId: composition.id,
        profile: createExportProfile({
          ratio: "16:9",
          format: "audio-stems",
          frameRate: 12,
        }),
        requestId: `empty-stem-request-${emptyFirst}`,
      };
      const first = await app.exportProfileAudio(input);
      expect(first.files.length).toBe(emptyFirst ? 0 : 2);
      const priorHashes = await Promise.all(
        first.files.map((file) => hashFile(file.path)),
      );
      app.project.timelines[0]!.tracks = emptyFirst
        ? originalTracks
        : originalTracks.filter((track) => track.type === "video");
      await app.save();
      await expect(app.exportProfileAudio(input)).rejects.toThrow(
        /requestId.*different/u,
      );
      expect(
        await Promise.all(first.files.map((file) => hashFile(file.path))),
      ).toEqual(priorHashes);
      const manifest = join(
        app.directory,
        "exports",
        `stems-${input.requestId}`,
        "manifest.json",
      );
      expect((await stat(manifest)).mode & 0o777).toBe(0o600);
      if (emptyFirst) {
        expect(
          await readdir(
            join(app.directory, "exports", `stems-${input.requestId}`),
          ),
        ).toEqual(["manifest.json"]);
        app.project.timelines[0]!.tracks = originalTracks.filter(
          (track) => track.type === "video",
        );
        await app.save();
        const emptyInput = { ...input, requestId: "durable-empty-retry-001" };
        close();
        const passive = await OpenFilmApplication.openForExport(projectPath);
        const empty = await passive.exportProfileAudio(emptyInput);
        const beforeReopen = JSON.stringify(passive.project);
        passive.close();
        const reopened = await OpenFilmApplication.openForExport(projectPath);
        cleanup.push(() => reopened.close());
        expect(JSON.stringify(reopened.project)).toBe(beforeReopen);
        const retried = await reopened.exportProfileAudio(emptyInput);
        expect(retried).toEqual(empty);
        expect(retried.files).toEqual([]);
      }
    },
  );

  it.each(["png", "mp4"] as const)(
    "binds a %s crop token to actual fonts across separate CLI processes",
    async (format) => {
      const { app, composition, root, projectPath, close } = await fixture(1);
      composition.tracks[0]!.clips[0]!.title = "A";
      await app.save();
      close();
      const sans = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
      const serif = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc";
      const cli = async (font: string, args: string[]) =>
        JSON.parse(
          (
            await exec(
              process.execPath,
              [
                "--import",
                "tsx",
                resolve("apps/cli/src/index.ts"),
                "export",
                ...args,
                "--ratio",
                "9:16",
                "--width",
                "90",
                "--height",
                "160",
                "--fps",
                "12",
                "--framing",
                "crop",
                "--project",
                projectPath,
                "--user-data-dir",
                join(root, "font-cli-data"),
              ],
              {
                env: { ...process.env, OPENFILM_TITLE_FONT: font },
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
              },
            )
          ).stdout,
        ) as { token: string; path: string };
      const preview = await cli(sans, [
        "--format",
        "png",
        "--time",
        "0.25",
        "--preview",
      ]);
      const changedPreview = await cli(serif, [
        "--format",
        "png",
        "--time",
        "0.25",
        "--preview",
      ]);
      const reviewedPixels = await decodedRgb(preview.path);
      expect(await decodedRgb(changedPreview.path)).not.toEqual(reviewedPixels);
      const args = [
        "--format",
        format,
        ...(format === "png" ? ["--time", "0.25"] : []),
        "--request-id",
        `font-crop-${format}-001`,
        "--confirm-crop",
        "--crop-preview-token",
        preview.token,
      ];
      await expect(cli(serif, args)).rejects.toThrow(
        /font.*changed|font.*preview/i,
      );
      expect(await readdir(join(projectPath, "exports"))).toEqual([]);
      const collectedFont = join(root, "collected-title-font.ttc");
      await copyFile(sans, collectedFont);
      const delivered = await cli(collectedFont, args);
      expect(
        await decodedRgb(delivered.path, format === "mp4" ? 0.25 : undefined),
      ).toEqual(reviewedPixels);
      if (format === "png")
        await expect(
          cli(serif, [...args.slice(0, -1), changedPreview.token]),
        ).rejects.toThrow(/requestId.*different/u);
    },
  );

  it("exports audio without applying the picture caption cue limit", async () => {
    const { app, composition } = await fixture(6);
    composition.captionTracks = [manualCaptions(5_001)];
    await app.save();
    for (const format of ["wav", "audio-stems"] as const) {
      const result = await app.exportProfileAudio({
        compositionId: composition.id,
        profile: createExportProfile({ ratio: "16:9", format, frameRate: 12 }),
        requestId: `many-captions-${format}`,
      });
      expect(result.files.length).toBe(format === "wav" ? 1 : 2);
      for (const file of result.files) {
        expect(file.sampleCount).toBe(288_000);
        expect((await probe(file.path)).streams).toMatchObject([
          { codec_type: "audio", codec_name: "pcm_s24le", channels: 2 },
        ]);
        expect(await audioRms(file.path, 2)).toBeGreaterThan(0.005);
      }
    }
    await expect(app.exportMp4(composition.id)).rejects.toThrow(/5.?000/u);
  });

  it("renders and verifies picture-only previews and PNGs with offline standalone audio", async () => {
    const { app, composition, imagePath, narrationPath, musicPath } =
      await fixture(1);
    composition.captionTracks = [manualCaptions(1)];
    composition.tracks[1]!.clips[0]!.title = "A";
    await app.save();
    const profile = createExportProfile({
      ratio: "16:9",
      format: "png",
      width: 160,
      height: 90,
      frameRate: 12,
    });
    const reference = await app.exportMp4(composition.id, {
      exportProfile: { ...profile, format: "mp4" },
    });
    const referencePixels = await decodedRgb(reference.path, 0.25);
    const online = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 0.25,
    });
    const reviewedPixels = await decodedRgb(
      await app.exportProfiles.previewPath(online.token),
    );
    expect(reviewedPixels).toEqual(referencePixels);
    await rm(narrationPath);
    await rm(musicPath);
    const streams: Array<Array<Record<string, string>>> = [];
    const receipts: Array<{ encoding: { audio: string | null } }> = [];
    const render = FFmpegRenderer.prototype.render;
    const spy = vi
      .spyOn(FFmpegRenderer.prototype, "render")
      .mockImplementation(async function (this: FFmpegRenderer, ...args) {
        const path = await render.apply(this, args);
        streams.push((await probe(path)).streams);
        receipts.push(
          JSON.parse(await readFile(`${path}.manifest.json`, "utf8")),
        );
        return path;
      });
    try {
      const offline = await app.previewExportFrame({
        compositionId: composition.id,
        profile,
        time: 0.25,
      });
      expect(
        await decodedRgb(await app.exportProfiles.previewPath(offline.token)),
      ).toEqual(reviewedPixels);
      expect(await app.exportProfiles.previewPath(online.token)).toBeTruthy();
      const input = {
        compositionId: composition.id,
        profile,
        time: 0.25,
        requestId: "offline-audio-picture-001",
      };
      const still = await app.exportStill(input);
      expect(await decodedRgb(still.path)).toEqual(reviewedPixels);
      const receipt = JSON.parse(
        await readFile(`${still.path}.manifest.json`, "utf8"),
      ) as { sources: Array<{ assetId: string; sha256: string }> };
      expect(receipt.sources).toEqual([
        expect.objectContaining({ sha256: await hashFile(imagePath) }),
      ]);
      expect((await app.exportStill(input)).path).toBe(still.path);
      expect(streams).toHaveLength(2);
      for (const sourceStreams of streams)
        expect(sourceStreams.map((stream) => stream.codec_type)).toEqual([
          "video",
        ]);
      for (const receipt of receipts) expect(receipt.encoding.audio).toBeNull();
    } finally {
      spy.mockRestore();
    }
    await expect(app.exportMp4(composition.id)).rejects.toThrow(
      /Missing Media/u,
    );
    await expect(
      app.exportProfileAudio({
        compositionId: composition.id,
        profile: createExportProfile({
          ratio: "16:9",
          format: "wav",
          frameRate: 12,
        }),
        requestId: "offline-audio-mix-001",
      }),
    ).rejects.toThrow(/Missing Media/u);
  });

  it("reserves preview project ownership while its request body is incomplete", async () => {
    const { projectPath, composition, close } = await fixture(1);
    close();
    const runtime = await startServer({ port: 0, project: projectPath });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    const seen = (route: string) =>
      new Promise<void>((accept) => {
        const listener = (request: { url?: string }) => {
          if (request.url !== route) return;
          runtime.server.off("request", listener);
          accept();
        };
        runtime.server.on("request", listener);
      });
    let resume!: () => void;
    const rendering = new Promise<void>((accept) => (resume = accept));
    const preview = OpenFilmApplication.prototype.previewExportFrame;
    const spy = vi
      .spyOn(OpenFilmApplication.prototype, "previewExportFrame")
      .mockImplementation(async function (this: OpenFilmApplication, ...args) {
        await rendering;
        return preview.apply(this, args);
      });
    const previewSeen = seen("/api/export/frame-preview");
    let slowRequest!: ReturnType<typeof httpRequest>;
    const previewResponse = new Promise<{ status: number; data: string }>(
      (accept, reject) => {
        slowRequest = httpRequest(
          `${base}/api/export/frame-preview`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
          (response) => {
            let data = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => (data += chunk));
            response.on("end", () =>
              accept({ status: response.statusCode!, data }),
            );
          },
        );
        slowRequest.on("error", reject);
      },
    );
    slowRequest.write("{");
    await previewSeen;
    const closeSeen = seen("/api/project/close");
    const closing = postJson(base, "/api/project/close", {});
    await closeSeen;
    await new Promise<void>((accept) => setImmediate(accept));
    slowRequest.end(
      JSON.stringify({
        compositionId: composition.id,
        profile: createExportProfile({
          ratio: "16:9",
          width: 160,
          height: 90,
          frameRate: 12,
        }),
        time: 0.25,
      }).slice(1),
    );
    try {
      expect((await closing).status).toBe(409);
    } finally {
      resume();
      spy.mockRestore();
    }
    const result = await previewResponse;
    expect(result.status, result.data).toBe(200);
    const { token } = JSON.parse(result.data) as { token: string };
    expect(
      (await fetch(`${base}/api/export/frame-preview/${token}`)).status,
    ).toBe(200);
  });

  it.each(["png", "wav", "audio-stems"] as const)(
    "keeps project edits queued through %s receipt publication",
    async (format) => {
      const { projectPath, composition, close } = await fixture(1);
      close();
      const runtime = await startServer({ port: 0, project: projectPath });
      cleanup.push(() => runtime.close());
      const base = `http://127.0.0.1:${runtime.port}`;
      let resume!: () => void;
      const publication = new Promise<void>((accept) => (resume = accept));
      let staged!: () => void;
      const receiptStaged = new Promise<void>((accept) => (staged = accept));
      const service = ExportProfileService.prototype as unknown as {
        writeReceipt: (path: string, value: unknown) => Promise<void>;
      };
      const writeReceipt = service.writeReceipt;
      const spy = vi
        .spyOn(service, "writeReceipt")
        .mockImplementation(async function (this: typeof service, path, value) {
          await writeReceipt.call(this, path, value);
          const receipt = value as { profile?: { format?: string } };
          if (receipt.profile?.format !== format) return;
          staged();
          await publication;
        });
      const exporting = postJson(
        base,
        format === "png" ? "/api/export/still" : "/api/export/audio",
        {
          compositionId: composition.id,
          profile: createExportProfile({
            ratio: "16:9",
            format,
            width: 160,
            height: 90,
            frameRate: 12,
          }),
          requestId: `queued-edit-${format}`,
          ...(format === "png" ? { time: 0.25 } : {}),
        },
      );
      await receiptStaged;
      const events: string[] = [];
      const update = OpenFilmApplication.prototype.updateFilm;
      const editSpy = vi
        .spyOn(OpenFilmApplication.prototype, "updateFilm")
        .mockImplementation(function (this: OpenFilmApplication, ...args) {
          events.push("edit");
          return update.apply(this, args);
        });
      const edited = fetch(`${base}/api/project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectContentLocale: "ja-JP" }),
      });
      // The real HTTP edit reaches its body reader while publication is paused.
      await new Promise<void>((accept) => setTimeout(accept, 100));
      const editedBeforePublication = events.includes("edit");
      events.push("publish");
      resume();
      const result = await exporting;
      try {
        expect(result.status, await result.text()).toBe(200);
        expect((await edited).status).toBe(200);
        expect(editedBeforePublication).toBe(false);
        expect(events).toEqual(["publish", "edit"]);
      } finally {
        resume();
        spy.mockRestore();
        editSpy.mockRestore();
      }
    },
  );

  it.each(
    (["png", "mp4"] as const).flatMap((format) =>
      (["validation", "after-approval", "source", "render-plan"] as const).map(
        (window) => ({ format, window }),
      ),
    ),
  )(
    "rejects a $format crop when its approved snapshot changes during $window",
    async ({ format, window }) => {
      const { app, composition, imagePath } = await fixture(1);
      const profile = createExportProfile({
        ratio: "9:16",
        width: 90,
        height: 160,
        frameRate: 12,
        framing: "crop",
        format,
      });
      const preview = await app.previewExportFrame({
        compositionId: composition.id,
        profile,
        time: 0.25,
      });
      const reviewedPixels = await decodedRgb(
        await app.exportProfiles.previewPath(preview.token),
      );
      const options = Reflect.get(app.exportProfiles, "options") as {
        getProject: () => typeof app.project;
      };
      const getProject = options.getProject;
      let changed = false;
      let scheduled = false;
      const changeProject = async () => {
        changed = true;
        app.project.settings = { width: 90, height: 160, frameRate: 12 };
        app.project.timelines[0]!.tracks[0]!.clips[0]!.title =
          "UNREVIEWED TITLE";
        await app.save();
      };
      let alternatePixels: Buffer | undefined;
      if (window === "source") {
        const alternate = join(app.directory, "cache", "unreviewed-source.png");
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=blue:s=320x180:r=1:d=1",
          "-frames:v",
          "1",
          "-threads",
          "1",
          alternate,
        ]);
        alternatePixels = await readFile(alternate);
      }
      let restore: () => void;
      if (window === "validation") {
        options.getProject = () => {
          if (!scheduled) {
            scheduled = true;
            setImmediate(() => void changeProject());
          }
          return getProject();
        };
        restore = () => {
          options.getProject = getProject;
        };
      } else if (window === "render-plan") {
        const render = FFmpegRenderer.prototype.render;
        const spy = vi
          .spyOn(FFmpegRenderer.prototype, "render")
          .mockImplementation(function (
            this: FFmpegRenderer,
            cut,
            assets,
            output,
            settings,
            renderOptions,
          ) {
            changed = true;
            const unreviewed = structuredClone(cut);
            unreviewed.tracks[0]!.clips[0]!.title = "UNREVIEWED TITLE";
            return render.call(
              this,
              unreviewed,
              assets,
              output,
              settings,
              renderOptions,
            );
          });
        restore = () => spy.mockRestore();
      } else {
        const approve = app.exportProfiles.assertCropPreview.bind(
          app.exportProfiles,
        );
        const spy = vi
          .spyOn(app.exportProfiles, "assertCropPreview")
          .mockImplementation(async (...args) => {
            const approval = await approve(...args);
            if (window === "source") {
              changed = true;
              await writeFile(imagePath, alternatePixels!);
            } else await changeProject();
            return approval;
          });
        restore = () => spy.mockRestore();
      }
      let output: { path: string } | undefined;
      let failure: unknown;
      try {
        output =
          format === "png"
            ? await app.exportStill({
                compositionId: composition.id,
                profile,
                time: 0.25,
                requestId: `stale-crop-${window}-001`,
                confirmCrop: true,
                cropPreviewToken: preview.token,
              })
            : await app.exportMp4(composition.id, {
                exportProfile: profile,
                confirmCrop: true,
                cropPreviewToken: preview.token,
              });
      } catch (error) {
        failure = error;
      } finally {
        restore();
      }
      const proof = {
        format,
        window,
        changed,
        published: Boolean(output),
        savedPixelsDifferFromPreview: output
          ? !reviewedPixels.equals(
              await decodedRgb(
                output.path,
                format === "mp4" ? 0.25 : undefined,
              ),
            )
          : undefined,
        error: failure instanceof Error ? failure.message : undefined,
      };
      console.log(JSON.stringify(proof));
      expect(proof).toMatchObject({ changed: true, published: false });
      expect(failure).toBeInstanceOf(Error);
      expect(await readdir(join(app.directory, "exports"))).toEqual([]);
    },
  );

  it("rejects MP4 crop publication if the saved project changes while FFmpeg renders", async () => {
    const { app, composition } = await fixture(1);
    const profile = createExportProfile({
      ratio: "9:16",
      width: 90,
      height: 160,
      frameRate: 12,
      framing: "crop",
    });
    const preview = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 0.25,
    });
    let changed = false;
    await expect(
      app.exportMp4(composition.id, {
        exportProfile: profile,
        confirmCrop: true,
        cropPreviewToken: preview.token,
        onProgress: () => {
          if (changed) return;
          changed = true;
          app.project.timelines[0]!.tracks[0]!.clips[0]!.title =
            "UNREVIEWED TITLE";
          void app.save();
        },
      }),
    ).rejects.toThrow(/changed|stale/u);
    expect(changed).toBe(true);
    expect(await readdir(join(app.directory, "exports"))).toEqual([]);
  });

  it("rejects MP4 crop publication if a source changes after its render manifest is staged", async () => {
    const { app, composition, imagePath } = await fixture(1);
    const profile = createExportProfile({
      ratio: "9:16",
      width: 90,
      height: 160,
      frameRate: 12,
      framing: "crop",
    });
    const preview = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 0.25,
    });
    const approve = app.exportProfiles.assertCropPreview.bind(
      app.exportProfiles,
    );
    let changed = false;
    const spy = vi
      .spyOn(app.exportProfiles, "assertCropPreview")
      .mockImplementation(async (...args) => {
        const approval = await approve(...args);
        if (!approval) return approval;
        return {
          ...approval,
          assertCurrent: () => {
            approval.assertCurrent();
            if (
              !changed &&
              readdirSync(join(app.directory, "exports")).some(
                (name) =>
                  name.startsWith(".render-") &&
                  existsSync(
                    join(app.directory, "exports", name, "manifest.json"),
                  ),
              )
            ) {
              appendFileSync(imagePath, "changed after manifest staging");
              changed = true;
            }
          },
        };
      });
    try {
      await expect(
        app.exportMp4(composition.id, {
          exportProfile: profile,
          confirmCrop: true,
          cropPreviewToken: preview.token,
        }),
      ).rejects.toThrow(/Source changed/u);
    } finally {
      spy.mockRestore();
    }
    expect(changed).toBe(true);
    expect(await readdir(join(app.directory, "exports"))).toEqual([]);
  });

  it("rejects PNG crop publication if a source changes after its still receipt is staged", async () => {
    const { app, composition, imagePath } = await fixture(1);
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
    const options = Reflect.get(app.exportProfiles, "options") as {
      getProject: () => typeof app.project;
    };
    const getProject = options.getProject;
    const work = join(app.directory, "cache", "export-work");
    let changed = false;
    options.getProject = () => {
      if (
        !changed &&
        readdirSync(work).some(
          (name) =>
            existsSync(join(work, name, "manifest.json")) &&
            existsSync(join(work, name, "still.png")),
        )
      ) {
        appendFileSync(imagePath, "changed after still receipt staging");
        changed = true;
      }
      return getProject();
    };
    try {
      await expect(
        app.exportStill({
          compositionId: composition.id,
          profile,
          time: 0.25,
          requestId: "source-change-before-png-001",
          confirmCrop: true,
          cropPreviewToken: preview.token,
        }),
      ).rejects.toThrow(/Source changed/u);
    } finally {
      options.getProject = getProject;
    }
    expect(changed).toBe(true);
    expect(await readdir(join(app.directory, "exports"))).toEqual([]);
  });

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
    expect(
      await readdir(join(app.directory, "cache", "export-requests")),
    ).toEqual([]);
    const retry = await app.exportStill({
      compositionId: composition.id,
      profile,
      time: 0.5,
      requestId: "cancel-retry-profile-001",
    });
    const retryInfo = (await probe(retry.path)).streams[0]!;
    expect(
      await readdir(join(app.directory, "cache", "export-requests")),
    ).toEqual([]);
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
