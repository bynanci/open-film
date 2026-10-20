// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { spawn, execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  runtimePath,
  verifyRuntimeBundle,
  type RuntimeManifest,
} from "./runtime-manifest.js";
const execute = promisify(execFile);
export function runtimeEnvironment(
  root: string,
  dataDirectory: string,
  projectsDirectory: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    PATH: join(root, "bin"),
    OPENFILM_PORT: "0",
    OPENFILM_USER_DATA_DIRECTORY: dataDirectory,
    OPENFILM_PROJECTS_DIR: projectsDirectory,
    OPENFILM_NATIVE_SERVICE_CONTROL: "1",
  };
}
export async function preflightRuntime(
  root: string,
  signal?: AbortSignal,
): Promise<RuntimeManifest> {
  const manifest = await verifyRuntimeBundle(root, { signal });
  const runningNode = await realpath(process.execPath);
  const bundledNode = await realpath(runtimePath(root, manifest.entries.node));
  const identity = (path: string) =>
    process.platform === "win32" ? path.toLowerCase() : path;
  if (
    process.versions.node !== manifest.nodeVersion ||
    identity(runningNode) !== identity(bundledNode)
  )
    throw new Error("runtime.node");
  const env = runtimeEnvironment(root, root, root);
  const run = (entry: "ffmpeg" | "ffprobe", args: string[]) =>
    execute(runtimePath(root, manifest.entries[entry]), args, {
      env,
      windowsHide: true,
      signal,
      timeout: 15000,
      maxBuffer: 2 * 1024 ** 2,
    });
  for (const entry of ["ffmpeg", "ffprobe"] as const) {
    const version = await run(entry, ["-version"]);
    const component = manifest.components.find(
      (component) => component.id === entry,
    );
    if (
      !component ||
      !version.stdout.split("\n")[0]?.includes(component.version)
    )
      throw new Error("runtime.version");
    if (
      /--enable-version3/u.test(version.stdout + version.stderr) &&
      /--enable-gpl/u.test(version.stdout + version.stderr) &&
      !/^GPL-3/u.test(component.license)
    )
      throw new Error("runtime.license");
    if (/--enable-nonfree/u.test(version.stdout + version.stderr))
      throw new Error("runtime.license");
    if (
      /--enable-gpl/u.test(version.stdout + version.stderr) &&
      !/^GPL-/u.test(component.license)
    )
      throw new Error("runtime.license");
  }
  const { stdout: encoders } = await run("ffmpeg", [
    "-hide_banner",
    "-encoders",
  ]);
  if (!/\blibx264\b/u.test(encoders) || !/\baac\b/u.test(encoders))
    throw new Error("runtime.codecs");
  const { stdout: filters } = await run("ffmpeg", ["-hide_banner", "-filters"]);
  const filterNames = new Set(
    filters.split("\n").map((line) => line.trim().split(/\s+/u)[1]),
  );
  if (
    [
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
      // Output profiles, proxy normalization and timeline composition.
      "pad",
      "crop",
      "setsar",
      "color",
      "rotate",
      "tpad",
      "colorchannelmixer",
      "perspective",
      // PhotoDepth foreground mattes in render/graphic-scenes.ts.
      "split",
      "alphaextract",
      "blend",
      "alphamerge",
      // Audio timing/mixing and decoded Audio Quality evidence.
      "atempo",
      "adelay",
      "alimiter",
      "anullsrc",
      "asetnsamples",
      "astats",
      "ametadata",
      "loudnorm",
      // Scene detection, PNG delivery and Visual QA.
      "select",
      "signalstats",
      "metadata",
      // Explicit local motion fixture and HDR preview/render conversion.
      "zoompan",
      "zscale",
      "tonemap",
    ].some((filter) => !filterNames.has(filter))
  )
    throw new Error("runtime.codecs");
  const require = createRequire(runtimePath(root, manifest.entries.service));
  const fontkit = require("fontkit") as {
    openSync(
      path: string,
    ):
      | { hasGlyphForCodePoint(code: number): boolean }
      | { fonts: { hasGlyphForCodePoint(code: number): boolean }[] };
  };
  const font = fontkit.openSync(runtimePath(root, manifest.entries.font));
  const face = "fonts" in font ? font.fonts[0]! : font;
  if (!face.hasGlyphForCodePoint(0x4e2d)) throw new Error("runtime.font");
  const { Resvg } =
    require("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
  const image = new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text y="24">中</text></svg>',
    {
      font: {
        fontFiles: [runtimePath(root, manifest.entries.font)],
        loadSystemFonts: false,
      },
    },
  ).render();
  if (image.width !== 32 || image.asPng().length < 50)
    throw new Error("runtime.raster");
  return manifest;
}
export async function runNativeLauncher(
  root: string,
  dataDirectory: string,
  projectsDirectory: string,
  options: { beforeSpawn?: () => Promise<void> } = {},
): Promise<void> {
  root = resolve(root);
  dataDirectory = resolve(dataDirectory);
  projectsDirectory = resolve(projectsDirectory);
  const output = (value: object) =>
    process.stdout.write(`${JSON.stringify(value)}\n`);
  let closing = false;
  let closeOwned: (() => Promise<void>) | undefined;
  let startupCancelled = false;
  const startup = new AbortController();
  const lines = createInterface({ input: process.stdin });
  const stop = async () => {
    startupCancelled = true;
    startup.abort();
    if (closing) return;
    closing = true;
    try {
      if (closeOwned) await closeOwned();
      output({ state: "closed" });
      lines.close();
      process.stdin.destroy();
    } catch {
      closing = false;
      output({ state: "blocked", code: "runtime.closeFailed" });
    }
  };
  lines.on("line", (line) => {
    if (line.length > 256) return;
    try {
      const message: unknown = JSON.parse(line);
      if (JSON.stringify(message) === '{"type":"shutdown"}') void stop();
    } catch {
      /* Ignore invalid owner messages. */
    }
  });
  lines.on("close", () => {
    if (!closing) void stop();
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      void stop();
    });
  try {
    const manifest = await preflightRuntime(root, startup.signal);
    if (startupCancelled) return;
    try {
      await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
      const probe = join(dataDirectory, `.openfilm-runtime-${randomUUID()}`);
      const handle = await open(probe, "wx", 0o600);
      try {
        await handle.writeFile("storage-check");
        await handle.sync();
      } finally {
        await handle.close();
        await rm(probe, { force: true });
      }
    } catch {
      throw new Error("runtime.storage");
    }
    // Trusted host hook used to exercise cancellation during storage startup.
    await options.beforeSpawn?.();
    if (startupCancelled) return;
    // Projects are created only through the existing explicit application flow.
    const token = randomBytes(32).toString("hex");
    const env = runtimeEnvironment(root, dataDirectory, projectsDirectory);
    env.OPENFILM_NATIVE_SESSION = token;
    env.OPENFILM_TITLE_FONT = runtimePath(root, manifest.entries.font);
    const child = spawn(
      process.execPath,
      [runtimePath(root, manifest.entries.service)],
      {
        cwd: dataDirectory,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    child.stderr!.on("data", () => {
      /* Local diagnostics deliberately omit project paths and provider values. */
    });
    let expectedExit = false;
    let acknowledged = false;
    let closeFailedAcknowledged = false;
    let spawnFailed = false;
    const releaseFailedOwner = () => {
      process.exitCode = 1;
      closing = true;
      lines.close();
      process.stdin.destroy();
    };
    const exited = new Promise<number | null>((accept) => {
      child.once("exit", (code) => {
        if (closeFailedAcknowledged) releaseFailedOwner();
        else if (!expectedExit) {
          output({ state: "blocked", code: "runtime.serviceExited" });
          process.exitCode = 1;
          lines.close();
          process.stdin.destroy();
        }
        accept(code);
      });
      child.once("error", () => {
        if (child.pid === undefined) {
          spawnFailed = true;
          accept(null);
        }
      });
    });
    const wait = <T>(promise: Promise<T>, ms: number) =>
      new Promise<T>((accept, reject) => {
        const timer = setTimeout(
          () => reject(new Error("runtime.timeout")),
          ms,
        );
        promise.then(
          (value) => {
            clearTimeout(timer);
            accept(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    const closeService = async () => {
      expectedExit = true;
      if (spawnFailed) return;
      if (child.exitCode !== null || child.signalCode !== null) {
        if (child.exitCode !== 0 || !acknowledged)
          throw new Error("runtime.closeFailed");
        return;
      }
      const requestId = randomUUID();
      const ack = new Promise<void>((accept, reject) => {
        const handler = (message: unknown) => {
          const value = message as { type?: string; requestId?: string };
          if (value.requestId !== requestId) return;
          if (value.type === "openfilm.benchmark.closed") {
            acknowledged = true;
            child.off("message", handler);
            accept();
          }
          if (value.type === "openfilm.benchmark.close-failed") {
            closeFailedAcknowledged = true;
            child.off("message", handler);
            reject(new Error("runtime.closeFailed"));
          }
        };
        child.on("message", handler);
      });
      if (!child.connected) throw new Error("runtime.closeFailed");
      child.send({ type: "openfilm.benchmark.shutdown", requestId });
      try {
        await wait(ack, 30000);
      } catch (error) {
        if (closeFailedAcknowledged) {
          // Preserve the failed ACK and nonzero owner exit. Reap only after
          // the service really exits, then release the private owner channel
          // so the shell can recover in one explicit Retry.
          await wait(exited, 10000);
          releaseFailedOwner();
        }
        throw error;
      }
      const code = await wait(exited, 10000);
      if (code !== 0) throw new Error("runtime.closeFailed");
    };
    let closingService: Promise<void> | undefined;
    closeOwned = () => {
      closingService ??= closeService().catch((error: unknown) => {
        closingService = undefined;
        throw error;
      });
      return closingService;
    };
    const ready = new Promise<number>((accept, reject) => {
      let port: number | undefined;
      let control = false;
      const check = () => {
        if (port && control) accept(port);
      };
      child.on("message", (message: unknown) => {
        if (
          (message as { type?: string }).type ===
          "openfilm.benchmark.control-ready"
        ) {
          control = true;
          check();
        }
      });
      let pending = "";
      child.stdout!.on("data", (bytes: Buffer) => {
        pending += bytes.toString("utf8");
        if (pending.length > 16384) {
          reject(new Error("runtime.handshake"));
          pending = "";
          return;
        }
        for (;;) {
          const end = pending.indexOf("\n");
          if (end < 0) break;
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          try {
            const value = JSON.parse(line) as {
              event?: string;
              host?: string;
              port?: number;
            };
            if (
              value.event === "server.ready" &&
              value.host === "127.0.0.1" &&
              Number.isInteger(value.port) &&
              value.port! > 0 &&
              value.port! <= 65535
            ) {
              port = value.port;
              check();
            }
          } catch {
            /* Other bounded service output is not a handshake. */
          }
        }
      });
      child.once("exit", () => reject(new Error("runtime.serviceExited")));
      child.once("error", () => reject(new Error("runtime.serviceExited")));
    });
    const port = await wait(ready, 30000);
    const prefix = `http://127.0.0.1:${port}/native/${token}/api`;
    const response = await fetch(`${prefix}/workspace`, {
      signal: AbortSignal.any([startup.signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) throw new Error("runtime.handshake");
    await response.json();
    if (startupCancelled) {
      await stop();
      return;
    }
    output({
      state: "ready",
      port,
      session: token,
      warnings: ["runtime.optionalMetadata"],
    });
    // Keep the private owner channel alive until acknowledged close.
  } catch (error) {
    if (startupCancelled) return;
    const code =
      error instanceof Error && /^runtime\.[a-zA-Z]+$/u.test(error.message)
        ? error.message
        : "runtime.preflight";
    output({ state: "blocked", code });
    if (closeOwned) {
      try {
        await closeOwned();
      } catch {
        /* Retain the owner channel for a visible close failure. */
      }
    }
  }
}
