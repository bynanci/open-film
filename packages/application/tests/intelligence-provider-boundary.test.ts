import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, MediaAsset } from "@openfilm/core";
import { hashFile } from "@openfilm/media";
import type {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionStage,
} from "@openfilm/plugin-sdk";
import { OpenFilmApplication } from "../src/index.js";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function validResult(): TranscriptionResult {
  return {
    text: "Keep my memories",
    language: "en",
    execution: "cpu",
    model: "explicit-test-provider",
    version: "test-1",
    segments: [
      {
        start: 0.5,
        end: 1.5,
        text: "Keep my memories",
        words: [{ start: 0.5, end: 1.5, text: "Keep my memories" }],
      },
    ],
  };
}

function provider(
  overrides: Partial<TranscriptionProvider> = {},
): TranscriptionProvider {
  return {
    id: "test-runtime-provider",
    name: "Explicit boundary test provider",
    kind: "transcription",
    execution: "local",
    dataKinds: ["audio", "metadata"],
    capabilities: {
      wordTimestamps: true,
      languages: ["en", "ja"],
      cpuFallback: true,
    },
    async transcribe() {
      return validResult();
    },
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-provider-boundary-"));
  cleanups.push(() => rm(root, { force: true, recursive: true }));
  const source = join(root, "stable-source.wav");
  // This test provider needs only identity bytes: no real ASR/media decoding occurs.
  await writeFile(source, "stable source bytes for provider boundary tests");
  const asset: MediaAsset = {
    id: "source",
    uri: pathToFileURL(source).href,
    name: "stable-source.wav",
    mediaType: "audio",
    duration: 4,
    contentHash: await hashFile(source),
    metadata: {},
    tags: [],
    state: {},
  };
  let app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Provider boundary",
  );
  cleanups.push(() => app.close());
  app.catalog.upsertAsset(asset);
  app.intelligence.registerTranscriptionProvider(provider());
  return {
    get app() {
      return app;
    },
    asset,
    async reopen() {
      const path = app.directory;
      app.close();
      app = await OpenFilmApplication.open(path);
      return app;
    },
  };
}

