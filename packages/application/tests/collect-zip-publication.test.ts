import { spawnSync } from "node:child_process";
import { lstatSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { extractStoredZip } from "../src/collect-archive.js";
import { OpenFilmApplication } from "../src/index.js";

const hooks = vi.hoisted(() => ({
  afterWrite: undefined as undefined | ((archive: string) => Promise<void>),
}));
vi.mock("../src/collect-archive.js", async (original) => {
  const actual = await original<typeof import("../src/collect-archive.js")>();
  return {
    ...actual,
    writeStoredZip: async (
      ...args: Parameters<typeof actual.writeStoredZip>
    ) => {
      await actual.writeStoredZip(...args);
      await hooks.afterWrite?.(args[1]);
    },
  };
});

const applications = new Set<OpenFilmApplication>();
let root: string;
let photo: MediaAsset;
let sourceHash: string;
let sequence = 0;
beforeAll(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "openfilm-zip-publication-")),
  );
  const path = join(root, "synthetic.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=96x54",
    "-frames:v",
    "1",
    "-threads",
    "1",
    path,
  ]);
  photo = await inspectMedia({
    path,
    uri: pathToFileURL(path).href,
    name: "synthetic.png",
  });
  sourceHash = await hashFile(path);
});
afterEach(() => {
  hooks.afterWrite = undefined;
  for (const app of applications) app.close({ requireSave: false });
  applications.clear();
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const directory = join(root, `case-${++sequence}`);
  await fs.mkdir(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "source.openfilm"),
    "Synthetic ZIP publication",
  );
  applications.add(app);
  app.project.settings = { width: 160, height: 90, frameRate: 10 };
  app.catalog.upsertAsset(photo);
  app.project.stories = [
    {
      id: "story",
      title: "Synthetic",
      beats: [
        {
          id: "beat",
          title: "Synthetic",
          candidateAssetIds: [photo.id],
          selectedAssetIds: [photo.id],
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
              assetId: photo.id,
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
  const selection = { scope: "entire-project" as const };
  const preview = await app.collectMedia.plan(selection);
  const rightsDeclarations = preview.items.map(({ resourceId }) => ({
    resourceId,
    basis: "owned" as const,
    confirmed: true as const,
  }));
  const plan = await app.collectMedia.plan({
    ...selection,
    rightsDeclarations,
  });
  expect(plan.complete).toBe(true);
  const destination = join(directory, "portable.zip");
  const input = {
    ...selection,
    rightsDeclarations,
    planId: plan.id,
    baseRevision: plan.revision,
    destination,
    format: "zip" as const,
  };
  return { app, directory, destination, input };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("ZIP publication revision and cancellation fence", () => {
  it.each(["revision", "cancel"] as const)(
    "refuses a %s change while the actual archive write is held",
    async (kind) => {
      const { app, directory, destination, input } = await fixture();
      const controller = new AbortController();
      const ready = deferred<string>();
      const release = deferred<void>();
      hooks.afterWrite = async (archive) => {
        ready.resolve(archive);
        await release.promise;
      };
      const result = app.collectMedia
        .create({ ...input, signal: controller.signal })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      let expectedProject = await fs.readFile(
        join(app.directory, "project.json"),
      );
      try {
        const archive = await ready.promise;
        const extracted = join(directory, "actual-written-archive");
        await fs.mkdir(extracted);
        await extractStoredZip(archive, extracted);
        const receipt = JSON.parse(
          await fs.readFile(join(extracted, "collect-manifest.json"), "utf8"),
        );
        expect(receipt.projectRevision).toBe(input.baseRevision);
        await expect(fs.lstat(destination)).rejects.toMatchObject({
          code: "ENOENT",
        });
        if (kind === "revision") {
          app.project.title = "Saved while ZIP writer was pending";
          await app.save();
          expectedProject = await fs.readFile(
            join(app.directory, "project.json"),
          );
        } else controller.abort();
      } finally {
        release.resolve();
      }
      expect(await result).toMatchObject({
        code: kind === "revision" ? "story.planStale" : "export.failed",
        status: 409,
      });
      await expect(fs.lstat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await new Promise<void>((done) => setImmediate(done));
      await expect(fs.lstat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await fs.readFile(join(app.directory, "project.json"))).toEqual(
        expectedProject,
      );
      expect(await hashFile(fileURLToPath(photo.uri))).toBe(sourceHash);
    },
  );

  it.each(["file", "directory", "symlink"] as const)(
    "preserves a real child %s winner created after archive writing",
    async (kind) => {
      const { app, directory, destination, input } = await fixture();
      const victim = join(directory, "foreign-target.txt");
      await fs.writeFile(victim, "synthetic untouched target");
      let foreign: { dev: number; ino: number; mode: number } | undefined;
      hooks.afterWrite = async () => {
        const result = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
        import {writeFile,mkdir,symlink,lstat} from 'node:fs/promises';
        const [target,kind,victim]=process.argv.slice(1);
        if(kind==='file')await writeFile(target,'synthetic foreign winner',{flag:'wx',mode:0o640});
        else if(kind==='directory')await mkdir(target,{mode:0o750});
        else await symlink(victim,target);
        const s=await lstat(target);process.stdout.write(JSON.stringify({dev:s.dev,ino:s.ino,mode:s.mode}));
      `,
            destination,
            kind,
            victim,
          ],
          { encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        foreign = JSON.parse(result.stdout) as typeof foreign;
      };
      const project = await fs.readFile(join(app.directory, "project.json"));
      await expect(app.collectMedia.create(input)).rejects.toMatchObject({
        code: "project.destinationInvalid",
        status: 409,
      });
      const current = await fs.lstat(destination);
      expect({
        dev: current.dev,
        ino: current.ino,
        mode: current.mode,
      }).toEqual(foreign);
      if (kind === "file")
        expect(await fs.readFile(destination, "utf8")).toBe(
          "synthetic foreign winner",
        );
      if (kind === "directory")
        expect(await fs.readdir(destination)).toEqual([]);
      expect(await fs.readFile(victim, "utf8")).toBe(
        "synthetic untouched target",
      );
      expect(await fs.readFile(join(app.directory, "project.json"))).toEqual(
        project,
      );
      expect(await hashFile(fileURLToPath(photo.uri))).toBe(sourceHash);
    },
  );

  it("keeps a committed valid archive when its completion observer cancels and throws", async () => {
    const { app, directory, destination, input } = await fixture();
    const controller = new AbortController();
    const project = await fs.readFile(join(app.directory, "project.json"));
    let completed = false;
    let completionLinks: number | undefined;
    const result = await app.collectMedia.create({
      ...input,
      signal: controller.signal,
      onProgress(progress) {
        if (progress === 1) {
          completed = true;
          completionLinks = lstatSync(destination).nlink;
          controller.abort();
          throw new Error("Synthetic completion observer failure");
        }
      },
    });
    expect(completed).toBe(true);
    expect(completionLinks).toBe(1);
    expect(result.packageBytes).toBe((await fs.lstat(destination)).size);
    const verified = await app.collectMedia.verify(destination);
    expect(verified).toMatchObject({ verified: true, outputFrames: 10 });
    const extracted = join(directory, "verified-committed-extracted");
    await fs.mkdir(extracted);
    await extractStoredZip(destination, extracted);
    expect(await hashFile(join(extracted, "collect-manifest.json"))).toBe(
      result.manifestSha256,
    );
    expect(await fs.readFile(join(app.directory, "project.json"))).toEqual(
      project,
    );
    expect(await hashFile(fileURLToPath(photo.uri))).toBe(sourceHash);
  });

  it.each(["file", "symlink"] as const)(
    "does not revoke a real postcommit %s replacement on cancellation",
    async (kind) => {
      const { app, directory, destination, input } = await fixture();
      const committed = join(directory, "committed-original.zip");
      const victim = join(directory, "foreign-target.txt");
      await fs.writeFile(victim, "synthetic untouched target");
      const controller = new AbortController();
      let foreign: { dev: number; ino: number; mode: number } | undefined;
      const result = await app.collectMedia.create({
        ...input,
        signal: controller.signal,
        onProgress(progress) {
          if (progress !== 1) return;
          renameSync(destination, committed);
          if (kind === "file")
            writeFileSync(destination, "synthetic postcommit winner", {
              flag: "wx",
              mode: 0o640,
            });
          else symlinkSync(victim, destination);
          const current = lstatSync(destination);
          foreign = { dev: current.dev, ino: current.ino, mode: current.mode };
          controller.abort();
        },
      });
      const current = await fs.lstat(destination);
      expect({
        dev: current.dev,
        ino: current.ino,
        mode: current.mode,
      }).toEqual(foreign);
      if (kind === "file")
        expect(await fs.readFile(destination, "utf8")).toBe(
          "synthetic postcommit winner",
        );
      expect(await fs.readFile(victim, "utf8")).toBe(
        "synthetic untouched target",
      );
      expect(result.packageBytes).toBe((await fs.lstat(committed)).size);
      const extracted = join(directory, "committed-extracted");
      await fs.mkdir(extracted);
      await extractStoredZip(committed, extracted);
      expect(await hashFile(join(extracted, "collect-manifest.json"))).toBe(
        result.manifestSha256,
      );
      expect(await hashFile(fileURLToPath(photo.uri))).toBe(sourceHash);
    },
  );
});
