import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { OpenFilmApplication } from "../src/index.js";
import { hashFile } from "@openfilm/media";
import type { Job } from "@openfilm/core";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function waitForKernelStop(child: ChildProcess, stderr: () => string) {
  const deadline = performance.now() + 10_000;
  let state = "unknown";
  const diagnostic = () =>
    `PID ${child.pid}, state ${state}, exit ${child.exitCode}, signal ${child.signalCode}: ${stderr()}`;
  while (performance.now() < deadline) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `Review child exited before kernel stop; ${diagnostic()}`,
      );
    let status: string;
    try {
      status = await readFile(`/proc/${child.pid}/status`, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(
          `Review child disappeared before kernel stop; ${diagnostic()}`,
          { cause: error },
        );
      throw error;
    }
    state = /^State:\s+(\S+)/mu.exec(status)?.[1] ?? "unknown";
    if (state === "T") return;
    if (state === "Z" || state === "X")
      throw new Error(
        `Review child exited before kernel stop; ${diagnostic()}`,
      );
    await delay(10);
  }
  throw new Error(`Review child did not reach kernel stop; ${diagnostic()}`);
}

it("fails kernel-stop synchronization promptly if the review child already exited", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(7)"], {
    stdio: "ignore",
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exit;
  });
  expect(await exit).toBe(7);
  await expect(waitForKernelStop(child, () => "fixture exit")).rejects.toThrow(
    /exited before kernel stop;.*exit 7.*fixture exit/u,
  );
});

it.skipIf(process.platform !== "linux").each(["language", "glossary"] as const)(
  "manual recovery fences initial %s batch insertion from a resumed previous process",
  async (source) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-initial-recovery-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const media = join(root, "identity.wav");
    await writeFile(media, "Identity-only source, no ASR claim");
    const sourceHash = await hashFile(media);
    const directory = join(root, "film.openfilm");
    const runtime = { userDataDirectory: join(root, "user") };
    const app = await OpenFilmApplication.create(
      directory,
      "Recovery",
      {},
      runtime,
    );
    cleanup.push(() => app.close());
    app.catalog.upsertAsset({
      id: "source",
      uri: pathToFileURL(media).href,
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
        providerId: "fixture-not-ASR",
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
    const childFile = join(root, "paused-review.mts");
    const stopGate = join(root, "allow-kernel-stop");
    await writeFile(
      childFile,
      `
 import {OpenFilmApplication} from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
 import {existsSync} from 'node:fs';
 const [directory,userDataDirectory,source,stopGate]=process.argv.slice(2);
 const app=await OpenFilmApplication.open(directory,{userDataDirectory});
 let providerCalls=0;
 app.knowledge.registerLanguageProvider({id:'fixture',name:'Fixture',kind:'language',execution:'local',dataKinds:['text','transcripts'],async generate(){providerCalls++;return '{"suggestions":[]}';}});
 let paused=false;
 try { await app.runKnowledgeReview('source',{source,jobId:'initial-review',batchSize:1,onJob(job){if(!paused && job.status==='queued'){paused=true;process.send({type:'paused',job});while(!existsSync(stopGate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);process.kill(process.pid,'SIGSTOP');}}});process.send({type:'finished'}); }
 catch(error){process.send({type:'failed',error:String(error),providerCalls,batches:app.knowledge.batches('initial-review')});}
 finally {app.close();process.disconnect();}
 `,
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
        childFile,
        directory,
        runtime.userDataDirectory,
        source,
        stopGate,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let stderr = "";
    child.stdout!.resume();
    child.stderr!.on("data", (b) => (stderr += String(b)));
    const messages: Array<Record<string, unknown>> = [];
    child.on("message", (message) =>
      messages.push(message as Record<string, unknown>),
    );
    const exit = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await exit;
    });
    await expect
      .poll(() => messages.find((item) => item.type === "paused"), {
        timeout: 10000,
      })
      .toBeDefined();
    // Force the announcement to arrive before SIGSTOP. Without the kernel
    // handshake, SIGCONT runs before this microtask releases the child and is
    // lost; its subsequent stop then hangs until the unchanged test timeout.
    queueMicrotask(() => writeFileSync(stopGate, "stop"));
    await waitForKernelStop(child, () => stderr);
    const job = messages.find((item) => item.type === "paused")!.job as Job;
    expect(job.reviewOwner!.pid).toBe(child.pid);
    expect(app.knowledge.batches(job.id)).toEqual([]);
    // Actual child owner, actual persisted checkpoint. Emulate an unavailable
    // liveness probe (e.g. permission or unverifiable workstation scope), not a
    // fabricated dead PID. The old process is genuinely paused, then resumes.
    const probe = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === child.pid && signal === 0)
        throw Object.assign(new Error("Cannot verify owner"), {
          code: "EPERM",
        });
      return probe(pid, signal);
    });
    const observed = app.knowledge.reviewRecoveryStatus(job.id);
    expect(observed).toMatchObject({
      ownerState: "unknown",
      manualRecoveryAllowed: true,
    });
    const recovered = app.knowledge.manualRecoverReview(job.id, {
      confirmStopped: true,
      ownerToken: observed.ownerToken,
      updatedAt: observed.updatedAt,
    });
    expect(recovered.reviewOwner!.token).not.toBe(job.reviewOwner!.token);
    expect(app.knowledge.batches(job.id)).toEqual([]);
    child.kill("SIGCONT");
    expect(await exit, stderr).toBe(0);
    expect(
      messages.find((item) => item.type === "failed"),
      stderr,
    ).toBeDefined();
    expect(app.catalog.listJobs().find((j) => j.id === job.id)).toEqual(
      recovered,
    );
    expect(messages.find((item) => item.type === "failed")?.providerCalls).toBe(
      0,
    );
    expect(await hashFile(media)).toBe(sourceHash);
    expect(app.knowledge.batches(job.id)).toEqual([]);
  },
  30000,
);
