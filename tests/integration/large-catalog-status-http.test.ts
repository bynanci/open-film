import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { referenceFor } from "@openfilm/media";
import type { MediaAsset } from "@openfilm/core";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

it("serves unscoped availability beyond 2000 assets while relink plans stay bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-large-status-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const sources = join(root, "mounted");
  await mkdir(sources);
  await writeFile(join(sources, "source-0.jpg"), "availability only");
  const project = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(project, "Large catalog");
  try {
    app.project.mediaLibraries.push({
      id: "library",
      name: "Mounted",
      uri: pathToFileURL(sources).href,
    });
    for (let index = 0; index < 2001; index++) {
      const asset: MediaAsset = {
        id: `source-${index}`,
        uri: pathToFileURL(join(sources, `source-${index}.jpg`)).href,
        name: `source-${index}.jpg`,
        mediaType: "image",
        tags: [],
        state: {},
        metadata: {},
      };
      asset.metadata["openfilm.reference"] = referenceFor(
        asset,
        app.project.mediaLibraries,
      );
      app.catalog.upsertAsset(asset);
    }
    await app.save();
  } finally {
    app.close();
  }
  const server = await startServer({ port: 0, project });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const response = await fetch(`${base}/api/media/status`);
  expect(response.status).toBe(200);
  const status = await response.json();
  expect(status.assets).toHaveLength(2001);
  expect(status.assets).toContainEqual({
    assetId: "source-0",
    status: "available",
  });
  expect(status.libraries).toEqual([
    {
      id: "library",
      name: "Mounted",
      status: "partial",
      roots: [pathToFileURL(sources).href],
    },
  ]);
  const scoped = await fetch(
    `${base}/api/media/status?assetIds=source-2000,source-0`,
  );
  expect(scoped.status).toBe(200);
  expect((await scoped.json()).assets).toEqual([
    expect.objectContaining({ assetId: "source-2000", status: "missing" }),
    { assetId: "source-0", status: "available" },
  ]);
  const plan = await fetch(`${base}/api/media/relink/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: sources }),
  });
  expect(plan.status).toBe(400);
  expect(await plan.json()).toMatchObject({
    error: expect.stringContaining("2000"),
  });
});
