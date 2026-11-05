import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { hashFile } from "@openfilm/media";
import {
  OpenFilmApplication,
  SilenceService,
  SilenceJobService,
  TimelineEditor,
} from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";

const roots: string[] = [];
const servers: Array<Awaited<ReturnType<typeof startServer>>> = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0).reverse()) await server.close();
  for (const child of children.splice(0).reverse()) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((resolveExit) =>
        child.once("exit", () => resolveExit()),
      );
  }
  for (const root of roots.splice(0))
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
});

function wave(): Buffer {
  const rate = 48_000,
    samples = 4 * rate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const seconds = index / rate;
    const sample =
      seconds >= 1 && seconds < 2
        ? 0
        : Math.round(12_000 * Math.sin((2 * Math.PI * 440 * index) / rate));
    bytes.writeInt16LE(sample, 44 + index * 2);
  }
  return bytes;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-silence-http-"));
  roots.push(root);
  const source = join(root, "voice.wav");
  await writeFile(source, wave());
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Silence HTTP");
  app.project.settings = { width: 320, height: 180, frameRate: 25 };
  const asset: MediaAsset = {
    id: "voice",
    name: "voice.wav",
    uri: pathToFileURL(source).href,
    contentHash: await hashFile(source),
    mediaType: "audio",
    duration: 4,
    tags: [],
    state: {},
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  app.project.stories.push({
    id: "story",
    title: "Voice story",
    targetDuration: 4,
    maxDuration: 8,
    beats: [
      {
        id: "beat",
        title: "Voice",
        selectedAssetIds: [asset.id],
        candidateAssetIds: [asset.id],
      },
    ],
  });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 4,
    tracks: [
      {
        id: "audio",
        type: "audio",
        clips: [
          {
            id: "voice-clip",
            assetId: asset.id,
            beatId: "beat",
            sourceIn: 0,
            sourceOut: 4,
            timelineStart: 0,
            timelineDuration: 4,
          },
        ],
      },
    ],
  });
  await app.save();
  const projectId = app.project.id;
  const before = new TimelineEditor(app).get("timeline");
  app.close();
  const server = await startServer({ port: 0, project: directory });
  servers.push(server);
  return {
    root,
    source,
    directory,
    projectId,
    revision: before.revision,
    base: `http://127.0.0.1:${server.port}`,
    server,
  };
}

const input = (projectId: string, requestId = "create-1") => ({
  projectId,
  requestId,
  assetId: "voice",
  compositionId: "timeline",
  options: {
    thresholdDb: -40,
    minimumSilenceSeconds: 0.5,
    paddingSeconds: 0.1,
  },
});

