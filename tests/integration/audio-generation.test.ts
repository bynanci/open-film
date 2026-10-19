import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { TimelineEditor } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
import { createAudioQualityFixture } from "../fixtures/audio-quality.js";
it("serves explicit generation receipt/media and rejects foreign projects and unaccepted imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-generation-http-"));
  const { app } = await createAudioQualityFixture(root);
  const revision = new TimelineEditor(app).get("film").revision;
  const projectId = app.project.id;
  app.close();
  const server = await startServer({
    port: 0,
    project: join(root, "film.openfilm"),
  });
  const api = `http://127.0.0.1:${server.port}/api`;
  const post = (path: string, data: unknown) =>
    fetch(`${api}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  try {
    const providers = await (
      await fetch(`${api}/audio-generation/providers`)
    ).json();
    expect(
      providers.some((p: { id: string }) => p.id === "local-audio-mock"),
    ).toBe(true);
    const response = await post("/compositions/film/audio-generation", {
      baseRevision: revision,
      providerId: "local-audio-mock",
      text: "合成語音流程測試",
      consent: true,
      acknowledgeUnknownCost: false,
    });
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(JSON.stringify(receipt)).not.toContain("合成語音流程測試");
    expect(
      (
        await post(`/audio-generation/${receipt.id}/import`, {
          projectId,
          timelineStart: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(
          `${api}/audio-generation/${receipt.id}/media?projectId=foreign`,
        )
      ).status,
    ).toBe(409);
    const media = await fetch(
      `${api}/audio-generation/${receipt.id}/media?projectId=${projectId}`,
      { headers: { range: "bytes=0-43" } },
    );
    expect(media.status).toBe(206);
    expect((await media.arrayBuffer()).byteLength).toBe(44);
    expect(
      (await post(`/audio-generation/${receipt.id}/accept`, { projectId }))
        .status,
    ).toBe(200);
    const imported = await post(`/audio-generation/${receipt.id}/import`, {
      projectId,
      timelineStart: 0,
    });
    expect(imported.status).toBe(200);
    const result = await imported.json();
    expect(result.command.generationId).toBe(receipt.id);
    expect(
      (
        await post("/compositions/film/edit", {
          baseRevision: result.baseRevision,
          requestId: "generation-http",
          commands: [result.command],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(
          `${api}/audio-generation/${receipt.id}/media?projectId=${projectId}`,
        )
      ).status,
    ).toBe(409);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
