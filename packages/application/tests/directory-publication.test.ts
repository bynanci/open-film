import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import {
  ApplicationError,
  createExportProfile,
  type MediaAsset,
} from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
import {
  DirectoryPublicationRecoveryError,
  publishDirectory,
} from "../src/directory-publication.js";

const publicationHooks = vi.hoisted(() => ({
  before: undefined as
    undefined | ((source: string, destination: string) => void),
  after: undefined as
    undefined | ((source: string, destination: string) => void),
  loaded: undefined as undefined | (() => void | Promise<void>),
}));
vi.mock("../src/exclusive-directory-rename.js", async (original) => {
  const actual =
    await original<typeof import("../src/exclusive-directory-rename.js")>();
  return {
    ...actual,
    getExclusiveDirectoryRenamer: async () => {
      const rename = await actual.getExclusiveDirectoryRenamer();
      await publicationHooks.loaded?.();
      return (source: string, destination: string) => {
        publicationHooks.before?.(source, destination);
        rename(source, destination);
        publicationHooks.after?.(source, destination);
      };
    },
  };
});
function child(script: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script, ...args],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || "Synthetic filesystem child failed.");
  return result.stdout;
}
const apps = new Set<OpenFilmApplication>();
let root: string;
let photo: MediaAsset;
let photoSha256: string;
let audio: MediaAsset;
let sequence = 0;
beforeAll(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "openfilm-directory-publication-")),
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
  photoSha256 = await hashFile(path);
  const audioPath = join(root, "synthetic-narration.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=1",
    "-c:a",
    "pcm_s16le",
    "-threads",
    "1",
    audioPath,
  ]);
  audio = await inspectMedia({
    path: audioPath,
    uri: pathToFileURL(audioPath).href,
    name: "synthetic-narration.wav",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  publicationHooks.before = publicationHooks.after = undefined;
  publicationHooks.loaded = undefined;
  for (const app of apps) app.close({ requireSave: false });
  apps.clear();
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const directory = join(root, `case-${++sequence}`);
  await fs.mkdir(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "source.openfilm"),
    "Synthetic publication",
  );
  apps.add(app);
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
  return { app, directory };
}

async function collectInput(app: OpenFilmApplication, destination: string) {
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
  return {
    ...selection,
    rightsDeclarations,
    planId: plan.id,
    baseRevision: plan.revision,
    destination,
    format: "directory" as const,
  };
}

const stemsProfile = createExportProfile({
  ratio: "16:9",
  format: "audio-stems",
  frameRate: 10,
});

// Only schedule real syscalls: the separate Node process creates the winning
// filesystem entry; neither publisher syscall nor its result is simulated.
function beforePublication(destination: string, action: () => void) {
  let entered = false;
  publicationHooks.before = (_source, target) => {
    if (target === destination && !entered) {
      entered = true;
      action();
    }
  };
  return () => entered;
}

function externalWinner(
  destination: string,
  kind: "empty" | "nonempty" | "file" | "symlink",
  victim: string,
) {
  const result = child(
    `
    import {mkdir,writeFile,symlink,lstat} from 'node:fs/promises';
    import {join} from 'node:path';
    const [destination,kind,victim]=process.argv.slice(1);
    if(kind==='file') await writeFile(destination,'synthetic foreign file',{flag:'wx',mode:0o640});
    else if(kind==='symlink') await symlink(victim,destination,'dir');
    else { await mkdir(destination,{mode:0o750}); if(kind==='nonempty') await writeFile(join(destination,'foreign.txt'),'synthetic foreign entry',{flag:'wx'}); }
    const value=await lstat(destination);
    process.stdout.write(JSON.stringify({dev:value.dev,ino:value.ino,mode:value.mode}));
  `,
    [destination, kind, victim],
  );
  return JSON.parse(result) as {
    dev: number;
    ino: number;
    mode: number;
  };
}

