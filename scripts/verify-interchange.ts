import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  readdir,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportTimeline, otioCompatibilityReport } from "@openfilm/exporters";
import { hashFile, inspectMedia } from "@openfilm/media";
import {
  createExportProfile,
  frameAlignedDuration,
  resolveProjectTimebase,
  sequenceTimeAt,
  type Composition,
  type MediaAsset,
  type ProjectSettings,
} from "@openfilm/core";
import { FFmpegRenderer } from "@openfilm/render";
import { generateSampleMedia } from "../fixtures/sample-media/generate.mjs";

const execute = promisify(execFile);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && !process.argv[outputIndex + 1])
  throw new Error("--output requires an empty artifact directory.");
const keep = outputIndex >= 0;
const directory = keep
  ? resolve(process.argv[outputIndex + 1]!)
  : await mkdtemp(join(tmpdir(), "openfilm-interchange-"));
if (keep) {
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length)
    throw new Error(
      "Interchange artifact directory must be empty to avoid overwriting existing files.",
    );
}
const python =
  process.env.OPENFILM_OTIO_PYTHON ??
  (process.platform === "win32" ? "python" : "python3");
const verifier = fileURLToPath(
  new URL("../tests/interchange/resolve/verify.py", import.meta.url),
);
const workstationRunner = fileURLToPath(
  new URL("./resolve-qa/resolve_qa.py", import.meta.url),
);

// These clocks place one white frame and a 50 ms, 1 kHz cosine burst in a
// synchronized video-only MP4 / lossless WAV pair. Keeping source audio in WAV
// lets the PCM assertion distinguish renderer timing from AAC priming/ringing.
const syncCases = {
  "sync-30": {
    rateNumerator: 30,
    rateDenominator: 1,
    sourceVideoAssetId: "sync-30-video",
    sourceAudioAssetId: "sync-30-audio",
    sourceMarkerFrame: 30,
    sourceMarkerSample: 48000,
    trimInFrame: 12,
    placementFrame: 24,
    recordMarkerFrame: 42,
    recordMarkerSample: 67200,
    sourceFrameCount: 120,
    durationFrames: 120,
    clipFrames: 90,
    markerSamples: 2400,
    sampleRate: 48000,
    renderedVideo: "sync-30.mp4",
    fullMix: "sync-30.wav",
    aacUncertaintySamples: 1024,
  },
  "sync-fractional": {
    rateNumerator: 30000,
    rateDenominator: 1001,
    sourceVideoAssetId: "sync-fractional-video",
    sourceAudioAssetId: "sync-fractional-audio",
    sourceMarkerFrame: 30,
    sourceMarkerSample: 48048,
    trimInFrame: 10,
    placementFrame: 15,
    recordMarkerFrame: 35,
    recordMarkerSample: 56056,
    sourceFrameCount: 120,
    durationFrames: 120,
    clipFrames: 90,
    markerSamples: 2400,
    sampleRate: 48000,
    renderedVideo: "sync-fractional.mp4",
    fullMix: "sync-fractional.wav",
    aacUncertaintySamples: 1024,
  },
};

