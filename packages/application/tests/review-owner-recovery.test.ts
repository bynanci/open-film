import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, ReviewBatch, ReviewExecutionOwner } from "@openfilm/core";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { hashFile } from "@openfilm/media";
import { CatalogKnowledgeStore, ProjectCatalog } from "@openfilm/catalog";
import {
  createReviewOwner,
  ownsReviewOwner,
  OpenFilmApplication,
  reviewOwnerState,
} from "../src/index.js";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});
function correction(prompt: string) {
  const data = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
    segments: { segmentId: string; text: string }[];
  };
  return JSON.stringify({
    suggestions: data.segments.map((segment) => ({
      segmentId: segment.segmentId,
      after: `${segment.text} corrected`,
      reason: "Deterministic owner fixture, not model quality evidence",
    })),
  });
}
function provider(generate: LanguageProvider["generate"]): LanguageProvider {
  return {
    id: "owner-fixture",
    name: "Held owner fixture",
    kind: "language",
    execution: "local",
    dataKinds: ["text", "transcripts"],
    generate,
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-review-owner-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "identity.wav");
  await writeFile(source, "Identity-only audio; no ASR or performance claim.");
  const sourceHash = await hashFile(source);
  const runtime = { userDataDirectory: join(root, "user-data") };
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(
    directory,
    "Review ownership",
    {},
    runtime,
  );
  let closed = false;
  cleanup.push(() => {
    if (!closed) app.close();
  });
  app.catalog.upsertAsset({
    id: "source",
    uri: pathToFileURL(source).href,
    name: "identity.wav",
    mediaType: "audio",
    duration: 10,
    contentHash: sourceHash,
    metadata: {},
    tags: [],
    state: {},
  });
  app.catalog.intelligence.replaceTranscript({
    id: "provider-result",
    assetId: "source",
    language: "en",
    provenance: {
      providerId: "fixture-not-asr",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: ["First", "Second", "Third"].map((text, index) => ({
      id: `segment-${index}`,
      start: index * 2,
      end: index * 2 + 1,
      text,
    })),
  });
  return {
    root,
    directory,
    runtime,
    app,
    closeSeed() {
      app.close();
      closed = true;
    },
    async open() {
      const reopened = await OpenFilmApplication.open(directory, runtime);
      cleanup.push(() => reopened.close());
      return reopened;
    },
  };
}
type Ready = {
  type: "ready";
  job: Job;
  batches: ReviewBatch[];
  suggestions: unknown[];
};
async function worker(
  context: Awaited<ReturnType<typeof fixture>>,
  mode: "queued" | "running",
) {
  const file = join(context.root, "review-worker.mts");
  await writeFile(
    file,
    `
    import {OpenFilmApplication,createReviewOwner} from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
    const [directory,userDataDirectory,mode]=process.argv.slice(2);
    const app=await OpenFilmApplication.open(directory,{userDataDirectory});
    let release;const gate=new Promise(done=>release=done);
    process.on('message',message=>{if(message==='release')release();});
    const ready=()=>process.send({type:'ready',job:app.catalog.listJobs().find(j=>j.id===jobId),batches:app.knowledge.batches(jobId),suggestions:app.catalog.knowledge.suggestionsList('source').suggestions});
    const jobId='child-review';let calls=0;
    app.knowledge.registerLanguageProvider({id:'owner-fixture',name:'Held local owner fixture',kind:'language',execution:'local',dataKinds:['text','transcripts'],async generate(prompt){
      if(++calls===2){ready();await gate;}
      const data=JSON.parse(prompt.slice(prompt.indexOf('\\n')+1));
      return JSON.stringify({suggestions:data.segments.map(segment=>({segmentId:segment.segmentId,after:segment.text+' corrected',reason:'Deterministic owner fixture, not model quality evidence'}))});
    }});
    try{
      if(mode==='queued'){
        app.catalog.saveJob({id:jobId,type:'language-review',assetId:'source',status:'queued',reviewOwner:createReviewOwner()});
        ready();await gate;
      }
      const job=await app.runKnowledgeReview('source',{source:'language',jobId,batchSize:1});
      app.close();process.send({type:'finished',job});process.disconnect();
    }catch(error){process.send({type:'error',message:String(error)});process.disconnect();process.exitCode=1;}
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
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const messages: { type: string; [key: string]: unknown }[] = [];
  let stderr = "";
  child.stderr!.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.on("message", (message) => {
    messages.push(message as (typeof messages)[number]);
  });
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  cleanup.push(async () => {
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
    ready: async () => (await message("ready")) as unknown as Ready,
    release() {
      child.send("release");
    },
    finished: () => message("finished"),
  };
}

describe("review recovery respects durable execution ownership", () => {
  it.each(["queued", "running"] as const)(
    "a second normal Open preserves an actual live child %s review and completed results",
    async (mode) => {
      const context = await fixture();
      context.closeSeed();
      const child = await worker(context, mode);
      const ready = await child.ready();
      expect(ready.job.reviewOwner?.pid).toBe(child.child.pid);
      expect(ownsReviewOwner(ready.job.reviewOwner)).toBe(false);
      if (process.platform === "linux")
        expect(reviewOwnerState(ready.job.reviewOwner)).toBe("alive");
      const reopened = await context.open();
      expect(
        reopened.catalog.listJobs().find((job) => job.id === ready.job.id),
      ).toEqual(ready.job);
      expect(reopened.knowledge.batches(ready.job.id)).toEqual(ready.batches);
      expect(
        reopened.catalog.knowledge.suggestionsList("source").suggestions,
      ).toEqual(ready.suggestions);
      child.release();
      expect((await child.finished()).job).toMatchObject({
        status: "completed",
      });
      expect((await child.exit).code).toBe(0);
      expect(
        reopened.knowledge
          .batches(ready.job.id)
          .every((batch) => batch.status === "completed"),
      ).toBe(true);
      expect((await reopened.knowledge.suggestionsList("source")).total).toBe(
        3,
      );
      for (const completed of ready.suggestions)
        expect(
          reopened.catalog.knowledge.suggestionsList("source").suggestions,
        ).toContainEqual(completed);
    },
  );

  it.skipIf(process.platform !== "linux")(
    "recovers only unfinished work from a killed and reaped actual child owner",
    async () => {
      const context = await fixture();
      context.closeSeed();
      const child = await worker(context, "running");
      const ready = await child.ready();
      child.child.kill("SIGKILL");
      expect((await child.exit).signal).toBe("SIGKILL");
      expect(() => process.kill(child.child.pid!, 0)).toThrowError(
        expect.objectContaining({ code: "ESRCH" }),
      );
      expect(reviewOwnerState(ready.job.reviewOwner)).toBe("dead");
      const reopened = await context.open();
      expect(
        reopened.catalog.listJobs().find((job) => job.id === ready.job.id),
      ).toMatchObject({
        status: "failed",
        stage: "interrupted",
        reviewOwner: ready.job.reviewOwner,
      });
      expect(
        reopened.knowledge.batches(ready.job.id).map((batch) => batch.status),
      ).toEqual(["completed", "cancelled", "cancelled"]);
      expect(reopened.knowledge.batches(ready.job.id)[0]).toEqual(
        ready.batches[0],
      );
      expect(
        (await reopened.knowledge.suggestionsList("source")).suggestions,
      ).toEqual(ready.suggestions);
      reopened.knowledge.registerLanguageProvider(
        provider(async (prompt) => correction(prompt)),
      );
      expect(
        (await reopened.retryKnowledgeReview(ready.job.id, 1)).status,
      ).toBe("cancelled");
      expect(reopened.knowledge.skipBatch(ready.job.id, 2).status).toBe(
        "skipped",
      );
      expect(
        reopened.catalog.listJobs().find((job) => job.id === ready.job.id)
          ?.status,
      ).toBe("completed");
      expect((await reopened.knowledge.suggestionsList("source")).total).toBe(
        2,
      );
      expect(
        (await reopened.knowledge.suggestionsList("source")).suggestions,
      ).toContainEqual(ready.suggestions[0]);
    },
  );

  it.skipIf(process.platform !== "linux")(
    "a normal Open cannot overwrite a newer SQLite retry claim after observing a dead owner",
    async () => {
      const context = await fixture();
      context.closeSeed();
      const child = await worker(context, "running");
      const ready = await child.ready();
      child.child.kill("SIGKILL");
      await child.exit;
      expect(reviewOwnerState(ready.job.reviewOwner)).toBe("dead");
      const second = new ProjectCatalog(context.directory);
      cleanup.push(() => second.close());
      const recover = CatalogKnowledgeStore.prototype.recoverReviewJob;
      let firstRecoveryResult: boolean | undefined;
      let claimedJob: Job | undefined;
      let claimedBatches: ReviewBatch[] | undefined;
      const recovery = vi
        .spyOn(CatalogKnowledgeStore.prototype, "recoverReviewJob")
        .mockImplementation(function (
          this: CatalogKnowledgeStore,
          observed,
          interrupted,
        ) {
          // First normal Open has already read/probed the actual dead child.
          // A second real SQLite connection wins recovery and a production
          // atomic retry claim before the first connection executes its CAS.
          expect(reviewOwnerState(observed.reviewOwner)).toBe("dead");
          expect(recover.call(second.knowledge, observed, interrupted)).toBe(
            true,
          );
          const recovered = second
            .listJobs()
            .find((job) => job.id === observed.id)!;
          const batch = second.knowledge.batches(observed.id)[1]!;
          expect(batch.status).toBe("cancelled");
          const running: ReviewBatch = {
            ...batch,
            status: "running",
            attempts: batch.attempts + 1,
            error: undefined,
          };
          claimedJob = {
            ...recovered,
            status: "running",
            reviewOwner: createReviewOwner(),
            updatedAt: new Date().toISOString(),
          };
          second.knowledge.compareAndSetBatch(batch, running, () =>
            second.knowledge.compareAndSetReviewJob(recovered, claimedJob!),
          );
          claimedBatches = second.knowledge.batches(observed.id);
          firstRecoveryResult = recover.call(this, observed, interrupted);
          return firstRecoveryResult;
        });
      const reopened = await context.open();
      expect(recovery).toHaveBeenCalledOnce();
      expect(firstRecoveryResult).toBe(false);
      expect(
        reopened.catalog.listJobs().find((job) => job.id === ready.job.id),
      ).toEqual(claimedJob);
      expect(reopened.knowledge.batches(ready.job.id)).toEqual(claimedBatches);
      expect(
        reopened.knowledge.batches(ready.job.id).map((batch) => batch.status),
      ).toEqual(["completed", "running", "cancelled"]);
      expect(reopened.knowledge.batches(ready.job.id)[0]).toEqual(
        ready.batches[0],
      );
      expect(second.listJobs().find((job) => job.id === ready.job.id)).toEqual(
        claimedJob,
      );
      expect(
        (await reopened.knowledge.suggestionsList("source")).suggestions,
      ).toEqual(ready.suggestions);
      expect(ownsReviewOwner(claimedJob?.reviewOwner)).toBe(true);
    },
  );

  it("a second application in the same process does not cancel active review work", async () => {
    const context = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let held!: () => void;
    const waiting = new Promise<void>((done) => {
      held = done;
    });
    let calls = 0;
    context.app.knowledge.registerLanguageProvider(
      provider(async (prompt) => {
        if (++calls === 2) {
          held();
          await gate;
        }
        return correction(prompt);
      }),
    );
    const work = context.app.runKnowledgeReview("source", {
      source: "language",
      batchSize: 1,
    });
    await waiting;
    const before = context.app.catalog.listJobs()[0]!;
    const batches = context.app.knowledge.batches(before.id);
    const completed =
      context.app.catalog.knowledge.suggestionsList("source").suggestions;
    const reopened = await context.open();
    // Release before assertions so a failed-before test leaves no active task.
    release();
    const observed = reopened.catalog
      .listJobs()
      .find((job) => job.id === before.id);
    const observedBatches = reopened.knowledge.batches(before.id);
    const finished = await work;
    expect(observed).toEqual(before);
    expect(observedBatches).toEqual(batches);
    expect(finished.status).toBe("completed");
    expect((await reopened.knowledge.suggestionsList("source")).total).toBe(3);
    for (const suggestion of completed)
      expect(
        reopened.catalog.knowledge.suggestionsList("source").suggestions,
      ).toContainEqual(suggestion);
  });

  it.each(["legacy", "foreign-host", "permission-unknown"] as const)(
    "preserves %s ownership instead of assuming a crashed job",
    async (kind) => {
      const context = await fixture();
      const owner = createReviewOwner();
      const reviewOwner: ReviewExecutionOwner | undefined =
        kind === "legacy"
          ? undefined
          : kind === "foreign-host"
            ? { ...owner, host: owner.host + ":foreign" }
            : { ...owner, pid: process.ppid };
      const state = await context.app.transcriptEditor.get("source");
      const job: Job = {
        id: "unknown-review",
        type: "language-review",
        assetId: "source",
        status: "running",
        ...(reviewOwner ? { reviewOwner } : {}),
      };
      context.app.catalog.saveJob(job);
      const batch: ReviewBatch = {
        jobId: job.id,
        index: 0,
        assetId: "source",
        sourceRevisionId: state.revision!,
        providerId: "owner-fixture",
        segmentIds: ["segment-0"],
        status: "running",
        attempts: 1,
      };
      context.app.catalog.knowledge.saveBatch(batch);
      if (kind === "permission-unknown")
        vi.spyOn(process, "kill").mockImplementation(() => {
          throw Object.assign(new Error("Owner liveness is not permitted"), {
            code: "EPERM",
          });
        });
      expect(reviewOwnerState(reviewOwner)).toBe("unknown");
      const reopened = await context.open();
      expect(
        reopened.catalog.listJobs().find((item) => item.id === job.id),
      ).toEqual(job);
      expect(reopened.knowledge.batches(job.id)).toEqual([batch]);
    },
  );

  it("recovers an unknown owner only after explicit confirmation against the exact checkpoint", async () => {
    const context = await fixture();
    const state = await context.app.transcriptEditor.get("source");
    const owner = createReviewOwner();
    const job: Job = {
      id: "manual-recovery",
      type: "language-review",
      assetId: "source",
      status: "running",
      reviewOwner: { ...owner, host: owner.host + ":foreign" },
      createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:01:00Z",
    };
    context.app.catalog.saveJob(job);
    const completed: ReviewBatch = {
      jobId: job.id,
      index: 0,
      assetId: "source",
      sourceRevisionId: state.revision!,
      providerId: "owner-fixture",
      segmentIds: ["segment-0"],
      status: "completed",
      attempts: 1,
    };
    const running: ReviewBatch = {
      ...completed,
      index: 1,
      segmentIds: ["segment-1"],
      status: "running",
    };
    const pending: ReviewBatch = {
      ...completed,
      index: 2,
      segmentIds: ["segment-2"],
      status: "pending",
      attempts: 0,
    };
    for (const batch of [completed, running, pending])
      context.app.catalog.knowledge.saveBatch(batch);

    const status = context.app.knowledge.reviewRecoveryStatus(job.id);
    expect(status).toEqual({
      jobId: job.id,
      ownerState: "unknown",
      manualRecoveryAllowed: true,
      ownerToken: job.reviewOwner!.token,
      updatedAt: job.updatedAt,
    });
    expect(() =>
      context.app.knowledge.manualRecoverReview(job.id, {
        confirmStopped: false,
        ownerToken: status.ownerToken,
        updatedAt: status.updatedAt,
      }),
    ).toThrow(/Confirm/);
    expect(() =>
      context.app.knowledge.manualRecoverReview(job.id, {
        confirmStopped: true,
        ownerToken: "stale-owner",
        updatedAt: status.updatedAt,
      }),
    ).toThrow(/changed/);

    const recovered = context.app.knowledge.manualRecoverReview(job.id, {
      confirmStopped: true,
      ownerToken: status.ownerToken,
      updatedAt: status.updatedAt,
    });
    expect(recovered).toMatchObject({
      id: job.id,
      status: "failed",
      stage: "interrupted",
      reviewOwner: job.reviewOwner,
    });
    expect(
      context.app.knowledge.batches(job.id).map((batch) => batch.status),
    ).toEqual(["completed", "cancelled", "cancelled"]);
    expect(context.app.knowledge.batches(job.id)[0]).toEqual(completed);
    expect(context.app.knowledge.reviewRecoveryStatus(job.id)).toMatchObject({
      manualRecoveryAllowed: false,
      ownerState: "unknown",
    });
  });

  it("rejects invalid requested job IDs before creating owned review jobs or invoking a provider", async () => {
    const context = await fixture();
    const generate = vi.fn<LanguageProvider["generate"]>(
      async () => '{"suggestions":[]}',
    );
    context.app.knowledge.registerLanguageProvider(provider(generate));
    const invalid = [
      "",
      " \t\n",
      "x".repeat(257),
      "job\t",
      "job\n",
      "job\u0000",
      42,
    ];
    for (const jobId of invalid) {
      const options = { jobId: jobId as string };
      await expect(
        context.app.knowledge.glossaryReview("source", options),
      ).rejects.toMatchObject({ code: "request.invalid" });
      await expect(
        context.app.knowledge.languageReview("source", options),
      ).rejects.toMatchObject({ code: "request.invalid" });
      expect(context.app.catalog.listJobs()).toEqual([]);
      expect(context.app.knowledge.batches(String(jobId))).toEqual([]);
    }
    expect(generate).not.toHaveBeenCalled();
    const reopened = await context.open();
    expect(reopened.catalog.listJobs()).toEqual([]);
    expect(
      (await reopened.transcriptEditor.get("source")).document?.segments.map(
        (segment) => segment.text,
      ),
    ).toEqual(["First", "Second", "Third"]);
  });

  it("only claims this process's actual reservation tokens and conservatively handles invalid owners", () => {
    const owned = createReviewOwner();
    expect(ownsReviewOwner(owned)).toBe(true);
    expect(reviewOwnerState(owned)).toBe("alive");
    expect(
      ownsReviewOwner({ ...owned, token: "not-a-created-local-token" }),
    ).toBe(false);
    const probe = vi.spyOn(process, "kill");
    for (const value of [
      undefined,
      null,
      {},
      { ...owned, pid: 0 },
      { ...owned, host: "different-host" },
      { ...owned, token: " " },
    ]) {
      expect(reviewOwnerState(value)).toBe("unknown");
      expect(ownsReviewOwner(value)).toBe(false);
    }
    expect(probe).not.toHaveBeenCalled();
  });
});
