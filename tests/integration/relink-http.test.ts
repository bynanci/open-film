import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function legacyProject(longRender = false) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-relink-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const sources = join(root, "sources");
  await generateSampleMedia(sources);
  const filename = longRender ? "01-photo.png" : "04-motion.mp4";
  const source = join(sources, filename);
  const originalUri = pathToFileURL(source).href;
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(
    directory,
    "A portable legacy film",
  );
  app.project.settings = { width: 640, height: 360, frameRate: 24 };
  app.project.mediaLibraries.push({
    id: "original-library",
    name: "Original memories",
    uri: pathToFileURL(sources).href,
  });
  // Valid pre-reference catalog rows intentionally have no known content hash.
  app.catalog.upsertAsset({
    id: "legacy-asset",
    uri: originalUri,
    name: filename,
    mediaType: longRender ? "image" : "video",
    ...(longRender ? {} : { duration: 3 }),
    tags: ["keep"],
    rating: 5,
    state: { favorite: true },
    metadata: { "openfilm.test.note": "A legacy note" },
  });
  app.project.stories.push({
    id: "story",
    title: "A story",
    beats: [
      { id: "beat", title: "A moment", selectedAssetIds: ["legacy-asset"] },
    ],
  });
  app.project.timelines.push({
    id: "composition",
    storyId: "story",
    duration: longRender ? 300 : 2,
    tracks: [
      {
        id: "visuals",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "legacy-asset",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: longRender ? 300 : 2,
            ...(longRender
              ? {}
              : {
                  sourceIn: 0.5,
                  sourceOut: 2.5,
                  transform: { volume: 0.4 },
                  locked: true,
                }),
          },
        ],
      },
    ],
  });
  const expectedTimeline = structuredClone(app.project.timelines[0]);
  app.close();
  const runtime = await startServer({ port: 0, project: directory });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}`;
  const post = (path: string, data: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  return {
    root,
    source,
    sources,
    originalUri,
    directory,
    base,
    post,
    expectedTimeline,
  };
}

describe("relink HTTP boundary", () => {
  it("requires explicit confirmation for a real legacy source and preserves its identity and edit", async () => {
    const fixture = await legacyProject();
    const originalBytes = await readFile(fixture.source);
    const movedFolder = join(fixture.root, "relocated");
    await mkdir(movedFolder);
    const movedFile = join(movedFolder, "04-motion.mp4");
    await rename(fixture.source, movedFile);
    const statusResponse = await fetch(
      `${fixture.base}/api/media/status?assetIds=legacy-asset`,
    );
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status.assets).toEqual([
      expect.objectContaining({ assetId: "legacy-asset", status: "missing" }),
    ]);
    expect(status.libraries).toEqual([
      expect.objectContaining({ id: "original-library", status: "partial" }),
    ]);
    const plannedResponse = await fixture.post("/api/media/relink/plan", {
      assetIds: ["legacy-asset"],
      file: movedFile,
    });
    expect(plannedResponse.status).toBe(200);
    const plan = await plannedResponse.json();
    expect(plan.matches).toHaveLength(1);
    const candidate = plan.matches[0].candidates[0];
    expect(candidate).toMatchObject({ automatic: false, path: movedFile });
    const selection = { assetId: "legacy-asset", candidateId: candidate.id };
    expect(
      (
        await fixture.post("/api/media/relink/apply", {
          planId: plan.id,
          selections: [selection],
        })
      ).status,
    ).toBe(400);
    const notChanged = await (await fetch(`${fixture.base}/api/assets`)).json();
    expect(notChanged.assets[0].uri).toBe(fixture.originalUri);
    const applied = await fixture.post("/api/media/relink/apply", {
      planId: plan.id,
      selections: [{ ...selection, confirm: true }],
    });
    expect(applied.status).toBe(200);
    const { assets } = await applied.json();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: "legacy-asset",
      uri: pathToFileURL(movedFile).href,
      rating: 5,
      tags: ["keep"],
      state: { favorite: true },
      metadata: {
        "openfilm.test.note": "A legacy note",
        "openfilm.reference": {
          originalUri: fixture.originalUri,
          mediaLibraryId: "original-library",
        },
      },
    });
    const current = await (await fetch(`${fixture.base}/api/project`)).json();
    expect(current.project.timelines[0]).toEqual(fixture.expectedTimeline);
    const disk = JSON.parse(
      await readFile(join(fixture.directory, "project.json"), "utf8"),
    );
    expect(disk.timelines[0]).toEqual(fixture.expectedTimeline);
    expect(await readFile(movedFile)).toEqual(originalBytes);
    const ready = await (
      await fetch(`${fixture.base}/api/media/status?assetIds=legacy-asset`)
    ).json();
    expect(ready.assets[0].status).toBe("available");
    expect(
      (await fetch(`${fixture.base}/api/source/legacy-asset`)).status,
    ).toBe(200);
  });

  it("rejects relink requests while an actual preview render owns the sources", async () => {
    const fixture = await legacyProject(true);
    const rendering = fixture.post("/api/render", {
      compositionId: "composition",
    });
    let jobId = "";
    await expect
      .poll(async () => {
        const { jobs } = await (await fetch(`${fixture.base}/api/jobs`)).json();
        jobId =
          jobs.find(
            (job: { id: string; type: string; status: string }) =>
              job.type === "render" &&
              ["queued", "running"].includes(job.status),
          )?.id ?? "";
        return jobId;
      })
      .not.toBe("");
    let cancellationStatus: number;
    let renderStatus: number;
    try {
      expect(
        (
          await fixture.post("/api/media/relink/plan", {
            assetIds: ["legacy-asset"],
            folder: fixture.sources,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await fixture.post("/api/media/relink/apply", {
            planId: "not-yet-planned",
            selections: [],
          })
        ).status,
      ).toBe(409);
    } finally {
      cancellationStatus = (await fixture.post(`/api/jobs/${jobId}/cancel`, {}))
        .status;
      renderStatus = (await rendering).status;
    }
    expect(cancellationStatus).toBe(200);
    expect(renderStatus).toBe(400);
    expect(
      (
        await fixture.post("/api/media/relink/plan", {
          assetIds: ["legacy-asset"],
          file: fixture.source,
        })
      ).status,
    ).toBe(200);
  });
});
