// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
const roots: string[] = [];
const apps = new Set<OpenFilmApplication>();
afterEach(async () => {
  for (const app of apps) app.close();
  apps.clear();
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
