import { build } from "esbuild";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { get, request, type IncomingMessage } from "node:http";
import { mkdir, mkdtemp, open, readFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";

function bounded<T>(
  promise: Promise<T>,
  message: string,
  ms = 3000,
): Promise<T> {
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
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
}
it.each(["backpressured", "awaiting-stat"] as const)(
  "acknowledges owned shutdown with a %s native range read while preserving an acquired write",
  async (phase) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-native-stream-close-"));
    const directory = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(directory, "Before shutdown");
    app.project.stories.push({
      id: "story",
      title: "Before shutdown",
      beats: [],
    });
    await app.save();
    app.close();
    await mkdir(join(directory, "cache"), { recursive: true });
    const file = await open(join(directory, "cache/preview.mp4"), "w");
    await file.truncate(128 * 1024 * 1024);
    await file.close();
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const entry = join(root, "service.mjs");
    const session = "d".repeat(64);
    await build({
      stdin: {
        contents: `import { startServer } from ${JSON.stringify(resolve("apps/server/src/server.ts"))};
        import { registerOwnedProcessControl } from ${JSON.stringify(resolve("apps/server/src/owned-process-control.ts"))};
        const startup = startServer({port:0, project:process.argv[2], nativeSession:process.argv[3], userDataDirectory:process.argv[4]});
        registerOwnedProcessControl(startup.then(runtime => ({close:async () => {
          const closing = runtime.close(); process.send({type:'test.close-started'}); await closing;
        }})));
        const runtime = await startup;
        runtime.server.on('request', request => { if (request.headers['x-test-write']) process.send({type:'test.write-started'}); });
        process.send({type:'test.ready', port:runtime.port});`,
        resolveDir: resolve("."),
        sourcefile: "native-stream-owner-fixture.ts",
      },
      outfile: entry,
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      external: ["@resvg/resvg-js", "fontkit"],
      plugins:
        phase === "awaiting-stat"
          ? [
              {
                name: "pause-preview-stat",
                setup(bundler) {
                  bundler.onResolve({ filter: /^node:fs\/promises$/ }, () => ({
                    path: "stat-boundary",
                    namespace: "fixture",
                  }));
                  bundler.onLoad(
                    { filter: /.*/, namespace: "fixture" },
                    () => ({
                      contents: `
          export * from 'fs/promises';
          import {stat as originalStat} from 'fs/promises';
          export async function stat(path, ...options) {
            if (path === process.argv[2] + '/cache/preview.mp4') {
              process.send({type:'test.stat-paused'});
              await new Promise(resolve => { const release = message => {
                if(message.type === 'test.release-stat') {process.off('message', release);resolve();}
              };process.on('message',release); });
            }
            return originalStat(path, ...options);
          }`,
                      loader: "js",
                    }),
                  );
                },
              },
            ]
          : [],
    });
    const child = spawn(
      process.execPath,
      [entry, directory, session, join(root, "data")],
      {
        env: { ...process.env, OPENFILM_NATIVE_SERVICE_CONTROL: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    const exited = once(child, "exit");
    const messages: Array<{ type: string; port?: number; requestId?: string }> =
      [];
    child.on("message", (message) =>
      messages.push(message as (typeof messages)[number]),
    );
    let stderr = "";
    child.stderr!.on("data", (bytes) => {
      stderr += String(bytes);
    });
    function message(type: string) {
      const old = messages.find((item) => item.type === type);
      if (old) return Promise.resolve(old);
      return bounded(
        new Promise<(typeof messages)[number]>((accept) => {
          const handler = (value: unknown) => {
            if ((value as { type?: string }).type === type) {
              child.off("message", handler);
              accept(value as (typeof messages)[number]);
            }
          };
          child.on("message", handler);
        }),
        `Missing ${type}: ${stderr}`,
      );
    }
    let paused: IncomingMessage | undefined;
    let stream: ReturnType<typeof get> | undefined;
    let write: ReturnType<typeof request> | undefined;
    try {
      const ready = await message("test.ready");
      await message("openfilm.benchmark.control-ready");
      const base = `http://127.0.0.1:${ready.port}/native/${session}/api`;
      const opened = new Promise<IncomingMessage | undefined>((accept) => {
        stream = get(
          `${base}/preview`,
          { agent: false, headers: { range: "bytes=0-" } },
          (response) => {
            response.pause();
            response.on("error", () => {});
            accept(response);
          },
        ).on("error", () => accept(undefined));
      });
      if (phase === "backpressured") {
        paused = await opened;
        expect(paused?.statusCode).toBe(206);
        expect(paused?.complete).toBe(false);
      } else await message("test.stat-paused");
      const body = JSON.stringify({
        title: "Saved during acknowledged shutdown",
      });
      const written = new Promise<number>((accept, reject) => {
        write = request(
          `${base}/stories/story`,
          {
            method: "PATCH",
            agent: false,
            headers: {
              "Content-Type": "application/json",
              "x-test-write": "1",
            },
          },
          (response) => {
            response.resume();
            response.on("end", () => accept(response.statusCode!));
          },
        );
        write.on("error", reject);
        write.write(body.slice(0, 12));
      });
      await message("test.write-started");
      const requestId = randomUUID();
      child.send({ type: "openfilm.benchmark.shutdown", requestId });
      await message("test.close-started");
      if (phase === "awaiting-stat") child.send({ type: "test.release-stat" });
      write!.end(body.slice(12));
      expect(
        await bounded(written, "Shutdown interrupted an acquired write"),
      ).toBe(200);
      const acknowledgement = await message("openfilm.benchmark.closed");
      expect(acknowledgement.requestId).toBe(requestId);
      if (phase === "awaiting-stat") expect(await opened).toBeUndefined();
      expect((await bounded(exited, "Owned service stayed alive"))[0]).toBe(0);
      const saved = JSON.parse(
        await readFile(join(directory, "project.json"), "utf8"),
      );
      expect(saved.stories[0].title).toBe("Saved during acknowledged shutdown");
    } finally {
      paused?.destroy();
      stream?.destroy();
      write?.destroy();
      if (child.exitCode === null) {
        child.disconnect();
        await bounded(exited, "Cleanup close timeout").catch(() => {
          child.kill("SIGTERM");
        });
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
