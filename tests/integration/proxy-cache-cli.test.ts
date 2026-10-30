import { build } from "esbuild";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import type {
  Job,
  ProxyCacheHealth,
  ProxyCleanupPreview,
} from "@openfilm/core";

let root: string;
let cliPath: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-proxy-cli-"));
  cliPath = join(root, "openfilm.mjs");
  await build({
    entryPoints: [resolve("apps/cli/src/index.ts")],
    outfile: cliPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["koffi"],
  });
});
afterAll(async () => rm(root, { recursive: true, force: true }));

it("reopens the same durable queue in CLI processes and explicitly accepts the unchanged cleanup review", async () => {
  const source = join(root, "synthetic.mp4");
  const project = join(root, "film.openfilm");
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
    project,
    "CLI synthetic previews",
  );
  app.catalog.upsertAsset({
    id: "clip",
    name: "合成影片",
    uri: pathToFileURL(source).href,
    mediaType: "video",
    codec: "h264",
    contentHash: hash,
    duration: 2,
    dimensions: { width: 160, height: 90 },
    tags: [],
    state: {},
    metadata: {},
  });
  app.close();
  const projectBytes = await readFile(join(project, "project.json"));
  const cli = async <T>(...args: string[]): Promise<T> => {
    const result = await runProcess(process.execPath, [
      cliPath,
      "proxy",
      ...args,
      "--project",
      project,
    ]);
    expect(result.stdout.toString()).not.toContain(source);
    return JSON.parse(result.stdout.toString()) as T;
  };
  const queued = await cli<{ jobs: Job[] }>(
    "enqueue",
    "--assets",
    "clip",
    "--request-id",
    "cli-prepare",
  );
  expect(queued.jobs.map((job) => job.status)).toEqual(["queued"]);
  expect(
    (await cli<{ health: ProxyCacheHealth }>("status")).health.queued,
  ).toBe(1);
  expect(await cli("run")).toMatchObject({
    completed: 1,
    failed: 0,
    cancelled: 0,
  });
  expect(
    (await cli<{ health: ProxyCacheHealth }>("status")).health.entries[0]
      ?.status,
  ).toBe("ready");
  expect(await cli("verify", "--assets", "clip")).toMatchObject({
    results: [
      { assetId: "clip", status: "verified", sourceStatus: "verified" },
    ],
  });
  const preview = await cli<ProxyCleanupPreview>("cleanup-preview");
  expect(preview.entries).toHaveLength(1);
  const previewFile = join(root, "review.json");
  await writeFile(previewFile, JSON.stringify(preview));
  await expect(
    cli("cleanup-accept", "--preview-file", previewFile),
  ).rejects.toThrow();
  expect(
    (
      await cli<{ removedArtifactIds: string[] }>(
        "cleanup-accept",
        "--preview-file",
        previewFile,
        "--confirm",
      )
    ).removedArtifactIds,
  ).toEqual(preview.entries.map((entry) => entry.artifactId));
  expect(
    (await cli<{ health: ProxyCacheHealth }>("status")).health.entries[0]
      ?.status,
  ).toBe("missing");
  expect(await readFile(join(project, "project.json"))).toEqual(projectBytes);
  expect(await hashFile(source)).toBe(hash);
});
