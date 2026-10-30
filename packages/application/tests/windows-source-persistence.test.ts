// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { runProcess, hashFile } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";

// Windows capability fixture: real file writes/sync/rename remain real; only
// flushing directory handles reports the Win32 EPERM behavior from issue67.
const capability = vi.hoisted(() => ({
  active: false,
  platform: undefined as NodeJS.Platform | undefined,
  fileSyncs: 0,
  directorySyncs: 0,
  fileError: false,
}));
vi.mock("node:os", async (original) => {
  const real = await original<typeof import("node:os")>();
  return { ...real, platform: () => capability.platform ?? real.platform() };
});
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      if (capability.active) {
        const directory = (await handle.stat()).isDirectory(),
          sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (directory) {
            capability.directorySyncs++;
            throw Object.assign(
              new Error("EPERM: directory fsync unsupported on Windows"),
              { code: "EPERM" },
            );
          }
          capability.fileSyncs++;
          if (capability.fileError)
            throw Object.assign(new Error("EPERM: file flush denied"), {
              code: "EPERM",
            });
          return sync();
        };
      }
      return handle;
    },
  };
});
const stops: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  capability.active = false;
  capability.platform = undefined;
  capability.fileError = false;
  for (const stop of stops.splice(0).reverse()) await stop();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-win-scan-"));
  stops.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "one.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=8x8",
    "-frames:v",
    "1",
    "-threads",
    "1",
    path,
  ]);
  const bytes = await readFile(path),
    hash = await hashFile(path);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic Windows source scan",
  );
  let open = true;
  const close = () => {
    if (open) {
      open = false;
      app.close({ requireSave: false });
    }
  };
  stops.push(close);
  const draft = app.sourceDraft.add({
    projectId: app.project.id,
    baseRevision: 0,
    requestId: "add",
    sources: [
      {
        kind: "folder",
        displayName: "Synthetic",
        accessClass: "persistent-browser-handle",
        accessRef: "browser-handle:synthetic",
        recursive: true,
      },
    ],
  });
  const input = {
    projectId: app.project.id,
    baseRevision: draft.revision,
    requestId: "scan",
    selectionId: draft.selections[0]!.id,
  };
  const scan = await app.sourceDiscovery.beginBrowserScan(input);
  const next = { ...input, scanRevision: scan.scanRevision };
  await app.sourceDiscovery.appendBrowserScanPage({
    ...next,
    candidates: [
      { relativePath: "one.png", name: "one.png", size: bytes.length },
    ],
  });
  return { root, app, next, bytes, path, hash, close };
}
it("finishes a Windows browser scan and keeps verified readiness after reopening without directory fsync", async () => {
  const f = await fixture();
  capability.active = true;
  capability.platform = "win32";
  capability.fileSyncs = 0;
  capability.directorySyncs = 0;
  const completed = await f.app.sourceDiscovery.finishBrowserScan(f.next);
  expect(completed).toMatchObject({
    supported: 1,
    failed: 0,
    cancelled: false,
  });
  expect(capability.fileSyncs).toBeGreaterThan(0);
  expect(capability.directorySyncs).toBe(0);
  expect(await f.app.sourceDiscovery.getReadiness()).toMatchObject({
    supported: 1,
  });
  const occurrence = f.app.catalog.multiSource.listOccurrences(
    f.next.selectionId,
  ).items[0]!.occurrence;
  await f.app.sourceBatches.stageBrowserOccurrence({
    projectId: f.app.project.id,
    baseRevision: f.next.baseRevision,
    selectionId: f.next.selectionId,
    occurrenceId: occurrence.id,
    modifiedAt: occurrence.modifiedAt,
    chunks: Readable.from([f.bytes]),
  });
  const directory = f.app.directory;
  f.close();
  const reopened = await OpenFilmApplication.open(directory);
  stops.push(() => reopened.close({ requireSave: false }));
  expect(await reopened.sourceDiscovery.getReadiness()).toMatchObject({
    supported: 1,
  });
  expect(
    (
      await reopened.sourceBatches.listBrowserStagedOccurrences(
        f.next.selectionId,
      )
    ).occurrenceIds,
  ).toEqual([occurrence.id]);
  const sealed = await reopened.sourceBatches.createAndSeal({
    projectId: reopened.project.id,
    baseRevision: f.next.baseRevision,
    requestId: "seal",
    partialPolicy: "require-all",
  });
  expect(sealed).toMatchObject({
    status: "sealed",
    expected: 1,
    verified: 1,
    failed: 0,
  });
  expect(await hashFile(f.path)).toBe(f.hash);
  expect(capability.directorySyncs).toBe(0);
  expect((await lstat(join(f.app.directory, "database.sqlite"))).isFile()).toBe(
    true,
  );
  expect(
    await readFile(join(f.app.directory, "project.json"), "utf8"),
  ).not.toContain("browser-handle:synthetic");
});
it("still rejects a POSIX directory sync error instead of hiding persistence failures", async () => {
  const f = await fixture();
  capability.active = true;
  capability.platform = "linux";
  await expect(
    f.app.sourceDiscovery.finishBrowserScan(f.next),
  ).rejects.toMatchObject({ code: "EPERM" });
});

it("does not hide a real Windows file-sync failure as unsupported directory capability", async () => {
  const f = await fixture();
  capability.active = true;
  capability.platform = "win32";
  capability.fileError = true;
  await expect(
    f.app.sourceDiscovery.finishBrowserScan(f.next),
  ).rejects.toMatchObject({ code: "EPERM" });
  f.app.sourceDiscovery.cancelBrowserScan(f.next);
});
