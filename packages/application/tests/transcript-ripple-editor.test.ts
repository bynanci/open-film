// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { hashFile } from "@openfilm/media";
import {
  OpenFilmApplication,
  TimelineEditor,
  TranscriptEditor,
} from "../src/index.js";

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanups.splice(0).reverse()) await action();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-transcript-ripple-app-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));

  const sourcePath = join(root, "interview.mp4");
  await writeFile(sourcePath, "mock media bytes for transcript ripple testing");
  const sourceHash = await hashFile(sourcePath);

  const directory = join(root, "film.openfilm");
  const runtime = { userDataDirectory: join(root, "user-data") };

  const app = await OpenFilmApplication.create(
    directory,
    "Transcript Ripple Test",
    {},
    runtime,
  );
  cleanups.push(() => app.close());

  app.catalog.upsertAsset({
    id: "asset-interview",
    uri: pathToFileURL(sourcePath).href,
    name: "interview.mp4",
    mediaType: "video",
    duration: 30,
    contentHash: sourceHash,
    tags: [],
    state: { favorite: true, locked: false },
    metadata: {},
  });

  app.catalog.intelligence.replaceTranscript({
    id: "transcript-doc",
    assetId: "asset-interview",
    language: "en",
    provenance: {
      providerId: "test-provider",
      version: "1",
      model: "fixture-model",
      sourceHash,
      createdAt: "2026-10-31T00:00:00Z",
    },
    segments: [
      {
        id: "seg-intro",
        start: 0,
        end: 5,
        text: "Welcome to our video presentation.",
        timingSource: "provider",
        alignmentState: "original",
      },
      {
        id: "seg-fluff",
        start: 5,
        end: 10,
        text: "Um, so, like, basically you know what I mean.",
        timingSource: "provider",
        alignmentState: "original",
      },
      {
        id: "seg-main",
        start: 10,
        end: 20,
        text: "Here is the key architectural design and demonstration.",
        timingSource: "provider",
        alignmentState: "original",
      },
      {
        id: "seg-estimated",
        start: 20,
        end: 25,
        text: "This part has estimated timestamps.",
        timingSource: "estimated",
        alignmentState: "original",
      },
    ],
  });

  const story = app.generateStory({
    title: "Interview Story",
    assetIds: ["asset-interview"],
    targetDuration: 25,
    maxDuration: 30,
  });
  app.compose(story.id);

  // Set up baseline composition with video clip, audio overlay, and caption track
  const timelineId = app.project.timelines[0]!.id;
  const comp = app.project.timelines[0]!;
  comp.duration = 20;
  comp.tracks = [
    {
      id: "v1",
      type: "video",
      clips: [
        {
          id: "clip-main",
          assetId: "asset-interview",
          timelineStart: 0,
          timelineDuration: 20,
          sourceIn: 0,
          sourceOut: 20,
        },
      ],
    },
    {
      id: "a-music",
      type: "audio",
      timing: "overlay",
      clips: [
        {
          id: "music-overlay",
          assetId: "asset-interview",
          timelineStart: 0,
          timelineDuration: 20,
          sourceIn: 0,
          sourceOut: 20,
        },
      ],
    },
  ];
  comp.captionTracks = [
    {
      version: 1,
      id: "cap-track",
      name: "Subtitles",
      language: "en",
      style: { version: 1, role: "subtitle" },
      cues: [
        {
          version: 1,
          id: "cue-intro",
          startMs: 0,
          endMs: 5000,
          text: "Welcome to our video presentation.",
          manualRevision: 0,
          source: { kind: "manual" },
        },
        {
          version: 1,
          id: "cue-fluff",
          startMs: 5000,
          endMs: 10000,
          text: "Um, so, like, basically you know what I mean.",
          manualRevision: 0,
          source: { kind: "manual" },
        },
        {
          version: 1,
          id: "cue-main",
          startMs: 10000,
          endMs: 20000,
          text: "Here is the key architectural design and demonstration.",
          manualRevision: 0,
          source: { kind: "manual" },
        },
      ],
    },
  ];

  await app.save();

  return {
    app,
    directory,
    runtime,
    timelineId,
  };
}