async function post(base: string, route: string, body: unknown) {
  return fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForJob(base: string, jobId: string, status: string) {
  const deadline = Date.now() + 10_000;
  let latest: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/silence/jobs/${jobId}`);
    latest = (await response.json()) as Record<string, unknown>;
    const job = latest.job as Record<string, unknown> | undefined;
    if (job?.status === status) return job;
    if (job?.status === "failed" || job?.status === "cancelled")
      throw new Error(
        `Silence Job ended as ${String(job.status)}: ${JSON.stringify(latest)}`,
      );
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(
    `Silence Job did not reach ${status}: ${JSON.stringify(latest)}`,
  );
}

it("serves real silence analysis, review and explicit idempotent Apply over HTTP", async () => {
  const f = await fixture();
  const createdResponse = await post(
    f.base,
    "/api/silence/jobs",
    input(f.projectId),
  );
  expect(createdResponse.status).toBe(202);
  const created = (await createdResponse.json()) as {
    created: boolean;
    job: {
      id: string;
      status: string;
      silenceAnalysis: { baseRevision: string };
    };
  };
  expect(created.created).toBe(true);
  expect(created.job.silenceAnalysis.baseRevision).toBe(f.revision);
  const reviewed = await waitForJob(f.base, created.job.id, "waiting-review");
  expect(reviewed.status).toBe("waiting-review");

  const duplicate = await post(f.base, "/api/silence/jobs", input(f.projectId));
  expect(duplicate.status).toBe(202);
  expect(await duplicate.json()).toMatchObject({
    created: false,
    job: { id: created.job.id, status: "waiting-review" },
  });
  expect(
    (
      await post(f.base, "/api/silence/jobs", {
        ...input(f.projectId),
        assetId: "different-asset",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post(f.base, "/api/silence/jobs", {
        ...input(f.projectId, "bad-field"),
        execute: "arbitrary project content is never executable",
      })
    ).status,
  ).toBe(400);

  const reviewResponse = await fetch(
    `${f.base}/api/silence/jobs/${created.job.id}/review`,
  );
  expect(reviewResponse.status).toBe(200);
  const review = (await reviewResponse.json()) as {
    review: { reviewId: string; proposal: { sourceHash: string } };
  };
  expect(review.review.reviewId).toBe(
    (reviewed.silenceAnalysis as { reviewId: string }).reviewId,
  );
  expect(review.review.proposal.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
  const applyInput = {
    reviewId: review.review.reviewId,
    proposal: review.review.proposal,
    requestId: "apply-http-1",
  };
  const apply = await post(
    f.base,
    `/api/silence/jobs/${created.job.id}/apply`,
    applyInput,
  );
  expect(apply.status).toBe(200);
  const applied = (await apply.json()) as {
    job: { status: string };
    edit: {
      revision: string;
      composition: { duration: number; tracks: { clips: unknown[] }[] };
    };
  };
  expect(applied.job.status).toBe("completed");
  expect(applied.edit.composition.duration).toBeCloseTo(3.2);
  expect(applied.edit.composition.tracks[0]!.clips).toHaveLength(2);
  expect(await hashFile(f.source)).toBe(review.review.proposal.sourceHash);
  const undo = await post(f.base, "/api/compositions/timeline/undo", {
    baseRevision: applied.edit.revision,
  });
  expect(undo.status).toBe(200);
  const undone = (await undo.json()) as {
    revision: string;
    composition: { duration: number; tracks: { clips: unknown[] }[] };
  };
  expect(undone.composition.duration).toBe(4);
  expect(undone.composition.tracks[0]!.clips).toHaveLength(1);
  const redo = await post(f.base, "/api/compositions/timeline/redo", {
    baseRevision: undone.revision,
  });
  expect(redo.status).toBe(200);
  const redone = (await redo.json()) as {
    composition: { duration: number; tracks: { clips: unknown[] }[] };
  };
  expect(redone.composition.duration).toBeCloseTo(3.2);
  expect(redone.composition.tracks[0]!.clips).toHaveLength(2);

  await f.server.close();
  servers.splice(servers.indexOf(f.server), 1);
  const reopened = await startServer({ port: 0, project: f.directory });
  servers.push(reopened);
  const replay = await post(
    `http://127.0.0.1:${reopened.port}`,
    `/api/silence/jobs/${created.job.id}/apply`,
    applyInput,
  );
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({
    job: { status: "completed" },
    edit: { acknowledgedRevision: expect.any(String) },
  });
});

