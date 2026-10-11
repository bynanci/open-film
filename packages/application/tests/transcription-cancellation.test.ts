import { setImmediate } from "node:timers/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { Job, MediaAsset } from "@openfilm/core";
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionStage,
} from "@openfilm/plugin-sdk";
import { hashFile } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
function result(text = "Original spoken memory"): TranscriptionResult {
  return {
    text,
    language: "en",
    execution: "cpu",
    model: "explicit-control-flow-fixture-not-ASR",
    version: "fixture-1",
    segments: [
      { start: 0.5, end: 1.5, text, words: [{ start: 0.5, end: 1.5, text }] },
    ],
  };
}
function provider(
  transcribe: TranscriptionProvider["transcribe"],
): TranscriptionProvider {
  return {
    id: "explicit-cancellation-fixture",
    name: "Non-cooperating cancellation fixture, not speech recognition",
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-transcription-cancellation-"),
  );
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source-identity.wav");
  await writeFile(
    source,
    "Identity-only bytes: no media decoding or ASR quality claim.",
  );
  const sourceHash = await hashFile(source);
  const runtime = { userDataDirectory: join(root, "isolated-user-data") };
  const directory = join(root, "film.openfilm");
  let app = await OpenFilmApplication.create(
    directory,
    "Cancellation recovery",
    {},
    runtime,
  );
  cleanup.push(() => app.close());
  const asset: MediaAsset = {
    id: "source",
    uri: pathToFileURL(source).href,
    name: "source-identity.wav",
    mediaType: "audio",
    duration: 4,
    contentHash: sourceHash,
    metadata: {},
    tags: [],
    state: { locked: true, favorite: true },
    rating: 5,
  };
  app.catalog.upsertAsset(asset);
  app.catalog.intelligence.replaceTranscript({
    id: "explicit-provider-revision-fixture",
    assetId: asset.id,
    language: "en",
    provenance: {
      providerId: "explicit-fixture-not-ASR",
      model: "not-recognition-evidence",
      version: "1",
      sourceHash,
      createdAt: "2026-10-07T00:00:00Z",
    },
    segments: result().segments!.map((segment, index) => ({
      ...segment,
      id: `segment-${index}`,
    })),
  });
  const original = await app.transcriptEditor.get(asset.id);
  await app.transcriptEditor.edit(asset.id, {
    baseRevision: original.revision!,
    requestId: "saved-user-correction",
    commands: [
      {
        type: "replace-text",
        segmentId: "segment-0",
        text: "My saved manual correction",
      },
    ],
  });
  const before = await app.transcriptEditor.get(asset.id);
  expect(before.revisionInfo?.source).toBe("user");
  return {
    asset,
    source,
    sourceHash,
    before,
    get app() {
      return app;
    },
    async reopen() {
      app.close();
      app = await OpenFilmApplication.open(directory, runtime);
      return app;
    },
  };
}
function heldProvider(controller: AbortController, abortInside = false) {
  const work = deferred<TranscriptionResult>();
  const started = deferred<TranscriptionOptions | undefined>();
  let retained: TranscriptionOptions | undefined;
  const implementation = provider((_asset, options) => {
    retained = options;
    options?.onStage?.("loading-model");
    started.resolve(options);
    if (abortInside) controller.abort();
    // Deliberately ignore AbortSignal and remain pending until test cleanup or
    // an explicit late settlement. Cancellation assertions never release this.
    return work.promise;
  });
  return {
    implementation,
    work,
    started,
    get retained() {
      return retained;
    },
  };
}
async function cancelledWithoutProviderSettlement(
  pending: Promise<Job>,
  app: OpenFilmApplication,
) {
  let terminal: Job | undefined;
  pending.then(
    (job) => {
      terminal = job;
    },
    () => {},
  );
  await expect
    .poll(() => ({ status: terminal?.status, active: app.hasActiveJobs }), {
      timeout: 1000,
      message:
        "Cancellation must settle and release the film while its provider is still pending",
    })
    .toEqual({ status: "cancelled", active: false });
  return pending;
}

it("cancels a pending non-cooperating provider without settling it, preserving a manual revision and allowing immediate retry", async () => {
  const context = await fixture();
  const controller = new AbortController();
  const held = heldProvider(controller);
  context.app.intelligence.registerTranscriptionProvider(held.implementation);
  const observed: Job[] = [];
  const pending = context.app.analyzeIntelligence(context.asset.id, {
    operation: "transcribe",
    signal: controller.signal,
    onJob: (job) => observed.push(job),
  });
  try {
    await held.started.promise;
    controller.abort();
    const cancelled = await cancelledWithoutProviderSettlement(
      pending,
      context.app,
    );
    expect(
      context.app.catalog.listJobs().find((job) => job.id === cancelled.id),
    ).toEqual(cancelled);
    expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
      context.before,
    );
    const retryText = "Successfully retried after cancellation";
    context.app.intelligence.registerTranscriptionProvider(
      provider(async () => result(retryText)),
    );
    const retry = await context.app.analyzeIntelligence(context.asset.id, {
      operation: "transcribe",
    });
    expect(retry.status).toBe("completed");
    expect(retry.id).not.toBe(cancelled.id);
    const successor = await context.app.transcriptEditor.get(context.asset.id);
    expect(successor.document?.segments[0]?.text).toBe(retryText);
    expect(successor.revision).not.toBe(context.before.revision);
    const count = observed.length;
    held.retained?.onStage?.("transcribing");
    held.retained?.onProgress?.(0.9);
    held.work.resolve(
      result("Obsolete late result must not replace the retry"),
    );
    await setImmediate();
    expect(observed).toHaveLength(count);
    expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
      successor,
    );
    expect(
      context.app.catalog.listJobs().find((job) => job.id === cancelled.id),
    ).toEqual(cancelled);
    expect(context.app.catalog.getAsset(context.asset.id)).toEqual(
      context.asset,
    );
    expect(await hashFile(context.source)).toBe(context.sourceHash);
  } finally {
    held.work.resolve(result());
    await pending;
  }
});

