// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationError, type Clip } from "@openfilm/core";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanups.splice(0).reverse()) await action();
});

describe("MicroPreviewService", () => {
  let app: OpenFilmApplication;
  const compositionId = "comp-1";

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-micro-preview-test-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    const projectDir = join(root, "MicroPreviewTest.openfilm");
    app = await OpenFilmApplication.create(
      projectDir,
      "Micro Preview Test Project",
      {
        projectContentLocale: "zh-TW",
      },
    );
    cleanups.push(async () => {
      app.close();
    });

    // Seed assets into catalog
    app.catalog.upsertAsset({
      id: "asset-1",
      uri: "file:///media/a.mp4",
      mediaType: "video",
      name: "Asset A",
      duration: 10,
      tags: [],
      state: { locked: false, favorite: false },
      metadata: {},
    });
    app.catalog.upsertAsset({
      id: "asset-2",
      uri: "file:///media/b.mp4",
      mediaType: "video",
      name: "Asset B",
      duration: 10,
      tags: [],
      state: { locked: false, favorite: false },
      metadata: {},
    });

    // Seed story
    app.project.stories.push({
      id: "story-1",
      title: "Story",
      beats: [
        { id: "b1", title: "Scene 1", targetDuration: 4 },
        { id: "b2", title: "Scene 2", targetDuration: 4 },
      ],
    });

    // Seed composition with two contiguous clips
    app.project.timelines.push({
      id: compositionId,
      storyId: "story-1",
      duration: 8.0,
      tracks: [
        {
          id: "track-1",
          type: "video",
          clips: [
            {
              id: "c1",
              assetId: "asset-1",
              beatId: "b1",
              timelineStart: 0,
              timelineDuration: 4.0,
              sourceIn: 0,
              sourceOut: 4.0,
            } as Clip,
            {
              id: "c2",
              assetId: "asset-2",
              beatId: "b2",
              timelineStart: 4.0,
              timelineDuration: 4.0,
              sourceIn: 0,
              sourceOut: 4.0,
            } as Clip,
          ],
        },
      ],
    });
  });

  it("creates ephemeral micro-preview proposal without modifying saved project", async () => {
    const proposal = await app.microPreview.previewAdjacentScenes("c2", {
      type: "dip-to-black",
      duration: 1.0,
    });

    expect(proposal).toBeDefined();
    expect(proposal.targetClipId).toBe("c2");
    expect(proposal.cutTime).toBe(4.0);
    expect(proposal.previewStart).toBe(2.0);
    expect(proposal.previewEnd).toBe(7.0);

    // Verify saved project remains completely untouched (no transition applied yet)
    const editor = new TimelineEditor(app);
    const clip = editor
      .get(compositionId)
      .composition.tracks[0]?.clips.find((c) => c.id === "c2");
    expect(clip?.transition).toBeUndefined();
  });

  it("seeks frames accurately within the micro-preview window", async () => {
    const proposal = await app.microPreview.previewAdjacentScenes("c2", {
      type: "dip-to-white",
      duration: 1.0,
    });

    // Seek at start of preview window (offset = 0 -> timeline 2.0s)
    const frame0 = await app.microPreview.seek(proposal.id, 0);
    expect(frame0.primary?.clip.id).toBe("c1");
    expect(frame0.transitionOverlay).toBeUndefined();

    // Seek at cut time (offset = 2.0s -> timeline 4.0s, transition start is 4.0s)
    // At delta = 0.5s into transition (offset = 2.5s -> timeline 4.5s)
    // Dip transition reaches 100% white at midpoint
    const midFrame = await app.microPreview.seek(proposal.id, 2.5);
    expect(midFrame.transitionOverlay?.color).toBe("white");
    expect(midFrame.transitionOverlay?.opacity).toBe(1.0);
  });

  it("applies candidate transition in a single atomic history step", async () => {
    const proposal = await app.microPreview.previewAdjacentScenes("c2", {
      type: "dip-to-black",
      duration: 1.0,
    });

    const editor = new TimelineEditor(app);
    await app.microPreview.apply(proposal.id, { editor });

    const updatedClip = editor
      .get(compositionId)
      .composition.tracks[0]?.clips.find((c) => c.id === "c2");
    expect(updatedClip?.transition).toEqual({
      type: "dip-to-black",
      duration: 1.0,
    });

    // A single undo returns it to cut
    const currentState = editor.get(compositionId);
    await editor.undo(compositionId, currentState.revision);
    const undoneClip = editor
      .get(compositionId)
      .composition.tracks[0]?.clips.find((c) => c.id === "c2");
    expect(undoneClip?.transition).toBeUndefined();
  });

  it("fails closed on stale proposal when project changes", async () => {
    const proposal = await app.microPreview.previewAdjacentScenes("c2", {
      type: "crossfade",
      duration: 0.5,
    });

    // Modify project timeline externally
    const editor = new TimelineEditor(app);
    const state = editor.get(compositionId);
    await editor.edit(compositionId, {
      baseRevision: state.revision,
      commands: [
        {
          type: "lock",
          clipId: "c1",
          locked: true,
        },
      ],
    });

    // Attempting to seek or apply the stale proposal should reject with 409
    await expect(app.microPreview.seek(proposal.id, 1.0)).rejects.toThrow(
      ApplicationError,
    );
    await expect(app.microPreview.apply(proposal.id)).rejects.toThrow(
      ApplicationError,
    );
  });

  it("cancels ephemeral proposal and frees cached proposals on project clear", async () => {
    const proposal = await app.microPreview.previewAdjacentScenes("c2", {
      type: "dip-to-black",
      duration: 1.0,
    });

    app.microPreview.cancel(proposal.id);

    await expect(app.microPreview.seek(proposal.id, 1.0)).rejects.toThrow(
      ApplicationError,
    );

    // Recreate and test clear
    const p2 = await app.microPreview.previewAdjacentScenes("c2", {
      type: "dip-to-white",
      duration: 1.0,
    });
    app.microPreview.clear();
    await expect(app.microPreview.seek(p2.id, 1.0)).rejects.toThrow(
      ApplicationError,
    );
  });
});
