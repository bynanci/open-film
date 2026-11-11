// SPDX-License-Identifier: Apache-2.0
// Offline, opt-in application validation. No third-party fixtures enter CI.
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createExportProfile, type MediaAsset } from "@openfilm/core";
import {
  OpenFilmApplication,
  TimelineEditor,
  type RecordAudioPreviewDescriptor,
} from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import { measureAudioOutput } from "@openfilm/render";

const sources = [
  [
    "paddy-neary.opus",
    "42973f944af32809fe9f7446a7a745d64fe9fc3e51db521902563f7fa2946053",
  ],
  [
    "guitar.ogg",
    "d6ff6cafd3025db2e2215b32e3e7e6411fa08a8d2e0fca7c3353b5a4a82523a5",
  ],
] as const;
const options = {
  thresholdDb: -35,
  minimumSilenceSeconds: 0.3,
  paddingSeconds: 0.08,
};
const profile = (format: "mp4" | "wav") =>
  createExportProfile({
    ratio: "16:9",
    width: 160,
    height: 90,
    frameRate: 25,
    format,
  });
const mediaRoot = resolve(process.argv[2] ?? "");
const outputRoot = resolve(process.argv[3] ?? "");
assert(
  process.argv.length === 4,
  "Usage: tsx tests/manual/silence-real-media.ts MEDIA_DIRECTORY NEW_EXTERNAL_EVIDENCE_DIRECTORY",
);
for (const path of [mediaRoot, outputRoot]) {
  const fromCheckout = relative(process.cwd(), path);
  assert(
    fromCheckout.startsWith(".."),
    "Media and evidence must be outside the checkout",
  );
}
assert.equal(
  (
    await runProcess("git", ["status", "--porcelain", "--untracked-files=no"])
  ).stdout.toString(),
  "",
  "Commit tracked candidate changes before recording evidence",
);
await runProcess("git", [
  "ls-files",
  "--error-unmatch",
  "tests/manual/silence-real-media.ts",
]);
const candidate = (await runProcess("git", ["rev-parse", "HEAD"])).stdout
  .toString()
  .trim();
for (const [file, hash] of sources)
  assert.equal(
    await hashFile(join(mediaRoot, file)),
    hash,
    `Unapproved source bytes: ${file}`,
  );
await mkdir(outputRoot);
const results: Record<string, unknown> = {
  candidate,
  startedAt: new Date().toISOString(),
  options,
  tools: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ffmpeg: (await runProcess("ffmpeg", ["-version"])).stdout
      .toString()
      .split("\n")[0],
    ffprobe: (await runProcess("ffprobe", ["-version"])).stdout
      .toString()
      .split("\n")[0],
  },
  sources: sources.map(([name, sha256]) => ({ name, sha256 })),
  humanListening: "NOT PERFORMED",
  device: "No output device observed; Linux headless application services only",
  cases: [],
};
const saveResults = () =>
  writeFile(
    join(outputRoot, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
const commands: string[][] = [];
async function ffmpeg(args: string[]) {
  commands.push(["ffmpeg", ...args]);
  await runProcess("ffmpeg", ["-v", "error", "-nostdin", ...args]);
}
async function asset(
  name: string,
  duration: number,
  mediaType: "audio" | "video",
): Promise<MediaAsset> {
  const file = join(outputRoot, name);
  return {
    id: name,
    name,
    uri: pathToFileURL(file).href,
    contentHash: await hashFile(file),
    mediaType,
    duration,
    tags: [],
    state: {},
    metadata: {},
    ...(mediaType === "video"
      ? { dimensions: { width: 160, height: 90 }, frameRate: 25 }
      : {}),
  };
}
async function pcm(
  app: OpenFilmApplication,
  descriptor: RecordAudioPreviewDescriptor,
) {
  const chunks = [];
  for (let i = 0; i < descriptor.lengthSamples; i += 192000)
    chunks.push(
      await app.recordAudioPreview.read(
        descriptor.id,
        i,
        Math.min(192000, descriptor.lengthSamples - i),
      ),
    );
  return Buffer.concat(chunks);
}
async function decode(file: string) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "s24le",
      "-",
    ])
  ).stdout;
}
function compare(a: Buffer, b: Buffer) {
  assert.equal(a.length, b.length, "PCM lengths differ");
  let maximumError = 0,
    squared = 0;
  for (let i = 0; i < a.length; i += 3) {
    const error = (a.readIntLE(i, 3) - b.readIntLE(i, 3)) / 8388608;
    maximumError = Math.max(maximumError, Math.abs(error));
    squared += error * error;
  }
  return { maximumError, rmsError: Math.sqrt(squared / (a.length / 3)) };
}
async function wav(name: string, bytes: Buffer) {
  const raw = join(outputRoot, `${name}.s24le`),
    file = join(outputRoot, `${name}.wav`);
  await writeFile(raw, bytes);
  await ffmpeg([
    "-f",
    "s24le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    raw,
    "-c:a",
    "pcm_s24le",
    file,
  ]);
  return file;
}
async function rejectsCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(
    action,
    (error: unknown) => (error as { code?: string }).code === code,
  );
}

