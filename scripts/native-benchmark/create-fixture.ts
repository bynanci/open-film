import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import type { Clip, MediaAsset } from "@openfilm/core";
import { createThumbnail, referenceFor, runProcess } from "@openfilm/media";

export interface NativeBenchmarkCounts {
  assets: number;
  clips: number;
  beats: number;
}
export const NATIVE_BENCHMARK_DEFAULT_COUNTS: Readonly<NativeBenchmarkCounts> =
  Object.freeze({ assets: 2000, clips: 500, beats: 10 });

interface FixtureFile {
  relativePath: string;
  sha256: string;
  fileSize: number;
}
export interface NativeBenchmarkFixtureManifest {
  fixtureVersion: "1.0.0";
  createdAt: string;
  counts: NativeBenchmarkCounts;
  durationSeconds: number;
  projectRelativePath: "benchmark.openfilm";
  generator: { ffmpegVersion: string; nodeVersion: string };
  source: FixtureFile & {
    durationSeconds: 3;
    width: 320;
    height: 180;
    frameRate: 24;
    videoCodec: "h264";
    audioCodec: "aac";
  };
  files: FixtureFile[];
  media: Array<FixtureFile & { assetId: string }>;
  linkedMediaCount: number;
  copiedMediaCount: number;
  limitations: string[];
}

function validateCounts(options: Partial<NativeBenchmarkCounts>) {
  const counts = { ...NATIVE_BENCHMARK_DEFAULT_COUNTS, ...options };
  for (const key of ["assets", "clips", "beats"] as const)
    if (
      !Number.isSafeInteger(counts[key]) ||
      counts[key] < 1 ||
      counts[key] > 10000
    )
      throw new Error(`${key} must be an integer between 1 and 10000`);
  if (counts.clips > counts.assets)
    throw new Error("clips cannot exceed assets");
  if (counts.beats > counts.clips) throw new Error("beats cannot exceed clips");
  return counts;
}

async function fileIdentity(root: string, relativePath: string) {
  const path = join(root, relativePath);
  return {
    relativePath,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    fileSize: (await stat(path)).size,
  };
}

