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
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportTimeline, otioCompatibilityReport } from "@openfilm/exporters";
import { hashFile, inspectMedia } from "@openfilm/media";
import type { Composition, MediaAsset } from "@openfilm/core";
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
const python = process.env.OPENFILM_OTIO_PYTHON ?? "python3";
const verifier = fileURLToPath(
  new URL("../tests/interchange/resolve/verify.py", import.meta.url),
);
try {
  const mediaDirectory = join(directory, "media files");
  const generated = await generateSampleMedia(mediaDirectory);
  const videoPath = join(mediaDirectory, "motion #1 中文.mp4");
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
  const compositions = {
    cuts,
    edited,
    fractional: {
      ...structuredClone(cuts),
      id: "resolve-fractional-reference",
    },
  };
  const settingsByComposition: Record<
    string,
    { width: number; height: number; frameRate: number }
  > = {};
  for (const [name, composition] of Object.entries(compositions)) {
    const settings = {
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
    "# Generated Resolve import reference\n\nThese CC0 procedural sources contain no private camera material.\n\nOpenTimelineIO official parser read/write/read, source hashes, source bounds, gaps, still holds, audio, multiple tracks and fractional rates passed. DaVinci Resolve import has not been run.\n\nStart with cuts.otio. edited.otio preserves advanced edits in metadata ONLY and contains unretimed cut excerpts, including a labeled gap for slow motion. Read edited.otio.report.json and [the compatibility/manual QA guide](nle-compatibility.md) before recreating effects manually.\n\nAbsolute file URLs point to this generated directory; relink the media files folder if this bundle moves to another computer.\n",
  );
  await writeFile(
    join(directory, "nle-compatibility.md"),
    await readFile(new URL("../docs/nle-compatibility.md", import.meta.url)),
  );
  if (keep) process.stdout.write(`Reviewable reference bundle: ${directory}\n`);
} finally {
  if (!keep) await rm(directory, { recursive: true, force: true });
}
