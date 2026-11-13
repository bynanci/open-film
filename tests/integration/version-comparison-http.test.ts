// Modified by OpenFilm contributors on 2026-11-13. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess, hashFile } from "@openfilm/media";
import type { MediaAsset } from "@openfilm/core";
import { startServer } from "../../apps/server/src/server.js";
import { toneSource } from "../fixtures/audio-policy.js";

const clean: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of clean.splice(0).reverse()) await action();
});

async function imageSource(root: string, id: string, color: string) {
  const path = join(root, `${id}.png`);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=${color}:s=160x90`,
    "-frames:v",
    "1",
    "-threads",
    "1",
    path,
  ]);
  return {
    id,
    name: id,
    uri: pathToFileURL(path).href,
    mediaType: "image",
    tags: [],
    state: { locked: true },
    metadata: {},
    contentHash: await hashFile(path),
  } satisfies MediaAsset;
}

it("serves only private, verified historical MP4 ranges and drains the owned pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-version-pair-http-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm"),
    app = await OpenFilmApplication.create(directory, "Versions over HTTP"),
    red = await imageSource(root, "red", "red"),
    blue = await imageSource(root, "blue", "blue"),
    toneA = await toneSource(root, "tone-a", 440, 1),
    toneB = await toneSource(root, "tone-b", 880, 1);
  for (const asset of [red, blue, toneA, toneB]) app.catalog.upsertAsset(asset);
  app.project.stories = [{ id: "story", title: "Saved story", beats: [] }];
  app.project.settings = { width: 160, height: 90, frameRate: 10 };
  app.project.timelines = [
    {
      id: "cut",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "picture",
              assetId: red.id,
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
        {
          id: "sound",
          type: "audio",
          clips: [
            {
              id: "sound",
              assetId: toneA.id,
              timelineStart: 0,
              timelineDuration: 1,
              sourceIn: 0,
              sourceOut: 1,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  const versionA = await app.versions.create({
    name: "A",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  app.project.timelines[0]!.tracks[0]!.clips[0]!.assetId = blue.id;
  app.project.timelines[0]!.tracks[1]!.clips[0]!.assetId = toneB.id;
  app.project.settings = { width: 192, height: 108, frameRate: 12 };
  await app.save();
  const versionB = await app.versions.create({
    name: "B",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  app.close();

  const runtime = await startServer({ port: 0, project: directory });
  clean.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}`,
    query = new URLSearchParams({ projectId: app.project.id }),
    requestId = randomUUID(),
    input = {
      projectId: app.project.id,
      requestId,
      a: { versionId: versionA.id, compositionId: "cut" },
      b: { versionId: versionB.id, compositionId: "cut" },
    },
    post = (route: string, value: unknown) =>
      fetch(`${base}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });

  const targets = await fetch(
    `${base}/api/versions/${versionA.id}/preview-targets?${query}`,
  );
  expect(targets.status).toBe(200);
  expect(await targets.json()).toMatchObject({
    targets: {
      projectId: input.projectId,
      versionId: versionA.id,
      compositions: [{ id: "cut", frameRate: 10 }],
    },
  });
  expect(
    (
      await fetch(
        `${base}/api/versions/${versionA.id}/preview-targets?projectId=${input.projectId}&projectId=${input.projectId}`,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(
        `${base}/api/versions/${versionA.id}/preview-targets?projectId=another-project`,
      )
    ).status,
  ).toBe(409);

  const prepared = await post("/api/version-comparisons/prepare", input);
  expect(prepared.status, await prepared.clone().text()).toBe(200);
  const descriptor = await prepared.json();
  expect(descriptor).toMatchObject({
    version: 1,
    projectId: input.projectId,
    a: { versionId: versionA.id, frameRate: 10, duration: 1, hasAudio: true },
    b: { versionId: versionB.id, frameRate: 12, duration: 1, hasAudio: true },
  });
  expect(JSON.stringify(descriptor)).not.toContain(root);
  expect(descriptor.a).not.toHaveProperty("path");
  expect(descriptor.b).not.toHaveProperty("path");

  const status = await fetch(
    `${base}/api/version-comparisons/${descriptor.id}?${query}`,
  );
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual(descriptor);
  const media = (side: string) =>
    `${base}/api/version-comparisons/${descriptor.id}/media/${side}?${query}`;
  const fullA = await fetch(media("a"));
  expect(fullA.status).toBe(200);
  expect(fullA.headers.get("content-type")).toBe("video/mp4");
  expect(fullA.headers.get("cache-control")).toBe("private, no-store");
  expect(fullA.headers.get("accept-ranges")).toBe("bytes");
  expect(fullA.headers.get("x-content-type-options")).toBe("nosniff");
  const bytesA = Buffer.from(await fullA.arrayBuffer());
  expect(bytesA.length).toBe(descriptor.a.bytes);
  expect(createHash("sha256").update(bytesA).digest("hex")).toBe(
    descriptor.a.sha256,
  );
  const range = await fetch(media("b"), {
    headers: { Range: "bytes=0-63" },
  });
  expect(range.status).toBe(206);
  expect(range.headers.get("content-range")).toBe(
    `bytes 0-63/${descriptor.b.bytes}`,
  );
  expect(Buffer.from(await range.arrayBuffer())).toHaveLength(64);
  const unsatisfiable = await fetch(media("a"), {
    headers: { Range: "bytes=-0" },
  });
  expect(unsatisfiable.status).toBe(416);
  expect(unsatisfiable.headers.get("content-range")).toBe(
    `bytes */${descriptor.a.bytes}`,
  );
  expect((await fetch(media("c"))).status).toBe(404);
  expect(
    (
      await fetch(
        `${base}/api/version-comparisons/${descriptor.id}/media/a?${query}&path=%2Fetc%2Fpasswd`,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(
        `${base}/api/version-comparisons/${descriptor.id}/media/a?projectId=another-project`,
      )
    ).status,
  ).toBe(409);

  expect(
    (
      await post("/api/version-comparisons/prepare", {
        ...input,
        unknown: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post("/api/version-comparisons/prepare", {
        ...input,
        requestId: "not-a-uuid",
      })
    ).status,
  ).toBe(400);

  const foreignRequestId = randomUUID(),
    foreignOwner = await OpenFilmApplication.open(directory);
  try {
    foreignOwner.catalog.saveJob({
      id: foreignRequestId,
      type: "render",
      stage: "version-comparison-preview",
      status: "running",
      progress: 0.5,
      createdAt: new Date().toISOString(),
      reviewOwner: {
        host: "another-process",
        pid: 42,
        token: randomUUID(),
      },
    });
  } finally {
    foreignOwner.close();
  }
  expect(
    (
      await post("/api/version-comparisons/cancel", {
        projectId: input.projectId,
        requestId: foreignRequestId,
      })
    ).status,
  ).toBe(409);
  const jobs = await (await fetch(`${base}/api/jobs`)).json();
  expect(jobs.jobs).toContainEqual(
    expect.objectContaining({
      id: foreignRequestId,
      status: "running",
      stage: "version-comparison-preview",
    }),
  );
  expect(
    (
      await post("/api/version-comparisons/prepare", {
        ...input,
        a: { ...input.a, path: "/etc/passwd" },
      })
    ).status,
  ).toBe(400);

  const removed = await fetch(
    `${base}/api/version-comparisons/${descriptor.id}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: input.projectId }),
    },
  );
  expect(removed.status).toBe(200);
  expect((await fetch(media("a"))).status).toBe(409);
  const cancelRequestId = randomUUID(),
    preparing = post("/api/version-comparisons/prepare", {
      ...input,
      requestId: cancelRequestId,
    });
  await expect
    .poll(
      async () => {
        const state = await (await fetch(`${base}/api/jobs`)).json();
        return state.jobs.find(
          (job: { id: string }) => job.id === cancelRequestId,
        )?.status;
      },
      { timeout: 10_000 },
    )
    .toBe("running");
  const cancellation = await post("/api/version-comparisons/cancel", {
    projectId: input.projectId,
    requestId: cancelRequestId,
  });
  expect(cancellation.status).toBe(200);
  const cancelledPreparation = await preparing;
  expect(
    cancelledPreparation.status,
    await cancelledPreparation.clone().text(),
  ).toBe(409);
  const afterCancel = await (await fetch(`${base}/api/jobs`)).json();
  expect(afterCancel.jobs).toContainEqual(
    expect.objectContaining({ id: cancelRequestId, status: "cancelled" }),
  );
  expect(
    (
      await post("/api/version-comparisons/cancel", {
        projectId: input.projectId,
        requestId,
      })
    ).status,
  ).toBe(200);
});
