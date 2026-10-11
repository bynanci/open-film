import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import type { Job } from "@openfilm/core";
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "@openfilm/plugin-sdk";
import { startServer } from "../../apps/server/src/server.js";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function result(text: string): TranscriptionResult {
  return {
    text,
    language: "en",
    execution: "cpu",
    model: "explicit-cancellation-fixture-not-asr",
    version: "test-1",
    segments: [{ start: 0, end: 1, text, words: [{ start: 0, end: 1, text }] }],
  };
}

describe("HTTP cancellation of a non-cooperating transcription provider", () => {
  it.each(["resolve", "reject"] as const)(
    "releases both project guards before the provider can %s, preserves prior evidence and allows reopen/retry",
    async (settlement) => {
      const root = await mkdtemp(join(tmpdir(), "openfilm-cancel-http-"));
      cleanups.push(() => rm(root, { recursive: true, force: true }));
      const source = join(root, "訪問 # & cancellation.wav");
      await runProcess("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000:duration=2",
        source,
      ]);
      const sourceHash = await hashFile(source);
      const directory = join(root, "film.openfilm");
      const userDataDirectory = join(root, "isolated-user-data");
      const app = await OpenFilmApplication.create(
        directory,
        "Keep my film",
        {},
        { userDataDirectory },
      );
      expect(
        (await app.importFiles([source], { proxies: false })).imported,
      ).toBe(1);
      const asset = app.catalog.listAssets()[0]!;
      const provider: TranscriptionProvider = {
        id: "http-cancellation-test-only",
        name: "Explicit held-provider fixture — not speech recognition",
        kind: "transcription",
        execution: "local",
        dataKinds: ["audio", "metadata"],
        capabilities: {
          wordTimestamps: true,
          languages: ["en"],
          cpuFallback: true,
        },
        async transcribe() {
          return result("Existing transcript");
        },
      };
      app.intelligence.registerTranscriptionProvider(provider);
      expect(
        (await app.analyzeIntelligence(asset.id, { operation: "transcribe" }))
          .status,
      ).toBe("completed");
      const before = await app.intelligence.read(asset.id);
      const story = app.generateStory({
        assetIds: [asset.id],
        targetDuration: 2,
        maxDuration: 10,
      });
      app.compose(story.id);
      app.close();
      const projectBefore = structuredClone(app.project);

      let options: TranscriptionOptions | undefined;
      let invoked = false;
      let providerSettled = false;
      let resolveHeld!: (value: TranscriptionResult) => void;
      let rejectHeld!: (reason: Error) => void;
      const held = new Promise<TranscriptionResult>((resolve, reject) => {
        resolveHeld = resolve;
        rejectHeld = reject;
      });
      const runtime = await startServer({
        port: 0,
        project: directory,
        userDataDirectory,
        transcriptionProvider: {
          ...provider,
          async transcribe(_asset, value) {
            if (invoked) return result("Successful retry");
            invoked = true;
            options = value;
            value?.onStage?.("transcribing");
            // Deliberately ignores AbortSignal. Cancellation must not await this.
            try {
              return await held;
            } finally {
              providerSettled = true;
            }
          },
        },
      });
      cleanups.push(() => runtime.close());
      // Release a deliberately stuck fixture if any assertion fails, so teardown
      // also terminates on the old broken implementation.
      cleanups.push(() => resolveHeld(result("Teardown only")));
      const base = `http://127.0.0.1:${runtime.port}/api`;
      const post = (path: string, value: unknown = {}) =>
        fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        });
      const jobs = async (): Promise<Job[]> =>
        (await (await fetch(`${base}/jobs`)).json()).jobs;
      const intelligence = async () =>
        await (await fetch(`${base}/assets/${asset.id}/intelligence`)).json();
      const started = await post(`/assets/${asset.id}/intelligence`, {
        operation: "transcribe",
        language: "en",
      });
      expect(started.status).toBe(202);
      const { job } = (await started.json()) as { job: Job };
      await expect.poll(() => invoked).toBe(true);
      expect((await post("/project/close")).status).toBe(409);
      expect((await post(`/jobs/${job.id}/cancel`)).status).toBe(200);
      await expect
        .poll(async () => (await jobs()).find((j) => j.id === job.id)?.status, {
          timeout: 2000,
        })
        .toBe("cancelled");
      expect(options?.signal?.aborted).toBe(true);
      expect(providerSettled).toBe(false);
      const cancelled = (await jobs()).find((j) => j.id === job.id)!;
      expect((await intelligence()).transcript).toEqual(before.transcript);

      // Both the HTTP task map and application lifecycle guard must be released.
      expect((await post("/project/close")).status).toBe(200);
      options?.onStage?.("indexing");
      options?.onProgress?.(1);
      expect((await post("/project/open", { path: directory })).status).toBe(
        200,
      );
      expect((await intelligence()).transcript).toEqual(before.transcript);
      const retryResponse = await post(`/assets/${asset.id}/intelligence`, {
        operation: "transcribe",
        language: "en",
      });
      expect(retryResponse.status).toBe(202);
      const retry = ((await retryResponse.json()) as { job: Job }).job;
      await expect
        .poll(async () => (await jobs()).find((j) => j.id === retry.id)?.status)
        .toBe("completed");
      const successor = (await intelligence()).transcript;
      expect(successor.segments[0].text).toBe("Successful retry");
      options?.onStage?.("transcribing");
      options?.onProgress?.(0.1);
      if (settlement === "resolve") resolveHeld(result("Obsolete late result"));
      else rejectHeld(new Error("Obsolete late provider failure"));
      // An event-loop turn makes a late rejection/write observable; no sleep or
      // swallowed provider errors can make a stuck provider pass this test.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(providerSettled).toBe(true);
      expect((await jobs()).find((j) => j.id === job.id)).toEqual(cancelled);
      expect((await intelligence()).transcript).toEqual(successor);
      const projectAfter = (await (await fetch(`${base}/project`)).json())
        .project;
      expect(projectAfter).toEqual({
        ...projectBefore,
        // Closing a project updates only its save timestamp.
        updatedAt: projectAfter.updatedAt,
      });
      expect(await hashFile(source)).toBe(sourceHash);
      expect((await post("/project/close")).status).toBe(200);
      expect((await post("/project/open", { path: directory })).status).toBe(
        200,
      );
      expect((await intelligence()).transcript).toEqual(successor);
      expect((await jobs()).find((j) => j.id === job.id)).toEqual(cancelled);
    },
    30000,
  );
});
