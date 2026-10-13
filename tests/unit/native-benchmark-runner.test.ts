import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  validateBenchmarkConfig,
  runNativeBenchmark,
  summarizeMemory,
  type BenchmarkConfig,
} from "../../scripts/native-benchmark/run";
import { getEventListeners } from "node:events";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createNativeBenchmarkFixture } from "../../scripts/native-benchmark/create-fixture";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessMemorySnapshot } from "../../scripts/native-benchmark/process-memory";

const faults = vi.hoisted(() => ({
  writeNames: new Set<string>(),
  writeFailures: [] as string[],
  afterSample: undefined as
    ((snapshot: ProcessMemorySnapshot) => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      if (typeof args[0] === "string") {
        const name = basename(args[0]);
        if (faults.writeNames.has(name)) {
          faults.writeFailures.push(name);
          return Promise.reject(
            Object.assign(new Error(`ENOSPC: cannot write ${name}`), {
              code: "ENOSPC",
            }),
          );
        }
      }
      return actual.writeFile(...args);
    },
  };
});

vi.mock(
  "../../scripts/native-benchmark/process-memory",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../scripts/native-benchmark/process-memory")
      >();
    return {
      ...actual,
      sampleProcessMemory: async (
        ...args: Parameters<typeof actual.sampleProcessMemory>
      ) => {
        const snapshot = await actual.sampleProcessMemory(...args);
        await faults.afterSample?.(snapshot);
        return snapshot;
      },
    };
  },
);

interface Owners {
  serverPid?: number;
  nativePid?: number;
}

function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function awaitExit(pid: number) {
  const deadline = Date.now() + 3000;
  while (alive(pid) && Date.now() < deadline) await delay(10);
  if (alive(pid)) throw new Error(`Test-owned process ${pid} did not exit`);
}