describe("Transcript Ripple Editor Integration (D4)", () => {
  it("creates proposal and executes atomic ripple delete across video, captions, audio with single undo/redo step", async () => {
    const { app, timelineId } = await fixture();
    const transcriptEditor = new TranscriptEditor(app);
    const timelineEditor = new TimelineEditor(app);

    const initial = timelineEditor.get(timelineId);

    // 1. Create ripple proposal to delete "seg-fluff" (5s to 10s)
    const proposal = await transcriptEditor.createRippleProposal(
      timelineId,
      "asset-interview",
      {
        mode: "delete",
        segmentIds: ["seg-fluff"],
      },
    );

    expect(proposal.version).toBe(1);
    expect(proposal.mode).toBe("delete");
    expect(proposal.totalDurationReduced).toBe(5);
    expect(proposal.timelineIntervals).toEqual([{ start: 5, end: 10 }]);

    // 2. Apply the ripple proposal
    const edited = await transcriptEditor.applyRipple(
      timelineId,
      "asset-interview",
      {
        baseRevision: initial.revision,
        mode: "delete",
        segmentIds: ["seg-fluff"],
        editor: timelineEditor,
      },
    );

    // Timeline duration reduced from 20 to 15
    expect(edited.composition.duration).toBe(15);
    expect(edited.canUndo).toBe(true);

    // Video clips split: 0-5s and 5-15s (source 10-20s)
    const videoClips = edited.composition.tracks[0]!.clips;
    expect(videoClips.length).toBe(2);
    expect(videoClips[0]!.timelineStart).toBe(0);
    expect(videoClips[0]!.timelineDuration).toBe(5);
    expect(videoClips[0]!.sourceIn).toBe(0);
    expect(videoClips[0]!.sourceOut).toBe(5);

    expect(videoClips[1]!.timelineStart).toBe(5);
    expect(videoClips[1]!.timelineDuration).toBe(10);
    expect(videoClips[1]!.sourceIn).toBe(10);
    expect(videoClips[1]!.sourceOut).toBe(20);

    // Caption cues: cue-fluff (5000-10000ms) deleted; cue-main shifted to 5000-15000ms
    const captionCues = edited.composition.captionTracks![0]!.cues;
    expect(captionCues.length).toBe(2);
    expect(captionCues[0]!.id).toBe("cue-intro");
    expect(captionCues[0]!.startMs).toBe(0);
    expect(captionCues[0]!.endMs).toBe(5000);

    expect(captionCues[1]!.id).toBe("cue-main");
    expect(captionCues[1]!.startMs).toBe(5000);
    expect(captionCues[1]!.endMs).toBe(15000);

    // Audio overlay trimmed to fit 15s
    const audioClips = edited.composition.tracks[1]!.clips;
    expect(audioClips[0]!.timelineDuration).toBe(15);

    // 3. Single Undo step reverts everything back to original 20s cut
    const undone = await timelineEditor.undo(timelineId, edited.revision);
    expect(undone.composition.duration).toBe(20);
    expect(undone.composition.tracks[0]!.clips.length).toBe(1);
    expect(undone.composition.captionTracks![0]!.cues.length).toBe(3);
    expect(undone.composition.captionTracks![0]!.cues[2]!.startMs).toBe(10000);
    expect(undone.canRedo).toBe(true);

    // 4. Redo restores the ripple cut
    const redone = await timelineEditor.redo(timelineId, undone.revision);
    expect(redone.composition.duration).toBe(15);
    expect(redone.composition.tracks[0]!.clips.length).toBe(2);
    expect(redone.composition.captionTracks![0]!.cues.length).toBe(2);
  });

  it("fails closed on estimated transcript timing and leaves timeline untouched", async () => {
    const { app, timelineId } = await fixture();
    const transcriptEditor = new TranscriptEditor(app);
    const timelineEditor = new TimelineEditor(app);

    const before = timelineEditor.get(timelineId);

    await expect(
      transcriptEditor.applyRipple(timelineId, "asset-interview", {
        baseRevision: before.revision,
        mode: "delete",
        segmentIds: ["seg-estimated"],
      }),
    ).rejects.toThrowError(/estimated timing/);

    const after = timelineEditor.get(timelineId);
    expect(after.composition.duration).toBe(before.composition.duration);
    expect(after.composition).toEqual(before.composition);
  });

  it("fails closed when media is locked", async () => {
    const { app, timelineId } = await fixture();
    const transcriptEditor = new TranscriptEditor(app);
    const timelineEditor = new TimelineEditor(app);

    const before = timelineEditor.get(timelineId);
    // Lock the main clip
    await timelineEditor.edit(timelineId, {
      baseRevision: before.revision,
      commands: [{ type: "lock", clipId: "clip-main", locked: true }],
    });

    const lockedState = timelineEditor.get(timelineId);

    await expect(
      transcriptEditor.applyRipple(timelineId, "asset-interview", {
        baseRevision: lockedState.revision,
        mode: "delete",
        segmentIds: ["seg-fluff"],
      }),
    ).rejects.toThrowError(/locked clip/);
  });
});
