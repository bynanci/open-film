// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import { filmLookMatrix, type PresetApplyInput } from "@openfilm/core";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
const roots: string[] = [],
  apps = new Set<OpenFilmApplication>();
afterEach(() => {
  for (const app of apps) app.close();
  apps.clear();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
export async function presetApplicationFixture() {
  const root = mkdtempSync(join(tmpdir(), "openfilm-preset-apply-"));
  roots.push(root);
  const directory = join(root, "Film.openfilm"),
    userDataDirectory = join(root, "user"),
    source = join(root, "source.png");
  writeFileSync(source, "original synthetic source sentinel");
  const app = await OpenFilmApplication.create(
    directory,
    "Preset film",
    {},
    { userDataDirectory },
  );
  apps.add(app);
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.catalog.upsertAsset({
    id: "photo",
    uri: pathToFileURL(source).href,
    name: "Photo",
    mediaType: "image",
    dimensions: { width: 320, height: 180 },
    contentHash: createHash("sha256")
      .update(readFileSync(source))
      .digest("hex"),
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories.push({
    id: "story",
    title: "Authored",
    beats: [{ id: "beat", title: "記憶", selectedAssetIds: ["photo"] }],
  });
  app.project.timelines.push({
    id: "cut",
    storyId: "story",
    duration: 1,
    tracks: [
      {
        id: "pictures",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "photo",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 1,
            title: "記憶 Memories",
          },
        ],
      },
    ],
  });
  await app.save();
  const editor = new TimelineEditor(app),
    document = JSON.stringify(presetPackage()),
    review = app.presets.registry.reviewImport(document);
  const view = await app.presets.registry.install({
    document,
    packageSha256: review.packageSha256,
    baseRegistryRevision: review.registryRevision,
    reviewSha256: review.reviewSha256,
    acknowledgeLicense: true,
  });
  const request = (
    kind: "film-look" | "title" = "film-look",
  ): PresetApplyInput => ({
    projectId: app.project.id,
    selection: {
      canonicalId: view.packages[0]!.entrySummaries.find(
        (e) => e.kind === kind,
      )!.canonicalId,
      packageSha256: view.packages[0]!.packageSha256,
      registryRevision: view.revision,
    },
    baseRevision: editor.get("cut").revision,
    target:
      kind === "film-look"
        ? { kind, compositionId: "cut", scope: "film" }
        : { kind, compositionId: "cut", clipId: "clip" },
  });
  return { root, directory, userDataDirectory, source, app, editor, request };
}
it("review is detached; application uses one Undo/Redo unit with immutable snapshot and receipt", async () => {
  const { app, editor, request, source } = await presetApplicationFixture(),
    before = editor.get("cut"),
    bytes = readFileSync(source),
    input = request();
  const review = app.presets.review(input, editor);
  expect(editor.get("cut")).toEqual(before);
  expect(review.snapshot.kind).toBe("film-look");
  const result = await app.presets.accept(
    {
      request: input,
      reviewSha256: review.reviewSha256,
      requestId: "apply-once",
    },
    editor,
  );
  const state = editor.get("cut");
  expect(state.composition.defaultLook?.version).toBe(2);
  expect(filmLookMatrix(state.composition.defaultLook)[0]).toBeCloseTo(1.04);
  expect(result.alreadyAccepted).toBe(false);
  expect(app.project.presetApplicationReceipts).toHaveLength(1);
  await editor.undo("cut", state.revision);
  expect(editor.get("cut").composition).toEqual(before.composition);
  await editor.redo("cut", editor.get("cut").revision);
  expect(editor.get("cut").composition).toEqual(state.composition);
  expect(readFileSync(source)).toEqual(bytes);
});
it("exact retries acknowledge after Undo, removal and reopen without replaying", async () => {
  const { app, editor, request, directory, userDataDirectory } =
      await presetApplicationFixture(),
    input = request(),
    r = app.presets.review(input, editor),
    accept = {
      request: input,
      reviewSha256: r.reviewSha256,
      requestId: "retry-after-open",
    };
  const result = await app.presets.accept(accept, editor);
  await editor.undo("cut", editor.get("cut").revision);
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
  const nextEditor = new TimelineEditor(reopened);
  expect((await reopened.presets.accept(accept, nextEditor)).receipt).toEqual(
    result.receipt,
  );
  expect(nextEditor.get("cut").composition.defaultLook).toBeUndefined();
  expect(reopened.project.presetApplicationReceipts).toHaveLength(1);
});
it("changed request body or stale/removed registry cannot publish an edit or receipt", async () => {
  const { app, editor, request } = await presetApplicationFixture(),
    input = request(),
    r = app.presets.review(input, editor),
    accept = {
      request: input,
      reviewSha256: r.reviewSha256,
      requestId: "bound-body",
    };
  await app.presets.accept(accept, editor);
  const changed = structuredClone(accept);
  changed.request.target = {
    kind: "film-look",
    compositionId: "cut",
    scope: "clip",
    clipId: "clip",
  };
  await expect(app.presets.accept(changed, editor)).rejects.toMatchObject({
    code: "presets.conflict",
  });
  const next = request("title"),
    review = app.presets.review(next, editor),
    view = app.presets.registry.list(),
    p = view.packages[0]!;
  await app.presets.registry.remove({
    packageId: p.id,
    packageVersion: p.version,
    packageSha256: p.packageSha256,
    baseRegistryRevision: view.revision,
  });
  const before = editor.get("cut");
  await expect(
    app.presets.accept(
      {
        request: next,
        reviewSha256: review.reviewSha256,
        requestId: "removed",
      },
      editor,
    ),
  ).rejects.toThrow();
  expect(editor.get("cut")).toEqual(before);
  expect(app.project.presetApplicationReceipts).toHaveLength(1);
});
it("title application uses the title owner and retains separate origin metadata", async () => {
  const { app, editor, request } = await presetApplicationFixture(),
    input = request("title"),
    r = app.presets.review(input, editor);
  await app.presets.accept(
    { request: input, reviewSha256: r.reviewSha256, requestId: "title" },
    editor,
  );
  const clip = editor.get("cut").composition.tracks[0]!.clips[0]!;
  expect(clip.title).toBe("記憶 Memories");
  expect(clip.titleStyle?.fontSize).toBe(24);
  expect(clip.titlePresetSnapshot?.kind).toBe("title");
  const source = app.catalog.getAsset("photo")!;
  app.catalog.upsertAsset({ ...source, state: { locked: true } });
  expect(() => app.presets.review(request(), editor)).toThrow(
    /protected|lock/i,
  );
});
it("Node open rejects a changed snapshot hash and ignores a corrupt absent registry on ordinary reopen", async () => {
  const { app, editor, request, directory, userDataDirectory } =
      await presetApplicationFixture(),
    input = request(),
    r = app.presets.review(input, editor);
  await app.presets.accept(
    { request: input, reviewSha256: r.reviewSha256, requestId: "persist" },
    editor,
  );
  app.close();
  apps.delete(app);
  writeFileSync(
    join(userDataDirectory, "presets", "registry-v1.json"),
    "corrupt",
  );
  const reopened = await OpenFilmApplication.open(directory, {
    userDataDirectory,
  });
  apps.add(reopened);
  expect(
    new TimelineEditor(reopened).get("cut").composition.defaultLook?.version,
  ).toBe(2);
  reopened.close();
  apps.delete(reopened);
  const path = join(directory, "project.json"),
    p = JSON.parse(readFileSync(path, "utf8"));
  p.timelines[0].defaultLook.snapshot.recipe.matrix[0] = 1.5;
  writeFileSync(path, JSON.stringify(p));
  await expect(
    OpenFilmApplication.open(directory, { userDataDirectory }),
  ).rejects.toThrow(/integrity|hash/);
});

it.each(
  (["film-look", "title"] as const).flatMap((kind) =>
    (["lock", "hash", "metadata"] as const).map((change) => ({ kind, change })),
  ),
)(
  "$kind rechecks catalog $change inside the publication lock",
  async ({ kind, change }) => {
    const { app, editor, request, directory } =
      await presetApplicationFixture();
    await editor.edit("cut", {
      baseRevision: editor.get("cut").revision,
      commands: [
        { type: "presentation", clipId: "clip", title: "Prior manual title" },
      ],
    });
    const originalAsset = app.catalog.getAsset("photo")!;
    expect(editor.get("cut").canUndo).toBe(true);
    const input = request(kind),
      review = app.presets.review(input, editor);
    const before = structuredClone(app.project),
      disk = readFileSync(join(directory, "project.json"));
    const original = app.catalog.withProjectWrite.bind(app.catalog);
    const fence = vi
      .spyOn(app.catalog, "withProjectWrite")
      .mockImplementation((operation) => {
        fence.mockRestore();
        const asset = app.catalog.getAsset("photo")!;
        app.catalog.upsertAsset({
          ...asset,
          ...(change === "lock"
            ? { state: { ...asset.state, locked: true } }
            : {}),
          ...(change === "hash" ? { contentHash: "e".repeat(64) } : {}),
          ...(change === "metadata"
            ? { metadata: { ...asset.metadata, rating: 1 } }
            : {}),
        });
        return original(operation);
      });
    await expect(
      app.presets.accept(
        {
          request: input,
          reviewSha256: review.reviewSha256,
          requestId: `race-${kind}-${change}`,
        },
        editor,
      ),
    ).rejects.toMatchObject({ code: "presets.stale" });
    expect(app.project).toEqual(before);
    expect(readFileSync(join(directory, "project.json"))).toEqual(disk);
    expect(editor.get("cut").canUndo).toBe(false);
    expect(app.project.presetApplicationReceipts).toBeUndefined();
    app.catalog.upsertAsset(originalAsset);
    expect(editor.get("cut").canUndo).toBe(true);
    await editor.undo("cut", editor.get("cut").revision);
    expect(editor.get("cut").composition.tracks[0]!.clips[0]!.title).toBe(
      "記憶 Memories",
    );
  },
);

it.each(
  (["film-look", "title"] as const).flatMap((kind) =>
    (["source", "clip"] as const).map((lock) => ({ kind, lock })),
  ),
)("$kind respects an existing $lock lock", async ({ kind, lock }) => {
  const { app, editor, request, directory } = await presetApplicationFixture();
  if (lock === "source") {
    const asset = app.catalog.getAsset("photo")!;
    app.catalog.upsertAsset({ ...asset, state: { locked: true } });
  } else app.project.timelines[0]!.tracks[0]!.clips[0]!.locked = true;
  await app.save();
  const before = structuredClone(app.project),
    disk = readFileSync(join(directory, "project.json"));
  expect(() => app.presets.review(request(kind), editor)).toThrow(
    /lock|protected/i,
  );
  expect(app.project).toEqual(before);
  expect(readFileSync(join(directory, "project.json"))).toEqual(disk);
});
