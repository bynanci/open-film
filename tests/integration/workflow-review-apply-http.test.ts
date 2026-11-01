import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import type {
  Composition,
  MediaAsset,
  Story,
  TranscriptSegment,
  CoverageProposal,
  TranscriptRippleProposal,
  SceneMicroPreviewProposal,
  ResolvedSequenceFrame,
  ContinuityReceipt,
} from "@openfilm/core";
import { startServer } from "../../apps/server/src/server.js";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

interface EditorState {
  composition: Composition;
  story: Story;
  assets: MediaAsset[];
  revision: string;
  acknowledgedRevision?: string;
  canUndo: boolean;
  canRedo: boolean;
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function openWorkflowServer() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-workflow-http-"));
  cleanup.push(() =>
    rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  );
  await generateSampleMedia(root);
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(
    directory,
    "Workflow review and apply",
  );
  app.project.settings = { width: 320, height: 180, frameRate: 24 };

  for (const [id, name, mediaType, duration] of [
    ["photo-asset", "01-photo.png", "image", undefined],
    ["motion-asset", "04-motion.mp4", "video", 3],
  ] as const) {
    app.catalog.upsertAsset({
      id,
      name,
      uri: pathToFileURL(join(root, name)).href,
      mediaType,
      ...(duration !== undefined ? { duration } : {}),
      tags: [],
      state: {},
      metadata: {},
    });
  }

  // Seed verified transcript for motion-asset
  const segments: TranscriptSegment[] = [
    {
      id: "seg-1",
      start: 0,
      end: 1.5,
      text: "Introduction spoken here",
      words: [
        { text: "Introduction", start: 0, end: 0.7 },
        { text: "spoken", start: 0.7, end: 1.1 },
        { text: "here", start: 1.1, end: 1.5 },
      ],
    },
    {
      id: "seg-2",
      start: 1.5,
      end: 3.0,
      text: "Conclusion spoken here",
      words: [
        { text: "Conclusion", start: 1.5, end: 2.2 },
        { text: "spoken", start: 2.2, end: 2.6 },
        { text: "here", start: 2.6, end: 3.0 },
      ],
    },
  ];

  const motionSourceHash =
    await app.intelligence.sourceIdentity("motion-asset");
  app.catalog.intelligence.replaceTranscript({
    id: "initial-transcript",
    assetId: "motion-asset",
    language: "en",
    provenance: {
      providerId: "fixture",
      model: "test-model",
      version: "1",
      sourceHash: motionSourceHash,
      createdAt: new Date().toISOString(),
    },
    segments,
  });

  app.project.stories.push({
    id: "story",
    title: "A memory",
    targetDuration: 7,
    maxDuration: 10,
    beats: [
      {
        id: "beat",
        title: "The beginning",
        selectedAssetIds: ["photo-asset", "motion-asset"],
        candidateAssetIds: ["photo-asset", "motion-asset"],
      },
    ],
  });