describe("exclusive directory publication", () => {
  it.each(["collect", "stems"] as const)(
    "preserves a real external empty-directory winner during %s publication",
    async (kind) => {
      const { app, directory } = await fixture();
      const requestId = `race-empty-${sequence}`;
      const destination =
        kind === "collect"
          ? join(directory, "portable.openfilm")
          : join(app.directory, "exports", `stems-${requestId}`);
      const input =
        kind === "collect" ? await collectInput(app, destination) : undefined;
      let winner: Awaited<ReturnType<typeof externalWinner>> | undefined;
      const entered = beforePublication(destination, () => {
        winner = externalWinner(destination, "empty", directory);
      });
      let error: unknown;
      try {
        if (kind === "collect") await app.collectMedia.create(input!);
        else
          await app.exportProfileAudio({
            compositionId: "film",
            profile: stemsProfile,
            requestId,
          });
      } catch (cause) {
        error = cause;
      }
      expect(entered()).toBe(true);
      const after = await fs.lstat(destination);
      expect({ dev: after.dev, ino: after.ino, mode: after.mode }).toEqual(
        winner,
      );
      expect(await fs.readdir(destination)).toEqual([]);
      expect(error).toBeDefined();
      expect(await hashFile(fileURLToPath(photo.uri))).toBe(photoSha256);
    },
  );

  it("retries the same actual PCM stem request after SIGKILL at first visible output", async () => {
    const { app } = await fixture();
    app.catalog.upsertAsset(audio);
    app.project.timelines[0]!.tracks.push({
      id: "narration",
      type: "audio",
      timing: "overlay",
      clips: [
        {
          id: "voice",
          assetId: audio.id,
          timelineStart: 0,
          timelineDuration: 1,
          audioAutomation: { version: 1, role: "narration" },
        },
      ],
    });
    await app.save();
    const projectPath = app.directory;
    app.close();
    apps.delete(app);
    const input = {
      compositionId: "film",
      profile: stemsProfile,
      requestId: "actual-stem-crash-retry-001",
    };
    const target = join(projectPath, "exports", `stems-${input.requestId}`);
    const source = `import {OpenFilmApplication} from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
      import{existsSync,writeSync}from'node:fs';import{join}from'node:path';
      const app=await OpenFilmApplication.openForExport(${JSON.stringify(projectPath)});
      const service=app.exportProfiles;const original=service.assertPublicationCurrent.bind(service);
      service.assertPublicationCurrent=(...args)=>{original(...args);if(existsSync(join(${JSON.stringify(target)},'narration.wav'))){writeSync(1,JSON.stringify({visible:true,manifest:existsSync(join(${JSON.stringify(target)},'manifest.json'))})+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}};
      await app.exportProfileAudio(${JSON.stringify(input)});`;
    const exportChild = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", source],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let exited = false;
    let errors = "";
    const done = new Promise<void>((accept) =>
      exportChild.once("exit", () => {
        exited = true;
        accept();
      }),
    );
    exportChild.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    try {
      const ready = await new Promise<string>((accept, reject) => {
        exportChild.stdout.once("data", (chunk: Buffer) =>
          accept(chunk.toString()),
        );
        exportChild.once("error", reject);
        exportChild.once("exit", (code) =>
          reject(new Error(`Synthetic stem child exited ${code}: ${errors}`)),
        );
      });
      expect(JSON.parse(ready)).toEqual({ visible: true, manifest: true });
      const identity = await fs.lstat(target);
      const receiptHash = await hashFile(join(target, "manifest.json"));
      const wavHash = await hashFile(join(target, "narration.wav"));
      exportChild.kill("SIGKILL");
      await done;
      const reopened = await OpenFilmApplication.openForExport(projectPath);
      apps.add(reopened);
      const result = await reopened.exportProfileAudio(input);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toMatchObject({
        role: "narration",
        sampleRate: 48000,
        sampleCount: 48000,
      });
      expect((await fs.lstat(target)).ino).toBe(identity.ino);
      expect(await hashFile(result.manifestPath!)).toBe(receiptHash);
      expect(await hashFile(result.files[0]!.path)).toBe(wavHash);
    } finally {
      if (!exited) exportChild.kill("SIGKILL");
      await done;
    }
  });

  it.each(["nonempty", "file", "symlink"] as const)(
    "preserves a real external %s destination and its target",
    async (kind) => {
      const { app, directory } = await fixture();
      const destination = join(directory, "portable.openfilm");
      const victim = join(directory, "victim");
      await fs.mkdir(victim);
      await fs.writeFile(
        join(victim, "keep.txt"),
        "synthetic untouched target",
      );
      const input = await collectInput(app, destination);
      let winner: Awaited<ReturnType<typeof externalWinner>> | undefined;
      beforePublication(destination, () => {
        winner = externalWinner(destination, kind, victim);
      });
      await expect(app.collectMedia.create(input)).rejects.toBeDefined();
      const after = await fs.lstat(destination);
      expect({ dev: after.dev, ino: after.ino, mode: after.mode }).toEqual(
        winner,
      );
      if (kind === "file")
        expect(await fs.readFile(destination, "utf8")).toBe(
          "synthetic foreign file",
        );
      if (kind === "nonempty")
        expect(
          await fs.readFile(join(destination, "foreign.txt"), "utf8"),
        ).toBe("synthetic foreign entry");
      expect(await fs.readFile(join(victim, "keep.txt"), "utf8")).toBe(
        "synthetic untouched target",
      );
      expect(await fs.readdir(victim)).toEqual(["keep.txt"]);
    },
  );

  it("keeps normal package verification and durable empty-stem retries", async () => {
    const { app, directory } = await fixture();
    const destination = join(directory, "portable.openfilm");
    await app.collectMedia.create(await collectInput(app, destination));
    expect(await app.collectMedia.verify(destination)).toMatchObject({
      verified: true,
      outputFrames: 10,
    });
    const request = {
      compositionId: "film",
      profile: stemsProfile,
      requestId: "durable-empty-directory-001",
    };
    app.close();
    apps.delete(app);
    const passive = await OpenFilmApplication.openForExport(app.directory);
    apps.add(passive);
    const first = await passive.exportProfileAudio(request);
    expect(first.files).toEqual([]);
    const receipt = await fs.readFile(first.manifestPath!);
    passive.close();
    apps.delete(passive);
    const reopened = await OpenFilmApplication.openForExport(app.directory);
    apps.add(reopened);
    const retried = await reopened.exportProfileAudio(request);
    expect(retried.manifestPath).toBe(first.manifestPath);
    expect(await fs.readFile(retried.manifestPath!)).toEqual(receipt);
    expect(await fs.readdir(dirname(retried.manifestPath!))).toEqual([
      "manifest.json",
    ]);
  });

  it.each(["collect", "stems"] as const)(
    "returns an actionable typed %s error if atomic publication is unsupported",
    async (kind) => {
      const { app, directory } = await fixture();
      const destination = join(directory, "unsupported.openfilm");
      const input =
        kind === "collect" ? await collectInput(app, destination) : undefined;
      publicationHooks.loaded = () => {
        throw Object.assign(
          new Error("Synthetic unavailable native operation"),
          { code: "ENOTSUP" },
        );
      };
      const operation =
        kind === "collect"
          ? app.collectMedia.create(input!)
          : app.exportProfileAudio({
              compositionId: "film",
              profile: stemsProfile,
              requestId: "unsupported-stems-001",
            });
      await expect(operation).rejects.toBeInstanceOf(ApplicationError);
      await expect(operation).rejects.toMatchObject({
        code:
          kind === "collect"
            ? "export.directoryUnavailable"
            : "export.stemsUnavailable",
        status: 422,
      });
      await expect(fs.lstat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await fs.readdir(join(app.directory, "exports"))).toEqual([]);
    },
  );
});

