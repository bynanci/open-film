import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("shared named-version API and CLI adapters", () => {
  it("uses one application service for HTTP restore, idempotency, and project switching", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-versions-http-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const firstPath = join(root, "first.openfilm");
    const secondPath = join(root, "second.openfilm");
    const first = await OpenFilmApplication.create(
      firstPath,
      "First synthetic project",
    );
    first.close();
    const second = await OpenFilmApplication.create(
      secondPath,
      "Second synthetic project",
    );
    second.close();

    const runtime = await startServer({ port: 0, project: firstPath });
    cleanups.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}/api`;
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
      return { response, body: await response.json() };
    };
    const post = (path: string, body: unknown) =>
      request(path, { method: "POST", body: JSON.stringify(body) });

    const revision = (await request("/versions/revision")).body as {
      revision: string;
    };
    const input = {
      name: "Opening",
      baseRevision: revision.revision,
      requestId: "50000000-0000-4000-8000-000000000001",
    };
    const created = await post("/versions", input);
    expect(created.response.status).toBe(200);
    const firstVersion = created.body.version;
    expect((await post("/versions", input)).body.version.id).toBe(
      firstVersion.id,
    );
    expect(
      (await request(`/versions/${firstVersion.id}`)).response.status,
    ).toBe(200);
    expect(
      (
        await request(
          `/versions/diff?before=${firstVersion.id}&after=${firstVersion.id}`,
        )
      ).body.diff.entries,
    ).toEqual([]);
    expect(
      (
        await post(`/versions/${firstVersion.id}/restore`, {
          baseRevision: revision.revision,
          confirmed: false,
          requestId: "50000000-0000-4000-8000-000000000002",
        })
      ).response.status,
    ).toBe(400);
    const restored = await post(`/versions/${firstVersion.id}/restore`, {
      baseRevision: revision.revision,
      confirmed: true,
      requestId: "50000000-0000-4000-8000-000000000003",
    });
    expect(restored.response.status).toBe(200);
    expect(restored.body).toMatchObject({
      restoredVersionId: firstVersion.id,
      project: { title: "First synthetic project" },
    });
    const restoreRetry = await post(`/versions/${firstVersion.id}/restore`, {
      baseRevision: revision.revision,
      confirmed: true,
      requestId: "50000000-0000-4000-8000-000000000003",
    });
    expect(restoreRetry.body.checkpointVersionId).toBe(
      restored.body.checkpointVersionId,
    );

    expect(
      (
        await post("/versions", {
          ...input,
          requestId: "50000000-0000-4000-8000-000000000004",
          unexpected: true,
        })
      ).response.status,
    ).toBe(400);
    const switched = await post("/project/open", { path: secondPath });
    expect(switched.response.status).toBe(200);
    expect((await request("/versions")).body.versions).toEqual([]);
  });

  it("exposes named-version commands in CLI output without source paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-versions-cli-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "cli.openfilm");
    const app = await OpenFilmApplication.create(
      directory,
      "CLI synthetic project",
    );
    app.close();
    const cli = (...args: string[]) =>
      runProcess(process.execPath, [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "versions",
        ...args,
        "--project",
        directory,
      ]);
    const created = JSON.parse(
      (
        await cli(
          "create",
          "--name",
          "CLI checkpoint",
          "--request-id",
          "60000000-0000-4000-8000-000000000001",
        )
      ).stdout.toString("utf8"),
    ) as { version: { id: string; name: string } };
    expect(created.version.name).toBe("CLI checkpoint");
    expect(
      JSON.parse((await cli("list")).stdout.toString("utf8")).versions,
    ).toHaveLength(1);
    const failedConfirmation = await cli(
      "restore",
      created.version.id,
      "--base-revision",
      JSON.parse((await cli("revision")).stdout.toString("utf8")).revision,
      "--request-id",
      "60000000-0000-4000-8000-000000000002",
    ).then(
      () => "unexpected success",
      (error: Error) => error.message,
    );
    expect(failedConfirmation).toContain("explicit --confirm");
  });
});
