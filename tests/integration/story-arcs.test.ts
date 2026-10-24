import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { Story, StoryGraph } from "@openfilm/core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { startServer } from "../../apps/server/src/server.js";

it("creates a custom outline through the API, exposes its order in the mind map, and reopens it", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-story-arcs-"));
  const projectPath = join(root, "film.openfilm");
  let closeServer: (() => Promise<void>) | undefined;
  try {
    const sourcePath = join(root, "media");
    await generateSampleMedia(sourcePath);
    const application = await OpenFilmApplication.create(
      projectPath,
      "Authored Outline",
      { projectContentLocale: "zh-TW" },
    );
    try {
      await application.importFiles([
        join(sourcePath, "01-photo.png"),
        join(sourcePath, "03-evening.png"),
        join(sourcePath, "04-motion.mp4"),
      ]);
    } finally {
      application.close();
    }

    const server = await startServer({ port: 0, project: projectPath });
    closeServer = server.close;
    const base = `http://127.0.0.1:${server.port}/api`;
    const send = (path: string, data?: unknown, method = "POST") =>
      fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });

    const headings = ["先打開那封信", "回到旅程的起點", "把答案留在今天"];
    const created = await send("/stories", {
      title: "自己的故事順序",
      template: "custom-outline",
      targetDuration: 30,
      maxDuration: 45,
      customOutline: headings,
    });
    expect(created.status).toBe(201);
    const story = ((await created.json()) as { story: Story }).story;
    expect(story.beats.map((beat) => beat.title)).toEqual(headings);
    expect(story.beats.map((beat) => beat.titleSource)).toEqual([
      "user",
      "user",
      "user",
    ]);

    const graphResponse = await send(
      `/stories/${encodeURIComponent(story.id)}/graph`,
      undefined,
      "GET",
    );
    expect(graphResponse.status).toBe(200);
    const graph = ((await graphResponse.json()) as { graph: StoryGraph }).graph;
    const orderedBeatEdges = graph.edges
      .filter((edge) => edge.type === "precedes")
      .map((edge) => [edge.from, edge.to]);
    expect(orderedBeatEdges).toEqual([
      [`beat-node-${story.beats[0]!.id}`, `beat-node-${story.beats[1]!.id}`],
      [`beat-node-${story.beats[1]!.id}`, `beat-node-${story.beats[2]!.id}`],
    ]);

    const invalidOutline = await send("/stories", {
      title: "Invalid outline",
      template: "journey",
      targetDuration: 30,
      maxDuration: 45,
      customOutline: ["unrecognized override"],
    });
    expect(invalidOutline.status).toBe(400);

    expect((await send("/project/close", {})).status).toBe(200);
    expect((await send("/project/open", { path: projectPath })).status).toBe(
      200,
    );
    const reopened = (await (
      await send("/project", undefined, "GET")
    ).json()) as {
      project: { stories: Story[] };
    };
    expect(
      reopened.project.stories
        .find((item) => item.id === story.id)!
        .beats.map((beat) => beat.title),
    ).toEqual(headings);
  } finally {
    await closeServer?.();
    await rm(root, { recursive: true, force: true });
  }
});
