// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import {
  createInitialStoryGraph,
  projectPresetSnapshots,
  PRESET_LIMITS,
  type PresetApplyInput,
} from "@openfilm/core";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
const apps = new Set<OpenFilmApplication>(),
  roots: string[] = [];
afterEach(() => {
  for (const a of apps) a.close();
  apps.clear();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
async function fixture(extraGraphSource = false) {
  const root = mkdtempSync(join(tmpdir(), "openfilm-preset-story-"));
  roots.push(root);
  const directory = join(root, "Film.openfilm"),
    userDataDirectory = join(root, "user"),
    app = await OpenFilmApplication.create(
      directory,
      "Story",
      {},
      { userDataDirectory },
    );
  apps.add(app);
  for (const id of ["a", "b", "c", ...(extraGraphSource ? ["d"] : [])]) {
    const path = join(root, `${id}.png`);
    writeFileSync(path, `synthetic ${id}`);
    app.catalog.upsertAsset({
      id,
      name: id,
      uri: pathToFileURL(path).href,
      mediaType: "image",
      dimensions: { width: 320, height: 180 },
      contentHash: createHash("sha256")
        .update(readFileSync(path))
        .digest("hex"),
      tags: [],
      state: {},
      metadata: {},
    });
  }
  app.project.stories.push({
    id: "source",
    title: "Original authored film",
    targetDuration: 6,
    maxDuration: 12,
    beats: ["a", "b", "c"].map((id) => ({
      id: `beat-${id}`,
      title: id,
      targetDuration: 2,
      minDuration: 1,
      maxDuration: 4,
      selectedAssetIds: [id],
      candidateAssetIds: [id],
      constraints: [
        { type: "must-include", assetIds: [id] },
        { type: "asset-order", assetIds: [id] },
      ],
    })),
  });
  if (extraGraphSource) {
    const source = app.project.stories[0]!;
    source.beats[0]!.candidateAssetIds!.push("d");
    source.graph = createInitialStoryGraph(source, app.catalog.listAssets());
    source.graph.nodes.push({
      id: "extra-node-d",
      type: "asset",
      assetId: "d",
    });
    source.graph.edges.push({
      id: "extra-edge-d",
      type: "supports",
      from: "beat-node-beat-a",
      to: "extra-node-d",
    });
  }
  app.compose("source");
  await app.save();
  const document = JSON.stringify(presetPackage()),
    r = app.presets.registry.reviewImport(document),
    v = await app.presets.registry.install({
      document,
      packageSha256: r.packageSha256,
      baseRegistryRevision: r.registryRevision,
      reviewSha256: r.reviewSha256,
      acknowledgeLicense: true,
    }),
    p = v.packages[0]!,
    editor = new TimelineEditor(app);
  const request: PresetApplyInput = {
    projectId: app.project.id,
    baseRevision: app.versions.currentRevision(),
    selection: {
      canonicalId: p.entrySummaries.find((e) => e.kind === "story")!
        .canonicalId,
      packageSha256: p.packageSha256,
      registryRevision: v.revision,
    },
    target: {
      kind: "story",
      storyId: "source",
      bindings: ["begin", "middle", "end"].map((recipeBeatKey, i) => ({
        recipeBeatKey,
        beatId: `beat-${["a", "b", "c"][i]}`,
      })),
      options: { targetDuration: 6, maxDuration: 12, transition: "cut" },
    },
  };
  return { app, editor, request, directory, userDataDirectory };
}
it("previews without adding a graph or touching disk, adopts protected source beats as one new cut", async () => {
  const { app, editor, request, directory } = await fixture(),
    before = structuredClone(app.project),
    bytes = readFileSync(join(directory, "project.json")),
    r = app.presets.review(request, editor);
  expect(app.project).toEqual(before);
  expect(readFileSync(join(directory, "project.json"))).toEqual(bytes);
  const result = await app.presets.accept(
    { request, reviewSha256: r.reviewSha256, requestId: "story-once" },
    editor,
  );
  expect(app.project.stories[0]).toEqual(before.stories[0]);
  expect(app.project.timelines[0]).toEqual(before.timelines[0]);
  const adopted = app.project.stories.find(
    (s) => s.id === result.result.storyId,
  )!;
  expect(adopted.presetSnapshot?.kind).toBe("story");
  for (let i = 0; i < 3; i++) {
    expect(adopted.beats[i]!.constraints).toEqual(
      before.stories[0]!.beats[i]!.constraints,
    );
    expect(adopted.beats[i]!.minDuration).toBe(1);
    expect(adopted.beats[i]!.selectedAssetIds).toEqual(
      before.stories[0]!.beats[i]!.selectedAssetIds,
    );
  }
  expect(app.project.timelines).toHaveLength(2);
});
it("catalog hash or lock changes without a graph edit stale the reviewed plan", async () => {
  const { app, editor, request } = await fixture(),
    r = app.presets.review(request, editor),
    asset = app.catalog.getAsset("b")!;
  app.catalog.upsertAsset({
    ...asset,
    state: { locked: true },
    contentHash: "f".repeat(64),
  });
  await expect(
    app.presets.accept(
      { request, reviewSha256: r.reviewSha256, requestId: "stale-source" },
      editor,
    ),
  ).rejects.toMatchObject({ code: "presets.stale" });
  expect(app.project.timelines).toHaveLength(1);
  expect(app.project.presetApplicationReceipts).toBeUndefined();
});
it("the StoryPlan owner rejects a forged reviewed asset list and the generic acceptance bypass", async () => {
  const { app, editor, request } = await fixture(),
    review = app.presets.review(request, editor),
    plan = structuredClone(review.plan!);
  const receipt = app.presets.receipt(
    { request, reviewSha256: review.reviewSha256, requestId: "forged" },
    review,
    { storyId: "source", compositionId: "pending" },
    "0".repeat(64),
  );
  plan.scenes[0]!.assets = [];
  expect(() => app.storyPlan.acceptPresetPlan("source", plan, receipt)).toThrow(
    /changed|exact/,
  );
  expect(() => app.storyPlan.acceptPlan("source", review.plan!)).toThrow(
    /preset acceptance owner/,
  );
  expect(app.project.timelines).toHaveLength(1);
  expect(app.project.presetApplicationReceipts).toBeUndefined();
});
it("retries after reopen/uninstall return the same cut and saved locale text needs no registry", async () => {
  const { app, editor, request, directory, userDataDirectory } =
      await fixture(),
    r = app.presets.review(request, editor),
    accept = {
      request,
      reviewSha256: r.reviewSha256,
      requestId: "story-retry",
    },
    result = await app.presets.accept(accept, editor),
    v = app.presets.registry.list(),
    p = v.packages[0]!;
  await app.presets.registry.remove({
    packageId: p.id,
    packageVersion: p.version,
    packageSha256: p.packageSha256,
    baseRegistryRevision: v.revision,
  });
  app.close();
  apps.delete(app);
  const reopened = await OpenFilmApplication.open(directory, {
    userDataDirectory,
  });
  apps.add(reopened);
  const again = await reopened.presets.accept(
    accept,
    new TimelineEditor(reopened),
  );
  expect(again.result).toEqual(result.result);
  expect(reopened.project.timelines).toHaveLength(2);
  reopened.updateFilm({ projectContentLocale: "zh-TW" });
  expect(
    reopened.project.stories.find((s) => s.id === result.result.storyId)!
      .beats[0]!.title,
  ).toBe("begin 記憶");
});

it("preserves each reviewed scene occurrence despite an existing narrower source selection", async () => {
  const { app, editor, request } = await fixture(true);
  const review = app.presets.review(request, editor);
  expect(review.plan!.scenes[0]!.assets.map((a) => a.assetId)).toEqual([
    "a",
    "d",
  ]);
  expect(
    review
      .compositionPreview!.tracks.flatMap((t) => t.clips)
      .map((c) => c.assetId),
  ).toEqual(["a", "d", "b", "c"]);
  const accepted = await app.presets.accept(
    {
      request,
      reviewSha256: review.reviewSha256,
      requestId: "all-occurrences",
    },
    editor,
  );
  const cut = app.project.timelines.find(
    (c) => c.id === accepted.result.compositionId,
  )!;
  for (const [i, scene] of review.plan!.scenes.entries()) {
    const story = app.project.stories.find(
      (s) => s.id === accepted.result.storyId,
    )!;
    expect(
      cut.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.beatId === story.beats[i]!.id)
        .map((c) => c.assetId),
    ).toEqual(scene.assets.map((a) => a.assetId));
  }
  expect(app.project.stories[0]!.beats[0]!.selectedAssetIds).toEqual(["a"]);
});
it.each(["duration", "order", "duplicate-graph-node"] as const)(
  "fails closed for unrepresentable %s assignments",
  async (kind) => {
    const { app, editor, request } = await fixture(true),
      source = app.project.stories[0]!;
    if (kind === "duration") {
      source.beats[0]!.maxDuration = 1.5;
      source.beats[0]!.targetDuration = 1.5;
    }
    if (kind === "order")
      source.beats[0]!.constraints!.push({
        type: "asset-order",
        assetIds: ["d", "a"],
      });
    if (kind === "duplicate-graph-node") {
      source.graph!.nodes.push({
        id: "duplicate-d",
        type: "asset",
        assetId: "d",
      });
      source.graph!.edges.push({
        id: "duplicate-edge-d",
        type: "supports",
        from: "beat-node-beat-a",
        to: "duplicate-d",
      });
    }
    await app.save();
    request.baseRevision = app.versions.currentRevision();
    expect(() => app.presets.review(request, editor)).toThrow();
    expect(app.project.timelines).toHaveLength(1);
    expect(app.project.presetApplicationReceipts).toBeUndefined();
  },
);
it("ordinary compose snapshots survive registry removal/reopen and JSON/OTIO without aliases", async () => {
  const { app, editor, request, directory, userDataDirectory } =
    await fixture();
  const review = app.presets.review(request, editor);
  const accepted = await app.presets.accept(
    { request, reviewSha256: review.reviewSha256, requestId: "mirror" },
    editor,
  );
  const story = app.project.stories.find(
    (s) => s.id === accepted.result.storyId,
  )!;
  const beforeCount = projectPresetSnapshots(app.project).length;
  const cut = app.compose(story.id),
    next = app.compose(story.id);
  expect(cut.storyPresetSnapshot).toEqual(story.presetSnapshot);
  expect(next.storyPresetSnapshot).toEqual(story.presetSnapshot);
  expect(projectPresetSnapshots(app.project)).toHaveLength(beforeCount + 2);
  const originals = app.project.timelines.filter((c) => c.storyId === story.id);
  for (const composition of originals)
    expect(composition.storyPresetSnapshot).not.toBe(story.presetSnapshot);
  expect(originals[1]!.storyPresetSnapshot).not.toBe(
    originals[2]!.storyPresetSnapshot,
  );
  const view = app.presets.registry.list(),
    p = view.packages[0]!;
  await app.presets.registry.remove({
    packageId: p.id,
    packageVersion: p.version,
    packageSha256: p.packageSha256,
    baseRegistryRevision: view.revision,
  });
  app.close();
  apps.delete(app);
  const reopened = await OpenFilmApplication.open(directory, {
    userDataDirectory,
  });
  apps.add(reopened);
  for (const format of ["json", "otio"] as const) {
    const exported = await reopened.exportWithReport(format, cut.id);
    const payload = JSON.parse(readFileSync(exported.path, "utf8"));
    const composition =
      format === "otio"
        ? payload.metadata.openfilm.composition
        : payload.composition;
    expect(composition.storyPresetSnapshot).toEqual(story.presetSnapshot);
  }
});

it("ordinary compose validates cryptographic provenance and the aggregate snapshot budget before publication", async () => {
  const { app, editor, request, directory } = await fixture();
  const review = app.presets.review(request, editor);
  const accepted = await app.presets.accept(
    { request, reviewSha256: review.reviewSha256, requestId: "bounded-mirror" },
    editor,
  );
  const story = app.project.stories.find(
    (s) => s.id === accepted.result.storyId,
  )!;
  const snapshot = structuredClone(story.presetSnapshot!),
    bytes = readFileSync(join(directory, "project.json"));
  story.presetSnapshot!.recipe.beats[0]!.weight = 9;
  expect(() => app.compose(story.id)).toThrow(/hash|integrity/);
  expect(readFileSync(join(directory, "project.json"))).toEqual(bytes);
  story.presetSnapshot = snapshot;
  const cut = app.project.timelines.find(
    (c) => c.id === accepted.result.compositionId,
  )!;
  app.project.timelines = [
    app.project.timelines[0]!,
    ...Array.from({ length: PRESET_LIMITS.projectSnapshots - 1 }, (_, i) => ({
      ...structuredClone(cut),
      id: `bounded-cut-${i}`,
    })),
  ];
  await app.save();
  const full = structuredClone(app.project),
    disk = readFileSync(join(directory, "project.json"));
  expect(() => app.compose(story.id)).toThrow(/snapshot budget/);
  expect(app.project).toEqual(full);
  expect(readFileSync(join(directory, "project.json"))).toEqual(disk);
});