async function run() {
  // Documented excerpts, no added silence and no synthesized audio.
  await ffmpeg([
    "-ss",
    "30",
    "-i",
    join(mediaRoot, sources[0][0]),
    "-t",
    "24",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    join(outputRoot, "voice.wav"),
  ]);
  await ffmpeg([
    "-i",
    join(mediaRoot, sources[1][0]),
    "-t",
    "24",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    join(outputRoot, "music.wav"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x223344:s=160x90:r=25:d=24",
    "-c:v",
    "ffv1",
    "-threads",
    "1",
    join(outputRoot, "picture.mkv"),
  ]);
  const voice = await asset("voice.wav", 24, "audio"),
    music = await asset("music.wav", 24, "audio"),
    picture = await asset("picture.mkv", 24, "video");
  results.derived = [voice, music, picture].map(({ id, contentHash }) => ({
    name: id,
    sha256: contentHash,
  }));
  for (const mixed of [false, true]) {
    const name = mixed ? "mixed-reuse-speed" : "natural",
      duration = mixed ? 19.2 : 24;
    let app = await OpenFilmApplication.create(
      join(outputRoot, `${name}.openfilm`),
      `CC0 real-media ${name}`,
    );
    try {
      app.project.settings = { width: 160, height: 90, frameRate: 25 };
      app.project.stories = [
        { id: "story", title: "CC0 recorded sources", beats: [] },
      ];
      app.project.timelines = [
        {
          id: "timeline",
          storyId: "story",
          duration,
          tracks: [
            {
              id: "dialogue",
              type: "audio",
              clips: Array.from({ length: mixed ? 2 : 1 }, (_, i) => ({
                id: `voice-${i}`,
                assetId: voice.id,
                sourceIn: mixed ? 2 : 0,
                sourceOut: mixed ? 14 : 24,
                timelineStart: mixed ? i * 9.6 : 0,
                timelineDuration: mixed ? 9.6 : 24,
                ...(mixed
                  ? {
                      transform: { speed: 1.25 },
                      audioAutomation: {
                        version: 1 as const,
                        role: "dialogue" as const,
                        fadeIn: 0.2,
                        fadeOut: 0.2,
                        points: [
                          { time: 0, gain: 0.8 },
                          { time: 9.6, gain: 0.65 },
                        ],
                      },
                    }
                  : {}),
              })),
            },
            {
              id: "pictures",
              type: "video",
              clips: [
                {
                  id: "picture",
                  assetId: picture.id,
                  sourceIn: 0,
                  sourceOut: duration,
                  timelineStart: 0,
                  timelineDuration: duration,
                },
              ],
            },
            ...(mixed
              ? [
                  {
                    id: "music",
                    type: "music" as const,
                    timing: "overlay" as const,
                    clips: [
                      {
                        id: "music",
                        assetId: music.id,
                        sourceIn: 0,
                        sourceOut: duration,
                        timelineStart: 0,
                        timelineDuration: duration,
                        audioAutomation: {
                          version: 1 as const,
                          role: "music" as const,
                          fadeIn: 0.3,
                          fadeOut: 0.5,
                          points: [
                            { time: 0, gain: 0.12 },
                            { time: duration, gain: 0.08 },
                          ],
                          ducking: [
                            {
                              start: 1,
                              end: 17,
                              gain: 0.4,
                              attack: 0.2,
                              release: 0.3,
                            },
                          ],
                        },
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      ];
      for (const a of [voice, music, picture]) app.catalog.upsertAsset(a);
      await app.save();
      const editor = new TimelineEditor(app),
        original = structuredClone(editor.get("timeline").composition);
      // Same real source, policy protection checked without speculative mutation.
      const protections = [];
      for (const kind of ["clip", "track", "source", "pin", "jl"]) {
        app.project.timelines[0] = structuredClone(original);
        const track = app.project.timelines[0]!.tracks[0]!,
          clip = track.clips[0]!;
        if (kind === "clip") clip.locked = true;
        if (kind === "track") track.locked = true;
        if (kind === "source")
          app.catalog.upsertAsset({ ...voice, state: { locked: true } });
        if (kind === "pin") {
          app.project.schemaVersion = "1.1.0";
          clip.userOverrides = {
            version: 1,
            isUserPinned: true,
            lockedAttributes: ["inOutRange", "timing"],
          };
        }
        if (kind === "jl") {
          app.project.schemaVersion = "1.2.0";
          clip.audioTiming = {
            version: 1,
            sampleRate: 48000,
            timelineStartSample: 4800,
            sourceInSample: Math.round(clip.sourceIn! * 48000),
            sourceOutSample: Math.round(clip.sourceOut! * 48000),
          };
        }
        await app.save();
        const disk = await readFile(join(app.directory, "project.json"));
        const code =
          kind === "pin"
            ? "timeline.pinConflict"
            : kind === "jl"
              ? "timeline.audioTimingConflict"
              : "timeline.lockedClipConflict";
        await rejectsCode(
          () => app.silence.createProposal("timeline", voice.id, options),
          code,
        );
        assert.deepEqual(
          await readFile(join(app.directory, "project.json")),
          disk,
        );
        protections.push({ kind, code });
        app.catalog.upsertAsset(voice);
      }
      app.project.timelines[0] = structuredClone(original);
      await app.save();
      const createInput = {
        projectId: app.project.id,
        assetId: voice.id,
        compositionId: "timeline",
        options,
      };
      await rejectsCode(
        () =>
          app.silenceJobs.create({
            ...createInput,
            projectId: "different-project",
            requestId: "wrong-project",
          }),
        "analysis.resultStale",
      );
      const cancelled = await app.silenceJobs.create({
        ...createInput,
        requestId: "cancelled",
      });
      await app.silenceJobs.cancel(cancelled.job.id);
      assert.equal(
        (await app.silenceJobs.run(cancelled.job.id)).status,
        "cancelled",
      );
      const created = await app.silenceJobs.create({
        ...createInput,
        requestId: "analyze",
      });
      assert.equal(
        (await app.silenceJobs.run(created.job.id)).status,
        "waiting-review",
      );
      const { review } = await app.silenceJobs.getReview(created.job.id);
      assert(
        review.proposal.timelineIntervals.length > 0,
        "Declared excerpt produced no measured cut",
      );
      await writeFile(
        join(outputRoot, `${name}-review.json`),
        JSON.stringify({ jobId: created.job.id, review }, null, 2) + "\n",
      );
      const disk = await readFile(join(app.directory, "project.json"));
      const audition = await app.silenceJobs.audition(created.job.id, {
        reviewId: review.reviewId,
        proposal: review.proposal,
        requestId: "audition",
        windowSeconds: 0.5,
      });
      assert.equal(audition.parity, "renderer");
      const before = await pcm(app, audition.before),
        after = await pcm(app, audition.after);
      assert.equal(
        before.length / 6 - after.length / 6,
        audition.removedSamples,
      );
      assert.deepEqual(
        await readFile(join(app.directory, "project.json")),
        disk,
      );
      assert.equal(editor.get("timeline").canUndo, false);
      const beforeWav = await wav(`${name}-before`, before),
        afterWav = await wav(`${name}-proposed`, after);
      const originalWav = await app.render("timeline", {
        audioOnly: true,
        exportProfile: profile("wav"),
      });
      const beforeParity = compare(before, await decode(originalWav));
      assert(beforeParity.maximumError <= 2 / 2 ** 23);
      const accepted = await app.silenceJobs.apply(created.job.id, {
        reviewId: review.reviewId,
        proposal: review.proposal,
        requestId: "accept",
      });
      const actual = await app.recordAudioPreview.prepare(
        "timeline",
        accepted.edit.revision,
      );
      assert.deepEqual(await pcm(app, actual), after);
      await rejectsCode(
        () => app.recordAudioPreview.read(audition.after.id, 0, 1),
        "analysis.resultStale",
      );
      const actualWav = join(outputRoot, `${name}-accepted.wav`);
      await copyFile(
        await app.render("timeline", {
          audioOnly: true,
          exportProfile: profile("wav"),
        }),
        actualWav,
      );
      const wavParity = compare(after, await decode(actualWav));
      assert(wavParity.maximumError <= 2 / 2 ** 23);
      const mp4 = join(outputRoot, `${name}-accepted.mp4`);
      await copyFile(
        await app.render("timeline", { exportProfile: profile("mp4") }),
        mp4,
      );
      const probe = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            mp4,
          ])
        ).stdout.toString(),
      ) as {
        streams: {
          codec_type: string;
          codec_name: string;
          start_time: string;
          duration: string;
          sample_rate?: string;
          channels?: number;
        }[];
        format: { duration: string };
      };
      const audio = probe.streams.find(
        (stream) => stream.codec_type === "audio",
      )!;
      assert(audio);
      assert.equal(audio.codec_name, "aac");
      assert.equal(audio.channels, 2);
      assert.equal(Number(audio.sample_rate), 48000);
      assert.equal(Number(audio.start_time), 0);
      assert(Math.abs(Number(audio.duration) * 48000 - after.length / 6) <= 1);
      const aac = await decode(mp4),
        aacWav = await wav(`${name}-mp4-decode`, aac);
      // Compare common duration only; preserve actual padding as a separate measurement.
      const common = Math.min(aac.length, after.length);
      const aacError = compare(
        aac.subarray(0, common),
        after.subarray(0, common),
      );
      const packetText = (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_packets",
          "-of",
          "json",
          mp4,
        ])
      ).stdout.toString();
      await writeFile(join(outputRoot, `${name}-aac-packets.json`), packetText);
      const seams = audition.seams.map((seam, index) => {
        const at =
          seam.removedStartSample -
          audition.seams
            .slice(0, index)
            .reduce(
              (sum, s) => sum + s.removedEndSample - s.removedStartSample,
              0,
            );
        return {
          ...seam,
          acceptedSample: at,
          pcmChannelStep: [0, 1].map((channel) =>
            at > 0 && at < after.length / 6
              ? Math.abs(
                  after.readIntLE((at * 2 + channel) * 3, 3) -
                    after.readIntLE(((at - 1) * 2 + channel) * 3, 3),
                ) / 8388608
              : null,
          ),
        };
      });
      const undo = await editor.undo("timeline", accepted.edit.revision);
      assert.deepEqual(undo.composition, original);
      const redo = await editor.redo("timeline", undo.revision);
      assert.deepEqual(redo.composition, accepted.edit.composition);
      await app.save();
      const directory = app.directory;
      app.close();
      app = await OpenFilmApplication.open(directory);
      assert.deepEqual(
        new TimelineEditor(app).get("timeline").composition,
        accepted.edit.composition,
      );
      const reopened = await app.recordAudioPreview.prepare(
        "timeline",
        new TimelineEditor(app).get("timeline").revision,
      );
      assert.deepEqual(await pcm(app, reopened), after);
      const reopenedMp4 = join(outputRoot, `${name}-reopened.mp4`);
      await copyFile(
        await app.render("timeline", { exportProfile: profile("mp4") }),
        reopenedMp4,
      );
      assert.deepEqual(await decode(reopenedMp4), aac);
      await rejectsCode(
        () => app.recordAudioPreview.read(audition.after.id, 0, 1),
        "request.notFound",
      );
      for (const a of [voice, music, picture])
        assert.equal(await hashFile(fileURLToPath(a.uri)), a.contentHash);
      const outputs = await Promise.all(
        [beforeWav, afterWav, actualWav, mp4, aacWav, reopenedMp4].map(
          async (file) => ({
            name: relative(outputRoot, file),
            sha256: await hashFile(file),
          }),
        ),
      );
      const record = {
        name,
        duration,
        jobId: created.job.id,
        review,
        audition,
        protections,
        cancelledAnalysis: true,
        wrongProjectRejected: true,
        beforeParity,
        wavParity,
        beforeSamples: before.length / 6,
        afterSamples: after.length / 6,
        aacDecodedSamples: aac.length / 6,
        aacPaddingSamples: (aac.length - after.length) / 6,
        aacError,
        probe,
        seams,
        measurement: {
          before: await measureAudioOutput(beforeWav),
          proposed: await measureAudioOutput(afterWav),
          mp4: await measureAudioOutput(mp4),
        },
        history:
          "Accept/Undo/Redo/Save/cold Reopen: composition and accepted decode verified",
        outputs,
      };
      (results.cases as unknown[]).push(record);
      results.commands = commands;
      await saveResults();
      console.log(
        `${name}: ${before.length / 6} → ${after.length / 6} samples, ${seams.length} seams; objective assertions passed`,
      );
    } finally {
      app.close();
    }
  }
  for (const [file, hash] of sources)
    assert.equal(await hashFile(join(mediaRoot, file)), hash);
  results.status = "objective assertions passed; human/device gates OPEN";
  results.finishedAt = new Date().toISOString();
  await saveResults();
}
try {
  await run();
} catch (error) {
  results.status = "FAILED";
  results.failure = String(error);
  results.commands = commands;
  await saveResults();
  throw error;
}
