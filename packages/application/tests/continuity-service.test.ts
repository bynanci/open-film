import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApplicationError,
  MAX_CONTINUITY_RECEIPTS,
  type Clip,
  type PhotoMotion,
} from "@openfilm/core";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()!();
  }
});

const panMotion: PhotoMotion = {
  version: 1,
  preset: "pan",
  easing: "linear",
  from: { scale: 1.1, x: -50, y: 0 },
  to: { scale: 1.1, x: 50, y: 0 },
};

async function setupApp() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-continuity-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));

  const projectDir = join(root, "ContinuityTest.openfilm");
  const app = await OpenFilmApplication.create(
    projectDir,
    "Continuity Test Project",
    {
      projectContentLocale: "zh-TW",
    },
  );
  cleanup.push(async () => {
    app.close();
  });

  // Seed catalog assets
  for (const id of ["asset-1", "asset-2", "asset-3"]) {
    app.catalog.upsertAsset({
      id,
      name: `${id}.jpg`,
      uri: pathToFileURL(join(root, `${id}.jpg`)).href,
      mediaType: "image",
      dimensions: { width: 1920, height: 1080 },
      contentHash: `sha256:${id}`,
      state: {},
      tags: [],
      metadata: {},
    });
  }

  // Seed story
  app.project.stories.push({
    id: "story-1",
    title: "Continuity Story",
    beats: [
      {
        id: "beat-1",
        title: "Beat 1 - Opening",
        intent: "Set out on the journey",
        script: { narration: "Starting", visualDirection: "Horizontal pan" },
        targetDuration: 4,
      },
      {
        id: "beat-2",
        title: "Beat 2 - Conflict",
        intent: "Defining moment of truth",
        script: { narration: "Conflict", visualDirection: "Horizontal pan" },
        targetDuration: 4,
      },
      {
        id: "beat-3",
        title: "Beat 3 - Resolution",
        intent: "Calm afterglow",
        script: { narration: "Ending", visualDirection: "Keep still" },
        targetDuration: 12,
      },
    ],
  });

  // Seed composition
  app.project.timelines.push({
    id: "comp-1",
    storyId: "story-1",
    duration: 16,
    tracks: [
      {
        id: "track-1",
        type: "video",
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            beatId: "beat-1",
            timelineStart: 0,
            timelineDuration: 2,
            motion: panMotion,
          } as Clip,
          {
            id: "clip-2",
            assetId: "asset-2",
            beatId: "beat-2",
            timelineStart: 2,
            timelineDuration: 2,
            motion: panMotion,
          } as Clip,
          {
            id: "clip-3",
            assetId: "asset-3",
            beatId: "beat-3",
            timelineStart: 4,
            timelineDuration: 12,
          } as Clip,
        ],
      },
    ],
  });

  await app.save();
  return { app, root, projectDir };
}

describe("ContinuityService Application Integration", () => {
  it("previews continuity proposals with typed diagnostics", async () => {
    const { app } = await setupApp();
    const { proposal } = app.continuity.previewProposal("story-1", "comp-1");

    expect(proposal.storyId).toBe("story-1");
    expect(proposal.compositionId).toBe("comp-1");
    expect(proposal.diagnostics.length).toBeGreaterThan(0);

    const missingReviews = proposal.diagnostics.filter(
      (d) => d.code === "continuity.missingShotLanguage",
    );
    expect(missingReviews.length).toBeGreaterThan(0);
    expect(missingReviews[0]!.severity).toBe("manual-review");
  });

  it("applies overrides, saves receipts and persists project", async () => {
    const { app, projectDir } = await setupApp();
    const { proposal } = app.continuity.previewProposal("story-1", "comp-1");
    const diag = proposal.diagnostics[0]!;

    const result = await app.continuity.applyOverrides("story-1", "comp-1", {
      proposalId: proposal.id,
      requestId: "req-1",
      baseRevision: proposal.baseRevision,
      contextSignature: proposal.contextSignature,
      overrides: [
        {
          diagnosticId: diag.id,
          action: "override",
          userNote: "Director reviewed and approved.",
        },
      ],
    });

    expect(result.receipt.requestId).toBe("req-1");
    expect(app.project.continuityReceipts).toHaveLength(1);
    expect(app.project.continuityReceipts![0]!.requestId).toBe("req-1");

    // Reopen app from disk and verify persistence
    const reloaded = await OpenFilmApplication.open(projectDir);
    try {
      expect(reloaded.project.continuityReceipts).toHaveLength(1);
      expect(reloaded.project.continuityReceipts![0]!.requestId).toBe("req-1");
      expect(
        reloaded.project.continuityReceipts![0]!.overrides[0]!.userNote,
      ).toBe("Director reviewed and approved.");
    } finally {
      reloaded.close();
    }
  });

  it("provides idempotent acknowledgment for duplicate request IDs", async () => {
    const { app } = await setupApp();
    const { proposal } = app.continuity.previewProposal("story-1", "comp-1");
    const diag = proposal.diagnostics[0]!;

    const input = {
      proposalId: proposal.id,
      requestId: "req-idempotent",
      baseRevision: proposal.baseRevision,
      contextSignature: proposal.contextSignature,
      overrides: [
        {
          diagnosticId: diag.id,
          action: "override" as const,
          userNote: "Reviewed.",
        },
      ],
    };

    const first = await app.continuity.applyOverrides(
      "story-1",
      "comp-1",
      input,
    );
    const second = await app.continuity.applyOverrides(
      "story-1",
      "comp-1",
      input,
    );

    expect(first.receipt.fingerprint).toBe(second.receipt.fingerprint);
    expect(app.project.continuityReceipts).toHaveLength(1);
  });

  it("rejects stale continuity proposals when story or timeline changes", async () => {
    const { app } = await setupApp();
    const { proposal } = app.continuity.previewProposal("story-1", "comp-1");
    const diag = proposal.diagnostics[0]!;

    // Alter timeline duration
    app.project.timelines[0]!.duration = 99;

    await expect(
      app.continuity.applyOverrides("story-1", "comp-1", {
        proposalId: proposal.id,
        requestId: "req-stale",
        baseRevision: proposal.baseRevision,
        contextSignature: proposal.contextSignature,
        overrides: [{ diagnosticId: diag.id, action: "override" }],
      }),
    ).rejects.toThrow(ApplicationError);
  });

  it("enforces MAX_CONTINUITY_RECEIPTS and fails closed", async () => {
    const { app } = await setupApp();
    const { proposal } = app.continuity.previewProposal("story-1", "comp-1");

    // Pre-populate receipts to capacity
    app.project.continuityReceipts = Array.from({
      length: MAX_CONTINUITY_RECEIPTS,
    }).map((_, i) => ({
      version: 1,
      proposalId: "a".repeat(64),
      requestId: `seed-req-${i}`,
      fingerprint: "b".repeat(64),
      compositionId: "comp-1",
      storyId: "story-1",
      baseRevision: "c".repeat(64),
      contextSignature: "d".repeat(64),
      acceptedAt: new Date().toISOString(),
      acceptedRevision: "e".repeat(64),
      overrides: [],
      diagnosticsCount: 0,
    }));

    await expect(
      app.continuity.applyOverrides("story-1", "comp-1", {
        proposalId: proposal.id,
        requestId: "overflow-req",
        baseRevision: proposal.baseRevision,
        contextSignature: proposal.contextSignature,
        overrides: [],
      }),
    ).rejects.toThrow(ApplicationError);
  });
});