it("serves selection-only Reviews through a new durable child Job", async () => {
  const f = await fixture();
  const created = (await (
    await post(f.base, "/api/silence/jobs", input(f.projectId, "review-parent"))
  ).json()) as { job: { id: string } };
  const parent = await waitForJob(f.base, created.job.id, "waiting-review");
  const parentReview = await (
    await fetch(`${f.base}/api/silence/jobs/${created.job.id}/review`)
  ).json();
  const sourceReviewId = (parentReview as { review: { reviewId: string } })
    .review.reviewId;
  const request = {
    requestId: "review-selection-child",
    reviewId: sourceReviewId,
    selectedCandidateIds: [],
  };
  const revised = await post(
    f.base,
    `/api/silence/jobs/${created.job.id}/review`,
    request,
  );
  expect(revised.status).toBe(202);
  const child = (await revised.json()) as {
    created: boolean;
    job: {
      id: string;
      status: string;
      silenceAnalysis: Record<string, unknown>;
    };
  };
  expect(child.created).toBe(true);
  expect(child.job).toMatchObject({
    status: "queued",
    silenceAnalysis: {
      parentJobId: created.job.id,
      sourceReviewId,
      selectedCandidateIds: [],
    },
  });
  const childWaiting = await waitForJob(f.base, child.job.id, "waiting-review");
  const derivedReview = await (
    await fetch(`${f.base}/api/silence/jobs/${child.job.id}/review`)
  ).json();
  expect(
    (derivedReview as { review: { reviewId: string } }).review.reviewId,
  ).not.toBe(sourceReviewId);
  expect(childWaiting.silenceAnalysis).toMatchObject({
    sourceReviewId,
    selectedCandidateIds: [],
  });
  expect(
    await (
      await post(f.base, `/api/silence/jobs/${created.job.id}/review`, request)
    ).json(),
  ).toMatchObject({ created: false, job: { id: child.job.id } });
  expect(parent.status).toBe("waiting-review");
  expect(
    (
      (await (
        await fetch(`${f.base}/api/silence/jobs/${created.job.id}/review`)
      ).json()) as { review: { reviewId: string } }
    ).review.reviewId,
  ).toBe(sourceReviewId);
});

it("cancels a running HTTP Job without allowing its late callback to publish a Review", async () => {
  const f = await fixture();
  let start: (() => void) | undefined;
  let lateProgress: ((progress: number) => void) | undefined;
  const running = new Promise<void>(
    (resolveStarted) => (start = resolveStarted),
  );
  vi.spyOn(SilenceService.prototype, "createBoundProposal").mockImplementation(
    async (_compositionId, _assetId, _identity, options) => {
      if (!options) throw new Error("Expected job options");
      lateProgress = options.onProgress;
      await new Promise((_, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(new Error("Cancelled test analysis")),
          { once: true },
        );
        start?.();
      });
      throw new Error("Unexpected analysis completion");
    },
  );
  const response = await post(
    f.base,
    "/api/silence/jobs",
    input(f.projectId, "cancel-create"),
  );
  const created = (await response.json()) as { job: { id: string } };
  await running;
  const cancelled = await post(
    f.base,
    `/api/silence/jobs/${created.job.id}/cancel`,
    {},
  );
  expect(cancelled.status).toBe(200);
  expect(await cancelled.json()).toMatchObject({
    job: { status: "cancelled" },
  });
  lateProgress?.(1);
  const get = await fetch(`${f.base}/api/silence/jobs/${created.job.id}`);
  expect(await get.json()).toMatchObject({ job: { status: "cancelled" } });
  expect(
    (await fetch(`${f.base}/api/silence/jobs/${created.job.id}/review`)).status,
  ).toBe(404);
});

it("retries a failed HTTP Job once and keeps the original request identities", async () => {
  const f = await fixture();
  const original = SilenceService.prototype.createBoundProposal;
  vi.spyOn(SilenceService.prototype, "createBoundProposal")
    .mockRejectedValueOnce(new Error("synthetic first attempt failure"))
    .mockImplementation(function (this: SilenceService, ...args) {
      return original.apply(this, args);
    });
  const response = await post(
    f.base,
    "/api/silence/jobs",
    input(f.projectId, "retry-create"),
  );
  const created = (await response.json()) as { job: { id: string } };
  await waitForJob(f.base, created.job.id, "failed");
  const retry = await post(
    f.base,
    `/api/silence/jobs/${created.job.id}/retry`,
    { requestId: "retry-http-1" },
  );
  expect(retry.status).toBe(202);
  expect(await retry.json()).toMatchObject({
    created: true,
    job: {
      status: "queued",
      silenceAnalysis: {
        attempt: 2,
        baseRevision: f.revision,
        requestId: "retry-create",
      },
    },
  });
  await waitForJob(f.base, created.job.id, "waiting-review");
  const duplicateRetry = await post(
    f.base,
    `/api/silence/jobs/${created.job.id}/retry`,
    { requestId: "retry-http-1" },
  );
  expect(duplicateRetry.status).toBe(202);
  expect(await duplicateRetry.json()).toMatchObject({
    created: false,
    job: { status: "waiting-review", silenceAnalysis: { attempt: 2 } },
  });
});

