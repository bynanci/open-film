// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as render from "@openfilm/render";
import { titleTestFontOptions } from "../../../tests/helpers/title-test-fonts.js";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
const roots: string[] = [];
const apps = new Set<OpenFilmApplication>();
afterEach(async () => {
  for (const app of apps) app.close();
  apps.clear();
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-title-overlay-"));
  roots.push(root);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Overlay",
  );
  apps.add(app);
  const fonts = await titleTestFontOptions();
  vi.spyOn(app, "titleFontPath").mockImplementation(fonts.fontPathForStyle);
  app.project.settings = { width: 320, height: 180, frameRate: 30 };
  app.project.stories = [{ id: "story", title: "Story", beats: [] }];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 1,
      tracks: [],
      captionTracks: [
        {
          version: 1,
          id: "captions",
          name: "Bilingual",
          style: { version: 1, role: "subtitle", fontSize: 16 },
          cues: Array.from({ length: 10 }, (_, n) => ({
            version: 1 as const,
            id: `cue-${n}`,
            startMs: 0,
            endMs: 900,
            text: `繁體標題\nStory ${n}`,
            textRuns: {
              version: 1 as const,
              splitAt: 4,
              secondary: { fontSize: 12, fontWeight: 700 },
            },
            source: { kind: "manual" as const },
            manualRevision: 0,
          })),
        },
      ],
    },
  ];
  await app.save();
  const editor = new TimelineEditor(app);
  const input = {
    projectId: app.project.id,
    compositionId: "film",
    revision: editor.get("film").revision,
    reference: {
      kind: "caption" as const,
      trackId: "captions",
      cueId: "cue-0",
    },
  };
  return { app, editor, input };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps a shared image live when its first subscriber cancels", async () => {
  const { app, input } = await fixture();
  const entered = deferred(),
    release = deferred(),
    inspect = render.inspectTitleOverlay;
  let inspections = 0;
  vi.spyOn(render, "inspectTitleOverlay").mockImplementation(
    async (...args) => {
      inspections++;
      entered.resolve();
      await release.promise;
      return inspect(...args);
    },
  );
  const controller = new AbortController();
  const first = app.textOverlays.image(input, { signal: controller.signal });
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const retained = app.textOverlays.image(input);
  try {
    await entered.promise;
    controller.abort();
    await cancelled;
    release.resolve();
    const path = await retained;
    expect((await readFile(path)).subarray(1, 4).toString()).toBe("PNG");
    expect(inspections).toBe(1);
  } finally {
    release.resolve();
    await Promise.allSettled([first, retained]);
  }
});

