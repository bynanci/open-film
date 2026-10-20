// Modified by OpenFilm contributors on 2026-10-20. Synthetic local evidence only.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createExportProfile,
  type CaptionTrack,
  type Composition,
} from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";

const root = resolve(
  process.env.OPENFILM_EXPORT_PROFILES_QA_OUTPUT ??
    join(tmpdir(), "openfilm-export-profiles-qa"),
);
const runRoot = join(root, randomUUID());
const sourceRoot = join(runRoot, "synthetic-sources");
const projectPath = join(runRoot, "synthetic-family-film.openfilm");
await mkdir(sourceRoot, { recursive: true });

const photoPath = join(sourceRoot, "synthetic-landscape.png");
const narrationPath = join(sourceRoot, "synthetic-narration.wav");
const musicPath = join(sourceRoot, "synthetic-music.wav");
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
  photoPath,
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
    `sine=frequency=${frequency}:sample_rate=48000:duration=12`,
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    "-threads",
    "1",
    "-y",
    path,
  ]);

const assets = await Promise.all(
  [photoPath, narrationPath, musicPath].map(async (path) =>
    inspectMedia({
      path,
      uri: pathToFileURL(path).href,
      name: path.split("/").at(-1)!,
    }),
  ),
);
const [photo, narration, music] = assets;
const sourceHashes = Object.fromEntries(
  await Promise.all(
    assets.map(
      async (asset) =>
        [asset.name, await hashFile(asset.uri.replace(/^file:/u, ""))] as const,
    ),
  ),
);

