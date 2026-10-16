import { writeFileSync } from "node:fs";
import * as fs from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ProjectCatalog } from "@openfilm/catalog";
import type { MediaAsset, OpenFilmProject } from "@openfilm/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "../src/index.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.renameSync).mockReset();
  for (const action of cleanup.splice(0).reverse()) await action();
});

function releaseCatalog(catalog: ProjectCatalog) {
  cleanup.push(() => {
    try {
      catalog.close();
    } catch {
      // Successful close or rejected open may already have released it.
    }
  });
}

const narration = "We arrived at dawn.";
const visualDirection = "Open on the quiet harbour.";
const revisedNarration = "We reached the harbour at dawn.";
const sourceBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
  "base64",
);

async function movedFixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-managed-script-review-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = { userDataDirectory: join(root, "user-data") };
  const original = join(root, "original.openfilm");
  const app = await OpenFilmApplication.create(
    original,
    "Moved managed script",
    {},
    runtime,
  );
  releaseCatalog(app.catalog);
  const sourceRelativePath = "sources/upload/回憶 frame.png";
  const originalRootUri = pathToFileURL(join(original, "sources")).href;
  const originalUri = pathToFileURL(join(original, sourceRelativePath)).href;
  await mkdir(join(original, "sources/upload"), { recursive: true });
  await writeFile(join(original, sourceRelativePath), sourceBytes);
  app.project.mediaLibraries.push({
    id: "managed-library",
    name: "Managed sources",
    uri: originalRootUri,
  });
  const asset: MediaAsset = {
    id: "managed-frame",
    name: "回憶 frame.png",
    uri: originalUri,
    mediaType: "image",
    dimensions: { width: 1, height: 1 },
    state: {},
    tags: [],
    metadata: {
      "openfilm.managedSource": {
        relativePath: sourceRelativePath,
        uri: originalUri,
      },
      "openfilm.reference": {
        mediaLibraryId: "managed-library",
        rootUri: originalRootUri,
        relativePath: "upload/回憶 frame.png",
        originalUri,
      },
    },
  };
  app.catalog.upsertAsset(asset);
  app.project.stories.push({
    id: "story",
    title: "Our journey",
    targetDuration: 12,
    maxDuration: 15,
    beats: [
      {
        id: "beat",
        title: "Arriving",
        intent: "Recall arrival",
        targetDuration: 6,
        script: { narration, visualDirection },
        candidateAssetIds: [asset.id],
      },
      {
        id: "other-beat",
        title: "The boats",
        targetDuration: 6,
        script: {
          narration: "The fishing boats were still asleep.",
          visualDirection: "Hold on the boats at the pier.",
        },
        candidateAssetIds: [],
      },
    ],
  });
  await app.save();
  const story = structuredClone(app.project.stories[0]!);
  app.close({ requireSave: true });
  const projectBytes = await readFile(join(original, "project.json"), "utf8");
  const catalogBytes = await readFile(join(original, "database.sqlite"));
  const moved = join(root, "moved.openfilm");
  await rename(original, moved);
  return {
    runtime,
    moved,
    projectPath: join(moved, "project.json"),
    movedRootUri: pathToFileURL(join(moved, "sources")).href,
    movedSourceUri: pathToFileURL(join(moved, sourceRelativePath)).href,
    sourceRelativePath,
    asset,
    story,
    projectBytes,
    catalogBytes,
  };
}