it("retries an active image after its last subscriber cancels without old cleanup evicting the replacement", async () => {
  const { app, input } = await fixture();
  const entered = [deferred(), deferred()],
    release = [deferred(), deferred()],
    raster = render.createTitleOverlay,
    inspect = render.inspectTitleOverlay;
  const temporaryPaths: string[] = [];
  let active = 0,
    maximumActive = 0,
    inspections = 0;
  vi.spyOn(render, "inspectTitleOverlay").mockImplementation((...args) => {
    inspections++;
    return inspect(...args);
  });
  vi.spyOn(render, "createTitleOverlay").mockImplementation(async (...args) => {
    const index = temporaryPaths.push(args[3]) - 1;
    active++;
    maximumActive = Math.max(maximumActive, active);
    try {
      const result = await raster(...args);
      entered[index]?.resolve();
      await release[index]?.promise;
      return result;
    } finally {
      active--;
    }
  });
  const firstController = new AbortController(),
    lastController = new AbortController();
  const first = app.textOverlays.image(input, {
    signal: firstController.signal,
  });
  const last = app.textOverlays.image(input, { signal: lastController.signal });
  const firstCancelled = expect(first).rejects.toMatchObject({
    name: "AbortError",
  });
  const lastCancelled = expect(last).rejects.toMatchObject({
    name: "AbortError",
  });
  const pending: Promise<unknown>[] = [first, last];
  try {
    await entered[0]!.promise;
    firstController.abort();
    await firstCancelled;
    lastController.abort();
    await lastCancelled;
    const retry = app.textOverlays.image(input);
    pending.push(retry);
    const retryOutcome = retry.then(
      () => "fulfilled",
      () => "rejected",
    );
    expect(temporaryPaths).toHaveLength(1);
    release[0]!.resolve();
    expect(
      await Promise.race([
        entered[1]!.promise.then(() => "replacement started"),
        retryOutcome,
      ]),
    ).toBe("replacement started");
    // The old operation has drained before the queued replacement can raster.
    // Another subscriber must still join that replacement after old finally.
    await expect(readFile(temporaryPaths[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const joined = app.textOverlays.image(input);
    pending.push(joined);
    release[1]!.resolve();
    const [path, joinedPath] = await Promise.all([retry, joined]);
    expect(joinedPath).toBe(path);
    expect((await readFile(path)).subarray(1, 4).toString()).toBe("PNG");
    expect(temporaryPaths).toHaveLength(2);
    expect(inspections).toBe(2);
    expect(maximumActive).toBe(1);
    expect(await readdir(join(app.directory, "cache", "titles"))).toEqual([
      basename(path),
    ]);
  } finally {
    release.forEach((gate) => gate.resolve());
    await Promise.allSettled(pending);
  }
});

it("admits immediate queued-key retries through a cancellation flood while retaining the eight queued limit", async () => {
  const { app, input } = await fixture();
  const entered = deferred(),
    release = deferred(),
    inspect = render.inspectTitleOverlay;
  let inspections = 0;
  vi.spyOn(render, "inspectTitleOverlay").mockImplementation(
    async (...args) => {
      inspections++;
      if (inspections === 1) {
        entered.resolve();
        await release.promise;
      }
      return inspect(...args);
    },
  );
  const request = (index: number) => ({
    ...input,
    reference: { ...input.reference, cueId: `cue-${index}` },
  });
  const blocker = app.textOverlays.image(input);
  const pending: Promise<unknown>[] = [blocker];
  try {
    await entered.promise;
    const cancelled: Promise<unknown>[] = [];
    for (let index = 0; index < 32; index++) {
      const controller = new AbortController();
      const abandoned = app.textOverlays.image(request(1), {
        signal: controller.signal,
      });
      pending.push(abandoned);
      cancelled.push(
        expect(abandoned).rejects.toMatchObject({ name: "AbortError" }),
      );
      controller.abort();
    }
    const retry = app.textOverlays.image(request(1));
    pending.push(retry);
    const outcome = retry.then(
      () => "fulfilled",
      () => "rejected",
    );
    await Promise.all(cancelled);
    const queued = Array.from({ length: 7 }, (_, index) =>
      app.textOverlays.image(request(index + 2)),
    );
    pending.push(...queued);
    const overflow = app.textOverlays.image(request(9));
    pending.push(overflow);
    const overflowOutcome = overflow.then(
      () => ({ status: 200 }),
      (error: unknown) => error,
    );
    // All abandoned entries have settled; their cleanup must not evict retry.
    const joined = app.textOverlays.image(request(1));
    pending.push(joined);
    const joinedOutcome = joined.then(
      () => "fulfilled",
      () => "rejected",
    );
    expect(inspections).toBe(1);
    release.resolve();
    expect(await outcome).toBe("fulfilled");
    expect(await joinedOutcome).toBe("fulfilled");
    expect(await overflowOutcome).toMatchObject({
      status: 429,
      code: "title.busy",
    });
    expect(await joined).toBe(await retry);
    await Promise.all([blocker, ...queued]);
    expect(inspections).toBe(9);
    expect(await readdir(join(app.directory, "cache", "titles"))).toHaveLength(
      9,
    );
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
  }
});
it("serves the measured caption PNG and path-free actual per-run inspection without changing history", async () => {
  const { app, editor, input } = await fixture();
  expect(app.textOverlays).toBeDefined();
  const before = editor.get("film"),
    disk = await readFile(join(app.directory, "project.json"), "utf8");
  const [first, second] = await Promise.all([
    app.textOverlays.image(input),
    app.textOverlays.image(input),
  ]);
  expect(first).toBe(second);
  expect((await readFile(first)).subarray(1, 4).toString()).toBe("PNG");
  const inspection = await app.textOverlays.inspect(input);
  expect(inspection.status).toBe("measured");
  if (inspection.status !== "measured") throw new Error(inspection.message);
  expect(inspection.runFonts.map((run) => [run.id, run.actualWeight])).toEqual([
    ["primary", 400],
    ["secondary", 700],
  ]);
  expect(JSON.stringify(inspection)).not.toMatch(
    /"path"|\/usr\/share|\.openfilm/,
  );
  expect(editor.get("film")).toEqual(before);
  expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
    disk,
  );
  expect(
    (await readdir(join(app.directory, "cache", "titles"))).filter((name) =>
      name.endsWith(".png"),
    ),
  ).toHaveLength(1);
});
it("rejects wrong project, stale revision, changed settings, missing cue and closed owner", async () => {
  const { app, input } = await fixture();
  expect(app.textOverlays).toBeDefined();
  await expect(
    app.textOverlays.image({ ...input, projectId: "other" }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    app.textOverlays.image({ ...input, revision: "old" }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    app.textOverlays.image({
      ...input,
      reference: { ...input.reference, cueId: "missing" },
    }),
  ).rejects.toMatchObject({ status: 404 });
  const pending = app.textOverlays.image(input);
  app.project.settings.width = 640;
  await expect(pending).rejects.toMatchObject({ status: 409 });
  app.close();
  apps.delete(app);
  await expect(app.textOverlays.image(input)).rejects.toMatchObject({
    status: 409,
  });
});
it("bounds concurrent raster work and drops aborted queued requests", async () => {
  const { app, input } = await fixture();
  expect(app.textOverlays).toBeDefined();
  const requests = Array.from({ length: 9 }, (_, index) =>
    app.textOverlays.image({
      ...input,
      reference: { ...input.reference, cueId: `cue-${index}` },
    }),
  );
  await expect(
    app.textOverlays.image({
      ...input,
      reference: { ...input.reference, cueId: "cue-9" },
    }),
  ).rejects.toMatchObject({ status: 429, code: "title.busy" });
  await Promise.all(requests);
  const abort = new AbortController();
  abort.abort();
  await expect(
    app.textOverlays.image(input, { signal: abort.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
