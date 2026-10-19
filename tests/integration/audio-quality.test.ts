import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { TimelineEditor } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
import { createAudioQualityFixture } from "../fixtures/audio-quality.js";
it("shares MP4 audio review through HTTP and rejects foreign/stale A/B playback", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-http-"));
  const { app } = await createAudioQualityFixture(root);
  const before = new TimelineEditor(app).get("film");
  const projectId = app.project.id;
  app.close();
  const server = await startServer({
    port: 0,
    project: join(root, "film.openfilm"),
  });
  const api = `http://127.0.0.1:${server.port}/api`;
  try {
    const response = await fetch(`${api}/compositions/film/audio-quality`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clipId: "sound", baseRevision: before.revision }),
    });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      id: string;
      canAccept: boolean;
    };
    expect(report.canAccept).toBe(true);
    const media = `${api}/audio-quality/${report.id}/candidate`;
    expect((await fetch(`${media}?projectId=foreign`)).status).toBe(409);
    const streamed = await fetch(`${media}?projectId=${projectId}`, {
      headers: { range: "bytes=0-63" },
    });
    expect(streamed.status).toBe(206);
    expect((await streamed.arrayBuffer()).byteLength).toBe(64);
    expect(
      (
        await fetch(`${api}/compositions/film/edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseRevision: before.revision,
            commands: [{ type: "volume", clipId: "sound", volume: 0.5 }],
          }),
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${media}?projectId=${projectId}`)).status).toBe(409);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
