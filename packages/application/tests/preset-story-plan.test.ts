// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import type { PresetApplyInput } from "@openfilm/core";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
const apps = new Set<OpenFilmApplication>(),
  roots: string[] = [];
afterEach(() => {
  for (const a of apps) a.close();
  apps.clear();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
async function fixture() {
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
  for (const id of ["a", "b", "c"]) {
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