const captions: CaptionTrack = {
  version: 1,
  id: "zh-TW-synthetic-track",
  name: "繁體中文（合成）",
  language: "zh-TW",
  style: {
    version: 1,
    role: "subtitle",
    fontFamily: "Noto Sans CJK TC",
    fontSize: 18,
    position: "bottom",
    background: "scrim",
    safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.15 },
  },
  cues: [
    {
      version: 1,
      id: "synthetic-cue-1",
      startMs: 3_000,
      endMs: 8_000,
      text: "合成繁體字幕",
      source: { kind: "manual" },
      manualRevision: 0,
    },
  ],
};
const composition: Composition = {
  id: "synthetic-family-film",
  storyId: "synthetic-story",
  duration: 12,
  tracks: [
    {
      id: "visuals",
      type: "video",
      clips: [
        {
          id: "synthetic-shot",
          assetId: photo!.id,
          timelineStart: 0,
          timelineDuration: 12,
        },
      ],
    },
    {
      id: "narration",
      type: "audio",
      timing: "overlay",
      clips: [
        {
          id: "synthetic-voice",
          assetId: narration!.id,
          timelineStart: 0,
          timelineDuration: 12,
          audioAutomation: {
            version: 1,
            role: "narration",
            fadeIn: 0.8,
            fadeOut: 1,
            points: [
              { time: 0, gain: 0.8 },
              { time: 12, gain: 0.8 },
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
          id: "synthetic-music-bed",
          assetId: music!.id,
          timelineStart: 0,
          timelineDuration: 12,
          audioAutomation: {
            version: 1,
            role: "music",
            fadeIn: 0.5,
            fadeOut: 0.8,
            points: [
              { time: 0, gain: 0.6 },
              { time: 12, gain: 0.6 },
            ],
            ducking: [
              { start: 4, end: 7, gain: 0.2, attack: 0.1, release: 0.15 },
            ],
          },
        },
      ],
    },
  ],
  captionTracks: [captions],
};

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
    streams: Array<Record<string, string | number>>;
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

const app = await OpenFilmApplication.create(
  projectPath,
  "Synthetic profile validation",
);
try {
  app.project.settings = { width: 320, height: 180, frameRate: 12 };
  for (const asset of assets) app.catalog.upsertAsset(asset);
  app.project.stories.push({
    id: "synthetic-story",
    title: "Synthetic story",
    beats: [],
  });
  app.project.timelines.push(composition);
  await app.save();
  const savedProject = structuredClone(app.project);
  const ratios = [
    {
      ratio: "16:9" as const,
      width: 320,
      height: 180,
      framing: "contain" as const,
    },
    {
      ratio: "9:16" as const,
      width: 180,
      height: 320,
      framing: "contain" as const,
    },
    {
      ratio: "1:1" as const,
      width: 240,
      height: 240,
      framing: "crop" as const,
    },
  ];
  const videos = [];
  for (const choice of ratios) {
    const profile = createExportProfile({ ...choice, frameRate: 12 });
    const preview = await app.previewExportFrame({
      compositionId: composition.id,
      profile,
      time: 4.57,
      captionTrackId: captions.id,
    });
    const cropConfirmed =
      profile.framing !== "crop" ||
      Boolean(await app.exportProfiles.previewPath(preview.token));
    const rendered = await app.exportMp4(composition.id, {
      exportProfile: profile,
      confirmCrop: cropConfirmed,
      captionTrackId: captions.id,
    });
    const metadata = await probe(rendered.path);
    const frameHashes = await Promise.all(
      [0, 6, 11.9].map(async (time) =>
        createHash("sha256")
          .update(await decodedRgb(rendered.path, time))
          .digest("hex"),
      ),
    );
    const manifest = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(`${rendered.path}.manifest.json`, "utf8"),
    ) as {
      outputSha256: string;
      sources: Array<{ assetId: string; sha256: string }>;
      warnings: string[];
    };
    if (
      Number(metadata.streams[0]?.width) !== choice.width ||
      Number(metadata.streams[0]?.height) !== choice.height
    )
      throw new Error(`Unexpected output dimensions for ${choice.ratio}.`);
    if (metadata.streams[0]?.nb_read_frames !== "144")
      throw new Error(`Unexpected frame count for ${choice.ratio}.`);
    videos.push({
      ratio: choice.ratio,
      framing: choice.framing,
      profile,
      path: rendered.path,
      stream: metadata.streams[0],
      duration: Number(metadata.format.duration),
      sha256: await hashFile(rendered.path),
      manifestSha256: manifest.outputSha256,
      sourceHashes: manifest.sources.map(({ assetId, sha256 }) => ({
        assetId,
        sha256,
      })),
      warnings: manifest.warnings,
      decodedFirstMiddleLastRgbSha256: frameHashes,
    });
  }

  const stillProfile = createExportProfile({
    ratio: "9:16",
    width: 90,
    height: 160,
    frameRate: 12,
    framing: "crop",
    format: "png",
  });
  const stillPreview = await app.previewExportFrame({
    compositionId: composition.id,
    profile: stillProfile,
    time: 4.57,
    captionTrackId: captions.id,
  });
  const previewPath = await app.exportProfiles.previewPath(stillPreview.token);
  const still = await app.exportStill({
    compositionId: composition.id,
    profile: stillProfile,
    time: 4.57,
    requestId: "m7b-synthetic-still-001",
    confirmCrop: true,
    captionTrackId: captions.id,
  });
  if (!(await decodedRgb(previewPath)).equals(await decodedRgb(still.path)))
    throw new Error("Preview and still PNG decoded frames differ.");
  const stillManifest = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(`${still.path}.manifest.json`, "utf8"),
  ) as {
    output: { sha256: string; width: number; height: number; alpha: boolean };
    sources: Array<{ sha256: string }>;
    renderSelection: unknown;
  };
  const mix = await app.exportProfileAudio({
    compositionId: composition.id,
    profile: createExportProfile({
      ratio: "16:9",
      frameRate: 12,
      format: "wav",
    }),
    requestId: "m7b-synthetic-mix-001",
  });
  const stems = await app.exportProfileAudio({
    compositionId: composition.id,
    profile: createExportProfile({
      ratio: "16:9",
      frameRate: 12,
      format: "audio-stems",
    }),
    requestId: "m7b-synthetic-stems-001",
  });
  const audio = await Promise.all(
    [...mix.files, ...stems.files].map(async (file) => ({
      role: file.role,
      filename: file.filename,
      sampleRate: file.sampleRate,
      channels: file.channels,
      sampleCount: file.sampleCount,
      duration: file.duration,
      sha256: await hashFile(file.path),
      decoded: (await probe(file.path)).streams[0],
    })),
  );
  const finalSourceHashes = await Promise.all(
    assets.map((asset) => hashFile(asset.uri.replace(/^file:/u, ""))),
  );
  if (JSON.stringify(app.project) !== JSON.stringify(savedProject))
    throw new Error("Export profile changed the saved project or Composition.");
  if (
    JSON.stringify(Object.values(sourceHashes).sort()) !==
    JSON.stringify(finalSourceHashes.sort())
  )
    throw new Error("Synthetic source files changed during export.");
  const report = {
    generatedAt: new Date().toISOString(),
    outputRoot: runRoot,
    sourceHashes,
    videoExports: videos,
    preview: {
      time: stillPreview.time,
      frameIndex: stillPreview.frameIndex,
      width: stillPreview.width,
      height: stillPreview.height,
    },
    still: {
      path: still.path,
      sha256: await hashFile(still.path),
      receipt: stillManifest.output,
      sourceHashes: stillManifest.sources.map((source) => source.sha256),
      renderSelection: stillManifest.renderSelection,
      warnings: still.warnings,
    },
    audio,
    compositionUnchanged: true,
    sourcesUnchanged: true,
  };
  await writeFile(
    join(runRoot, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  app.close();
}
