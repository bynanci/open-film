import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import type { Job } from "@openfilm/core";
import {
  hashFile,
  WAVEFORM_CACHE_IDENTITY,
  sceneCacheIdentity,
} from "@openfilm/media";
import { CatalogIntelligenceStore, ProjectCatalog } from "@openfilm/catalog";
import type {
  TranscriptionOptions,
  TranscriptionProvider,
} from "@openfilm/plugin-sdk";
import {
  OpenFilmApplication,
  createReviewOwner,
  reviewOwnerState,
} from "../src/index.js";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function result(text = "Actual child media analysis fixture") {
  return {
    text,
    language: "en",
    execution: "cpu" as const,
    model: "explicit-fixture-not-asr",
    version: "test-1",
    segments: [
      {
        id: "first",
        start: 0.5,
        end: 1.5,
        text,
        words: [{ start: 0.5, end: 1.5, text }],
      },
    ],
  };
}
async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-live-intelligence-audit-"),
  );
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "identity.wav");
  await writeFile(
    source,
    "Identity-only source, not real ASR, decoder, or performance evidence.",
  );
  const sourceHash = await hashFile(source);
  const directory = join(root, "film.openfilm");
  const runtime = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    directory,
    "Actual child analysis ownership",
    {},
    runtime,
  );
  app.catalog.upsertAsset({
    id: "source",
    uri: pathToFileURL(source).href,
    name: "identity.wav",
    mediaType: "audio",
    duration: 4,
    contentHash: sourceHash,
    metadata: {},
    tags: [],
    state: { locked: true, favorite: true },
    rating: 5,
  });
  app.catalog.intelligence.replaceTranscript({
    id: "prior",
    assetId: "source",
    provenance: {
      providerId: "explicit-fixture-not-asr",
      version: "1",
      sourceHash,
      createdAt: "2026-10-07T00:00:00Z",
    },
    segments: result("Preserve prior transcript").segments,
  });
  const original = await app.transcriptEditor.get("source");
  await app.transcriptEditor.edit("source", {
    baseRevision: original.revision!,
    requestId: "seed-human-correction",
    commands: [
      {
        type: "replace-text",
        segmentId: "first",
        text: "Saved human correction",
      },
    ],
  });
  app.catalog.intelligence.saveWaveform({
    assetId: "source",
    duration: 4,
    sampleRate: 1,
    peaks: [0.1, 0.3, 0.2, 0.1],
    provenance: {
      ...WAVEFORM_CACHE_IDENTITY,
      sourceHash,
      createdAt: "2026-10-07T00:00:00Z",
    },
  });
  app.catalog.intelligence.saveScenes({
    assetId: "source",
    markers: [
      {
        id: "saved-scene",
        assetId: "source",
        time: 2,
        type: "scene-cut",
        confidence: 0.9,
      },
    ],
    provenance: {
      ...sceneCacheIdentity(),
      sourceHash,
      createdAt: "2026-10-07T00:00:00Z",
    },
  });
  app.catalog.intelligence.saveManualMarker(
    {
      id: "saved-manual",
      assetId: "source",
      time: 3,
      type: "manual",
      label: "Preserve memory",
    },
    sourceHash,
  );
  const before = await app.transcriptEditor.get("source");
  const beforeIntelligence = await app.intelligence.read("source");
  const beforeAsset = app.catalog.getAsset("source");
  app.close();
  const beforeProject = JSON.parse(
    await readFile(join(directory, "project.json"), "utf8"),
  );
  return {
    root,
    directory,
    runtime,
    sourceHash,
    before,
    beforeIntelligence,
    beforeAsset,
    beforeProject,
  };
}
async function worker(
  context: Awaited<ReturnType<typeof fixture>>,
  mode: "queued" | "running",
) {
  const file = join(context.root, "analysis-worker.mts");
  await writeFile(
    file,
    `
 import {OpenFilmApplication} from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
 const [directory,userDataDirectory,mode]=process.argv.slice(2);
 const app=await OpenFilmApplication.open(directory,{userDataDirectory});
 const jobId="actual-child-transcription";
 let release; const gate=new Promise(done=>release=done);
 process.on("message",message=>{if(message==="release")release();});
 const ready=()=>process.send({type:"ready",job:app.catalog.listJobs().find(job=>job.id===jobId)});
 app.intelligence.registerTranscriptionProvider({id:"child-fixture",name:"Held actual child",kind:"transcription",execution:"local",dataKinds:["audio","metadata"],capabilities:{wordTimestamps:true,languages:["en"],cpuFallback:true},async transcribe(){if(mode==="running"){ready();await gate;}return ${JSON.stringify(result())};}});
 let reservation;
 try{
 if(mode==="queued") {reservation=app.reserveIntelligenceJob("source","transcribe",jobId);ready();await gate;}
 const job=await app.analyzeIntelligence("source",{operation:"transcribe",jobId,reservation});
 app.close();process.send({type:"finished",job});process.disconnect();
 }catch(error){process.send({type:"error",message:String(error)});process.disconnect();process.exitCode=1;}
 `,
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      file,
      context.directory,
      context.runtime.userDataDirectory,
      mode,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: join(process.cwd(), "tsconfig.json"),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const messages: { type: string; job?: Job; message?: string }[] = [];
  let stderr = "";
  child.stderr!.on("data", (chunk) => (stderr += String(chunk)));
  child.on("message", (message) =>
    messages.push(message as (typeof messages)[number]),
  );
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exit;
  });
  async function message(type: string) {
    await expect
      .poll(
        () => {
          if (messages.some((item) => item.type === "error"))
            throw new Error(JSON.stringify(messages) + stderr);
          return messages.find((item) => item.type === type);
        },
        { timeout: 10000 },
      )
      .toBeDefined();
    return messages.find((item) => item.type === type)!;
  }
  return {
    child,
    exit,
    ready: () => message("ready"),
    release: () => child.send("release"),
    finished: () => message("finished"),
  };
}

