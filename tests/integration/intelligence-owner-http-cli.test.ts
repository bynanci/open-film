import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { OpenFilmApplication, createReviewOwner } from "@openfilm/application";
import type { Job } from "@openfilm/core";
import type {
  TranscriptionProvider,
  TranscriptionResult,
} from "@openfilm/plugin-sdk";
import { hashFile, runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const cleanups: (() => unknown | Promise<unknown>)[] = [];
let buildDirectory: string, cliPath: string;
beforeAll(async () => {
  buildDirectory = await mkdtemp(
    join(tmpdir(), "openfilm-analysis-recovery-cli-"),
  );
  cliPath = join(buildDirectory, "openfilm.mjs");
  await build({
    entryPoints: [resolve("apps/cli/src/index.ts")],
    outfile: cliPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
});
afterAll(() => rm(buildDirectory, { recursive: true, force: true }));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const result = (text: string): TranscriptionResult => ({
  text,
  execution: "cpu",
  model: "identity-not-asr",
  segments: [{ start: 0, end: 1, text, words: [{ start: 0, end: 1, text }] }],
});
const provider = (
  transcribe: TranscriptionProvider["transcribe"],
): TranscriptionProvider => ({
  id: "owner-recovery-http-fixture",
  name: "Explicit ownership fixture, not recognition",
  kind: "transcription",
  execution: "local",
  dataKinds: ["audio", "metadata"],
  capabilities: { wordTimestamps: true, languages: ["en"], cpuFallback: true },
  transcribe,
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-analysis-owner-http-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm"),
    userDataDirectory = join(root, "user-data");
  const source = join(root, "訪問 # & identity.wav");
  // Identity-only bytes: no decoder, model or hardware quality is asserted here.
  await writeFile(source, "Keep these original source bytes unchanged.");
  const sourceHash = await hashFile(source),
    assetId = "訪問 # & asset";
  const app = await OpenFilmApplication.create(
    directory,
    "Keep my work",
    {},
    { userDataDirectory },
  );
  cleanups.push(() => {
    if (app.hasActiveJobs) return;
    try {
      app.close();
    } catch {
      /* A test may already have closed this instance. */
    }
  });
  app.catalog.upsertAsset({
    id: assetId,
    uri: pathToFileURL(source).href,
    name: "identity.wav",
    duration: 2,
    mediaType: "audio",
    contentHash: sourceHash,
    tags: [],
    metadata: {},
    state: { locked: true },
  });
  app.catalog.intelligence.replaceTranscript({
    id: "prior-provider-evidence",
    assetId,
    provenance: {
      providerId: "explicit-test",
      version: "1",
      sourceHash,
      createdAt: new Date().toISOString(),
    },
    segments: [{ id: "first", start: 0, end: 1, text: "Preserved words" }],
  });
  const prior = await app.transcriptEditor.get(assetId);
  await app.transcriptEditor.edit(assetId, {
    baseRevision: prior.revision!,
    requestId: "manual-correction",
    commands: [
      { type: "replace-text", segmentId: "first", text: "My corrected words" },
    ],
  });
  await app.intelligence.addMarker(assetId, 0.5, "Keep marker");
  return {
    root,
    directory,
    userDataDirectory,
    app,
    source,
    sourceHash,
    assetId,
  };
}
function client(port: number) {
  const api = `http://127.0.0.1:${port}/api`;
  return {
    get: async (path: string) => (await fetch(`${api}${path}`)).json(),
    post: (path: string, data: unknown = {}) =>
      fetch(`${api}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  };
}

describe("media-analysis ownership over HTTP and the bundled CLI", () => {
  it.each([123, { legacy: "unverifiable" }])(
    "can explicitly recover a historical malformed owner token %j without exposing it as a valid token",
    async (token) => {
      const f = await fixture();
      const job = {
        id: "malformed-owner",
        assetId: f.assetId,
        type: "scenes",
        status: "running",
        analysisOwner: { host: "foreign", pid: 5, token },
      } as unknown as Job;
      f.app.catalog.saveJob(job);
      f.app.close();
      const runtime = await startServer({
        port: 0,
        project: f.directory,
        userDataDirectory: f.userDataDirectory,
      });
      cleanups.push(() => runtime.close());
      const http = client(runtime.port);
      const recovery = await http.get(`/intelligence/jobs/${job.id}/recovery`);
      expect(recovery).toMatchObject({
        ownerState: "unknown",
        manualRecoveryAllowed: true,
      });
      expect(recovery.ownerToken).toBeUndefined();
      expect(
        (await http.get("/jobs")).jobs.find((j: Job) => j.id === job.id),
      ).toEqual(job);
      const response = await http.post(`/intelligence/jobs/${job.id}/recover`, {
        confirmStopped: true,
        checkpoint: recovery.checkpoint,
      });
      expect(response.status).toBe(200);
      expect((await response.json()).job.status).toBe("failed");
    },
  );
  it("preserves a running owner when another server opens, reports no local Cancel and refuses duplicate execution", async () => {
    const f = await fixture();
    let release!: (value: TranscriptionResult) => void,
      invoked = false,
      duplicateCalls = 0;
    const held = new Promise<TranscriptionResult>((done) => {
      release = done;
    });
    f.app.intelligence.registerTranscriptionProvider(
      provider(async () => {
        invoked = true;
        return held;
      }),
    );
    const task = f.app.analyzeIntelligence(f.assetId, {
      operation: "transcribe",
    });
    // Attach teardown before waiting for invocation, including preparation failures.
    void task.catch(() => {});
    cleanups.push(async () => {
      release(result("Teardown only"));
      await task;
    });
    await expect.poll(() => invoked).toBe(true);
    const observed = f.app.catalog
      .listJobs()
      .find((job) => job.status === "running")!;
    const runtime = await startServer({
      port: 0,
      project: f.directory,
      userDataDirectory: f.userDataDirectory,
      transcriptionProvider: provider(async () => {
        duplicateCalls++;
        return result("Should not run");
      }),
    });
    cleanups.push(() => runtime.close());
    const http = client(runtime.port),
      jobs = await http.get("/jobs");
    expect(jobs.jobs.find((job: Job) => job.id === observed.id)).toEqual(
      observed,
    );
    expect(jobs.analysisRecovery[observed.id]).toMatchObject({
      ownerState: "alive",
      canCancel: false,
      manualRecoveryAllowed: false,
    });
    const state = await http.get(`/intelligence/jobs/${observed.id}/recovery`);
    expect(
      (
        await http.post(`/intelligence/jobs/${observed.id}/recover`, {
          confirmStopped: true,
          checkpoint: state.checkpoint,
          ownerToken: state.ownerToken,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await http.post(
          `/assets/${encodeURIComponent(f.assetId)}/intelligence`,
          { operation: "transcribe" },
        )
      ).status,
    ).toBe(409);
    expect(duplicateCalls).toBe(0);
    release(result("Completed live owner"));
    expect((await task).status).toBe("completed");
    expect(
      (await http.get(`/assets/${encodeURIComponent(f.assetId)}/transcript`))
        .document.segments[0].text,
    ).toBe("Completed live owner");
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });

  it("requires an exact confirmed checkpoint for unknown recovery, preserves edited evidence, then allows explicit retry and local Cancel", async () => {
    const f = await fixture();
    const unknown: Job = {
      id: "unknown-analysis",
      assetId: f.assetId,
      type: "transcribe",
      status: "running",
      progress: 0.4,
      updatedAt: "2026-10-07T00:00:00.000Z",
      analysisOwner: { host: "foreign-scope", pid: 1, token: "old-token" },
    };
    f.app.catalog.saveJob(unknown);
    const before = await f.app.transcriptEditor.get(f.assetId, { limit: 100 });
    f.app.close();
    let invoked = false;
    const runtime = await startServer({
      port: 0,
      project: f.directory,
      userDataDirectory: f.userDataDirectory,
      transcriptionProvider: provider(async (_asset, options) => {
        invoked = true;
        return new Promise<TranscriptionResult>((_resolve, reject) =>
          options?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("Stopped"), { name: "AbortError" }),
              ),
            { once: true },
          ),
        );
      }),
    });
    cleanups.push(() => runtime.close());
    const http = client(runtime.port),
      path = `/intelligence/jobs/${unknown.id}`;
    const state = await http.get(`${path}/recovery`);
    expect(state).toMatchObject({
      ownerState: "unknown",
      manualRecoveryAllowed: true,
      canCancel: false,
    });
    expect(
      (await http.post(`${path}/recover`, { checkpoint: state.checkpoint }))
        .status,
    ).toBe(400);
    expect(
      (
        await http.post(`${path}/recover`, {
          confirmStopped: false,
          checkpoint: state.checkpoint,
          ownerToken: state.ownerToken,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await http.post(`${path}/recover`, {
          confirmStopped: true,
          checkpoint: "obsolete",
          ownerToken: state.ownerToken,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await http.post(`${path}/recover`, {
          confirmStopped: true,
          checkpoint: state.checkpoint,
          ownerToken: state.ownerToken,
          unexpected: true,
        })
      ).status,
    ).toBe(400);
    const recoveredResponse = await http.post(`${path}/recover`, {
      confirmStopped: true,
      checkpoint: state.checkpoint,
      ownerToken: state.ownerToken,
    });
    expect(recoveredResponse.status).toBe(200);
    const recovered = (await recoveredResponse.json()).job as Job;
    expect(recovered).toMatchObject({ status: "failed", stage: "interrupted" });
    expect(recovered.analysisOwner?.token).not.toBe(
      unknown.analysisOwner!.token,
    );
    const transcript = `/assets/${encodeURIComponent(f.assetId)}/transcript`;
    expect(await http.get(transcript)).toEqual(before);
    const started = await http.post(
      `/assets/${encodeURIComponent(f.assetId)}/intelligence`,
      { operation: "transcribe" },
    );
    expect(started.status).toBe(202);
    const job = (await started.json()).job as Job;
    await expect.poll(() => invoked).toBe(true);
    expect((await http.get("/jobs")).analysisRecovery[job.id].canCancel).toBe(
      true,
    );
    expect((await http.post(`/jobs/${job.id}/cancel`)).status).toBe(200);
    await expect
      .poll(
        async () =>
          (await http.get("/jobs")).jobs.find((j: Job) => j.id === job.id)
            ?.status,
      )
      .toBe("cancelled");
    expect(await http.get(transcript)).toEqual(before);
    expect((await http.post("/project/close")).status).toBe(200);
    expect(
      (await http.post("/project/open", { path: f.directory })).status,
    ).toBe(200);
    expect(await http.get(transcript)).toEqual(before);
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });

  it("does not let the HTTP preparation catch overwrite a revoked queued reservation", async () => {
    const f = await fixture();
    f.app.close();
    let recovered: Job | undefined;
    vi.spyOn(
      OpenFilmApplication.prototype,
      "analyzeIntelligence",
    ).mockImplementation(async function (
      this: OpenFilmApplication,
      _assetId,
      options,
    ) {
      const observed = options.reservation!;
      recovered = {
        ...observed,
        analysisOwner: createReviewOwner(),
        status: "failed",
        stage: "interrupted",
        updatedAt: new Date().toISOString(),
      };
      expect(
        this.catalog.intelligence.recoverAnalysisJob(observed, recovered),
      ).toBe(true);
      throw new Error("Preparation lost its owner before run");
    });
    const runtime = await startServer({
      port: 0,
      project: f.directory,
      userDataDirectory: f.userDataDirectory,
    });
    cleanups.push(() => runtime.close());
    const http = client(runtime.port),
      response = await http.post(
        `/assets/${encodeURIComponent(f.assetId)}/intelligence`,
        { operation: "transcribe" },
      );
    expect(response.status).toBe(202);
    const job = (await response.json()).job as Job;
    await expect
      .poll(async () =>
        (await http.get("/jobs")).jobs.find((j: Job) => j.id === job.id),
      )
      .toEqual(recovered);
  });

  it("bundled CLI preserves legacy ownerless jobs until explicit stopped confirmation and keeps transcript history portable", async () => {
    const f = await fixture(),
      before = await f.app.transcriptEditor.get(f.assetId);
    f.app.catalog.saveJob({
      id: "legacy-job",
      type: "waveform",
      assetId: f.assetId,
      status: "queued",
    });
    f.app.close();
    const run = (args: string[]) =>
      runProcess(process.execPath, [
        cliPath,
        "intelligence",
        ...args,
        "--project",
        f.directory,
        "--user-data-dir",
        f.userDataDirectory,
      ]);
    const cli = async (args: string[]) =>
      JSON.parse((await run(args)).stdout.toString());
    expect(
      (await cli(["jobs"])).jobs.find((j: Job) => j.id === "legacy-job").status,
    ).toBe("queued");
    expect(await cli(["recovery", "legacy-job"])).toMatchObject({
      ownerState: "unknown",
      manualRecoveryAllowed: true,
    });
    await expect(run(["recover", "legacy-job"])).rejects.toThrow();
    expect(
      (await cli(["recover", "legacy-job", "--confirm-stopped"])).job.status,
    ).toBe("failed");
    const reopened = await OpenFilmApplication.open(f.directory, {
      userDataDirectory: f.userDataDirectory,
    });
    try {
      expect(await reopened.transcriptEditor.get(f.assetId)).toEqual(before);
      expect(
        (await reopened.intelligence.read(f.assetId)).markers,
      ).toHaveLength(1);
      expect(reopened.catalog.getAsset(f.assetId)?.state.locked).toBe(true);
    } finally {
      reopened.close();
    }
    expect(await hashFile(f.source)).toBe(f.sourceHash);
  });
});
