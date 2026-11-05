// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { createExportProfile } from "@openfilm/core";
import {
  TimelineEditor,
  type RecordAudioPreviewDescriptor,
} from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import { measureAudioOutput } from "@openfilm/render";
import { silenceAuditionFixture } from "../fixtures/silence-audition.js";
import {
  decodePolicyAudio,
  recordPolicyEvidence,
  spectralAmplitude,
} from "../fixtures/audio-policy.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(
  rate: 44100 | 48000,
  speed = 1,
  rightActiveDuringSilence = false,
) {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-silence-audition-media-"),
  );
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const f = await silenceAuditionFixture(
    root,
    rate,
    speed,
    rightActiveDuringSilence,
  );
  cleanup.push(() => f.app.close());
  return { root, ...f };
}
async function pcm(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  descriptor: RecordAudioPreviewDescriptor,
) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < descriptor.lengthSamples; offset += 192000)
    chunks.push(
      await app.recordAudioPreview.read(
        descriptor.id,
        offset,
        Math.min(192000, descriptor.lengthSamples - offset),
      ),
    );
  return Buffer.concat(chunks);
}
function samples(data: Buffer) {
  const values = new Float32Array(data.length / 3);
  for (let i = 0; i < values.length; i++)
    values[i] = data.readIntLE(i * 3, 3) / 8388608;
  return values;
}
async function reviewed(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await f.app.silenceJobs.create({
    projectId: f.app.project.id,
    requestId: "analyze",
    assetId: "voice",
    compositionId: "timeline",
    options: {
      thresholdDb: -40,
      minimumSilenceSeconds: 0.5,
      paddingSeconds: 0.1,
    },
  });
  await f.app.silenceJobs.run(created.job.id);
  return {
    jobId: created.job.id,
    ...(await f.app.silenceJobs.getReview(created.job.id)),
  };
}

