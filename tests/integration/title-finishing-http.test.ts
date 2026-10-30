// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
it("serves current bilingual caption PNG/inspection and rejects foreign/stale requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-title-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Bilingual caption",
  );
  const projectId = app.project.id;
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
          id: "zh-en",
          name: "Bilingual",
          style: { version: 1, role: "subtitle", fontSize: 16 },
          cues: [
            {
              version: 1,
              id: "cue",
              startMs: 0,
              endMs: 900,
              text: "繁體標題\nOur story",
              textRuns: {
                version: 1,
                splitAt: 4,
                secondary: { fontSize: 12, fontWeight: 700 },
              },
              source: { kind: "manual" },
              manualRevision: 0,
            },
          ],
        },
      ],
    },
  ];
  app.close();
  const server = await startServer({ port: 0, project: app.directory });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const state = await (
    await fetch(`${base}/api/compositions/film/editor`)
  ).json();
  const url = (revision = state.revision, id = projectId, kind = ".png") =>
    `${base}/api/compositions/film/caption/zh-en/cue${kind}?${new URLSearchParams({ projectId: id, revision })}`;
  const image = await fetch(url());
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(
    Buffer.from(await image.arrayBuffer())
      .subarray(1, 4)
      .toString(),
  ).toBe("PNG");
  const inspect = await fetch(url(state.revision, projectId, "/inspection"));
  expect(inspect.status).toBe(200);
  const body = await inspect.json();
  expect(body.runFonts.map((run: { id: string }) => run.id)).toEqual([
    "primary",
    "secondary",
  ]);
  expect(JSON.stringify(body)).not.toMatch(/"path"|\/usr\/share|\.openfilm/);
  expect((await fetch(url(state.revision, "wrong"))).status).toBe(409);
  const edit = await fetch(`${base}/api/compositions/film/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseRevision: state.revision,
      commands: [
        {
          type: "caption.cue.update",
          trackId: "zh-en",
          cueId: "cue",
          patch: { textRuns: null },
        },
      ],
    }),
  });
  expect(edit.ok).toBe(true);
  expect((await fetch(url())).status).toBe(409);
});
