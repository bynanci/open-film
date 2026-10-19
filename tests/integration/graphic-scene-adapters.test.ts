import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
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

it("bounds provider previews without holding the project mutation queue", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-graphic-agent-provider-http-"),
  );
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Synthetic.openfilm");
  const userDataDirectory = join(root, "user-data");
  const app = await OpenFilmApplication.create(
    directory,
    "Synthetic graphics",
    {},
    {
      userDataDirectory,
    },
  );
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

  const providerCalls: Array<{
    resolve: (value: string) => void;
    signal?: AbortSignal;
  }> = [];
  const providerCallWaiters = new Map<number, () => void>();
  const waitForProviderCall = (index: number) => {
    if (providerCalls[index]) return Promise.resolve();
    return new Promise<void>((resolve) =>
      providerCallWaiters.set(index, resolve),
    );
  };
  const provider: LanguageProvider = {
    id: "held-graphic-preview-provider",
    name: "Held GraphicScene preview fixture",
    kind: "language",
    execution: "remote",
    endpoint: "https://provider.invalid/graphic-preview",
    dataKinds: ["text"],
    generate(_prompt, options) {
      const index = providerCalls.length;
      // Deliberately uncooperative; KnowledgeService must race the abort signal.
      return new Promise<string>((resolve) => {
        providerCalls.push({ resolve, signal: options?.signal });
        providerCallWaiters.get(index)?.();
      });
    },
  };
  const server = await startServer({
    port: 0,
    project: directory,
    userDataDirectory,
    languageProvider: provider,
    graphicSceneAgentProviderTimeoutMs: 1_500,
  });
  cleanup.push(() => server.close());
  const origin = `http://127.0.0.1:${server.port}/api`;
  const consent = await fetch(`${origin}/review/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      allow: true,
      providerId: provider.id,
      endpoint: provider.endpoint,
      dataKinds: provider.dataKinds,
      workflow: "graphic-scene",
    }),
  });
  expect(consent.status).toBe(200);

  const previewPromise = fetch(
    `${origin}/compositions/film/graphic-agent/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: before.revision,
        sceneId: "graphic-scene",
        nodeIds: ["rectangle"],
        instruction: "move right 12",
        mode: "provider",
      }),
    },
  );
  await waitForProviderCall(0);

  const changed = graphicScene();
  changed.nodes[0]!.x = 33;
  const editPromise = fetch(`${origin}/compositions/film/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseRevision: before.revision,
      commands: [{ type: "graphic.scene.upsert", scene: changed }],
    }),
  });
  const promptMutation = await Promise.race([
    editPromise,
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), 300),
    ),
  ]);
  expect(
    promptMutation,
    "a held provider must not occupy the mutation queue",
  ).toBeDefined();
  const edit = promptMutation ?? (await editPromise);
  expect(edit.status).toBe(200);
  const editState = (await edit.json()) as { revision: string };
  const state = await fetch(`${origin}/compositions/film/editor`).then(
    (response) => response.json(),
  );
  expect(state.composition.graphicScenes[0].nodes[0].x).toBe(33);

  providerCalls[0]!.resolve("{}");
  const stale = await previewPromise;
  expect(stale.status).toBe(409);

  const timedOutPreview = fetch(
    `${origin}/compositions/film/graphic-agent/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: editState.revision,
        sceneId: "graphic-scene",
        nodeIds: ["rectangle"],
        instruction: "move right 12",
        mode: "provider",
      }),
    },
  );
  await waitForProviderCall(1);
  const timedOut = await timedOutPreview;
  expect(timedOut.status).toBe(503);
  expect((await timedOut.json()).code).toBe("review.providerUnavailable");
  expect(providerCalls[1]?.signal?.aborted).toBe(true);
});
