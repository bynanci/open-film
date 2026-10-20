import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { startServer } from "../../apps/server/src/server.js";
import { createMotionFixture } from "../fixtures/motion-generation.js";
it("shares HTTP motion logic, protects project ownership, accepts/replaces and restores", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-http-"));
  const { app, editor } = await createMotionFixture(root);
  const projectId = app.project.id,
    baseRevision = editor.get("film").revision;
  await app.motionGeneration.dispose();
  app.close();
  const server = await startServer({
    port: 0,
    project: join(root, "film.openfilm"),
  });
  const api = `http://127.0.0.1:${server.port}/api`;
  const post = (path: string, data: unknown) =>
    fetch(api + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  try {
    const input = {
      requestId: randomUUID(),
      projectId,
      baseRevision,
      clipId: "photo",
      providerId: "local-motion-fixture",
      count: 2,
      prompt: "合成雲景",
      negativeConstraints: "保留細節",
      consent: true,
      containsPeople: false,
    };
    expect(
      (
        await post("/compositions/film/motion-generation", {
          ...input,
          containsPeople: undefined,
        })
      ).status,
    ).toBe(400);
    const response = await post("/compositions/film/motion-generation", input);
    expect(response.status).toBe(200);
    const [r] = await response.json();
    expect(JSON.stringify(r)).not.toContain(input.prompt);
    expect(
      (await post(`/motion-generation/${r.id}/import`, { projectId })).status,
    ).toBe(409);
    expect(
      (await fetch(`${api}/motion-generation/${r.id}/media?projectId=foreign`))
        .status,
    ).toBe(409);
    const media = await fetch(
      `${api}/motion-generation/${r.id}/media?projectId=${projectId}`,
      { headers: { range: "bytes=0-43" } },
    );
    expect(media.status).toBe(206);
    expect((await media.arrayBuffer()).byteLength).toBe(44);
    expect(
      (
        await post(`/motion-generation/${r.id}/accept`, {
          projectId,
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    const adopted = await post(`/motion-generation/${r.id}/import`, {
      projectId,
    });
    expect(adopted.status).toBe(200);
    const data = await adopted.json();
    expect(data.receipt.state).toBe("imported");
    expect(
      (await post(`/motion-generation/${r.id}/import`, { projectId })).status,
    ).toBe(200);
    expect(
      (await post(`/motion-generation/${r.id}/restore`, { projectId })).status,
    ).toBe(200);
    expect((await post("/motion-generation/clear", { projectId })).status).toBe(
      200,
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("uses the same CLI workflow across separate preview, review, import and restore processes", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-cli-"));
  const { app } = await createMotionFixture(root);
  await app.motionGeneration.dispose();
  app.close();
  const { runProcess } = await import("@openfilm/media");
  const cli = async (action: string, args: string[] = []) =>
    JSON.parse(
      (
        await runProcess(
          process.execPath,
          [
            "--import",
            "tsx",
            "apps/cli/src/index.ts",
            "motion",
            action,
            "--project",
            join(root, "film.openfilm"),
            ...args,
          ],
          { timeoutMs: 30000 },
        )
      ).stdout.toString(),
    );
  try {
    const result = await cli("preview", [
      "--composition",
      "film",
      "--clip",
      "photo",
      "--request-id",
      randomUUID(),
      "--motion-consent",
      "--environment-only",
      "--motion-prompt",
      "Synthetic landscape",
      "--motion-negative",
      "Keep original detail",
    ]);
    const r = result[0];
    expect(result).toHaveLength(2);
    expect(r.containsPeople).toBe(false);
    expect((await cli("accept", ["--id", r.id, "--reviewed"])).state).toBe(
      "accepted",
    );
    expect((await cli("import", ["--id", r.id])).receipt.state).toBe(
      "imported",
    );
    expect((await cli("restore", ["--id", r.id])).receipt.state).toBe(
      "restored",
    );
    expect(await cli("clear")).toEqual({ cleared: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