it.each([
  { rate: 44100 as const, speed: 1 },
  { rate: 48000 as const, speed: 1.25 },
])(
  "renders mixed-rate stereo, reused/trimmed/speed source with music and B-roll, then matches accepted output ($rate Hz, $speed speed)",
  async ({ rate, speed }) => {
    const f = await fixture(rate, speed),
      r = await reviewed(f);
    const projectBefore = await readFile(join(f.app.directory, "project.json"));
    const sourceHashes = await Promise.all(
      f.assets.map((a) => hashFile(fileURLToPath(a.uri))),
    );
    const input = {
      reviewId: r.review.reviewId,
      proposal: r.review.proposal,
      requestId: "audition",
      windowSeconds: 0.25,
    };
    const preview = await f.app.silenceJobs.audition(r.jobId, input);
    expect(preview.parity).toBe("renderer");
    expect(preview.seams).toHaveLength(2);
    const before = await pcm(f.app, preview.before),
      after = await pcm(f.app, preview.after);
    expect(before.length / 6).toBe(Math.round(f.duration * 48000));
    expect(after.length / 6).toBe(before.length / 6 - preview.removedSamples);
    expect(await f.app.silenceJobs.audition(r.jobId, input)).toEqual(preview);
    expect(await readFile(join(f.app.directory, "project.json"))).toEqual(
      projectBefore,
    );
    expect(new TimelineEditor(f.app).get("timeline").canUndo).toBe(false);
    const beforeSamples = samples(before),
      afterSamples = samples(after);
    const originalRendered = await f.app.render("timeline", {
      audioOnly: true,
      exportProfile: createExportProfile({
        ratio: "16:9",
        width: 160,
        height: 90,
        frameRate: 25,
        format: "wav",
      }),
    });
    const originalWav = join(f.root, "before.wav");
    await copyFile(originalRendered, originalWav);
    const originalDecoded = (await decodePolicyAudio(originalWav)).samples;
    expect(originalDecoded.length).toBe(beforeSamples.length);
    let beforeMaximumError = 0;
    for (let i = 0; i < beforeSamples.length; i++)
      beforeMaximumError = Math.max(
        beforeMaximumError,
        Math.abs(originalDecoded[i]! - beforeSamples[i]!),
      );
    expect(beforeMaximumError).toBeLessThanOrEqual(2 / 2 ** 23);

    // Both stereo dialogue channels and the low music frequencies reach the authoritative mix.
    expect(spectralAmplitude(beforeSamples, 440, 0.2, 0.1)).toBeGreaterThan(
      0.15,
    );
    expect(spectralAmplitude(beforeSamples, 220, 0.2, 0.1)).toBeGreaterThan(
      0.015,
    );
    const right = Float32Array.from(
      beforeSamples,
      (_, i) => beforeSamples[i - (i % 2) + 1]!,
    );
    expect(spectralAmplitude(right, 660, 0.2, 0.1)).toBeGreaterThan(0.15);
    const seamMeasurements = preview.seams.map((seam, index) => {
      const removedBefore = preview.seams
        .slice(0, index)
        .reduce((n, s) => n + s.removedEndSample - s.removedStartSample, 0);
      const at = seam.removedStartSample - removedBefore;
      expect(seam.afterStartSample).toBe(Math.max(0, at - 12000));
      expect(seam.afterEndSample).toBe(
        Math.min(preview.after.lengthSamples, at + 12000),
      );
      return {
        sample: at,
        leftJump: Math.abs(afterSamples[at * 2]! - afterSamples[(at - 1) * 2]!),
        rightJump: Math.abs(
          afterSamples[at * 2 + 1]! - afterSamples[(at - 1) * 2 + 1]!,
        ),
      };
    });
    const accepted = await f.app.silenceJobs.apply(r.jobId, {
      reviewId: r.review.reviewId,
      proposal: r.review.proposal,
      requestId: "accept",
    });
    const actual = await f.app.recordAudioPreview.prepare(
      "timeline",
      accepted.edit.revision,
    );
    expect(actual.lengthSamples).toBe(preview.after.lengthSamples);
    expect(await pcm(f.app, actual)).toEqual(after);
    await expect(
      f.app.recordAudioPreview.read(preview.after.id, 0, 1),
    ).rejects.toMatchObject({ code: "analysis.resultStale", status: 409 });
    const finalRendered = await f.app.render("timeline", {
      audioOnly: true,
      exportProfile: createExportProfile({
        ratio: "16:9",
        width: 160,
        height: 90,
        frameRate: 25,
        format: "wav",
      }),
    });
    const finalWav = join(f.root, "after.wav");
    await copyFile(finalRendered, finalWav);
    const finalDecoded = (await decodePolicyAudio(finalWav)).samples;
    expect(finalDecoded.length).toBe(afterSamples.length);
    let maximumError = 0,
      peak = 0;
    for (let i = 0; i < afterSamples.length; i++) {
      maximumError = Math.max(
        maximumError,
        Math.abs(finalDecoded[i]! - afterSamples[i]!),
      );
      peak = Math.max(peak, Math.abs(afterSamples[i]!));
    }
    // Existing Record/renderer PCM precision contract, not a perceptual tolerance.
    expect(maximumError).toBeLessThanOrEqual(2 / 2 ** 23);
    const mp4 = await f.app.render("timeline");
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,start_time,duration,sample_rate:format=duration",
          "-of",
          "json",
          mp4,
        ])
      ).stdout.toString(),
    ) as {
      streams: {
        codec_type: string;
        start_time: string;
        duration: string;
        sample_rate?: string;
      }[];
    };
    const audio = probe.streams.find((s) => s.codec_type === "audio")!;
    expect(audio).toBeDefined();
    expect(Number(audio.start_time)).toBe(0);
    expect(Number(audio.sample_rate)).toBe(48000);
    expect(
      Math.abs(Number(audio.duration) * 48000 - actual.lengthSamples),
    ).toBeLessThanOrEqual(1);
    const measurement = await measureAudioOutput(mp4);
    const beforeWavMeasurement = await measureAudioOutput(originalWav);
    const afterWavMeasurement = await measureAudioOutput(finalWav);
    const prefix = `silence-audition-${rate}-${speed === 1 ? "reuse" : "trim-speed"}`;
    const outputs = await Promise.all(
      [
        { name: `${prefix}-before.wav`, path: originalWav },
        { name: `${prefix}-after.wav`, path: finalWav },
        { name: `${prefix}-after.mp4`, path: mp4 },
      ].map(async ({ name, path }) => {
        const sha256 = await hashFile(path);
        const directory = process.env.OPENFILM_AUDIO_EVIDENCE_DIR;
        if (directory) {
          await mkdir(directory, { recursive: true });
          await copyFile(path, join(directory, name));
        }
        return { name, sha256 };
      }),
    );
    await recordPolicyEvidence(
      `silence-audition-${rate}-${speed === 1 ? "reuse" : "trim-speed"}`,
      {
        outputs,
        sourceSampleRate: rate,
        outputSampleRate: 48000,
        sourceHashes,
        originalSamples: preview.before.lengthSamples,
        editedSamples: preview.after.lengthSamples,
        removedSamples: preview.removedSamples,
        pcmMaximumError: maximumError,
        beforePcmMaximumError: beforeMaximumError,
        peak,
        seamMeasurements,
        mp4Audio: audio,
        measurement,
        beforeWavMeasurement,
        afterWavMeasurement,
        perceptualReview:
          "manual-required; synthetic tones do not establish speech retention or listening quality",
      },
    );
    expect(
      await Promise.all(f.assets.map((a) => hashFile(fileURLToPath(a.uri)))),
    ).toEqual(sourceHashes);
  },
);

