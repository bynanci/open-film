import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationError } from "@openfilm/core";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture(title = "Source draft") {
  const root = await mkdtemp(join(tmpdir(), "openfilm-source-draft-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm");
  let app = await OpenFilmApplication.create(directory, title);
  cleanup.push(() => app.close());
  return {
    directory,
    get app() {
      return app;
    },
    async reopen() {
      app.close();
      app = await OpenFilmApplication.open(directory);
      return app;
    },
  };
}

const nativeFiles = (start: number, count: number) =>
  Array.from({ length: count }, (_, offset) => ({
    kind: "file" as const,
    displayName: `memory-${start + offset}.mp4`,
    accessClass: "native-path" as const,
    accessRef: `/synthetic/memory-${start + offset}.mp4`,
    recursive: false,
  }));

describe("project-owned source draft", () => {
  it("adds three then two sources without importing and survives reopening", async () => {
    const test = await fixture();
    const projectId = test.app.project.id;
    const first = test.app.sourceDraft.add({
      projectId,
      baseRevision: 0,
      requestId: "10000000-0000-4000-8000-000000000001",
      sources: nativeFiles(1, 3),
    });
    expect(first).toMatchObject({ projectId, revision: 1 });
    expect(first.selections).toHaveLength(3);

    const second = test.app.sourceDraft.add({
      projectId,
      baseRevision: first.revision,
      requestId: "10000000-0000-4000-8000-000000000002",
      sources: nativeFiles(4, 2),
    });
    expect(second.revision).toBe(2);
    expect(second.selections.map((source) => source.displayName)).toEqual([
      "memory-1.mp4",
      "memory-2.mp4",
      "memory-3.mp4",
      "memory-4.mp4",
      "memory-5.mp4",
    ]);
    expect(test.app.catalog.listAssets()).toEqual([]);
    expect(test.app.catalog.listJobs()).toEqual([]);

    expect((await test.reopen()).sourceDraft.get()).toEqual(second);
  });

  it("is idempotent, rejects stale and cross-project mutations, and preserves catalog assets on removal", async () => {
    const test = await fixture();
    const projectId = test.app.project.id;
    test.app.catalog.upsertAsset({
      id: "existing",
      uri: "file:///synthetic/existing.mp4",
      name: "Existing",
      mediaType: "video",
      tags: [],
      state: { locked: true },
      metadata: {},
    });
    const request = {
      projectId,
      baseRevision: 0,
      requestId: "20000000-0000-4000-8000-000000000001",
      sources: nativeFiles(1, 1),
    };
    const added = test.app.sourceDraft.add(request);
    expect(test.app.sourceDraft.add(request)).toEqual(added);
    expect(() =>
      test.app.sourceDraft.add({
        ...request,
        requestId: "20000000-0000-4000-8000-000000000002",
      }),
    ).toThrow(
      expect.objectContaining<Partial<ApplicationError>>({
        code: "import.draftStale",
      }),
    );
    expect(() =>
      test.app.sourceDraft.add({
        ...request,
        projectId: "another-project",
        baseRevision: added.revision,
        requestId: "20000000-0000-4000-8000-000000000003",
      }),
    ).toThrow(
      expect.objectContaining<Partial<ApplicationError>>({
        code: "request.forbidden",
      }),
    );

    const removed = test.app.sourceDraft.remove({
      projectId,
      baseRevision: added.revision,
      requestId: "20000000-0000-4000-8000-000000000004",
      selectionId: added.selections[0]!.id,
    });
    expect(removed).toMatchObject({ revision: 2, selections: [] });
    expect(test.app.catalog.getAsset("existing")).toMatchObject({
      id: "existing",
      state: { locked: true },
    });
  });

  it("updates recursive policy without changing stable source identity", async () => {
    const test = await fixture();
    const projectId = test.app.project.id;
    const added = test.app.sourceDraft.add({
      projectId,
      baseRevision: 0,
      requestId: "30000000-0000-4000-8000-000000000001",
      sources: [
        {
          kind: "folder",
          displayName: "京都",
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:kyoto",
          recursive: true,
        },
      ],
    });
    const selectionId = added.selections[0]!.id;
    const updated = test.app.sourceDraft.update({
      projectId,
      baseRevision: added.revision,
      requestId: "30000000-0000-4000-8000-000000000002",
      selectionId,
      recursive: false,
    });
    expect(updated).toMatchObject({ revision: 2 });
    expect(updated.selections[0]).toMatchObject({
      id: selectionId,
      recursive: false,
      selectionRevision: 2,
    });
  });
});
