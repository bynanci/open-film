import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
import { graphicScene } from "../fixtures/graphic-scene.js";
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it("serves only current project/revision PNGs through the shared HTTP application boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-graphic-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Synthetic.openfilm");
  const app = await OpenFilmApplication.create(directory, "Synthetic graphics");
  app.project.settings = { width: 320, height: 180, frameRate: 30 };
  app.project.stories.push({ id: "story", title: "Synthetic", beats: [] });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [graphicScene()],
  });
  await app.save();
  const state = new TimelineEditor(app).get("film");
  const projectId = app.project.id;
  app.close();
  const server = await startServer({ port: 0, project: directory });
  cleanup.push(() => server.close());
  const origin = `http://127.0.0.1:${server.port}/api`;
  const url = (revision: string, project = projectId, frame = "90") =>
    `${origin}/compositions/film/graphics.png?${new URLSearchParams({ projectId: project, revision, frame })}`;
  const first = await fetch(url(state.revision));
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect(first.headers.get("content-type")).toBe("image/png");
  const png = Buffer.from(await first.arrayBuffer());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(320);
  expect((await fetch(url(state.revision, "another-project"))).status).toBe(
    409,
  );
  expect((await fetch(url(state.revision, projectId, "NaN"))).status).toBe(400);
  expect((await fetch(url(state.revision, projectId, "180"))).status).toBe(400);
  const scene = graphicScene();
  scene.nodes[0]!.x = 42;
  const edited = await fetch(`${origin}/compositions/film/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseRevision: state.revision,
      commands: [{ type: "graphic.scene.upsert", scene }],
    }),
  });
  expect(edited.status).toBe(200);
  const next = (await edited.json()) as { revision: string };
  expect((await fetch(url(state.revision))).status).toBe(409);
  const fresh = await fetch(url(next.revision));
  expect(fresh.status).toBe(200);
  expect(Buffer.from(await fresh.arrayBuffer())).not.toEqual(png);
});

it("previews and accepts deterministic agent edits through the shared HTTP application boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-graphic-agent-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Synthetic.openfilm");
  const app = await OpenFilmApplication.create(directory, "Synthetic graphics");
  app.project.stories.push({ id: "story", title: "Synthetic", beats: [] });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [graphicScene()],
  });
  await app.save();
  const before = new TimelineEditor(app).get("film");
  app.close();
  const server = await startServer({ port: 0, project: directory });
  cleanup.push(() => server.close());
  const origin = `http://127.0.0.1:${server.port}/api`;
  const route = `${origin}/compositions/film/graphic-agent`;
  const preview = await fetch(`${route}/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseRevision: before.revision,
      sceneId: "graphic-scene",
      nodeIds: ["rectangle"],
      instruction: "move right 24",
      mode: "local",
    }),
  });
  expect(preview.status).toBe(200);
  const plan = (await preview.json()) as {
    id: string;
    baseRevision: string;
    source: string;
    actions: { id: string; nodeId: string }[];
  };
  expect(plan).toMatchObject({
    baseRevision: before.revision,
    source: "local",
    actions: [{ nodeId: "rectangle" }],
  });
  const accepted = await fetch(`${route}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      planId: plan.id,
      baseRevision: plan.baseRevision,
      actionIds: [plan.actions[0]!.id],
      requestId: "http-graphic-agent-accept",
    }),
  });
  expect(accepted.status).toBe(200);
  const state = (await accepted.json()) as {
    revision: string;
    composition: { graphicScenes: { nodes: { x: number }[] }[] };
  };
  expect(state.composition.graphicScenes[0]!.nodes[0]!.x).toBe(24);
  const undone = await fetch(`${origin}/compositions/film/undo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: state.revision }),
  });
  expect(undone.status).toBe(200);
  expect((await undone.json()).composition.graphicScenes[0].nodes[0].x).toBe(0);
});
