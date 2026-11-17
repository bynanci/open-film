// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyTimelineRippleIntervals,
  createExportProfile,
} from "@openfilm/core";
import {
  inspectRecordAudioWav,
  TimelineEditor,
  type RecordAudioPreviewDescriptor,
} from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import { measureAudioOutput } from "@openfilm/render";
import {
  silenceAuditionFixture,
  transientSilenceAuditionFixture,
} from "../fixtures/silence-audition.js";
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
async function reviewed(f: Pick<Awaited<ReturnType<typeof fixture>>, "app">) {
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

async function transientFixture(rate: 44100 | 48000) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-silence-transient-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const f = await transientSilenceAuditionFixture(root, rate);
  cleanup.push(() => f.app.close());
  return { root, ...f };
}

function channelPeak(
  data: Float32Array,
  start: number,
  end: number,
  channel: number,
) {
  let peak = 0;
  for (
    let frame = Math.round(start * 48000);
    frame < Math.round(end * 48000);
    frame++
  )
    peak = Math.max(peak, Math.abs(data[frame * 2 + channel]!));
  return peak;
}

async function wavPcm(path: string, expectedSamples: number) {
  const wav = await inspectRecordAudioWav(path, expectedSamples);
  const bytes = await readFile(path);
  return bytes.subarray(wav.dataOffset, wav.dataOffset + wav.dataBytes);
}

function maximumPcmErrorLsb(actual: Buffer, expected: Buffer) {
  expect(actual.length).toBe(expected.length);
  let error = 0;
  for (let offset = 0; offset < actual.length; offset += 3)
    error = Math.max(
      error,
      Math.abs(actual.readIntLE(offset, 3) - expected.readIntLE(offset, 3)),
    );
  return error;
}

