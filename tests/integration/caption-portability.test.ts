import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import type { Job, MediaAsset } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it("CLI captions use moved managed uploads without persisting source paths or recovering another owner's jobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-caption-portability-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const original = join(root, "Original # & 音声.wav");
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000:duration=3",
    "-c:a",
    "pcm_s16le",
    original,
  ]);
  const sourceBytes = await readFile(original);
  const runtime = { userDataDirectory: join(root, "preferences") };
  const server = await startServer({ port: 0, projectRoot: root, ...runtime });
  let closed: Promise<void> | undefined;
  const closeServer = () => (closed ??= server.close());
  cleanup.push(closeServer);
  const base = `http://127.0.0.1:${server.port}/api`;
  const post = (route: string, body: unknown) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const created = await post("/project/create", { title: "Portable captions" });
  expect(created.status).toBe(200);
  const { path: directory } = (await created.json()) as { path: string };
  const fileName = "Managed # & 音声.wav";
  const uploaded = await fetch(
    `${base}/import/upload?${new URLSearchParams({ name: fileName })}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(sourceBytes),
    },
  );
  expect(uploaded.status).toBe(201);
  const { uploadId } = (await uploaded.json()) as { uploadId: string };
  const imported = await post("/import", { uploads: [uploadId] });
  expect(imported.status).toBe(202);
  const { jobId } = (await imported.json()) as { jobId: string };
  await expect
    .poll(
      async () => {
        const { jobs } = (await (await fetch(`${base}/jobs`)).json()) as {
          jobs: Job[];
        };
        return jobs.find((job) => job.id === jobId)?.status;
      },
      { timeout: 20_000 },
    )
    .toBe("completed");
  await closeServer();

  let app: OpenFilmApplication | undefined = await OpenFilmApplication.open(
    directory,
    runtime,
  );
  cleanup.push(() => app?.close());
  const asset = app.catalog.listAssets()[0]!;
  const managed = asset.metadata["openfilm.managedSource"] as {
    uri: string;
    relativePath: string;
  };
  expect(managed.relativePath).toBe(`sources/${uploadId}/${fileName}`);
  expect(asset.uri).toBe(managed.uri);
  expect(asset.contentHash).toEqual(expect.any(String));
  app.catalog.intelligence.replaceTranscript({
    id: "portable-transcript",
    assetId: asset.id,
    language: "en",
    provenance: {
      providerId: "fixture",
      sourceHash: asset.contentHash!,
      version: "1",
      createdAt: "2026-10-08T00:00:00Z",
    },
    segments: [
      { id: "spoken", start: 0.2, end: 1.2, text: "A portable caption" },
    ],
  });
  app.project.stories = [{ id: "story", title: "Portable", beats: [] }];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 3,
      tracks: [
        {
          id: "voice",
          type: "audio",
          clips: [
            {
              id: "clip",
              assetId: asset.id,
              sourceIn: 0,
              sourceOut: 3,
              timelineStart: 0,
              timelineDuration: 3,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  const projectId = app.project.id;
  const oldSnapshot = await app.captions.prepare({
    projectId,
    compositionId: "film",
    trackId: "voice",
    baseRevision: new TimelineEditor(app).get("film").revision,
  });
  const activeJobs: Job[] = [
    {
      id: "another-owner-running",
      type: "transcribe",
      status: "running",
      progress: 0.4,
      createdAt: "2026-10-08T00:00:00Z",
      errors: [],
    },
    {
      id: "another-owner-queued",
      type: "import",
      status: "queued",
      progress: 0,
      createdAt: "2026-10-08T00:00:01Z",
      errors: [],
    },
  ];
  for (const job of activeJobs) app.catalog.saveJob(job);
  const jobsBefore = app.catalog.listJobs();
  app.close();
  app = undefined;
  const projectBytes = await readFile(join(directory, "project.json"));
  const catalogBytes = await readFile(join(directory, "database.sqlite"));
  const moved = join(root, "Moved # & 映画.openfilm");
  await rename(directory, moved);
  const movedSource = join(moved, managed.relativePath);
  const unchanged = async () => {
    expect(await readFile(join(moved, "project.json"))).toEqual(projectBytes);
    expect(await readFile(join(moved, "database.sqlite"))).toEqual(
      catalogBytes,
    );
    expect(await readFile(original)).toEqual(sourceBytes);
    expect(await readFile(movedSource)).toEqual(sourceBytes);
  };
  const cli = async (...args: string[]) => {
    const result = await runProcess(process.execPath, [
      "--import",
      "tsx",
      resolve("apps/cli/src/index.ts"),
      "captions",
      ...args,
      "--project",
      moved,
      "--user-data-dir",
      runtime.userDataDirectory,
    ]);
    await unchanged();
    return JSON.parse(result.stdout.toString("utf8"));
  };
  const prepared = await cli(
    "prepare",
    "--composition",
    "film",
    "--track",
    "voice",
  );
  expect(prepared).toMatchObject({
    exportable: true,
    stale: false,
    cueCount: 1,
  });
  expect(prepared.cues[0]).toMatchObject({ text: "A portable caption" });
  expect(prepared.sources[0]).toMatchObject({
    assetId: asset.id,
    sourceHash: asset.contentHash,
    available: true,
  });
  const restored = await cli("get", oldSnapshot.id);
  expect(restored).toMatchObject({ exportable: true, stale: false });
  expect(restored.cues).toEqual(oldSnapshot.cues);
  const published = await cli("export", oldSnapshot.id, "--format", "srt");
  expect(await readFile(join(moved, published.relativePath), "utf8")).toContain(
    "00:00:00,200 --> 00:00:01,200\nA portable caption",
  );
  const currentPublication = await cli(
    "export",
    prepared.id,
    "--format",
    "vtt",
  );
  expect(
    await readFile(join(moved, currentPublication.relativePath), "utf8"),
  ).toContain("WEBVTT");
  app = await OpenFilmApplication.openForExport(moved, runtime);
  expect(app.catalog.getAsset(asset.id)).toEqual(asset);
  expect(app.getSourceAsset(asset.id)).toEqual({
    ...asset,
    uri: pathToFileURL(movedSource).href,
  });
  expect(app.catalog.listJobs()).toEqual(jobsBefore);
  expect(
    await app.captions.readPublication(published.id, { projectId }),
  ).toEqual(published);
  app.close();
  app = undefined;
  await unchanged();
});

it("passive source resolution retains path containment and explicit external relinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-caption-managed-paths-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "original.openfilm");
  const runtime = { userDataDirectory: join(root, "preferences") };
  let app: OpenFilmApplication | undefined = await OpenFilmApplication.create(
    directory,
    "Managed source paths",
    {},
    runtime,
  );
  cleanup.push(() => app?.close());
  const externalUri = pathToFileURL(join(root, "external.wav")).href;
  const markers = [
    ["managed", "sources/upload/managed.wav"],
    ["escaped", "sources/../../outside.wav"],
    ["root", "sources/."],
    ["backslash", "sources/upload\\voice.wav"],
    ["relinked", "sources/upload/relinked.wav"],
  ] as const;
  const assets: MediaAsset[] = markers.map(([id, relativePath]) => {
    const originalUri = pathToFileURL(
      join(directory, "sources/upload", `${id}.wav`),
    ).href;
    return {
      id,
      uri: id === "relinked" ? externalUri : originalUri,
      name: `${id}.wav`,
      mediaType: "audio",
      duration: 3,
      tags: [],
      state: {},
      metadata: {
        "openfilm.managedSource": { relativePath, uri: originalUri },
      },
    };
  });
  for (const asset of assets) app.catalog.upsertAsset(asset);
  app.close();
  app = undefined;
  const projectBytes = await readFile(join(directory, "project.json"));
  const catalogBytes = await readFile(join(directory, "database.sqlite"));
  const moved = join(root, "moved.openfilm");
  await rename(directory, moved);
  app = await OpenFilmApplication.openForExport(moved, runtime);
  for (const asset of assets) {
    expect(app.catalog.getAsset(asset.id)).toEqual(asset);
    expect(app.getSourceAsset(asset.id)).toEqual(
      asset.id === "managed"
        ? {
            ...asset,
            uri: pathToFileURL(join(moved, "sources/upload/managed.wav")).href,
          }
        : asset,
    );
  }
  expect(app.getSourceAsset("absent")).toBeUndefined();
  app.close();
  app = undefined;
  expect(await readFile(join(moved, "project.json"))).toEqual(projectBytes);
  expect(await readFile(join(moved, "database.sqlite"))).toEqual(catalogBytes);
});
