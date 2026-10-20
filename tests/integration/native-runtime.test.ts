import { build } from "esbuild";
import { existsSync, lstatSync, mkdirSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import {
  stageRuntime,
  type RuntimeInputs,
} from "../../scripts/native/stage.js";
import {
  runtimeHash,
  verifyRuntimeBundle,
} from "../../apps/server/src/runtime-manifest.js";
const roots: string[] = [];
const readOnlyDirectories: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of readOnlyDirectories.splice(0))
    await chmod(path, 0o700).catch(() => {});
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.stdin.end();
      await new Promise<void>((done) => {
        child.once("exit", () => done());
        setTimeout(() => {
          child.kill("SIGTERM");
          done();
        }, 5000).unref();
      });
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function eventually<T>(
  read: () => T | undefined,
  timeout = 30000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("Native fixture timeout");
}
async function bundle(
  root: string,
  ffmpegSource = "/usr/bin/ffmpeg",
  serviceEntry = "apps/server/src/index.ts",
  beforeStage?: (output: string) => void | Promise<void>,
) {
  const repository = join(root, "build");
  await mkdir(join(repository, "dist/server"), { recursive: true });
  await mkdir(join(repository, "dist/native"), { recursive: true });
  await writeFile(join(repository, "package.json"), '{"type":"module"}');
  await symlink(
    resolve("node_modules"),
    join(repository, "node_modules"),
    "dir",
  );
  for (const name of ["LICENSE", "NOTICE"])
    await copyFile(resolve(name), join(repository, name));
  for (const [entry, outfile] of [
    [serviceEntry, "dist/server/index.mjs"],
    ["apps/server/src/native-entry.ts", "dist/native/launcher.mjs"],
  ])
    await build({
      entryPoints: [resolve(entry!)],
      outfile: join(repository, outfile!),
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      external: ["@resvg/resvg-js", "fontkit", "koffi"],
    });
  const license = join(root, "test-receipt.txt");
  await writeFile(
    license,
    "Synthetic test receipt only; not a distribution license.",
  );
  const tools = {} as RuntimeInputs["tools"];
  for (const id of ["node", "ffmpeg", "ffprobe", "font"] as const) {
    const source = await realpath(
      id === "node"
        ? process.execPath
        : id === "font"
          ? "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
          : id === "ffmpeg"
            ? ffmpegSource
            : `/usr/bin/${id}`,
    );
    let version = process.versions.node;
    if (id === "font") version = "1.0.0";
    if (id === "ffmpeg" || id === "ffprobe")
      version = (await runProcess(source, ["-version"])).stdout
        .toString()
        .split(" ")[2]!;
    tools[id] = {
      source,
      sha256: await runtimeHash(source),
      version,
      license:
        id === "ffmpeg" || id === "ffprobe"
          ? "GPL-2.0-or-later"
          : id === "font"
            ? "OFL-1.1"
            : "MIT",
      licenseFile: license,
      licenseSha256: await runtimeHash(license),
    };
  }
  const output = join(
    root,
    "long-install-path-".repeat(10),
    "long-resource-path-".repeat(10),
    "候選 runtime with spaces",
  );
  const inputs: RuntimeInputs = {
    dependencyLicenses: Object.fromEntries(
      [
        "fontkit",
        "brotli",
        "dfa",
        `@resvg/resvg-js-${process.platform}-${process.arch}-gnu`,
      ].map((id) => [
        id,
        { source: license, sha256: tools.node.licenseSha256 },
      ]),
    ),
    appVersion: JSON.parse(await readFile(resolve("package.json"), "utf8"))
      .version,
    platform: process.platform as RuntimeInputs["platform"],
    architecture: process.arch as RuntimeInputs["architecture"],
    nodeVersion: process.versions.node,
    tools,
  };
  await beforeStage?.(output);
  const manifest = await stageRuntime(inputs, output, repository);
  const repeated = join(root, "repeated-runtime");
  await stageRuntime(inputs, repeated, repository);
  expect(await readFile(join(repeated, "runtime-manifest.json"), "utf8")).toBe(
    await readFile(join(output, "runtime-manifest.json"), "utf8"),
  );
  await rm(repeated, { recursive: true, force: true });
  await expect(
    stageRuntime(
      {
        ...inputs,
        tools: { ...tools, node: { ...tools.node, sha256: "0".repeat(64) } },
      },
      join(root, "bad-runtime"),
      repository,
    ),
  ).rejects.toThrow("hash mismatch");
  return { output, manifest };
}
it("inventories the actual loaded host Koffi addon and all upstream MIT notices", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-native-koffi-"));
  roots.push(root);
  const { output, manifest } = await bundle(root);
  expect(manifest.components.find((c) => c.id === "koffi")).toMatchObject({
    version: "3.3.3",
    license: "MIT",
  });
  const nativeId = `@koromix/koffi-${process.platform}-${process.arch}`;
  expect(manifest.components.find((c) => c.id === nativeId)).toMatchObject({
    version: "3.3.3",
    license: "MIT",
  });
  const require = createRequire(join(output, manifest.entries.service));
  expect((require("koffi") as { version: string }).version).toBe("3.3.3");
  const loaded = Object.keys(require.cache).filter(
    (path) => path.startsWith(output) && path.endsWith("koffi.node"),
  );
  expect(loaded).toHaveLength(1);
  const nativePath = relative(output, loaded[0]!).replaceAll("\\", "/");
  expect(manifest.files.find((f) => f.path === nativePath)).toMatchObject({
    component: nativeId,
    sha256: await runtimeHash(loaded[0]!),
  });
  for (const [path, sha256] of [
    [
      "LICENSE.txt",
      "22bcbbbacd739b026a8dc484f62a31484ce4c4e31f3408b60b29b4e41d62b290",
    ],
    [
      "vendor/node-addon-api/LICENSE.md",
      "89024017b88a9f2b763f79b941a4f2db3b4428edfcacdc0b23866b2da633ad0c",
    ],
    [
      "vendor/node-api-headers/LICENSE",
      "a553508f516031c91f3af1148d44970cb81bbae6c4f091be6835d39cc252238c",
    ],
  ])
    expect(
      manifest.files.find((f) => f.path === `node_modules/koffi/${path}`),
    ).toMatchObject({ sha256 });
  const installed = launch(join(root, "owner"), output);
  await installed.ready();
  await installed.stop();
});
it("does not replace an external empty directory created after runtime staging admission", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-native-stage-exclusive-"),
  );
  roots.push(root);
  let observer: ReturnType<typeof watch> | undefined;
  let foreign: ReturnType<typeof lstatSync> | undefined;
  let destination = "";
  try {
    await expect(
      bundle(root, undefined, undefined, (output) => {
        destination = output;
        mkdirSync(dirname(output), { recursive: true });
        observer = watch(dirname(output), (_event, name) => {
          if (!foreign && name?.startsWith(".openfilm-runtime-")) {
            mkdirSync(output);
            foreign = lstatSync(output);
          }
        });
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(foreign).toBeDefined();
    expect(await lstat(destination)).toMatchObject({
      dev: foreign!.dev,
      ino: foreign!.ino,
    });
    expect(await readdir(destination)).toEqual([]);
  } finally {
    observer?.close();
  }
});
it.each([
  "LICENSE.txt",
  "vendor/node-addon-api/LICENSE.md",
  "vendor/node-api-headers/LICENSE",
])(
  "rejects an actual source change after the reviewed %s hash before copy",
  async (notice) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-koffi-notice-race-"));
    roots.push(root);
    let changed = false,
      destination = "";
    await expect
      .soft(
        bundle(root, undefined, undefined, async (output) => {
          destination = output;
          // Copy only into a private test package. Never alter pnpm's shared store.
          const modules = join(root, "build/node_modules");
          const originalCore = await realpath(resolve("node_modules/koffi"));
          const nativeId = `@koromix/koffi-${process.platform}-${process.arch}`;
          const dependencyRequire = createRequire(
            join(originalCore, "package.json"),
          );
          const originalNative = dirname(dependencyRequire.resolve(nativeId));
          await rm(modules);
          await mkdir(join(modules, "@resvg"), { recursive: true });
          await mkdir(join(modules, "@koromix"), { recursive: true });
          for (const name of ["fontkit", "@resvg/resvg-js"])
            await symlink(
              await realpath(resolve("node_modules", name)),
              join(modules, name),
              "dir",
            );
          const core = join(modules, "koffi");
          await cp(originalCore, core, {
            recursive: true,
            filter: (source) => basename(source) !== "node_modules",
          });
          await cp(originalNative, join(modules, nativeId), {
            recursive: true,
          });
          const target = join(core, notice);
          const manifest =
            await import("../../apps/server/src/runtime-manifest.js");
          const originalHash = manifest.runtimeHash;
          vi.spyOn(manifest, "runtimeHash").mockImplementation(
            async (path, signal) => {
              const actual = await originalHash(path, signal);
              if (path === target && !changed) {
                changed = true;
                await writeFile(
                  target,
                  "Real bytes changed after the reviewed hash",
                );
              }
              return actual;
            },
          );
        }),
      )
      .rejects.toThrow("Runtime input hash mismatch");
    expect(changed).toBe(true);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
function launch(
  root: string,
  bundle: string,
  entry = join(bundle, "launcher.mjs"),
) {
  const child = spawn(
    join(bundle, "bin/node"),
    [entry, bundle, join(root, "data"), join(root, "projects")],
    { env: {}, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.push(child);
  const messages: {
    state?: string;
    code?: string;
    port?: number;
    session?: string;
  }[] = [];
  let pending = "";
  let error = "";
  let exit: number | null | undefined;
  child.stdout.on("data", (bytes: Buffer) => {
    pending += bytes.toString();
    for (;;) {
      const i = pending.indexOf("\n");
      if (i < 0) break;
      messages.push(JSON.parse(pending.slice(0, i)));
      pending = pending.slice(i + 1);
    }
  });
  child.stderr.on("data", (bytes: Buffer) => {
    error += bytes.toString();
  });
  child.once("exit", (code) => {
    exit = code;
  });
  return {
    child,
    messages,
    error: () => error,
    ready: async () => {
      const value = await eventually(() =>
        messages.find(
          (value) => value.state === "ready" || value.state === "blocked",
        ),
      );
      expect(value, error).toMatchObject({ state: "ready" });
      return `http://127.0.0.1:${value.port}/native/${value.session}/api`;
    },
    stop: async () => {
      child.stdin.write('{"type":"shutdown"}\n');
      await eventually(() =>
        messages.find((value) => value.state === "closed"),
      );
      expect(await eventually(() => exit)).toBe(0);
    },
  };
}
describe("verified native filter admission", { concurrent: false }, () => {
  let root: string;
  let selection: string;
  let output: string;
  let fullNames: Set<string | undefined>;
  // Independent inventory of the actual source graphs, including existing
  // admission requirements. Each omission is tested alone, not as a group.
  const filters = [
    "pad",
    "crop",
    "setsar", // output profiles, proxies and motion normalization
    "select",
    "signalstats",
    "metadata", // Visual QA, scene and PNG extraction
    "asetnsamples",
    "astats",
    "ametadata",
    "loudnorm", // decoded audio evidence
    "zoompan", // explicitly selected local motion fixture
    "zscale",
    "tonemap", // native HDR preview/thumbnail/render conversion
    "color",
    "rotate",
    "tpad",
    "colorchannelmixer",
    "perspective", // composition
    "split",
    "alphaextract",
    "blend",
    "alphamerge", // PhotoDepth foreground matte
    "atempo",
    "adelay",
    "alimiter",
    "anullsrc", // timeline audio and silence
    "scale",
    "overlay",
    "concat",
    "volume",
    "amix",
    "aresample",
    "trim",
    "atrim",
    "fade",
    "afade",
    "format",
    "aformat",
    "apad",
    "setpts",
    "asetpts",
    "fps",
    "xfade",
  ];

  // Stage once, but keep every fault injection a separate serial test. A single
  // wall-clock budget for 43 independent launches obscures the failing filter
  // and expires on slower CI even when every individual contract is satisfied.
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "openfilm-native-filters-"));
    selection = join(root, "omitted-filter.txt");
    await writeFile(selection, "");
    const ffmpeg = join(root, "reduced-ffmpeg");
    // This executable is staged and hash-verified exactly like a real input.
    // It delegates version/encoder probes to FFmpeg, changing only its filter
    // advertisement under trusted test control outside the runtime bundle.
    await writeFile(
      ffmpeg,
      `#!${await realpath(process.execPath)}
    (async () => {
      const {spawnSync} = await import('node:child_process');
      const {readFileSync} = await import('node:fs');
      const args = process.argv.slice(2);
      const result = spawnSync('/usr/bin/ffmpeg', args, {encoding:'utf8', maxBuffer:2097152});
      if (result.error) throw result.error;
      let stdout = result.stdout;
      if (args.includes('-filters')) {
        const missing = readFileSync(${JSON.stringify(selection)}, 'utf8');
        stdout = stdout.split('\\n').filter(line => line.trim().split(/\\s+/u)[1] !== missing).join('\\n');
      }
      process.stdout.write(stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.status ?? 1;
    })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      { mode: 0o755 },
    );
    ({ output } = await bundle(root, ffmpeg));
    const full = (
      await runProcess("/usr/bin/ffmpeg", ["-hide_banner", "-filters"])
    ).stdout.toString();
    fullNames = new Set(
      full.split("\n").map((line) => line.trim().split(/\s+/u)[1]),
    );
  });
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("admits the complete advertised runtime and closes its owned service", async () => {
    await writeFile(selection, "");
    const control = launch(join(root, "control"), output);
    await control.ready();
    await control.stop();
  });
  it.each(filters)(
    "rejects a verified runtime missing %s before starting a service",
    async (filter) => {
      expect(fullNames.has(filter), `Full FFmpeg lacks ${filter}`).toBe(true);
      await writeFile(selection, filter);
      const advertised = (
        await runProcess(join(output, "bin/ffmpeg"), [
          "-hide_banner",
          "-filters",
        ])
      ).stdout.toString();
      expect(
        advertised
          .split("\n")
          .some((line) => line.trim().split(/\s+/u)[1] === filter),
      ).toBe(false);
      const reduced = launch(join(root, `missing-${filter}`), output);
      expect(
        await eventually(() =>
          reduced.messages.find(
            (value) => value.state === "ready" || value.state === "blocked",
          ),
        ),
        `A runtime without ${filter} must not be admitted`,
      ).toMatchObject({ state: "blocked", code: "runtime.codecs" });
      expect(reduced.messages.some((value) => value.state === "ready")).toBe(
        false,
      );
      await reduced.stop();
    },
  );
});
it("closes a genuine service spawn error and can launch a fresh owner afterward", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-native-spawn-error-"));
  roots.push(root);
  const { output } = await bundle(root);
  const entry = join(root, "spawn-error-launcher.mjs");
  await build({
    stdin: {
      contents: `import {runNativeLauncher} from ${JSON.stringify(resolve("apps/server/src/native-launcher.ts"))};
        import {rm} from 'node:fs/promises';
        await runNativeLauncher(...process.argv.slice(2), {beforeSpawn: async () => {
          await rm(process.argv[3], {recursive:true, force:true});
        }});`,
      resolveDir: resolve("."),
      sourcefile: "trusted-spawn-error-harness.ts",
    },
    outfile: entry,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["@resvg/resvg-js", "fontkit", "koffi"],
  });
  // Removing cwd after the verified preflight produces a real ENOENT spawn
  // error, with no service PID or exit event; no production verifier is mocked.
  const failed = launch(join(root, "failed"), output, entry);
  expect(
    await eventually(
      () => failed.messages.find((value) => value.state === "blocked"),
      5000,
    ),
  ).toMatchObject({ state: "blocked", code: "runtime.serviceExited" });
  failed.child.stdin.write('{"type":"shutdown"}\n');
  await eventually(
    () => failed.messages.find((value) => value.state === "closed"),
    3000,
  );
  expect(await eventually(() => failed.child.exitCode ?? undefined, 3000)).toBe(
    0,
  );
  const recovered = launch(join(root, "recovered"), output);
  await recovered.ready();
  await recovered.stop();
}, 30000);
it("reports a real failed close, reaps its service and exits the owner for fresh startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-native-close-failed-"));
  roots.push(root);
  const entry = join(root, "close-failed-service.ts");
  const exitedMarker = join(root, "failed-service-exited.json");
  await writeFile(
    entry,
    `
    import {startServer} from ${JSON.stringify(resolve("apps/server/src/server.ts"))};
    import {registerOwnedProcessControl} from ${JSON.stringify(resolve("apps/server/src/owned-process-control.ts"))};
    import {writeFileSync} from 'node:fs';
    process.once('exit', code => writeFileSync(${JSON.stringify(exitedMarker)}, JSON.stringify({code})));
    const startup = startServer({port:0, nativeSession:process.env.OPENFILM_NATIVE_SESSION,
      userDataDirectory:process.env.OPENFILM_USER_DATA_DIRECTORY});
    registerOwnedProcessControl(startup.then(runtime => ({close:async () => {
      await runtime.close(); throw new Error('Synthetic post-close failure');
    }})));
    const runtime = await startup;
    console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:runtime.port}));
  `,
  );
  const failedBundle = await bundle(
    join(root, "failing-runtime"),
    undefined,
    entry,
  );
  const failed = launch(join(root, "failed"), failedBundle.output);
  const prefix = await failed.ready();
  failed.child.stdin.write('{"type":"shutdown"}\n');
  await eventually(() =>
    failed.messages.find((value) => value.code === "runtime.closeFailed"),
  );
  await eventually(() => (existsSync(exitedMarker) ? true : undefined));
  expect(JSON.parse(await readFile(exitedMarker, "utf8"))).toEqual({ code: 1 });
  // The real owned process control sends close-failed, disconnects and exits1.
  // Keep that failure visible and exit the launcher nonzero after reaping it.
  await expect(fetch(prefix + "/workspace")).rejects.toThrow();
  expect(await eventually(() => failed.child.exitCode ?? undefined, 3000)).toBe(
    1,
  );
  expect(failed.messages.some((value) => value.state === "closed")).toBe(false);
  const { output } = await bundle(join(root, "fresh-runtime"));
  const recovered = launch(join(root, "recovered"), output);
  await recovered.ready();
  await recovered.stop();
}, 30000);
it("starts a relocated verified runtime, edits/renders/reopens synthetic media and closes only its own service", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-native-runtime-"));
  roots.push(root);
  const { output, manifest } = await bundle(root);
  // Pause after the storage probe, then close the owner before spawning.
  // The harness is trusted test code outside the verified runtime bundle.
  const harness = join(root, "cancel-launcher.mjs");
  const release = join(root, "release-startup");
  await build({
    stdin: {
      contents: `import {runNativeLauncher} from ${JSON.stringify(resolve("apps/server/src/native-launcher.ts"))};
        import {access} from 'node:fs/promises';
        await runNativeLauncher(...process.argv.slice(2), {beforeSpawn: async () => {
          console.log(JSON.stringify({state:'paused'}));
          for (;;) { try { await access(${JSON.stringify(release)}); break; }
            catch { await new Promise(done => setTimeout(done, 10)); } }
        }});`,
      resolveDir: resolve("."),
      sourcefile: "trusted-cancel-harness.ts",
    },
    outfile: harness,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["@resvg/resvg-js", "fontkit", "koffi"],
  });
  const cancelled = launch(join(root, "cancelled"), output, harness);
  await eventually(() =>
    cancelled.messages.find((value) => value.state === "paused"),
  );
  cancelled.child.stdin.write('{"type":"shutdown"}\n');
  await eventually(() =>
    cancelled.messages.find((value) => value.state === "closed"),
  );
  const cancelledExit = new Promise<number | null>((done) =>
    cancelled.child.once("exit", done),
  );
  await writeFile(release, "release");
  expect(await cancelledExit).toBe(0);
  expect(cancelled.messages.map((value) => value.state)).toEqual([
    "paused",
    "closed",
  ]);
  expect(manifest.files.some((file) => file.path === "sbom.spdx.json")).toBe(
    true,
  );
  expect(
    (await verifyRuntimeBundle(output)).components.some(
      (component) => component.id === "fontkit",
    ),
  ).toBe(true);
  const source = join(root, "合成 image.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=160x90",
    "-frames:v",
    "1",
    "-threads",
    "1",
    source,
  ]);
  const audio = join(root, "synthetic.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    audio,
  ]);
  const before = [await hashFile(source), await hashFile(audio)];
  const directory = join(root, "影片 project.openfilm");
  const app = await OpenFilmApplication.create(
    directory,
    "Synthetic native fixture",
  );
  app.project.settings = { width: 160, height: 90, frameRate: 10 };
  const photo = await inspectMedia({
    name: "Synthetic image",
    path: source,
    uri: pathToFileURL(source).href,
  });
  const sound = await inspectMedia({
    name: "Synthetic audio",
    path: audio,
    uri: pathToFileURL(audio).href,
  });
  app.catalog.upsertAsset(photo);
  app.catalog.upsertAsset(sound);
  app.project.stories = [
    {
      id: "story",
      title: "Original",
      beats: [{ id: "beat", title: "Synthetic", selectedAssetIds: [photo.id] }],
    },
  ];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 2,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "photo",
              assetId: photo.id,
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 2,
              title: "合成字幕",
            },
          ],
        },
        {
          id: "audio",
          type: "audio",
          clips: [
            {
              id: "sound",
              assetId: sound.id,
              timelineStart: 0,
              timelineDuration: 2,
              sourceIn: 0,
              sourceOut: 2,
            },
          ],
        },
      ],
    },
  ];
  app.close({ requireSave: true });
  await chmod(output, 0o555);
  readOnlyDirectories.push(output);
  const readOnlyRoot = join(root, "read-only-account");
  await mkdir(join(readOnlyRoot, "data"), { recursive: true });
  await chmod(join(readOnlyRoot, "data"), 0o555);
  readOnlyDirectories.push(join(readOnlyRoot, "data"));
  const blocked = launch(readOnlyRoot, output);
  const diagnostic = await eventually(() =>
    blocked.messages.find((message) => message.state === "blocked"),
  );
  expect(diagnostic).toMatchObject({
    state: "blocked",
    code: "runtime.storage",
  });
  await blocked.stop();
  const first = launch(root, output);
  const prefix = await first.ready();
  const second = launch(join(root, "second"), output);
  const other = await second.ready();
  expect(other).not.toBe(prefix);
  const send = (path: string, body: unknown, method = "POST") =>
    fetch(prefix + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await send("/project/open", { path: directory })).status).toBe(200);
  expect(
    (await send("/stories/story", { title: "Edited 合成" }, "PATCH")).status,
  ).toBe(200);
  const rendered = await send("/render", { compositionId: "film" });
  expect(await rendered.json()).not.toHaveProperty("error");
  expect(rendered.status).toBe(200);
  const video = join(directory, "cache/preview.mp4");
  const receipt = JSON.parse(
    await readFile(`${video}.manifest.json`, "utf8"),
  ) as {
    sources: { assetId: string; sha256: string }[];
    outputSha256: string;
    fonts: { sha256: string }[];
    warnings: string[];
  };
  expect(
    receipt.sources.find((item) => item.assetId === photo.id)?.sha256,
  ).toBe(before[0]);
  expect(
    receipt.sources.find((item) => item.assetId === sound.id)?.sha256,
  ).toBe(before[1]);
  expect(receipt.outputSha256).toBe(await hashFile(video));
  expect(
    receipt.fonts.every(
      (font) =>
        font.sha256 ===
        manifest.files.find((file) => file.path === manifest.entries.font)
          ?.sha256,
    ),
  ).toBe(true);
  expect(receipt.fonts.length).toBeGreaterThan(0);
  expect(
    receipt.warnings.every((warning) => !warning.includes("missing")),
  ).toBe(true);

  const probe = JSON.parse(
    (
      await runProcess("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        video,
      ])
    ).stdout.toString(),
  );
  expect(
    probe.streams.find((s: { codec_type: string }) => s.codec_type === "video"),
  ).toMatchObject({ width: 160, height: 90, nb_read_frames: "20" });
  expect(
    probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
  ).toBe(true);
  const decoded = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-map",
    "0:v:0",
    "-f",
    "framemd5",
    "-",
  ]);
  expect(
    decoded.stdout
      .toString()
      .split("\n")
      .filter((line) => line && !line.startsWith("#")),
  ).toHaveLength(20);
  if (process.env.OPENFILM_NATIVE_QA_OUTPUT) {
    const evidence = resolve(process.env.OPENFILM_NATIVE_QA_OUTPUT);
    await mkdir(evidence, { recursive: true });
    await copyFile(video, join(evidence, "synthetic-native.mp4"));
    await writeFile(
      join(evidence, "evidence.json"),
      JSON.stringify(
        {
          kind: "synthetic-native-runtime",
          video: {
            width: 160,
            height: 90,
            frameRate: 10,
            decodedFrames: 20,
            duration: Number(probe.format.duration),
          },
          audio: probe.streams
            .filter(
              (stream: { codec_type: string }) => stream.codec_type === "audio",
            )
            .map(
              (stream: {
                codec_name: string;
                sample_rate: string;
                channels: number;
              }) => ({
                codec: stream.codec_name,
                sampleRate: stream.sample_rate,
                channels: stream.channels,
              }),
            ),
          sourceSha256: before,
          outputSha256: receipt.outputSha256,
          fontSha256: receipt.fonts.map((font) => font.sha256),
          warnings: receipt.warnings,
          runtimeManifestSha256: await runtimeHash(
            join(output, "runtime-manifest.json"),
          ),
          installerQA: "not-run",
          distributionLicenseReceipts: "synthetic-test-only",
        },
        null,
        2,
      ) + "\n",
    );
  }
  await first.stop();
  await expect(fetch(prefix + "/workspace")).rejects.toThrow();
  expect((await fetch(other + "/workspace")).status).toBe(200);
  await second.stop();
  const reopened = launch(root, output);
  const fresh = await reopened.ready();
  expect(
    (
      await fetch(fresh + "/project/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: directory }),
      })
    ).status,
  ).toBe(200);
  expect(
    JSON.parse(await readFile(join(directory, "project.json"), "utf8"))
      .stories[0].title,
  ).toBe("Edited 合成");
  await reopened.stop();
  const crash = launch(root, output);
  const crashPrefix = await crash.ready();
  crash.child.stdin.end();
  await eventually(() =>
    crash.messages.find((value) => value.state === "closed"),
  );
  await eventually(() => (crash.child.exitCode === 0 ? true : undefined));
  await expect(fetch(crashPrefix + "/workspace")).rejects.toThrow();
  expect([await hashFile(source), await hashFile(audio)]).toEqual(before);
}, 60000);