it.each([
  { rate: 44100 as const, removedSourceSamples: 44100 },
  { rate: 48000 as const, removedSourceSamples: 48000 },
])(
  "keeps seeded transients and the active stereo channel, pads low-energy cuts, and preserves decaying music through audition/Accept ($rate Hz)",
  async ({ rate, removedSourceSamples }) => {
    const f = await transientFixture(rate);
    const initial = f.app.timelineEditor.get("timeline");
    const projectBefore = await readFile(join(f.app.directory, "project.json"));
    const sourceHashes = await Promise.all(
      f.assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
    );
    const voice = (await decodePolicyAudio(fileURLToPath(f.voice.uri))).samples;
    const music = (await decodePolicyAudio(fileURLToPath(f.music.uri))).samples;

    // The fixture is nonzero below-threshold room floor with a stronger breath
    // envelope, not digital zero. Active windows contain short decaying pulses.
    const floorPeak = channelPeak(voice, 0.52, 0.58, 0);
    const breathPeak = channelPeak(voice, 0.74, 0.84, 0);
    expect(floorPeak).toBeGreaterThan(0.001);
    expect(breathPeak).toBeGreaterThan(floorPeak * 1.5);
    expect(breathPeak).toBeLessThan(0.01);
    for (let window = 0; window < 250; window++) {
      const quiet =
        (window >= 25 && window < 65) ||
        (window >= 100 && window < 120) ||
        (window >= 150 && window < 200);
      for (const channel of [0, 1]) {
        const peak = channelPeak(
          voice,
          window / 50,
          (window + 1) / 50,
          channel,
        );
        const rightOnly = channel === 1 && window >= 180 && window < 185;
        if (quiet && !rightOnly) {
          expect(peak).toBeGreaterThan(0.0001);
          expect(peak).toBeLessThan(0.01);
        } else expect(peak).toBeGreaterThan(0.03);
      }
    }
    for (const [early, late] of [
      [0.62, 1.12],
      [3.12, 3.42],
    ] as const) {
      const first = spectralAmplitude(music, 220, early, 0.1);
      const last = spectralAmplitude(music, 220, late, 0.1);
      expect(last).toBeGreaterThan(0.01);
      expect(first).toBeGreaterThan(last * 1.5);
    }

    const r = await reviewed(f);
    const proposal = r.review.proposal;
    expect(proposal.evidence).toMatchObject({
      duration: 5,
      sampleRate: 48000,
      windowSeconds: 0.02,
      parameters: { thresholdDb: -40, minimumSilenceSeconds: 0.5 },
      silenceIntervals: [
        { start: 0.5, end: 1.3 },
        { start: 3, end: 3.6 },
      ],
    });
    expect(
      proposal.candidates.map((candidate) => candidate.sourceInterval),
    ).toEqual([
      { start: 0.5, end: 1.3 },
      { start: 3, end: 3.6 },
    ]);
    expect(proposal.sourceIntervals).toEqual([
      { start: 0.6, end: 1.2 },
      { start: 3.1, end: 3.5 },
    ]);
    expect(proposal.timelineIntervals).toEqual([
      { start: 0.6, end: 1.2 },
      { start: 3.1, end: 3.5 },
    ]);
    expect(proposal.totalDurationReduced).toBeCloseTo(1, 12);
    expect(
      proposal.sourceIntervals.reduce(
        (total, cut) =>
          total + Math.round(cut.end * rate) - Math.round(cut.start * rate),
        0,
      ),
    ).toBe(removedSourceSamples);
    expect(proposal.sourceHash).toBe(sourceHashes[0]);
    expect(f.app.timelineEditor.get("timeline")).toEqual(initial);

    const input = {
      reviewId: r.review.reviewId,
      proposal,
      requestId: "transient-audition",
      windowSeconds: 0.1,
    };
    const audition = await f.app.silenceJobs.audition(r.jobId, input);
    expect(audition.parity).toBe("renderer");
    expect(audition.before.lengthSamples).toBe(240000);
    expect(audition.after.lengthSamples).toBe(192000);
    expect(audition.removedSamples).toBe(48000);
    expect(audition.seams).toEqual([
      {
        beforeStartSample: 24000,
        beforeEndSample: 62400,
        afterStartSample: 24000,
        afterEndSample: 33600,
        removedStartSample: 28800,
        removedEndSample: 57600,
      },
      {
        beforeStartSample: 144000,
        beforeEndSample: 172800,
        afterStartSample: 115200,
        afterEndSample: 124800,
        removedStartSample: 148800,
        removedEndSample: 168000,
      },
    ]);
    const before = await pcm(f.app, audition.before);
    const after = await pcm(f.app, audition.after);
    // Original right-only activity at 3.6–3.7s must survive both cuts at
    // 2.6–2.7s. The overlay is silent here, so it cannot mask lost dialogue.
    // This is an energy/location assertion, not exact legacy DSP phase.
    const retainedEvent = {
      leftPeak: channelPeak(samples(after), 2.6, 2.7, 0),
      rightPeak: channelPeak(samples(after), 2.6, 2.7, 1),
    };
    expect(retainedEvent.leftPeak).toBeLessThan(0.01);
    expect(retainedEvent.rightPeak).toBeGreaterThan(0.03);
    expect(await f.app.silenceJobs.audition(r.jobId, input)).toEqual(audition);
    expect(await readFile(join(f.app.directory, "project.json"))).toEqual(
      projectBefore,
    );
    expect(f.app.timelineEditor.get("timeline")).toEqual(initial);

    // Overlay music retains its source clock across an internal ripple. Slicing
    // the already-mixed PCM would instead skip ahead in this decaying tail.
    const beforeTail = spectralAmplitude(samples(before), 220, 0.61, 0.04);
    const afterTail = spectralAmplitude(samples(after), 220, 0.61, 0.04);
    expect(beforeTail).toBeGreaterThan(0.025);
    expect(Math.abs(afterTail - beforeTail)).toBeLessThan(0.003);
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 30,
      format: "wav",
    });
    const beforeRender = await f.app.render("timeline", {
      audioOnly: true,
      exportProfile: profile,
    });
    const beforeWav = join(f.root, "transient-before.wav");
    await copyFile(beforeRender, beforeWav);
    const beforePcmErrorLsb = maximumPcmErrorLsb(
      await wavPcm(beforeWav, 240000),
      before,
    );
    expect(beforePcmErrorLsb).toBeLessThanOrEqual(2);

    const expected = applyTimelineRippleIntervals(initial.composition, [
      { start: 0.6, end: 1.2 },
      { start: 3.1, end: 3.5 },
    ]);
    const acceptInput = {
      reviewId: r.review.reviewId,
      proposal,
      requestId: "transient-accept",
    };
    const accepted = await f.app.silenceJobs.apply(r.jobId, acceptInput);
    expect(accepted.job.status).toBe("completed");
    expect(accepted.edit.composition).toEqual(expected);
    expect(accepted.edit.composition.duration).toBe(4);
    const dialogueClips = accepted.edit.composition.tracks.find(
      (track) => track.id === "dialogue",
    )!.clips;
    const retainedRanges = [
      { sourceIn: 0, sourceOut: 0.6, timelineStart: 0, timelineDuration: 0.6 },
      {
        sourceIn: 1.2,
        sourceOut: 3.1,
        timelineStart: 0.6,
        timelineDuration: 1.9,
      },
      {
        sourceIn: 3.5,
        sourceOut: 5,
        timelineStart: 2.5,
        timelineDuration: 1.5,
      },
    ];
    expect(dialogueClips).toHaveLength(3);
    for (const [index, range] of retainedRanges.entries()) {
      const actual = dialogueClips[index]!;
      expect(actual.assetId).toBe("voice");
      expect(actual.sourceIn).toBeCloseTo(range.sourceIn, 12);
      expect(actual.sourceOut).toBeCloseTo(range.sourceOut, 12);
      expect(actual.timelineStart).toBeCloseTo(range.timelineStart, 12);
      expect(actual.timelineDuration).toBeCloseTo(range.timelineDuration, 12);
    }
    const musicClips = accepted.edit.composition.tracks.find(
      (track) => track.id === "music",
    )!.clips;
    expect(musicClips).toHaveLength(1);
    expect(musicClips[0]).toMatchObject({
      id: "music-clip",
      sourceIn: 0,
      timelineStart: 0,
    });
    expect(musicClips[0]!.sourceOut).toBeCloseTo(4, 12);
    expect(musicClips[0]!.timelineDuration).toBeCloseTo(4, 12);
    const current = await f.app.recordAudioPreview.prepare(
      "timeline",
      accepted.edit.revision,
    );
    expect(current.lengthSamples).toBe(192000);
    expect(await pcm(f.app, current)).toEqual(after);
    const afterRender = await f.app.render("timeline", {
      audioOnly: true,
      exportProfile: profile,
    });
    const afterWav = join(f.root, "transient-after.wav");
    await copyFile(afterRender, afterWav);
    const afterPcmErrorLsb = maximumPcmErrorLsb(
      await wavPcm(afterWav, 192000),
      after,
    );
    // Same signed 24-bit renderer precision contract as the tone cases below.
    expect(afterPcmErrorLsb).toBeLessThanOrEqual(2);

    await f.app.silenceJobs.apply(r.jobId, acceptInput);
    expect(f.app.project.silenceApplyReceipts).toHaveLength(1);
    const undone = await f.app.timelineEditor.undo(
      "timeline",
      accepted.edit.revision,
    );
    expect(undone.composition).toEqual(initial.composition);
    expect(undone.canUndo).toBe(false);
    expect(undone.canRedo).toBe(true);
    const redone = await f.app.timelineEditor.redo("timeline", undone.revision);
    expect(redone.composition).toEqual(accepted.edit.composition);
    expect(
      await Promise.all(
        f.assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
      ),
    ).toEqual(sourceHashes);

    const prefix = `silence-audition-${rate}-transient-tail`;
    const outputs = await Promise.all(
      [
        { name: `${prefix}-before.wav`, path: beforeWav },
        { name: `${prefix}-after.wav`, path: afterWav },
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
    await recordPolicyEvidence(prefix, {
      outputs,
      seed: f.seed,
      sourceSampleRate: rate,
      outputSampleRate: 48000,
      sourceHashes,
      silenceIntervals: proposal.evidence.silenceIntervals,
      sourceIntervals: proposal.sourceIntervals,
      timelineIntervals: proposal.timelineIntervals,
      removedSourceSamples,
      removedRenderedSamples: audition.removedSamples,
      beforePcmErrorLsb,
      afterPcmErrorLsb,
      overlayTailAmplitude: { before: beforeTail, after: afterTail },
      retainedStereoEvent: { windowSeconds: [2.6, 2.7], ...retainedEvent },
      perceptualReview:
        "manual-required; synthetic transients, breath envelopes and music tails do not establish speech retention or listening quality",
    });
  },
);

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
])(
  "fails closed before rendering a protected or independently timed measured cut ($kind)",
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
