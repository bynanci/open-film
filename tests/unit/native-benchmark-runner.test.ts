import { describe, expect, it } from "vitest";
import {
  validateBenchmarkConfig,
  runNativeBenchmark,
  summarizeMemory,
} from "../../scripts/native-benchmark/run";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      const manifest = join(root, "fixture.json");
      await writeFile(
        service,
        `import {createServer} from 'node:http'; const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end('{"ok":true}');});s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close());`,
      );
      await writeFile(
        emitter,
        `import {appendFileSync} from 'node:fs'; const emit=(kind,ms,extra={})=>appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind,nativeElapsedMs:ms,unixMs:Date.now(),clientElapsedMs:ms,clientTimeOriginMs:1000,...extra})+'\\n'); emit('welcome-ready',10);emit('edit-enter',100);emit('edit-ready',125,{clipCount:500});setTimeout(()=>{},700);`,
      );
      await writeFile(
        manifest,
        '{"fixtureVersion":"1.0.0","counts":{"assets":2000,"clips":500,"beats":10}}',
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
      const fixture = join(root, "fixture.json");
      await writeFile(
        service,
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close());`,
      );
      await writeFile(binary, "this is not an executable", { mode: 0o600 });
      await writeFile(
        fixture,
        '{"fixtureVersion":"1.0.0","counts":{"assets":2000,"clips":500,"beats":10}}',
      );
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
        const fixture = join(root, "fixture.json");
        await writeFile(
          service,
          `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})));process.on('SIGTERM',()=>s.close());`,
        );
        await writeFile(
          emitter,
          `import{appendFileSync}from'node:fs';appendFileSync(process.env.OPENFILM_NATIVE_BENCHMARK_EVENTS,JSON.stringify({runId:process.env.OPENFILM_NATIVE_BENCHMARK_RUN_ID,pid:process.pid,kind:'welcome-ready',nativeElapsedMs:10,clientElapsedMs:10,clientTimeOriginMs:1000,unixMs:Date.now()})+'\\n');setTimeout(()=>{},1200);`,
        );
        await writeFile(
          fixture,
          '{"fixtureVersion":"1.0.0","counts":{"assets":2000,"clips":500,"beats":10}}',
        );
        const outputDirectory = join(root, "evidence");
        const result = await runNativeBenchmark({
          ...config,
          executable: process.execPath,
          arguments: [emitter],
          serverScript: service,
          fixtureManifest: fixture,
          outputDirectory,
          project: projectRequired ? root : undefined,
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
      const fixture = join(root, "fixture.json");
      const sentinel = join(root, "native-launched");
      await writeFile(
        service,
        `import{createServer}from'node:http';const s=createServer((q,r)=>r.end('{"ok":true}'));s.listen(4310,'127.0.0.1',()=>setTimeout(()=>console.log(JSON.stringify({event:'server.ready',host:'127.0.0.1',port:4310})),300));process.on('SIGTERM',()=>{s.close();process.exit(0)});`,
      );
      await writeFile(
        emitter,
        `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(sentinel)},'unexpected native launch');`,
      );
      await writeFile(
        fixture,
        '{"fixtureVersion":"1.0.0","counts":{"assets":2000,"clips":500,"beats":10}}',
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
