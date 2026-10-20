// Modified by OpenFilm contributors on 2026-10-20. See LICENSE/NOTICE.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { Job } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";

const execute = promisify(execFile);
const cleanup: Array<() => Promise<unknown>> = [];
const unrelatedJob: Job = {
  id: "another-process-render",
  type: "render",
  status: "running",
  progress: 0.35,
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:01.000Z",
};

afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-cli-passive-export-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "合成影片 # &.openfilm");
  const userDataDirectory = join(root, "user-data");
  const image = join(root, "synthetic-photo.png");
  const audio = join(root, "synthetic-narration.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=12",
    "-frames:v",
    "1",
    "-threads",
    "1",
    image,
  ]);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=0.25",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    "-threads",
    "1",
    audio,
  ]);
  const app = await OpenFilmApplication.create(
    directory,
    "Passive export",
    {},
    { userDataDirectory },
  );
  try {
    const assets = await Promise.all(
      [image, audio].map((path) =>
        inspectMedia({
          path,
          uri: pathToFileURL(path).href,
          name: path.split("/").at(-1)!,
        }),
      ),
    );
    for (const asset of assets) app.catalog.upsertAsset(asset);
    app.project.settings = { width: 160, height: 90, frameRate: 12 };
    app.project.stories.push({ id: "story", title: "Synthetic", beats: [] });
    app.project.timelines.push({
      id: "film",
      storyId: "story",
      duration: 0.25,
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: "picture",
              assetId: assets[0]!.id,
              timelineStart: 0,
              timelineDuration: 0.25,
            },
          ],
        },
        {
          id: "voice",
          type: "audio",
          timing: "overlay",
          clips: [
            {
              id: "narration",
              assetId: assets[1]!.id,
              timelineStart: 0,
              timelineDuration: 0.25,
              audioAutomation: { version: 1, role: "narration" },
            },
          ],
        },
      ],
    });
    app.catalog.saveJob(unrelatedJob);
  } finally {
    app.close();
  }
  const projectPath = join(directory, "project.json");
  const catalogPath = join(directory, "database.sqlite");
  const state = async () => ({
    project: await hashFile(projectPath),
    catalog: await hashFile(catalogPath),
    sources: await Promise.all([image, audio].map((path) => hashFile(path))),
  });
  const jobs = () => {
    const catalog = new DatabaseSync(catalogPath, { readOnly: true });
    try {
      return catalog
        .prepare("SELECT data FROM jobs ORDER BY id")
        .all()
        .map((row) => JSON.parse(String(row.data)) as Job);
    } finally {
      catalog.close();
    }
  };
  const cli = async <T>(args: string[]): Promise<T> => {
    const result = await execute(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "export",
        ...args,
        "--composition",
        "film",
        "--project",
        directory,
        "--user-data-dir",
        userDataDirectory,
      ],
      { cwd: resolve("."), env: {}, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(result.stdout) as T;
  };
  return { directory, projectPath, catalogPath, state, jobs, cli };
}

