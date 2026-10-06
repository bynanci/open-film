import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { ProviderRegistry } from "@openfilm/analysis";
import { hashFile } from "@openfilm/media";
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "@openfilm/plugin-sdk";
import { OpenFilmApplication } from "../src/index.js";

// Deterministic provider boundary fixtures, not real ASR/audio quality evidence.
const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type StorageState = "corrupt" | "future-version" | "blocked-backup-repair";
const invalidStates: StorageState[] = [
  "corrupt",
  "future-version",
  "blocked-backup-repair",
];

function result(): TranscriptionResult {
  return {
    text: "Remember this moment",
    language: "en",
    model: "capability-fixture-not-asr",
    version: "test-1",
    execution: "cpu",
    segments: [
      {
        start: 0,
        end: 2,
        text: "Remember this moment",
        words: [{ start: 0, end: 2, text: "Remember this moment" }],
      },
    ],
  };
}

async function snapshot(directory: string) {
  const files = await readdir(directory);
  const values = await Promise.all(
    files.sort().map(async (file) => {
      const path = join(directory, file);
      const metadata = await stat(path, { bigint: true });
      return [
        file,
        {
          contents: await readFile(path, "utf8"),
          inode: metadata.ino,
          modified: metadata.mtimeNs,
          changed: metadata.ctimeNs,
        },
      ];
    }),
  );
  return Object.fromEntries(values);
}

async function fixture(
  supportsPromptHints: boolean | undefined,
  storageState?: StorageState,
  remote = false,
) {
  const root = await mkdtemp(
    join(tmpdir(), "openfilm-transcription-glossary-"),
  );
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const userData = join(root, "user-data");
  await mkdir(userData);
  const primary = join(userData, "global-glossary.json");
  if (storageState === "future-version") {
    await writeFile(primary, JSON.stringify({ version: 2, entries: [] }));
  } else if (storageState) {
    await writeFile(primary, "{corrupt glossary JSON");
    if (storageState === "blocked-backup-repair") {
      await writeFile(
        `${primary}.bak`,
        JSON.stringify({ version: 1, entries: [] }),
      );
      // A verified live owner forces the actual valid-backup repair path to fail.
      await writeFile(
        `${primary}.lock`,
        JSON.stringify({
          version: 1,
          pid: process.pid,
          token: randomUUID(),
          createdAt: new Date().toISOString(),
        }),
      );
    }
  }
  const source = join(root, "spoken.wav");
  await writeFile(
    source,
    "Stable identity bytes; provider does not decode audio.",
  );
  const asset: MediaAsset = {
    id: "spoken",
    uri: pathToFileURL(source).href,
    name: "spoken.wav",
    mediaType: "audio",
    duration: 4,
    contentHash: await hashFile(source),
    metadata: {},
    tags: [],
    state: {},
  };
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Capability boundary",
    {},
    { userDataDirectory: userData },
  );
  cleanups.push(() => app.close());
  app.catalog.upsertAsset(asset);
  const transcribe = vi.fn(
    async (_asset: MediaAsset, _options?: TranscriptionOptions) => result(),
  );
  const provider: TranscriptionProvider = {
    id: "fixture.transcription",
    name: "Explicit transcription capability fixture",
    kind: "transcription",
    execution: remote ? "remote" : "local",
    ...(remote ? { endpoint: "https://transcription.example.invalid" } : {}),
    dataKinds:
      supportsPromptHints === true
        ? ["audio", "metadata", "text"]
        : ["audio", "metadata"],
    capabilities: {
      wordTimestamps: true,
      cpuFallback: true,
      languages: ["en"],
      ...(supportsPromptHints === undefined ? {} : { supportsPromptHints }),
    },
    transcribe,
  };
  app.intelligence.registerTranscriptionProvider(provider);
  // The registry is private only at the TypeScript boundary. Tests exercise its
  // real consent validation without adding a production consent bypass/API.
  const registry = (
    app.intelligence as unknown as { registry: ProviderRegistry }
  ).registry;
  return {
    app,
    asset,
    provider,
    transcribe,
    registry,
    userData,
    glossary: vi.spyOn(app.knowledge, "glossaryList"),
    readiness: vi.spyOn(app.intelligence, "providers"),
  };
}