it("preserves a stereo interval when only the left channel is silent", async () => {
  const f = await fixture(44100, 1, true);
  const review = await f.app.silence.createProposal("timeline", "voice", {
    paddingSeconds: 0.1,
  });
  expect(review.proposal.evidence.silenceIntervals).toEqual([]);
  expect(review.proposal.timelineIntervals).toEqual([]);
  expect(review.proposal.totalDurationReduced).toBe(0);
});

it.each([
  { kind: "clip-lock", code: "timeline.lockedClipConflict" },
  { kind: "track-lock", code: "timeline.lockedClipConflict" },
  { kind: "source-lock", code: "timeline.lockedClipConflict" },
  { kind: "pin", code: "timeline.pinConflict" },
  { kind: "jl", code: "timeline.audioTimingConflict" },
  { kind: "short-fade", code: "timeline.audioAutomationConflict" },
  { kind: "long-fade", code: "timeline.audioAutomationConflict" },
  { kind: "envelope", code: "timeline.audioAutomationConflict" },
])(
  "fails closed before rendering a protected or unsupported measured cut ($kind)",
  async ({ kind, code }) => {
    const f = await fixture(48000),
      composition = f.app.project.timelines[0]!,
      track = composition.tracks[0]!,
      clip = track.clips[0]!;
    if (kind === "clip-lock") clip.locked = true;
    if (kind === "track-lock") track.locked = true;
    if (kind === "source-lock")
      f.app.catalog.upsertAsset({ ...f.voice, state: { locked: true } });
    if (kind === "pin") {
      f.app.project.schemaVersion = "1.1.0";
      clip.userOverrides = {
        version: 1,
        isUserPinned: true,
        lockedAttributes: ["inOutRange", "timing"],
      };
    }
    if (kind === "jl") {
      f.app.project.schemaVersion = "1.2.0";
      clip.audioTiming = {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 4800,
        sourceInSample: 0,
        sourceOutSample: 192000,
      };
    }
    if (kind === "short-fade" || kind === "long-fade")
      clip.audioAutomation = {
        version: 1,
        role: "dialogue",
        fadeIn: kind === "short-fade" ? 0.02 : 3,
        fadeOut: kind === "short-fade" ? 0.02 : 3,
      };
    if (kind === "envelope")
      clip.audioAutomation = {
        version: 1,
        role: "dialogue",
        points: [
          { time: 0, gain: 0.5 },
          { time: 4, gain: 1 },
        ],
      };
    await f.app.save();
    const project = await readFile(join(f.app.directory, "project.json"));
    await expect(
      f.app.silence.createProposal("timeline", "voice", {
        paddingSeconds: 0.1,
      }),
    ).rejects.toMatchObject({ code, status: 409 });
    expect(await readFile(join(f.app.directory, "project.json"))).toEqual(
      project,
    );
    expect(new TimelineEditor(f.app).get("timeline").canUndo).toBe(false);
  },
);