describe("media analysis execution ownership and recovery", () => {
  it.each(["queued", "running"] as const)(
    "normal Open preserves actual live child %s transcription",
    async (mode) => {
      const context = await fixture();
      const child = await worker(context, mode);
      const ready = await child.ready();
      expect(() => process.kill(child.child.pid!, 0)).not.toThrow();
      expect(ready.job?.analysisOwner?.pid).toBe(child.child.pid);
      if (process.platform === "linux")
        expect(reviewOwnerState(ready.job?.analysisOwner)).toBe("alive");
      const app = await OpenFilmApplication.open(
        context.directory,
        context.runtime,
      );
      cleanups.push(() => app.close());
      const afterOpen = app.catalog
        .listJobs()
        .find((job) => job.id === ready.job!.id);
      try {
        expect(afterOpen).toEqual(ready.job);
      } finally {
        child.release();
        const finished = await child.finished();
        expect(finished.job?.status).toBe("completed");
        expect((await child.exit).code).toBe(0);
      }
    },
  );
  it("a second already-open Application cannot start duplicate analysis while actual child is working", async () => {
    const context = await fixture();
    const app = await OpenFilmApplication.open(
      context.directory,
      context.runtime,
    );
    cleanups.push(() => app.close());
    const child = await worker(context, "running");
    await child.ready();
    let calls = 0;
    app.intelligence.registerTranscriptionProvider({
      id: "duplicate-fixture",
      name: "Second process provider",
      kind: "transcription",
      execution: "local",
      dataKinds: ["audio", "metadata"],
      capabilities: {
        wordTimestamps: true,
        languages: ["en"],
        cpuFallback: true,
      },
      async transcribe() {
        calls++;
        return result("Duplicate second application transcript");
      },
    });
    let duplicate: Job | undefined;
    let error: unknown;
    try {
      duplicate = await app.analyzeIntelligence("source", {
        operation: "transcribe",
      });
    } catch (caught) {
      error = caught;
    }
    try {
      expect(duplicate).toBeUndefined();
      expect(error).toMatchObject({ code: "jobs.busy", status: 409 });
      expect(calls).toBe(0);
    } finally {
      child.release();
      expect((await child.finished()).job?.status).toBe("completed");
      expect((await child.exit).code).toBe(0);
    }
  });
});