const config = {
  candidateSha: "a".repeat(40),
  label: "candidate",
  environmentKind: "cloud-smoke",
  executable: "/tmp/native",
  serverScript: "/tmp/server.mjs",
  fixtureManifest: "/tmp/fixture.json",
  outputDirectory: "/tmp/new-evidence",
  durationSeconds: 3600,
  intervalSeconds: 5,
  startupTimeoutSeconds: 60,
  cacheCondition: "warm OS cache; existing app profile",
  webviewVersion: "not-recorded",
  display: { width: 1440, height: 900, scale: 1 },
} as const;
describe("native benchmark launch contract", () => {
  it("runs twice from one immutable fixture while real application shutdown changes only each runtime copy", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-benchmark-real-close-"),
    );
    try {
      const fixture = await createNativeBenchmarkFixture(
        join(root, "fixture"),
        { assets: 2, clips: 2, beats: 1 },
      );
      const original = await readFile(
        join(fixture.projectPath, "project.json"),
        "utf8",
      );
      const service = join(root, "server.mjs");
      const emitter = join(root, "emitter.mjs");
      const tsxApi = pathToFileURL(
        resolve("node_modules/tsx/dist/esm/api/index.mjs"),
      ).href;
      const application = pathToFileURL(
        resolve("packages/application/src/index.ts"),
      ).href;
      await writeFile(
        service,
        `import{createServer}from'node:http';import{tsImport}from${JSON.stringify(tsxApi)};const{OpenFilmApplication}=await tsImport(${JSON.stringify(application)},import.meta.url);const app=await OpenFilmApplication.open(process.env.OPENFILM_PROJECT,{userDataDirectory:${JSON.stringify(join(root, "user-data"))}});const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>{app.close();s.close();});`,
      );
      await writeFile(
        emitter,
        `import{appendFileSync,readFileSync}from'node:fs';import{dirname,join}from'node:path';const emit=(kind,ms,extra={})=>appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind,nativeElapsedMs:ms,unixMs:Date.now(),clientElapsedMs:ms,clientTimeOriginMs:1000,...extra})+'\\n');emit('welcome-ready',10);emit('edit-enter',15);emit('edit-ready',20,{clipCount:2});const guard=setTimeout(()=>process.exit(2),15000);const poll=setInterval(()=>{try{const report=JSON.parse(readFileSync(join(dirname(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS),'report.json'),'utf8'));if(['completed','scenario-incomplete','failed','interrupted'].includes(report.status)){clearInterval(poll);clearTimeout(guard);setTimeout(()=>{},300);}}catch{}},10);`,
      );
      for (const label of ["warm-up", "retained"]) {
        const outputDirectory = join(root, label);
        const result = await runNativeBenchmark({
          ...config,
          label,
          executable: process.execPath,
          arguments: [emitter],
          serverScript: service,
          fixtureManifest: fixture.manifestPath,
          project: fixture.projectPath,
          outputDirectory,
          durationSeconds: 0.1,
          intervalSeconds: 0.1,
          startupTimeoutSeconds: 10,
        });
        expect(result.status).toBe("completed");
        const manifest = JSON.parse(
          await readFile(join(outputDirectory, "manifest.json"), "utf8"),
        );
        const lifecycle = JSON.parse(
          await readFile(join(outputDirectory, "lifecycle.json"), "utf8"),
        );
        expect(manifest.project).toEqual({
          template: fixture.projectPath,
          runtime: join(outputDirectory, "benchmark.openfilm"),
          strategy: "verified-isolated-copy",
        });
        expect(lifecycle.ownedServiceRemaining).toBe(false);
        expect(lifecycle.projectFinalFiles["project.json"]).not.toBe(
          manifest.identities.projectInitialFiles["project.json"],
        );
        expect(
          await readFile(join(fixture.projectPath, "project.json"), "utf8"),
        ).toBe(original);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("summarizes a dense long capture without exhausting the function argument stack", () => {
    const sample = {
      combined: {
        totals: {
          rssBytes: { value: 123 },
          privateBytes: { value: 100 },
          pssBytes: {},
        },
      },
    };
    const result = summarizeMemory(
      Array.from({ length: 150000 }, () => sample) as never,
    );
    expect(result.rssBytes?.peak).toBe(123);
    expect(result.rssBytes?.completeSamples).toBe(150000);
    expect(result.pssBytes?.incompleteSamples).toBe(150000);
  });
  it("requires explicit environment, full candidate identity and physical display metadata", () => {
    expect(validateBenchmarkConfig(config)).toEqual(config);
    expect(() =>
      validateBenchmarkConfig({ ...config, environmentKind: "browser" }),
    ).toThrow(/environment/);
    expect(() =>
      validateBenchmarkConfig({ ...config, candidateSha: "main" }),
    ).toThrow(/SHA/);
    expect(() =>
      validateBenchmarkConfig({
        ...config,
        display: { width: 0, height: 900, scale: 1 },
      }),
    ).toThrow(/display/);
  });
  it("rejects short intervals, traversal through shell commands and silent unknown settings", () => {
    expect(() =>
      validateBenchmarkConfig({ ...config, intervalSeconds: 0 }),
    ).toThrow(/interval/);
    expect(() =>
      validateBenchmarkConfig({ ...config, arguments: [12] }),
    ).toThrow(/arguments/);
    expect(() =>
      validateBenchmarkConfig({ ...config, remoteTelemetry: true }),
    ).toThrow(/Unknown/);
    expect(() =>
      validateBenchmarkConfig({
        ...config,
        durationSeconds: 1,
        intervalSeconds: 2,
      }),
    ).toThrow(/interval/);
  });
  it("runs real child process protocol, saves partial evidence, and rejects overwriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-benchmark-protocol-"));
    try {
      const service = join(root, "server.mjs");
      const emitter = join(root, "emitter.mjs");
      const { manifestPath: manifest } = await createNativeBenchmarkFixture(
        join(root, "fixture"),
        { assets: 2, clips: 2, beats: 1 },
      );
      await writeFile(
        service,
        `import {createServer} from 'node:http'; const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end('{"ok":true}');});s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close());`,
      );
      await writeFile(
        emitter,
        `import {appendFileSync,statSync} from 'node:fs';import{dirname,join}from'node:path'; const emit=(kind,ms,extra={})=>appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind,nativeElapsedMs:ms,unixMs:Date.now(),clientElapsedMs:ms,clientTimeOriginMs:1000,...extra})+'\\n'); emit('welcome-ready',10);emit('edit-enter',100);emit('edit-ready',125,{clipCount:2});const guard=setTimeout(()=>process.exit(2),15000);const poll=setInterval(()=>{try{if(statSync(join(dirname(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS),'memory.jsonl')).size>0){clearInterval(poll);clearTimeout(guard);setTimeout(()=>{},100);}}catch{}},10);`,
      );
      const cfg = {
        ...config,
        executable: process.execPath,
        arguments: [emitter],
        serverScript: service,
        fixtureManifest: manifest,
        outputDirectory: join(root, "evidence"),
        durationSeconds: 5,
        intervalSeconds: 0.1,
        startupTimeoutSeconds: 2,
      };
      const result = await runNativeBenchmark(cfg);
      expect(result.verification).toBe("measurement-only");
      expect(result.status).toBe("app-exited");
      expect(result.environmentKind).toBe("cloud-smoke");
      expect(result.checkpoints.editVisits[0]?.durationMs).toBe(25);
      expect(result.samples).toBeGreaterThan(0);
      const disk = JSON.parse(
        await readFile(join(cfg.outputDirectory, "report.json"), "utf8"),
      ) as { status: string };
      expect(disk.status).toBe("app-exited");
      expect(
        (await stat(join(cfg.outputDirectory, "memory.jsonl"))).size,
      ).toBeGreaterThan(0);
      const preserved = await readFile(
        join(cfg.outputDirectory, "report.json"),
        "utf8",
      );
      await expect(runNativeBenchmark(cfg)).rejects.toThrow(/EEXIST/);
      expect(
        await readFile(join(cfg.outputDirectory, "report.json"), "utf8"),
      ).toBe(preserved);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("cleans the owned service if a regular but non-executable native file cannot spawn", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "openfilm-benchmark-eacces-"));
    try {
      const service = join(root, "server.mjs");
      const binary = join(root, "not-executable");
      const { manifestPath: fixture } = await createNativeBenchmarkFixture(
        join(root, "fixture"),
        { assets: 2, clips: 2, beats: 1 },
      );
      await writeFile(
        service,
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close());`,
      );
      await writeFile(binary, "this is not an executable", { mode: 0o600 });
      const outputDirectory = join(root, "evidence");
      const result = await runNativeBenchmark({
        ...config,
        executable: binary,
        serverScript: service,
        fixtureManifest: fixture,
        outputDirectory,
      });
      expect(result.status).toBe("failed");
      const manifest = JSON.parse(
        await readFile(join(outputDirectory, "manifest.json"), "utf8"),
      ) as { ownership: { serverPid: number; nativePid?: number } };
      expect(manifest.ownership.serverPid).toBeGreaterThan(0);
      expect(manifest.ownership.nativePid).toBeUndefined();
      expect(() => process.kill(manifest.ownership.serverPid, 0)).toThrow();
      expect(
        JSON.parse(
          await readFile(join(outputDirectory, "lifecycle.json"), "utf8"),
        ).ownedServiceRemaining,
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([false, true])(
    "freezes collection and supervises shutdown (project Edit required: %s)",
    async (projectRequired) => {
      const root = await mkdtemp(
        join(tmpdir(), "openfilm-benchmark-completed-"),
      );
      try {
        const service = join(root, "server.mjs");
        const emitter = join(root, "emitter.mjs");
        const { manifestPath: fixture } = await createNativeBenchmarkFixture(
          join(root, "fixture"),
          { assets: 2, clips: 2, beats: 1 },
        );
        await writeFile(
          service,
          `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close());`,
        );
        await writeFile(
          emitter,
          `import{appendFileSync,readFileSync}from'node:fs';import{dirname,join}from'node:path';appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind:'welcome-ready',nativeElapsedMs:10,clientElapsedMs:10,clientTimeOriginMs:1000,unixMs:Date.now()})+'\\n');const guard=setTimeout(()=>process.exit(2),15000);const poll=setInterval(()=>{try{const report=JSON.parse(readFileSync(join(dirname(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS),'report.json'),'utf8'));if(['completed','scenario-incomplete','failed','interrupted'].includes(report.status)){clearInterval(poll);clearTimeout(guard);setTimeout(()=>{},300);}}catch{}},10);`,
        );
        const outputDirectory = join(root, "evidence");
        const result = await runNativeBenchmark({
          ...config,
          executable: process.execPath,
          arguments: [emitter],
          serverScript: service,
          fixtureManifest: fixture,
          outputDirectory,
          project: projectRequired
            ? join(root, "fixture", "benchmark.openfilm")
            : undefined,
          durationSeconds: 0.1,
          intervalSeconds: 0.1,
        });
        expect(result.status).toBe(
          projectRequired ? "scenario-incomplete" : "completed",
        );
        expect(result).toEqual(
          JSON.parse(
            await readFile(join(outputDirectory, "report.json"), "utf8"),
          ),
        );
        const lifecycle = JSON.parse(
          await readFile(join(outputDirectory, "lifecycle.json"), "utf8"),
        ) as {
          nativeExit: { code: number };
          ownedServiceRemaining: boolean;
          closedAt: string;
        };
        expect(lifecycle.nativeExit.code).toBe(0);
        expect(lifecycle.ownedServiceRemaining).toBe(false);
        expect(
          Date.parse(lifecycle.closedAt) - Date.parse(result.completedAt),
        ).toBeGreaterThan(200);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("cancels during service readiness without launching native or losing owner evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-benchmark-abort-"));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const service = join(root, "server.mjs");
      const emitter = join(root, "emitter.mjs");
      const { manifestPath: fixture } = await createNativeBenchmarkFixture(
        join(root, "fixture"),
        { assets: 2, clips: 2, beats: 1 },
      );
      const sentinel = join(root, "native-launched");
      await writeFile(
        service,
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>setTimeout(()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})),300));process.on('SIGTERM',()=>{s.close();process.exit(0)});`,
      );
      await writeFile(
        emitter,
        `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(sentinel)},'unexpected native launch');`,
      );
      const outputDirectory = join(root, "evidence");
      timer = setInterval(async () => {
        try {
          const observed = JSON.parse(
            await readFile(join(outputDirectory, "manifest.json"), "utf8"),
          ) as { ownership?: { serverPid?: number } };
          if (observed.ownership?.serverPid) controller.abort();
        } catch {
          /* Wait for the first complete owned-service publication. */
        }
      }, 10);
      const result = await runNativeBenchmark(
        {
          ...config,
          executable: process.execPath,
          arguments: [emitter],
          serverScript: service,
          fixtureManifest: fixture,
          outputDirectory,
        },
        { signal: controller.signal },
      );
      expect(result.status).toBe("interrupted");
      await expect(stat(sentinel)).rejects.toThrow();
      const manifest = JSON.parse(
        await readFile(join(outputDirectory, "manifest.json"), "utf8"),
      ) as { ownership: { serverPid: number; nativePid?: number } };
      expect(manifest.ownership.serverPid).toBeGreaterThan(0);
      expect(manifest.ownership.nativePid).toBeUndefined();
      expect(() => process.kill(manifest.ownership.serverPid, 0)).toThrow();
    } finally {
      if (timer) clearTimeout(timer);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("native benchmark asynchronous failure paths", () => {
  let fixtureRoot: string;
  let fixture: Awaited<ReturnType<typeof createNativeBenchmarkFixture>>;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "openfilm-benchmark-faults-"));
    fixture = await createNativeBenchmarkFixture(join(fixtureRoot, "fixture"), {
      assets: 2,
      clips: 2,
      beats: 1,
    });
  });
  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });
  beforeEach(() => {
    faults.writeNames.clear();
    faults.writeFailures = [];
    faults.afterSample = undefined;
  });

  async function scenario(
    exercise: (context: {
      config: BenchmarkConfig;
      signal: AbortSignal;
      owners: () => Promise<Owners>;
      closeNormally: () => Promise<void>;
      listenersRestored: () => void;
    }) => Promise<void>,
  ) {
    const root = await mkdtemp(join(tmpdir(), "openfilm-benchmark-processes-"));
    const outputDirectory = join(root, "evidence");
    const controller = new AbortController();
    const closeSignal = join(root, "close-native");
    const closeNormally = async () => {
      await writeFile(closeSignal, "normal protocol-child shutdown");
    };
    const originalInt = process.listeners("SIGINT");
    const originalTerm = process.listeners("SIGTERM");
    const originalAbort = getEventListeners(controller.signal, "abort");
    const owners = async (): Promise<Owners> => {
      try {
        const manifest = JSON.parse(
          await readFile(join(outputDirectory, "manifest.json"), "utf8"),
        ) as { ownership: Owners };
        return manifest.ownership;
      } catch {
        return {};
      }
    };
    try {
      const service = join(root, "server.mjs");
      const emitter = join(root, "emitter.mjs");
      await writeFile(
        service,
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close());`,
      );
      // A real child publishes the existing native event protocol and exits
      // normally. It is not a native GUI or workstation performance fixture.
      await writeFile(
        emitter,
        `import{appendFileSync,existsSync}from'node:fs';const emit=(kind,ms,extra={})=>appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind,nativeElapsedMs:ms,unixMs:Date.now(),clientElapsedMs:ms,clientTimeOriginMs:1000,...extra})+'\\n');emit('welcome-ready',10);emit('edit-enter',15);emit('edit-ready',20,{clipCount:2});const poll=setInterval(()=>{if(existsSync(${JSON.stringify(closeSignal)})){clearInterval(poll);setTimeout(()=>{},150);}},10);`,
      );
      // Keep the child live until both actual asynchronous root snapshots have
      // returned. Its normal shutdown then occurs after report writes, without
      // relying on an absolute startup timeout on slower CI machines.
      let firstSamples = 0;
      faults.afterSample = async () => {
        if (++firstSamples === 2) await closeNormally();
      };
      await exercise({
        config: {
          candidateSha: "a".repeat(40),
          label: "failure regression; not workstation evidence",
          environmentKind: "cloud-smoke",
          executable: process.execPath,
          arguments: [emitter],
          serverScript: service,
          project: fixture.projectPath,
          fixtureManifest: fixture.manifestPath,
          outputDirectory,
          durationSeconds: 0.1,
          intervalSeconds: 0.1,
          startupTimeoutSeconds: 3,
          cacheCondition: "synthetic test; no performance conclusion",
          webviewVersion: "not-applicable-node-protocol-child",
          display: { width: 1280, height: 720, scale: 1 },
        },
        signal: controller.signal,
        owners,
        closeNormally,
        listenersRestored: () => {
          expect.soft(process.listeners("SIGINT")).toEqual(originalInt);
          expect.soft(process.listeners("SIGTERM")).toEqual(originalTerm);
          expect
            .soft(getEventListeners(controller.signal, "abort"))
            .toEqual(originalAbort);
        },
      });
    } finally {
      // A red test must not strand a service or leak listeners into later tests.
      // Only PIDs and listeners created by this scenario are removed.
      faults.afterSample = undefined;
      faults.writeNames.clear();
      const owned = await owners();
      for (const pid of [owned.nativePid, owned.serverPid]) {
        if (pid !== undefined && alive(pid)) {
          process.kill(pid, "SIGTERM");
          await awaitExit(pid);
        }
      }
      for (const listener of process.listeners("SIGINT"))
        if (!originalInt.includes(listener))
          process.removeListener("SIGINT", listener);
      for (const listener of process.listeners("SIGTERM"))
        if (!originalTerm.includes(listener))
          process.removeListener("SIGTERM", listener);
      for (const listener of getEventListeners(controller.signal, "abort"))
        if (!originalAbort.includes(listener))
          controller.signal.removeEventListener(
            "abort",
            listener as EventListener,
          );
      await rm(root, { recursive: true, force: true });
    }
  }

  it.each(["nativePid", "serverPid"] as const)(
    "does not mark completion when %s exits during the awaited memory sample",
    async (target) => {
      await scenario(
        async ({
          config,
          signal,
          owners,
          closeNormally,
          listenersRestored,
        }) => {
          let interruptedSample = false;
          faults.afterSample = async (snapshot) => {
            const owned = await owners();
            if (!interruptedSample && snapshot.rootPid === owned[target]) {
              interruptedSample = true;
              process.kill(snapshot.rootPid, "SIGTERM");
              await awaitExit(snapshot.rootPid);
              if (target === "serverPid") await closeNormally();
              // The collection duration expires while the runner is awaiting the
              // sampler. A stale pre-await liveness check must not permit success.
              await delay(150);
            }
          };
          const result = await runNativeBenchmark(config, { signal });
          expect(interruptedSample).toBe(true);
          expect(result.status).toBe(
            target === "nativePid" ? "app-exited" : "failed",
          );
          if (target === "serverPid")
            expect(result.failure).toMatch(/service.*exit/iu);
          const disk = JSON.parse(
            await readFile(join(config.outputDirectory, "report.json"), "utf8"),
          ) as { status: string };
          expect(disk.status).toBe(result.status);
          expect(alive((await owners()).serverPid)).toBe(false);
          listenersRestored();
        },
      );
    },
  );

  it.each([
    { label: "report", writeNames: ["report.json"] },
    { label: "lifecycle", writeNames: ["lifecycle.json"] },
    { label: "all final files", writeNames: ["report.json", "lifecycle.json"] },
  ])(
    "still supervises native shutdown, cleans its service and restores listeners when $label writes fail",
    async ({ writeNames }) => {
      await scenario(async ({ config, signal, owners, listenersRestored }) => {
        for (const name of writeNames) faults.writeNames.add(name);
        let error: unknown;
        let result: Awaited<ReturnType<typeof runNativeBenchmark>> | undefined;
        try {
          result = await runNativeBenchmark(config, { signal });
        } catch (caught) {
          error = caught;
        }
        const visibleFailure =
          error instanceof Error ? error.message : result?.failure;
        expect.soft(visibleFailure).toMatch(/ENOSPC/iu);
        if (result) expect.soft(result.status).toBe("failed");
        expect
          .soft(faults.writeFailures)
          .toEqual(expect.arrayContaining(writeNames));
        const owned = await owners();
        expect.soft(owned.nativePid).toBeGreaterThan(0);
        expect.soft(owned.serverPid).toBeGreaterThan(0);
        expect.soft(alive(owned.nativePid)).toBe(false);
        expect.soft(alive(owned.serverPid)).toBe(false);
        listenersRestored();
        if (!writeNames.includes("lifecycle.json")) {
          const lifecycle = JSON.parse(
            await readFile(
              join(config.outputDirectory, "lifecycle.json"),
              "utf8",
            ),
          ) as {
            nativeExit: { code: number };
            ownedServiceRemaining: boolean;
          };
          expect(lifecycle.nativeExit.code).toBe(0);
          expect(lifecycle.ownedServiceRemaining).toBe(false);
        }
      });
    },
  );
});