it("fails an HTTP Job before publishing a Review when its ripple would split local audio automation", async () => {
  const f = await fixture();
  await f.server.close();
  servers.splice(servers.indexOf(f.server), 1);
  const application = await OpenFilmApplication.open(f.directory);
  application.project.timelines[0]!.tracks[0]!.clips[0]!.audioAutomation = {
    version: 1,
    role: "dialogue",
    fadeIn: 0.4,
    fadeOut: 0.6,
    points: [{ time: 3, gain: 0.5 }],
    ducking: [{ start: 0.5, end: 3.5, gain: 0.7, attack: 0.1, release: 0.1 }],
  };
  await application.save();
  application.close();

  const server = await startServer({ port: 0, project: f.directory });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const response = await post(
    base,
    "/api/silence/jobs",
    input(f.projectId, "automation-protected-create"),
  );
  expect(response.status).toBe(202);
  const created = (await response.json()) as { job: { id: string } };
  const failed = await waitForJob(base, created.job.id, "failed");
  expect(failed.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "timeline.audioAutomationConflict" }),
    ]),
  );
  expect(
    (await fetch(`${base}/api/silence/jobs/${created.job.id}/review`)).status,
  ).toBe(404);
});

it("requires stopped-owner evidence for the recover endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-silence-recover-http-"));
  roots.push(root);
  const source = join(root, "voice.wav");
  await writeFile(source, wave());
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(
    directory,
    "Unknown owner recovery",
  );
  const asset: MediaAsset = {
    id: "voice",
    name: "voice.wav",
    uri: pathToFileURL(source).href,
    contentHash: await hashFile(source),
    mediaType: "audio",
    duration: 4,
    tags: [],
    state: {},
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  app.project.stories.push({ id: "story", title: "Voice", beats: [] });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 4,
    tracks: [],
  });
  await app.save();
  const result = await app.silenceJobs.create(
    input(app.project.id, "recover-create"),
  );
  const unknownOwner = {
    ...result.job,
    analysisOwner: {
      host: "unverified-process-scope",
      pid: 123456,
      token: "owner",
    },
  };
  app.catalog.saveJob(unknownOwner);
  app.close();

  const server = await startServer({ port: 0, project: directory });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const stateResponse = await fetch(
    `${base}/api/silence/jobs/${result.job.id}`,
  );
  const state = (await stateResponse.json()) as {
    job: { status: string };
    recovery: {
      checkpoint: string;
      ownerToken?: string;
      manualRecoveryAllowed: boolean;
    };
  };
  expect(state.job.status).toBe("queued");
  expect(state.recovery.manualRecoveryAllowed).toBe(true);
  const rejected = await post(
    base,
    `/api/silence/jobs/${result.job.id}/recover`,
    {
      confirmStopped: false,
      checkpoint: state.recovery.checkpoint,
      ownerToken: state.recovery.ownerToken,
    },
  );
  expect(rejected.status).toBe(400);
  const recovered = await post(
    base,
    `/api/silence/jobs/${result.job.id}/recover`,
    {
      confirmStopped: true,
      checkpoint: state.recovery.checkpoint,
      ownerToken: state.recovery.ownerToken,
    },
  );
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({
    job: { status: "failed", stage: "interrupted" },
  });
});

