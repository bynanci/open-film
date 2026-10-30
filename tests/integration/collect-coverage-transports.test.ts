import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  OpenFilmApplication,
  type CollectCoverageReview,
} from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";
let root: string, cli: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-coverage-transport-"));
  cli = join(root, "openfilm.mjs");
  await build({
    entryPoints: [resolve("apps/cli/src/index.ts")],
    outfile: cli,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["koffi"],
  });
});
afterAll(async () => rm(root, { recursive: true, force: true }));
it("shares the same source-clock review through API and passive CLI with no original writes", async () => {
  const path = join(root, "film.openfilm"),
    source = join(root, "synthetic.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=teal:s=160x90:r=12",
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
    path,
    "Synthetic coverage transport",
  );
  const projectId = app.project.id;
  app.catalog.upsertAsset({
    id: "source",
    uri: pathToFileURL(source).href,
    name: "Synthetic.mp4",
    mediaType: "video",
    contentHash: hash,
    codec: "h264",
    duration: 2,
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
          title: "Beat",
          candidateAssetIds: ["source"],
          selectedAssetIds: ["source"],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "source",
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
  app.close();
  const originalProject = await readFile(join(path, "project.json"));
  const server = await startServer({ port: 0, project: path });
  try {
    const body = {
      projectId,
      scope: "current-film",
      compositionId: "film",
      delivery: { version: 1, mode: "trimmed-originals", handlesSeconds: 0.25 },
    };
    const post = (data: unknown) =>
      fetch(`http://127.0.0.1:${server.port}/api/collect/coverage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    const response = await post(body);
    expect(response.status).toBe(200);
    const api = (await response.json()).review as CollectCoverageReview;
    const result = await runProcess(process.execPath, [
      cli,
      "collect",
      "coverage",
      "--project",
      path,
      "--scope",
      "current-film",
      "--composition",
      "film",
      "--delivery-mode",
      "trimmed-originals",
      "--handles",
      "0.25",
    ]);
    const parsed = JSON.parse(
      result.stdout.toString(),
    ) as CollectCoverageReview;
    expect(parsed.coverage).toEqual(api.coverage);
    expect(parsed.coverage.executable).toBe(false);
    expect(result.stdout.toString()).not.toContain(source);
    await expect(
      runProcess(process.execPath, [
        cli,
        "collect",
        "create",
        "--project",
        path,
        "--scope",
        "current-film",
        "--composition",
        "film",
        "--delivery-mode",
        "trimmed-originals",
      ]),
    ).rejects.toThrow(/read-only collect coverage/i);
    expect(api.coverage.entries[0]).toMatchObject({
      action: "trim-candidate",
      ranges: [{ start: 0.25, end: 1.75 }],
    });
    expect((await post({ ...body, projectId: "foreign" })).status).toBe(409);
    expect(
      (await post({ ...body, delivery: { ...body.delivery, version: 2 } }))
        .status,
    ).toBe(400);
    expect((await post({ ...body, destination: source })).status).toBe(400);
    expect(await readFile(join(path, "project.json"))).toEqual(originalProject);
    expect(await hashFile(source)).toBe(hash);
  } finally {
    await server.close();
  }
});