async function stagedDirectory() {
  const directory = join(root, `atomic-helper-${++sequence}`);
  const staging = join(directory, "private-stage");
  const destination = join(directory, "published");
  await fs.mkdir(join(staging, "payloads"), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    join(staging, "payloads", "a.bin"),
    Buffer.alloc(700_000, 0x41),
  );
  await fs.writeFile(join(staging, "receipt.json"), '{"synthetic":true}');
  const hashes = new Map<string, string>();
  for (const relative of ["payloads/a.bin", "receipt.json"])
    hashes.set(relative, await hashFile(join(staging, relative)));
  return { directory, staging, destination, hashes, assertCurrent: () => {} };
}

async function expectComplete(
  path: string,
  hashes: ReadonlyMap<string, string>,
) {
  for (const [relative, hash] of hashes)
    expect(await hashFile(join(path, relative))).toBe(hash);
}

describe("known-stage atomic directory publication", () => {
  it("publishes the complete original stage inode in one native operation", async () => {
    const input = await stagedDirectory();
    const identity = await fs.lstat(input.staging);
    let observed = false;
    publicationHooks.after = (_source, destination) => {
      if (destination === input.destination) {
        observed = true;
        // The native return is observed before any helper continuation.
        child(
          `import {readFileSync,statSync} from 'node:fs';import{join}from'node:path';const [p,ino]=process.argv.slice(1);if(String(statSync(p).ino)!==ino||JSON.parse(readFileSync(join(p,'receipt.json'))).synthetic!==true||statSync(join(p,'payloads/a.bin')).size!==700000)process.exit(1);`,
          [destination, String(identity.ino)],
        );
      }
    };
    await publishDirectory(input);
    expect(observed).toBe(true);
    expect((await fs.lstat(input.destination)).ino).toBe(identity.ino);
    await expectComplete(input.destination, input.hashes);
    await expect(fs.lstat(input.staging)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("checks cancellation after native loading and before publication", async () => {
    const input = await stagedDirectory();
    const controller = new AbortController();
    publicationHooks.loaded = async () => {
      await new Promise<void>((done) => setImmediate(done));
      controller.abort();
    };
    await expect(
      publishDirectory({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(fs.lstat(input.destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expectComplete(input.staging, input.hashes);
  });

  it("rejects a replaced private stage before the final publication fence", async () => {
    const input = await stagedDirectory();
    const displaced = join(input.directory, "original-private-stage");
    publicationHooks.loaded = async () => {
      await fs.rename(input.staging, displaced);
      await fs.mkdir(input.staging);
    };
    await expect(publishDirectory(input)).rejects.toThrow("stage changed");
    await expect(fs.lstat(input.destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readdir(input.staging)).toEqual([]);
    await expectComplete(displaced, input.hashes);
  });

  it("rejects a destination parent replaced by a symlink while native loading awaits", async () => {
    const input = await stagedDirectory();
    const parent = join(input.directory, "output-parent");
    const displaced = join(input.directory, "original-output-parent");
    const victim = join(input.directory, "foreign-parent");
    await fs.mkdir(parent);
    await fs.mkdir(victim);
    await fs.writeFile(join(victim, "keep.txt"), "synthetic untouched target");
    publicationHooks.loaded = async () => {
      await fs.rename(parent, displaced);
      await fs.symlink(victim, parent, "dir");
    };
    await expect(
      publishDirectory({ ...input, destination: join(parent, "published") }),
    ).rejects.toThrow("parent changed");
    expect((await fs.lstat(parent)).isSymbolicLink()).toBe(true);
    expect(await fs.readdir(victim)).toEqual(["keep.txt"]);
    await expectComplete(input.staging, input.hashes);
  });

  it.each(["abort", "revision"] as const)(
    "reclaims only its own complete directory after a late %s and permits retry",
    async (cause) => {
      const input = await stagedDirectory();
      const controller = new AbortController();
      let published = false;
      publicationHooks.after = (_source, destination) => {
        if (destination === input.destination) {
          published = true;
          if (cause === "abort") controller.abort();
        }
      };
      await expect(
        publishDirectory({
          ...input,
          signal: controller.signal,
          assertCurrent: () => {
            if (published && cause === "revision")
              throw new Error("Synthetic changed revision");
          },
        }),
      ).rejects.toBeDefined();
      expect(published).toBe(true);
      await expect(fs.lstat(input.destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await new Promise<void>((done) => setImmediate(done));
      await expect(fs.lstat(input.destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expectComplete(input.staging, input.hashes);
      publicationHooks.after = undefined;
      await publishDirectory(input);
      await expectComplete(input.destination, input.hashes);
    },
  );

  it.each(["empty", "symlink"] as const)(
    "preserves a real postcommit foreign %s replacement and complete displaced package",
    async (kind) => {
      const input = await stagedDirectory();
      const displaced = join(input.directory, "displaced-owned-package");
      const victim = join(input.directory, "foreign-target");
      await fs.mkdir(victim);
      await fs.writeFile(
        join(victim, "keep.txt"),
        "synthetic untouched target",
      );
      let foreign: { dev: number; ino: number; mode: number } | undefined;
      publicationHooks.after = (_source, destination) => {
        if (destination === input.destination && !foreign)
          foreign = JSON.parse(
            child(
              `
        import {rename,mkdir,symlink,lstat} from 'node:fs/promises';
        const [target,displaced,victim,kind]=process.argv.slice(1);
        await rename(target,displaced);
        if(kind==='symlink')await symlink(victim,target,'dir');else await mkdir(target,{mode:0o750});
        const s=await lstat(target);process.stdout.write(JSON.stringify({dev:s.dev,ino:s.ino,mode:s.mode}));
      `,
              [destination, displaced, victim, kind],
            ),
          ) as typeof foreign;
      };
      await expect(publishDirectory(input)).rejects.toBeInstanceOf(
        DirectoryPublicationRecoveryError,
      );
      const after = await fs.lstat(input.destination);
      expect({ dev: after.dev, ino: after.ino, mode: after.mode }).toEqual(
        foreign,
      );
      expect(
        await fs.readdir(kind === "symlink" ? victim : input.destination),
      ).toEqual(kind === "symlink" ? ["keep.txt"] : []);
      expect(await fs.readFile(join(victim, "keep.txt"), "utf8")).toBe(
        "synthetic untouched target",
      );
      await expectComplete(displaced, input.hashes);
    },
  );

  it("preserves a foreign stage winner when exclusive rollback cannot reclaim its path", async () => {
    const input = await stagedDirectory();
    const controller = new AbortController();
    let winner: ReturnType<typeof externalWinner> | undefined;
    publicationHooks.after = (_source, destination) => {
      if (destination === input.destination) {
        winner = externalWinner(input.staging, "empty", input.directory);
        controller.abort();
      }
    };
    await expect(
      publishDirectory({ ...input, signal: controller.signal }),
    ).rejects.toBeInstanceOf(DirectoryPublicationRecoveryError);
    const after = await fs.lstat(input.staging);
    expect({ dev: after.dev, ino: after.ino, mode: after.mode }).toEqual(
      winner,
    );
    expect(await fs.readdir(input.staging)).toEqual([]);
    await expectComplete(input.destination, input.hashes);
  });

  it("restores a foreign inode that wins between rollback's identity check and native call", async () => {
    const input = await stagedDirectory();
    const displaced = join(input.directory, "displaced-before-rollback");
    const controller = new AbortController();
    let foreign: { dev: number; ino: number; mode: number } | undefined;
    publicationHooks.after = (_source, destination) => {
      if (destination === input.destination) controller.abort();
    };
    publicationHooks.before = (source, destination) => {
      if (
        source === input.destination &&
        destination === input.staging &&
        !foreign
      )
        foreign = JSON.parse(
          child(
            `import{rename,mkdir,lstat}from'node:fs/promises';const[target,displaced]=process.argv.slice(1);await rename(target,displaced);await mkdir(target,{mode:0o750});const s=await lstat(target);process.stdout.write(JSON.stringify({dev:s.dev,ino:s.ino,mode:s.mode}));`,
            [source, displaced],
          ),
        ) as typeof foreign;
    };
    await expect(
      publishDirectory({ ...input, signal: controller.signal }),
    ).rejects.toBeInstanceOf(DirectoryPublicationRecoveryError);
    const after = await fs.lstat(input.destination);
    expect({ dev: after.dev, ino: after.ino, mode: after.mode }).toEqual(
      foreign,
    );
    expect(await fs.readdir(input.destination)).toEqual([]);
    await expectComplete(displaced, input.hashes);
  });
});
