import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
import { resolveTitleFont } from "@openfilm/render";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
it("serves the shared CJK title only for the current project revision and exports a source-bound recipe", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-quality-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await generateSampleMedia(root);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "A photo film",
  );
  const projectId = app.project.id;
  app.project.settings = { width: 640, height: 360, frameRate: 30 };
  app.catalog.upsertAsset({
    id: "photo",
    name: "01-photo.png",
    uri: pathToFileURL(join(root, "01-photo.png")).href,
    mediaType: "image",
    dimensions: { width: 320, height: 180 },
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
            title: "一起走過的日子",
            titleStyle: { version: 1, role: "scene-statement" },
          },
        ],
      },
    ],
  });
  app.close();
  const runtime = await startServer({
    port: 0,
    project: join(root, "film.openfilm"),
  });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}`;
  const editor = await (
    await fetch(`${base}/api/compositions/film/editor`)
  ).json();
  const titleUrl = (revision: string, id = projectId) =>
    `${base}/api/compositions/film/title/clip.png?${new URLSearchParams({ projectId: id, revision })}`;
  expect((await fetch(titleUrl(editor.revision, "other-project"))).status).toBe(
    409,
  );
  const first = await fetch(titleUrl(editor.revision));
  expect(first.headers.get("content-type")).toBe("image/png");
  const firstBytes = Buffer.from(await first.arrayBuffer());
  expect(firstBytes.subarray(1, 4).toString()).toBe("PNG");
  const edit = await fetch(`${base}/api/compositions/film/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseRevision: editor.revision,
      requestId: "new-title",
      commands: [
        { type: "presentation", clipId: "clip", title: "與你一起，走向未來。" },
      ],
    }),
  });
  expect(edit.status).toBe(200);
  const changed = await edit.json();
  expect((await fetch(titleUrl(editor.revision))).status).toBe(409);
  const current = await fetch(titleUrl(changed.revision));
  expect(current.status).toBe(200);
  expect(Buffer.from(await current.arrayBuffer())).not.toEqual(firstBytes);
  const exported = await fetch(`${base}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "mp4", compositionId: "film" }),
  });
  expect(exported.status).toBe(200);
  const result = await exported.json();
  const manifestResponse = await fetch(
    `${base}/api/export/file?${new URLSearchParams({ name: `${result.filename}.manifest.json` })}`,
  );
  expect(manifestResponse.status).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest.version).toBe(1);
  expect(manifest.project.id).toBe(projectId);
  expect(manifest.project.revision).toMatch(/^[a-f0-9]{64}$/u);
  expect(manifest.renderer.ffmpegVersion).toContain("ffmpeg version");
  expect(manifest.composition.tracks[0].clips[0].title).toBe(
    "與你一起，走向未來。",
  );
  expect(manifest.sources[0].sha256).toBe(
    createHash("sha256")
      .update(await readFile(join(root, "01-photo.png")))
      .digest("hex"),
  );
  expect(manifest.fonts[0].postscriptName).toBe(
    (await resolveTitleFont({ role: "scene-statement" })).font.postscriptName,
  );
  expect(manifest.outputSha256).toBe(
    createHash("sha256")
      .update(await readFile(result.path))
      .digest("hex"),
  );
}, 30000);
