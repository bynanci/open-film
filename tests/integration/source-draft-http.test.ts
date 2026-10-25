import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-source-draft-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = await startServer({ port: 0 });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}/api`;
  const created = await fetch(`${base}/project/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: join(root, "film.openfilm"),
      title: "Source draft",
    }),
  });
  expect(created.status).toBe(200);
  const project = (await created.json()).project as { id: string };
  const mutate = (path: string, method: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { base, project, root, mutate };
}

describe("source draft HTTP boundary", () => {
  it("accumulates sources, fences stale revisions and never starts legacy import", async () => {
    const h = await fixture();
    expect(await (await fetch(`${h.base}/import-draft`)).json()).toEqual({
      draft: {
        schemaVersion: 1,
        projectId: h.project.id,
        revision: 0,
        selections: [],
      },
    });
    const add = async (
      baseRevision: number,
      requestId: string,
      paths: string[],
    ) =>
      h.mutate("/import-draft/sources", "POST", {
        projectId: h.project.id,
        baseRevision,
        requestId,
        sources: paths.map((path) => ({
          kind: "file",
          displayName: path.split("/").at(-1),
          accessClass: "native-path",
          accessRef: path,
          recursive: false,
        })),
      });
    const firstResponse = await add(0, "http-add-1", [
      "/a.mp4",
      "/b.mp4",
      "/c.mp4",
    ]);
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()).draft;
    expect(first).toMatchObject({ revision: 1 });
    expect(first.selections).toHaveLength(3);

    const secondResponse = await add(1, "http-add-2", ["/d.mp4", "/e.mp4"]);
    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()).draft.selections).toHaveLength(5);
    const stale = await add(1, "http-stale", ["/late.mp4"]);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "import.draftStale" });
    expect((await (await fetch(`${h.base}/jobs`)).json()).jobs).toEqual([]);
  });

  it("updates and removes only the selected relationship and rejects a foreign project", async () => {
    const h = await fixture();
    const addedResponse = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "http-folder-add",
      sources: [
        {
          kind: "folder",
          displayName: "京都",
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:kyoto",
          recursive: true,
        },
      ],
    });
    const added = (await addedResponse.json()).draft;
    const sourceId = added.selections[0].id as string;
    const updatedResponse = await h.mutate(
      `/import-draft/sources/${encodeURIComponent(sourceId)}`,
      "PATCH",
      {
        projectId: h.project.id,
        baseRevision: 1,
        requestId: "http-folder-update",
        recursive: false,
      },
    );
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json()).draft.selections[0]).toMatchObject({
      id: sourceId,
      recursive: false,
    });

    const foreign = await h.mutate("/import-draft/sources", "POST", {
      projectId: "foreign-project",
      baseRevision: 2,
      requestId: "http-foreign",
      sources: [
        {
          kind: "file",
          displayName: "foreign.mp4",
          accessClass: "native-path",
          accessRef: "/foreign.mp4",
        },
      ],
    });
    expect(foreign.status).toBe(403);

    const removed = await h.mutate(
      `/import-draft/sources/${encodeURIComponent(sourceId)}`,
      "DELETE",
      {
        projectId: h.project.id,
        baseRevision: 2,
        requestId: "http-folder-remove",
      },
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).draft).toMatchObject({
      revision: 3,
      selections: [],
    });
  });
});
