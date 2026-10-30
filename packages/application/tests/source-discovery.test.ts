import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationError } from "@openfilm/core";
import type {
  MediaCandidate,
  MediaSourceAdapterV2,
} from "@openfilm/plugin-sdk";
import { SourceDiscoveryService } from "../src/source-discovery.js";
import { OpenFilmApplication } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-source-discovery-"));
  roots.push(root);
  const media = join(root, "media");
  await mkdir(join(media, "nested"), { recursive: true });
  await writeFile(join(media, "one.jpg"), "synthetic image one");
  await writeFile(join(media, "nested", "two.mp4"), "synthetic movie two");
  await writeFile(join(media, "notes.txt"), "not supported media");
  await symlink(join(media, "one.jpg"), join(media, "linked.jpg"));
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Discovery test",
  );
  const draft = app.sourceDraft.add({
    projectId: app.project.id,
    baseRevision: 0,
    requestId: "discovery-add-source",
    sources: [
      {
        kind: "folder",
        displayName: "Synthetic media",
        accessClass: "native-path",
        accessRef: media,
        recursive: true,
      },
    ],
  });
  return { root, media, app, draft };
}

describe("source draft discovery", () => {
  it("stores 10,000 streamed candidates with bounded catalog pages", async () => {
    const { media, app, draft } = await fixture();
    const pageSize = 256;
    let produced = 0;
    let persisted = 0;
    let maxBuffered = 0;
    const adapter: MediaSourceAdapterV2 = {
      id: "synthetic-10k-stream",
      supports: () => true,
      async *discover() {
        for (let index = 0; index < 10_000; index++) {
          produced++;
          maxBuffered = Math.max(maxBuffered, produced - persisted);
          const name = `${String(index).padStart(5, "0")}.jpg`;
          yield {
            uri: `file://${media}/${name}`,
            name,
            relativePath: name,
            mediaType: "image",
            size: 1,
          } satisfies MediaCandidate;
        }
      },
      async extractMetadata() {
        return {};
      },
    };
    const discovery = new SourceDiscoveryService(
      app.sourceDraft,
      app.catalog,
      adapter,
    );
    let pageCount = 0;
    const summary = await discovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "discovery-10k",
      pageSize,
      onPage(page) {
        pageCount++;
        persisted += page.length;
        expect(page.length).toBeLessThanOrEqual(pageSize);
      },
    });
    expect(summary).toMatchObject({
      discovered: 10_000,
      supported: 10_000,
      failed: 0,
      cancelled: false,
    });
    expect(produced).toBe(10_000);
    expect(persisted).toBe(10_000);
    expect(pageCount).toBe(40);
    expect(maxBuffered).toBe(pageSize);
    expect(
      app.catalog.multiSource.listOccurrences(draft.selections[0]!.id, {
        limit: 1,
      }).items,
    ).toHaveLength(1);
    app.close();
  });

  it("cancels a 10,000-item browser-independent scan at the last committed page", async () => {
    const { media, app, draft } = await fixture();
    const controller = new AbortController();
    let produced = 0;
    let persisted = 0;
    const adapter: MediaSourceAdapterV2 = {
      id: "synthetic-cancellable-stream",
      supports: () => true,
      async *discover(_input, options) {
        for (let index = 0; index < 10_000; index++) {
          options?.signal?.throwIfAborted();
          produced++;
          const name = `${String(index).padStart(5, "0")}.jpg`;
          yield {
            uri: `file://${media}/${name}`,
            name,
            relativePath: name,
            mediaType: "image",
            size: 1,
          } satisfies MediaCandidate;
        }
      },
      async extractMetadata() {
        return {};
      },
    };
    const discovery = new SourceDiscoveryService(
      app.sourceDraft,
      app.catalog,
      adapter,
    );
    const result = await discovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "discovery-10k-cancel",
      pageSize: 64,
      signal: controller.signal,
      onPage(page) {
        persisted += page.length;
        if (persisted === 128) controller.abort();
      },
    });
    expect(result).toMatchObject({
      discovered: 128,
      supported: 128,
      cancelled: true,
    });
    expect(produced).toBe(128);
    expect(persisted).toBe(128);
    app.close();
  });

  it("streams into paged catalog membership without storing absolute source paths", async () => {
    const { root, media, app, draft } = await fixture();
    const pages: Array<Array<{ relativePath: string }>> = [];
    const result = await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "discovery-run-1",
      pageSize: 1,
      onPage: (page) =>
        pages.push(
          page.map(({ occurrence }) => ({
            relativePath: occurrence.relativePath,
          })),
        ),
    });

    expect(result).toMatchObject({
      sourcesScanned: 1,
      discovered: 2,
      supported: 2,
      skipped: 2,
      failed: 0,
      cancelled: false,
    });
    expect(pages).toHaveLength(2);
    expect(JSON.stringify(pages)).not.toContain(media);
    const selectionId = draft.selections[0]!.id;
    expect(
      app.catalog.multiSource
        .listOccurrences(selectionId)
        .items.map(({ occurrence }) => occurrence.relativePath),
    ).toEqual(["nested/two.mp4", "one.jpg"]);
    const database = new DatabaseSync(
      join(root, "film.openfilm", "database.sqlite"),
      { readOnly: true },
    );
    const serialized = JSON.stringify(
      database
        .prepare(
          "SELECT data FROM source_selections UNION ALL SELECT data FROM file_occurrences UNION ALL SELECT data FROM selection_memberships",
        )
        .all(),
    );
    database.close();
    expect(serialized).not.toContain(media);
    expect(serialized).not.toContain("accessRef");

    await rm(join(media, "nested", "two.mp4"));
    const rescanned = await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "discovery-run-2",
    });
    expect(rescanned.discovered).toBe(1);
    expect(
      app.catalog.multiSource
        .listOccurrences(selectionId)
        .items.find(
          ({ occurrence }) => occurrence.relativePath === "nested/two.mp4",
        )?.occurrence.availability,
    ).toBe("missing");

    app.close();
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(
      reopened.catalog.multiSource.listOccurrences(selectionId).items,
    ).toHaveLength(2);
    reopened.close();
  });

  it("honors non-recursive selection policy and rejects stale draft revisions", async () => {
    const { app, draft } = await fixture();
    const updated = app.sourceDraft.update({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "discovery-recursive-off",
      selectionId: draft.selections[0]!.id,
      recursive: false,
    });
    await expect(
      app.sourceDiscovery.scan({
        projectId: app.project.id,
        baseRevision: draft.revision,
        requestId: "discovery-stale",
      }),
    ).rejects.toMatchObject({ code: "import.draftStale" });

    const result = await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: updated.revision,
      requestId: "discovery-shallow",
    });
    expect(result.discovered).toBe(1);
    expect(
      app.catalog.multiSource.listOccurrences(draft.selections[0]!.id).items[0]
        ?.occurrence.relativePath,
    ).toBe("one.jpg");
    app.close();
  });

  it("restores completed scan readiness after reopen and fences changed drafts", async () => {
    const { root, app, draft } = await fixture();
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "scan-readiness",
    });
    app.close();
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    expect(await reopened.sourceDiscovery.getReadiness()).toMatchObject({
      projectId: reopened.project.id,
      draftRevision: draft.revision,
      sourcesRequested: 1,
      sourcesScanned: 1,
      discovered: 2,
      supported: 2,
      failed: 0,
      cancelled: false,
    });
    reopened.sourceDraft.update({
      projectId: reopened.project.id,
      baseRevision: draft.revision,
      requestId: "scan-readiness-recursion-change",
      selectionId: draft.selections[0]!.id,
      recursive: false,
    });
    expect(await reopened.sourceDiscovery.getReadiness()).toBeUndefined();
    reopened.close();
  });

  it("rejects a project switch and marks browser-only access as unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-boundary-"));
    roots.push(root);
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Boundary test",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "browser-source",
      sources: [
        {
          kind: "file",
          displayName: "temporary.jpg",
          accessClass: "ephemeral-browser-file",
          accessRef: "browser-file:one",
        },
      ],
    });
    await expect(
      app.sourceDiscovery.scan({
        projectId: "another-project",
        baseRevision: draft.revision,
        requestId: "discovery-foreign",
      }),
    ).rejects.toBeInstanceOf(ApplicationError);
    const result = await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "discovery-browser",
    });
    expect(result).toMatchObject({
      discovered: 0,
      failed: 1,
      sourcesScanned: 0,
    });
    app.close();
  });

  it("streams browser candidate pages into safe occurrence membership", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-browser-discovery-"));
    roots.push(root);
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Browser scan",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "browser-page-add",
      sources: [
        {
          kind: "folder",
          displayName: "Trip",
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:opaque",
          recursive: true,
        },
      ],
    });
    const selectionId = draft.selections[0]!.id;
    const scan = await app.sourceDiscovery.beginBrowserScan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-page-scan",
      selectionId,
    });
    const first = await app.sourceDiscovery.appendBrowserScanPage({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-page-scan",
      selectionId,
      scanRevision: scan.scanRevision,
      candidates: [
        { relativePath: "day-1/one.jpg", name: "one.jpg", size: 11 },
      ],
    });
    expect(first.discovered).toBe(1);
    const second = await app.sourceDiscovery.appendBrowserScanPage({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-page-scan",
      selectionId,
      scanRevision: scan.scanRevision,
      candidates: [
        { relativePath: "day-2/two.mp4", name: "two.mp4", size: 22 },
      ],
    });
    expect(second.discovered).toBe(2);
    const result = await app.sourceDiscovery.finishBrowserScan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-page-scan",
      selectionId,
      scanRevision: scan.scanRevision,
    });
    expect(result).toMatchObject({
      sourcesScanned: 1,
      discovered: 2,
      supported: 2,
      failed: 0,
      cancelled: false,
    });
    expect(
      app.catalog.multiSource
        .listOccurrences(selectionId)
        .items.map(({ occurrence }) => occurrence.relativePath),
    ).toEqual(["day-1/one.jpg", "day-2/two.mp4"]);
    expect(
      JSON.stringify(app.catalog.multiSource.listOccurrences(selectionId)),
    ).not.toContain("browser-handle:opaque");
    app.close();
  });

  it("rejects unsafe browser candidate paths and stale scan pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-browser-path-"));
    roots.push(root);
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Browser path",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "browser-path-add",
      sources: [
        {
          kind: "folder",
          displayName: "Trip",
          accessClass: "ephemeral-browser-file",
          accessRef: "browser-file:opaque",
        },
      ],
    });
    const selectionId = draft.selections[0]!.id;
    const scan = await app.sourceDiscovery.beginBrowserScan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-path-scan",
      selectionId,
    });
    await expect(
      app.sourceDiscovery.appendBrowserScanPage({
        projectId: app.project.id,
        baseRevision: draft.revision,
        requestId: "browser-path-scan",
        selectionId,
        scanRevision: scan.scanRevision,
        candidates: [
          { relativePath: "../outside.jpg", name: "outside.jpg", size: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "request.invalid" });
    await expect(
      app.sourceDiscovery.appendBrowserScanPage({
        projectId: app.project.id,
        baseRevision: draft.revision + 1,
        requestId: "browser-path-scan",
        selectionId,
        scanRevision: scan.scanRevision,
        candidates: [{ relativePath: "safe.jpg", name: "safe.jpg", size: 1 }],
      }),
    ).rejects.toMatchObject({ code: "import.draftStale" });
    app.close();
  });
});
