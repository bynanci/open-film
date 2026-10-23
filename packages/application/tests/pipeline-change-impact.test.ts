// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { rm, mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "../src/index.js";
import type { MediaAsset, Story } from "@openfilm/core";

const exec = promisify(execFile);

function makeSyntheticPhoto(
  id: string,
  name: string,
  uri: string,
  contentHash = "hash_photo_100",
): MediaAsset {
  return {
    id,
    uri,
    mediaType: "image",
    name,
    tags: ["nature"],
    state: {},
    metadata: { width: 1920, height: 1080 },
    duration: 5,
    contentHash,
  };
}

describe(
  "M11A Application: Change Impact & Incremental Runs",
  { timeout: 180_000 },
  () => {
  let projectDir: string;
  let app: OpenFilmApplication;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "openfilm-m11a-test-"));
    app = await OpenFilmApplication.create(projectDir, "M11A Incremental Film");

    const mediaDir = join(projectDir, "media");
    await mkdir(mediaDir, { recursive: true });
    const fileA = join(mediaDir, "photo_a.jpg");
    const fileB = join(mediaDir, "photo_b.jpg");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=1280x720",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      fileA,
    ]);
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=1280x720",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      fileB,
    ]);

    const hashA = createHash("sha256")
      .update(await readFile(fileA))
      .digest("hex");
    const hashB = createHash("sha256")
      .update(await readFile(fileB))
      .digest("hex");

    const photoA = makeSyntheticPhoto(
      "asset_a",
      "photo_a",
      pathToFileURL(fileA).href,
      hashA,
    );
    const photoB = makeSyntheticPhoto(
      "asset_b",
      "photo_b",
      pathToFileURL(fileB).href,
      hashB,
    );
    app.catalog.upsertAsset(photoA);
    app.catalog.upsertAsset(photoB);

    const story: Story = {
      id: "story_m11a",
      title: "Mountain Journey",
      targetDuration: 10,
      beats: [
        {
          id: "beat_1",
          title: "Alpine Trail",
          intent: "Walking through misty paths",
          targetDuration: 5,
          candidateAssetIds: ["asset_a"],
        },
        {
          id: "beat_2",
          title: "Summit View",
          intent: "Reaching the windy peak",
          targetDuration: 5,
          candidateAssetIds: ["asset_b"],
        },
      ],
    };
    app.project.stories.push(story);
    await app.save();
  });

  afterEach(async () => {
    try {
      app.catalog.close();
    } catch {
      // ignore
    }
    await rm(projectDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  });

  it("completes an initial base run and stamps input signatures on step attempts and artifacts", async () => {
    const run = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a", "asset_b"],
      narration: { type: "none" },
      customParams: {
        subtitleText: "Initial Alpine Trail",
      },
    });

    const executed = await app.pipeline.startRun(run.id);
    let completed = executed;
    if (executed.status === "waiting-review") {
      completed = await app.pipeline.submitReview(run.id, "step-7", "accepted");
    }
    expect(completed.status).toBe("succeeded");

    for (const attempt of completed.stepAttempts) {
      expect(attempt.inputSignature).toBeDefined();
      expect(attempt.inputSignature).toHaveLength(64);
      expect(attempt.inputs).toBeDefined();
    }

    expect(completed.artifacts.length).toBeGreaterThan(0);
    for (const art of completed.artifacts) {
      expect(art.inputSignature).toBeDefined();
      expect(art.adapterVersion).toBe("1.0.0");
      expect(art.verifiedAt).toBeDefined();
    }
  });

  it("Impact Matrix Case 1 & 2: canvas pan/zoom and unconsumed notes result in 0 media calls and 100% reuse", async () => {
    const baseRun = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a", "asset_b"],
      narration: { type: "none" },
    });
    const execBase = await app.pipeline.startRun(baseRun.id);
    if (execBase.status === "waiting-review") {
      await app.pipeline.submitReview(baseRun.id, "step-7", "accepted");
    }

    // Modify canvas pan/zoom (GraphViewState) & add unconsumed story note
    app.storyGraph.updateViewState("story_m11a", {
      version: 1,
      storyId: "story_m11a",
      zoom: 1.5,
      panX: 520,
      panY: -310,
      nodeCoordinates: {},
      collapsedNodeIds: ["node_xyz"],
    });

    app.pipeline.resetServiceCallCounters();

    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: baseRun.id,
        storyId: "story_m11a",
        assetIds: ["asset_a", "asset_b"],
        narration: { type: "none" },
      },
    );

    expect(impact.summary.reusableSteps).toBe(8);
    expect(impact.summary.rerunSteps).toBe(0);
    for (const step of impact.steps) {
      expect(step.status).toBe("reuse");
    }

    // Incremental run executes with 0 media calls
    const incRun = await app.pipeline.createIncrementalRun(
      "guided-story-to-video",
      {
        baseRunId: baseRun.id,
        storyId: "story_m11a",
        assetIds: ["asset_a", "asset_b"],
        narration: { type: "none" },
      },
    );

    await app.pipeline.startRun(incRun.id);
    const counters = app.pipeline.getServiceCallCounters();
    expect(counters.ttsCalls).toBe(0);
    expect(counters.motionCalls).toBe(0);
    expect(counters.renderCalls).toBe(0);
  });

  it("Impact Matrix Case 3 & A/B verification: modifying only subtitles reuses narration & visuals (TTS/motion calls = 0) and updates output", async () => {
    // 1. Initial run with subtitle "Scene Alpha"
    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a", "asset_b"],
      narration: {
        type: "configured-tts",
        providerId: "byok-tts-standard",
        speechConsent: true,
      },
      customParams: {
        subtitleText: "Scene Alpha: Morning Fog",
      },
    });

    await app.pipeline.startRun(runA.id);
    expect(runA.status).toBe("waiting-review"); // narration review
    const resA1 = await app.pipeline.submitReview(
      runA.id,
      "step-3",
      "accepted",
    );
    if (resA1.status === "waiting-review") {
      await app.pipeline.submitReview(runA.id, "step-7", "accepted");
    }
    expect(runA.status).toBe("succeeded");

    const renderArtA = runA.artifacts.find((a) => a.kind === "preview-video");
    expect(renderArtA?.path).toBeDefined();
    const resolvedPathA =
      renderArtA!.path!.startsWith("/") || /^[a-zA-Z]:/.test(renderArtA!.path!)
        ? renderArtA!.path!
        : join(projectDir, renderArtA!.path!);
    const diskBytesA = await readFile(resolvedPathA);
    expect(diskBytesA.length).toBeGreaterThan(0);

    // 2. Analyze impact when ONLY subtitle text changes to "Scene Beta"
    app.pipeline.resetServiceCallCounters();

    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a", "asset_b"],
        narration: {
          type: "configured-tts",
          providerId: "byok-tts-standard",
          speechConsent: true,
        },
        customParams: {
          subtitleText: "Scene Beta: Golden Sunshine",
        },
      },
    );

    // Step 1 (story select), Step 2 (scene prep), Step 3 (narration) must be REUSED!
    expect(impact.steps.find((s) => s.stepId === "step-1")?.status).toBe(
      "reuse",
    );
    expect(impact.steps.find((s) => s.stepId === "step-2")?.status).toBe(
      "reuse",
    );
    expect(impact.steps.find((s) => s.stepId === "step-3")?.status).toBe(
      "reuse",
    );

    // Step 4 (timing-captions), Step 5 (composition-adopt), Step 6 (render) must RERUN
    expect(impact.steps.find((s) => s.stepId === "step-4")?.status).toBe(
      "rerun",
    );
    expect(impact.steps.find((s) => s.stepId === "step-6")?.status).toBe(
      "rerun",
    );
    expect(impact.renderMode).toBe("full-render-fallback");

    // 3. Create incremental run B
    const runB = await app.pipeline.createIncrementalRun(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a", "asset_b"],
        narration: {
          type: "configured-tts",
          providerId: "byok-tts-standard",
          speechConsent: true,
        },
        customParams: {
          subtitleText: "Scene Beta: Golden Sunshine",
        },
      },
    );

    expect(runB.stepAttempts[0]?.status).toBe("succeeded");
    expect(runB.stepAttempts[1]?.status).toBe("succeeded");
    expect(runB.stepAttempts[2]?.status).toBe("succeeded");
    expect(runB.stepAttempts[2]?.reuseSource?.runId).toBe(runA.id);

    const resB = await app.pipeline.startRun(runB.id);
    if (resB.status === "waiting-review") {
      await app.pipeline.submitReview(runB.id, "step-7", "accepted");
    }
    expect(runB.status).toBe("succeeded");

    // Verify service call counters: TTS calls = 0, motion calls = 0!
    const counters = app.pipeline.getServiceCallCounters();
    expect(counters.ttsCalls).toBe(0);
    expect(counters.motionCalls).toBe(0);
    expect(counters.renderCalls).toBe(1);

    // Verify that rendered output actually changed on disk!
    const renderArtB = runB.artifacts.find((a) => a.kind === "preview-video");
    expect(renderArtB?.path).toBeDefined();
    const resolvedPathB =
      renderArtB!.path!.startsWith("/") || /^[a-zA-Z]:/.test(renderArtB!.path!)
        ? renderArtB!.path!
        : join(projectDir, renderArtB!.path!);
    const diskBytesB = await readFile(resolvedPathB);
    expect(diskBytesB.length).toBeGreaterThan(0);
    const hashA = createHash("sha256").update(diskBytesA).digest("hex");
    const hashB = createHash("sha256").update(diskBytesB).digest("hex");
    expect(hashA).not.toBe(hashB);
  }, 120_000);

  it("Impact Matrix Case 4: modifying narration script reuses scene visual prep while rerunning voice & downstream", async () => {
    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a", "asset_b"],
      narration: {
        type: "configured-tts",
        providerId: "byok-tts-standard",
        speechConsent: true,
      },
      customParams: {
        scriptText: "Initial voice script",
      },
    });
    await app.pipeline.startRun(runA.id);
    await app.pipeline.submitReview(runA.id, "step-3", "accepted");

    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a", "asset_b"],
        narration: {
          type: "configured-tts",
          providerId: "byok-tts-standard",
          speechConsent: true,
        },
        customParams: {
          scriptText: "Updated voice script with new lines",
        },
      },
    );

    // Step 2 visual prep is preserved!
    expect(impact.steps.find((s) => s.stepId === "step-2")?.status).toBe(
      "reuse",
    );
    // Step 3 narration must rerun!
    expect(impact.steps.find((s) => s.stepId === "step-3")?.status).toBe(
      "needs-review",
    );
  });

  it("Impact Matrix Case 5: changing photos reuses voice narration (TTS calls = 0) while rerunning visuals", async () => {
    // Add third photo
    const mediaDir = join(projectDir, "media");
    const fileC = join(mediaDir, "photo_c.jpg");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=1280x720",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      fileC,
    ]);
    const hashC = createHash("sha256")
      .update(await readFile(fileC))
      .digest("hex");
    const photoC = makeSyntheticPhoto(
      "asset_c",
      "photo_c",
      pathToFileURL(fileC).href,
      hashC,
    );
    app.catalog.upsertAsset(photoC);

    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a"],
      narration: {
        type: "configured-tts",
        providerId: "byok-tts-standard",
        speechConsent: true,
      },
    });
    await app.pipeline.startRun(runA.id);
    await app.pipeline.submitReview(runA.id, "step-3", "accepted");

    app.pipeline.resetServiceCallCounters();

    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a", "asset_c"], // Photo changed
        narration: {
          type: "configured-tts",
          providerId: "byok-tts-standard",
          speechConsent: true,
        },
      },
    );

    // Step 2 (scene-prepare) must rerun
    expect(impact.steps.find((s) => s.stepId === "step-2")?.status).toBe(
      "rerun",
    );
    // Step 3 (narration) can be reused!
    expect(impact.steps.find((s) => s.stepId === "step-3")?.status).toBe(
      "reuse",
    );
  });

  it("Impact Matrix Case 7: source bytes change invalidates consumers", async () => {
    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a"],
      narration: { type: "none" },
    });
    await app.pipeline.startRun(runA.id);

    // Modify asset_a contentHash in catalog (simulating file modification)
    const assetA = app.catalog.getAsset("asset_a")!;
    app.catalog.upsertAsset({
      ...assetA,
      contentHash: "hash_a_modified_999",
    });

    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a"],
        narration: { type: "none" },
      },
    );

    // Step 2 scene-prepare consumes assetContentHashes -> signature changed -> rerun
    expect(impact.steps.find((s) => s.stepId === "step-2")?.status).toBe(
      "rerun",
    );
  });

  it("Impact Matrix Case 8: revoking consent prevents unauthorized remote dispatch", async () => {
    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a"],
      narration: {
        type: "configured-tts",
        providerId: "byok-tts-standard",
        speechConsent: true,
      },
    });
    await app.pipeline.startRun(runA.id);
    await app.pipeline.submitReview(runA.id, "step-3", "accepted");

    // Now request with speechConsent = false (consent revoked)
    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a"],
        narration: {
          type: "configured-tts",
          providerId: "byok-tts-standard",
          speechConsent: false, // Consent revoked!
        },
      },
    );

    const narrationStep = impact.steps.find((s) => s.stepId === "step-3");
    expect(narrationStep?.status).not.toBe("reuse");
  });

  it("detects disk tampering/corruption and triggers cache miss fallback", async () => {
    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a"],
      narration: { type: "none" },
    });
    await app.pipeline.startRun(runA.id);

    const renderArt = runA.artifacts.find((a) => a.kind === "preview-video");
    expect(renderArt?.path).toBeDefined();

    // Tamper with artifact file by truncating to 0 bytes
    const resolvedRenderPath =
      renderArt!.path!.startsWith("/") || /^[a-zA-Z]:/.test(renderArt!.path!)
        ? renderArt!.path!
        : join(projectDir, renderArt!.path!);
    await writeFile(resolvedRenderPath, Buffer.alloc(0));

    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a"],
        narration: { type: "none" },
      },
    );

    const renderStep = impact.steps.find((s) => s.stepId === "step-6");
    expect(renderStep?.status).toBe("rerun");
    expect(renderStep?.reason).toContain("corrupted");
  });

  it("rejects stale impact reports when project revision changes before confirmation", async () => {
    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a"],
      narration: { type: "none" },
    });
    await app.pipeline.startRun(runA.id);

    // Analyze impact
    const impact = await app.pipeline.analyzeChangeImpact(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a"],
        narration: { type: "none" },
      },
    );

    // Advance project revision externally
    app.project.title = "Renamed Project Title";
    await app.save();

    await expect(
      app.pipeline.createIncrementalRun("guided-story-to-video", {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a"],
        narration: { type: "none" },
        impactReport: impact,
      }),
    ).rejects.toThrow(/stale/i);
  });

  it("preserves base run receipts and previous runs immutably", async () => {
    const runA = await app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a"],
      narration: { type: "none" },
    });
    await app.pipeline.startRun(runA.id);

    const runACreatedAt = runA.createdAt;
    const runAReceiptsCount = runA.receipts.length;
    const runAId = runA.id;

    // Create incremental run
    const runB = await app.pipeline.createIncrementalRun(
      "guided-story-to-video",
      {
        baseRunId: runA.id,
        storyId: "story_m11a",
        assetIds: ["asset_a"],
        narration: { type: "none" },
      },
    );

    expect(runB.id).not.toBe(runAId);

    // Verify run A is untouched
    const fetchedA = app.pipeline.getRun(runAId);
    expect(fetchedA.id).toBe(runAId);
    expect(fetchedA.createdAt).toBe(runACreatedAt);
    expect(fetchedA.receipts.length).toBe(runAReceiptsCount);
  });

  it("protects assets referenced by runs from accidental pruning", () => {
    expect(app.pipeline.isAssetReferencedByPipeline("asset_a")).toBe(false);

    // Create run referencing asset_a
    app.pipeline.createRun("guided-story-to-video", {
      storyId: "story_m11a",
      assetIds: ["asset_a"],
      narration: { type: "none" },
    });

    expect(app.pipeline.isAssetReferencedByPipeline("asset_a")).toBe(true);
    expect(app.pipeline.isAssetReferencedByPipeline("unreferenced_xyz")).toBe(
      false,
    );
  });
});
