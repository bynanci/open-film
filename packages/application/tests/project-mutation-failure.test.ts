import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

function register(app: OpenFilmApplication) {
  cleanup.push(() => {
    try {
      app.catalog.close();
    } catch {
      // Some tests explicitly close the application before cleanup.
    }
  });
  return app;
}

async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-project-mutation-failure-"),
  );
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = { userDataDirectory: join(root, "user-data") };
  const app = register(
    await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Mutation failure",
      {},
      runtime,
    ),
  );
  const asset: MediaAsset = {
    id: "photo",
    uri: "file:///originals/photo.jpg",
    name: "Photo",
    mediaType: "image",
    dimensions: { width: 1920, height: 1080 },
    tags: [],
    state: {},
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  const story = app.generateStory({
    title: "Existing story",
    assetIds: [asset.id],
    targetDuration: 6,
    maxDuration: 8,
  });
  const other = register(
    await OpenFilmApplication.open(app.directory, runtime),
  );
  const database = Reflect.get(app.catalog, "database") as DatabaseSync;
  database.exec("PRAGMA busy_timeout=50");

  // A failed operation must preserve these edits as well as the saved state.
  app.project.title = "Unsaved authored title";
  app.project.stories[0]!.beats[0]!.script = {
    narration: "An unsaved narration draft.",
    visualDirection: "Keep the harbour in view.",
  };
  return {
    root,
    app,
    other,
    runtime,
    story,
    asset,
    projectPath: join(app.directory, "project.json"),
  };
}

