import { assertRenderQaMetric } from "../tests/helpers/render-qa-policy.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FFmpegRenderer } from "@openfilm/render";
import type { MediaAsset } from "@openfilm/core";
import { generatePhotoFilmQualityMedia } from "../fixtures/photo-film-quality/generate.mjs";
import {
  buildPhotoFilmQualityScenario,
  qualitySampleTimes,
  qualitySettings,
} from "../fixtures/photo-film-quality/scenario.js";

const execute = promisify(execFile);
const root = resolve(process.argv[2] ?? "/tmp/openfilm-photo-quality-evidence");
const ffmpeg = (args: string[]) =>
  execute("ffmpeg", ["-hide_banner", "-nostdin", "-threads", "1", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
const json = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

function diff(
  before: unknown,
  after: unknown,
  path = "",
): { path: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    const first = before as Record<string, unknown>;
    const second = after as Record<string, unknown>;
    return [
      ...new Set([...Object.keys(first), ...Object.keys(second)]),
    ].flatMap((key) => diff(first[key], second[key], `${path}/${key}`));
  }
  return [{ path, before: before ?? null, after: after ?? null }];
}

function lastNumber(text: string, expression: RegExp): number | null {
  const values = [...text.matchAll(expression)];
  const value = values.at(-1)?.[1];
  return value !== undefined && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

async function audioMetrics(path: string, variant: string) {
  const loudness = await ffmpeg([
    "-v",
    "info",
    "-i",
    path,
    "-vn",
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]);
  const statistics = await ffmpeg([
    "-v",
    "info",
    "-i",
    path,
    "-vn",
    "-af",
    "astats=metadata=0:reset=0",
    "-f",
    "null",
    "-",
  ]);
  await writeFile(join(root, `${variant}-loudness.txt`), loudness.stderr);
  await writeFile(
    join(root, `${variant}-audio-statistics.txt`),
    statistics.stderr,
  );
  const musicBandRms = async (start: number) => {
    const result = await ffmpeg([
      "-v",
      "info",
      "-ss",
      String(start),
      "-t",
      "1",
      "-i",
      path,
      "-vn",
      "-af",
      "bandpass=f=220:width_type=h:w=8,astats=metadata=0:reset=0",
      "-f",
      "null",
      "-",
    ]);
    return lastNumber(result.stderr, /RMS level dB:\s*(-?[\d.]+)/gu);
  };
  return {
    integratedLufs: lastNumber(loudness.stderr, /I:\s*(-?[\d.]+) LUFS/gu),
    truePeakDbfs: lastNumber(loudness.stderr, /Peak:\s*(-?[\d.]+) dBFS/gu),
    loudnessRangeLu: lastNumber(loudness.stderr, /LRA:\s*([\d.]+) LU/gu),
    rmsDbfs: lastNumber(statistics.stderr, /RMS level dB:\s*(-?[\d.]+)/gu),
    musicBandRmsDbfs: {
      beforeNarration: await musicBandRms(2),
      duringNarration: await musicBandRms(8),
    },
    method:
      "FFmpeg ebur128 true peak; astats overall RMS; narrow 220 Hz band RMS at 2–3 s / 8–9 s to inspect synthetic music ducking. These metrics cannot establish speech or listening quality.",
  };
}

const git = await execute("git", ["rev-parse", "HEAD"]);
const status = await execute("git", ["status", "--porcelain"]);
const sourceList = await execute("git", [
  "ls-files",
  "-co",
  "--exclude-standard",
  "--",
  "packages/core/src",
  "packages/render/src",
  "fixtures/photo-film-quality",
  "scripts/photo-film-quality.ts",
]);
const implementationSources = await Promise.all(
  [...new Set(sourceList.stdout.trim().split("\n").filter(Boolean))]
    .sort()
    .map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
);
await mkdir(root, { recursive: true });
await json(join(root, "implementation-sources.json"), implementationSources);
const fixture = await generatePhotoFilmQualityMedia(join(root, "media"));
const assets: MediaAsset[] = fixture.files.map((file) => ({
  id: file.id,
  uri: pathToFileURL(file.path).href,
  name: file.id,
  mediaType: file.mediaType,
  ...(file.width && file.height
    ? { dimensions: { width: file.width, height: file.height } }
    : {}),
  ...(file.duration ? { duration: file.duration } : {}),
  contentHash: file.sha256,
  tags: ["synthetic", "cc0", "photo-film-quality"],
  state: {},
  metadata: { "openfilm.fixture": { synthetic: true, license: "CC0-1.0" } },
}));
const scenario = buildPhotoFilmQualityScenario(assets);
await json(join(root, "assets.private.json"), assets);
await json(join(root, "A-composition.json"), scenario.baseline);
await json(join(root, "B-composition.json"), scenario.designed);
await json(
  join(root, "composition-diff.json"),
  diff(scenario.baseline, scenario.designed),
);
await json(join(root, "frame-samples.json"), {
  settings: qualitySettings,
  times: qualitySampleTimes,
  transitionBoundarySeconds: [3, 6, 10, 13, 16],
  note: "Samples cover each clip start, middle and end, plus cut / dissolve boundaries; no aesthetic judgment is inferred.",
});
const frames = join(root, "frames");
await mkdir(frames, { recursive: true });
const outputs = [];
for (const [variant, composition] of [
  ["A", scenario.baseline],
  ["B", scenario.designed],
] as const) {
  const path = join(root, `${variant}.mp4`);
  console.log(
    `Rendering ${variant}: 20 seconds at ${qualitySettings.width}×${qualitySettings.height} / 30 fps`,
  );
  const started = performance.now();
  await new FFmpegRenderer().render(composition, assets, path, qualitySettings);
  const renderElapsedMs = Math.round(performance.now() - started);
  const manifestPath = `${variant}.mp4.manifest.json`;
  const manifest = JSON.parse(
    await readFile(join(root, manifestPath), "utf8"),
  ) as {
    version: number;
    sources: { assetId: string; sha256: string }[];
    warnings?: unknown[];
  };
  if (manifest.version !== 1 || !Array.isArray(manifest.sources))
    throw new Error(
      `${variant} render manifest is missing its source evidence`,
    );
  const referencedAssets = new Set(
    composition.tracks
      .flatMap((track) =>
        track.clips.flatMap((clip) => [
          clip.assetId,
          ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
        ]),
      )
      .filter(Boolean),
  );
  for (const assetId of referencedAssets) {
    const expected = assets.find((asset) => asset.id === assetId)!;
    if (
      !manifest.sources.some(
        (source) =>
          source.assetId === assetId && source.sha256 === expected.contentHash,
      )
    )
      throw new Error(
        `${variant} manifest source hash does not match generated asset ${assetId}`,
      );
  }
  const probe = await execute("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    path,
  ]);
  const metadata = JSON.parse(probe.stdout) as {
    format?: { duration?: string; filename?: string };
    streams?: { codec_type: string; duration?: string; nb_frames?: string }[];
  };
  // The full ffprobe file is local evidence and contains the local filename.
  await json(join(root, `${variant}-ffprobe.private.json`), metadata);
  const duration = Number(metadata.format?.duration);
  assertRenderQaMetric(
    "photoFilm.durationError",
    Math.abs(duration - 20),
    undefined,
    { frameRate: qualitySettings.frameRate },
  );
  if (!metadata.streams?.some((stream) => stream.codec_type === "audio"))
    throw new Error(`${variant} output has no audio stream`);
  for (const [index, time] of qualitySampleTimes.entries()) {
    await ffmpeg([
      "-v",
      "error",
      "-ss",
      String(time),
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      `scale=320:180,pad=320:204:0:0:black,drawtext=text='${variant} ${time.toFixed(3)}s':fontcolor=white:fontsize=14:x=8:y=185`,
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      join(frames, `${variant}-${String(index).padStart(2, "0")}.jpg`),
    ]);
  }
  await ffmpeg([
    "-v",
    "error",
    "-framerate",
    "1",
    "-i",
    join(frames, `${variant}-%02d.jpg`),
    "-vf",
    "tile=6x4:padding=4:margin=4:color=0x181818",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    join(root, `${variant}-contact-sheet.jpg`),
  ]);
  outputs.push({
    variant,
    file: `${variant}.mp4`,
    manifest: manifestPath,
    warnings: manifest.warnings ?? [],
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    duration,
    videoFrames: metadata.streams.find(
      (stream) => stream.codec_type === "video",
    )?.nb_frames,
    renderElapsedMs,
    audio: await audioMetrics(path, variant),
  });
}
const version = await execute("ffmpeg", ["-version"]);
for (const file of fixture.files) {
  const currentHash = createHash("sha256")
    .update(await readFile(file.path))
    .digest("hex");
  if (currentHash !== file.sha256)
    throw new Error(
      `Generated source ${file.id} changed during the comparison`,
    );
}
await json(join(root, "evidence-summary.json"), {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gitHead: git.stdout.trim(),
  workingTreeDirty: Boolean(status.stdout.trim()),
  implementationSources: "implementation-sources.json",
  implementationSourcesSha256: createHash("sha256")
    .update(JSON.stringify(implementationSources))
    .digest("hex"),
  ffmpeg: version.stdout.split("\n")[0],
  settings: qualitySettings,
  sourceManifest: "media/manifest.json",
  sourceBytesUnchanged: true,
  compositionDiff: "composition-diff.json",
  frameSamples: "frame-samples.json",
  outputs,
  limitations: [
    "Generated calibration inputs only; not user films or camera originals.",
    "Execution time is a single local render observation, not a benchmark.",
    "Synthetic tones do not verify intelligibility, musical fit or listening quality.",
    "Contact sheets require human inspection; real projection, actual audio listening, Windows and Resolve remain manual gates.",
    "Source paths and private ffprobe files stay in the selected local output directory; do not publish them without review.",
  ],
});
console.log(
  `A/B MP4s, compositions, contact sheets and measured evidence written to ${root}`,
);