it("recovers a reserved Job from a different operating process after that owner exits", async () => {
  const f = await fixture();
  await f.server.close();
  servers.splice(servers.indexOf(f.server), 1);
  const applicationEntry = pathToFileURL(
    resolve("packages/application/src/index.ts"),
  ).href;
  const serverEntry = pathToFileURL(resolve("apps/server/src/server.ts")).href;
  const script = `
    import { OpenFilmApplication } from ${JSON.stringify(applicationEntry)};
    import { startServer } from ${JSON.stringify(serverEntry)};
    const directory = process.env.OPENFILM_TEST_PROJECT;
    const server = await startServer({ port: 0, project: directory });
    const app = await OpenFilmApplication.open(directory);
    const result = await app.silenceJobs.create({
      projectId: app.project.id,
      requestId: 'cross-process-create',
      assetId: 'voice',
      compositionId: 'timeline',
      options: { thresholdDb: -40, minimumSilenceSeconds: 0.5, paddingSeconds: 0.1 },
    });
    process.stdout.write(JSON.stringify({ port: server.port, jobId: result.job.id }) + '\\n');
    process.stdin.resume();
    await new Promise(() => undefined);
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: resolve("."),
      env: { ...process.env, OPENFILM_TEST_PROJECT: f.directory },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const lines = createInterface({ input: child.stdout! });
  const ready = await new Promise<{ port: number; jobId: string }>(
    (resolveReady, rejectReady) => {
      const timeout = setTimeout(
        () =>
          rejectReady(new Error(`Child server startup timed out: ${stderr}`)),
        20_000,
      );
      lines.once("line", (line) => {
        clearTimeout(timeout);
        try {
          resolveReady(JSON.parse(line) as { port: number; jobId: string });
        } catch (error) {
          rejectReady(error);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        rejectReady(
          new Error(`Child exited before readiness (${code}): ${stderr}`),
        );
      });
    },
  );
  const beforeDeath = await fetch(
    `http://127.0.0.1:${ready.port}/api/silence/jobs/${ready.jobId}`,
  );
  expect((await beforeDeath.json()).job).toMatchObject({ status: "queued" });
  child.kill("SIGKILL");
  await new Promise<void>((resolveExit, rejectExit) => {
    child.once("exit", (code, signal) => {
      if (signal === "SIGKILL" || code === 137) resolveExit();
      else
        rejectExit(new Error(`Expected killed child; got ${code}/${signal}`));
    });
  });
  const recovered = await startServer({ port: 0, project: f.directory });
  servers.push(recovered);
  const afterRestart = await fetch(
    `http://127.0.0.1:${recovered.port}/api/silence/jobs/${ready.jobId}`,
  );
  expect(await afterRestart.json()).toMatchObject({
    job: { status: "failed", stage: "interrupted" },
  });
});

it("reserves one Job when two server processes receive the same create request concurrently", async () => {
  const f = await fixture();
  const serverEntry = pathToFileURL(resolve("apps/server/src/server.ts")).href;
  const script = `
    import { startServer } from ${JSON.stringify(serverEntry)};
    const server = await startServer({ port: 0, project: process.env.OPENFILM_TEST_PROJECT });
    process.stdout.write(JSON.stringify({ port: server.port }) + '\\n');
    process.stdin.resume();
    await new Promise(() => undefined);
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: resolve("."),
      env: { ...process.env, OPENFILM_TEST_PROJECT: f.directory },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const lines = createInterface({ input: child.stdout! });
  const ready = await new Promise<{ port: number }>(
    (resolveReady, rejectReady) => {
      const timeout = setTimeout(
        () =>
          rejectReady(new Error(`Child server startup timed out: ${stderr}`)),
        20_000,
      );
      lines.once("line", (line) => {
        clearTimeout(timeout);
        try {
          resolveReady(JSON.parse(line) as { port: number });
        } catch (error) {
          rejectReady(error);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        rejectReady(
          new Error(`Child exited before readiness (${code}): ${stderr}`),
        );
      });
    },
  );
  const childBase = `http://127.0.0.1:${ready.port}`;
  const [first, second] = await Promise.all([
    post(
      f.base,
      "/api/silence/jobs",
      input(f.projectId, "cross-process-idempotent"),
    ),
    post(
      childBase,
      "/api/silence/jobs",
      input(f.projectId, "cross-process-idempotent"),
    ),
  ]);
  expect([first.status, second.status]).toEqual([202, 202]);
  const results = (await Promise.all([first.json(), second.json()])) as Array<{
    created: boolean;
    job: { id: string; status: string };
  }>;
  expect(results[0]!.job.id).toBe(results[1]!.job.id);
  expect(results.map((result) => result.created).sort()).toEqual([false, true]);
  await waitForJob(f.base, results[0]!.job.id, "waiting-review");
  child.kill("SIGKILL");
  await new Promise<void>((resolveExit, rejectExit) => {
    child.once("exit", (code, signal) => {
      if (signal === "SIGKILL" || code === 137) resolveExit();
      else
        rejectExit(new Error(`Expected killed child; got ${code}/${signal}`));
    });
  });
});

