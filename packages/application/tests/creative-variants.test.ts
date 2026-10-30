// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.

import { rm, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "../src/index.js";
import { isRunOutdated } from "@openfilm/core";
import type { MediaAsset, Story, Composition } from "@openfilm/core";

function makeSyntheticPhoto(id: string, name: string, uri: string): MediaAsset {
  return {
    id,
    uri,
    mediaType: "image",
    name,
    tags: ["memory"],
    state: {},
    metadata: { width: 1920, height: 1080 },
    duration: 5,
  };
}

describe("Creative Variants Application Service", () => {
  let projectDir: string;
  let app: OpenFilmApplication;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "openfilm-variants-test-"));
    app = await OpenFilmApplication.create(
      projectDir,
      "Creative Variants Film",
    );

    const mediaDir = join(projectDir, "media");
    await mkdir(mediaDir, { recursive: true });
    const file1 = join(mediaDir, "p1.jpg");
    const file2 = join(mediaDir, "p2.jpg");
    const file3 = join(mediaDir, "p3.jpg");
    const file4 = join(mediaDir, "p4.jpg");
    await writeFile(file1, Buffer.alloc(100));
    await writeFile(file2, Buffer.alloc(100));
    await writeFile(file3, Buffer.alloc(100));
    await writeFile(file4, Buffer.alloc(100));

    const photo1 = makeSyntheticPhoto(
      "asset-1",
      "Photo 1",
      pathToFileURL(file1).href,
    );
    const photo2 = makeSyntheticPhoto(
      "asset-2",
      "Photo 2",
      pathToFileURL(file2).href,
    );
    const photo3 = makeSyntheticPhoto(
      "asset-3",
      "Photo 3",
      pathToFileURL(file3).href,
    );
    const photo4 = makeSyntheticPhoto(
      "asset-4",
      "Photo 4 (Alternative)",
      pathToFileURL(file4).href,
    );

    app.catalog.upsertAsset(photo1);
    app.catalog.upsertAsset(photo2);
    app.catalog.upsertAsset(photo3);
    app.catalog.upsertAsset(photo4);

    const baseStory: Story = {
      id: "story-base-1",
      title: "京都之行",
      targetDuration: 15,
      beats: [
        {
          id: "beat-1",
          title: "清晨啟程",
          targetDuration: 5,
          selectedAssetIds: ["asset-1"],
          candidateAssetIds: ["asset-1"],
          script: {
            narration: "清晨出發前往京都",
            visualDirection: "緩慢推近",
          },
        },
        {
          id: "beat-2",
          title: "漫步小徑",
          targetDuration: 5,
          selectedAssetIds: ["asset-2"],
          candidateAssetIds: ["asset-2"],
          script: {
            narration: "陽光灑在石板路上",
            visualDirection: "水平平移",
          },
        },
        {
          id: "beat-3",
          title: "夕陽賦歸",
          targetDuration: 5,
          selectedAssetIds: ["asset-3"],
          candidateAssetIds: ["asset-3"],
          script: {
            narration: "依依不捨告別古都",
            visualDirection: "定格拉遠",
          },
        },
      ],
    };

    const baseComp: Composition = {
      id: "comp-base-1",
      storyId: "story-base-1",
      duration: 15,
      tracks: [
        {
          id: "track-v1",
          type: "video",
          clips: [
            {
              id: "clip-1",
              beatId: "beat-1",
              assetId: "asset-1",
              timelineStart: 0,
              timelineDuration: 5,
              sourceIn: 0,
              sourceOut: 5,
              locked: false,
            },
            {
              id: "clip-2",
              beatId: "beat-2",
              assetId: "asset-2",
              timelineStart: 5,
              timelineDuration: 5,
              sourceIn: 0,
              sourceOut: 5,
              locked: false,
            },
            {
              id: "clip-3",
              beatId: "beat-3",
              assetId: "asset-3",
              timelineStart: 10,
              timelineDuration: 5,
              sourceIn: 0,
              sourceOut: 5,
              locked: false,
            },
          ],
        },
      ],
    };

    app.project.stories = [baseStory];
    app.project.timelines = [baseComp];
    await app.save();
  });

  afterEach(async () => {
    try {
      app.catalog.close();
    } catch {
      // Ignore if already closed
    }
    await rm(projectDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  });

  it("pinned occurrences retain exact payload and detached graph in duration variants", async () => {
    const baseline = app.project.timelines[0]!;
    const pinned = baseline.tracks[0]!.clips[1]!;
    pinned.userOverrides = {
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["timing"],
    };
    baseline.graphicScenes = [
      {
        version: 1,
        id: "graphic",
        name: "Graphic",
        start: 0,
        duration: 1,
        zIndex: 0,
        nodes: [],
      },
    ];
    app.project.schemaVersion = "1.1.0";
    await app.save();
    const snapshot = structuredClone(baseline);
    const variant = await app.creativeVariants.createVariant({
      name: "Pinned version",
      intent: "Shorter",
      scope: { type: "film" },
      modifications: { durationMultiplier: 0.8 },
    });
    const derived = app.project.timelines.find(
      (c) => c.id === variant.derivedCompositionId,
    )!;
    const mapping = variant.provenanceMapping.clipMappings.find(
      (m) => m.baselineClipId === pinned.id,
    )!;
    const copy = derived.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === mapping.variantClipId)!;
    expect(copy.timelineStart).toBe(pinned.timelineStart);
    expect(copy.timelineDuration).toBe(pinned.timelineDuration);
    expect(copy.sourceIn).toBe(pinned.sourceIn);
    expect(copy.sourceOut).toBe(pinned.sourceOut);
    expect(copy.userOverrides).toEqual(pinned.userOverrides);
    expect(copy.userOverrides).not.toBe(pinned.userOverrides);
    expect(derived.graphicScenes).not.toBe(baseline.graphicScenes);
    copy.userOverrides!.isUserPinned = false;
    derived.graphicScenes![0]!.name = "Derived only";
    expect(baseline).toEqual(snapshot);
  });
  it("section membership uses occurrence beat identity when one source repeats", async () => {
    const baseline = app.project.timelines[0]!;
    const first = baseline.tracks[0]!.clips[0]!,
      second = baseline.tracks[0]!.clips[1]!;
    second.assetId = first.assetId;
    app.project.stories[0]!.beats[1]!.selectedAssetIds = [first.assetId];
    await app.save();
    const variant = await app.creativeVariants.createVariant({
      name: "Repeated source",
      intent: "Section",
      scope: { type: "section", targetBeatId: "beat-2" },
      modifications: { targetDuration: 2 },
    });
    const derived = app.project.timelines.find(
      (c) => c.id === variant.derivedCompositionId,
    )!;
    const map = new Map(
      variant.provenanceMapping.clipMappings.map((m) => [
        m.baselineClipId,
        m.variantClipId,
      ]),
    );
    expect(
      derived.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === map.get(first.id))!.timelineDuration,
    ).toBe(first.timelineDuration);
    expect(
      derived.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === map.get(second.id))!.timelineDuration,
    ).toBe(2);
  });

  it("missing or ambiguous section ownership fails without inferring repeated assets", async () => {
    const comp = app.project.timelines[0]!;
    for (const clip of comp.tracks[0]!.clips) delete clip.beatId;
    comp.tracks[0]!.clips[1]!.assetId = comp.tracks[0]!.clips[0]!.assetId;
    await app.save();
    const before = structuredClone(app.project);
    await expect(
      app.creativeVariants.createVariant({
        name: "Ambiguous",
        intent: "Section",
        scope: { type: "section", targetBeatId: "beat-2" },
        modifications: { targetDuration: 2 },
      }),
    ).rejects.toMatchObject({ code: "timeline.pinConflict" });
    expect(app.project).toEqual(before);
  });
  it("impossible pinned replacement fails before creating any derived cut", async () => {
    const clip = app.project.timelines[0]!.tracks[0]!.clips[1]!;
    clip.userOverrides = {
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["timing"],
    };
    app.project.schemaVersion = "1.1.0";
    await app.save();
    const before = structuredClone(app.project);
    await expect(
      app.creativeVariants.createVariant({
        name: "Impossible",
        intent: "Replace",
        scope: { type: "section", targetBeatId: "beat-2" },
        modifications: {
          replaceAssetIds: [{ fromAssetId: "asset-2", toAssetId: "asset-4" }],
        },
      }),
    ).rejects.toMatchObject({ code: "timeline.pinConflict" });
    expect(app.project).toEqual(before);
  });

  it("previews variant impact and proves section isolation before creation", () => {
    const report = app.creativeVariants.previewVariantImpact({
      name: "方案 B",
      intent: "加快小徑節奏與 AI 智能調色",
      scope: { type: "section", targetBeatId: "beat-2" },
      modifications: {
        targetDuration: 3,
        replaceAssetIds: [{ fromAssetId: "asset-2", toAssetId: "asset-4" }],
      },
    });

    expect(report.scope.type).toBe("section");
    // Sections other than beat-2 must be preserved
    expect(report.preservedSections).toEqual(
      expect.arrayContaining([
        { sectionId: "beat-1", type: "beat", unchanged: true },
        { sectionId: "beat-3", type: "beat", unchanged: true },
        { sectionId: "clip-1", type: "clip", unchanged: true },
        { sectionId: "clip-3", type: "clip", unchanged: true },
      ]),
    );

    // Unsupported free text intent preserved as creative brief
    expect(report.unsupportedIntents).toContain("加快小徑節奏與 AI 智能調色");
  });

  it("creates a variant with 'section' scope and proves all other sections remain 100% unchanged", async () => {
    const variant = await app.creativeVariants.createVariant({
      name: "細節聚焦版",
      intent: "加強段落 2 特寫細節",
      scope: { type: "section", targetBeatId: "beat-2" },
      modifications: {
        targetDuration: 4,
        narration: "細看古老石碑上的青苔痕跡",
        replaceAssetIds: [{ fromAssetId: "asset-2", toAssetId: "asset-4" }],
      },
    });

    expect(variant.status).toBe("draft");
    expect(variant.scope.type).toBe("section");

    const derivedStory = app.project.stories.find(
      (s) => s.id === variant.derivedStoryId,
    );
    expect(derivedStory).toBeDefined();
    expect(derivedStory?.beats).toHaveLength(3);

    // Section 1: Exactly unchanged
    const beat1 = derivedStory!.beats[0]!;
    expect(beat1.title).toBe("清晨啟程");
    expect(beat1.targetDuration).toBe(5);
    expect(beat1.selectedAssetIds).toEqual(["asset-1"]);
    expect(beat1.script?.narration).toBe("清晨出發前往京都");

    // Section 2: Modified
    const beat2 = derivedStory!.beats[1]!;
    expect(beat2.targetDuration).toBe(4);
    expect(beat2.selectedAssetIds).toEqual(["asset-4"]);
    expect(beat2.script?.narration).toBe("細看古老石碑上的青苔痕跡");

    // Section 3: Exactly unchanged
    const beat3 = derivedStory!.beats[2]!;
    expect(beat3.title).toBe("夕陽賦歸");
    expect(beat3.targetDuration).toBe(5);
    expect(beat3.selectedAssetIds).toEqual(["asset-3"]);
    expect(beat3.script?.narration).toBe("依依不捨告別古都");

    // Composition verification
    const derivedComp = app.project.timelines.find(
      (t) => t.id === variant.derivedCompositionId,
    );
    expect(derivedComp).toBeDefined();
    const clips = derivedComp!.tracks[0]!.clips;
    expect(clips).toHaveLength(3);

    // Clip 1 unchanged
    expect(clips[0]!.assetId).toBe("asset-1");
    expect(clips[0]!.timelineStart).toBe(0);
    expect(clips[0]!.timelineDuration).toBe(5);

    // Clip 2 modified (duration 4, asset-4)
    expect(clips[1]!.assetId).toBe("asset-4");
    expect(clips[1]!.timelineStart).toBe(5);
    expect(clips[1]!.timelineDuration).toBe(4);

    // Clip 3 unchanged content, start rippled from 10 to 9
    expect(clips[2]!.assetId).toBe("asset-3");
    expect(clips[2]!.timelineStart).toBe(9);
    expect(clips[2]!.timelineDuration).toBe(5);
    expect(derivedComp!.duration).toBe(14);
  });

  it("strictly preserves edit locks and refuses modifying locked sections without unlock", async () => {
    // Lock clip-2 in baseline
    app.project.timelines[0]!.tracks[0]!.clips[1]!.locked = true;
    await app.save();

    // 1. Attempting to modify locked section must fail
    await expect(
      app.creativeVariants.createVariant({
        name: "修改鎖定段落",
        intent: "嘗試變更被鎖定的段落",
        scope: { type: "section", targetBeatId: "beat-2" },
        modifications: { targetDuration: 3 },
      }),
    ).rejects.toThrow(/locked/i);

    // 2. Modifying non-locked section-3 succeeds AND preserves lock on clip-2!
    const variant = await app.creativeVariants.createVariant({
      name: "修改第 3 段",
      intent: "縮短第 3 段",
      scope: { type: "section", targetBeatId: "beat-3" },
      modifications: { targetDuration: 2 },
    });

    const derivedComp = app.project.timelines.find(
      (t) => t.id === variant.derivedCompositionId,
    );
    expect(derivedComp).toBeDefined();
    // Cloned clip-2 MUST preserve locked = true!
    expect(derivedComp!.tracks[0]!.clips[1]!.locked).toBe(true);
  });

  it("compares variants A and B without triggering rendering", async () => {
    const variantA = await app.creativeVariants.createVariant({
      name: "方案 A",
      intent: "原版微調",
      scope: { type: "film" },
    });

    const variantB = await app.creativeVariants.createVariant({
      name: "方案 B",
      intent: "加快節奏",
      scope: { type: "section", targetBeatId: "beat-2" },
      modifications: { targetDuration: 3 },
    });

    const comparison = await app.creativeVariants.compareVariants(
      variantA.id,
      variantB.id,
    );
    expect(comparison.diff.deltaSeconds).toBe(-2);
    expect(comparison.diff.summary.beatsChanged).toBe(1);
    expect(comparison.variantA.status).toBe("compared");
    expect(comparison.variantB.status).toBe("compared");
  });

  it("adopts a variant with pre-adoption checkpoint and updates active composition", async () => {
    const variant = await app.creativeVariants.createVariant({
      name: "採用方案",
      intent: "準備採用的優秀方案",
      scope: { type: "section", targetBeatId: "beat-1" },
      modifications: { targetDuration: 4 },
    });

    const initialRevision = app.versions.currentRevision();

    const result = await app.creativeVariants.adoptVariant(variant.id, {
      expectedRevision: initialRevision,
    });

    expect(result.checkpointVersionId).toBeDefined();
    // Active composition (timelines[0]) is now the variant's derived composition
    expect(result.project.timelines[0]!.id).toBe(variant.derivedCompositionId);
    // Baseline composition is preserved
    expect(result.project.timelines.map((t) => t.id)).toContain("comp-base-1");

    const reloaded = await app.creativeVariants.getVariant(variant.id);
    expect(reloaded.status).toBe("adopted");
  });

  it("safely aborts adoption and leaves project untouched if checkpoint fails", async () => {
    const variant = await app.creativeVariants.createVariant({
      name: "測試中斷",
      intent: "檢查點失敗時安全回退",
      scope: { type: "film" },
    });

    // Mock versions.create to fail
    const originalCreate = app.versions.create.bind(app.versions);
    app.versions.create = async () => {
      throw new Error("Disk full: simulated checkpoint write error");
    };

    const originalActiveCompId = app.project.timelines[0]!.id;

    await expect(app.creativeVariants.adoptVariant(variant.id)).rejects.toThrow(
      /Disk full/,
    );

    // Active composition unchanged
    expect(app.project.timelines[0]!.id).toBe(originalActiveCompId);

    // Restore original create
    app.versions.create = originalCreate;
  });

  it("reverts checkpoint and flags old runs/approvals as outdated after restore", async () => {
    const variant = await app.creativeVariants.createVariant({
      name: "準備還原之方案",
      intent: "測試版本還原保護",
      scope: { type: "film" },
    });

    // Adopt to create checkpoint
    const adoptRes = await app.creativeVariants.adoptVariant(variant.id);
    const checkpointId = adoptRes.checkpointVersionId;

    // Create a pipeline run under the adopted state
    const run = await app.pipeline.createRun("guided-story-to-video", {
      compositionTarget: { version: 1, mode: "new-cut" },
      storyId: variant.derivedStoryId,
      assetIds: ["asset-1", "asset-2"],
    });

    expect(isRunOutdated(run, app.pipeline.getCurrentProjectRevision())).toBe(
      false,
    );

    // Restore baseline from checkpoint
    await app.creativeVariants.restoreBaseline(variant.id, checkpointId);

    // Post-restore protection: old run is now strictly outdated!
    expect(isRunOutdated(run, app.pipeline.getCurrentProjectRevision())).toBe(
      true,
    );
  });

  it("deleting a variant removes derived entities without deleting shared catalog media", async () => {
    const variant = await app.creativeVariants.createVariant({
      name: "臨時草案",
      intent: "測試刪除後素材保護",
      scope: { type: "film" },
    });

    const assetCountBefore = app.catalog.listAssets().length;

    await app.creativeVariants.deleteVariant(variant.id);

    const variants = await app.creativeVariants.listVariants();
    expect(variants.find((v) => v.id === variant.id)).toBeUndefined();

    // Derived composition removed
    expect(
      app.project.timelines.find((t) => t.id === variant.derivedCompositionId),
    ).toBeUndefined();

    // SHARED ASSET PROTECTION: Media catalog remains 100% intact!
    const assetCountAfter = app.catalog.listAssets().length;
    expect(assetCountAfter).toBe(assetCountBefore);
    expect(app.catalog.getAsset("asset-1")).toBeDefined();
    expect(app.catalog.getAsset("asset-2")).toBeDefined();
  });

  it("collects media strictly for the selected variant without packing private assets from other variants", async () => {
    // Variant B uses asset-4 and does NOT use asset-2
    const variantB = await app.creativeVariants.createVariant({
      name: "隱私隔離方案 B",
      intent: "排除私人素材",
      scope: { type: "section", targetBeatId: "beat-2" },
      modifications: {
        replaceAssetIds: [{ fromAssetId: "asset-2", toAssetId: "asset-4" }],
      },
    });

    // 1. Plan collection with scope "current-film" for variant B's composition
    const plan = await app.collectMedia.plan({
      scope: "current-film",
      compositionId: variantB.derivedCompositionId,
    });

    expect(plan.items).toBeDefined();
    const plannedAssetIds = plan.items.map((i) => i.resourceId);

    // Variant B references asset-1, asset-4, asset-3
    expect(plannedAssetIds).toContain("asset:asset-1");
    expect(plannedAssetIds).toContain("asset:asset-4");
    expect(plannedAssetIds).toContain("asset:asset-3");

    // asset-2 was only in baseline and NOT in Variant B -> MUST NOT BE COLLECTED!
    expect(plannedAssetIds).not.toContain("asset:asset-2");
  });
});