async function syncFixture(
  name: string,
  reference: (typeof syncCases)[keyof typeof syncCases],
  mediaDirectory: string,
) {
  const timebase = resolveProjectTimebase({
    width: 160,
    height: 90,
    frameRate: reference.rateNumerator / reference.rateDenominator,
  });
  const settings: ProjectSettings = {
    width: 160,
    height: 90,
    frameRate: reference.rateNumerator / reference.rateDenominator,
    timebase,
  };
  const secondsAt = (frame: number) => sequenceTimeAt(frame, timebase);
  // Convert absolute rational positions once. A 30000/1001 frame is 1601.6
  // samples; rounding that per frame would drift. Chosen endpoints are integral.
  const samplesAt = (frame: number) => {
    const samples =
      (frame * timebase.rateDenominator * reference.sampleRate) /
      timebase.rateNumerator;
    if (!Number.isSafeInteger(samples))
      throw new Error(
        `Sync fixture endpoint is not an integral sample: ${frame}`,
      );
    return samples;
  };
  const videoPath = join(mediaDirectory, `${name}-flash.mp4`);
  const audioPath = join(mediaDirectory, `${name}-tone.wav`);
  await execute("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=160x90:r=${reference.rateNumerator}/${reference.rateDenominator},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,${reference.sourceMarkerFrame})'`,
    "-frames:v",
    String(reference.sourceFrameCount),
    "-an",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    videoPath,
  ]);
  const sourceSamples = samplesAt(reference.sourceFrameCount);
  const pcm = Buffer.alloc(sourceSamples * 2 * 3);
  for (let sample = 0; sample < reference.markerSamples; sample++) {
    const value = Math.round(
      0.25 * 8388607 * Math.cos((2 * Math.PI * 1000 * sample) / 48000),
    );
    for (let channel = 0; channel < 2; channel++)
      pcm.writeIntLE(
        value,
        ((samplesAt(reference.sourceMarkerFrame) + sample) * 2 + channel) * 3,
        3,
      );
  }
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(48000 * 2 * 3, 28);
  header.writeUInt16LE(2 * 3, 32);
  header.writeUInt16LE(24, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(audioPath, Buffer.concat([header, pcm]));
  const assets: MediaAsset[] = [];
  for (const [id, path] of [
    [reference.sourceVideoAssetId, videoPath],
    [reference.sourceAudioAssetId, audioPath],
  ] as const)
    assets.push({
      ...(await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: basename(path),
      })),
      id,
      contentHash: await hashFile(path),
    });
  const clip = {
    sourceIn: secondsAt(reference.trimInFrame),
    sourceOut: secondsAt(reference.trimInFrame + reference.clipFrames),
    timelineStart: secondsAt(reference.placementFrame),
    timelineDuration: secondsAt(reference.clipFrames),
  };
  // The same integral sample endpoint is exactly 4.004 seconds at 30000/1001.
  // Dividing frames by a floating rate yields 4.0040000000000004, which OTIO's
  // serializer shortens. Canonicalize the input, preserving strict metadata
  // equality, and verify it still uses the existing complete-frame contract.
  const duration = samplesAt(reference.durationFrames) / reference.sampleRate;
  if (
    Math.abs(frameAlignedDuration(duration, settings.frameRate) - duration) >
    1e-9
  )
    throw new Error(
      "Sync fixture duration is not an exact output frame endpoint.",
    );
  const composition: Composition = {
    id: `resolve-${name}-reference`,
    storyId: "reference-story",
    duration,
    tracks: [
      {
        id: `${name}-picture`,
        type: "video",
        clips: [
          {
            ...clip,
            id: `${name}-flash`,
            assetId: reference.sourceVideoAssetId,
          },
        ],
      },
      {
        id: `${name}-sound`,
        type: "audio",
        clips: [
          {
            ...clip,
            id: `${name}-tone`,
            assetId: reference.sourceAudioAssetId,
            audioTiming: {
              version: 1,
              sampleRate: 48000,
              timelineStartSample: samplesAt(reference.placementFrame),
              sourceInSample: samplesAt(reference.trimInFrame),
              sourceOutSample: samplesAt(
                reference.trimInFrame + reference.clipFrames,
              ),
            },
          },
        ],
      },
    ],
  };
  const renderer = new FFmpegRenderer();
  await renderer.render(
    composition,
    assets,
    join(directory, reference.renderedVideo),
    settings,
  );
  await renderer.render(
    composition,
    assets,
    join(directory, reference.fullMix),
    settings,
    {
      audioOnly: true,
      exportProfile: createExportProfile({
        ratio: "16:9",
        width: 160,
        height: 90,
        frameRate: settings.frameRate,
        format: "wav",
      }),
    },
  );
  return { composition, assets, settings };
}