describe("transcription only loads glossary for an active prompt-hint capability", () => {
  for (const capability of [false, undefined]) {
    it.each(invalidStates)(
      `does not read or repair %s storage with supportsPromptHints=${String(capability)}`,
      async (storageState) => {
        const context = await fixture(capability, storageState);
        const before = await snapshot(context.userData);
        const job = await context.app.analyzeIntelligence(context.asset.id, {
          operation: "transcribe",
          promptHints: ["Explicit user hint unsupported by this provider"],
        });
        expect(job.status).toBe("completed");
        expect(context.glossary).not.toHaveBeenCalled();
        expect(context.readiness).not.toHaveBeenCalled();
        expect(context.transcribe).toHaveBeenCalledOnce();
        expect(
          context.transcribe.mock.calls[0]![1]?.promptHints,
        ).toBeUndefined();
        expect(await snapshot(context.userData)).toEqual(before);
        expect(context.app.hasActiveJobs).toBe(false);
        expect(
          (await context.app.intelligence.read(context.asset.id)).transcript
            ?.segments,
        ).toHaveLength(1);
      },
    );
  }

  it.each(invalidStates)(
    "keeps %s storage failures visible before calling a hint-capable provider",
    async (storageState) => {
      const context = await fixture(true, storageState);
      const before = await snapshot(context.userData);
      await expect(
        context.app.analyzeIntelligence(context.asset.id, {
          operation: "transcribe",
        }),
      ).rejects.toMatchObject({
        code:
          storageState === "blocked-backup-repair"
            ? "glossary.storageBusy"
            : "operation.failed",
      });
      expect(context.glossary).toHaveBeenCalledExactlyOnceWith("effective");
      expect(context.readiness).not.toHaveBeenCalled();
      expect(context.transcribe).not.toHaveBeenCalled();
      expect(context.app.hasActiveJobs).toBe(false);
      expect(context.app.catalog.listJobs()).toEqual([]);
      expect(await snapshot(context.userData)).toEqual(before);
    },
  );

  it("runs a no-hint remote provider with only audio/metadata consent despite invalid glossary storage", async () => {
    const context = await fixture(false, "blocked-backup-repair", true);
    const before = await snapshot(context.userData);
    context.registry.grantConsent({
      providerId: context.provider.id,
      dataKinds: ["audio", "metadata"],
      grantedAt: new Date().toISOString(),
    });
    const job = await context.app.analyzeIntelligence(context.asset.id, {
      operation: "transcribe",
      promptHints: ["Must not be sent to the remote provider"],
    });
    expect(job.status).toBe("completed");
    expect(context.glossary).not.toHaveBeenCalled();
    expect(context.transcribe).toHaveBeenCalledOnce();
    expect(context.transcribe.mock.calls[0]![1]?.promptHints).toBeUndefined();
    expect(context.registry.getConsent(context.provider.id)?.dataKinds).toEqual(
      ["audio", "metadata"],
    );
    expect(await snapshot(context.userData)).toEqual(before);
    expect(context.app.hasActiveJobs).toBe(false);
  });

  it("requires actual text consent before a hint-capable remote provider receives project terms", async () => {
    const context = await fixture(true, undefined, true);
    context.app.knowledge.glossaryUpsert({
      scope: "project",
      source: "十河田",
      replacement: "十和田",
    });
    expect(() =>
      context.registry.grantConsent({
        providerId: context.provider.id,
        dataKinds: ["audio", "metadata"],
        grantedAt: new Date().toISOString(),
      }),
    ).toThrow("text");
    const denied = await context.app.analyzeIntelligence(context.asset.id, {
      operation: "transcribe",
    });
    expect(denied.status).toBe("failed");
    expect(context.transcribe).not.toHaveBeenCalled();
    expect(context.app.hasActiveJobs).toBe(false);
    context.registry.grantConsent({
      providerId: context.provider.id,
      dataKinds: ["audio", "metadata", "text"],
      grantedAt: new Date().toISOString(),
    });
    const job = await context.app.analyzeIntelligence(context.asset.id, {
      operation: "transcribe",
    });
    expect(job.status).toBe("completed");
    expect(context.transcribe).toHaveBeenCalledOnce();
    expect(context.transcribe.mock.calls[0]![1]?.promptHints).toEqual([
      "十和田",
    ]);
    expect(context.app.hasActiveJobs).toBe(false);
  });

  it("preserves explicit prompt hints when a capable provider has no glossary terms", async () => {
    const context = await fixture(true);
    const job = await context.app.analyzeIntelligence(context.asset.id, {
      operation: "transcribe",
      promptHints: ["Explicit terminology"],
    });
    expect(job.status).toBe("completed");
    expect(context.glossary).toHaveBeenCalledExactlyOnceWith("effective");
    expect(context.transcribe.mock.calls[0]![1]?.promptHints).toEqual([
      "Explicit terminology",
    ]);
  });
});
