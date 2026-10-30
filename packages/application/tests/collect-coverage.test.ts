import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { hashFile, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
const stops: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-collect-coverage-"));
  stops.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "synthetic.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=160x90:r=12",
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
  const hash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic source coverage",
  );
  stops.push(() => app.close());
  app.catalog.upsertAsset({
    id: "video",
    name: "合成影片",
    uri: pathToFileURL(source).href,
    mediaType: "video",
    codec: "h264",
    contentHash: hash,
    duration: 2,
    frameRate: 12,
    dimensions: { width: 160, height: 90 },
    tags: [],
    state: {},
    metadata: {},
  });
  app.project.stories = [
    {
      id: "story",
      title: "Synthetic",
      beats: [
        {
          id: "beat",
          title: "Synthetic beat",
          candidateAssetIds: ["video"],
          selectedAssetIds: ["video"],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "composition",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "video",
              beatId: "beat",
              sourceIn: 0.5,
              sourceOut: 1.5,
              timelineStart: 0,
              timelineDuration: 1,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  const base = {
    scope: "current-film" as const,
    compositionId: "composition",
    rightsDeclarations: [
      {
        resourceId: "asset:video",
        basis: "owned" as const,
        confirmed: true as const,
      },
    ],
  };
  const input = {
    ...base,
    projectId: app.project.id,
    delivery: {
      version: 1 as const,
      mode: "trimmed-originals" as const,
      handlesSeconds: 0.25,
    },
  };
  return { app, source, hash, base, input };
}
it("binds coverage to the existing saved Collect plan and original hashes without changing the project or catalog", async () => {
  const f = await fixture();
  const baseline = await f.app.collectMedia.plan(f.base);
  const project = await readFile(join(f.app.directory, "project.json"));
  const revision = f.app.catalog.logicalRevision();
  const asset = f.app.catalog.getAsset("video");
  const review = await f.app.collectMedia.coverage({
    ...f.input,
    expectedRevision: baseline.revision,
  });
  expect(review.baseline.id).toBe(baseline.id);
  expect(review.coverage.baselinePlanId).toBe(baseline.id);
  expect(review.coverage).toMatchObject({
    projectId: f.app.project.id,
    revision: baseline.revision,
    executable: false,
  });
  expect(review.coverage.entries[0]).toMatchObject({
    sourceHash: f.hash,
    action: "trim-candidate",
    ranges: [{ start: 0.25, end: 1.75 }],
    retainedSeconds: 1.5,
    removedSeconds: 0.5,
  });
  expect(await readFile(join(f.app.directory, "project.json"))).toEqual(
    project,
  );
  expect(f.app.catalog.logicalRevision()).toBe(revision);
  expect(f.app.catalog.getAsset("video")).toEqual(asset);
  expect(await hashFile(f.source)).toBe(f.hash);
});
it("preserves immutable transcript clocks as full originals until conversion exists", async () => {
  const f = await fixture();
  const document = {
    id: "transcript",
    assetId: "video",
    language: "zh-TW",
    provenance: {
      providerId: "synthetic",
      version: "1",
      sourceHash: f.hash,
      createdAt: "2026-10-30T00:00:00.000Z",
    },
    segments: [{ id: "line", start: 0.5, end: 1.5, text: "合成字幕" }],
  };
  f.app.catalog.intelligence.replaceTranscript(document);
  const revision = f.app.catalog.logicalRevision();
  const review = await f.app.collectMedia.coverage(f.input);
  expect(review.coverage.entries[0]).toMatchObject({
    action: "copy-original",
    reasons: ["source.evidence-bound"],
    ranges: [{ start: 0, end: 2 }],
  });
  expect(
    f.app.catalog.intelligence.getFullTranscript("video", f.hash)?.segments,
  ).toEqual(document.segments);
  expect(f.app.catalog.logicalRevision()).toBe(revision);
});
it("rejects foreign and stale requests and unsafe delivery options", async () => {
  const f = await fixture();
  await expect(
    f.app.collectMedia.coverage({ ...f.input, projectId: "another" }),
  ).rejects.toMatchObject({ code: "story.planStale" });
  await expect(
    f.app.collectMedia.coverage({
      ...f.input,
      expectedRevision: "f".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "story.planStale" });
  await expect(
    f.app.collectMedia.coverage({
      ...f.input,
      delivery: { ...f.input.delivery, outputPath: f.source } as never,
    }),
  ).rejects.toMatchObject({ code: "request.invalid" });
  expect(await hashFile(f.source)).toBe(f.hash);
});
it("does not describe changed source bytes as an eligible trimmed derivative", async () => {
  const f = await fixture();
  await appendFile(f.source, "synthetic changed source");
  const review = await f.app.collectMedia.coverage(f.input);
  expect(review.baseline.complete).toBe(false);
  expect(review.baseline.items[0]!.issues).toContain("source.hash-mismatch");
  expect(review.coverage.entries[0]).toMatchObject({
    action: "copy-original",
    reasons: ["source.identity-missing"],
  });
  expect(review.coverage.entries[0]!.sourceHash).toBeUndefined();
});
it("honors cancelled review without creating output or operational jobs", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    f.app.collectMedia.coverage(f.input, controller.signal),
  ).rejects.toMatchObject({ code: "export.failed" });
  expect(f.app.catalog.listJobs()).toEqual([]);
  expect(await hashFile(f.source)).toBe(f.hash);
});
it("retains originals for opaque graph metadata rather than inventing a source-clock conversion", async () => {
  const f = await fixture();
  f.app.project.stories[0]!.graph = {
    version: 1,
    nodes: [
      { id: "source-node", type: "asset", assetId: "video" },
      {
        id: "idea",
        type: "idea",
        text: "Synthetic source annotation",
        source: "planned",
        assetReferences: ["video"],
      },
    ],
    edges: [
      {
        id: "link",
        type: "supports",
        from: "source-node",
        to: "idea",
        metadata: { sourceRange: { start: 0.5, end: 1.5 } },
      },
    ],
  };
  await f.app.save();
  const review = await f.app.collectMedia.coverage(f.input);
  expect(review.coverage.entries[0]).toMatchObject({
    action: "copy-original",
    reasons: ["source.opaque-reference"],
  });
});