describe("project mutations after a rejected save", () => {
  it.each(["save", "close", "retry"] as const)(
    "keeps rejected story generation out of a later %s",
    async (followup) => {
      const { app, other, asset, projectPath } = await fixture();
      const previousReference = app.project;
      const previous = structuredClone(app.project);
      const savedBytes = await readFile(projectPath, "utf8");
      const generate = () =>
        app.generateStory({
          title: "Attempted story",
          assetIds: [asset.id],
          targetDuration: 6,
          maxDuration: 8,
        });

      other.catalog.withProjectWrite(() => {
        expect(generate).toThrowError(
          expect.objectContaining({ code: "jobs.busy" }),
        );
      });

      expect(await readFile(projectPath, "utf8")).toBe(savedBytes);
      expect(app.project).toBe(previousReference);
      expect(app.project).toEqual(previous);
      if (followup === "close") app.close({ requireSave: true });
      else if (followup === "save") await app.save();
      else previous.stories.push(generate());
      expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual({
        ...previous,
        updatedAt: expect.any(String),
      });
    },
  );

  it.each(["save", "close", "retry"] as const)(
    "keeps rejected composition out of a later %s",
    async (followup) => {
      const { app, other, story, projectPath } = await fixture();
      const previousReference = app.project;
      const previous = structuredClone(app.project);
      const savedBytes = await readFile(projectPath, "utf8");

      other.catalog.withProjectWrite(() => {
        expect(() => app.compose(story.id)).toThrowError(
          expect.objectContaining({ code: "jobs.busy" }),
        );
      });

      expect(await readFile(projectPath, "utf8")).toBe(savedBytes);
      expect(app.project).toBe(previousReference);
      expect(app.project).toEqual(previous);
      if (followup === "close") app.close({ requireSave: true });
      else if (followup === "save") await app.save();
      else previous.timelines.push(app.compose(story.id));
      expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual({
        ...previous,
        updatedAt: expect.any(String),
      });
    },
  );

  it("preserves authored drafts when film settings cannot be saved", async () => {
    const { app, other, projectPath } = await fixture();
    const previousReference = app.project;
    const previous = structuredClone(app.project);
    const savedBytes = await readFile(projectPath, "utf8");

    other.catalog.withProjectWrite(() => {
      expect(() =>
        app.updateFilm({ projectContentLocale: "ja-JP" }),
      ).toThrowError(expect.objectContaining({ code: "jobs.busy" }));
    });

    expect(await readFile(projectPath, "utf8")).toBe(savedBytes);
    expect(app.project).toBe(previousReference);
    expect(app.project).toEqual(previous);
    app.close({ requireSave: true });
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual({
      ...previous,
      updatedAt: expect.any(String),
    });
  });

  it("preserves authored candidates when refreshed suggestions cannot be saved", async () => {
    const { app, other, story, asset, projectPath } = await fixture();
    const beat = app.project.stories[0]!.beats[0]!;
    beat.candidateAssetIds = ["removed-photo", asset.id];
    const previousReference = app.project;
    const previous = structuredClone(app.project);
    const savedBytes = await readFile(projectPath, "utf8");

    other.catalog.withProjectWrite(() => {
      expect(() => app.refreshSuggestions(story.id, beat.id)).toThrowError(
        expect.objectContaining({ code: "jobs.busy" }),
      );
    });

    expect(await readFile(projectPath, "utf8")).toBe(savedBytes);
    expect(app.project).toBe(previousReference);
    expect(app.project).toEqual(previous);
    await app.save();
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual({
      ...previous,
      updatedAt: expect.any(String),
    });
    expect(
      app.refreshSuggestions(story.id, beat.id).beats[0]!.candidateAssetIds,
    ).toEqual([asset.id]);
  });

  it("leaves no story or timeline when scene-plan acceptance cannot be saved", async () => {
    const { app, other, asset, projectPath } = await fixture();
    const plan = app.previewScenePlan({
      title: "Attempted scene plan",
      groupBy: "chronology",
      assetIds: [asset.id],
      targetDuration: 6,
      maxDuration: 8,
    });
    const previousReference = app.project;
    const previous = structuredClone(app.project);
    const savedBytes = await readFile(projectPath, "utf8");

    other.catalog.withProjectWrite(() => {
      expect(() => app.acceptScenePlan(plan)).toThrowError(
        expect.objectContaining({ code: "jobs.busy" }),
      );
    });

    expect(await readFile(projectPath, "utf8")).toBe(savedBytes);
    expect(app.project).toBe(previousReference);
    expect(app.project).toEqual(previous);
    const accepted = app.acceptScenePlan(plan);
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual({
      ...previous,
      stories: [...previous.stories, accepted.story],
      timelines: [...previous.timelines, accepted.composition],
      updatedAt: expect.any(String),
    });
  });

  it("retries library publication after a busy import without leaking the rejected library", async () => {
    const { root, app, other, projectPath } = await fixture();
    const files = [join(root, "first.png"), join(root, "second.png")];
    await Promise.all(
      files.map((file) => writeFile(file, "invalid image fixture")),
    );
    const previous = structuredClone(app.project);
    const savedBytes = await readFile(projectPath, "utf8");
    const otherDatabase = Reflect.get(
      other.catalog,
      "database",
    ) as DatabaseSync;
    let held = false;
    let acquired = false;
    cleanup.push(() => {
      if (held) otherDatabase.exec("ROLLBACK");
    });
    const persistence = app as unknown as { saveSync(): void };
    const saveSync = persistence.saveSync.bind(app);
    const attemptedLibraryIds: string[] = [];
    let busyError: unknown;
    let firstFailureProject: typeof app.project | undefined;
    let firstFailureBytes: string | undefined;
    vi.spyOn(persistence, "saveSync").mockImplementation(() => {
      const library = app.project.mediaLibraries.at(-1);
      if (library) attemptedLibraryIds.push(library.id);
      try {
        saveSync();
      } catch (error) {
        busyError = error;
        throw error;
      } finally {
        // Release only after real SQLite contention has rejected publication,
        // allowing the import to persist its job and process the next file.
        if (held) {
          otherDatabase.exec("ROLLBACK");
          held = false;
        }
      }
    });

    const result = await app.importFiles(files, {
      onProgress: (job) => {
        if (job.status === "running" && !acquired) {
          otherDatabase.exec("BEGIN IMMEDIATE");
          held = true;
          acquired = true;
        }
        if (job.errors?.length === 1 && !firstFailureProject) {
          firstFailureProject = structuredClone(app.project);
          // Progress is synchronous; file reads here preserve the exact barrier.
          firstFailureBytes = readFileSync(projectPath, "utf8");
        }
      },
    });

    expect(busyError).toMatchObject({ code: "jobs.busy" });
    expect(firstFailureProject).toEqual(previous);
    expect(firstFailureBytes).toBe(savedBytes);
    expect(attemptedLibraryIds.length).toBeGreaterThanOrEqual(2);
    expect(attemptedLibraryIds[1]).not.toBe(attemptedLibraryIds[0]);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.job.errors).toHaveLength(2);
    expect(result.job.errors?.[0]).toMatchObject({
      stage: "fingerprint",
      code: "jobs.busy",
    });
    expect(result.job.errors?.[1]?.stage).not.toBe("fingerprint");
    expect(app.project.mediaLibraries).toHaveLength(1);
    expect(app.project.mediaLibraries[0]!.id).toBe(attemptedLibraryIds[1]);
    expect(app.project.title).toBe(previous.title);
    expect(app.project.stories).toEqual(previous.stories);
    expect(
      JSON.parse(await readFile(projectPath, "utf8")).mediaLibraries,
    ).toEqual(app.project.mediaLibraries);
  });
});
