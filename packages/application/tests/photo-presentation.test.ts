import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { hashFile, runProcess } from "@openfilm/media";
import * as render from "@openfilm/render";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-photo-presentation-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "portrait.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=100x200",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    source,
  ]);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic photo finishing",
  );
  let closed = false;
  const close = () => {
    if (!closed) {
      app.close();
      closed = true;
    }
  };
  cleanups.push(async () => close());
  app.project.settings = { width: 320, height: 180, frameRate: 30 };
  app.catalog.upsertAsset({
    id: "photo",
    name: "portrait.png",
    uri: pathToFileURL(source).href,
    mediaType: "image",
    dimensions: { width: 100, height: 200 },
    contentHash: await hashFile(source),
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories.push({
    id: "story",
    title: "Story",
    beats: [{ id: "beat", title: "Together", candidateAssetIds: ["photo"] }],
  });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [
      {
        id: "visual",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "photo",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 6,
            layout: {
              version: 2,
              preset: "contain",
              fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
            },
          },
        ],
      },
    ],
  });
  await app.save();
  const editor = new TimelineEditor(app);
  const input = () => ({
    projectId: app.project.id,
    baseRevision: editor.get("film").revision,
  });
  return { app, editor, input, source, close };
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("prepares a source-bound raw PNG from the current saved project without changing history or source", async () => {
  const { app, editor, input, source } = await fixture();
  const before = editor.get("film");
  const bytes = await readFile(join(app.directory, "project.json"));
  const original = await hashFile(source);
  const png = await app.photoPresentation.ambient("film", "clip", input());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(editor.get("film")).toEqual(before);
  expect(await readFile(join(app.directory, "project.json"))).toEqual(bytes);
  expect(await hashFile(source)).toBe(original);
  expect(
    await readdir(join(app.directory, "cache", "photo-presentation")),
  ).toEqual([]);
  await expect(
    app.photoPresentation.ambient("film", "clip", {
      ...input(),
      projectId: "other",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    app.photoPresentation.ambient("film", "clip", {
      ...input(),
      baseRevision: "old",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    app.photoPresentation.ambient("film", "clip", {
      ...input(),
      url: "https://example.invalid/a.png",
    } as never),
  ).rejects.toMatchObject({ status: 400 });
});

it("rejects late preparation after saved settings or same-ID catalog source changes", async () => {
  const { app, input, source } = await fixture();
  const entered = barrier(),
    resume = barrier();
  const original = render.preparePhotoAmbientFills;
  vi.spyOn(render, "preparePhotoAmbientFills").mockImplementation(
    async (...args) => {
      entered.resolve();
      await resume.promise;
      return original(...args);
    },
  );
  const pending = app.photoPresentation.ambient("film", "clip", input());
  const rejected = expect(pending).rejects.toMatchObject({ status: 409 });
  await entered.promise;
  app.project.settings.width = 640;
  await app.save();
  const asset = app.catalog.getAsset("photo")!;
  app.catalog.upsertAsset({
    ...asset,
    uri: pathToFileURL(join(app.directory, "different.png")).href,
  });
  resume.resolve();
  await rejected;
  expect(await hashFile(source)).toBe(asset.contentHash);
});

it("deduplicates exact requests and cancels a shared worker only after its last waiter leaves", async () => {
  const { app, input } = await fixture();
  const entered = barrier(),
    resume = barrier();
  const original = render.preparePhotoAmbientFills;
  const prepare = vi
    .spyOn(render, "preparePhotoAmbientFills")
    .mockImplementation(async (...args) => {
      entered.resolve();
      await resume.promise;
      return original(...args);
    });
  const firstAbort = new AbortController();
  const first = app.photoPresentation.ambient("film", "clip", {
    ...input(),
    signal: firstAbort.signal,
  });
  const firstRejected = expect(first).rejects.toThrow(/cancel|abort/iu);
  const second = app.photoPresentation.ambient("film", "clip", input());
  await entered.promise;
  firstAbort.abort();
  await firstRejected;
  resume.resolve();
  expect((await second).subarray(1, 4).toString()).toBe("PNG");
  expect(prepare).toHaveBeenCalledTimes(1);
});

it("bounds queued requests and fences every waiter when the project closes", async () => {
  const { app, input, close } = await fixture();
  const entered = barrier(),
    resume = barrier();
  const original = render.preparePhotoAmbientFills;
  vi.spyOn(render, "preparePhotoAmbientFills").mockImplementation(
    async (...args) => {
      entered.resolve();
      await resume.promise;
      return original(...args);
    },
  );
  const first = app.photoPresentation.ambient("film", "clip", input());
  const rejects = [expect(first).rejects.toThrow()];
  await entered.promise;
  for (let n = 1; n <= 4; n++) {
    // Distinct valid snapshots enter the bounded queue while one worker is blocked.
    app.project.title = `Snapshot ${n}`;
    await app.save();
    app.project.timelines[0]!.tracks[0]!.clips[0]!.title = `Synthetic ${n}`;
    await app.save();
    rejects.push(
      expect(
        app.photoPresentation.ambient("film", "clip", input()),
      ).rejects.toThrow(),
    );
  }
  app.project.timelines[0]!.tracks[0]!.clips[0]!.title = "Overflow";
  await app.save();
  await expect(
    app.photoPresentation.ambient("film", "clip", input()),
  ).rejects.toMatchObject({ code: "jobs.busy", status: 409 });
  close();
  resume.resolve();
  await Promise.all(rejects);
});

it("lets a fresh same-key request replace an already cancelled in-flight task", async () => {
  const { app, input } = await fixture();
  const entered = barrier(),
    resume = barrier();
  const original = render.preparePhotoAmbientFills;
  const prepare = vi
    .spyOn(render, "preparePhotoAmbientFills")
    .mockImplementationOnce(async (...args) => {
      entered.resolve();
      await resume.promise;
      return original(...args);
    });
  const controller = new AbortController();
  const first = app.photoPresentation.ambient("film", "clip", {
    ...input(),
    signal: controller.signal,
  });
  const rejected = expect(first).rejects.toThrow(/cancel|abort/iu);
  await entered.promise;
  controller.abort();
  await rejected;
  const replacement = app.photoPresentation.ambient("film", "clip", input());
  const accepted = expect(replacement).resolves.toBeInstanceOf(Buffer);
  resume.resolve();
  await accepted;
  expect(prepare).toHaveBeenCalledTimes(2);
});

it("keeps one v2 transaction through retry undo redo reopen and a Named Version, rejecting invalid later edits atomically", async () => {
  const { app, editor, input } = await fixture();
  const original = editor.get("film");
  const motion = {
    version: 2 as const,
    preset: "pan" as const,
    easing: {
      version: 1 as const,
      kind: "cubic-bezier" as const,
      x1: 0.42,
      y1: 0,
      x2: 0.58,
      y2: 1,
    },
    from: { scale: 1.08, x: -6, y: 0 },
    to: { scale: 1.08, x: 6, y: 0 },
  };
  const request = {
    baseRevision: input().baseRevision,
    requestId: "synthetic-v2",
    commands: [{ type: "presentation" as const, clipId: "clip", motion }],
  };
  const saved = await editor.edit("film", request);
  expect(saved.canUndo).toBe(true);
  expect((await editor.edit("film", request)).composition).toEqual(
    saved.composition,
  );
  const undone = await editor.undo("film", saved.revision);
  expect(undone.composition).toEqual(original.composition);
  const disk = await readFile(join(app.directory, "project.json"));
  await expect(
    editor.edit("film", {
      baseRevision: undone.revision,
      commands: [
        { type: "duration", clipId: "clip", duration: 3 },
        {
          type: "presentation",
          clipId: "clip",
          layout: {
            version: 2,
            preset: "diptych",
            gap: 319,
            secondary: { assetId: "other" },
            fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
          },
        },
      ],
    }),
  ).rejects.toThrow(/pixel|gap/iu);
  expect(await readFile(join(app.directory, "project.json"))).toEqual(disk);
  const redone = await editor.redo("film", undone.revision);
  expect(redone.composition).toEqual(saved.composition);
  const version = await app.versions.create({
    name: "Photo v2",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  await editor.edit("film", {
    baseRevision: redone.revision,
    commands: [{ type: "presentation", clipId: "clip", motion: null }],
  });
  await app.versions.restore(version.id, {
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
    confirmed: true,
  });
  expect(new TimelineEditor(app).get("film").composition).toEqual(
    saved.composition,
  );
  const reopened = await OpenFilmApplication.open(app.directory);
  cleanups.push(async () => reopened.close());
  expect(new TimelineEditor(reopened).get("film").composition).toEqual(
    saved.composition,
  );
});