async function open(context: Awaited<ReturnType<typeof fixture>>) {
  const app = await OpenFilmApplication.open(
    context.directory,
    context.runtime,
  );
  cleanups.push(() => app.close());
  return app;
}
function provider(
  transcribe: TranscriptionProvider["transcribe"],
): TranscriptionProvider {
  return {
    id: "explicit-owner-fixture",
    name: "Deterministic ownership fixture, not ASR",
    kind: "transcription",
    execution: "local",
    dataKinds: ["audio", "metadata"],
    capabilities: {
      wordTimestamps: true,
      languages: ["en"],
      cpuFallback: true,
    },
    transcribe,
  };
}
async function expectPreserved(
  app: OpenFilmApplication,
  context: Awaited<ReturnType<typeof fixture>>,
) {
  expect(await app.transcriptEditor.get("source")).toEqual(context.before);
  expect(await app.intelligence.read("source")).toEqual(
    context.beforeIntelligence,
  );
  expect(app.catalog.getAsset("source")).toEqual(context.beforeAsset);
  expect(app.project).toEqual(context.beforeProject);
}
function unknownJob(
  type: "transcribe" | "waveform" | "scenes",
  legacy = false,
): Job {
  const owner = createReviewOwner();
  return {
    id: "unknown-analysis",
    assetId: "source",
    type,
    status: "running",
    stage: "checking-source",
    progress: 0.1,
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:01Z",
    ...(legacy
      ? {}
      : { analysisOwner: { ...owner, host: owner.host + ":foreign" } }),
  };
}

it.each(["transcribe", "waveform", "scenes"] as const)(
  "an unknown %s owner survives Open and blocks every new analysis until confirmed recovery",
  async (type) => {
    const context = await fixture();
    const seed = await open(context);
    const job = unknownJob(type);
    seed.catalog.saveJob(job);
    const app = await open(context);
    expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
      job,
    );
    const state = app.analysisRecoveryStatus(job.id);
    expect(state).toMatchObject({
      ownerState: "unknown",
      manualRecoveryAllowed: true,
      ownerToken: job.analysisOwner!.token,
    });
    let calls = 0;
    app.intelligence.registerTranscriptionProvider(
      provider(async () => {
        calls++;
        return result();
      }),
    );
    await expect(
      app.analyzeIntelligence("source", { operation: "transcribe" }),
    ).rejects.toMatchObject({ code: "jobs.busy", status: 409 });
    expect(calls).toBe(0);
    expect(app.hasActiveJobs).toBe(false);
    expect(() =>
      app.manualRecoverAnalysis(job.id, {
        confirmStopped: false,
        checkpoint: state.checkpoint,
        ownerToken: state.ownerToken,
      }),
    ).toThrow();
    expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
      job,
    );
    const recovered = app.manualRecoverAnalysis(job.id, {
      confirmStopped: true,
      checkpoint: state.checkpoint,
      ownerToken: state.ownerToken,
    });
    expect(recovered).toMatchObject({ status: "failed", stage: "interrupted" });
    expect(recovered.analysisOwner!.token).not.toBe(job.analysisOwner!.token);
    await expectPreserved(app, context);
    const reopened = await open(context);
    expect(
      reopened.catalog.listJobs().find((item) => item.id === job.id),
    ).toEqual(recovered);
    await expectPreserved(reopened, context);
    expect(
      (await app.analyzeIntelligence("source", { operation: "transcribe" }))
        .status,
    ).toBe("completed");
    expect(calls).toBe(1);
  },
);

