/** Local native runtime measurement. It never certifies workstation QA. */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  sampleProcessMemory,
  type ProcessMemorySnapshot,
} from "./process-memory";
import {
  mergeMemorySnapshots,
  parseNativeEvents,
  summarizeNativeEvents,
  type NativeEvent,
} from "./record";

export interface BenchmarkConfig {
  candidateSha: string;
  label: string;
  environmentKind: "workstation" | "cloud-smoke";
  executable: string;
  arguments?: string[];
  serverScript: string;
  nodeExecutable?: string;
  project?: string;
  fixtureManifest: string;
  outputDirectory: string;
  durationSeconds: number;
  intervalSeconds: number;
  startupTimeoutSeconds: number;
  cacheCondition: string;
  webviewVersion: string;
  gpu?: string;
  display: { width: number; height: number; scale: number };
}
export function validateBenchmarkConfig(value: unknown): BenchmarkConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Benchmark config must be an object");
  const data = value as Record<string, unknown>;
  const allowed = [
    "candidateSha",
    "label",
    "environmentKind",
    "executable",
    "arguments",
    "serverScript",
    "nodeExecutable",
    "project",
    "fixtureManifest",
    "outputDirectory",
    "durationSeconds",
    "intervalSeconds",
    "startupTimeoutSeconds",
    "cacheCondition",
    "webviewVersion",
    "gpu",
    "display",
  ];
  for (const key of Object.keys(data))
    if (!allowed.includes(key))
      throw new Error(`Unknown benchmark setting: ${key}`);
  if (
    typeof data.candidateSha !== "string" ||
    !/^[a-f0-9]{40}$/iu.test(data.candidateSha)
  )
    throw new Error("candidateSha must be a full 40-character SHA");
  if (!["workstation", "cloud-smoke"].includes(String(data.environmentKind)))
    throw new Error(
      "environmentKind must explicitly identify workstation or cloud-smoke",
    );
  for (const key of [
    "label",
    "executable",
    "serverScript",
    "fixtureManifest",
    "outputDirectory",
    "cacheCondition",
    "webviewVersion",
  ])
    if (typeof data[key] !== "string" || !String(data[key]).trim())
      throw new Error(`${key} must be nonblank`);
  for (const key of ["nodeExecutable", "project", "gpu"])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "string" || !String(data[key]).trim())
    )
      throw new Error(`${key} must be nonblank`);
  if (
    data.arguments !== undefined &&
    (!Array.isArray(data.arguments) ||
      data.arguments.some(
        (arg) => typeof arg !== "string" || arg.includes("\0"),
      ))
  )
    throw new Error("arguments must be an array of strings without NUL");
  for (const key of [
    "durationSeconds",
    "intervalSeconds",
    "startupTimeoutSeconds",
  ])
    if (
      typeof data[key] !== "number" ||
      !Number.isFinite(data[key]) ||
      Number(data[key]) <= 0
    )
      throw new Error(`${key} must be a positive finite number`);
  if (
    Number(data.durationSeconds) > 86400 ||
    Number(data.intervalSeconds) < 0.1 ||
    Number(data.intervalSeconds) > Number(data.durationSeconds) ||
    Number(data.startupTimeoutSeconds) > 3600
  )
    throw new Error(
      "duration/interval/startup timeout exceed measurement bounds",
    );
  const display = data.display as Record<string, unknown> | undefined;
  if (
    !display ||
    Object.keys(display).some(
      (key) => !["width", "height", "scale"].includes(key),
    ) ||
    ["width", "height", "scale"].some(
      (key) =>
        typeof display[key] !== "number" ||
        !Number.isFinite(display[key]) ||
        Number(display[key]) <= 0,
    )
  )
    throw new Error("display must record positive width, height and scale");
  return data as unknown as BenchmarkConfig;
}
const hashFile = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
async function projectFileHashes(directory?: string) {
  if (!directory) return undefined;
  const files: Record<string, string> = {};
  for (const name of [
    "project.json",
    "database.sqlite",
    "database.sqlite-wal",
  ]) {
    try {
      files[name] = await hashFile(join(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files;
}
async function regularFile(path: string) {
  if (!isAbsolute(path) || !(await stat(path)).isFile())
    throw new Error(`Expected an absolute file path: ${path}`);
}
async function freeServicePort() {
  const probe = createServer();
  await new Promise<void>((done, reject) => {
    probe.once("error", () =>
      reject(
        new Error(
          "Port 4310 is occupied. Close other OpenFilm services before measurement.",
        ),
      ),
    );
    probe.listen(4310, "127.0.0.1", done);
  });
  await new Promise<void>((done, reject) =>
    probe.close((error) => (error ? reject(error) : done())),
  );
}
async function startOwnedService(
  config: BenchmarkConfig,
  directory: string,
  stopped: () => boolean,
  publishOwner: (service: ChildProcess) => Promise<void>,
) {
  const log = openSync(join(directory, "service.log"), "wx");
  const env: NodeJS.ProcessEnv = { ...process.env, OPENFILM_PORT: "4310" };
  if (config.project) env.OPENFILM_PROJECT = config.project;
  else delete env.OPENFILM_PROJECT;
  const service = spawn(
    config.nodeExecutable ?? process.execPath,
    [config.serverScript],
    { env, stdio: ["ignore", log, log], windowsHide: true, detached: true },
  );
  closeSync(log);
  let ready = false;
  let failure: Error | undefined;
  service.once("error", (error) => {
    failure = error;
  });
  service.once("exit", () => {
    failure = new Error("Owned local service exited");
  });
  const start = performance.now();
  try {
    await publishOwner(service);
    while (!ready) {
      if (stopped())
        throw new Error("Service startup interrupted before native launch");
      if (failure) throw failure;
      for (const line of (
        await readFile(join(directory, "service.log"), "utf8")
      )
        .split("\n")
        .slice(0, -1)) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (
            event.event === "server.ready" &&
            event.host === "127.0.0.1" &&
            event.port === 4310
          )
            ready = true;
        } catch {
          /* Other output is not service readiness evidence. */
        }
      }
      if (performance.now() - start > config.startupTimeoutSeconds * 1000)
        throw new Error(
          "Owned local service did not publish server.ready before timeout",
        );
      await delay(50);
    }
    if (failure) throw failure;
    const response = await fetch("http://127.0.0.1:4310/api/health", {
      signal: AbortSignal.timeout(5000),
    });
    if (
      !response.ok ||
      ((await response.json()) as { ok?: boolean }).ok !== true
    )
      throw new Error("Owned local service health check failed");
    return { service };
  } catch (error) {
    service.kill();
    throw error;
  }
}
interface MemorySample {
  elapsedMs: number;
  collectionMs: number;
  roots: ProcessMemorySnapshot[];
  combined: ReturnType<typeof mergeMemorySnapshots>;
}
/** Statistics describe complete rooted-tree samples only, never leak freedom. */
export function summarizeMemory(samples: MemorySample[]) {
  return Object.fromEntries(
    (["rssBytes", "privateBytes", "pssBytes"] as const).map((metric) => {
      const values = samples
        .map((sample) => sample.combined.totals[metric].value)
        .filter((value): value is number => value !== undefined);
      return [
        metric,
        {
          completeSamples: values.length,
          incompleteSamples: samples.length - values.length,
          first: values.at(0),
          last: values.at(-1),
          peak: values.length
            ? values.reduce((peak, value) => Math.max(peak, value), 0)
            : undefined,
        },
      ];
    }),
  );
}
export async function runNativeBenchmark(
  config: BenchmarkConfig,
  options: { signal?: AbortSignal } = {},
) {
  validateBenchmarkConfig(config);
  await regularFile(config.executable);
  await regularFile(config.serverScript);
  await regularFile(config.fixtureManifest);
  const fixture = JSON.parse(
    await readFile(config.fixtureManifest, "utf8"),
  ) as {
    fixtureVersion?: string;
    counts?: { assets: number; clips: number; beats: number };
  };
  if (
    fixture.fixtureVersion !== "1.0.0" ||
    !fixture.counts ||
    [fixture.counts.assets, fixture.counts.clips, fixture.counts.beats].some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    fixture.counts.clips > fixture.counts.assets ||
    fixture.counts.beats > fixture.counts.clips
  )
    throw new Error(
      "Expected a versioned native fixture manifest with valid asset/clip/beat counts",
    );
  if (config.nodeExecutable) await regularFile(config.nodeExecutable);
  if (
    config.project &&
    (!isAbsolute(config.project) || !(await stat(config.project)).isDirectory())
  )
    throw new Error("project must be an existing absolute directory");
  await freeServicePort();
  const directory = resolve(config.outputDirectory);
  // Exclusive creation protects previous raw evidence; never overwrite a run.
  await mkdir(directory);
  const runId = randomUUID();
  const eventPath = join(directory, "native-events.jsonl");
  await writeFile(eventPath, "", { flag: "wx" });
  await writeFile(join(directory, "operator-markers.jsonl"), "", {
    flag: "wx",
  });
  const start = performance.now();
  const manifest = {
    schemaVersion: "1.0.0",
    verification: "measurement-only",
    runId,
    config,
    fixtureCounts: fixture.counts,
    createdAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      memoryBytes: totalmem(),
      node: process.version,
    },
    identities: {
      executableSha256: await hashFile(config.executable),
      serverSha256: await hashFile(config.serverScript),
      fixtureManifestSha256: await hashFile(config.fixtureManifest),
      projectInitialFiles: await projectFileHashes(config.project),
    },
    ownership: {} as { serverPid?: number; nativePid?: number },
  };
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  let owned: Awaited<ReturnType<typeof startOwnedService>> | undefined;
  let native: ChildProcess | undefined;
  let nativeFailure: Error | undefined;
  let stopped = options.signal?.aborted ?? false;
  let status = "collecting";
  let failure: string | undefined;
  let serviceReadyMs: number | undefined;
  let nativeSpawnMs: number | undefined;
  let firstCheckpointObservedMs: number | undefined;
  let events: NativeEvent[] = [];
  const samples: MemorySample[] = [];
  const expectedIdentities = new Map<number, string>();
  const interrupt = () => {
    stopped = true;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  options.signal?.addEventListener("abort", interrupt, { once: true });
  const report = () => ({
    schemaVersion: "1.0.0",
    verification: "measurement-only",
    runId,
    candidateSha: config.candidateSha,
    environmentKind: config.environmentKind,
    status,
    failure,
    completedAt: new Date().toISOString(),
    elapsedMs: performance.now() - start,
    serviceReadyMs,
    nativeSpawnMs,
    firstCheckpointObservedMs,
    spawnToFirstCheckpointObservedMs:
      firstCheckpointObservedMs !== undefined && nativeSpawnMs !== undefined
        ? firstCheckpointObservedMs - nativeSpawnMs
        : undefined,
    checkpoints: summarizeNativeEvents(events),
    scenario: {
      expectedClipCount: fixture.counts!.clips,
      matchingEditVisits: summarizeNativeEvents(events).editVisits.filter(
        (visit) => visit.clipCount === fixture.counts!.clips,
      ).length,
      projectEditRequired: !!config.project,
    },
    memory: summarizeMemory(samples),
    samples: samples.length,
    nativeExit: native
      ? { code: native.exitCode, signal: native.signalCode }
      : undefined,
    limits: [
      "Candidate SHA and machine/display/cache/WebView metadata are operator declarations; artifact hashes bind actual inputs.",
      "Native elapsed time begins at Rust run entry, not OS process creation. Checkpoints are IPC receipts after two animation-frame opportunities, not verified screen presentation or media decode.",
      "Spawn-to-observed readiness includes file polling; it is an upper bound, not a renderer latency measure.",
      "Service readiness precedes shell launch. This measures checkout-built native runtime with an owned prestarted service, not installer or single-click packaged startup.",
      "Memory sampling starts after UI readiness, so startup peak memory is not measured.",
      "Memory totals cover currently rooted native/service descendants; detached/reparented/shared helpers may be outside coverage. RSS may count shared pages repeatedly.",
      "No forced GC is requested. Peak, growth and partial samples do not certify retained memory or leak freedom.",
      "A completed collection is not a passed hardware QA gate; real workstation evidence still requires review.",
    ],
  });
  let finalReport: ReturnType<typeof report> | undefined;
  try {
    if (stopped)
      throw new Error("Measurement interrupted before service launch");
    owned = await startOwnedService(
      config,
      directory,
      () => stopped,
      async (service) => {
        owned = { service };
        manifest.ownership.serverPid = service.pid;
        await writeFile(
          join(directory, "manifest.json"),
          JSON.stringify(manifest, null, 2) + "\n",
        );
      },
    );
    serviceReadyMs = performance.now() - start;
    manifest.ownership.serverPid = owned.service.pid;
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    if (stopped)
      throw new Error("Measurement interrupted before native launch");
    const output = openSync(join(directory, "native.log"), "wx");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENFILM_NATIVE_BENCHMARK_EVENTS: eventPath,
      OPENFILM_NATIVE_BENCHMARK_RUN_ID: runId,
    };
    // The runner owns the local service, so the shell must not spawn a second one.
    delete env.OPENFILM_SERVER_PATH;
    delete env.OPENFILM_NODE_PATH;
    nativeSpawnMs = performance.now() - start;
    native = spawn(config.executable, config.arguments ?? [], {
      env,
      stdio: ["ignore", output, output],
      detached: true,
    });
    closeSync(output);
    native.once("error", (error) => {
      nativeFailure = error;
    });
    await new Promise<void>((done, reject) => {
      native!.once("spawn", () => done());
      native!.once("error", reject);
    });
    if (!native.pid)
      throw new Error("Native executable did not create a process");
    manifest.ownership.nativePid = native.pid;
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    process.stdout.write(
      JSON.stringify({
        event: "native-benchmark.started",
        directory,
        runId,
        ...manifest.ownership,
      }) + "\n",
    );
    let nextSampleMs = 0;
    while (!stopped) {
      if (nativeFailure) throw nativeFailure;
      if (owned.service.exitCode !== null || owned.service.signalCode !== null)
        throw new Error("Owned local service exited during measurement");
      events = parseNativeEvents(
        await readFile(eventPath, "utf8"),
        runId,
        native.pid,
      );
      const ready = summarizeNativeEvents(events).firstUiReady;
      if (ready && firstCheckpointObservedMs === undefined)
        firstCheckpointObservedMs = performance.now() - start;
      if (native.exitCode !== null || native.signalCode !== null) {
        status = "app-exited";
        break;
      }
      if (
        firstCheckpointObservedMs === undefined &&
        performance.now() - start - nativeSpawnMs >
          config.startupTimeoutSeconds * 1000
      )
        throw new Error(
          "Native UI readiness checkpoint missing. Check native.log, configured display and benchmark-enabled binary.",
        );
      const elapsed = performance.now() - start;
      if (firstCheckpointObservedMs !== undefined && elapsed >= nextSampleMs) {
        const sampleStart = performance.now();
        const roots = await Promise.all(
          [native.pid, owned.service.pid!].map((pid) =>
            sampleProcessMemory(pid, {
              expectedRootIdentity: expectedIdentities.get(pid),
            }),
          ),
        );
        for (const root of roots) {
          if (root.rootState === "identity-mismatch")
            throw new Error(
              "An owned root PID changed identity; measurement stopped to avoid attributing unrelated memory",
            );
          if (root.rootIdentity)
            expectedIdentities.set(root.rootPid, root.rootIdentity);
        }
        const sample: MemorySample = {
          elapsedMs: sampleStart - start,
          collectionMs: performance.now() - sampleStart,
          roots,
          combined: mergeMemorySnapshots(roots),
        };
        samples.push(sample);
        await appendFile(
          join(directory, "memory.jsonl"),
          JSON.stringify(sample) + "\n",
        );
        await writeFile(
          join(directory, "report.json"),
          JSON.stringify(report(), null, 2) + "\n",
        );
        nextSampleMs =
          performance.now() - start + config.intervalSeconds * 1000;
      }
      if (
        firstCheckpointObservedMs !== undefined &&
        performance.now() - start - firstCheckpointObservedMs >=
          config.durationSeconds * 1000
      ) {
        status =
          config.project &&
          !summarizeNativeEvents(events).editVisits.some(
            (visit) => visit.clipCount === fixture.counts!.clips,
          )
            ? "scenario-incomplete"
            : "completed";
        break;
      }
      await delay(
        firstCheckpointObservedMs === undefined
          ? 50
          : Math.min(1000, config.intervalSeconds * 1000),
      );
    }
    if (stopped) status = "interrupted";
  } catch (error) {
    status = stopped ? "interrupted" : "failed";
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    // Freeze collection duration before waiting for the user to close the app.
    finalReport = report();
    await writeFile(
      join(directory, "report.json"),
      JSON.stringify(finalReport, null, 2) + "\n",
    );
    const appLive =
      !!native?.pid &&
      !nativeFailure &&
      native.exitCode === null &&
      native.signalCode === null;
    process.stdout.write(
      JSON.stringify({
        event: "native-benchmark.finished",
        directory,
        status,
        failure,
        appLeftRunning: appLive,
      }) + "\n",
    );
    // Detached children never receive the terminal's Ctrl+C. Keep the service
    // owner alive until normal app exit; never discard user edits on timeout.
    if (appLive) {
      process.stdout.write(
        "Collection stopped. Close the OpenFilm window normally to release its owned service.\n",
      );
      await new Promise<void>((done) => native!.once("exit", () => done()));
    }
    if (
      owned &&
      owned.service.exitCode === null &&
      owned.service.signalCode === null
    ) {
      const exited = new Promise<void>((done) =>
        owned!.service.once("exit", () => done()),
      );
      owned.service.kill("SIGTERM");
      await Promise.race([exited, delay(2000, undefined, { ref: false })]);
    }
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    options.signal?.removeEventListener("abort", interrupt);
    owned?.service.unref();
    native?.unref();
    await writeFile(
      join(directory, "lifecycle.json"),
      JSON.stringify(
        {
          runId,
          closedAt: new Date().toISOString(),
          nativeExit: native
            ? { code: native.exitCode, signal: native.signalCode }
            : undefined,
          ownedServiceRemaining:
            !!owned &&
            owned.service.exitCode === null &&
            owned.service.signalCode === null,
          projectFinalFiles: await projectFileHashes(config.project),
        },
        null,
        2,
      ) + "\n",
    );
  }
  if (!finalReport)
    throw new Error("Native measurement report was not finalized");
  return finalReport;
}

async function main(argv: string[]) {
  if (
    argv[0] === "mark" &&
    argv.length === 3 &&
    ["idle", "editing", "revisit", "idle-recovery"].includes(argv[2]!)
  ) {
    const directory = resolve(argv[1]!);
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ) as { runId: string };
    await appendFile(
      join(directory, "operator-markers.jsonl"),
      JSON.stringify({
        runId: manifest.runId,
        phase: argv[2],
        unixMs: Date.now(),
        source: "operator",
      }) + "\n",
    );
    return;
  }
  if (argv.length !== 1)
    throw new Error(
      "Usage: native-benchmark <config.json> | mark <evidence-directory> idle|editing|revisit|idle-recovery",
    );
  const result = await runNativeBenchmark(
    validateBenchmarkConfig(
      JSON.parse(await readFile(resolve(argv[0]!), "utf8")),
    ),
  );
  if (result.status !== "completed") process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
