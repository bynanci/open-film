import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { ReviewDecisionOperation, TravelContextV1 } from "@openfilm/core";
import type { OpenFilmRuntimeOptions } from "../src/index.js";
import type {
  VisionSampleInput,
  VisionSampleProvider,
} from "@openfilm/plugin-sdk";
import { generateSampleMedia } from "../../../fixtures/sample-media/generate.mjs";
import {
  OpenFilmApplication,
  representativeSampleFingerprint,
  representativeSampleTimes,
} from "../src/index.js";
import { parseGpxTrack } from "../src/travel-evidence.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function sealedSources(
  fileNames = ["01-photo.png"],
  runtime: OpenFilmRuntimeOptions = {},
) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-source-analysis-"));
  roots.push(root);
  const generated = join(root, "generated");
  const selected = join(root, "selected");
  await generateSampleMedia(generated);
  await mkdir(selected);
  for (const name of fileNames)
    await copyFile(join(generated, name), join(selected, name));
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Scoped analysis",
    {},
    runtime,
  );
  const draft = app.sourceDraft.add({
    projectId: app.project.id,
    baseRevision: 0,
    requestId: "analysis-source-add",
    sources: [
      {
        kind: "folder",
        displayName: "Synthetic selected media",
        accessClass: "native-path",
        accessRef: selected,
        recursive: true,
      },
    ],
  });
  await app.sourceDiscovery.scan({
    projectId: app.project.id,
    baseRevision: draft.revision,
    requestId: "analysis-source-scan",
  });
  const batch = await app.sourceBatches.createAndSeal({
    projectId: app.project.id,
    baseRevision: draft.revision,
    requestId: "analysis-source-seal",
  });
  return { app, root, generated, draft, manifest: batch.verifiedManifest };
}