try {
  const { stdout: harnessTests, stderr: harnessSummary } = await execute(
    python,
    [
      "-B",
      "-m",
      "unittest",
      "discover",
      "-s",
      fileURLToPath(new URL("../tests/interchange/resolve", import.meta.url)),
      "-p",
      "test_workstation.py",
    ],
  );
  process.stdout.write(harnessTests + harnessSummary);
  const mediaDirectory = join(directory, "media files");
  const generated = await generateSampleMedia(mediaDirectory);
  const videoPath = join(mediaDirectory, "motion #1 中文 &.mp4");
  await rename(generated[3]!, videoPath);
  const selected = [generated[0]!, generated[2]!, videoPath, generated[4]!];
  const ids = ["photo", "evening", "video", "audio"];
  const assets: MediaAsset[] = [];
  for (const [index, path] of selected.entries()) {
    const inspected = await inspectMedia({
      path,
      uri: pathToFileURL(path).href,
      name: basename(path),
    });
    assets.push({
      ...inspected,
      id: ids[index]!,
      contentHash: await hashFile(path),
    });
  }
  const cuts: Composition = {
    id: "resolve-cut-reference",
    storyId: "reference-story",
    duration: 12,
    tracks: [
      {
        id: "video-main",
        type: "video",
        clips: [
          {
            id: "still",
            assetId: "photo",
            beatId: "intro",
            sourceIn: 0,
            sourceOut: 3,
            timelineStart: 1,
            timelineDuration: 3,
          },
          {
            id: "trimmed-video",
            assetId: "video",
            beatId: "middle",
            sourceIn: 0.5,
            sourceOut: 2.5,
            timelineStart: 5,
            timelineDuration: 2,
          },
          {
            id: "closing-still",
            assetId: "evening",
            beatId: "end",
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 9,
            timelineDuration: 2,
          },
        ],
      },
      {
        id: "video-second",
        type: "video",
        clips: [
          {
            id: "second-video",
            assetId: "video",
            sourceIn: 0.25,
            sourceOut: 1.25,
            timelineStart: 2,
            timelineDuration: 1,
          },
        ],
      },
      {
        id: "dialogue",
        type: "audio",
        clips: [
          {
            id: "sound",
            assetId: "audio",
            sourceIn: 0.25,
            sourceOut: 1.25,
            timelineStart: 0.5,
            timelineDuration: 1,
          },
        ],
      },
      {
        id: "music",
        type: "music",
        clips: [
          {
            id: "music",
            assetId: "audio",
            sourceIn: 0.5,
            sourceOut: 2,
            timelineStart: 8,
            timelineDuration: 1.5,
          },
        ],
      },
    ],
  };
  const edited = structuredClone(cuts);
  edited.id = "resolve-edited-reference";
  Object.assign(edited.tracks[0]!.clips[0]!, {
    transform: { scale: 1.2, rotation: 5, x: 12, y: -8 },
    title: "A generated moment — 我们",
    layout: {
      version: 1,
      preset: "diptych",
      focalPoint: { x: 0.5, y: 0.5 },
      protectedRegion: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
      secondary: { assetId: "evening" },
      gap: 8,
    },
    motion: {
      version: 1,
      preset: "push-in",
      easing: "ease-in-out",
      from: { scale: 1, x: 0, y: 0 },
      to: { scale: 1.05, x: 2, y: -1 },
    },
    titleStyle: {
      version: 1,
      role: "scene-statement",
      fontFamily: "Noto Sans CJK TC",
      fontSize: 16,
      maxWidth: 280,
    },
    locked: true,
  });
  Object.assign(edited.tracks[0]!.clips[1]!, {
    timelineDuration: 1,
    transform: { speed: 2, volume: 0.5 },
    transition: { type: "crossfade", duration: 0.25 },
  });
  Object.assign(edited.tracks[1]!.clips[0]!, {
    sourceIn: 2.5,
    sourceOut: 3,
    transform: { speed: 0.5 },
  });
  edited.tracks[2]!.clips[0]!.transform = { volume: 0 };
  edited.tracks[3]!.timing = "overlay";
  edited.tracks[3]!.clips[0]!.audioAutomation = {
    version: 1,
    role: "music",
    fadeIn: 0.2,
    fadeOut: 0.3,
    points: [{ time: 0, gain: 0.8 }],
    ducking: [{ start: 0.25, end: 1.25, gain: 0.3, attack: 0.1, release: 0.1 }],
  };
  const compositions: Record<string, Composition> = {
    cuts,
    edited,
    fractional: {
      ...structuredClone(cuts),
      id: "resolve-fractional-reference",
    },
  };
  const settingsByComposition: Record<string, ProjectSettings> = {};
  for (const [name, reference] of Object.entries(syncCases)) {
    const fixture = await syncFixture(name, reference, mediaDirectory);
    compositions[name] = fixture.composition;
    settingsByComposition[name] = fixture.settings;
    assets.push(...fixture.assets);
  }
  for (const [name, composition] of Object.entries(compositions)) {
    const settings = settingsByComposition[name] ?? {
      width: 320,
      height: 180,
      frameRate: name === "fractional" ? 30000 / 1001 : 24,
    };
    settingsByComposition[name] = settings;
    const exported = exportTimeline("otio", composition, assets, settings);
    await writeFile(join(directory, `${name}.otio`), exported.content);
    await writeFile(
      join(directory, `${name}.otio.report.json`),
      JSON.stringify(otioCompatibilityReport(composition), null, 2) + "\n",
    );
  }
  await writeFile(
    join(directory, "cuts.fcpxml"),
    exportTimeline("fcpxml", cuts, assets, {
      width: 320,
      height: 180,
      frameRate: 24,
    }).content,
  );
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(
      {
        synthetic: true,
        license: "CC0-1.0",
        assets,
        compositions,
        settingsByComposition,
        syncCases,
        realResolveVerified: false,
      },
      null,
      2,
    ) + "\n",
  );
  const { stdout } = await execute(python, [verifier, directory]);
  process.stdout.write(stdout);
  // A parser-valid document must still fail the independent source-file gate.
  const offline = `${videoPath}.temporarily-offline`;
  await rename(videoPath, offline);
  try {
    let rejectedMissing = false;
    try {
      await execute(python, [verifier, directory]);
    } catch (error) {
      rejectedMissing = String((error as { stderr?: string }).stderr).includes(
        "missing source:",
      );
    }
    if (!rejectedMissing)
      throw new Error(
        "Missing source URL regression did not fail the interchange gate.",
      );
    process.stdout.write(
      "Missing source URL regression: rejected as expected.\n",
    );
  } finally {
    await rename(offline, videoPath);
  }
  for (const asset of assets)
    if ((await hashFile(fileURLToPath(asset.uri))) !== asset.contentHash)
      throw new Error(`Original source changed: ${asset.name}`);
  await writeFile(
    join(directory, "README.md"),
    "# Generated Resolve import reference\n\nThese CC0 procedural sources contain no private camera material.\n\nOpenTimelineIO official parser read/write/read, source hashes, source bounds, gaps, still holds, audio, multiple tracks and fractional rates passed. sync-30 and sync-fractional also passed complete source/render video and full mix PCM decoding: source flash frame30 becomes record42/sample67200 at30fps and record35/sample56056 at30000/1001fps. sync-evidence.json records exact PCM/visual observations and separate AAC observations with a declared one-AAC-LC-frame (1024 sample) uncertainty. DaVinci Resolve import and playback have not been run.\n\nStart with [WORKSTATION.md](WORKSTATION.md): copy this complete folder, run `python3 resolve_qa.py prepare` at the new location, then import its relocated cuts.otio. Preparation needs only standard-library Python 3.9+. A manual UI route supports installations without external scripting.\n\nOriginal OTIO URLs and sources are retained unchanged; preparation creates separate copies and validates SHA-256 identities. bundle.json records exact source and CI provenance. edited.otio preserves advanced edits in metadata ONLY. Read edited.otio.report.json and [the compatibility/manual QA guide](nle-compatibility.md) before recreating effects manually.\n",
  );
  await writeFile(
    join(directory, "nle-compatibility.md"),
    await readFile(new URL("../docs/nle-compatibility.md", import.meta.url)),
  );
  for (const name of ["resolve-workstation-qa.md", "resolve-qa-record.md"])
    await writeFile(
      join(directory, name),
      await readFile(new URL(`../docs/${name}`, import.meta.url)),
    );
  await writeFile(
    join(directory, "resolve_qa.py"),
    await readFile(workstationRunner),
  );
  await writeFile(
    join(directory, "WORKSTATION.md"),
    await readFile(new URL("./resolve-qa/WORKSTATION.md", import.meta.url)),
  );
  const [{ stdout: sha }, { stdout: dirtyFiles }] = await Promise.all([
    execute("git", ["rev-parse", "HEAD"]),
    execute("git", ["status", "--porcelain", "--untracked-files=all"]),
  ]);
  const portablePath = (path: string) =>
    relative(directory, path).split("\\").join("/");
  const inventory: { path: string; sha256: string }[] = [];
  for (const entry of await readdir(directory, { recursive: true })) {
    const path = join(directory, entry);
    // All generated bundle members are regular files or this one media folder.
    if (entry === "media files") continue;
    inventory.push({ path: portablePath(path), sha256: await hashFile(path) });
  }
  await writeFile(
    join(directory, "bundle.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "openfilm-resolve-qa",
        generatedAt: new Date().toISOString(),
        openfilm: {
          checkoutSha: sha.trim(),
          candidateSha: process.env.OPENFILM_QA_CANDIDATE_SHA ?? sha.trim(),
          dirtyFiles: dirtyFiles.trimEnd().split("\n").filter(Boolean),
          ci: {
            repository: process.env.GITHUB_REPOSITORY ?? null,
            runId: process.env.GITHUB_RUN_ID ?? null,
            sha: process.env.GITHUB_SHA ?? null,
          },
        },
        parserEvidence: JSON.parse(stdout.trim()),
        assets: assets.map((asset) => ({
          id: asset.id,
          originalUri: asset.uri,
          relativePath: portablePath(fileURLToPath(asset.uri)),
          sha256: asset.contentHash,
        })),
        fixtures: Object.keys(compositions).map((name) => ({
          name,
          path: `${name}.otio`,
          frameRate: settingsByComposition[name]!.frameRate,
        })),
        files: inventory,
        realResolveVerified: false,
      },
      null,
      2,
    ) + "\n",
  );
  // Exercise the portable stdlib preparation on the real parser-validated bundle.
  const { stdout: preparedOutput } = await execute(python, [
    workstationRunner,
    "prepare",
    "--bundle",
    directory,
  ]);
  const prepared = JSON.parse(preparedOutput).output as string;
  await rm(prepared, { recursive: true });
  process.stdout.write(
    "Workstation relocation and source hash gate: passed.\n",
  );
  if (keep) process.stdout.write(`Reviewable reference bundle: ${directory}\n`);
} finally {
  if (!keep) await rm(directory, { recursive: true, force: true });
}