it.each(["failure", "cancel"] as const)(
  "cleans the real before-render cache after %s, preserves disk state and retries the reserved request",
  async (mode) => {
    const f = await fixture(48000),
      r = await reviewed(f),
      controller = new AbortController();
    const disk = await readFile(join(f.app.directory, "project.json"));
    const prepare = f.app.recordAudioPreview.prepare.bind(
      f.app.recordAudioPreview,
    );
    let before: RecordAudioPreviewDescriptor | undefined,
      calls = 0;
    const spy = vi
      .spyOn(f.app.recordAudioPreview, "prepare")
      .mockImplementation(async (...args) => {
        calls++;
        if (calls === 2) {
          if (mode === "cancel")
            controller.abort(
              new Error("Synthetic cancellation after before render"),
            );
          else
            throw Object.assign(new Error("Synthetic output write failure"), {
              code: "ENOSPC",
            });
        }
        const result = await prepare(...args);
        if (calls === 1) before = result;
        return result;
      });
    const input = {
      reviewId: r.review.reviewId,
      proposal: r.review.proposal,
      requestId: "cleanup",
      windowSeconds: 0.25,
    };
    await expect(
      f.app.silenceJobs.audition(r.jobId, input, controller.signal),
    ).rejects.toThrow(mode === "cancel" ? /cancelled/ : /output write failure/);
    expect(before).toBeDefined();
    await expect(
      f.app.recordAudioPreview.read(before!.id, 0, 1),
    ).rejects.toMatchObject({ code: "request.notFound" });
    expect(await readFile(join(f.app.directory, "project.json"))).toEqual(disk);
    await expect(
      f.app.silenceJobs.audition(r.jobId, { ...input, windowSeconds: 0.5 }),
    ).rejects.toMatchObject({ code: "analysis.resultStale", status: 409 });
    spy.mockRestore();
    const retry = await f.app.silenceJobs.audition(r.jobId, input);
    expect(retry.before.id).not.toBe(before!.id);
    expect(
      (await f.app.recordAudioPreview.read(retry.after.id, 0, 1)).length,
    ).toBe(6);
    expect(await readFile(join(f.app.directory, "project.json"))).toEqual(disk);
  },
);

it("coalesces simultaneous identical audition requests and rejects changed pending intent", async () => {
  const f = await fixture(48000),
    r = await reviewed(f);
  const prepare = f.app.recordAudioPreview.prepare.bind(
    f.app.recordAudioPreview,
  );
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const spy = vi
    .spyOn(f.app.recordAudioPreview, "prepare")
    .mockImplementation(async (...args) => {
      enter();
      await gate;
      return prepare(...args);
    });
  const input = {
    reviewId: r.review.reviewId,
    proposal: r.review.proposal,
    requestId: "parallel",
    windowSeconds: 0.25,
  };
  const first = f.app.silenceJobs.audition(r.jobId, input);
  await entered;
  const second = f.app.silenceJobs.audition(r.jobId, input);
  try {
    await expect(
      f.app.silenceJobs.audition(r.jobId, { ...input, windowSeconds: 0.5 }),
    ).rejects.toMatchObject({ code: "analysis.resultStale", status: 409 });
  } finally {
    release();
  }
  const [one, two] = await Promise.all([first, second]);
  expect(two).toEqual(one);
  expect(spy).toHaveBeenCalledTimes(2);
});
