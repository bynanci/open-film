import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const children: ChildProcess[] = [];
type Message = {
  type?: string;
  requestId?: string;
  runtime?: unknown;
  message?: string;
};
async function waitFor<T>(read: () => T | undefined): Promise<T> {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await delay(10);
  }
  throw new Error("Owned service test condition did not arrive before timeout");
}
async function project() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-owned-control-"));
  roots.push(root);
  const directory = join(root, "film.openfilm");
  const application = await OpenFilmApplication.create(
    directory,
    "Owned service",
    {},
    {
      userDataDirectory: join(root, "user-data"),
    },
  );
  application.close();
  return {
    root,
    directory,
    original: await readFile(join(directory, "project.json"), "utf8"),
  };
}
function child(
  entry: string,
  root: string,
  directory: string,
  enabled = true,
  ipc = true,
) {
  const process = spawn(
    globalThis.process.execPath,
    ["--import", "tsx", entry],
    {
      cwd: resolve("."),
      env: {
        ...globalThis.process.env,
        OPENFILM_PORT: "0",
        OPENFILM_PROJECT: directory,
        OPENFILM_USER_DATA_DIR: join(root, "user-data"),
        OPENFILM_PROJECTS_DIR: join(root, "projects"),
        OPENFILM_BENCHMARK_SERVICE_CONTROL: enabled ? "1" : "0",
      },
      stdio: ipc
        ? ["ignore", "pipe", "pipe", "ipc"]
        : ["ignore", "pipe", "pipe"],
    },
  );
  children.push(process);
  const messages: Message[] = [];
  const stdout: string[] = [];
  let stderr = "";
  let text = "";
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  process.on("message", (message) => messages.push(message as Message));
  process.stdout!.on("data", (chunk) => {
    text += String(chunk);
    const lines = text.split("\n");
    text = lines.pop()!;
    stdout.push(...lines);
  });
  process.stderr!.on("data", (chunk) => {
    stderr += String(chunk);
  });
  process.on("exit", (code, signal) => {
    exit = { code, signal };
  });
  const message = (type: string) =>
    waitFor(() => {
      const found = messages.find((item) => item.type === type);
      if (!found && exit)
        throw new Error(`Owned service exited before ${type}: ${stderr}`);
      return found;
    });
  const ready = () =>
    waitFor(() => {
      for (const line of stdout) {
        try {
          const event = JSON.parse(line) as { event: string; port: number };
          if (event.event === "server.ready") return event;
        } catch {
          /* Readiness is structured output only. */
        }
      }
      if (exit)
        throw new Error(`Owned service exited before readiness: ${stderr}`);
      return undefined;
    });
  const send = (value: unknown) =>
    new Promise<void>((done, reject) => {
      process.send!(value as never, (error) =>
        error ? reject(error) : done(),
      );
    });
  return {
    process,
    messages,
    message,
    ready,
    send,
    exited: () => waitFor(() => exit),
    stderr: () => stderr,
  };
}
afterEach(async () => {
  for (const process of children.splice(0)) {
    if (process.exitCode === null && process.signalCode === null) {
      process.kill("SIGTERM");
      await delay(100);
      if (process.exitCode === null && process.signalCode === null)
        process.kill("SIGKILL");
      await waitFor(() =>
        process.exitCode !== null || process.signalCode !== null
          ? true
          : undefined,
      );
    }
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("private owned-service graceful control", () => {
  it("acknowledges only after real application persistence and exits normally", async () => {
    const f = await project();
    const service = child(
      resolve("apps/server/src/index.ts"),
      f.root,
      f.directory,
    );
    const control = await service.message("openfilm.benchmark.control-ready");
    expect(control.runtime).toEqual({
      version: process.version,
      executable: process.execPath,
    });
    const ready = await service.ready();
    const requestId = randomUUID();
    await service.send({ type: "openfilm.benchmark.shutdown", requestId });
    const ack = await service.message("openfilm.benchmark.closed");
    expect(ack.requestId).toBe(requestId);
    expect(
      JSON.parse(await readFile(join(f.directory, "project.json"), "utf8"))
        .updatedAt,
    ).not.toBe(JSON.parse(f.original).updatedAt);
    expect(await service.exited()).toEqual({ code: 0, signal: null });
    await expect(
      fetch(`http://127.0.0.1:${ready.port}/api/health`),
    ).rejects.toThrow();
  });

  it("retains a pre-ready request and closes exactly once for duplicate IDs", async () => {
    const f = await project();
    const entry = join(f.root, "delayed-service.mts");
    const started = join(f.root, "startup-began");
    await writeFile(
      entry,
      `import {startServer} from ${JSON.stringify(pathToFileURL(resolve("apps/server/src/server.ts")).href)};
import {registerOwnedProcessControl} from ${JSON.stringify(pathToFileURL(resolve("apps/server/src/owned-process-control.ts")).href)};
import {setTimeout as delay} from 'node:timers/promises';
import {writeFile} from 'node:fs/promises';
const startup=(async()=>{await delay(500);await writeFile(${JSON.stringify(started)},'started');return startServer({port:0,project:process.env.OPENFILM_PROJECT})})();
registerOwnedProcessControl(startup);
await startup;`,
    );
    const service = child(entry, f.root, f.directory);
    await service.message("openfilm.benchmark.control-ready");
    await expect(stat(started)).rejects.toMatchObject({ code: "ENOENT" });
    const requestId = randomUUID();
    await service.send({ type: "openfilm.benchmark.shutdown", requestId });
    await service.send({ type: "openfilm.benchmark.shutdown", requestId });
    expect((await service.message("openfilm.benchmark.closed")).requestId).toBe(
      requestId,
    );
    expect(await service.exited()).toEqual({ code: 0, signal: null });
    expect(
      service.messages.filter(
        (item) => item.type === "openfilm.benchmark.closed",
      ),
    ).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(f.directory, "project.json"), "utf8"))
        .updatedAt,
    ).not.toBe(JSON.parse(f.original).updatedAt);
  });

  it("reports a real application save failure without a success acknowledgement", async () => {
    const f = await project();
    const service = child(
      resolve("apps/server/src/index.ts"),
      f.root,
      f.directory,
    );
    await service.message("openfilm.benchmark.control-ready");
    await service.ready();
    await rename(
      join(f.directory, "project.json"),
      join(f.directory, "project.json.saved"),
    );
    await mkdir(join(f.directory, "project.json"));
    const requestId = randomUUID();
    await service.send({ type: "openfilm.benchmark.shutdown", requestId });
    const failure = await service.message("openfilm.benchmark.close-failed");
    expect(failure.requestId).toBe(requestId);
    expect(failure.message).toBeTruthy();
    expect(await service.exited()).toEqual({ code: 1, signal: null });
    expect(
      service.messages.some(
        (item) => item.type === "openfilm.benchmark.closed",
      ),
    ).toBe(false);
    expect(service.stderr()).toContain("server.shutdown.failed");
  });

  it("requires opt-in and leaves ordinary IPC servers running", async () => {
    const f = await project();
    const service = child(
      resolve("apps/server/src/index.ts"),
      f.root,
      f.directory,
      false,
    );
    const ready = await service.ready();
    await service.send({
      type: "openfilm.benchmark.shutdown",
      requestId: randomUUID(),
    });
    await delay(100);
    expect(service.messages).toEqual([]);
    expect(
      (await fetch(`http://127.0.0.1:${ready.port}/api/health`)).status,
    ).toBe(200);
  });

  it("does not close user state merely because the parent IPC channel disconnects", async () => {
    const f = await project();
    const service = child(
      resolve("apps/server/src/index.ts"),
      f.root,
      f.directory,
    );
    await service.message("openfilm.benchmark.control-ready");
    const ready = await service.ready();
    service.process.disconnect();
    await delay(100);
    expect(
      (await fetch(`http://127.0.0.1:${ready.port}/api/health`)).status,
    ).toBe(200);
    expect(await readFile(join(f.directory, "project.json"), "utf8")).toBe(
      f.original,
    );
  });

  it("rejects malformed IDs and has no public HTTP shutdown endpoint", async () => {
    const f = await project();
    const service = child(
      resolve("apps/server/src/index.ts"),
      f.root,
      f.directory,
    );
    await service.message("openfilm.benchmark.control-ready");
    const ready = await service.ready();
    await service.send({
      type: "openfilm.benchmark.shutdown",
      requestId: "invalid",
    });
    await delay(50);
    expect(
      service.messages.some(
        (item) => item.type === "openfilm.benchmark.closed",
      ),
    ).toBe(false);
    const base = `http://127.0.0.1:${ready.port}`;
    expect(
      (await fetch(`${base}/api/benchmark/shutdown`, { method: "POST" }))
        .status,
    ).toBe(404);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    await service.send({
      type: "openfilm.benchmark.shutdown",
      requestId: randomUUID(),
    });
    await service.message("openfilm.benchmark.closed");
    expect(await service.exited()).toEqual({ code: 0, signal: null });
  });

  it("keeps the control disabled without a Node IPC channel", async () => {
    const f = await project();
    const service = child(
      resolve("apps/server/src/index.ts"),
      f.root,
      f.directory,
      true,
      false,
    );
    const ready = await service.ready();
    expect(service.process.channel).toBeUndefined();
    expect(
      (await fetch(`http://127.0.0.1:${ready.port}/api/health`)).status,
    ).toBe(200);
  });
});