/** A synthetic workload, not real-media or workstation performance evidence. */
export async function createNativeBenchmarkFixture(
  directory: string,
  options: Partial<NativeBenchmarkCounts> = {},
): Promise<{ projectPath: string; manifestPath: string }> {
  const counts = validateCounts(options);
  if (typeof directory !== "string" || !directory.trim())
    throw new Error("A fresh fixture directory is required");
  const requested = resolve(directory);
  // Exclusive creation prevents concurrent invocations from reusing a fixture
  // or clobbering an existing project, even when its directory is empty.
  try {
    await mkdir(requested);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Fixture destination must not already exist", {
        cause: error,
      });
    throw error;
  }
  const root = await realpath(requested);
  await mkdir(join(root, "generated"));
  await mkdir(join(root, "media"));
  const sourceRelativePath = "generated/source.mp4";
  const sourcePath = join(root, sourceRelativePath);
  const version = await runProcess("ffmpeg", ["-version"]);
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-metadata",
    "creation_time=2024-06-15T12:00:00Z",
    "-movflags",
    "+faststart",
    "-n",
    sourcePath,
  ]);
  const source = await fileIdentity(root, sourceRelativePath);
  const projectPath = join(root, "benchmark.openfilm");
  const app = await OpenFilmApplication.create(
    projectPath,
    `Generated ${counts.clips}-clip workstation benchmark`,
    {},
    { userDataDirectory: join(root, "isolated-user-data") },
  );
  const thumbnail = "cache/thumbnails/benchmark.jpg";
  const media: NativeBenchmarkFixtureManifest["media"] = [];
  let linkedMediaCount = 0;
  let copiedMediaCount = 0;
  try {
    const library = {
      id: "benchmark-library",
      name: "Generated benchmark media",
      uri: pathToFileURL(join(root, "media")).href,
    };
    app.project.mediaLibraries.push(library);
    await mkdir(join(projectPath, "cache", "thumbnails"));
    const descriptor: MediaAsset = {
      id: "asset-0000",
      uri: pathToFileURL(sourcePath).href,
      name: "Memory 0000.mp4",
      mediaType: "video",
      duration: 3,
      dimensions: { width: 320, height: 180 },
      frameRate: 24,
      codec: "h264",
      contentHash: source.sha256,
      thumbnailUri: thumbnail,
      tags: [],
      state: {},
      metadata: {
        "openfilm.filesystem": { size: source.fileSize },
        "openfilm.benchmark": { generated: true, fixtureVersion: "1.0.0" },
      },
    };
    await createThumbnail(descriptor, join(projectPath, thumbnail));
    const clips: Clip[] = [];
    for (let index = 0; index < counts.assets; index++) {
      const suffix = String(index).padStart(4, "0");
      const relativePath = `media/${suffix}.mp4`;
      const path = join(root, relativePath);
      try {
        await link(sourcePath, path);
        linkedMediaCount++;
      } catch (error) {
        // A removable filesystem may not implement hard links. Copies preserve
        // the workload and identity while the manifest records storage cost.
        if (
          !["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        await copyFile(sourcePath, path, constants.COPYFILE_EXCL);
        copiedMediaCount++;
      }
      const asset: MediaAsset = {
        ...descriptor,
        id: `asset-${suffix}`,
        name: `Memory ${suffix}.mp4`,
        uri: pathToFileURL(path).href,
        metadata: { ...descriptor.metadata },
      };
      asset.metadata["openfilm.reference"] = referenceFor(asset, [library]);
      app.catalog.upsertAsset(asset);
      media.push({
        assetId: asset.id,
        relativePath,
        sha256: source.sha256,
        fileSize: source.fileSize,
      });
      if (index < counts.clips)
        clips.push({
          id: `benchmark-${suffix}`,
          assetId: asset.id,
          beatId: `beat-${Math.floor((index * counts.beats) / counts.clips)}`,
          sourceIn: 0,
          sourceOut: 3,
          timelineStart: index * 3,
          timelineDuration: 3,
        });
    }
    const duration = counts.clips * 3;
    app.project.stories.push({
      id: "benchmark-story",
      title: "Generated benchmark memories",
      targetDuration: duration,
      maxDuration: duration + 300,
      beats: Array.from({ length: counts.beats }, (_, index) => {
        const assetIds = clips
          .filter((clip) => clip.beatId === `beat-${index}`)
          .map((clip) => clip.assetId);
        return {
          id: `beat-${index}`,
          title: `Chapter ${index + 1}`,
          targetDuration: assetIds.length * 3,
          candidateAssetIds: assetIds,
          selectedAssetIds: assetIds,
          constraints: [{ type: "asset-order" as const, assetIds }],
        };
      }),
    });
    app.project.timelines.push({
      id: "benchmark-cut",
      storyId: "benchmark-story",
      duration,
      tracks: [{ id: "video", type: "video", clips }],
    });
  } finally {
    // Save and close SQLite before hashing: WAL pages must not be omitted from
    // the fixture identity. The project is never closed with active jobs.
    app.close();
  }
  const files = await Promise.all(
    [
      sourceRelativePath,
      `benchmark.openfilm/${thumbnail}`,
      "benchmark.openfilm/project.json",
      "benchmark.openfilm/database.sqlite",
    ].map((relativePath) => fileIdentity(root, relativePath)),
  );
  const manifest: NativeBenchmarkFixtureManifest = {
    fixtureVersion: "1.0.0",
    createdAt: new Date().toISOString(),
    counts,
    durationSeconds: counts.clips * 3,
    projectRelativePath: "benchmark.openfilm",
    generator: {
      ffmpegVersion: version.stdout.toString("utf8").split("\n")[0]!,
      nodeVersion: process.version,
    },
    source: {
      ...source,
      durationSeconds: 3,
      width: 320,
      height: 180,
      frameRate: 24,
      videoCodec: "h264",
      audioCodec: "aac",
    },
    files,
    media,
    linkedMediaCount,
    copiedMediaCount,
    limitations: [
      "Procedural video and synthesized audio; not ASR or speech quality evidence.",
      "All assets share one 3-second 320x180 source; not 4K or long-source decoding evidence.",
      "No transcript, waveform, scene analysis, private media, or provider jobs are generated.",
      "One shared thumbnail models timeline presentation, not a diverse thumbnail cache.",
      "Source hashes depend on FFmpeg version; project IDs and creation timestamps differ between generations. Reuse one fixture for comparable runs.",
      "Catalog source URIs are absolute. Moving this root requires Find Folder / folder relinking to its media directory; relative paths and hashes are preserved.",
      "Generated fixture success is not native workstation startup or long-session memory validation.",
    ],
  };
  const manifestPath = join(root, "fixture-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return { projectPath, manifestPath };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        "Usage: pnpm exec tsx scripts/native-benchmark/create-fixture.ts <fresh-directory>",
      );
    const result = await createNativeBenchmarkFixture(process.argv[2]!);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