it("legacy ownerless analysis requires the manual gate while import/render keep existing Open recovery", async () => {
  const context = await fixture();
  const seed = await open(context);
  const job = unknownJob("transcribe", true);
  seed.catalog.saveJob(job);
  for (const type of ["import", "render"])
    seed.catalog.saveJob({ id: type, type, status: "running" });
  const app = await open(context);
  expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
    job,
  );
  expect(
    app.catalog
      .listJobs()
      .filter((item) => ["import", "render"].includes(item.type))
      .map((item) => item.status),
  ).toEqual(["failed", "failed"]);
  const state = app.analysisRecoveryStatus(job.id);
  expect(state).toMatchObject({
    ownerState: "unknown",
    manualRecoveryAllowed: true,
    ownerToken: undefined,
  });
  expect(
    app.manualRecoverAnalysis(job.id, {
      confirmStopped: true,
      checkpoint: state.checkpoint,
    }),
  ).toMatchObject({ status: "failed", stage: "interrupted" });
  await expectPreserved(app, context);
});

it("an unpermitted local PID probe is unknown and cannot authorize automatic recovery", async () => {
  const context = await fixture();
  const seed = await open(context);
  const owner = createReviewOwner();
  const job = {
    ...unknownJob("transcribe"),
    analysisOwner: { ...owner, pid: process.ppid },
  };
  seed.catalog.saveJob(job);
  const probe = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("Probe denied"), { code: "EPERM" });
  });
  const app = await open(context);
  expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
    job,
  );
  expect(app.analysisRecoveryStatus(job.id)).toMatchObject({
    ownerState: "unknown",
    manualRecoveryAllowed: true,
  });
  probe.mockRestore();
});

it.skipIf(process.platform !== "linux")(
  "Open recovers a killed and reaped child owner while preserving prior analysis and permitting retry",
  async () => {
    const context = await fixture();
    const child = await worker(context, "running");
    const ready = await child.ready();
    child.child.kill("SIGKILL");
    expect((await child.exit).signal).toBe("SIGKILL");
    expect(() => process.kill(child.child.pid!, 0)).toThrowError(
      expect.objectContaining({ code: "ESRCH" }),
    );
    expect(reviewOwnerState(ready.job!.analysisOwner)).toBe("dead");
    const app = await open(context);
    const recovered = app.catalog
      .listJobs()
      .find((item) => item.id === ready.job!.id)!;
    expect(recovered).toMatchObject({ status: "failed", stage: "interrupted" });
    expect(recovered.analysisOwner!.token).not.toBe(
      ready.job!.analysisOwner!.token,
    );
    await expectPreserved(app, context);
    app.intelligence.registerTranscriptionProvider(
      provider(async () => result()),
    );
    expect(
      (await app.analyzeIntelligence("source", { operation: "transcribe" }))
        .status,
    ).toBe("completed");
  },
);

it("confirmation is bound to the whole Job checkpoint even when updatedAt has not changed", async () => {
  const context = await fixture();
  const app = await open(context);
  const job = unknownJob("transcribe");
  app.catalog.saveJob(job);
  const inspected = app.analysisRecoveryStatus(job.id);
  const progressed = { ...job, progress: 0.2 };
  app.catalog.saveJob(progressed);
  expect(app.analysisRecoveryStatus(job.id).updatedAt).toBe(
    inspected.updatedAt,
  );
  expect(app.analysisRecoveryStatus(job.id).checkpoint).not.toBe(
    inspected.checkpoint,
  );
  expect(() =>
    app.manualRecoverAnalysis(job.id, {
      confirmStopped: true,
      checkpoint: inspected.checkpoint,
      ownerToken: inspected.ownerToken,
    }),
  ).toThrowError(expect.objectContaining({ status: 409 }));
  expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
    progressed,
  );
  const current = app.analysisRecoveryStatus(job.id);
  expect(() =>
    app.manualRecoverAnalysis(job.id, {
      confirmStopped: true,
      checkpoint: current.checkpoint,
      ownerToken: "wrong-token",
    }),
  ).toThrowError(expect.objectContaining({ status: 409 }));
  await expectPreserved(app, context);
});