describe("verified-manifest scoped analysis", () => {
  it("opening a status reader does not abandon another live analysis owner", async () => {
    let started!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: VisionSampleProvider = {
      id: "local.live-owner",
      name: "Synthetic live owner",
      kind: "vision-sample",
      execution: "local",
      dataKinds: ["images", "metadata"],
      analyzeSample: async () => {
        started();
        await held;
        return { labels: [] };
      },
    };
    const { app, root, manifest } = await sealedSources(["01-photo.png"], {
      visionSampleProviders: [provider],
    });
    const pending = app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "live-status-reader",
      visualSampling: {
        version: 1,
        algorithmVersion: "representative-frames-v1",
        providerId: provider.id,
      },
    });
    try {
      await ready;
      const reader = await OpenFilmApplication.open(
        join(root, "film.openfilm"),
      );
      try {
        const run = reader.catalog.multiSource.listAnalysisRuns()[0]!;
        expect(reader.sourceAnalysis.getRun(run.id).run.status).toBe("running");
        expect(reader.sourceAnalysis.getRun(run.id).attempts[0]!.status).toBe(
          "running",
        );
      } finally {
        reader.close();
      }
      release();
      expect((await pending).run.status).toBe("completed");
    } finally {
      release();
      await Promise.allSettled([pending]);
      app.close();
    }
  });

  it("keeps rejection and changed source identity protected during adoption", async () => {
    const { app, manifest } = await sealedSources();
    const story = app.generateStory({
      assetIds: [manifest.members[0]!.assetId],
    });
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "protected-adoption",
    });
    const originalBeats = structuredClone(story.beats);
    const operation: ReviewDecisionOperation = {
      kind: "reject-results",
      resultIds: [run.results[0]!.id],
    };
    const preview = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation,
    });
    await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation,
      expectedManifestId: preview.manifestId,
      expectedBeforeFingerprint: preview.beforeFingerprint,
      expectedOperationFingerprint: preview.operationFingerprint,
      requestId: "reject-before-adopt",
    });
    const adopt: ReviewDecisionOperation = {
      kind: "adopt-story",
      storyId: story.id,
      resultIds: operation.resultIds,
    };
    const rejected = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation: adopt,
    });
    expect(rejected.outcome).toBe("conflicted");
    const attempted = await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation: adopt,
      expectedManifestId: rejected.manifestId,
      expectedBeforeFingerprint: rejected.beforeFingerprint,
      expectedOperationFingerprint: rejected.operationFingerprint,
      expectedStoryRevision: rejected.storyRevision,
      requestId: "rejected-result-adoption",
    });
    expect(attempted.outcome).toBe("conflicted");
    const asset = app.catalog.getAsset(manifest.members[0]!.assetId)!;
    app.catalog.upsertAsset({ ...asset, contentHash: "b".repeat(64) });
    expect(() =>
      app.sourceAnalysisReview.preview({ runId: run.run.id, operation: adopt }),
    ).toThrow(expect.objectContaining({ code: "analysis.resultStale" }));
    expect(app.project.stories[0]!.beats).toEqual(originalBeats);
    app.close();
  });

  it("fences new decision lineage even when accepted source statuses do not change", async () => {
    const { app, manifest } = await sealedSources();
    const first = app.generateStory({ title: "First synthetic story" });
    const second = app.generateStory({ title: "Second synthetic story" });
    const secondBefore = structuredClone(second.beats);
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "lineage-fencing",
    });
    const operation = (storyId: string): ReviewDecisionOperation => ({
      kind: "adopt-story",
      storyId,
      resultIds: [run.results[0]!.id],
    });
    const accept = (
      preview: ReturnType<typeof app.sourceAnalysisReview.preview>,
      requestId: string,
    ) =>
      app.sourceAnalysisReview.accept({
        projectId: app.project.id,
        runId: run.run.id,
        operation: preview.operation,
        expectedManifestId: preview.manifestId,
        expectedBeforeFingerprint: preview.beforeFingerprint,
        expectedOperationFingerprint: preview.operationFingerprint,
        expectedStoryRevision: preview.storyRevision,
        requestId,
      });
    await accept(
      app.sourceAnalysisReview.preview({
        runId: run.run.id,
        operation: operation(first.id),
      }),
      "first-adoption",
    );
    const stale = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation: operation(second.id),
    });
    expect(stale.outcome).toBe("ready");
    await accept(
      app.sourceAnalysisReview.preview({
        runId: run.run.id,
        operation: operation(first.id),
      }),
      "second-explicit-adoption",
    );
    expect(app.sourceAnalysis.getRun(run.run.id).results[0]!.reviewStatus).toBe(
      "accepted",
    );
    expect(
      app.sourceAnalysisReview.preview({
        runId: run.run.id,
        operation: operation(second.id),
      }).beforeFingerprint,
    ).not.toBe(stale.beforeFingerprint);
    expect((await accept(stale, "stale-lineage-adoption")).outcome).toBe(
      "conflicted",
    );
    expect(
      app.project.stories.find(({ id }) => id === second.id)!.beats,
    ).toEqual(secondBefore);
    app.close();
  });

  it.each(["correct", "merge", "split"])(
    "projects an accepted %s decision for search and subsequent story adoption",
    async (kind) => {
      const { app, manifest } = await sealedSources([
        "01-photo.png",
        "04-motion.mp4",
      ]);
      const story = app.generateStory({
        assetIds: manifest.members.map(({ assetId }) => assetId),
      });
      const run = await app.sourceAnalysis.createRun({
        projectId: app.project.id,
        verifiedManifestId: manifest.id,
        scopeMode: "selected-sources",
        requestId: `review-then-adopt-${kind}`,
        visualSampling: {
          version: 1,
          algorithmVersion: "representative-frames-v1",
        },
      });
      const video = app.catalog
        .listAssets()
        .find(({ mediaType }) => mediaType === "video")!;
      const result = run.results.find(
        ({ evidence }) =>
          evidence.type === "visual-sample" && evidence.assetId === video.id,
      )!;
      const other = run.results.find(({ id }) => id !== result.id)!;
      const ids = kind === "merge" ? [result.id, other.id] : [result.id];
      const operation: ReviewDecisionOperation =
        kind === "correct"
          ? {
              kind: "set-observation",
              resultId: result.id,
              axis: "narrative-note",
              value: "人工確認的故事備註",
            }
          : kind === "merge"
            ? { kind: "merge-results", resultIds: ids }
            : {
                kind: "split-result",
                resultId: result.id,
                ranges: [
                  { assetId: video.id, start: 0, end: video.duration! / 2 },
                  {
                    assetId: video.id,
                    start: video.duration! / 2,
                    end: video.duration!,
                  },
                ],
              };
      const preview = app.sourceAnalysisReview.preview({
        runId: run.run.id,
        operation,
      });
      const decision = await app.sourceAnalysisReview.accept({
        projectId: app.project.id,
        runId: run.run.id,
        operation,
        expectedManifestId: preview.manifestId,
        expectedBeforeFingerprint: preview.beforeFingerprint,
        expectedOperationFingerprint: preview.operationFingerprint,
        requestId: `accept-${kind}`,
      });
      expect(decision.outcome).toBe("applied");
      const page = app.sourceAnalysisReview.search({
        runId: run.run.id,
        query: kind === "correct" ? "人工確認" : "",
        offset: 0,
        limit: 100,
      });
      const projected = page.items.find(
        (item) =>
          item.id === result.id ||
          (
            item as unknown as { review?: { baseResultIds: string[] } }
          ).review?.baseResultIds.includes(result.id),
      );
      expect(projected).toBeDefined();
      expect(projected).toMatchObject({
        review: {
          decisionIds: expect.arrayContaining([decision.id]),
          baseResultIds: expect.arrayContaining(ids),
        },
      });
      const adopt: ReviewDecisionOperation = {
        kind: "adopt-story",
        storyId: story.id,
        resultIds: [projected!.id],
      };
      const adoption = app.sourceAnalysisReview.preview({
        runId: run.run.id,
        operation: adopt,
      });
      expect(adoption.outcome).toBe("ready");
      expect(adoption.targetIds).toEqual([...ids].sort());
      const accepted = await app.sourceAnalysisReview.accept({
        projectId: app.project.id,
        runId: run.run.id,
        operation: adopt,
        expectedManifestId: adoption.manifestId,
        expectedBeforeFingerprint: adoption.beforeFingerprint,
        expectedOperationFingerprint: adoption.operationFingerprint,
        expectedStoryRevision: adoption.storyRevision,
        requestId: `adopt-${kind}`,
      });
      expect(accepted.outcome).toBe("applied");
      expect(app.project.stories[0]!.beats.at(-1)!.selectedAssetIds).toContain(
        video.id,
      );
      expect(
        app.sourceAnalysis
          .getRun(run.run.id)
          .results.find(({ id }) => id === result.id)!.evidence,
      ).toEqual(result.evidence);
      app.close();
    },
  );

  it.each(["unrelated", "past-duration", "overlap", "image"])(
    "rejects a split with %s source ranges",
    async (invalid) => {
      const { app, manifest } = await sealedSources([
        "01-photo.png",
        "04-motion.mp4",
      ]);
      const run = await app.sourceAnalysis.createRun({
        projectId: app.project.id,
        verifiedManifestId: manifest.id,
        scopeMode: "selected-sources",
        requestId: `invalid-split-${invalid}`,
        visualSampling: {
          version: 1,
          algorithmVersion: "representative-frames-v1",
        },
      });
      const asset = app.catalog
        .listAssets()
        .find(
          ({ mediaType }) =>
            mediaType === (invalid === "image" ? "image" : "video"),
        )!;
      const result = run.results.find(
        ({ evidence }) =>
          evidence.type === "visual-sample" && evidence.assetId === asset.id,
      )!;
      const other = app.catalog.listAssets().find(({ id }) => id !== asset.id)!;
      const duration = asset.duration ?? 2;
      const ranges = [
        {
          assetId: invalid === "unrelated" ? other.id : asset.id,
          start: 0,
          end: duration / 2,
        },
        {
          assetId: invalid === "unrelated" ? other.id : asset.id,
          start: invalid === "overlap" ? duration / 4 : duration / 2,
          end: invalid === "past-duration" ? duration + 1 : duration,
        },
      ];
      expect(() =>
        app.sourceAnalysisReview.preview({
          runId: run.run.id,
          operation: { kind: "split-result", resultId: result.id, ranges },
        }),
      ).toThrow(expect.objectContaining({ code: "analysis.scopeStale" }));
      app.close();
    },
  );

  it("rejects replaced source bytes before disclosing any representative pixels", async () => {
    const provider: VisionSampleProvider = {
      id: "remote.synthetic-hash",
      name: "Synthetic hash provider",
      kind: "vision-sample",
      execution: "remote",
      endpoint: "https://vision.invalid/samples",
      dataKinds: ["images", "metadata"],
      analyzeSample: vi.fn(async () => ({ labels: [] })),
    };
    const { app, generated, manifest } = await sealedSources(["01-photo.png"], {
      visionSampleProviders: [provider],
    });
    app.sourceAnalysis.grantVisionSampleConsent({
      providerId: provider.id,
      dataKinds: ["images", "metadata"],
      grantedAt: new Date().toISOString(),
    });
    const asset = app.catalog.getAsset(manifest.members[0]!.assetId)!;
    await copyFile(join(generated, "03-evening.png"), fileURLToPath(asset.uri));
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "replaced-source-sample",
      visualSampling: {
        version: 1,
        algorithmVersion: "representative-frames-v1",
        providerId: provider.id,
      },
    });
    expect(run.run.status).toBe("failed");
    expect(run.results).toEqual([]);
    expect(provider.analyzeSample).not.toHaveBeenCalled();
    expect(
      app.catalog
        .listJobs()
        .find(({ attempt }) => attempt?.operationId === run.run.id)?.errors?.[0]
        ?.code,
    ).toBe("source.changed");
    app.close();
  });

  it.each(["cancel", "context", "owner"])(
    "fences %s changes at the final asynchronous visual publication boundary",
    async (change) => {
      const controller = new AbortController();
      const provider: VisionSampleProvider = {
        id: "local.synthetic-fence",
        name: "Synthetic final fence",
        kind: "vision-sample",
        execution: "local",
        dataKinds: ["images", "metadata"],
        analyzeSample: async (input) => {
          if (change === "cancel")
            queueMicrotask(() => queueMicrotask(() => controller.abort()));
          if (change === "context")
            app.catalog.upsertAsset({
              ...app.catalog.getAsset(input.assetId)!,
              capturedAt: "2026-05-01T00:00:00.000Z",
            });
          if (change === "owner") {
            const job = app.catalog
              .listJobs()
              .find(({ attempt }) => attempt?.status === "running")!;
            app.catalog.saveJob({
              ...job,
              attempt: {
                ...job.attempt!,
                ownerToken: "new-owner",
                generation: job.attempt!.generation + 1,
              },
            });
          }
          return { labels: [{ label: "synthetic", confidence: 1 }] };
        },
      };
      const setup = await sealedSources(["01-photo.png"], {
        visionSampleProviders: [provider],
      });
      const app = setup.app;
      const promise = app.sourceAnalysis.createRun({
        projectId: app.project.id,
        verifiedManifestId: setup.manifest.id,
        scopeMode: "selected-sources",
        requestId: `final-fence-${change}`,
        visualSampling: {
          version: 1,
          algorithmVersion: "representative-frames-v1",
          providerId: provider.id,
        },
        signal: controller.signal,
      });
      if (change === "owner") {
        await expect(promise).rejects.toMatchObject({
          code: "analysis.resultStale",
        });
        const run = app.catalog.multiSource.listAnalysisRuns()[0]!;
        expect(app.catalog.multiSource.getAnalysisResults(run.id)).toEqual([]);
        expect(run.status).toBe("running");
        expect(
          app.catalog
            .listJobs()
            .find(({ attempt }) => attempt?.operationId === run.id)?.attempt
            ?.ownerToken,
        ).toBe("new-owner");
      } else {
        const result = await promise;
        expect(result.run.status).toBe(
          change === "cancel" ? "cancelled" : "failed",
        );
        expect(result.results).toEqual([]);
      }
      app.close();
    },
  );

  it("plans deterministic representative times and invalidates sample identity on source changes", () => {
    expect(representativeSampleTimes("image")).toEqual([0]);
    expect(representativeSampleTimes("video", 8)).toEqual([2, 4, 6]);
    expect(representativeSampleTimes("video")).toEqual([]);
    const sourceHash = "a".repeat(64);
    expect(representativeSampleFingerprint(sourceHash, 2)).toBe(
      representativeSampleFingerprint(sourceHash, 2),
    );
    expect(representativeSampleFingerprint(sourceHash, 2)).not.toBe(
      representativeSampleFingerprint("b".repeat(64), 2),
    );
    expect(representativeSampleFingerprint(sourceHash, 2)).not.toBe(
      representativeSampleFingerprint(sourceHash, 3),
    );
  });

  it("persists deterministic run-specific results only for the sealed manifest", async () => {
    const { app, root, generated, manifest } = await sealedSources();
    const extra = join(generated, "03-evening.png");
    const unselected = await app.importFiles([extra]);
    const unselectedAssetId = app.catalog
      .listAssets()
      .find((asset) => asset.name === "03-evening.png")!.id;
    expect(unselected.imported).toBe(1);

    const created = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-first-run",
    });
    expect(created.run.status).toBe("completed");
    expect(created.run.manifestId).toBe(manifest.id);
    expect(created.results.length).toBeGreaterThan(0);
    expect(
      created.results.flatMap(({ evidence }) =>
        evidence.type === "travel-observation" ||
        evidence.type === "visual-sample"
          ? [evidence.assetId]
          : "assetIds" in evidence
            ? evidence.assetIds
            : [],
      ),
    ).not.toContain(unselectedAssetId);
    expect(created.attempts.at(-1)).toMatchObject({
      status: "succeeded",
      generation: 1,
    });

    const duplicateRequest = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-first-run",
    });
    expect(duplicateRequest.run.id).toBe(created.run.id);
    expect(app.catalog.multiSource.listAnalysisRuns()).toHaveLength(1);

    app.close();
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(reopened.sourceAnalysis.getRun(created.run.id)).toEqual(created);
    reopened.close();
  });

  it("requires explicit whole-project scope and rejects a manifest that omits current assets", async () => {
    const { app, generated, manifest, root } = await sealedSources([
      "01-photo.png",
    ]);
    const extra = join(generated, "03-evening.png");
    await app.importFiles([extra]);
    await expect(
      app.sourceAnalysis.createRun({
        projectId: app.project.id,
        verifiedManifestId: manifest.id,
        scopeMode: "project-catalog",
        requestId: "analysis-unconfirmed-project",
      }),
    ).rejects.toMatchObject({ code: "analysis.scopeStale" });
    await expect(
      app.sourceAnalysis.createRun({
        projectId: app.project.id,
        verifiedManifestId: manifest.id,
        scopeMode: "project-catalog",
        confirmProjectCatalog: true,
        requestId: "analysis-incomplete-project",
      }),
    ).rejects.toMatchObject({ code: "analysis.scopeStale" });
    app.close();

    const full = await OpenFilmApplication.open(join(root, "film.openfilm"));
    expect(full.project.id).toBeTruthy();
    full.close();
  });

  it("cancels with owner fencing and retries the same immutable scope as a new attempt", async () => {
    const { app, manifest } = await sealedSources(["01-photo.png"]);
    let runId = "";
    const cancelledPromise = app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-cancel-this-run",
      onProgress: (progress) => {
        runId = progress.runId;
        if (progress.stage === "running")
          void app.sourceAnalysis.cancelRun({
            projectId: app.project.id,
            runId,
          });
      },
    });
    const cancelled = await cancelledPromise;
    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.results).toHaveLength(0);
    expect(cancelled.attempts.at(-1)).toMatchObject({
      status: "cancelled",
      generation: 1,
    });

    const retried = await app.sourceAnalysis.retryRun({
      projectId: app.project.id,
      runId,
      requestId: "analysis-retry-cancelled-run",
    });
    expect(retried.run.status).toBe("completed");
    expect(retried.run.id).toBe(cancelled.run.id);
    expect(
      retried.attempts.map(({ generation, status }) => ({
        generation,
        status,
      })),
    ).toEqual([
      { generation: 1, status: "cancelled" },
      { generation: 2, status: "succeeded" },
    ]);
    app.close();
  });

  it("recovers queued and running analysis attempts after reopening without claiming an old owner", async () => {
    const { app, root, manifest } = await sealedSources(["01-photo.png"]);
    const binding = manifest.members[0]!;
    const runIds = ["analysis:queued-recovery", "analysis:running-recovery"];
    const statuses = ["queued", "running"] as const;
    for (let index = 0; index < statuses.length; index++) {
      const status = statuses[index]!;
      const runId = runIds[index]!;
      const run = {
        id: runId,
        projectId: app.project.id,
        manifestId: manifest.id,
        scopeMode: "selected-sources" as const,
        algorithmVersion: "common-events-duplicates-v1",
        taxonomyVersion: "common-evidence-v1",
        configHash: "a".repeat(64),
        inputFingerprint: "b".repeat(64),
        inputBindingIds: [binding.bindingId],
        status,
        createdAt: new Date().toISOString(),
      };
      app.catalog.multiSource.createAnalysisRun(run);
      const attempt = {
        id: `attempt:${index}`,
        operationId: runId,
        operationKind: "analysis-run" as const,
        generation: 1,
        ownerToken: `old-owner-${index}`,
        status: status as "queued" | "running",
        stage: "analyze",
        cancelRequested: false,
        createdAt: run.createdAt,
      };
      app.catalog.saveJob({
        id: attempt.id,
        type: "analysis-run",
        status,
        attempt,
      });
    }
    app.close();

    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(reopened.sourceAnalysis.getRun(runIds[0]!).run.status).toBe(
      "cancelled",
    );
    expect(
      reopened.sourceAnalysis.getRun(runIds[0]!).attempts[0],
    ).toMatchObject({ status: "abandoned", stage: "interrupted" });
    expect(reopened.sourceAnalysis.getRun(runIds[1]!).run.status).toBe(
      "failed",
    );
    expect(
      reopened.sourceAnalysis.getRun(runIds[1]!).attempts[0],
    ).toMatchObject({ status: "abandoned", stage: "interrupted" });
    reopened.close();
  });

  it("persists explicit travel-v1 mappings, route assignments, and unknown/conflicting evidence with the immutable run", async () => {
    const { app, root, manifest } = await sealedSources([
      "01-photo.png",
      "02-photo-copy.png",
    ]);
    const assetIds = [
      ...new Set(manifest.members.map(({ assetId }) => assetId)),
    ].sort();
    const firstAsset = app.catalog.getAsset(assetIds[0]!)!;
    const sourceTime = firstAsset.capturedAt ?? "2026-01-01T09:00:00.000Z";
    const track = parseGpxTrack(
      "synthetic-route",
      `<gpx><trk><trkseg><trkpt lat="25.033" lon="121.565"><time>${sourceTime}</time></trkpt></trkseg><trkseg><trkpt lat="25.050" lon="121.565"><time>2026-01-01T11:00:00Z</time></trkpt></trkseg></trk></gpx>`,
    );
    const travelContext: TravelContextV1 = {
      version: 1,
      algorithmVersion: "travel-v1",
      tracks: [track],
      clockMappings: [
        {
          id: "manual-camera-clock",
          assetIds: [assetIds[0]!],
          offsetMilliseconds: 0,
          timeZone: "Asia/Taipei",
          source: "manual",
        },
      ],
      assignments: [{ trackId: track.id, assetIds }],
    };
    const created = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-with-travel-context",
      travelContext,
    });
    expect(created.run.travelContext).toEqual(travelContext);
    expect(created.run.configHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      created.results.filter(
        ({ evidence }) => evidence.type === "travel-observation",
      ),
    ).toHaveLength(assetIds.length);
    expect(
      created.results.find(
        ({ evidence }) => evidence.type === "travel-observation",
      )?.evidence,
    ).toMatchObject({
      type: "travel-observation",
      algorithmVersion: "travel-v1",
      trackId: "synthetic-route",
      trackContentHash: track.contentHash,
    });
    await expect(
      app.sourceAnalysis.createRun({
        projectId: app.project.id,
        verifiedManifestId: manifest.id,
        scopeMode: "selected-sources",
        requestId: "analysis-travel-outside-manifest",
        travelContext: {
          ...travelContext,
          assignments: [{ trackId: track.id, assetIds: ["unverified-asset"] }],
        },
      }),
    ).rejects.toMatchObject({ code: "analysis.scopeStale" });

    app.close();
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(reopened.sourceAnalysis.getRun(created.run.id)).toEqual(created);
    reopened.close();
  });

  it("stores deterministic bounded frame receipts as unknown/manual review without a configured provider", async () => {
    const { app, root, manifest } = await sealedSources(["01-photo.png"]);
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-visual-local-only",
      visualSampling: {
        version: 1,
        algorithmVersion: "representative-frames-v1",
      },
    });
    const visual = run.results
      .map(({ evidence }) => evidence)
      .filter((value) => value.type === "visual-sample");
    expect(visual).toHaveLength(1);
    expect(visual[0]).toMatchObject({
      type: "visual-sample",
      algorithmVersion: "representative-frames-v1",
      status: "unknown",
      reason: "provider-not-configured",
      manualReviewRequired: true,
      sourceTimeRange: { start: 0, end: 0 },
    });
    if (visual[0]?.type !== "visual-sample")
      throw new Error("Expected visual sample evidence.");
    expect(visual[0].sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(visual[0].frameHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(visual[0].sampleFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(visual[0])).not.toMatch(/bytes|file:\/\//u);
    app.close();

    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(reopened.sourceAnalysis.getRun(run.run.id)).toEqual(run);
    reopened.close();
  });

  it("requires explicit remote consent and sends only a verified bounded frame sample", async () => {
    const received: VisionSampleInput[] = [];
    const provider: VisionSampleProvider = {
      id: "remote.synthetic-frame-provider",
      name: "Synthetic frame provider",
      kind: "vision-sample",
      execution: "remote",
      endpoint: "https://provider.example.invalid/frame",
      dataKinds: ["images", "metadata"],
      analyzeSample: vi.fn(async (input) => {
        received.push(input);
        return { labels: [{ label: "synthetic-landscape", confidence: 0.9 }] };
      }),
    };
    const { app, manifest } = await sealedSources(["01-photo.png"], {
      visionSampleProviders: [provider],
    });
    const input = {
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources" as const,
      requestId: "analysis-remote-visual-consent",
      visualSampling: {
        version: 1 as const,
        algorithmVersion: "representative-frames-v1" as const,
        providerId: provider.id,
      },
    };
    await expect(app.sourceAnalysis.createRun(input)).rejects.toMatchObject({
      code: "request.invalid",
    });
    expect(provider.analyzeSample).not.toHaveBeenCalled();
    app.sourceAnalysis.grantVisionSampleConsent({
      providerId: provider.id,
      dataKinds: ["images", "metadata"],
      grantedAt: new Date().toISOString(),
    });
    const run = await app.sourceAnalysis.createRun(input);
    const visual = run.results
      .map(({ evidence }) => evidence)
      .find((value) => value.type === "visual-sample");
    expect(visual).toMatchObject({
      type: "visual-sample",
      status: "suggested",
      manualReviewRequired: true,
      suggestedLabels: [{ label: "synthetic-landscape", confidence: 0.9 }],
    });
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]!).sort()).toEqual([
      "assetId",
      "bytes",
      "height",
      "mimeType",
      "sampleId",
      "sourceHash",
      "sourceTimeRange",
      "width",
    ]);
    expect(received[0]!.bytes.byteLength).toBeLessThanOrEqual(512 * 1024);
    expect(
      JSON.stringify(received[0], (_key, value: unknown) =>
        value instanceof Uint8Array ? `[${value.byteLength} bytes]` : value,
      ),
    ).not.toContain("file://");
    app.close();
  });

  it("searches immutable evidence, previews a review, requires explicit acceptance, and persists the decision", async () => {
    const { app, root, manifest } = await sealedSources(["01-photo.png"]);
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-review-run",
    });
    const resultId = run.results[0]!.id;
    const result = app.sourceAnalysisReview.search({
      runId: run.run.id,
      query: "event",
      offset: 0,
      limit: 10,
    });
    expect(result.total).toBeGreaterThan(0);
    const operation: ReviewDecisionOperation = {
      kind: "reject-results",
      resultIds: [resultId],
    };
    const preview = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation,
    });
    expect(preview).toMatchObject({
      outcome: "ready",
      manifestId: manifest.id,
      targetIds: [resultId],
    });
    expect(
      app.sourceAnalysis
        .getRun(run.run.id)
        .results.find(({ id }) => id === resultId)?.reviewStatus,
    ).toBe("pending");
    const decision = await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation,
      expectedManifestId: preview.manifestId,
      expectedBeforeFingerprint: preview.beforeFingerprint,
      expectedOperationFingerprint: preview.operationFingerprint,
      requestId: "review-reject-result",
    });
    expect(decision.outcome).toBe("applied");
    expect(
      app.sourceAnalysis
        .getRun(run.run.id)
        .results.find(({ id }) => id === resultId)?.reviewStatus,
    ).toBe("rejected");
    await expect(
      app.sourceAnalysisReview.accept({
        projectId: app.project.id,
        runId: run.run.id,
        operation,
        expectedManifestId: preview.manifestId,
        expectedBeforeFingerprint: preview.beforeFingerprint,
        expectedOperationFingerprint: preview.operationFingerprint,
        requestId: "review-reject-result",
      }),
    ).resolves.toEqual(decision);
    await expect(
      app.sourceAnalysisReview.accept({
        projectId: app.project.id,
        runId: run.run.id,
        operation,
        expectedManifestId: preview.manifestId,
        expectedBeforeFingerprint: preview.beforeFingerprint,
        expectedOperationFingerprint: "0".repeat(64),
        requestId: "review-reject-result",
      }),
    ).rejects.toMatchObject({ code: "request.invalid", status: 409 });
    app.close();

    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(reopened.sourceAnalysisReview.decisions(run.run.id)).toEqual([
      decision,
    ]);
    reopened.close();
  });

  it("binds an accepted review to the exact previewed operation and rejects malformed split ranges", async () => {
    const { app, manifest } = await sealedSources(["01-photo.png"]);
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-review-operation-fingerprint-run",
      visualSampling: {
        version: 1,
        algorithmVersion: "representative-frames-v1",
      },
    });
    const observation = run.results.find(({ kind }) => kind === "observation");
    expect(observation).toBeDefined();
    const previewed: ReviewDecisionOperation = {
      kind: "set-observation",
      resultId: observation!.id,
      axis: "label",
      value: "previewed-label",
    };
    const preview = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation: previewed,
    });
    const changed: ReviewDecisionOperation = {
      ...previewed,
      value: "changed-after-preview",
    };
    const decision = await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation: changed,
      expectedManifestId: preview.manifestId,
      expectedBeforeFingerprint: preview.beforeFingerprint,
      expectedOperationFingerprint: preview.operationFingerprint,
      requestId: "review-operation-changed-after-preview",
    });
    expect(decision).toMatchObject({
      outcome: "conflicted",
      operationFingerprint: expect.not.stringMatching(
        preview.operationFingerprint,
      ),
    });
    expect(() =>
      app.sourceAnalysisReview.preview({
        runId: run.run.id,
        operation: {
          kind: "split-result",
          resultId: observation!.id,
          ranges: [null, {}],
        } as unknown as ReviewDecisionOperation,
      }),
    ).toThrowError(/Split source range fields are invalid/u);
    app.close();
  });

  it("stores stale review attempts as immutable conflicts without changing already reviewed results", async () => {
    const { app, manifest } = await sealedSources(["01-photo.png"]);
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-review-conflict-run",
    });
    const resultId = run.results[0]!.id;
    const firstOp: ReviewDecisionOperation = {
      kind: "reject-results",
      resultIds: [resultId],
    };
    const staleOp: ReviewDecisionOperation = {
      kind: "reject-results",
      resultIds: [resultId],
    };
    const firstPreview = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation: firstOp,
    });
    const stalePreview = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation: staleOp,
    });
    await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation: firstOp,
      expectedManifestId: firstPreview.manifestId,
      expectedBeforeFingerprint: firstPreview.beforeFingerprint,
      expectedOperationFingerprint: firstPreview.operationFingerprint,
      requestId: "review-first-decision",
    });
    const conflict = await app.sourceAnalysisReview
      .accept({
        projectId: app.project.id,
        runId: run.run.id,
        operation: staleOp,
        expectedManifestId: stalePreview.manifestId,
        expectedBeforeFingerprint: stalePreview.beforeFingerprint,
        expectedOperationFingerprint: stalePreview.operationFingerprint,
        requestId: "review-stale-decision",
        supersedesDecisionId: "review:not-a-real-decision",
      })
      .catch((error: unknown) => error);
    expect(conflict).toMatchObject({ code: "request.invalid" });
    const staleConflict = await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation: staleOp,
      expectedManifestId: stalePreview.manifestId,
      expectedBeforeFingerprint: stalePreview.beforeFingerprint,
      expectedOperationFingerprint: stalePreview.operationFingerprint,
      requestId: "review-stale-decision-without-link",
    });
    expect(staleConflict.outcome).toBe("conflicted");
    const linkedConflict = await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation: staleOp,
      expectedManifestId: stalePreview.manifestId,
      expectedBeforeFingerprint: stalePreview.beforeFingerprint,
      expectedOperationFingerprint: stalePreview.operationFingerprint,
      requestId: "review-stale-superseding-decision",
      supersedesDecisionId: staleConflict.id,
    });
    expect(linkedConflict).toMatchObject({
      outcome: "conflicted",
      supersedesDecisionId: staleConflict.id,
    });
    expect(
      app.sourceAnalysis
        .getRun(run.run.id)
        .results.find(({ id }) => id === resultId)?.reviewStatus,
    ).toBe("rejected");
    app.close();
  });

  it("adopts selected verified media into StoryGraph only after preview and explicit acceptance", async () => {
    const { app, manifest } = await sealedSources(["01-photo.png"]);
    const assetId = manifest.members[0]!.assetId;
    const story = app.generateStory({
      title: "Synthetic review story",
      assetIds: [assetId],
    });
    const beforeBeatCount = story.beats.length;
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "analysis-story-adoption-run",
    });
    const resultId = run.results[0]!.id;
    const operation: ReviewDecisionOperation = {
      kind: "adopt-story",
      storyId: story.id,
      resultIds: [resultId],
    };
    const preview = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation,
    });
    expect(preview).toMatchObject({
      outcome: "ready",
      affectedAssetIds: [assetId],
    });
    expect(
      app.project.stories.find(({ id }) => id === story.id)?.beats,
    ).toHaveLength(beforeBeatCount);
    const decision = await app.sourceAnalysisReview.accept({
      projectId: app.project.id,
      runId: run.run.id,
      operation,
      expectedManifestId: preview.manifestId,
      expectedBeforeFingerprint: preview.beforeFingerprint,
      expectedOperationFingerprint: preview.operationFingerprint,
      expectedStoryRevision: preview.storyRevision,
      requestId: "review-adopt-story",
    });
    expect(decision.outcome).toBe("applied");
    const updated = app.project.stories.find(({ id }) => id === story.id)!;
    expect(updated.beats).toHaveLength(beforeBeatCount + 1);
    expect(updated.beats.at(-1)?.selectedAssetIds).toEqual([assetId]);
    expect(
      updated.graph?.nodes.some(
        (node) =>
          node.type === "beat" && node.beatId === updated.beats.at(-1)?.id,
      ),
    ).toBe(true);
    app.close();
  });

  it("reuses custom StoryGraph asset-node IDs during adoption, retry and reopen", async () => {
    const { app, root, manifest } = await sealedSources();
    const assetId = manifest.members[0]!.assetId;
    const story = app.generateStory({ assetIds: [assetId] });
    const graph = app.storyGraph.getGraph(story.id);
    const customNodeId = "user-organised-memory-node";
    await app.storyGraph.updateGraph(story.id, {
      ...graph,
      nodes: [...graph.nodes, { id: customNodeId, type: "asset", assetId }],
    });
    const beforeCount = app.project.stories[0]!.beats.length;
    const run = await app.sourceAnalysis.createRun({
      projectId: app.project.id,
      verifiedManifestId: manifest.id,
      scopeMode: "selected-sources",
      requestId: "custom-graph-run",
    });
    const operation: ReviewDecisionOperation = {
      kind: "adopt-story",
      storyId: story.id,
      resultIds: [run.results[0]!.id],
    };
    const preview = app.sourceAnalysisReview.preview({
      runId: run.run.id,
      operation,
    });
    const receipt = {
      projectId: app.project.id,
      runId: run.run.id,
      operation,
      expectedManifestId: preview.manifestId,
      expectedBeforeFingerprint: preview.beforeFingerprint,
      expectedOperationFingerprint: preview.operationFingerprint,
      expectedStoryRevision: preview.storyRevision,
      requestId: "custom-graph-adoption",
    };
    const decision = await app.sourceAnalysisReview.accept(receipt);
    expect(decision.outcome).toBe("applied");
    expect(await app.sourceAnalysisReview.accept(receipt)).toEqual(decision);
    const updated = app.project.stories[0]!;
    expect(updated.beats).toHaveLength(beforeCount + 1);
    expect(updated.graph?.edges).toContainEqual(
      expect.objectContaining({
        from: expect.stringContaining("review-beat-node-"),
        to: customNodeId,
        type: "supports",
      }),
    );
    expect(
      updated.graph?.nodes.filter(
        (node) => node.type === "asset" && node.assetId === assetId,
      ),
    ).toHaveLength(1);
    app.close();
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(reopened.project.stories[0]).toEqual(updated);
    expect(await reopened.sourceAnalysisReview.accept(receipt)).toEqual(
      decision,
    );
    reopened.close();
  });
});
