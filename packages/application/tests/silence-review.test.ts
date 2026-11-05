// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from "vitest";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";
import {
  hashFile,
  runProcess,
  type AudioActivityOptions,
} from "@openfilm/media";
import type { TimelineCommand } from "@openfilm/solver";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import type {
  SilenceReviewEnvelope,
  SilenceReviewOptions,
} from "../src/silence.js";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
const roots: string[] = [];
const applications = new Set<OpenFilmApplication>();
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications) app.close();
  applications.clear();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function wave(quiet = true): Buffer {
  const rate = 48000,
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
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const sample =
      quiet && t >= 1 && t < 2
        ? 0
        : Math.round(12000 * Math.sin(2 * Math.PI * 440 * t));
    bytes.writeInt16LE(sample, 44 + i * 2);
  }
  return bytes;
}
async function fixture(quiet = true) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-silence-review-"));
  roots.push(root);
  const source = join(root, "voice.wav");
  await writeFile(source, wave(quiet));
  const sourceHash = await hashFile(source);
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Silence review");
  applications.add(app);
  app.project.settings = { width: 320, height: 180, frameRate: 25 };
  const asset: MediaAsset = {
    id: "voice",
    name: "voice.wav",
    uri: pathToFileURL(source).href,
    contentHash: sourceHash,
    mediaType: "audio",
    duration: 4,
    tags: [],
    state: {},
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  app.project.stories.push({
    id: "story",
    title: "A reviewed source",
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
  const editor = new TimelineEditor(app);
  return {
    root,
    directory,
    source,
    sourceHash,
    asset,
    app,
    editor,
    before: editor.get("timeline"),
  };
}
const reviewPath = (directory: string, reviewId: string) =>
  join(directory, "analysis", "silence-reviews", reviewId + ".json");
const reviewedCommand = (review: SilenceReviewEnvelope): TimelineCommand => ({
  type: "silence.ripple",
  reviewId: review.reviewId,
  proposal: review.proposal,
});

it("persists an immutable exact review, applies after reopening, shares undo/redo and preserves source bytes", async () => {
  const f = await fixture();
  const originalProject = await readFile(
    join(f.directory, "project.json"),
    "utf8",
  );
  const review = await f.app.silence.createProposal("timeline", "voice", {
    paddingSeconds: 0.1,
  });
  expect(review.reviewId).toMatch(/^[a-f0-9]{64}$/u);
  expect(review.proposal.evidence.sampleRate).toBe(48000);
  expect(review.proposal.evidence.parameters).toEqual({
    thresholdDb: -40,
    minimumSilenceSeconds: 0.5,
  });
  expect(review.proposal.evidence.silenceIntervals).toEqual([
    { start: 1, end: 2 },
  ]);
  expect(review.proposal.sourceHash).toBe(f.sourceHash);
  expect(review.proposal.totalDurationReduced).toBeCloseTo(0.8);
  expect(Object.isFrozen(review.proposal.evidence.silenceIntervals)).toBe(true);
  expect(f.editor.get("timeline")).toEqual(f.before);
  expect(await readFile(join(f.directory, "project.json"), "utf8")).toBe(
    originalProject,
  );
  const stored = JSON.parse(
    await readFile(reviewPath(f.directory, review.reviewId), "utf8"),
  );
  expect(stored).toEqual({
    version: 1,
    projectId: f.app.project.id,
    ...review,
  });
  expect(
    Buffer.byteLength(JSON.stringify(review, null, 2)),
  ).toBeLessThanOrEqual(1024 ** 2);
  const portable = JSON.parse(JSON.stringify(review)) as unknown;
  f.app.close();
  applications.delete(f.app);

  const reopened = await OpenFilmApplication.open(f.directory);
  applications.add(reopened);
  const editor = new TimelineEditor(reopened);
  const saved = await reopened.silence.apply(portable, {
    requestId: "accept-silence",
    editor,
  });
  expect(saved.canUndo).toBe(true);
  expect(saved.composition.duration).toBeCloseTo(3.2);
  expect(saved.composition.tracks[0]!.clips).toHaveLength(2);
  expect(
    (
      await reopened.silence.apply(portable, {
        requestId: "accept-silence",
        editor,
      })
    ).acknowledgedRevision,
  ).toBe(saved.revision);
  const undone = await editor.undo("timeline", saved.revision);
  expect(undone.composition).toEqual(f.before.composition);
  const redone = await editor.redo("timeline", undone.revision);
  expect(redone.composition).toEqual(saved.composition);
  expect(await hashFile(f.source)).toBe(f.sourceHash);
  reopened.close();
  applications.delete(reopened);
  const persisted = await OpenFilmApplication.open(f.directory);
  applications.add(persisted);
  expect(new TimelineEditor(persisted).get("timeline").composition).toEqual(
    saved.composition,
  );
});

it("creates a selection-only immutable Review without reanalyzing or replacing its source Review", async () => {
  const f = await fixture();
  const original = await f.app.silence.createProposal("timeline", "voice", {
    paddingSeconds: 0.1,
  });
  const analyze = vi.spyOn(f.app.silence, "analyzeAsset");
  const revised = await f.app.silence.createDerivedProposal(
    original.reviewId,
    {
      compositionId: "timeline",
      baseRevision: original.proposal.baseRevision,
      sourceHash: original.proposal.sourceHash,
    },
    [],
  );

  expect(analyze).not.toHaveBeenCalled();
  expect(revised.reviewId).not.toBe(original.reviewId);
  expect(revised.proposal.selectedCandidateIds).toEqual([]);
  expect(revised.proposal.timelineIntervals).toEqual([]);
  expect(await f.app.silence.readProposal(original.reviewId)).toEqual(original);
  expect(await f.app.silence.readProposal(revised.reviewId)).toEqual(revised);
  expect(f.editor.get("timeline").composition).toEqual(f.before.composition);
});

it("requires a durable review for generic direct and batch edits, while accepting one reviewed batch leaf", async () => {
  const f = await fixture();
  const review = await f.app.silence.createProposal("timeline", "voice", {
    paddingSeconds: 0.1,
  });
  const missing = {
    ...reviewedCommand(review),
    reviewId: "0".repeat(64),
  } as TimelineCommand;
  for (const commands of [
    [missing],
    [{ type: "batch", commands: [missing] }],
  ] as TimelineCommand[][]) {
    await expect(
      f.editor.edit("timeline", { baseRevision: f.before.revision, commands }),
    ).rejects.toMatchObject({ code: "request.notFound", status: 404 });
    expect(f.editor.get("timeline").composition).toEqual(f.before.composition);
  }
  await expect(
    f.editor.edit("timeline", {
      baseRevision: f.before.revision,
      commands: [
        {
          type: "batch",
          commands: [reviewedCommand(review), reviewedCommand(review)],
        },
      ],
    }),
  ).rejects.toThrow(/single|one/i);
  await expect(
    f.editor.edit("timeline", {
      baseRevision: f.before.revision,
      commands: [
        {
          type: "batch",
          commands: [{ type: "batch", commands: [reviewedCommand(review)] }],
        },
      ],
    }),
  ).rejects.toThrow(/nested batch/i);
  const saved = await f.editor.edit("timeline", {
    baseRevision: f.before.revision,
    commands: [
      {
        type: "batch",
        commands: [reviewedCommand(review)],
      },
    ],
  });
  expect(saved.composition.duration).toBeCloseTo(3.2);
});

it("rejects modified envelopes, modified stored payloads and cross-project review copies without editing", async () => {
  const f = await fixture();
  const review = await f.app.silence.createProposal("timeline", "voice", {
    paddingSeconds: 0.1,
  });
  const changed = structuredClone(review);
  changed.proposal.paddingSeconds = 0.2;
  await expect(f.app.silence.apply(changed)).rejects.toMatchObject({
    code: "analysis.resultStale",
    status: 409,
  });
  await expect(
    f.app.silence.apply({ ...review, approved: true }),
  ).rejects.toMatchObject({ code: "request.invalid" });
  const storedText = await readFile(
    reviewPath(f.directory, review.reviewId),
    "utf8",
  );
  const other = await fixture();
  const otherDir = join(other.directory, "analysis", "silence-reviews");
  await mkdir(otherDir, { recursive: true });
  await writeFile(reviewPath(other.directory, review.reviewId), storedText);
  await expect(other.app.silence.apply(review)).rejects.toMatchObject({
    code: "analysis.resultStale",
    status: 409,
  });
  const tampered = JSON.parse(storedText);
  tampered.proposal.paddingSeconds = 0.2;
  await writeFile(
    reviewPath(f.directory, review.reviewId),
    JSON.stringify(tampered),
  );
  await expect(f.app.silence.apply(review)).rejects.toMatchObject({
    code: "analysis.resultStale",
    status: 409,
  });
  expect(f.editor.get("timeline").composition).toEqual(f.before.composition);
  expect(other.editor.get("timeline").composition).toEqual(
    other.before.composition,
  );
});

it("refuses a missing record and stale timeline even when the reviewed payload is otherwise valid", async () => {
  const f = await fixture();
  const review = await f.app.silence.createProposal("timeline", "voice");
  const path = reviewPath(f.directory, review.reviewId);
  const text = await readFile(path);
  await rm(path);
  await expect(f.app.silence.apply(review)).rejects.toMatchObject({
    code: "request.notFound",
    status: 404,
  });
  await writeFile(path, text);
  f.app.project.timelines[0]!.tracks[0]!.clips[0]!.timelineDuration = 3.5;
  f.app.project.timelines[0]!.tracks[0]!.clips[0]!.sourceOut = 3.5;
  f.app.project.timelines[0]!.duration = 3.5;
  await f.app.save();
  const changed = f.editor.get("timeline").composition;
  await expect(f.app.silence.apply(review)).rejects.toMatchObject({
    code: "analysis.resultStale",
    status: 409,
  });
  expect(f.editor.get("timeline").composition).toEqual(changed);
});

it("checks actual current source bytes even for a same-size change with restored mtime", async () => {
  const f = await fixture();
  const review = await f.app.silence.createProposal("timeline", "voice");
  const before = await stat(f.source);
  await writeFile(f.source, wave(false));
  await utimes(f.source, before.atime, before.mtime);
  expect((await stat(f.source)).size).toBe(before.size);
  await expect(f.app.silence.apply(review)).rejects.toMatchObject({
    code: "source.changed",
    status: 409,
  });
  expect(f.editor.get("timeline").composition).toEqual(f.before.composition);
});

it("rechecks the verified source at final publication and rolls back an interrupted Apply", async () => {
  const f = await fixture();
  const review = await f.app.silence.createProposal("timeline", "voice");
  const originalManifest = await readFile(
    join(f.directory, "project.json"),
    "utf8",
  );
  const save = f.app.save.bind(f.app);
  vi.spyOn(f.app, "save").mockImplementationOnce(async (assertCurrent) => {
    await writeFile(f.source, wave(false));
    await save(assertCurrent);
  });
  await expect(
    f.app.silence.apply(review, { editor: f.editor }),
  ).rejects.toMatchObject({ code: "source.changed", status: 409 });
  expect(f.editor.get("timeline").composition).toEqual(f.before.composition);
  expect(await readFile(join(f.directory, "project.json"), "utf8")).toBe(
    originalManifest,
  );
});

it("uses one verified snapshot when the source is replaced after hashing and before decoding", async () => {
  const f = await fixture();
  let changed = false;
  const evidence = await f.app.silence.analyzeAsset("voice", {
    onProgress(progress) {
      if (progress === 0 && !changed) {
        changed = true;
        writeFileSync(f.source, wave(false));
      }
    },
  });
  expect(changed).toBe(true);
  expect(evidence.sourceHash).toBe(f.sourceHash);
  expect(evidence.silenceIntervals).toEqual([{ start: 1, end: 2 }]);
  expect(await hashFile(f.source)).not.toBe(evidence.sourceHash);
  await expect(
    f.app.silence.createProposal("timeline", "voice"),
  ).rejects.toMatchObject({ code: "source.changed", status: 409 });
});

it("does not publish a review when its timeline changes during analysis", async () => {
  const f = await fixture();
  let changed = false;
  await expect(
    f.app.silence.createProposal("timeline", "voice", {
      onProgress(progress) {
        if (progress === 0 && !changed) {
          changed = true;
          f.app.project.timelines[0]!.tracks[0]!.clips[0]!.timelineStart = 0.04;
          f.app.project.timelines[0]!.duration = 4.04;
        }
      },
    }),
  ).rejects.toMatchObject({ code: "analysis.resultStale", status: 409 });
  await expect(
    readdir(join(f.directory, "analysis", "silence-reviews")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("propagates durable publication failure, removes temporary files and allows a clean retry", async () => {
  const f = await fixture();
  vi.spyOn(filesystem, "link").mockRejectedValueOnce(
    Object.assign(new Error("review storage full"), { code: "ENOSPC" }),
  );
  await expect(
    f.app.silence.createProposal("timeline", "voice"),
  ).rejects.toMatchObject({ code: "ENOSPC" });
  expect(
    await readdir(join(f.directory, "analysis", "silence-reviews")),
  ).toEqual([]);
  expect(f.editor.get("timeline").composition).toEqual(f.before.composition);
  const review = await f.app.silence.createProposal("timeline", "voice");
  await expect(
    readFile(reviewPath(f.directory, review.reviewId), "utf8"),
  ).resolves.toContain(review.reviewId);
});

it("rejects malformed recorded hashes while accepting uppercase SHA-256 without changing the catalog", async () => {
  const f = await fixture();
  f.app.catalog.upsertAsset({ ...f.asset, contentHash: "invalid" });
  await expect(f.app.silence.analyzeAsset("voice")).rejects.toMatchObject({
    code: "request.invalid",
  });
  f.app.catalog.upsertAsset({
    ...f.asset,
    contentHash: f.sourceHash.toUpperCase(),
  });
  const review = await f.app.silence.createProposal("timeline", "voice");
  expect(review.proposal.sourceHash).toBe(f.sourceHash);
  expect(f.app.catalog.getAsset("voice")!.contentHash).toBe(
    f.sourceHash.toUpperCase(),
  );
  await expect(f.app.silence.apply(review)).resolves.toMatchObject({
    canUndo: true,
  });
});

it("validates options before work, supports cancellation and bounds source snapshot copies", async () => {
  const f = await fixture();
  const bad: AudioActivityOptions[] = [
    { thresholdDb: Number.NaN },
    { thresholdDb: -81 },
    { minimumSilenceSeconds: 0 },
    { thresholdDb: -40, unexpected: true } as AudioActivityOptions,
  ];
  for (const options of bad)
    await expect(
      f.app.silence.analyzeAsset("voice", options),
    ).rejects.toMatchObject({ code: "request.invalid" });
  await expect(
    f.app.silence.createProposal("timeline", "voice", { paddingSeconds: 3 }),
  ).rejects.toMatchObject({ code: "request.invalid" });
  await expect(
    f.app.silence.createProposal("timeline", "voice", {
      force: true,
    } as SilenceReviewOptions),
  ).rejects.toMatchObject({ code: "request.invalid" });
  const controller = new AbortController();
  await expect(
    f.app.silence.createProposal("timeline", "voice", {
      signal: controller.signal,
      onProgress(progress) {
        if (progress === 0) controller.abort();
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    readdir(join(f.directory, "analysis", "silence-reviews")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await truncate(f.source, 32 * 1024 ** 3 + 1);
  await expect(f.app.silence.analyzeAsset("voice")).rejects.toMatchObject({
    code: "request.tooLarge",
    status: 413,
  });
});

it("rejects unsupported sources and video without audio, and keeps zero-cut review explicitly non-applicable", async () => {
  const f = await fixture(false);
  const noCuts = await f.app.silence.createProposal("timeline", "voice");
  expect(noCuts.proposal.timelineIntervals).toEqual([]);
  await expect(f.app.silence.apply(noCuts)).rejects.toMatchObject({
    code: "request.invalid",
  });
  await expect(
    f.editor.edit("timeline", {
      baseRevision: f.before.revision,
      commands: [reviewedCommand(noCuts)],
    }),
  ).rejects.toMatchObject({ code: "request.invalid" });
  const video = join(f.root, "no-audio.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=16x16:d=1:r=1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  f.app.catalog.upsertAsset({
    ...f.asset,
    mediaType: "video",
    duration: 1,
    uri: pathToFileURL(video).href,
    contentHash: await hashFile(video),
  });
  await expect(f.app.silence.analyzeAsset("voice")).rejects.toMatchObject({
    code: "media.unsupported",
    status: 422,
  });
  f.app.catalog.upsertAsset({ ...f.asset, mediaType: "image" });
  await expect(f.app.silence.analyzeAsset("voice")).rejects.toMatchObject({
    code: "media.unsupported",
    status: 422,
  });
  expect(f.editor.get("timeline").composition).toEqual(f.before.composition);
});

it("refuses source and review-directory symlinks", async () => {
  const f = await fixture();
  const original = join(f.root, "original.wav");
  await copyFile(f.source, original);
  await rm(f.source);
  await symlink(original, f.source);
  await expect(f.app.silence.analyzeAsset("voice")).rejects.toMatchObject({
    code: "media.unsupported",
    status: 422,
  });
  await rm(f.source);
  await copyFile(original, f.source);
  const outside = join(f.root, "outside-reviews");
  await mkdir(outside);
  await symlink(
    outside,
    join(f.directory, "analysis", "silence-reviews"),
    "dir",
  );
  await expect(
    f.app.silence.createProposal("timeline", "voice"),
  ).rejects.toMatchObject({ code: "workspace.unavailable", status: 409 });
  expect(await readdir(outside)).toEqual([]);
});