it.each(["resolve", "reject"] as const)(
  "cancelled transcription closes and reopens before a late provider %s, retaining its job and manual transcript",
  async (settlement) => {
    const context = await fixture();
    const controller = new AbortController();
    const held = heldProvider(controller);
    context.app.intelligence.registerTranscriptionProvider(held.implementation);
    const observed: Job[] = [];
    const pending = context.app.analyzeIntelligence(context.asset.id, {
      operation: "transcribe",
      signal: controller.signal,
      onJob: (job) => observed.push(job),
    });
    try {
      await held.started.promise;
      controller.abort();
      const cancelled = await cancelledWithoutProviderSettlement(
        pending,
        context.app,
      );
      const count = observed.length;
      const reopened = await context.reopen();
      expect(
        reopened.catalog.listJobs().find((job) => job.id === cancelled.id),
      ).toEqual(cancelled);
      expect(await reopened.transcriptEditor.get(context.asset.id)).toEqual(
        context.before,
      );
      expect(() => held.retained?.onStage?.("post-processing")).not.toThrow();
      expect(() =>
        held.retained?.onStage?.([
          "invalid-after-close",
        ] as unknown as TranscriptionStage),
      ).not.toThrow();
      expect(() => held.retained?.onProgress?.(0.7)).not.toThrow();
      if (settlement === "resolve")
        held.work.resolve(result("Obsolete result after project close"));
      else
        held.work.reject(
          new Error("Explicit late provider failure after project close"),
        );
      // Give the original registry promise its normal opportunity to reject. Vitest
      // also treats any unhandled rejection as a failure of this regression.
      await setImmediate();
      await setImmediate();
      expect(observed).toHaveLength(count);
      expect(
        reopened.catalog.listJobs().find((job) => job.id === cancelled.id),
      ).toEqual(cancelled);
      expect(await reopened.transcriptEditor.get(context.asset.id)).toEqual(
        context.before,
      );
      expect(await hashFile(context.source)).toBe(context.sourceHash);
    } finally {
      held.work.resolve(result());
      await pending;
    }
  },
);

it("consumes a late rejection when the provider aborts synchronously before its result handlers are attached", async () => {
  const context = await fixture();
  const controller = new AbortController();
  const held = heldProvider(controller, true);
  context.app.intelligence.registerTranscriptionProvider(held.implementation);
  const pending = context.app.analyzeIntelligence(context.asset.id, {
    operation: "transcribe",
    signal: controller.signal,
  });
  try {
    await held.started.promise;
    const cancelled = await cancelledWithoutProviderSettlement(
      pending,
      context.app,
    );
    expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
      context.before,
    );
    await context.reopen();
    held.work.reject(
      new Error("Explicit late failure after synchronous abort"),
    );
    await setImmediate();
    await setImmediate();
    expect(
      context.app.catalog.listJobs().find((job) => job.id === cancelled.id),
    ).toEqual(cancelled);
    expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
      context.before,
    );
  } finally {
    held.work.resolve(result());
    await pending;
  }
});

it("an already aborted transcription never invokes its provider or changes the saved manual revision", async () => {
  const context = await fixture();
  const controller = new AbortController();
  let calls = 0;
  context.app.intelligence.registerTranscriptionProvider(
    provider(async () => {
      calls++;
      return result(
        "An already cancelled request must never produce this result",
      );
    }),
  );
  controller.abort();
  const cancelled = await context.app.analyzeIntelligence(context.asset.id, {
    operation: "transcribe",
    signal: controller.signal,
  });
  expect(cancelled.status).toBe("cancelled");
  expect(calls).toBe(0);
  expect(context.app.hasActiveJobs).toBe(false);
  expect(
    context.app.catalog.listJobs().find((job) => job.id === cancelled.id),
  ).toEqual(cancelled);
  expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
    context.before,
  );
  await context.reopen();
  expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
    context.before,
  );
});

it("a provider result resolved before same-turn abort cannot commit while the SDK is adopting its promise", async () => {
  const context = await fixture();
  const controller = new AbortController();
  let calls = 0;
  context.app.intelligence.registerTranscriptionProvider(
    provider(() => {
      calls++;
      const completed = Promise.resolve(
        result("Resolved result must not replace the saved correction"),
      );
      controller.abort();
      return completed;
    }),
  );
  const cancelled = await context.app.analyzeIntelligence(context.asset.id, {
    operation: "transcribe",
    signal: controller.signal,
  });
  expect(calls).toBe(1);
  expect(cancelled.status).toBe("cancelled");
  expect(context.app.hasActiveJobs).toBe(false);
  expect(
    context.app.catalog.listJobs().find((job) => job.id === cancelled.id),
  ).toEqual(cancelled);
  expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
    context.before,
  );
  await setImmediate();
  await context.reopen();
  expect(
    context.app.catalog.listJobs().find((job) => job.id === cancelled.id),
  ).toEqual(cancelled);
  expect(await context.app.transcriptEditor.get(context.asset.id)).toEqual(
    context.before,
  );
});