async function evidence(name: string, value: unknown) {
  const output = process.env.OPENFILM_CLI_EXPORT_PROBE_OUTPUT;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, `${name}.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
}

interface ProfileOutput {
  path?: string;
  manifestPath?: string;
  files?: Array<{
    path: string;
    sampleRate: number;
    channels: number;
    sampleCount: number;
  }>;
}

async function artifacts(result: ProfileOutput) {
  const paths = result.path
    ? [result.path, `${result.path}.manifest.json`]
    : [result.manifestPath!, ...result.files!.map((file) => file.path)];
  const values = await Promise.all(
    paths.map(async (path) => ({
      path,
      ino: (await lstat(path)).ino,
      sha256: await hashFile(path),
    })),
  );
  return {
    files: values,
    directoryInode: (await lstat(dirname(paths[0]!))).ino,
  };
}

it.each(["png", "wav", "audio-stems"] as const)(
  "CLI %s repeats a durable request without saving the project or recovering another process's job",
  async (format) => {
    const f = await fixture();
    const before = await f.state();
    const requestId = randomUUID();
    const args = [
      "--format",
      format,
      "--request-id",
      requestId,
      "--width",
      "160",
      "--height",
      "90",
      "--fps",
      "12",
      ...(format === "png" ? ["--time", "0"] : []),
    ];
    const first = await f.cli<ProfileOutput>(args);
    const savedArtifacts = await artifacts(first);
    const afterFirst = await f.state();
    const retried = await f.cli<ProfileOutput>(args).then(
      (value) => ({ accepted: true as const, value }),
      (error: unknown) => ({ accepted: false as const, error: String(error) }),
    );
    const afterRetry = await f.state();
    await evidence(format, {
      before,
      afterFirst,
      afterRetry,
      retried,
      first,
      savedArtifacts,
      jobs: f.jobs(),
    });
    expect.soft(afterFirst).toEqual(before);
    expect.soft(afterRetry).toEqual(before);
    expect.soft(f.jobs()).toEqual([unrelatedJob]);
    expect(retried.accepted).toBe(true);
    if (!retried.accepted) return;
    expect(retried.value).toEqual(first);
    expect(await artifacts(retried.value)).toEqual(savedArtifacts);
    if (format !== "png")
      expect(first.files).toEqual([
        expect.objectContaining({
          sampleRate: 48000,
          channels: 2,
          sampleCount: 12000,
        }),
      ]);
    else {
      const output = await inspectMedia({
        path: first.path!,
        uri: pathToFileURL(first.path!).href,
        name: "delivered.png",
      });
      expect(output.dimensions).toEqual({ width: 160, height: 90 });
    }

    const project = JSON.parse(await readFile(f.projectPath, "utf8"));
    project.settings.frameRate = 24;
    await writeFile(f.projectPath, JSON.stringify(project, null, 2) + "\n");
    const changed = await f.state();
    await expect(f.cli(args)).rejects.toThrow(
      "already used for different project content or settings",
    );
    expect(await f.state()).toEqual(changed);
    expect(await artifacts(first)).toEqual(savedArtifacts);
    expect(f.jobs()).toEqual([unrelatedJob]);
    await evidence(`${format}-changed-settings`, {
      refused: true,
      changed,
      after: await f.state(),
      savedArtifacts,
    });
  },
);

it("CLI JSON export reads passively and preserves project, catalog, sources and another process's job", async () => {
  const f = await fixture();
  const before = await f.state();
  const result = await f.cli<{ path: string }>(["--format", "json"]);
  expect(JSON.parse(await readFile(result.path, "utf8"))).toMatchObject({
    composition: { id: "film" },
  });
  const after = await f.state();
  await evidence("json", { before, after, jobs: f.jobs() });
  expect(after).toEqual(before);
  expect(f.jobs()).toEqual([unrelatedJob]);
});

it("CLI MP4 export preserves the saved project and existing job while recording its own completed render", async () => {
  const f = await fixture();
  const before = await f.state();
  const result = await f.cli<{ path: string }>([
    "--format",
    "mp4",
    "--width",
    "160",
    "--height",
    "90",
    "--fps",
    "12",
  ]);
  const output = await inspectMedia({
    path: result.path,
    uri: pathToFileURL(result.path).href,
    name: "delivered.mp4",
  });
  expect(output.dimensions).toEqual({ width: 160, height: 90 });
  const after = await f.state();
  const jobs = f.jobs();
  await evidence("mp4", { before, after, jobs, output });
  expect.soft(after.project).toBe(before.project);
  expect(after.sources).toEqual(before.sources);
  expect
    .soft(jobs.find((job) => job.id === unrelatedJob.id))
    .toEqual(unrelatedJob);
  expect(jobs.filter((job) => job.id !== unrelatedJob.id)).toEqual([
    expect.objectContaining({
      type: "render",
      status: "completed",
      progress: 1,
    }),
  ]);
});