describe("managed project relocation and scene script review", () => {
  it("repairs a stale manifest root when an earlier opener already rebased the catalog", async () => {
    const fixture = await movedFixture();
    const catalog = new ProjectCatalog(fixture.moved);
    releaseCatalog(catalog);
    const rebasedAsset: MediaAsset = {
      ...fixture.asset,
      uri: fixture.movedSourceUri,
      metadata: {
        ...fixture.asset.metadata,
        "openfilm.managedSource": {
          relativePath: fixture.sourceRelativePath,
          uri: fixture.movedSourceUri,
        },
        "openfilm.reference": {
          mediaLibraryId: "managed-library",
          rootUri: fixture.movedRootUri,
          relativePath: "upload/回憶 frame.png",
          originalUri: fixture.asset.uri,
        },
      },
    };
    catalog.upsertAsset(rebasedAsset);
    catalog.close();

    const app = await OpenFilmApplication.open(fixture.moved, fixture.runtime);
    releaseCatalog(app.catalog);

    const disk = JSON.parse(
      await readFile(fixture.projectPath, "utf8"),
    ) as OpenFilmProject;
    expect(disk.mediaLibraries[0]?.uri).toBe(fixture.movedRootUri);
    expect(app.project.mediaLibraries).toEqual(disk.mediaLibraries);
    expect(app.catalog.getAsset(fixture.asset.id)).toEqual(rebasedAsset);
    expect(disk.stories[0]).toEqual(fixture.story);
  });

  it("persists moved managed media roots before returning a reviewable workspace", async () => {
    const fixture = await movedFixture();
    const app = await OpenFilmApplication.open(fixture.moved, fixture.runtime);
    releaseCatalog(app.catalog);

    const disk = JSON.parse(
      await readFile(fixture.projectPath, "utf8"),
    ) as OpenFilmProject;
    expect(disk.mediaLibraries[0]?.uri).toBe(fixture.movedRootUri);
    expect(app.project.mediaLibraries).toEqual(disk.mediaLibraries);
    expect(app.catalog.getAsset(fixture.asset.id)).toMatchObject({
      name: fixture.asset.name,
      uri: fixture.movedSourceUri,
    });
    expect(
      await readFile(join(fixture.moved, fixture.sourceRelativePath)),
    ).toEqual(sourceBytes);

    app.knowledge.registerLanguageProvider({
      id: "managed-relocation-language",
      name: "Deterministic relocation fixture",
      kind: "language",
      execution: "local",
      dataKinds: ["text"],
      generate: async () =>
        JSON.stringify({
          suggestions: [
            {
              beatId: "beat",
              field: "narration",
              after: revisedNarration,
              reason: "Fixture",
            },
          ],
        }),
    });
    expect(
      (
        await app.runSceneScriptReview("story", {
          beatId: "beat",
          field: "narration",
        })
      ).status,
    ).toBe("completed");
    const suggestion = app.sceneScriptReview.list("story", {}).suggestions[0]!;
    expect(suggestion).toMatchObject({ before: narration, status: "pending" });
    app.sceneScriptReview.accept(suggestion.id, {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "accept-after-managed-move",
    });
    const expectedStory = structuredClone(fixture.story);
    expectedStory.beats[0]!.script!.narration = revisedNarration;
    expect(app.project.stories[0]).toEqual(expectedStory);
    app.close({ requireSave: true });

    const reopened = await OpenFilmApplication.open(
      fixture.moved,
      fixture.runtime,
    );
    releaseCatalog(reopened.catalog);
    expect(reopened.project.stories[0]).toEqual(expectedStory);
    expect(reopened.project.mediaLibraries[0]?.uri).toBe(fixture.movedRootUri);
    expect(
      reopened.sceneScriptReview.list("story", {}).suggestions[0]?.status,
    ).toBe("accepted");
  });

  it("keeps a moved export session passive through open and strict close", async () => {
    const fixture = await movedFixture();
    const app = await OpenFilmApplication.openForExport(
      fixture.moved,
      fixture.runtime,
    );
    releaseCatalog(app.catalog);

    expect(app.catalog.getAsset(fixture.asset.id)).toEqual(fixture.asset);
    expect(app.getSourceAsset(fixture.asset.id)?.uri).toBe(
      fixture.movedSourceUri,
    );
    expect(await readFile(fixture.projectPath, "utf8")).toBe(
      fixture.projectBytes,
    );
    app.project.title = "An export session must not publish this edit";
    app.close({ requireSave: true });

    expect(await readFile(fixture.projectPath, "utf8")).toBe(
      fixture.projectBytes,
    );
    expect(await readFile(join(fixture.moved, "database.sqlite"))).toEqual(
      fixture.catalogBytes,
    );
  });

  it("rejects a relocation save raced by a newer external manifest and releases its catalog", async () => {
    const fixture = await movedFixture();
    const newer = JSON.parse(fixture.projectBytes) as OpenFilmProject;
    newer.title = "A newer external project title";
    newer.stories[0]!.beats[0]!.script!.visualDirection =
      "Keep the newer external direction.";
    const newerBytes = `${JSON.stringify(newer, null, 4)}\n`;
    const openingCatalogs = new Set<ProjectCatalog>();
    const upsertAsset = ProjectCatalog.prototype.upsertAsset;
    vi.spyOn(ProjectCatalog.prototype, "upsertAsset").mockImplementationOnce(
      function (this: ProjectCatalog, asset) {
        openingCatalogs.add(this);
        releaseCatalog(this);
        upsertAsset.call(this, asset);
        // Synchronize only: open, baseline verification and publication stay real.
        writeFileSync(fixture.projectPath, newerBytes, "utf8");
      },
    );

    await expect(
      OpenFilmApplication.open(fixture.moved, fixture.runtime).then(
        () => "opened",
      ),
    ).rejects.toMatchObject({ code: "story.planConflict" });

    expect(openingCatalogs.size).toBe(1);
    expect(() => [...openingCatalogs][0]!.listJobs()).toThrow();
    expect(await readFile(fixture.projectPath, "utf8")).toBe(newerBytes);
    const catalog = new ProjectCatalog(fixture.moved);
    releaseCatalog(catalog);
    expect(catalog.getAsset(fixture.asset.id)).toEqual(fixture.asset);
  });

  it("rolls back managed catalog changes and releases storage when relocation publication fails", async () => {
    const fixture = await movedFixture();
    const openingCatalogs = new Set<ProjectCatalog>();
    const upsertAsset = ProjectCatalog.prototype.upsertAsset;
    vi.spyOn(ProjectCatalog.prototype, "upsertAsset").mockImplementationOnce(
      function (this: ProjectCatalog, asset) {
        openingCatalogs.add(this);
        releaseCatalog(this);
        upsertAsset.call(this, asset);
      },
    );
    const failure = new Error("Injected relocation manifest rename failure");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw failure;
    });

    await expect(
      OpenFilmApplication.open(fixture.moved, fixture.runtime).then(
        () => "opened",
      ),
    ).rejects.toBe(failure);

    expect(openingCatalogs.size).toBe(1);
    expect(() => [...openingCatalogs][0]!.listJobs()).toThrow();
    expect(await readFile(fixture.projectPath, "utf8")).toBe(
      fixture.projectBytes,
    );
    const catalog = new ProjectCatalog(fixture.moved);
    releaseCatalog(catalog);
    expect(catalog.getAsset(fixture.asset.id)).toEqual(fixture.asset);
  });
});
