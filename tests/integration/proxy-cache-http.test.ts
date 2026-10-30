import { createHash } from "node:crypto";
import {
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import type { Job, ProxyCacheHealth } from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess, type createProxy } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture(options: { proxyGenerator?: typeof createProxy } = {}) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-proxy-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=12",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  const sourceHash = await hashFile(source);
  const project = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(project, "Synthetic proxy HTTP");
  const projectId = app.project.id;
  app.catalog.upsertAsset({
    id: "video",
    name: "合成影片",
    uri: pathToFileURL(source).href,
    mediaType: "video",
    contentHash: sourceHash,
    duration: 2,
    dimensions: { width: 320, height: 180 },
    frameRate: 12,
    codec: "h264",
    tags: [],
    state: {},
    metadata: {},
  });
  app.close();
  const server = await startServer({ port: 0, ...options });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}/api`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post("/project/open", { path: project })).ok).toBe(true);
  const health = async () => {
    const response = await fetch(`${base}/proxy-cache?projectId=${projectId}`);
    expect(response.ok).toBe(true);
    return (await response.json()) as {
      health: ProxyCacheHealth;
      worker?: { status: string; error?: { code: string } };
    };
  };
  return { root, project, projectId, source, sourceHash, base, post, health };
}

it.each(["direct", "normalized-alias", "symlink-alias", "hardlink-alias"])(
  "shares queued preparation and safely rejects same-size corruption through %s paths",
  async (mode) => {
    const f = await fixture();
    const queued = await f.post("/proxy-cache/queue", {
      projectId: f.projectId,
      requestId: "http-prepare",
      assetIds: ["video"],
    });
    expect(queued.status).toBe(202);
    expect(
      (await f.post("/proxy-cache/run", { projectId: f.projectId })).status,
    ).toBe(202);
    await expect
      .poll(async () => (await f.health()).health.entries[0]?.status, {
        timeout: 15_000,
      })
      .toBe("ready");
    const jobs = (await (await fetch(`${f.base}/jobs`)).json()).jobs as Job[];
    const job = jobs.find((job) => job.type === "proxy")!;
    const media = await fetch(`${f.base}/source/video`);
    expect(media.status).toBe(200);
    expect(media.headers.get("x-openfilm-preview")).toBe("managed");
    expect(
      createHash("sha256")
        .update(Buffer.from(await media.arrayBuffer()))
        .digest("hex"),
    ).toBe(job.proxyCache!.output!.hash);
    const path = join(f.project, job.proxyCache!.output!.uri);
    const original = await readFile(path);
    await writeFile(path, Buffer.alloc(original.length));
    if (mode !== "direct") {
      const aliasUri =
        mode === "normalized-alias"
          ? job.proxyCache!.output!.uri.replace(
              "cache/proxies/managed/",
              "cache/proxies/../proxies/managed/",
            )
          : "cache/proxies/legacy-alias.mp4";
      if (mode === "symlink-alias")
        await symlink(path, join(f.project, aliasUri));
      if (mode === "hardlink-alias")
        await link(path, join(f.project, aliasUri));
      const writer = await OpenFilmApplication.openForExport(f.project);
      try {
        writer.catalog.upsertAsset({
          ...writer.catalog.getAsset("video")!,
          proxyUri: aliasUri,
        });
      } finally {
        writer.close();
      }
    }
    const fallback = await fetch(`${f.base}/source/video`);
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("x-openfilm-preview")).toBe("original");
    expect(
      createHash("sha256")
        .update(Buffer.from(await fallback.arrayBuffer()))
        .digest("hex"),
    ).toBe(f.sourceHash);
    expect((await f.health()).health.entries[0]?.status).toBe("stale");
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  },
);

it("keeps cancellation outside the mutation queue and waits for owned work to settle", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = await fixture({
    proxyGenerator: async (_asset, _output, signal) => {
      started();
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });
  expect(
    (
      await f.post("/proxy-cache/queue", {
        projectId: f.projectId,
        requestId: "cancel-http",
        assetIds: ["video"],
      })
    ).status,
  ).toBe(202);
  expect(
    (await f.post("/proxy-cache/run", { projectId: f.projectId })).status,
  ).toBe(202);
  await ready;
  expect((await f.post("/project/close", {})).status).toBe(409);
  const cancel = f.post("/proxy-cache/cancel", { projectId: f.projectId });
  expect(
    await Promise.race([
      cancel.then((response) => response.ok),
      delay(1000).then(() => false),
    ]),
  ).toBe(true);
  await expect
    .poll(async () => (await f.health()).health.entries[0]?.status, {
      timeout: 10_000,
    })
    .toBe("cancelled");
  await expect.poll(async () => (await f.health()).health.running).toBe(false);
  expect(await hashFile(f.source)).toBe(f.sourceHash);
});

it("rejects foreign scope and arbitrary paths without changing the queue", async () => {
  const f = await fixture();
  expect(
    (
      await f.post("/proxy-cache/queue", {
        projectId: "foreign",
        requestId: "foreign",
        assetIds: ["video"],
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await f.post("/proxy-cache/queue", {
        projectId: f.projectId,
        requestId: "unsafe",
        assetIds: ["video"],
        outputPath: f.source,
      })
    ).status,
  ).toBe(400);
  expect((await f.health()).health.queued).toBe(0);
  expect(await hashFile(f.source)).toBe(f.sourceHash);
});