describe("transcription provider runtime result boundaries", () => {
  it.each([
    ["execution", ["cpu"]],
    ["execution", "local"],
    ["execution", null],
    ["fallbackReason", { reason: "CUDA failed" }],
    ["fallbackReason", ["CUDA failed"]],
    ["model", 12],
    ["version", ["test-2"]],
    ["language", ["ja"]],
    ["model", " "],
  ])(
    "fails invalid %s metadata before persistence and retains the prior transcript",
    async (field, value) => {
      const context = await fixture();
      const { app, asset } = context;
      expect(
        (await app.analyzeIntelligence(asset.id, { operation: "transcribe" }))
          .status,
      ).toBe("completed");
      const prior = (await app.intelligence.read(asset.id)).transcript;
      app.intelligence.registerTranscriptionProvider(
        provider({
          async transcribe() {
            return { ...validResult(), [field]: value } as TranscriptionResult;
          },
        }),
      );
      const observed: Job[] = [];
      const failed = await app.analyzeIntelligence(asset.id, {
        operation: "transcribe",
        onJob: (job) => observed.push(job),
      });
      expect(failed.status).toBe("failed");
      expect(failed.errors?.[0]?.code).toBe("media.transcriptionFailed");
      for (const job of observed) {
        expect(job.execution).toBeUndefined();
        expect(job.fallbackReason).toBeUndefined();
        expect(job.model).toBeUndefined();
        expect(job.language).toBeUndefined();
      }
      expect((await app.intelligence.read(asset.id)).transcript).toEqual(prior);
      const reopened = await context.reopen();
      expect((await reopened.intelligence.read(asset.id)).transcript).toEqual(
        prior,
      );
      expect(
        reopened.catalog.listJobs().find((j) => j.id === failed.id),
      ).toEqual(failed);
      expect(
        reopened.catalog.listJobs().filter((j) => j.status === "completed"),
      ).toHaveLength(1);
    },
  );

  it.each([
    { stage: "unknown-stage" },
    { stage: ["loading-model"] },
    { stage: null },
  ])(
    "rejects malformed stage $stage before it reaches a durable job",
    async ({ stage }) => {
      const { app, asset } = await fixture();
      await app.analyzeIntelligence(asset.id, { operation: "transcribe" });
      const prior = (await app.intelligence.read(asset.id)).transcript;
      app.intelligence.registerTranscriptionProvider(
        provider({
          async transcribe(_asset, options) {
            options?.onStage?.(stage as TranscriptionStage);
            return validResult();
          },
        }),
      );
      const stages: unknown[] = [];
      const job = await app.analyzeIntelligence(asset.id, {
        operation: "transcribe",
        onJob: (progress) => stages.push(progress.stage),
      });
      expect(job.status).toBe("failed");
      expect(job.errors?.[0]?.code).toBe("media.transcriptionFailed");
      expect(stages).toEqual([undefined, "checking-source", "checking-source"]);
      expect(app.catalog.listJobs().find((j) => j.id === job.id)).toEqual(job);
      expect((await app.intelligence.read(asset.id)).transcript).toEqual(prior);
    },
  );

  it("persists valid execution/fallback metadata and successfully replaces the prior revision", async () => {
    const { app, asset } = await fixture();
    await app.analyzeIntelligence(asset.id, { operation: "transcribe" });
    const prior = (await app.intelligence.read(asset.id)).transcript;
    app.intelligence.registerTranscriptionProvider(
      provider({
        async transcribe() {
          return {
            ...validResult(),
            language: "ja",
            model: "second-test-model",
            version: "test-2",
            fallbackReason: "CUDA initialization failed; retried on CPU",
          };
        },
      }),
    );
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
    });
    expect(job.status).toBe("completed");
    expect(job.execution).toBe("cpu");
    expect(job.model).toBe("second-test-model");
    expect(job.language).toBe("ja");
    expect(job.fallbackReason).toBe(
      "CUDA initialization failed; retried on CPU",
    );
    const current = (await app.intelligence.read(asset.id)).transcript;
    expect(current?.id).not.toBe(prior?.id);
    expect(current?.provenance.providerVersion).toBe("test-2");
    expect(app.catalog.listJobs().find((j) => j.id === job.id)).toEqual(job);
  });

  it("snapshots validated metadata once so mutable plugin properties cannot corrupt the indexing job", async () => {
    const context = await fixture();
    const { app, asset } = context;
    let modelReads = 0;
    app.intelligence.registerTranscriptionProvider(
      provider({
        async transcribe() {
          return {
            ...validResult(),
            get model() {
              modelReads++;
              return (
                modelReads === 1 ? "validated-model" : ["invalid-model"]
              ) as string;
            },
          };
        },
      }),
    );
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
    });
    expect(job.status).toBe("completed");
    expect(job.model).toBe("validated-model");
    expect(modelReads).toBe(1);
    const reopened = await context.reopen();
    expect(
      reopened.catalog.listJobs().find((j) => j.id === job.id)?.model,
    ).toBe("validated-model");
    expect(
      (await reopened.intelligence.read(asset.id)).transcript?.provenance.model,
    ).toBe("validated-model");
  });

  it("allows providers that omit optional runtime metadata", async () => {
    const { app, asset } = await fixture();
    app.intelligence.registerTranscriptionProvider(
      provider({
        async transcribe() {
          const { text, segments } = validResult();
          return { text, segments };
        },
      }),
    );
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
    });
    expect(job.status).toBe("completed");
    expect(job.execution).toBeUndefined();
    expect(job.model).toBeUndefined();
    expect(job.language).toBeUndefined();
    expect(
      (await app.intelligence.read(asset.id)).transcript?.segments,
    ).toHaveLength(1);
  });
});

describe("atomic transcription provider replacement", () => {
  it.each([
    { id: "invalid-descriptor", execution: "cpu" },
    { id: "test-runtime-provider", dataKinds: ["audio", "audio"] },
    { id: "invalid-operation", transcribe: undefined },
    { id: "invalid-remote", execution: "remote", endpoint: "file:///tmp" },
    { id: "wrong-kind", kind: "vision", analyze: async () => ({ labels: [] }) },
  ])("retains the active provider after rejecting $id", async (overrides) => {
    const { app, asset } = await fixture();
    const transcribe = vi.fn(async () => validResult());
    app.intelligence.registerTranscriptionProvider(provider({ transcribe }));
    const before = await app.intelligence.providers();
    const invalid = {
      ...provider(),
      ...overrides,
    } as unknown as TranscriptionProvider;
    expect(() =>
      app.intelligence.registerTranscriptionProvider(invalid),
    ).toThrow();
    expect(await app.intelligence.providers()).toEqual(before);
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
    });
    expect(job.status).toBe("completed");
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(
      (await app.intelligence.read(asset.id)).transcript?.provenance.providerId,
    ).toBe("test-runtime-provider");
  });

  it("keeps remote invocation disabled without explicit scoped consent after replacement", async () => {
    const { app, asset } = await fixture();
    const transcribe = vi.fn(async () => validResult());
    app.intelligence.registerTranscriptionProvider(
      provider({
        id: "remote-test-provider",
        execution: "remote",
        endpoint: "https://example.test/transcription",
        transcribe,
      }),
    );
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
    });
    expect(job.status).toBe("failed");
    expect(job.errors?.[0]?.message).toContain("Explicit opt-in");
    expect(transcribe).not.toHaveBeenCalled();
    expect((await app.intelligence.read(asset.id)).transcript).toBeUndefined();
  });
});