it("a locally live owner cannot be manually recovered even with confirmation and its exact checkpoint", async () => {
  const context = await fixture();
  const app = await open(context);
  const reservation = app.reserveIntelligenceJob("source", "transcribe");
  const state = app.analysisRecoveryStatus(reservation.id);
  expect(state).toMatchObject({
    ownerState: "alive",
    manualRecoveryAllowed: false,
  });
  expect(() =>
    app.manualRecoverAnalysis(reservation.id, {
      confirmStopped: true,
      checkpoint: state.checkpoint,
      ownerToken: state.ownerToken,
    }),
  ).toThrowError(expect.objectContaining({ code: "jobs.busy", status: 409 }));
  expect(
    app.catalog.listJobs().find((item) => item.id === reservation.id),
  ).toEqual(reservation);
});

it("recovery losing an exact CAS to another connection leaves its newer checkpoint untouched", async () => {
  const context = await fixture();
  const app = await open(context);
  const job = unknownJob("transcribe");
  app.catalog.saveJob(job);
  const state = app.analysisRecoveryStatus(job.id);
  const other = new ProjectCatalog(context.directory);
  cleanups.push(() => other.close());
  const real = CatalogIntelligenceStore.prototype.recoverAnalysisJob;
  const newer = { ...job, progress: 0.3, updatedAt: "2026-10-07T00:00:02Z" };
  const spy = vi
    .spyOn(CatalogIntelligenceStore.prototype, "recoverAnalysisJob")
    .mockImplementation(function (
      this: CatalogIntelligenceStore,
      observed,
      recovered,
    ) {
      other.saveJob(newer);
      return real.call(this, observed, recovered);
    });
  expect(() =>
    app.manualRecoverAnalysis(job.id, {
      confirmStopped: true,
      checkpoint: state.checkpoint,
      ownerToken: state.ownerToken,
    }),
  ).toThrowError(expect.objectContaining({ status: 409 }));
  spy.mockRestore();
  expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
    newer,
  );
  await expectPreserved(app, context);
});

