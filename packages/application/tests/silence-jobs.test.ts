import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";
import { hashFile } from "@openfilm/media";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const roots: string[] = [];
const applications = new Set<OpenFilmApplication>();

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications) app.close();
  applications.clear();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function wave(): Buffer {
  const rate = 48_000,
    samples = 4 * rate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const seconds = index / rate;
    const value =
      seconds >= 1 && seconds < 2
        ? 0
        : Math.round(12_000 * Math.sin((2 * Math.PI * 440 * index) / rate));
    bytes.writeInt16LE(value, 44 + index * 2);
  }
  return bytes;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-silence-jobs-"));
  roots.push(root);
  const source = join(root, "voice.wav");
  await writeFile(source, wave());
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Durable silence");
  applications.add(app);
  app.project.settings = { width: 320, height: 180, frameRate: 25 };
  const asset: MediaAsset = {
    id: "voice",
    name: "voice.wav",
    uri: pathToFileURL(source).href,
    contentHash: await hashFile(source),
    mediaType: "audio",
    duration: 4,
    tags: [],
    state: {},
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  app.project.stories.push({
    id: "story",
    title: "Voice story",
    targetDuration: 4,
    maxDuration: 8,
    beats: [
      {
        id: "beat",
        title: "Voice",
        selectedAssetIds: [asset.id],
        candidateAssetIds: [asset.id],
      },
    ],
  });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 4,
    tracks: [
      {
        id: "audio",
        type: "audio",
        clips: [
          {
            id: "voice-clip",
            assetId: asset.id,
            beatId: "beat",
            sourceIn: 0,
            sourceOut: 4,
            timelineStart: 0,
            timelineDuration: 4,
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, directory, source, editor: new TimelineEditor(app) };
}

const createInput = (app: OpenFilmApplication, requestId = "create-1") => ({
  projectId: app.project.id,
  requestId,
  assetId: "voice",
  compositionId: "timeline",
  options: {
    thresholdDb: -40,
    minimumSilenceSeconds: 0.5,
    paddingSeconds: 0.1,
  },
});

it("captures an immutable source/revision identity and reserves idempotently without editing", async () => {
  const f = await fixture();
  const before = f.editor.get("timeline");
  const first = await f.app.silenceJobs.create(createInput(f.app));
  expect(first.created).toBe(true);
  expect(first.job).toMatchObject({
    type: "silence-analysis",
    status: "queued",
    assetId: "voice",
    progress: 0,
    silenceAnalysis: {
      projectId: f.app.project.id,
      compositionId: "timeline",
      baseRevision: before.revision,
      requestId: "create-1",
      sourceHash: await hashFile(f.source),
      options: createInput(f.app).options,
      attempt: 1,
    },
  });
  expect(await f.app.silenceJobs.create(createInput(f.app))).toEqual({
    job: first.job,
    created: false,
  });
  expect(f.editor.get("timeline").composition).toEqual(before.composition);
  expect(f.app.catalog.listJobs()).toEqual([first.job]);
});

it("clears the shared TimelineEditor session history after replacing a project snapshot", async () => {
  const f = await fixture();
  const editor = f.app.timelineEditor;
  const before = editor.get("timeline");
  const edited = await editor.edit("timeline", {
    baseRevision: before.revision,
    commands: [{ type: "lock", clipId: "voice-clip", locked: true }],
  });
  expect(edited.canUndo).toBe(true);
  editor.resetSessionState();
  expect(editor.get("timeline")).toMatchObject({
    canUndo: false,
    composition: { tracks: [{ clips: [{ locked: true }] }] },
  });
});

it("runs the existing SilenceService into review, applies once, and replays after reopening", async () => {
  const f = await fixture();
  const before = f.editor.get("timeline");
  const { job: queued } = await f.app.silenceJobs.create(createInput(f.app));
  const reviewed = await f.app.silenceJobs.run(queued.id);
  expect(reviewed.status).toBe("waiting-review");
  expect(reviewed.silenceAnalysis?.reviewId).toMatch(/^[a-f0-9]{64}$/u);
  expect(reviewed.progress).toBe(1);
  expect(f.editor.get("timeline").composition).toEqual(before.composition);
  const review = await f.app.silenceJobs.getReview(queued.id);
  expect(review.review.reviewId).toBe(reviewed.silenceAnalysis!.reviewId);
  expect(review.review.proposal.sourceHash).toBe(
    reviewed.silenceAnalysis!.sourceHash,
  );

  const input = {
    reviewId: review.review.reviewId,
    proposal: review.review.proposal,
    requestId: "apply-1",
  };
  const accepted = await f.app.silenceJobs.apply(queued.id, input);
  expect(accepted.job.status).toBe("completed");
  expect(accepted.edit.composition.duration).toBeCloseTo(3.2);
  expect(accepted.edit.composition.tracks[0]!.clips).toHaveLength(2);
  expect(f.app.project.silenceApplyReceipts).toHaveLength(1);
  const undone = await f.app.timelineEditor.undo(
    "timeline",
    accepted.edit.revision,
  );
  expect(undone.composition.duration).toBe(4);
  expect(undone.composition.tracks[0]!.clips).toHaveLength(1);
  const redone = await f.app.timelineEditor.redo("timeline", undone.revision);
  expect(redone.composition).toEqual(accepted.edit.composition);

  f.app.close();
  applications.delete(f.app);
  const reopened = await OpenFilmApplication.open(f.directory);
  applications.add(reopened);
  const replay = await reopened.silenceJobs.apply(queued.id, input);
  expect(replay.job.status).toBe("completed");
  expect(replay.edit.acknowledgedRevision).toBe(accepted.edit.revision);
  expect(replay.edit.composition.tracks[0]!.clips).toHaveLength(2);
  expect(reopened.project.silenceApplyReceipts).toHaveLength(1);
  expect(await hashFile(f.source)).toBe(review.review.proposal.sourceHash);
});

it("durably maps clip-local automation through reviewed silence Apply, Undo/Redo and reopen", async () => {
  const f = await fixture(),
    timeline = f.app.project.timelines[0]!,
    sourceClip = timeline.tracks[0]!.clips[0]!;
  sourceClip.audioAutomation = {
    version: 1,
    role: "dialogue",
    fadeIn: 0.5,
    fadeOut: 1,
    points: [
      { time: 0, gain: 0.8 },
      { time: 2, gain: 0.5 },
      { time: 4, gain: 0.9 },
    ],
    ducking: [
      { start: 0.4, end: 2.5, gain: 0.4, attack: 0.5, release: 0.5 },
      { start: 1.8, end: 3.5, gain: 0.7, attack: 0.2, release: 0.5 },
    ],
  };
  await f.app.save();
  const before = f.editor.get("timeline"),
    sourceHash = await hashFile(f.source),
    { job } = await f.app.silenceJobs.create(createInput(f.app)),
    reviewed = await f.app.silenceJobs.run(job.id);
  expect(reviewed.status).toBe("waiting-review");
  const review = await f.app.silenceJobs.getReview(job.id),
    accepted = await f.app.silenceJobs.apply(job.id, {
      reviewId: review.review.reviewId,
      proposal: review.review.proposal,
      requestId: "automation-ripple-apply",
    });
  expect(accepted.edit.composition.tracks[0]!.clips).toHaveLength(2);
  expect(
    accepted.edit.composition.tracks[0]!.clips.map(
      (clip) => clip.audioAutomation,
    ),
  ).toMatchObject([
    {
      version: 2,
      fadeIn: 0.5,
      fadeOut: 1,
      points: sourceClip.audioAutomation.points,
      ducking: sourceClip.audioAutomation.ducking,
      timeMap: { offsetSamples: 0, durationSamples: 192_000 },
    },
    {
      version: 2,
      fadeIn: 0.5,
      fadeOut: 1,
      points: sourceClip.audioAutomation.points,
      ducking: sourceClip.audioAutomation.ducking,
      timeMap: {
        offsetSamples: Math.round(
          review.review.proposal.timelineIntervals[0]!.end * 48_000,
        ),
        durationSamples: 192_000,
      },
    },
  ]);
  expect(f.app.project.schemaVersion).toBe("1.3.0");
  expect(await hashFile(f.source)).toBe(sourceHash);
  const undone = await f.app.timelineEditor.undo(
    "timeline",
    accepted.edit.revision,
  );
  expect(undone.composition).toEqual(before.composition);
  const redone = await f.app.timelineEditor.redo("timeline", undone.revision);
  expect(redone.composition).toEqual(accepted.edit.composition);
  await f.app.save();
  f.app.close();
  applications.delete(f.app);
  const reopened = await OpenFilmApplication.open(f.directory);
  applications.add(reopened);
  expect(reopened.project.schemaVersion).toBe("1.3.0");
  expect(reopened.project.timelines[0]).toEqual(accepted.edit.composition);
  expect(await hashFile(f.source)).toBe(sourceHash);
});

it("creates a durable selection-only child Job without changing the parent Review", async () => {
  const f = await fixture();
  const created = await f.app.silenceJobs.create(createInput(f.app));
  const parent = await f.app.silenceJobs.run(created.job.id);
  const parentReview = await f.app.silenceJobs.getReview(parent.id);
  const request = {
    requestId: "selection-child-1",
    reviewId: parentReview.review.reviewId,
    selectedCandidateIds: [],
  };
  const derived = await f.app.silenceJobs.revise(parent.id, request);

  expect(derived.created).toBe(true);
  expect(derived.job).toMatchObject({
    type: "silence-analysis",
    status: "queued",
    silenceAnalysis: {
      parentJobId: parent.id,
      sourceReviewId: parentReview.review.reviewId,
      selectedCandidateIds: [],
    },
  });
  const waiting = await f.app.silenceJobs.run(derived.job.id);
  expect(waiting.status).toBe("waiting-review");
  const childReview = await f.app.silenceJobs.getReview(waiting.id);
  expect(childReview.review.reviewId).not.toBe(parentReview.review.reviewId);
  expect(childReview.review.proposal.selectedCandidateIds).toEqual([]);
  expect(childReview.review.proposal.timelineIntervals).toEqual([]);
  expect(await f.app.silenceJobs.getReview(parent.id)).toEqual(parentReview);
  await expect(
    f.app.silenceJobs.revise(parent.id, request),
  ).resolves.toMatchObject({
    created: false,
    job: { id: derived.job.id },
  });
});

it("keeps a durable Apply receipt when the Job acknowledgement fails and repairs it on exact replay", async () => {
  const f = await fixture();
  const { job } = await f.app.silenceJobs.create(createInput(f.app));
  await f.app.silenceJobs.run(job.id);
  const review = await f.app.silenceJobs.getReview(job.id);
  vi.spyOn(
    f.app.catalog.intelligence,
    "transitionOwnedSilenceJob",
  ).mockImplementationOnce(() => {
    throw new Error("simulated SQLite acknowledgement failure");
  });
  const input = {
    reviewId: review.review.reviewId,
    proposal: review.review.proposal,
    requestId: "apply-after-db-error",
  };
  await expect(f.app.silenceJobs.apply(job.id, input)).rejects.toThrow(
    "simulated SQLite acknowledgement failure",
  );
  expect(f.app.catalog.getJob(job.id)?.status).toBe("waiting-review");
  expect(f.app.project.silenceApplyReceipts).toHaveLength(1);

  f.app.close();
  applications.delete(f.app);
  const reopened = await OpenFilmApplication.open(f.directory);
  applications.add(reopened);
  const replay = await reopened.silenceJobs.apply(job.id, input);
  expect(replay.job.status).toBe("completed");
  expect(replay.edit.acknowledgedRevision).toBe(
    reopened.project.silenceApplyReceipts![0]!.appliedRevision,
  );
  expect(reopened.project.silenceApplyReceipts).toHaveLength(1);
  expect(replay.edit.composition.tracks[0]!.clips).toHaveLength(2);
});

it("rejects a stale Composition without reanalyzing and rejects changed Apply request reuse", async () => {
  const f = await fixture();
  const { job } = await f.app.silenceJobs.create(createInput(f.app));
  f.app.project.timelines[0]!.duration = 5;
  await f.app.save();
  const failed = await f.app.silenceJobs.run(job.id);
  expect(failed.status).toBe("failed");
  expect(failed.silenceAnalysis?.reviewId).toBeUndefined();

  const fresh = await f.app.silenceJobs.create(createInput(f.app, "create-2"));
  const waiting = await f.app.silenceJobs.run(fresh.job.id);
  expect(waiting.status).toBe("waiting-review");
  const review = await f.app.silenceJobs.getReview(fresh.job.id);
  const accepted = await f.app.silenceJobs.apply(fresh.job.id, {
    reviewId: review.review.reviewId,
    proposal: review.review.proposal,
    requestId: "same-apply-id",
  });
  await expect(
    f.app.silenceJobs.apply(fresh.job.id, {
      reviewId: review.review.reviewId,
      proposal: review.review.proposal,
      requestId: "same-apply-id",
    }),
  ).resolves.toMatchObject({ job: { status: "completed" } });
  await expect(
    f.app.silenceJobs.apply(fresh.job.id, {
      reviewId: "f".repeat(64),
      proposal: review.review.proposal,
      requestId: "same-apply-id",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(accepted.edit.composition.tracks[0]!.clips).toHaveLength(2);
});

it("persists a failed Job without a Review when a fractional ripple cannot preserve mapped samples", async () => {
  const f = await fixture(),
    composition = f.app.project.timelines[0]!,
    clip = composition.tracks[0]!.clips[0]!;
  composition.duration = 4 / 1.3;
  clip.timelineDuration = composition.duration;
  clip.transform = { speed: 1.3 };
  clip.audioAutomation = { version: 1, role: "dialogue", fadeIn: 0.5 };
  await f.app.save();
  const before = f.editor.get("timeline"),
    hash = await hashFile(f.source),
    { job } = await f.app.silenceJobs.create(
      createInput(f.app, "fractional-automation"),
    ),
    failed = await f.app.silenceJobs.run(job.id);
  expect(failed.status).toBe("failed");
  expect(failed.errors).toContainEqual(
    expect.objectContaining({ code: "timeline.audioAutomationConflict" }),
  );
  expect(failed.silenceAnalysis?.reviewId).toBeUndefined();
  await expect(f.app.silenceJobs.getReview(job.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(f.editor.get("timeline").composition).toEqual(before.composition);
  expect(await hashFile(f.source)).toBe(hash);
});

it("rejects changed source bytes against the reserved hash without silent recalculation", async () => {
  const f = await fixture();
  const { job } = await f.app.silenceJobs.create(createInput(f.app));
  await writeFile(f.source, wave().subarray(0, -2));
  const failed = await f.app.silenceJobs.run(job.id);
  expect(failed.status).toBe("failed");
  expect(failed.silenceAnalysis?.sourceHash).not.toBe(await hashFile(f.source));
  expect(failed.silenceAnalysis?.reviewId).toBeUndefined();
  expect(await f.app.silenceJobs.freshness(job.id)).toBe("stale");
  await expect(
    f.app.silenceJobs.retry(job.id, "retry-stale-source"),
  ).rejects.toMatchObject({
    status: 409,
  });
});

it.each(["locked", "pinned", "independently-timed"] as const)(
  "keeps the existing silence protection for %s clips through durable Jobs",
  async (protection) => {
    const f = await fixture();
    const timeline = f.app.project.timelines[0]!;
    const track = timeline.tracks[0]!;
    const clip = track.clips[0]!;
    const expectedCode =
      protection === "pinned"
        ? "timeline.pinConflict"
        : protection === "independently-timed"
          ? "timeline.audioTimingConflict"
          : "timeline.lockedClipConflict";
    if (protection === "locked") track.locked = true;
    if (protection === "pinned")
      clip.userOverrides = {
        version: 1,
        isUserPinned: true,
        lockedAttributes: ["inOutRange", "timing"],
      };
    if (protection === "independently-timed")
      clip.audioTiming = {
        version: 1,
        sampleRate: 48_000,
        timelineStartSample: 0,
        sourceInSample: 0,
        sourceOutSample: 192_000,
      };
    if (protection !== "locked") f.app.project.schemaVersion = "1.2.0";
    await f.app.save();
    const before = f.editor.get("timeline");
    const { job } = await f.app.silenceJobs.create(createInput(f.app));
    const failed = await f.app.silenceJobs.run(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.errors?.at(-1)?.code).toBe(expectedCode);
    expect(failed.silenceAnalysis?.reviewId).toBeUndefined();
    expect(f.editor.get("timeline").composition).toEqual(before.composition);
  },
);

it("cancels an owned running job and fences its late progress callback", async () => {
  const f = await fixture();
  const { job } = await f.app.silenceJobs.create(createInput(f.app));
  let lateProgress: ((progress: number) => void) | undefined;
  vi.spyOn(f.app.silence, "createBoundProposal").mockImplementation(
    async (_compositionId, _assetId, _identity, options) => {
      if (!options) throw new Error("Expected bound analysis options");
      lateProgress = options.onProgress;
      await new Promise((_, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(new Error("Aborted by test")),
          { once: true },
        );
      });
      throw new Error("Aborted by test");
    },
  );
  const running = f.app.silenceJobs.run(job.id);
  await vi.waitFor(() => expect(lateProgress).toBeTypeOf("function"));
  const cancelled = await f.app.silenceJobs.cancel(job.id);
  expect(cancelled.status).toBe("cancelled");
  expect((await running).status).toBe("cancelled");
  lateProgress?.(0.99);
  expect(f.app.catalog.getJob(job.id)?.status).toBe("cancelled");
});

it("retries a failed Job with a new owner and durable retry request identity", async () => {
  const f = await fixture();
  const { job } = await f.app.silenceJobs.create(createInput(f.app));
  vi.spyOn(f.app.silence, "createBoundProposal").mockRejectedValueOnce(
    new Error("synthetic decoder failure"),
  );
  expect((await f.app.silenceJobs.run(job.id)).status).toBe("failed");
  const first = await f.app.silenceJobs.retry(job.id, "retry-1");
  expect(first.created).toBe(true);
  expect(first.job.status).toBe("queued");
  expect(first.job.analysisOwner?.token).not.toBe(job.analysisOwner?.token);
  expect(first.job.silenceAnalysis?.attempt).toBe(2);
  expect(await f.app.silenceJobs.retry(job.id, "retry-1")).toEqual({
    job: first.job,
    created: false,
  });
  await expect(
    f.app.silenceJobs.retry(job.id, "retry-2"),
  ).rejects.toMatchObject({
    status: 409,
  });
});
