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
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createNativeBenchmarkFixture } from "../../scripts/native-benchmark/create-fixture";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessMemorySnapshot } from "../../scripts/native-benchmark/process-memory";

const faults = vi.hoisted(() => ({
  writeNames: new Set<string>(),
  writeFailures: [] as string[],
  manifestFailure: undefined as "partial-write" | "rename" | undefined,
  manifestBefore: undefined as string | undefined,
  manifestTemporary: undefined as string | undefined,
  manifestPartial: undefined as string | undefined,
  manifestAttemptedOwners: undefined as
    | {
        serverPid?: number;
        nativePid?: number;
      }
    | undefined,
  manifestInjectionHits: 0,
  afterManifestPublished: undefined as ((contents: string) => void) | undefined,
  afterSample: undefined as
    ((snapshot: ProcessMemorySnapshot) => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const nativeUpdate = (contents: unknown) => {
    if (!faults.manifestFailure || typeof contents !== "string") return;
    try {
      const manifest = JSON.parse(contents) as { ownership?: Owners };
      return manifest.ownership?.nativePid ? manifest.ownership : undefined;
    } catch {
      return;
    }
  };
  const manifestFailure = (mode: "partial-write" | "rename") =>
    Object.assign(
      new Error(
        mode === "partial-write"
          ? "ENOSPC: partial native PID manifest write"
          : "EACCES: native PID manifest replacement denied",
      ),
      { code: mode === "partial-write" ? "ENOSPC" : "EACCES" },
    );
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (
        typeof args[0] !== "string" ||
        !/manifest\.json\.[^/\\]+\.tmp$/u.test(args[0])
      )
        return file;
      const temporary = args[0];
      const published = temporary.replace(/\.[^/.]+\.tmp$/u, "");
      const write = file.writeFile.bind(file);
      file.writeFile = async (contents, options) => {
        const owners = nativeUpdate(contents);
        if (owners) {
          faults.manifestAttemptedOwners = owners;
          faults.manifestBefore = await actual.readFile(published, "utf8");
          faults.manifestTemporary = temporary;
          if (faults.manifestFailure === "partial-write") {
            await write(String(contents).slice(0, 27), options);
            faults.manifestPartial = await actual.readFile(temporary, "utf8");
            faults.manifestInjectionHits++;
            throw manifestFailure("partial-write");
          }
        }
        await write(contents, options);
      };
      return file;
    },
    rename: (...args: Parameters<typeof actual.rename>) => {
      if (
        faults.manifestFailure === "rename" &&
        args[0] === faults.manifestTemporary
      ) {
        faults.manifestInjectionHits++;
        return Promise.reject(manifestFailure("rename"));
      }
      return actual.rename(...args);
    },
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      if (
        process.env.OPENFILM_TEST_LEGACY_MANIFEST_WRITE === "1" &&
        typeof args[0] === "string" &&
        basename(args[0]) === "manifest.json"
      ) {
        const owners = nativeUpdate(args[1]);
        if (owners && faults.manifestFailure === "partial-write") {
          const path = args[0];
          faults.manifestAttemptedOwners = owners;
          faults.manifestInjectionHits++;
          return actual.readFile(path, "utf8").then(async (prior) => {
            faults.manifestBefore = prior;
            await actual.writeFile(path, String(args[1]).slice(0, 27));
            faults.manifestPartial = await actual.readFile(path, "utf8");
            throw manifestFailure("partial-write");
          });
        }
      }
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

// Opt-in RED seam reproduces the old three direct manifest writes without
// editing run.ts. Default tests execute the actual atomic helper unchanged.
vi.mock(
  "../../scripts/native-benchmark/atomic-manifest",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../scripts/native-benchmark/atomic-manifest")
      >();
    const filesystem = await import("node:fs/promises");
    return {
      ...actual,
      replaceBenchmarkManifest: async (path: string, contents: string) => {
        await (process.env.OPENFILM_TEST_LEGACY_MANIFEST_WRITE === "1"
          ? filesystem.writeFile(path, contents)
          : actual.replaceBenchmarkManifest(path, contents));
        faults.afterManifestPublished?.(contents);
      },
    };
  },
);

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

function benchmarkProtocolEvents(stdout: string) {
  return stdout.split("\n").flatMap((line) => {
    try {
      const event = JSON.parse(line) as {
        event?: string;
        status?: string;
        terminal?: boolean;
        appLeftRunning?: boolean;
      };
      return event.event?.startsWith("native-benchmark.") ? [event] : [];
    } catch {
      return [];
    }
  });
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

function serviceShutdownProtocol(
  options: { beforeClose?: string; delayMs?: number } = {},
) {
  return `let benchmarkShutdownRequested=false;process.on('message',async(message)=>{if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL!=='1'||message?.type!=='openfilm.benchmark.shutdown'||typeof message.requestId!=='string'||benchmarkShutdownRequested)return;benchmarkShutdownRequested=true;${options.delayMs ? `await new Promise(resolve=>setTimeout(resolve,${options.delayMs}));` : ""}${options.beforeClose ?? ""}await new Promise((resolve,reject)=>s.close(error=>error?reject(error):resolve()));process.send({type:'openfilm.benchmark.closed',requestId:message.requestId},error=>{if(error)process.exitCode=1;if(process.connected)process.disconnect();});});if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL==='1'&&process.send)process.send({type:'openfilm.benchmark.control-ready',runtime:{version:process.version,executable:process.execPath}});`;
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
  it("removes only its scoped output listeners and preserves existing Writable handlers", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-output-ownership-"));
    try {
      const launcher = join(root, "ownership.mjs");
      const audit = join(root, "ownership.json");
      const module = pathToFileURL(
        resolve("scripts/native-benchmark/output-control.ts"),
      ).href;
      await writeFile(
        launcher,
        `import assert from'node:assert/strict';
import{Writable}from'node:stream';
import{writeFile}from'node:fs/promises';
import{observeBenchmarkOutput}from${JSON.stringify(module)};
const written=[];
const stdout=new Writable({write(chunk,encoding,callback){written.push(['stdout',chunk.toString()]);callback();}});
const stderr=new Writable({write(chunk,encoding,callback){written.push(['stderr',chunk.toString()]);callback();}});
const existingStdout=()=>{throw new Error('Unexpected stdout error in ownership-only test');};
const existingStderr=()=>{throw new Error('Unexpected stderr error in ownership-only test');};
stdout.on('error',existingStdout);stderr.on('error',existingStderr);
const originalStdout=Object.getOwnPropertyDescriptor(process,'stdout');
const originalStderr=Object.getOwnPropertyDescriptor(process,'stderr');
let result;
try{
  Object.defineProperty(process,'stdout',{configurable:true,value:stdout});
  Object.defineProperty(process,'stderr',{configurable:true,value:stderr});
  const output=observeBenchmarkOutput();
  assert.equal(stdout.rawListeners('error').length,2);
  assert.equal(stderr.rawListeners('error').length,2);
  assert.equal(await output.stdout('normal stdout'),undefined);
  assert.equal(await output.stderr('normal stderr'),undefined);
  await output.dispose();
  assert.deepEqual(stdout.rawListeners('error'),[existingStdout]);
  assert.deepEqual(stderr.rawListeners('error'),[existingStderr]);
  result={stdoutExistingPreserved:true,stderrExistingPreserved:true,stdoutAfter:stdout.listenerCount('error'),stderrAfter:stderr.listenerCount('error'),written};
}finally{
  Object.defineProperty(process,'stdout',originalStdout);
  Object.defineProperty(process,'stderr',originalStderr);
}
await writeFile(${JSON.stringify(audit)},JSON.stringify(result));`,
      );
      // Writable substitution is confined to this isolated child. The separate
      // real-pipe EPIPE test installs no sentinel/error-swallowing listener.
      const cli = spawn(process.execPath, ["--import", "tsx", launcher], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      cli.stdout!.resume();
      cli.stderr!.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const exit = await new Promise((resolveExit, reject) => {
        cli.once("error", reject);
        cli.once("close", (code, signal) => resolveExit({ code, signal }));
      });
      expect(exit, stderr).toEqual({ code: 0, signal: null });
      expect(JSON.parse(await readFile(audit, "utf8"))).toEqual({
        stdoutExistingPreserved: true,
        stderrExistingPreserved: true,
        stdoutAfter: 1,
        stderrAfter: 1,
        written: [
          ["stdout", "normal stdout"],
          ["stderr", "normal stderr"],
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
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
        `import{createServer}from'node:http';import{tsImport}from${JSON.stringify(tsxApi)};const{OpenFilmApplication}=await tsImport(${JSON.stringify(application)},import.meta.url);const app=await OpenFilmApplication.open(process.env.OPENFILM_PROJECT,{userDataDirectory:${JSON.stringify(join(root, "user-data"))}});const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>{app.close();s.close(()=>{if(process.connected)process.disconnect();});});${serviceShutdownProtocol({ beforeClose: "await app.close();" })}`,
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
          startupTimeoutSeconds: 30,
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
        expect(lifecycle.serviceExit).toEqual({ code: 0, signal: null });
        expect(lifecycle.serviceShutdown.acknowledged).toBe(true);
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
        `import {createServer} from 'node:http'; const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end('{"ok":true}');});s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close(()=>{if(process.connected)process.disconnect();}));${serviceShutdownProtocol()}`,
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
        // Windows process sampling can consume its entire five-second bound.
        // The child exits after the first saved sample; leave the collection
        // deadline beyond that handshake instead of racing the sampler.
        durationSeconds: 30,
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
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close(()=>{if(process.connected)process.disconnect();}));${serviceShutdownProtocol()}`,
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
          `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close(()=>{if(process.connected)process.disconnect();}));${serviceShutdownProtocol()}`,
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
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>setTimeout(()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})),300));process.on('SIGTERM',()=>{s.close();process.exit(0)});${serviceShutdownProtocol()}`,
      );
      await writeFile(
        emitter,
        `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(sentinel)},'unexpected native launch');`,
      );
      const outputDirectory = join(root, "evidence");
      // Cancel after the actual atomic publication completes. Polling an open
      // destination races NTFS rename and tests sharing violations instead.
      faults.afterManifestPublished = (contents) => {
        const observed = JSON.parse(contents) as {
          ownership?: { serverPid?: number };
        };
        if (observed.ownership?.serverPid) controller.abort();
      };
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
      faults.afterManifestPublished = undefined;
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
    faults.manifestFailure = undefined;
    faults.manifestBefore = undefined;
    faults.manifestTemporary = undefined;
    faults.manifestPartial = undefined;
    faults.manifestAttemptedOwners = undefined;
    faults.manifestInjectionHits = 0;
  });

  async function scenario(
    exercise: (context: {
      config: BenchmarkConfig;
      signal: AbortSignal;
      owners: () => Promise<Owners>;
      closeNormally: () => Promise<void>;
      publishDeferredEdit: () => Promise<void>;
      listenersRestored: () => void;
      expectFinishedStatus: (status: string) => void;
    }) => Promise<void>,
    options: {
      deferredEdit?: boolean;
      serviceCloseDelayMs?: number;
      externallySupervisedChildren?: boolean;
    } = {},
  ) {
    const root = await mkdtemp(join(tmpdir(), "openfilm-benchmark-processes-"));
    const outputDirectory = join(root, "evidence");
    const controller = new AbortController();
    const closeSignal = join(root, "close-native");
    const editSignal = join(root, "publish-edit");
    const closeNormally = async () => {
      await writeFile(closeSignal, "normal protocol-child shutdown");
    };
    const originalInt = process.listeners("SIGINT");
    const originalTerm = process.listeners("SIGTERM");
    const originalAbort = getEventListeners(controller.signal, "abort");
    const stdoutChunks: string[] = [];
    const actualWrite = process.stdout.write;
    // Observe actual runner writes while delegating their original callbacks
    // and behavior. This observer never suppresses a stream failure.
    const stdoutObserver = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(
        (...args: Parameters<typeof process.stdout.write>) => {
          stdoutChunks.push(String(args[0]));
          return Reflect.apply(actualWrite, process.stdout, args) as boolean;
        },
      );
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
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.once('SIGTERM',()=>setTimeout(()=>s.close(()=>{if(process.connected)process.disconnect();}),${options.serviceCloseDelayMs ?? 0}));${serviceShutdownProtocol({ delayMs: options.serviceCloseDelayMs ?? 0 })}`,
      );
      // A real child publishes the existing native event protocol and exits
      // normally. It is not a native GUI or workstation performance fixture.
      await writeFile(
        emitter,
        `import{appendFileSync,existsSync}from'node:fs';const emit=(kind,ms,extra={})=>appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind,nativeElapsedMs:ms,unixMs:Date.now(),clientElapsedMs:ms,clientTimeOriginMs:1000,...extra})+'\\n');emit('welcome-ready',10);const edit=()=>{emit('edit-enter',15);emit('edit-ready',20,{clipCount:2});};let editPublished=${!options.deferredEdit};if(editPublished)edit();const poll=setInterval(()=>{if(!editPublished&&existsSync(${JSON.stringify(editSignal)})){editPublished=true;edit();}if(existsSync(${JSON.stringify(closeSignal)})){clearInterval(poll);setTimeout(()=>{},150);}},10);`,
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
        publishDeferredEdit: async () => {
          await writeFile(editSignal, "publish actual child Edit checkpoints");
          const manifest = JSON.parse(
            await readFile(join(outputDirectory, "manifest.json"), "utf8"),
          ) as { runId: string; ownership: Owners };
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            const events = (
              await readFile(
                join(outputDirectory, "native-events.jsonl"),
                "utf8",
              )
            )
              .split("\n")
              .slice(0, -1)
              .filter(Boolean)
              .map(
                (line) =>
                  JSON.parse(line) as {
                    runId: string;
                    pid: number;
                    kind: string;
                  },
              );
            if (
              events.some(
                (event) =>
                  event.runId === manifest.runId &&
                  event.pid === manifest.ownership.nativePid &&
                  event.kind === "edit-ready",
              )
            )
              return;
            await delay(10);
          }
          throw new Error(
            "Actual native protocol child did not publish deferred Edit readiness",
          );
        },
        expectFinishedStatus: (expectedStatus) => {
          const events = benchmarkProtocolEvents(stdoutChunks.join(""));
          const finished = events.filter(
            (event) => event.event === "native-benchmark.finished",
          );
          expect.soft(finished).toHaveLength(1);
          expect
            .soft(finished.map((event) => event.status))
            .toEqual([expectedStatus]);
          expect.soft(finished[0]?.terminal).toBe(true);
          expect.soft(finished[0]?.appLeftRunning).toBe(false);
          const provisional = events.filter(
            (event) => event.event === "native-benchmark.collection-stopped",
          );
          expect.soft(provisional).toHaveLength(1);
          expect.soft(provisional[0]?.terminal).toBe(false);
          expect.soft(provisional[0]?.status).toBeUndefined();
        },
        listenersRestored: () => {
          expect.soft(process.listeners("SIGINT")).toEqual(originalInt);
          expect.soft(process.listeners("SIGTERM")).toEqual(originalTerm);
          expect
            .soft(getEventListeners(controller.signal, "abort"))
            .toEqual(originalAbort);
        },
      });
    } finally {
      stdoutObserver.mockRestore();
      // A red test must not strand a service or leak listeners into later tests.
      // Only PIDs and listeners created by this scenario are removed.
      faults.afterSample = undefined;
      faults.writeNames.clear();
      const owned = await owners();
      for (const pid of [owned.nativePid, owned.serverPid]) {
        if (
          !options.externallySupervisedChildren &&
          pid !== undefined &&
          alive(pid)
        ) {
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

  async function runThenCloseNormally(
    config: BenchmarkConfig,
    signal: AbortSignal,
    closeNormally: () => Promise<void>,
    beforeNormalClose?: () => Promise<void>,
  ) {
    // Model an operator: keep the native window open until collection has
    // actually ended. A sample or evidence write can outlast the native timer.
    faults.afterSample = undefined;
    // Hashing inputs and starting a copied Node binary can precede collection
    // by several seconds. Give setup its own bound, then observe the report
    // from the actual native-owner publication rather than from API entry.
    let deadline = Date.now() + 30000;
    let nativePublished = false;
    const priorPublicationObserver = faults.afterManifestPublished;
    faults.afterManifestPublished = (contents) => {
      priorPublicationObserver?.(contents);
      const manifest = JSON.parse(contents) as { ownership?: Owners };
      if (!nativePublished && manifest.ownership?.nativePid) {
        nativePublished = true;
        deadline = Date.now() + 10000;
      }
    };
    const pending = runNativeBenchmark(config, { signal }).then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    );
    try {
      let terminalObserved = false;
      while (Date.now() < deadline) {
        try {
          const observed = JSON.parse(
            await readFile(join(config.outputDirectory, "report.json"), "utf8"),
          ) as { status?: string };
          if (observed.status && observed.status !== "collecting") {
            terminalObserved = true;
            break;
          }
        } catch {
          // Wait for a complete publication by the actual runner.
        }
        await delay(10);
      }
      if (!terminalObserved)
        throw new Error(
          "Runner did not publish its terminal collection report",
        );
      await beforeNormalClose?.();
    } finally {
      faults.afterManifestPublished = priorPublicationObserver;
      await closeNormally();
      await pending;
    }
    const outcome = await pending;
    if (outcome.error !== undefined) throw outcome.error;
    if (!outcome.result)
      throw new Error("Runner did not return a final report");
    return outcome.result;
  }

  it.each([
    { label: "partial temp write ENOSPC", mode: "partial-write" },
    { label: "replacement rename failure", mode: "rename" },
  ] as const)(
    "retains a valid published manifest and supervises owned children after $label",
    async ({ mode }) => {
      await scenario(
        async ({
          config,
          signal,
          closeNormally,
          listenersRestored,
          expectFinishedStatus,
        }) => {
          faults.manifestFailure = mode;
          let result:
            Awaited<ReturnType<typeof runNativeBenchmark>> | undefined;
          let error: unknown;
          try {
            result = await runThenCloseNormally(
              config,
              signal,
              closeNormally,
              async () => {
                expect.soft(faults.manifestInjectionHits).toBe(1);
                expect
                  .soft(alive(faults.manifestAttemptedOwners?.nativePid))
                  .toBe(true);
                expect
                  .soft(alive(faults.manifestAttemptedOwners?.serverPid))
                  .toBe(true);
                expect
                  .soft(
                    await readFile(
                      join(config.outputDirectory, "manifest.json"),
                      "utf8",
                    ),
                  )
                  .toBe(faults.manifestBefore);
              },
            );
          } catch (caught) {
            error = caught;
          }
          expect.soft(error).toBeUndefined();
          expect.soft(result?.status).toBe("failed");
          expect
            .soft(result?.failure)
            .toMatch(mode === "partial-write" ? /ENOSPC/iu : /EACCES/iu);
          expectFinishedStatus("failed");
          const published = await readFile(
            join(config.outputDirectory, "manifest.json"),
            "utf8",
          );
          expect.soft(published).toBe(faults.manifestBefore);
          // Keep cleanup checks reachable even when the RED direct-write seam
          // deliberately makes the on-disk JSON invalid.
          let valid:
            | {
                ownership: Owners;
                runId: string;
                environment: { serviceNode?: unknown };
              }
            | undefined;
          try {
            valid = JSON.parse(published);
          } catch {
            /* A partial published file is a correctness failure. */
          }
          expect.soft(valid).toBeDefined();
          expect
            .soft(valid?.ownership.serverPid)
            .toBe(faults.manifestAttemptedOwners?.serverPid);
          expect.soft(valid?.ownership.nativePid).toBeUndefined();
          expect.soft(valid?.environment.serviceNode).toBeDefined();
          if (mode === "partial-write") {
            expect.soft(faults.manifestPartial?.length).toBe(27);
          }
          expect
            .soft(
              (await readdir(config.outputDirectory)).filter((name) =>
                name.endsWith(".tmp"),
              ),
            )
            .toEqual([]);
          const report = JSON.parse(
            await readFile(join(config.outputDirectory, "report.json"), "utf8"),
          ) as { status: string; failure?: string };
          expect.soft(report.status).toBe("failed");
          expect
            .soft(report.failure)
            .toMatch(mode === "partial-write" ? /ENOSPC/iu : /EACCES/iu);
          const lifecycle = JSON.parse(
            await readFile(
              join(config.outputDirectory, "lifecycle.json"),
              "utf8",
            ),
          ) as {
            nativeExit: { code: number; signal: string | null };
            serviceExit: { code: number; signal: string | null };
            serviceShutdown: { method: string; acknowledged: boolean };
            ownedServiceRemaining: boolean;
          };
          expect.soft(lifecycle.nativeExit).toEqual({ code: 0, signal: null });
          expect.soft(lifecycle.serviceExit).toEqual({ code: 0, signal: null });
          expect.soft(lifecycle.serviceShutdown).toEqual(
            expect.objectContaining({
              method: "private-ipc",
              acknowledged: true,
            }),
          );
          expect.soft(lifecycle.ownedServiceRemaining).toBe(false);
          expect
            .soft(alive(faults.manifestAttemptedOwners?.nativePid))
            .toBe(false);
          expect
            .soft(alive(faults.manifestAttemptedOwners?.serverPid))
            .toBe(false);
          listenersRestored();
        },
      );
    },
  );

  it.each(["during collection", "after cleanup"] as const)(
    "supervises normal native and service shutdown after asynchronous stdout EPIPE: %s",
    async (when) => {
      const stillRunning = async (pid: number | undefined) => {
        if (!alive(pid)) return false;
        if (process.platform === "linux" && pid !== undefined) {
          try {
            const state = await readFile(`/proc/${pid}/stat`, "utf8");
            if (state.slice(state.lastIndexOf(")") + 2).startsWith("Z "))
              return false;
          } catch {
            return alive(pid);
          }
        }
        return true;
      };
      const waitForNaturalExit = async (pid: number | undefined) => {
        const deadline = Date.now() + 3000;
        while (await stillRunning(pid)) {
          if (Date.now() >= deadline)
            throw new Error(`Synthetic child ${pid} did not close naturally`);
          await delay(10);
        }
      };
      await scenario(
        async ({ config, owners, closeNormally, listenersRestored }) => {
          const evidenceRoot = join(config.outputDirectory, "..");
          const input = join(evidenceRoot, "cli-config.json");
          const launcher = join(evidenceRoot, "cli-launcher.mjs");
          const epipeMarker = join(evidenceRoot, "stdout-epipe.json");
          const auditPath = join(evidenceRoot, "listener-audit.json");
          const stopService = join(evidenceRoot, "stop-lab-service");
          const closedMarker = join(evidenceRoot, "lab-service-closed.json");
          await writeFile(input, JSON.stringify(config));
          await writeFile(
            config.serverScript,
            `import{createServer}from'node:http';import{existsSync,writeFileSync}from'node:fs';const s=createServer((q,r)=>r.end('{"ok":true}'));let closing=false;const finish=async(kind,requestId)=>{if(closing)return;closing=true;clearInterval(poll);await new Promise((resolve,reject)=>s.close(error=>error?reject(error):resolve()));writeFileSync(${JSON.stringify(closedMarker)},JSON.stringify({kind,requestId}));if(kind==='private-ipc'&&process.connected)process.send({type:'openfilm.benchmark.closed',requestId},()=>process.disconnect());else if(process.connected)process.disconnect();};const poll=setInterval(()=>{if(existsSync(${JSON.stringify(stopService)}))void finish('lab-fallback');},10);process.on('message',message=>{if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL==='1'&&message?.type==='openfilm.benchmark.shutdown')void finish('private-ipc',message.requestId);});if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL==='1'&&process.send)process.send({type:'openfilm.benchmark.control-ready',runtime:{version:process.version,executable:process.execPath}});s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.once('SIGTERM',()=>void finish('lab-signal'));`,
          );
          const runModule = pathToFileURL(
            resolve("scripts/native-benchmark/run.ts"),
          ).href;
          await writeFile(
            launcher,
            `import{readFile,writeFile}from'node:fs/promises';import{writeFileSync}from'node:fs';import{getEventListeners}from'node:events';import{runNativeBenchmark}from${JSON.stringify(runModule)};const controller=new AbortController();const originalStdout=process.stdout.rawListeners('error');const originalStderr=process.stderr.rawListeners('error');const diagnosticRemovals=[];const listenerDetail=listener=>({name:listener.name,source:Function.prototype.toString.call(listener),once:!!listener.listener});const trackRemovals=(stream,name,original)=>{const remove=stream.removeListener;stream.removeListener=function(event,listener){if(event==='error')diagnosticRemovals.push({stream:name,originalIndex:original.indexOf(listener),listener:listenerDetail(listener),stack:new Error('listener removal').stack});return Reflect.apply(remove,this,[event,listener]);};};trackRemovals(process.stdout,'stdout',originalStdout);trackRemovals(process.stderr,'stderr',originalStderr);const counts=()=>({sigint:process.listenerCount('SIGINT'),sigterm:process.listenerCount('SIGTERM'),abort:getEventListeners(controller.signal,'abort').length});const streamAudit=(stream,original)=>{const current=stream.rawListeners('error');return{unexpectedAfter:current.filter(listener=>!original.includes(listener)).length,missingPersistent:original.filter(listener=>!listener.listener&&!current.includes(listener)).length,onceBefore:original.filter(listener=>listener.listener).length,onceAfter:current.filter(listener=>listener.listener).length};};const before=counts();const actualWrite=process.stdout.write.bind(process.stdout);process.stdout.write=(...args)=>{const callback=typeof args.at(-1)==='function'?args.pop():undefined;return actualWrite(...args,error=>{if(error?.code==='EPIPE')writeFileSync(${JSON.stringify(epipeMarker)},JSON.stringify({code:error.code,message:error.message}));callback?.(error);});};let result,failure;try{result=await runNativeBenchmark(JSON.parse(await readFile(${JSON.stringify(input)},'utf8')),{signal:controller.signal});}catch(error){failure=error instanceof Error?error.message:String(error);}await writeFile(${JSON.stringify(auditPath)},JSON.stringify({before,after:counts(),streams:{stdout:streamAudit(process.stdout,originalStdout),stderr:streamAudit(process.stderr,originalStderr)},diagnostic:{originalStdout:originalStdout.map(listenerDetail),originalStderr:originalStderr.map(listenerDetail),removals:diagnosticRemovals},resultStatus:result?.status,failure}));if(failure||result?.status!=='completed'){process.exitCode=1;process.stderr.write((failure||result?.failure||'Measurement failed')+'\\n');}`,
          );
          // The stdout pipe belongs only to this isolated launcher. No global
          // uncaughtException/error handler is installed in it or in Vitest.
          // A cold TSX loader also exercises Node's worker stdio unpipe cleanup.
          const cli = spawn(process.execPath, ["--import", "tsx", launcher], {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, TSX_DISABLE_CACHE: "1" },
          });
          let stdout = "";
          let stderr = "";
          let pipeClosed = false;
          let cliClosed = false;
          const done = new Promise<{
            code: number | null;
            signal: string | null;
          }>((resolveExit, reject) => {
            cli.once("error", reject);
            cli.once("close", (code, signal) => {
              cliClosed = true;
              resolveExit({ code, signal });
            });
          });
          cli.stderr!.on("data", (chunk) => {
            stderr += String(chunk);
          });
          cli.stdout!.on("data", (chunk) => {
            stdout += String(chunk);
            if (
              !pipeClosed &&
              stdout.includes(
                when === "during collection"
                  ? '"event":"native-benchmark.started"'
                  : "Close the OpenFilm window normally to release its owned service.",
              )
            ) {
              pipeClosed = true;
              cli.stdout!.destroy();
            }
          });
          const waitForOutput = async (marker: string) => {
            const deadline = Date.now() + 30000;
            while (
              !stdout.includes(marker) &&
              !cliClosed &&
              Date.now() < deadline
            )
              await delay(10);
            expect(stdout, stderr).toContain(marker);
          };
          try {
            let actualEpipe: { code: string } | undefined;
            try {
              // Cold TSX startup, input verification and service startup precede
              // the pipe experiment. Start its observation at the actual phase,
              // not at launcher spawn; Windows CIM sampling can also take 5s.
              await waitForOutput('"event":"native-benchmark.started"');
              if (when === "after cleanup") {
                await waitForOutput(
                  "Close the OpenFilm window normally to release its owned service.",
                );
                expect(pipeClosed).toBe(true);
                const owned = await owners();
                expect.soft(alive(owned.nativePid)).toBe(true);
                expect.soft(alive(owned.serverPid)).toBe(true);
                // Consume the provisional event and normal-close notice first.
                // Only the terminal write after ACK/exit now encounters EPIPE.
                await closeNormally();
              }
              const deadline = Date.now() + 10000;
              while (Date.now() < deadline) {
                try {
                  actualEpipe = JSON.parse(await readFile(epipeMarker, "utf8"));
                  break;
                } catch {
                  await delay(10);
                }
              }
              expect(actualEpipe?.code).toBe("EPIPE");
              expect(pipeClosed).toBe(true);
              if (when === "during collection") {
                expect.soft(cliClosed).toBe(false);
                const owned = await owners();
                expect.soft(alive(owned.nativePid)).toBe(true);
                expect.soft(alive(owned.serverPid)).toBe(true);
              }
            } finally {
              // An operator still closes the native window normally after output
              // failure; never signal the test-owned native child to satisfy QA.
              await closeNormally();
            }
            const exit = await done;
            expect.soft(exit).toEqual({ code: 1, signal: null });
            expect.soft(stderr).toMatch(/EPIPE/iu);
            expect.soft(stderr).not.toContain("Unhandled 'error' event");
            const delivered = benchmarkProtocolEvents(stdout);
            expect
              .soft(
                delivered.filter(
                  (event) => event.event === "native-benchmark.finished",
                ),
              )
              .toHaveLength(0);
            if (when === "after cleanup") {
              const provisional = delivered.filter(
                (event) =>
                  event.event === "native-benchmark.collection-stopped",
              );
              expect.soft(provisional).toHaveLength(1);
              expect.soft(provisional[0]?.terminal).toBe(false);
              expect.soft(provisional[0]?.status).toBeUndefined();
            }
            const report = JSON.parse(
              await readFile(
                join(config.outputDirectory, "report.json"),
                "utf8",
              ),
            ) as { status: string; failure?: string };
            expect.soft(report.status).toBe("failed");
            expect.soft(report.failure ?? "").toMatch(/EPIPE/iu);
            let lifecycle:
              | {
                  nativeExit: { code: number; signal: string | null };
                  serviceExit: { code: number; signal: string | null };
                  serviceShutdown: { method: string; acknowledged: boolean };
                  ownedServiceRemaining: boolean;
                }
              | undefined;
            let audit:
              | {
                  before: Record<string, number>;
                  after: Record<string, number>;
                  streams: {
                    stdout: {
                      unexpectedAfter: number;
                      missingPersistent: number;
                    };
                    stderr: {
                      unexpectedAfter: number;
                      missingPersistent: number;
                    };
                  };
                  failure?: string;
                }
              | undefined;
            try {
              lifecycle = JSON.parse(
                await readFile(
                  join(config.outputDirectory, "lifecycle.json"),
                  "utf8",
                ),
              );
            } catch {
              /* A missing lifecycle proves incomplete supervision. */
            }
            try {
              audit = JSON.parse(await readFile(auditPath, "utf8"));
            } catch {
              /* An uncaught asynchronous stream failure prevents the audit. */
            }
            if (process.env.OPENFILM_BENCHMARK_TEST_AUDIT_DIRECTORY) {
              await writeFile(
                join(
                  process.env.OPENFILM_BENCHMARK_TEST_AUDIT_DIRECTORY,
                  "listener-audit.json",
                ),
                JSON.stringify(audit, null, 2),
              );
            }
            expect.soft(lifecycle).toBeDefined();
            expect
              .soft(lifecycle?.nativeExit)
              .toEqual({ code: 0, signal: null });
            expect
              .soft(lifecycle?.serviceExit)
              .toEqual({ code: 0, signal: null });
            expect.soft(lifecycle?.serviceShutdown).toEqual(
              expect.objectContaining({
                method: "private-ipc",
                acknowledged: true,
              }),
            );
            expect.soft(lifecycle?.ownedServiceRemaining).toBe(false);
            expect.soft(audit).toBeDefined();
            expect.soft(audit?.after).toEqual(audit?.before);
            // Node's loader may pipe worker stdio to these streams. Its own
            // persistent onerror handler removes itself while unpiping on EPIPE;
            // the captured source/stack records this independently of our scope.
            // Verify only that the benchmark leaves no newly owned handler.
            // The separate Writable test checks preservation of an existing
            // application-owned handler without suppressing this actual EPIPE.
            expect.soft(audit?.streams).toEqual({
              stdout: expect.objectContaining({
                unexpectedAfter: 0,
              }),
              stderr: expect.objectContaining({
                unexpectedAfter: 0,
              }),
            });
            const owned = await owners();
            expect.soft(alive(owned.nativePid)).toBe(false);
            expect.soft(alive(owned.serverPid)).toBe(false);
            listenersRestored();
          } finally {
            await closeNormally();
            await done;
            const owned = await owners();
            await waitForNaturalExit(owned.nativePid);
            // Only a failed OLD launcher can strand the synthetic HTTP service.
            // Release that lab resource through its sentinel, not a forced kill.
            if (await stillRunning(owned.serverPid)) {
              await writeFile(
                stopService,
                "release only the synthetic lab service",
              );
              await waitForNaturalExit(owned.serverPid);
            }
          }
        },
        { externallySupervisedChildren: true },
      );
    },
  );

  it("finishes cleanup when native exits during the awaited collection-stopped callback", async () => {
    const running = async (pid: number | undefined) => {
      if (!alive(pid)) return false;
      if (process.platform === "linux" && pid !== undefined) {
        try {
          const state = await readFile(`/proc/${pid}/stat`, "utf8");
          if (state.slice(state.lastIndexOf(")") + 2).startsWith("Z "))
            return false;
        } catch {
          return alive(pid);
        }
      }
      return true;
    };
    const naturalExit = async (pid: number | undefined) => {
      const deadline = Date.now() + 3000;
      while (await running(pid)) {
        if (Date.now() >= deadline)
          throw new Error(`Synthetic child ${pid} did not exit naturally`);
        await delay(10);
      }
    };
    await scenario(
      async ({ config, owners, closeNormally, listenersRestored }) => {
        const root = join(config.outputDirectory, "..");
        const input = join(root, "race-config.json");
        const launcher = join(root, "race-launcher.mjs");
        const held = join(root, "collection-callback-held");
        const release = join(root, "release-collection-callback");
        const stopService = join(root, "stop-race-lab-service");
        const nativeExit = join(root, "native-normal-exit.json");
        const closeNative = join(root, "close-native");
        const emitter = config.arguments?.[0];
        if (!emitter) throw new Error("Missing native protocol emitter");
        await writeFile(input, JSON.stringify(config));
        await writeFile(
          config.serverScript,
          `import{createServer}from'node:http';import{existsSync}from'node:fs';const s=createServer((q,r)=>r.end('{"ok":true}'));const poll=setInterval(()=>{if(existsSync(${JSON.stringify(stopService)})){clearInterval(poll);s.close(()=>{if(process.connected)process.disconnect();});}},10);s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));${serviceShutdownProtocol({ beforeClose: "clearInterval(poll);" })}`,
        );
        await writeFile(
          emitter,
          `import{appendFileSync,existsSync,writeFileSync}from'node:fs';const emit=(kind,ms,extra={})=>appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind,nativeElapsedMs:ms,unixMs:Date.now(),clientElapsedMs:ms,clientTimeOriginMs:1000,...extra})+'\\n');emit('welcome-ready',10);emit('edit-enter',15);emit('edit-ready',20,{clipCount:2});const poll=setInterval(()=>{if(existsSync(${JSON.stringify(closeNative)})){clearInterval(poll);setTimeout(()=>{},150);}},10);process.on('exit',code=>writeFileSync(${JSON.stringify(nativeExit)},JSON.stringify({code,pid:process.pid})));`,
        );
        const module = pathToFileURL(
          resolve("scripts/native-benchmark/run.ts"),
        ).href;
        await writeFile(
          launcher,
          `import{readFile}from'node:fs/promises';import{existsSync,writeFileSync}from'node:fs';import{runNativeBenchmark}from${JSON.stringify(module)};const actualWrite=process.stdout.write.bind(process.stdout);process.stdout.write=(...args)=>{const callback=typeof args.at(-1)==='function'?args.pop():undefined;const finished=String(args[0]).includes('"event":"native-benchmark.collection-stopped"');return actualWrite(...args,error=>{if(finished&&!error){writeFileSync(${JSON.stringify(held)},'actual provisional output written; callback withheld');const poll=setInterval(()=>{if(existsSync(${JSON.stringify(release)})){clearInterval(poll);callback?.(error);}},10);}else callback?.(error);});};try{const result=await runNativeBenchmark(JSON.parse(await readFile(${JSON.stringify(input)},'utf8')));if(result.status!=='completed')process.exitCode=1;}catch(error){process.exitCode=1;process.stderr.write((error instanceof Error?error.message:String(error))+'\\n');}`,
        );
        const cli = spawn(process.execPath, ["--import", "tsx", launcher], {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let terminalEvidence:
          Promise<{ files?: string[]; error?: unknown }> | undefined;
        cli.stdout!.on("data", (chunk) => {
          stdout += String(chunk);
          if (
            !terminalEvidence &&
            stdout.includes('"event":"native-benchmark.finished"')
          ) {
            terminalEvidence = Promise.all([
              readFile(join(config.outputDirectory, "report.json"), "utf8"),
              readFile(join(config.outputDirectory, "lifecycle.json"), "utf8"),
            ]).then(
              (files) => ({ files }),
              (error) => ({ error }),
            );
          }
        });
        let stderr = "";
        cli.stderr!.on("data", (chunk) => {
          stderr += String(chunk);
        });
        let cliClosed = false;
        let completionTimedOut = false;
        const done = new Promise<{
          code: number | null;
          signal: string | null;
        }>((resolveExit, reject) => {
          cli.once("error", reject);
          cli.once("close", (code, signal) => {
            cliClosed = true;
            resolveExit({ code, signal });
          });
        });
        try {
          const deadline = Date.now() + 10000;
          let callbackHeld = false;
          while (Date.now() < deadline) {
            try {
              await readFile(held);
              callbackHeld = true;
              break;
            } catch {
              await delay(10);
            }
          }
          expect(callbackHeld).toBe(true);
          const collectionReport = JSON.parse(
            await readFile(join(config.outputDirectory, "report.json"), "utf8"),
          ) as { elapsedMs: number; completedAt: string };
          expect(
            benchmarkProtocolEvents(stdout).filter(
              (event) => event.event === "native-benchmark.finished",
            ),
          ).toHaveLength(0);
          const owned = await owners();
          expect(alive(owned.nativePid)).toBe(true);
          await closeNormally();
          await naturalExit(owned.nativePid);
          expect(JSON.parse(await readFile(nativeExit, "utf8"))).toEqual({
            code: 0,
            pid: owned.nativePid,
          });
          expect(cliClosed).toBe(false);
          // Native's actual exit precedes callback delivery. The runner must
          // inspect current child state before subscribing to an exit event.
          await writeFile(
            release,
            "deliver successful collection-stopped callback",
          );
          const completed = await Promise.race([
            done.then(() => true),
            delay(2500).then(() => false),
          ]);
          completionTimedOut = !completed;
          expect(completed).toBe(true);
          expect(await done).toEqual({ code: 0, signal: null });
          expect(stderr).not.toMatch(
            /Unhandled|Native benchmark finalization failed/iu,
          );
          const report = JSON.parse(
            await readFile(join(config.outputDirectory, "report.json"), "utf8"),
          ) as { status: string; elapsedMs: number; completedAt: string };
          expect(report.status).toBe("completed");
          // Normal-close supervision and persistence must not inflate the
          // measured collection duration or reset its frozen timestamp.
          expect(report.elapsedMs).toBe(collectionReport.elapsedMs);
          expect(report.completedAt).toBe(collectionReport.completedAt);
          const delivered = benchmarkProtocolEvents(stdout);
          const finished = delivered.filter(
            (event) => event.event === "native-benchmark.finished",
          );
          expect(finished).toHaveLength(1);
          expect(finished[0]).toEqual(
            expect.objectContaining({
              status: report.status,
              terminal: true,
              appLeftRunning: false,
            }),
          );
          const provisional = delivered.filter(
            (event) => event.event === "native-benchmark.collection-stopped",
          );
          expect(provisional).toHaveLength(1);
          expect(provisional[0]?.terminal).toBe(false);
          expect(provisional[0]?.status).toBeUndefined();
          const atFinished = await terminalEvidence;
          expect(atFinished?.error).toBeUndefined();
          expect(atFinished?.files).toHaveLength(2);
          expect(JSON.parse(atFinished!.files![0]!).status).toBe(report.status);
          const alreadyFinalized = JSON.parse(atFinished!.files![1]!);
          expect(alreadyFinalized.nativeExit).toEqual({
            code: 0,
            signal: null,
          });
          expect(alreadyFinalized.serviceExit).toEqual({
            code: 0,
            signal: null,
          });
          expect(alreadyFinalized.serviceShutdown.acknowledged).toBe(true);
          expect(alreadyFinalized.ownedServiceRemaining).toBe(false);
          const lifecycle = JSON.parse(
            await readFile(
              join(config.outputDirectory, "lifecycle.json"),
              "utf8",
            ),
          ) as {
            nativeExit: { code: number; signal: string | null };
            serviceExit: { code: number; signal: string | null };
            serviceShutdown: { acknowledged: boolean };
            ownedServiceRemaining: boolean;
          };
          expect(lifecycle.nativeExit).toEqual({ code: 0, signal: null });
          expect(lifecycle.serviceExit).toEqual({ code: 0, signal: null });
          expect(lifecycle.serviceShutdown.acknowledged).toBe(true);
          expect(lifecycle.ownedServiceRemaining).toBe(false);
          expect(alive(owned.nativePid)).toBe(false);
          expect(alive(owned.serverPid)).toBe(false);
          listenersRestored();
        } finally {
          await closeNormally();
          await writeFile(release, "release lab callback during teardown");
          const owned = await owners();
          await naturalExit(owned.nativePid);
          if (!cliClosed && !completionTimedOut)
            await Promise.race([done, delay(2500)]);
          // Only the isolated OLD lab runner can hang after native already exited
          // normally. Terminate that runner, never the native app or service.
          if (!cliClosed) cli.kill("SIGKILL");
          await done;
          if (await running(owned.serverPid)) {
            await writeFile(
              stopService,
              "release only synthetic HTTP lab service",
            );
            await naturalExit(owned.serverPid);
          }
        }
      },
      { externallySupervisedChildren: true },
    );
  });

  it("records actual service runtime identity when a different Node executable path is selected", async () => {
    await scenario(
      async ({ config, signal, owners, closeNormally, listenersRestored }) => {
        // Use a real copied binary, not a fabricated --version response or a
        // network-downloaded runtime. The version may equal the runner's; its
        // independently observed executable path must identify the actual child.
        const selectedNode = join(
          config.outputDirectory,
          "..",
          process.platform === "win32" ? "selected-node.exe" : "selected-node",
        );
        await copyFile(process.execPath, selectedNode);
        const expectedHash = createHash("sha256")
          .update(await readFile(selectedNode))
          .digest("hex");
        const result = await runThenCloseNormally(
          { ...config, nodeExecutable: selectedNode },
          signal,
          closeNormally,
        );
        expect(result.status).toBe("completed");
        const manifest = JSON.parse(
          await readFile(join(config.outputDirectory, "manifest.json"), "utf8"),
        ) as {
          config: { nodeExecutable: string };
          environment: {
            node: string;
            serviceNode?: { version: string; executable: string };
          };
          identities: {
            selectedNodeExecutable?: string;
            selectedNodeSha256?: string;
            serviceNodeSha256?: string;
          };
        };
        expect(manifest.config.nodeExecutable).toBe(selectedNode);
        expect(manifest.environment.node).toBe(process.version);
        expect(manifest.environment.serviceNode).toEqual({
          version: process.version,
          executable: selectedNode,
        });
        expect(manifest.environment.serviceNode?.executable).not.toBe(
          process.execPath,
        );
        expect(manifest.identities.selectedNodeSha256).toBe(expectedHash);
        expect(manifest.identities.serviceNodeSha256).toBe(expectedHash);
        expect(manifest.identities.selectedNodeExecutable).toBe(selectedNode);
        expect(alive((await owners()).serverPid)).toBe(false);
        listenersRestored();
      },
    );
  });

  it("requests graceful owned-service IPC shutdown after native closes", async () => {
    await scenario(
      async ({
        config,
        signal,
        owners,
        closeNormally,
        listenersRestored,
        expectFinishedStatus,
      }) => {
        const closedMarker = join(
          config.outputDirectory,
          "..",
          "service-closed",
        );
        const exitMarker = join(config.outputDirectory, "..", "service-exit");
        await writeFile(
          config.serverScript,
          `import{createServer}from'node:http';import{writeFileSync}from'node:fs';const s=createServer((q,r)=>r.end('{"ok":true}'));let ipcRequested=false,sigtermReceived=false,ackSent=false;s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('message',async(message)=>{if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL!=='1'||message?.type!=='openfilm.benchmark.shutdown'||typeof message.requestId!=='string')return;ipcRequested=true;await new Promise((resolve,reject)=>s.close(error=>error?reject(error):resolve()));writeFileSync(${JSON.stringify(closedMarker)},JSON.stringify({pid:process.pid,serverListening:s.listening}));process.send({type:'openfilm.benchmark.closed',requestId:message.requestId},error=>{if(error){process.exitCode=1;return;}ackSent=true;process.disconnect();});});if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL==='1'&&process.send)process.send({type:'openfilm.benchmark.control-ready',runtime:{version:process.version,executable:process.execPath}});process.once('SIGTERM',()=>{sigtermReceived=true;s.close();});process.on('exit',code=>writeFileSync(${JSON.stringify(exitMarker)},JSON.stringify({pid:process.pid,code,ipcRequested,sigtermReceived,ackSent})));`,
        );
        const result = await runThenCloseNormally(
          config,
          signal,
          closeNormally,
        );
        expect(result.status).toBe("completed");
        expectFinishedStatus("completed");
        const owned = await owners();
        let closed: { pid: number; serverListening: boolean } | undefined;
        try {
          closed = JSON.parse(await readFile(closedMarker, "utf8"));
        } catch {
          // Missing IPC marker is a regression, not a fixture setup error.
        }
        expect
          .soft(closed)
          .toEqual({ pid: owned.serverPid, serverListening: false });
        const exit = JSON.parse(await readFile(exitMarker, "utf8")) as {
          pid: number;
          code: number;
          ipcRequested: boolean;
          sigtermReceived: boolean;
          ackSent: boolean;
        };
        expect.soft(exit).toEqual({
          pid: owned.serverPid,
          code: 0,
          ipcRequested: true,
          sigtermReceived: false,
          ackSent: true,
        });
        const lifecycle = JSON.parse(
          await readFile(
            join(config.outputDirectory, "lifecycle.json"),
            "utf8",
          ),
        ) as {
          nativeExit: { code: number; signal: string | null };
          ownedServiceRemaining: boolean;
          serviceExit: { code: number; signal: string | null };
          serviceShutdown: {
            method: string;
            requestId: string;
            acknowledged: boolean;
          };
        };
        expect.soft(lifecycle.nativeExit).toEqual({ code: 0, signal: null });
        expect.soft(lifecycle.ownedServiceRemaining).toBe(false);
        expect.soft(lifecycle.serviceExit).toEqual({ code: 0, signal: null });
        expect.soft(lifecycle.serviceShutdown.method).toBe("private-ipc");
        expect
          .soft(lifecycle.serviceShutdown.requestId)
          .toMatch(/^[0-9a-f-]{36}$/iu);
        expect.soft(lifecycle.serviceShutdown.acknowledged).toBe(true);
        expect.soft(alive(owned.nativePid)).toBe(false);
        expect.soft(alive(owned.serverPid)).toBe(false);
        listenersRestored();
      },
    );
  });

  it.each(["nonzero exit", "SIGTERM"] as const)(
    "fails when native terminates after collection: %s",
    async (mode) => {
      await scenario(
        async ({
          config,
          signal,
          owners,
          closeNormally,
          listenersRestored,
          expectFinishedStatus,
        }) => {
          const crashSignal = join(
            config.outputDirectory,
            "..",
            "crash-native",
          );
          const closeSignal = join(
            config.outputDirectory,
            "..",
            "close-native",
          );
          const emitter = config.arguments?.[0];
          if (!emitter)
            throw new Error("Native protocol fixture lacks its emitter");
          await writeFile(
            emitter,
            `import{appendFileSync,existsSync}from'node:fs';const emit=(kind,ms,extra={})=>appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind,nativeElapsedMs:ms,unixMs:Date.now(),clientElapsedMs:ms,clientTimeOriginMs:1000,...extra})+'\\n');emit('welcome-ready',10);emit('edit-enter',15);emit('edit-ready',20,{clipCount:2});const poll=setInterval(()=>{if(existsSync(${JSON.stringify(crashSignal)}))process.exit(7);if(existsSync(${JSON.stringify(closeSignal)})){clearInterval(poll);setTimeout(()=>{},150);}},10);`,
          );
          let failure: unknown;
          let returned:
            Awaited<ReturnType<typeof runNativeBenchmark>> | undefined;
          try {
            returned = await runThenCloseNormally(
              config,
              signal,
              closeNormally,
              async () => {
                const terminal = JSON.parse(
                  await readFile(
                    join(config.outputDirectory, "report.json"),
                    "utf8",
                  ),
                ) as { status: string };
                expect(terminal.status).toBe("completed");
                const owned = await owners();
                expect(alive(owned.nativePid)).toBe(true);
                expect(alive(owned.serverPid)).toBe(true);
                // Both faults affect only the actual test-owned native child after
                // collection; the owned service remains healthy for cleanup.
                if (mode === "nonzero exit")
                  await writeFile(crashSignal, "actual native process.exit(7)");
                else process.kill(owned.nativePid!, "SIGTERM");
                await awaitExit(owned.nativePid!);
              },
            );
          } catch (error) {
            failure = error;
          }
          const visibleFailure =
            failure instanceof Error ? failure.message : returned?.failure;
          expect
            .soft(visibleFailure ?? "")
            .toMatch(/native.*(exit|fail|signal|crash|close|shutdown)/iu);
          if (returned) expect.soft(returned.status).toBe("failed");
          const report = JSON.parse(
            await readFile(join(config.outputDirectory, "report.json"), "utf8"),
          ) as { status: string; failure?: string };
          expect.soft(report.status).toBe("failed");
          expectFinishedStatus("failed");
          expect
            .soft(report.failure ?? "")
            .toMatch(/native.*(exit|fail|signal|crash|close|shutdown)/iu);
          const lifecycle = JSON.parse(
            await readFile(
              join(config.outputDirectory, "lifecycle.json"),
              "utf8",
            ),
          ) as {
            nativeExit: { code: number | null; signal: string | null };
            serviceExit: { code: number; signal: string | null };
            serviceShutdown: { method: string; acknowledged: boolean };
            ownedServiceRemaining: boolean;
          };
          if (mode === "nonzero exit")
            expect
              .soft(lifecycle.nativeExit)
              .toEqual({ code: 7, signal: null });
          else if (process.platform === "win32") {
            // Windows maps SIGTERM to forced termination, not a Unix signal.
            expect.soft(lifecycle.nativeExit.code).not.toBe(0);
            expect.soft(lifecycle.nativeExit.signal).toBeNull();
          } else
            expect
              .soft(lifecycle.nativeExit)
              .toEqual({ code: null, signal: "SIGTERM" });
          expect.soft(lifecycle.serviceExit).toEqual({ code: 0, signal: null });
          expect.soft(lifecycle.serviceShutdown).toEqual(
            expect.objectContaining({
              method: "private-ipc",
              acknowledged: true,
            }),
          );
          expect.soft(lifecycle.ownedServiceRemaining).toBe(false);
          const owned = await owners();
          expect.soft(alive(owned.nativePid)).toBe(false);
          expect.soft(alive(owned.serverPid)).toBe(false);
          listenersRestored();
        },
      );
    },
  );

  it.each([
    { label: "missing ACK", ack: "none", exitCode: 0, acknowledged: false },
    {
      label: "mismatched request ID",
      ack: "mismatched",
      exitCode: 0,
      acknowledged: false,
    },
    {
      label: "matching ACK followed by nonzero exit",
      ack: "matching",
      exitCode: 3,
      acknowledged: true,
    },
  ])(
    "rejects incomplete private IPC shutdown: $label",
    async ({ ack, exitCode, acknowledged }) => {
      await scenario(
        async ({
          config,
          signal,
          owners,
          listenersRestored,
          expectFinishedStatus,
        }) => {
          await writeFile(
            config.serverScript,
            `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('message',async(message)=>{if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL!=='1'||message?.type!=='openfilm.benchmark.shutdown')return;await new Promise((resolve,reject)=>s.close(error=>error?reject(error):resolve()));const ack=${JSON.stringify(ack)};if(ack==='none'){process.disconnect();return;}process.send({type:'openfilm.benchmark.closed',requestId:ack==='matching'?message.requestId:message.requestId+'-wrong'},error=>{process.exitCode=error?2:${exitCode};process.disconnect();});});if(process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL==='1'&&process.send)process.send({type:'openfilm.benchmark.control-ready',runtime:{version:process.version,executable:process.execPath}});process.once('SIGTERM',()=>s.close(()=>{if(process.connected)process.disconnect();}));`,
          );
          let failure: unknown;
          let returned:
            Awaited<ReturnType<typeof runNativeBenchmark>> | undefined;
          try {
            returned = await runNativeBenchmark(config, { signal });
          } catch (error) {
            failure = error;
          }
          const visibleFailure =
            failure instanceof Error ? failure.message : returned?.failure;
          expect
            .soft(visibleFailure ?? "")
            .toMatch(/service.*(shutdown|exit|acknowledge|cleanup|close)/iu);
          if (returned) expect.soft(returned.status).toBe("failed");
          const report = JSON.parse(
            await readFile(join(config.outputDirectory, "report.json"), "utf8"),
          ) as { status: string; failure?: string };
          expect.soft(report.status).toBe("failed");
          expectFinishedStatus("failed");
          expect
            .soft(report.failure ?? "")
            .toMatch(/service.*(shutdown|exit|acknowledge|cleanup|close)/iu);
          const lifecycle = JSON.parse(
            await readFile(
              join(config.outputDirectory, "lifecycle.json"),
              "utf8",
            ),
          ) as {
            nativeExit: { code: number; signal: string | null };
            serviceExit: { code: number; signal: string | null };
            serviceShutdown: {
              method: string;
              requestId: string;
              acknowledged: boolean;
            };
            ownedServiceRemaining: boolean;
          };
          expect.soft(lifecycle.nativeExit).toEqual({ code: 0, signal: null });
          expect
            .soft(lifecycle.serviceExit)
            .toEqual({ code: exitCode, signal: null });
          expect.soft(lifecycle.serviceShutdown.method).toBe("private-ipc");
          expect
            .soft(lifecycle.serviceShutdown.requestId)
            .toMatch(/^[0-9a-f-]{36}$/iu);
          expect
            .soft(lifecycle.serviceShutdown.acknowledged)
            .toBe(acknowledged);
          expect.soft(lifecycle.ownedServiceRemaining).toBe(false);
          const owned = await owners();
          expect.soft(alive(owned.nativePid)).toBe(false);
          expect.soft(alive(owned.serverPid)).toBe(false);
          listenersRestored();
        },
      );
    },
  );

  it("fails when the owned service exits while supervising a completed native collection", async () => {
    await scenario(
      async ({
        config,
        signal,
        owners,
        closeNormally,
        listenersRestored,
        expectFinishedStatus,
      }) => {
        const crashSignal = join(config.outputDirectory, "..", "crash-service");
        await writeFile(
          config.serverScript,
          `import{createServer}from'node:http';import{existsSync}from'node:fs';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));const poll=setInterval(()=>{if(existsSync(${JSON.stringify(crashSignal)}))process.exit(7);},10);process.once('SIGTERM',()=>{clearInterval(poll);s.close(()=>{if(process.connected)process.disconnect();});});${serviceShutdownProtocol({ beforeClose: "clearInterval(poll);" })}`,
        );
        // Keep native open after collection until the test explicitly requests
        // normal shutdown, matching the workstation runner's supervision phase.
        faults.afterSample = undefined;
        let settled = false;
        const pending = runNativeBenchmark(config, { signal }).then(
          (result) => {
            settled = true;
            return { result, error: undefined };
          },
          (error: unknown) => {
            settled = true;
            return { result: undefined, error };
          },
        );
        try {
          const deadline = Date.now() + 10000;
          let terminal: { status: string } | undefined;
          while (Date.now() < deadline) {
            try {
              const observed = JSON.parse(
                await readFile(
                  join(config.outputDirectory, "report.json"),
                  "utf8",
                ),
              ) as { status: string };
              if (observed.status !== "collecting") {
                terminal = observed;
                break;
              }
            } catch {
              // Wait for a complete report publication by the actual runner.
            }
            await delay(10);
          }
          expect(terminal?.status).toBe("completed");
          const owned = await owners();
          expect(alive(owned.nativePid)).toBe(true);
          expect(alive(owned.serverPid)).toBe(true);
          // The real service exits with a nonzero code after the successful
          // collection, while native remains open. No native signal is sent.
          await writeFile(
            crashSignal,
            "actual owned service exit after collection",
          );
          expect(owned.serverPid).toBeGreaterThan(0);
          await awaitExit(owned.serverPid!);
          await delay(100);
          expect.soft(alive(owned.nativePid)).toBe(true);
          expect.soft(settled).toBe(false);
        } finally {
          await closeNormally();
          // Always wait for supervised normal shutdown, even if a phase assertion
          // fails, so this regression does not need to force-close the native app.
          await pending;
        }
        const outcome = await pending;
        const visibleFailure =
          outcome.error instanceof Error
            ? outcome.error.message
            : outcome.result?.failure;
        expect
          .soft(visibleFailure ?? "")
          .toMatch(/service.*(exit|fail|stop|crash)/iu);
        if (outcome.result) expect.soft(outcome.result.status).toBe("failed");
        const report = JSON.parse(
          await readFile(join(config.outputDirectory, "report.json"), "utf8"),
        ) as { status: string; failure?: string };
        expect.soft(report.status).toBe("failed");
        expectFinishedStatus("failed");
        expect
          .soft(report.failure ?? "")
          .toMatch(/service.*(exit|fail|stop|crash)/iu);
        const lifecycle = JSON.parse(
          await readFile(
            join(config.outputDirectory, "lifecycle.json"),
            "utf8",
          ),
        ) as {
          nativeExit: { code: number; signal: string | null };
          ownedServiceRemaining: boolean;
        };
        expect.soft(lifecycle.nativeExit.code).toBe(0);
        expect.soft(lifecycle.nativeExit.signal).toBeNull();
        expect.soft(lifecycle.ownedServiceRemaining).toBe(false);
        const owned = await owners();
        expect.soft(alive(owned.nativePid)).toBe(false);
        expect.soft(alive(owned.serverPid)).toBe(false);
        listenersRestored();
      },
    );
  });

  it("includes Edit readiness published by the actual child during the final awaited sample", async () => {
    await scenario(
      async ({
        config,
        signal,
        owners,
        closeNormally,
        publishDeferredEdit,
        listenersRestored,
      }) => {
        let published = false;
        faults.afterSample = async (snapshot) => {
          if (!published && snapshot.rootPid === (await owners()).nativePid) {
            published = true;
            await publishDeferredEdit();
            // The deadline is crossed after new native evidence is already on
            // disk, while the runner still holds its welcome-only event list.
            await delay(150);
            await closeNormally();
          }
        };
        const result = await runNativeBenchmark(config, { signal });
        expect(published).toBe(true);
        expect(result.status).toBe("completed");
        expect(result.scenario.matchingEditVisits).toBe(1);
        expect(result.checkpoints.editVisits).toHaveLength(1);
        expect(result.checkpoints.editVisits[0]?.clipCount).toBe(2);
        const saved = JSON.parse(
          await readFile(join(config.outputDirectory, "report.json"), "utf8"),
        ) as typeof result;
        expect(saved.status).toBe("completed");
        expect(saved.checkpoints.editVisits).toEqual(
          result.checkpoints.editVisits,
        );
        expect(alive((await owners()).serverPid)).toBe(false);
        listenersRestored();
      },
      { deferredEdit: true },
    );
  });

  it("reports incomplete service cleanup without force killing a slow graceful shutdown", async () => {
    await scenario(
      async ({ config, signal, owners, listenersRestored }) => {
        let failure: unknown;
        let returned:
          Awaited<ReturnType<typeof runNativeBenchmark>> | undefined;
        try {
          returned = await runNativeBenchmark(config, { signal });
        } catch (error) {
          failure = error;
        }
        const owned = await owners();
        // Capture whether the runner abandoned a live service before waiting
        // for that same test-owned service to finish its normal shutdown.
        const serviceWasLive = alive(owned.serverPid);
        if (owned.serverPid !== undefined) await awaitExit(owned.serverPid);
        expect.soft(returned).toBeUndefined();
        expect.soft(failure).toBeInstanceOf(Error);
        expect
          .soft(failure instanceof Error ? failure.message : "")
          .toMatch(
            /service.*(cleanup|shutdown|stop|exit|remain)|cleanup.*service/iu,
          );
        expect.soft(serviceWasLive).toBe(true);
        expect.soft(alive(owned.nativePid)).toBe(false);
        expect.soft(alive(owned.serverPid)).toBe(false);
        const report = JSON.parse(
          await readFile(join(config.outputDirectory, "report.json"), "utf8"),
        ) as { status: string; failure?: string };
        expect.soft(report.status).toBe("failed");
        expect
          .soft(report.failure)
          .toMatch(
            /service.*(cleanup|shutdown|stop|exit|remain)|cleanup.*service/iu,
          );
        const lifecycle = JSON.parse(
          await readFile(
            join(config.outputDirectory, "lifecycle.json"),
            "utf8",
          ),
        ) as { ownedServiceRemaining: boolean; nativeExit: { code: number } };
        expect.soft(lifecycle.ownedServiceRemaining).toBe(true);
        expect.soft(lifecycle.nativeExit.code).toBe(0);
        listenersRestored();
      },
      { serviceCloseDelayMs: 2800 },
    );
  });

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
      await scenario(
        async ({
          config,
          signal,
          owners,
          listenersRestored,
          expectFinishedStatus,
        }) => {
          for (const name of writeNames) faults.writeNames.add(name);
          let error: unknown;
          let result:
            Awaited<ReturnType<typeof runNativeBenchmark>> | undefined;
          try {
            result = await runNativeBenchmark(config, { signal });
          } catch (caught) {
            error = caught;
          }
          const visibleFailure =
            error instanceof Error ? error.message : result?.failure;
          expect.soft(visibleFailure).toMatch(/ENOSPC/iu);
          if (result) expect.soft(result.status).toBe("failed");
          expectFinishedStatus("failed");
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
        },
      );
    },
  );
});