  app.project.timelines.push({
    id: "composition",
    storyId: "story",
    duration: 7,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "photo",
            assetId: "photo-asset",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 7,
          },
        ],
      },
      {
        id: "overlay",
        type: "video",
        clips: [
          {
            id: "motion",
            assetId: "motion-asset",
            beatId: "beat",
            timelineStart: 2,
            timelineDuration: 3,
            sourceIn: 0,
            sourceOut: 3,
          },
        ],
      },
    ],
  });

  app.close();

  const runtime = await startServer({ port: 0, project: directory });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}`;

  const post = (path: string, data: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

  const state = async (): Promise<EditorState> => {
    const response = await fetch(`${base}/api/compositions/composition/editor`);
    expect(response.status).toBe(200);
    return response.json();
  };

  return { root, directory, base, post, state };
}

describe("review-and-apply workflows HTTP endpoints", () => {
  it("proposes, applies, and persists D3B2 A-roll and B-roll coverage with undo/redo and persistence", async () => {
    const { directory, post, state } = await openWorkflowServer();
    const initial = await state();

    // 1. Propose coverage
    const proposeRes = await post(
      "/api/compositions/composition/coverage/propose",
      {
        bRollClipId: "motion",
        primaryClipId: "photo",
        audioPolicy: { version: 1, mode: "keep-primary" },
      },
    );
    expect(proposeRes.status).toBe(200);
    const proposal = (await proposeRes.json()) as CoverageProposal;
    expect(proposal.primaryClipId).toBe("photo");
    expect(proposal.bRollClipId).toBe("motion");
    expect(proposal.role).toBe("b-roll-overlay");
    expect(proposal.audioPolicy.mode).toBe("keep-primary");

    // 2. Reject stale revision on apply
    const staleRes = await post(
      "/api/compositions/composition/coverage/apply",
      {
        baseRevision: "stale-revision-00000000000000000000000000000000",
        proposal,
      },
    );
    expect(staleRes.status).toBe(409);

    // 3. Apply coverage proposal cleanly
    const applyRes = await post(
      "/api/compositions/composition/coverage/apply",
      {
        baseRevision: initial.revision,
        proposal,
      },
    );
    expect(applyRes.status).toBe(200);
    const appliedState = (await applyRes.json()) as EditorState;
    expect(appliedState.revision).not.toBe(initial.revision);

    const primaryClip = appliedState.composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "photo")!;
    const bRollClip = appliedState.composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "motion")!;
    expect(primaryClip.coverage?.role).toBe("primary-narrative");
    expect(bRollClip.coverage?.role).toBe("b-roll-overlay");
    expect(bRollClip.coverage?.primaryClipId).toBe("photo");
    expect(appliedState.canUndo).toBe(true);

    // 4. Test Undo
    const undoRes = await post("/api/compositions/composition/undo", {
      baseRevision: appliedState.revision,
    });
    expect(undoRes.status).toBe(200);
    const undoneState = (await undoRes.json()) as EditorState;
    expect(
      undoneState.composition.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === "motion")!.coverage,
    ).toBeUndefined();

    // 5. Test Redo
    const redoRes = await post("/api/compositions/composition/redo", {
      baseRevision: undoneState.revision,
    });
    expect(redoRes.status).toBe(200);
    const redoneState = (await redoRes.json()) as EditorState;
    expect(
      redoneState.composition.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === "motion")!.coverage?.role,
    ).toBe("b-roll-overlay");

    // 6. Verify persistence across reopen
    const reopened = await OpenFilmApplication.open(directory);
    try {
      const savedTimeline = reopened.project.timelines.find(
        (t) => t.id === "composition",
      )!;
      const savedBRoll = savedTimeline.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === "motion")!;
      expect(savedBRoll.coverage?.role).toBe("b-roll-overlay");
      expect(savedBRoll.coverage?.primaryClipId).toBe("photo");
    } finally {
      reopened.close();
    }
  });

  it("proposes, applies, and undoes D4 transcript-driven ripple edits", async () => {
    const { post, state } = await openWorkflowServer();
    const initial = await state();

    // 1. Propose transcript ripple deleting seg-1
    const proposeRes = await post(
      "/api/compositions/composition/transcript/ripple-propose",
      {
        assetId: "motion-asset",
        mode: "delete",
        segmentIds: ["seg-1"],
      },
    );
    expect(proposeRes.status).toBe(200);
    const proposal = (await proposeRes.json()) as TranscriptRippleProposal;
    expect(proposal.mode).toBe("delete");
    expect(proposal.assetId).toBe("motion-asset");
    expect(proposal.totalDurationReduced).toBeCloseTo(1.5);
    expect(proposal.sourceIntervals.length).toBeGreaterThan(0);

    // 2. Reject stale base revision
    const staleRes = await post(
      "/api/compositions/composition/transcript/ripple-apply",
      {
        assetId: "motion-asset",
        baseRevision:
          "0000000000000000000000000000000000000000000000000000000000000000",
        mode: "delete",
        segmentIds: ["seg-1"],
      },
    );
    expect(staleRes.status).toBe(409);

    // 3. Apply transcript ripple
    const applyRes = await post(
      "/api/compositions/composition/transcript/ripple-apply",
      {
        assetId: "motion-asset",
        baseRevision: initial.revision,
        mode: "delete",
        segmentIds: ["seg-1"],
      },
    );
    expect(applyRes.status).toBe(200);
    const appliedState = (await applyRes.json()) as EditorState;
    expect(appliedState.revision).not.toBe(initial.revision);
    const motionClip = appliedState.composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "motion")!;
    // Motion duration decreased by 1.5s (from 3.0 to 1.5)
    expect(motionClip.timelineDuration).toBeCloseTo(1.5);

    // 4. Undo restores duration
    const undoRes = await post("/api/compositions/composition/undo", {
      baseRevision: appliedState.revision,
    });
    expect(undoRes.status).toBe(200);
    const undoneState = (await undoRes.json()) as EditorState;
    const restoredClip = undoneState.composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "motion")!;
    expect(restoredClip.timelineDuration).toBeCloseTo(3.0);
  });

  it("diagnoses, previews, and applies D2A continuity recommendations with receipt persistence", async () => {
    const { directory, post } = await openWorkflowServer();

    // 1. Propose continuity diagnostics
    const proposeRes = await post(
      "/api/compositions/composition/continuity/propose",
      {},
    );
    expect(proposeRes.status).toBe(200);
    const { proposal } = (await proposeRes.json()) as {
      proposal: {
        id: string;
        baseRevision: string;
        contextSignature: string;
        diagnostics: unknown[];
      };
    };
    expect(proposal.id).toBeDefined();
    expect(proposal.baseRevision).toBeDefined();
    expect(proposal.contextSignature).toBeDefined();

    // 2. Apply continuity overrides with receipt
    const requestId = "continuity-req-test-1";
    const applyRes = await post(
      "/api/compositions/composition/continuity/apply",
      {
        proposalId: proposal.id,
        requestId,
        baseRevision: proposal.baseRevision,
        contextSignature: proposal.contextSignature,
        overrides: [
          {
            diagnosticId: "advisory-user-note",
            action: "override",
            userNote: "Director checked emotional pacing.",
          },
        ],
      },
    );
    expect(applyRes.status).toBe(200);
    const applyResult = (await applyRes.json()) as {
      receipt: ContinuityReceipt;
    };
    expect(applyResult.receipt.requestId).toBe(requestId);
    expect(applyResult.receipt.proposalId).toBe(proposal.id);

    // 3. Idempotent retry with same requestId returns 200 with identical receipt
    const retryRes = await post(
      "/api/compositions/composition/continuity/apply",
      {
        proposalId: proposal.id,
        requestId,
        baseRevision: proposal.baseRevision,
        contextSignature: proposal.contextSignature,
        overrides: [
          {
            diagnosticId: "advisory-user-note",
            action: "override",
            userNote: "Director checked emotional pacing.",
          },
        ],
      },
    );
    expect(retryRes.status).toBe(200);
    const retryResult = (await retryRes.json()) as {
      receipt: ContinuityReceipt;
    };
    expect(retryResult.receipt.fingerprint).toBe(
      applyResult.receipt.fingerprint,
    );

    // 4. Verify receipt persisted on disk
    const reopened = await OpenFilmApplication.open(directory);
    try {
      expect(reopened.project.continuityReceipts?.length).toBe(1);
      expect(reopened.project.continuityReceipts![0]!.requestId).toBe(
        requestId,
      );
    } finally {
      reopened.close();
    }
  });

  it("handles D2B adjacent scene micro-preview generation, seeking, cancel, and apply", async () => {
    const { post, state } = await openWorkflowServer();
    const initial = await state();

    // 1. Generate micro-preview for motion clip transition
    const previewRes = await post(
      "/api/compositions/composition/micro-preview",
      {
        targetClipId: "motion",
        transition: { type: "crossfade", duration: 1.0 },
      },
    );
    expect(previewRes.status).toBe(200);
    const proposal = (await previewRes.json()) as SceneMicroPreviewProposal;
    expect(proposal.id).toBeDefined();
    expect(proposal.targetClipId).toBe("motion");
    expect(proposal.previewDuration).toBeGreaterThan(0);
    expect(proposal.previewStart).toBeLessThan(proposal.previewEnd);

    // 2. Seek frame inside micro-preview
    const seekRes = await post(
      `/api/micro-preview/${encodeURIComponent(proposal.id)}/seek`,
      {
        offsetSeconds: proposal.previewStart + 0.1,
        compositionId: "composition",
      },
    );
    expect(seekRes.status).toBe(200);
    const frame = (await seekRes.json()) as ResolvedSequenceFrame;
    expect(frame.frame).toBeDefined();
    expect(frame.visual.length).toBeGreaterThan(0);

    // 3. Cancel micro-preview
    const cancelRes = await post(
      `/api/micro-preview/${encodeURIComponent(proposal.id)}/cancel`,
      {},
    );
    expect(cancelRes.status).toBe(200);

    // After cancel, seeking fails with 409
    const seekAfterCancel = await post(
      `/api/micro-preview/${encodeURIComponent(proposal.id)}/seek`,
      {
        offsetSeconds: proposal.previewStart + 0.1,
      },
    );
    expect(seekAfterCancel.status).toBe(409);

    // 4. Generate new micro-preview and apply it
    const newPreviewRes = await post(
      "/api/compositions/composition/micro-preview",
      {
        targetClipId: "motion",
        transition: { type: "dip-to-black", duration: 0.5 },
      },
    );
    expect(newPreviewRes.status).toBe(200);
    const newProposal =
      (await newPreviewRes.json()) as SceneMicroPreviewProposal;

    const applyRes = await post(
      `/api/micro-preview/${encodeURIComponent(newProposal.id)}/apply`,
      {
        compositionId: "composition",
      },
    );
    expect(applyRes.status).toBe(200);
    const applyResult = (await applyRes.json()) as {
      ok: boolean;
      state?: EditorState;
    };
    expect(applyResult.ok).toBe(true);

    const latest = await state();
    expect(latest.revision).not.toBe(initial.revision);
    const motionClip = latest.composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "motion")!;
    expect(motionClip.transition?.type).toBe("dip-to-black");
    expect(motionClip.transition?.duration).toBe(0.5);
  });
});