it("a recovered queued reservation cannot run or be recreated by jobId-only reuse", async () => {
  const context = await fixture();
  const app = await open(context);
  const reservation = app.reserveIntelligenceJob(
    "source",
    "transcribe",
    "queued-reservation",
  );
  const foreign = {
    ...reservation,
    analysisOwner: {
      ...reservation.analysisOwner!,
      host: reservation.analysisOwner!.host + ":foreign",
    },
  };
  app.catalog.saveJob(foreign);
  const state = app.analysisRecoveryStatus(reservation.id);
  const recovered = app.manualRecoverAnalysis(reservation.id, {
    confirmStopped: true,
    checkpoint: state.checkpoint,
    ownerToken: state.ownerToken,
  });
  let calls = 0;
  app.intelligence.registerTranscriptionProvider(
    provider(async () => {
      calls++;
      return result();
    }),
  );
  await expect(
    app.analyzeIntelligence("source", { operation: "transcribe", reservation }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    app.analyzeIntelligence("source", {
      operation: "transcribe",
      jobId: reservation.id,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(0);
  expect(app.hasActiveJobs).toBe(false);
  expect(
    app.catalog.listJobs().find((item) => item.id === reservation.id),
  ).toEqual(recovered);
  await expectPreserved(app, context);
});

it.each(["resolve", "reject"] as const)(
  "old provider late %s and callbacks cannot change recovery or a successful successor",
  async (settlement) => {
    const context = await fixture();
    const app = await open(context);
    const other = await open(context);
    let finish!: (value: ReturnType<typeof result>) => void;
    let fail!: (error: Error) => void;
    let started!: () => void;
    const held = new Promise<ReturnType<typeof result>>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    let callbacks: TranscriptionOptions | undefined;
    app.intelligence.registerTranscriptionProvider(
      provider((_asset, options) => {
        callbacks = options;
        started();
        return held;
      }),
    );
    const pending = app.analyzeIntelligence("source", {
      operation: "transcribe",
    });
    try {
      await waiting;
      const owned = app.catalog
        .listJobs()
        .find((item) => item.status === "running")!;
      // Explicit foreign-scope fixture models an unverified migrated owner. It does
      // not assert hardware liveness; a late writer is intentionally retained to test fencing.
      app.catalog.saveJob({
        ...owned,
        analysisOwner: {
          ...owned.analysisOwner!,
          host: owned.analysisOwner!.host + ":foreign",
        },
      });
      const state = other.analysisRecoveryStatus(owned.id);
      const recovered = other.manualRecoverAnalysis(owned.id, {
        confirmStopped: true,
        checkpoint: state.checkpoint,
        ownerToken: state.ownerToken,
      });
      other.intelligence.registerTranscriptionProvider(
        provider(async () => result("Successful successor transcript")),
      );
      const successor = await other.analyzeIntelligence("source", {
        operation: "transcribe",
      });
      expect(successor.status).toBe("completed");
      const saved = await other.transcriptEditor.get("source");
      const jobs = other.catalog.listJobs();
      expect(() => callbacks?.onStage?.("transcribing")).not.toThrow();
      expect(() => callbacks?.onProgress?.(0.99)).not.toThrow();
      if (settlement === "resolve") finish(result("Late old owner text"));
      else fail(new Error("Late old owner rejection"));
      expect(await pending).toEqual(recovered);
      await setImmediate();
      expect(other.catalog.listJobs()).toEqual(jobs);
      expect(await other.transcriptEditor.get("source")).toEqual(saved);
      expect(other.catalog.getAsset("source")).toEqual(context.beforeAsset);
      expect(other.project).toEqual(context.beforeProject);
      expect(app.hasActiveJobs).toBe(false);
    } finally {
      finish(result("Cleanup-only settlement"));
      await pending.catch(() => {});
    }
  },
);

it("an owned reservation is consumed only once across two applications", async () => {
  const context = await fixture();
  const app = await open(context);
  const other = await open(context);
  const reservation = app.reserveIntelligenceJob("source", "transcribe");
  let finish!: (value: ReturnType<typeof result>) => void;
  let started!: () => void;
  const held = new Promise<ReturnType<typeof result>>(
    (resolve) => (finish = resolve),
  );
  const waiting = new Promise<void>((resolve) => (started = resolve));
  app.intelligence.registerTranscriptionProvider(
    provider(() => {
      started();
      return held;
    }),
  );
  let calls = 0;
  other.intelligence.registerTranscriptionProvider(
    provider(async () => {
      calls++;
      return result();
    }),
  );
  const pending = app.analyzeIntelligence("source", {
    operation: "transcribe",
    reservation,
  });
  try {
    await waiting;
    await expect(
      other.analyzeIntelligence("source", {
        operation: "transcribe",
        reservation,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(calls).toBe(0);
  } finally {
    finish(result());
    expect((await pending).status).toBe("completed");
  }
});

it("Activity inspects2000 legacy analysis jobs with one catalog snapshot and no per-row job query", async () => {
  const context = await fixture();
  const app = await open(context);
  for (let index = 0; index < 2000; index++)
    app.catalog.saveJob({
      id: `legacy-${index}`,
      assetId: "source",
      type: ["transcribe", "waveform", "scenes"][index % 3]!,
      status: "queued",
    });
  app.catalog.saveJob({
    id: "active-import",
    type: "import",
    status: "running",
  });
  app.catalog.saveJob({
    id: "terminal-analysis",
    type: "transcribe",
    assetId: "source",
    status: "completed",
  });
  const queries = vi.spyOn(app.catalog, "listJobs");
  const statuses = app.analysisRecoveryStatuses();
  expect(queries).toHaveBeenCalledTimes(1);
  expect(Object.keys(statuses)).toHaveLength(2000);
  expect(statuses["legacy-1999"]).toMatchObject({
    ownerState: "unknown",
    manualRecoveryAllowed: true,
  });
  expect(statuses["active-import"]).toBeUndefined();
  expect(statuses["terminal-analysis"]).toBeUndefined();
  const snapshot = app.catalog.listJobs();
  queries.mockClear();
  expect(app.analysisRecoveryStatuses(snapshot)).toEqual(statuses);
  expect(queries).not.toHaveBeenCalled();
});

it.each([123, { legacy: "opaque-token" }])(
  "malformed historical owner token %j has a recoverable normalized DTO while its original evidence remains bound",
  async (token) => {
    const context = await fixture();
    const app = await open(context);
    const job = unknownJob("transcribe");
    const malformed: Job = {
      ...job,
      analysisOwner: {
        ...job.analysisOwner!,
        token: token as unknown as string,
      },
    };
    app.catalog.saveJob(malformed);
    const inspected = app.analysisRecoveryStatus(job.id);
    expect(inspected).toMatchObject({
      ownerState: "unknown",
      manualRecoveryAllowed: true,
      ownerToken: undefined,
    });
    expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
      malformed,
    );
    expect(() =>
      app.manualRecoverAnalysis(job.id, {
        confirmStopped: false,
        checkpoint: inspected.checkpoint,
      }),
    ).toThrow();
    expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
      malformed,
    );
    const changed: Job = { ...malformed, progress: 0.2 };
    app.catalog.saveJob(changed);
    expect(() =>
      app.manualRecoverAnalysis(job.id, {
        confirmStopped: true,
        checkpoint: inspected.checkpoint,
      }),
    ).toThrowError(expect.objectContaining({ status: 409 }));
    const refreshed = app.analysisRecoveryStatus(job.id);
    const recovered = app.manualRecoverAnalysis(job.id, {
      confirmStopped: true,
      checkpoint: refreshed.checkpoint,
    });
    expect(recovered).toMatchObject({ status: "failed", stage: "interrupted" });
    expect(typeof recovered.analysisOwner!.token).toBe("string");
    await expectPreserved(app, context);
  },
);

it("queued/running/completed Activity notifications preserve their durable transition despite observer mutation", async () => {
  const context = await fixture();
  const app = await open(context);
  const states: string[] = [];
  app.intelligence.registerTranscriptionProvider(
    provider(async () => result()),
  );
  const job = await app.analyzeIntelligence("source", {
    operation: "transcribe",
    onJob: (observed) => {
      states.push(observed.stage ?? observed.status);
      observed.status = "failed";
    },
  });
  expect(states).toEqual(
    expect.arrayContaining([
      "queued",
      "checking-source",
      "indexing",
      "completed",
    ]),
  );
  expect(job.status).toBe("completed");
  expect(app.catalog.listJobs().find((item) => item.id === job.id)).toEqual(
    job,
  );
});

it("a queued observer recovery revokes the reservation before its exact consume without provider work", async () => {
  const context = await fixture();
  const app = await open(context);
  let calls = 0;
  let recovered: Job | undefined;
  app.intelligence.registerTranscriptionProvider(
    provider(async () => {
      calls++;
      return result();
    }),
  );
  await expect(
    app.analyzeIntelligence("source", {
      operation: "transcribe",
      onJob: (observed) => {
        if (observed.status !== "queued") return;
        const foreign: Job = {
          ...observed,
          analysisOwner: {
            ...observed.analysisOwner!,
            host: observed.analysisOwner!.host + ":foreign",
          },
        };
        app.catalog.saveJob(foreign);
        const inspected = app.analysisRecoveryStatus(observed.id);
        recovered = app.manualRecoverAnalysis(observed.id, {
          confirmStopped: true,
          checkpoint: inspected.checkpoint,
          ownerToken: inspected.ownerToken,
        });
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(recovered).toMatchObject({ status: "failed", stage: "interrupted" });
  expect(calls).toBe(0);
  expect(app.hasActiveJobs).toBe(false);
  expect(
    app.catalog.listJobs().find((item) => item.id === recovered!.id),
  ).toEqual(recovered);
  await expectPreserved(app, context);
});

it.skipIf(process.platform !== "linux")(
  "an owner killed after the observer already opened has an actionable confirmed recovery without reopen",
  async () => {
    const context = await fixture();
    const child = await worker(context, "running");
    const ready = await child.ready();
    const observer = await open(context);
    expect(observer.analysisRecoveryStatus(ready.job!.id)).toMatchObject({
      ownerState: "alive",
      manualRecoveryAllowed: false,
    });
    expect(
      observer.catalog.listJobs().find((item) => item.id === ready.job!.id),
    ).toEqual(ready.job);
    child.child.kill("SIGKILL");
    expect((await child.exit).signal).toBe("SIGKILL");
    expect(() => process.kill(child.child.pid!, 0)).toThrowError(
      expect.objectContaining({ code: "ESRCH" }),
    );
    const inspected = observer.analysisRecoveryStatus(ready.job!.id);
    expect(inspected).toMatchObject({
      ownerState: "dead",
      manualRecoveryAllowed: true,
    });
    // Inspection never silently changes the owner's last durable checkpoint.
    expect(
      observer.catalog.listJobs().find((item) => item.id === ready.job!.id),
    ).toEqual(ready.job);
    expect(() =>
      observer.manualRecoverAnalysis(ready.job!.id, {
        confirmStopped: false,
        checkpoint: inspected.checkpoint,
        ownerToken: inspected.ownerToken,
      }),
    ).toThrow();
    const recovered = observer.manualRecoverAnalysis(ready.job!.id, {
      confirmStopped: true,
      checkpoint: inspected.checkpoint,
      ownerToken: inspected.ownerToken,
    });
    expect(recovered).toMatchObject({ status: "failed", stage: "interrupted" });
    expect(recovered.analysisOwner!.token).not.toBe(
      ready.job!.analysisOwner!.token,
    );
    await expectPreserved(observer, context);
    expect(
      (await open(context)).catalog
        .listJobs()
        .find((item) => item.id === ready.job!.id),
    ).toEqual(recovered);
  },
);

it.skipIf(process.platform !== "linux")(
  "jobId-only reuse cannot mutate an existing proven-dead reservation; a fresh retry recovers it normally",
  async () => {
    const context = await fixture();
    const observer = await open(context);
    const child = await worker(context, "queued");
    const ready = await child.ready();
    child.child.kill("SIGKILL");
    expect((await child.exit).signal).toBe("SIGKILL");
    expect(reviewOwnerState(ready.job!.analysisOwner)).toBe("dead");
    let calls = 0;
    observer.intelligence.registerTranscriptionProvider(
      provider(async () => {
        calls++;
        return result();
      }),
    );
    await expect(
      observer.analyzeIntelligence("source", {
        operation: "transcribe",
        jobId: ready.job!.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(observer.hasActiveJobs).toBe(false);
    expect(calls).toBe(0);
    expect(
      observer.catalog.listJobs().find((item) => item.id === ready.job!.id),
    ).toEqual(ready.job);
    await expectPreserved(observer, context);
    expect(
      (
        await observer.analyzeIntelligence("source", {
          operation: "transcribe",
        })
      ).status,
    ).toBe("completed");
    expect(calls).toBe(1);
    expect(
      observer.catalog.listJobs().find((item) => item.id === ready.job!.id),
    ).toMatchObject({ status: "failed", stage: "interrupted" });
  },
);