it("renders immutable reviewed before/after audition over HTTP and fences request identity and stale sources", async () => {
  const f = await fixture();
  const created = await post(
    f.base,
    "/api/silence/jobs",
    input(f.projectId, "audition-analysis"),
  );
  expect(created.status).toBe(202);
  const { job } = (await created.json()) as { job: { id: string } };
  await waitForJob(f.base, job.id, "waiting-review");
  const reviewResponse = await fetch(
    `${f.base}/api/silence/jobs/${job.id}/review`,
  );
  expect(reviewResponse.status).toBe(200);
  const { review } = (await reviewResponse.json()) as {
    review: { reviewId: string; proposal: unknown };
  };
  const route = `/api/silence/jobs/${job.id}/audition`;
  const body = { ...review, requestId: "audition-http", windowSeconds: 0.5 };
  const persistedBefore = await readFile(join(f.directory, "project.json"));
  const prepared = await post(f.base, route, body);
  expect(prepared.status).toBe(200);
  const result = (await prepared.json()) as {
    parity: string;
    before: { id: string; lengthSamples: number };
    after: { id: string; lengthSamples: number };
    removedSamples: number;
    seams: unknown[];
  };
  expect(result.parity).toBe("renderer");
  expect(result.before.lengthSamples - result.after.lengthSamples).toBe(
    result.removedSamples,
  );
  expect(result.removedSamples).toBeGreaterThan(0);
  expect(result.seams).toHaveLength(1);
  const duplicate = await post(f.base, route, body);
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toEqual(result);
  expect(
    (await post(f.base, route, { ...body, windowSeconds: 1 })).status,
  ).toBe(409);
  expect(
    (
      await post(f.base, route, {
        ...body,
        requestId: "bad-window",
        windowSeconds: 20,
      })
    ).status,
  ).toBe(400);
  expect(await readFile(join(f.directory, "project.json"))).toEqual(
    persistedBefore,
  );
  const pcmUrl = `${f.base}/api/record-audio-preview/${result.after.id}/pcm?startSample=0&count=100`;
  const pcm = await fetch(pcmUrl);
  expect(pcm.status).toBe(200);
  expect((await pcm.arrayBuffer()).byteLength).toBe(600);
  await writeFile(f.source, wave());
  expect((await fetch(pcmUrl)).status).toBe(409);
  expect(await readFile(join(f.directory, "project.json"))).toEqual(
    persistedBefore,
  );
});

it("rejects audition completion when another save lands before the HTTP response", async () => {
  const f = await fixture();
  const response = await post(
    f.base,
    "/api/silence/jobs",
    input(f.projectId, "late-save"),
  );
  expect(response.status).toBe(202);
  const { job } = (await response.json()) as { job: { id: string } };
  await waitForJob(f.base, job.id, "waiting-review");
  const reviewResponse = await fetch(
    `${f.base}/api/silence/jobs/${job.id}/review`,
  );
  const { review } = (await reviewResponse.json()) as {
    review: { reviewId: string; proposal: unknown };
  };
  const savedBytes = await readFile(join(f.directory, "project.json"));
  const original = SilenceJobService.prototype.audition;
  vi.spyOn(SilenceJobService.prototype, "audition").mockImplementationOnce(
    async function (this: SilenceJobService, ...args) {
      const result = await original.apply(this, args);
      const path = join(f.directory, "project.json");
      const saved = JSON.parse(await readFile(path, "utf8"));
      saved.timelines[0].tracks[0].clips[0].locked = true;
      await writeFile(path, JSON.stringify(saved));
      return result;
    },
  );
  expect(
    (
      await post(f.base, `/api/silence/jobs/${job.id}/audition`, {
        ...review,
        requestId: "late-save-preview",
      })
    ).status,
  ).toBe(409);
  await writeFile(join(f.directory, "project.json"), savedBytes);
});
