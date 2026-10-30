import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSampleMedia } from "../../../fixtures/sample-media/generate.mjs";
import { hashFile } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("source batch sealing", () => {
  it.each(["after-upload", "during-upload"])(
    "rejects stale browser staging after a same-size replacement %s",
    async (when) => {
      const root = await mkdtemp(
        join(tmpdir(), "openfilm-browser-stage-replacement-"),
      );
      roots.push(root);
      const generated = join(root, "generated");
      await generateSampleMedia(generated);
      const a = await readFile(join(generated, "01-photo.png"));
      const b = await readFile(join(generated, "03-evening.png"));
      const size = Math.max(a.length, b.length);
      const bytesA = Buffer.concat([a, Buffer.alloc(size - a.length)]);
      const bytesB = Buffer.concat([b, Buffer.alloc(size - b.length)]);
      const app = await OpenFilmApplication.create(
        join(root, "film.openfilm"),
        "Browser replacement",
      );
      const draft = app.sourceDraft.add({
        projectId: app.project.id,
        baseRevision: 0,
        requestId: "add-browser",
        sources: [
          {
            kind: "folder",
            displayName: "Synthetic browser folder",
            accessClass: "persistent-browser-handle",
            accessRef: "browser-handle:synthetic",
            recursive: true,
          },
        ],
      });
      const selectionId = draft.selections[0]!.id;
      let revision = 0;
      const scan = async (modifiedAt: string) => {
        const requestId = `scan-${++revision}`;
        const input = {
          projectId: app.project.id,
          baseRevision: draft.revision,
          requestId,
          selectionId,
        };
        const started = await app.sourceDiscovery.beginBrowserScan(input);
        await app.sourceDiscovery.appendBrowserScanPage({
          ...input,
          scanRevision: started.scanRevision,
          candidates: [
            { name: "one.png", relativePath: "one.png", size, modifiedAt },
          ],
        });
        await app.sourceDiscovery.finishBrowserScan({
          ...input,
          scanRevision: started.scanRevision,
        });
        return app.catalog.multiSource.listOccurrences(selectionId).items[0]!
          .occurrence;
      };
      const first = await scan("2026-01-01T00:00:00.000Z");
      const stage = (
        bytes: Buffer,
        modifiedAt: string | undefined,
        chunks = Readable.from([bytes]),
      ) =>
        app.sourceBatches.stageBrowserOccurrence({
          projectId: app.project.id,
          baseRevision: draft.revision,
          selectionId,
          occurrenceId: first.id,
          modifiedAt,
          chunks,
        });
      if (when === "after-upload") {
        await stage(bytesA, first.modifiedAt);
        const replaced = await scan("2026-01-01T00:00:01.000Z");
        expect(replaced.id).toBe(first.id);
      } else {
        const chunks = Readable.from(
          (async function* () {
            yield bytesA.subarray(0, Math.floor(size / 2));
            await scan("2026-01-01T00:00:01.000Z");
            yield bytesA.subarray(Math.floor(size / 2));
          })(),
        );
        await expect(
          stage(bytesA, first.modifiedAt, chunks),
        ).rejects.toMatchObject({ code: "source.changed" });
      }
      expect(
        (await app.sourceBatches.listBrowserStagedOccurrences(selectionId))
          .occurrenceIds,
      ).toEqual([]);
      const failed = await app.sourceBatches.createAndSeal({
        projectId: app.project.id,
        baseRevision: draft.revision,
        requestId: "seal-stale",
        partialPolicy: "require-all",
      });
      expect(failed.status).toBe("failed");
      expect(failed.verified).toBe(0);
      await stage(bytesB, "2026-01-01T00:00:01.000Z");
      const sealed = await app.sourceBatches.createAndSeal({
        projectId: app.project.id,
        baseRevision: draft.revision,
        requestId: "seal-fresh",
        partialPolicy: "require-all",
      });
      expect(sealed.status).toBe("sealed");
      expect(sealed.verifiedManifest.members[0]!.contentHash).toBe(
        createHash("sha256").update(bytesB).digest("hex"),
      );
      app.close();
    },
  );

  it("stages immutable content, reuses exact duplicates and publishes a verified manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-batch-"));
    roots.push(root);
    const generated = join(root, "generated");
    const selected = join(root, "selected");
    await generateSampleMedia(generated);
    await mkdir(selected);
    const source = join(selected, "one.png");
    const duplicate = join(selected, "two.png");
    await copyFile(join(generated, "01-photo.png"), source);
    await copyFile(join(generated, "02-photo-copy.png"), duplicate);
    const sourceHash = await hashFile(source);
    const duplicateHash = await hashFile(duplicate);
    expect(duplicateHash).toBe(sourceHash);

    const projectDirectory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(
      projectDirectory,
      "Sealed sources",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "batch-add-source",
      sources: [
        {
          kind: "folder",
          displayName: "Synthetic photos",
          accessClass: "native-path",
          accessRef: selected,
          recursive: true,
        },
      ],
    });
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "batch-prescan",
    });

    const result = await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "batch-seal",
      partialPolicy: "require-all",
    });
    expect(result).toMatchObject({
      status: "sealed",
      expected: 2,
      included: 2,
      verified: 2,
      failed: 0,
      excluded: 0,
    });
    expect(
      new Set(result.verifiedManifest.members.map((member) => member.assetId))
        .size,
    ).toBe(1);
    expect(
      result.verifiedManifest.members.map((member) => member.contentHash),
    ).toEqual([sourceHash, duplicateHash]);
    expect(app.catalog.listAssets()).toHaveLength(1);
    expect(await hashFile(source)).toBe(sourceHash);
    expect(await hashFile(duplicate)).toBe(duplicateHash);
    expect(result.batch.status).toBe("sealed");

    const database = new DatabaseSync(
      join(projectDirectory, "database.sqlite"),
      { readOnly: true },
    );
    const semantic = JSON.stringify(
      database
        .prepare(
          "SELECT data FROM source_selections UNION ALL SELECT data FROM file_occurrences UNION ALL SELECT data FROM selection_memberships UNION ALL SELECT data FROM import_batches UNION ALL SELECT data FROM expected_manifests UNION ALL SELECT data FROM expected_manifest_entries UNION ALL SELECT data FROM verified_manifests UNION ALL SELECT data FROM verified_manifest_entries",
        )
        .all(),
    );
    database.close();
    expect(semantic).not.toContain(selected);
    expect(semantic).not.toContain("accessRef");
    expect(await readFile(source)).toEqual(await readFile(duplicate));
    app.close();
    const reopened = await OpenFilmApplication.open(projectDirectory);
    expect(
      reopened.catalog.multiSource.getVerifiedManifestByExpectedId(
        result.expectedManifest.id,
      ),
    ).toEqual(result.verifiedManifest);
    reopened.close();
  });

  it("does not import bytes that changed after the expected manifest was created", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-change-"));
    roots.push(root);
    const media = join(root, "media");
    await mkdir(media);
    const source = join(media, "changed.png");
    await writeFile(source, "before-scan");
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Changed source",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "changed-add",
      sources: [
        {
          kind: "folder",
          displayName: "Media",
          accessClass: "native-path",
          accessRef: media,
          recursive: true,
        },
      ],
    });
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "changed-scan",
    });
    await writeFile(source, "different bytes after scan");

    const result = await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "changed-seal",
      partialPolicy: "allow-readable",
    });
    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.verifiedManifest.failures).toEqual([
      { occurrenceId: expect.any(String), code: "source.changed" },
    ]);
    expect(app.catalog.listAssets()).toEqual([]);
    app.close();
  });

  it("keeps readable members visible in a partial verified manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-partial-"));
    roots.push(root);
    const generated = join(root, "generated");
    const media = join(root, "media");
    await generateSampleMedia(generated);
    await mkdir(media);
    await copyFile(
      join(generated, "01-photo.png"),
      join(media, "readable.png"),
    );
    await writeFile(
      join(media, "corrupt.png"),
      "not an image, despite its extension",
    );
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Partial source batch",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "partial-add",
      sources: [
        {
          kind: "folder",
          displayName: "Media",
          accessClass: "native-path",
          accessRef: media,
        },
      ],
    });
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "partial-scan",
    });
    const result = await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "partial-seal",
      partialPolicy: "allow-readable",
    });
    expect(result).toMatchObject({
      status: "partial",
      expected: 2,
      verified: 1,
      failed: 1,
    });
    expect(result.verifiedManifest.members).toHaveLength(1);
    expect(result.verifiedManifest.failures).toEqual([
      { occurrenceId: expect.any(String), code: "import.failed" },
    ]);
    app.close();
  });

  it("persists independent include choices and records excluded members", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-exclusions-"));
    roots.push(root);
    const generated = join(root, "generated");
    const media = join(root, "media");
    await generateSampleMedia(generated);
    await mkdir(media);
    await copyFile(join(generated, "01-photo.png"), join(media, "keep.png"));
    await copyFile(
      join(generated, "03-evening.png"),
      join(media, "exclude.png"),
    );
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Membership review",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "membership-add",
      sources: [
        {
          kind: "folder",
          displayName: "Media",
          accessClass: "native-path",
          accessRef: media,
        },
      ],
    });
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "membership-scan",
    });
    const selectionId = draft.selections[0]!.id;
    const occurrences =
      app.catalog.multiSource.listOccurrences(selectionId).items;
    const exclude = occurrences.find(
      ({ occurrence }) => occurrence.relativePath === "exclude.png",
    )!.occurrence;
    const updated = app.sourceBatches.setIncluded({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "membership-toggle",
      selectionId,
      occurrenceId: exclude.id,
      included: false,
    });
    expect(updated.included).toBe(false);
    expect(
      app.catalog.multiSource
        .listOccurrences(selectionId)
        .items.find(({ occurrence }) => occurrence.id === exclude.id)?.included,
    ).toBe(false);

    const sealed = await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "membership-seal",
      partialPolicy: "require-all",
    });
    expect(sealed).toMatchObject({
      status: "sealed",
      included: 1,
      verified: 1,
      excluded: 1,
    });
    expect(sealed.verifiedManifest.excludedOccurrenceIds).toEqual([exclude.id]);
    app.close();
  });

  it("recovers only old unreferenced staged content", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-orphans-"));
    roots.push(root);
    const generated = join(root, "generated");
    const media = join(root, "media");
    await generateSampleMedia(generated);
    await mkdir(media);
    await copyFile(join(generated, "01-photo.png"), join(media, "memory.png"));
    const projectDirectory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(
      projectDirectory,
      "Orphan recovery",
    );
    const stageDirectory = join(projectDirectory, "sources", "collected");
    await mkdir(stageDirectory, { recursive: true });
    const orphanBytes = "orphaned staged bytes";
    const orphanHash = createHash("sha256").update(orphanBytes).digest("hex");
    const orphan = join(
      stageDirectory,
      `${orphanHash}-${Buffer.byteLength(orphanBytes)}.png`,
    );
    await writeFile(orphan, orphanBytes);
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(orphan, oldTime, oldTime);

    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "orphan-add",
      sources: [
        {
          kind: "folder",
          displayName: "Media",
          accessClass: "native-path",
          accessRef: media,
        },
      ],
    });
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "orphan-scan",
    });
    await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "orphan-seal",
    });
    await expect(readFile(orphan)).rejects.toMatchObject({ code: "ENOENT" });
    app.close();
  });

  it("cancels before copying and supports a fresh sealing attempt after a rescan", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-retry-"));
    roots.push(root);
    const generated = join(root, "generated");
    const media = join(root, "media");
    await generateSampleMedia(generated);
    await mkdir(media);
    const source = join(media, "one.png");
    await copyFile(join(generated, "01-photo.png"), source);
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Sealing retry",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "retry-add",
      sources: [
        {
          kind: "folder",
          displayName: "Media",
          accessClass: "native-path",
          accessRef: media,
        },
      ],
    });
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "retry-scan-1",
    });
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "retry-cancelled",
      signal: aborted.signal,
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.verifiedManifest.failures).toEqual([
      { occurrenceId: expect.any(String), code: "source.cancelled" },
    ]);

    await writeFile(source, await readFile(join(generated, "03-evening.png")));
    await app.sourceDiscovery.scan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "retry-scan-2",
    });
    const retried = await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "retry-fresh-batch",
      partialPolicy: "require-all",
    });
    expect(retried.status).toBe("sealed");
    expect(retried.batch.id).not.toBe(cancelled.batch.id);
    app.close();
  });

  it("seals browser-selected bytes from private staging after an application restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-browser-stage-"));
    roots.push(root);
    const generated = join(root, "generated");
    const source = join(generated, "01-photo.png");
    await generateSampleMedia(generated);
    const info = await stat(source);
    const projectDirectory = join(root, "film.openfilm");
    let app = await OpenFilmApplication.create(
      projectDirectory,
      "Browser staged media",
    );
    const draft = app.sourceDraft.add({
      projectId: app.project.id,
      baseRevision: 0,
      requestId: "browser-stage-add",
      sources: [
        {
          kind: "folder",
          displayName: "Browser folder",
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:private-key",
          recursive: true,
        },
      ],
    });
    const selectionId = draft.selections[0]!.id;
    const scan = await app.sourceDiscovery.beginBrowserScan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-stage-scan",
      selectionId,
    });
    await app.sourceDiscovery.appendBrowserScanPage({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-stage-scan",
      selectionId,
      scanRevision: scan.scanRevision,
      candidates: [
        {
          relativePath: "album/01-photo.png",
          name: "01-photo.png",
          size: info.size,
        },
      ],
    });
    await app.sourceDiscovery.finishBrowserScan({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-stage-scan",
      selectionId,
      scanRevision: scan.scanRevision,
    });
    const occurrence =
      app.catalog.multiSource.listOccurrences(selectionId).items[0]!.occurrence;
    await app.sourceBatches.stageBrowserOccurrence({
      projectId: app.project.id,
      baseRevision: draft.revision,
      selectionId,
      occurrenceId: occurrence.id,
      modifiedAt: occurrence.modifiedAt,
      chunks: createReadStream(source),
    });
    app.close();

    app = await OpenFilmApplication.open(projectDirectory);
    await expect(
      app.sourceBatches.listBrowserStagedOccurrences(selectionId),
    ).resolves.toEqual({
      occurrenceIds: [occurrence.id],
      offset: 0,
      limit: 500,
      hasMore: false,
    });
    const sealed = await app.sourceBatches.createAndSeal({
      projectId: app.project.id,
      baseRevision: draft.revision,
      requestId: "browser-stage-seal-after-reopen",
      partialPolicy: "require-all",
    });
    expect(sealed).toMatchObject({
      status: "sealed",
      expected: 1,
      verified: 1,
      failed: 0,
    });
    expect(sealed.verifiedManifest.members[0]?.contentHash).toBe(
      await hashFile(source),
    );
    expect(app.catalog.listAssets()).toHaveLength(1);
    app.close();
  });
});
