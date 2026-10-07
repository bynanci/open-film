import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  validateTranscriptCommand,
  type Job,
  type ReviewBatch,
  type TranscriptCommand,
  type TranscriptReviewSuggestion,
} from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile } from "@openfilm/media";
import type { TranscriptMutationInput } from "@openfilm/catalog";
import {
  ApiError,
  type TranscriptEditorState,
} from "../../apps/desktop/src/api";

// Execute the actual SFC and source-scoped queue with real Vue refs/watchers.
// Application calls use real SQLite; only response delivery is controlled.
const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as Record<string, unknown> & {
  reactive: <T extends object>(value: T) => T;
  effectScope: () => {
    run: <T>(callback: () => T) => T | undefined;
    stop: () => void;
  };
};
type Acceptance = {
  suggestionId: string;
  receipt: { baseRevision: string; requestId: string };
};
type Queue = {
  load: (offset?: number, recover?: boolean) => Promise<boolean>;
  flush: () => Promise<boolean>;
  command: (value: TranscriptCommand) => boolean;
  state: { value: TranscriptEditorState | null };
  hasPending: { value: boolean };
};
type Panel = {
  accept: (suggestion: TranscriptReviewSuggestion) => Promise<void>;
  retryAcceptance: () => Promise<void>;
  batchAction: (batch: ReviewBatch, action: "retry" | "skip") => Promise<void>;
  run: (source: "glossary" | "language") => Promise<void>;
  refresh: () => Promise<void>;
  flush: () => Promise<boolean>;
  busy: { value: boolean };
  uncertainAcceptance: { value?: Acceptance };
  error: { value: unknown };
};
type Props = {
  projectId: string;
  assetId: string;
  revision?: string;
  jobs: readonly Job[];
  flush: () => Promise<boolean>;
};
let queueFactory: (dependencies: Record<string, unknown>) => Queue;
let panelFactory: (dependencies: Record<string, unknown>) => Panel;
const cleanup: (() => void | Promise<unknown>)[] = [];
beforeAll(async () => {
  async function compile(path: URL, body: string, sfc = false) {
    const source = await readFile(path, "utf8");
    const input = sfc
      ? source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!
      : source;
    const code = (await transform(input, { loader: "ts", format: "esm" })).code
      .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "")
      .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "");
    return (dependencies: Record<string, unknown>) =>
      new Function(
        "dependencies",
        `const {${Object.keys(dependencies).join(",")}} = dependencies;\n${code}\n${body}`,
      )(dependencies);
  }
  queueFactory = await compile(
    new URL(
      "../../apps/desktop/src/composables/useTranscriptEditor.ts",
      import.meta.url,
    ),
    "return useTranscriptEditor('project', 'asset', () => {});",
  );
  panelFactory = await compile(
    new URL(
      "../../apps/desktop/src/components/ReviewPanel.vue",
      import.meta.url,
    ),
    "return {accept,retryAcceptance,batchAction,run,refresh,flush:flushPending,busy,uncertainAcceptance,error};",
    true,
  );
});
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function drain() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-review-barrier-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "identity-only.wav");
  await writeFile(source, "Identity-only fixture, not ASR or real AI quality.");
  const sourceHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Review operations",
    {},
    { userDataDirectory: join(directory, "user-data") },
  );
  cleanup.push(() => app.close());
  app.catalog.upsertAsset({
    id: "asset",
    uri: pathToFileURL(source).href,
    name: "identity-only.wav",
    mediaType: "audio",
    duration: 4,
    contentHash: sourceHash,
    metadata: {},
    tags: [],
    state: {},
  });
  const provider = {
    id: "provider-result",
    assetId: "asset",
    language: "en",
    provenance: {
      providerId: "fixture-not-asr",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: ["Visit youtube", "youtube again"].map((text, index) => ({
      id: `segment-${index}`,
      start: index * 2,
      end: index * 2 + 2,
      text,
      words: [{ start: index * 2, end: index * 2 + 2, text }],
    })),
  };
  app.catalog.intelligence.replaceTranscript(provider);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let heldRead:
    | {
        entered: ReturnType<typeof deferred<void>>;
        response: ReturnType<typeof deferred<void>>;
      }
    | undefined;
  const queueApi = {
    transcript: vi.fn(async (assetId: string, offset = 0, limit = 100) => {
      const held = heldRead;
      heldRead = undefined;
      const result = await app.transcriptEditor.get(assetId, { offset, limit });
      if (held) {
        held.entered.resolve();
        await held.response.promise;
      }
      return result;
    }),
    editTranscript: vi.fn((assetId: string, input: TranscriptMutationInput) =>
      app.transcriptEditor.edit(assetId, input),
    ),
  };
  const queueScope = vue.effectScope();
  let queueDispose = () => {};
  const queue = queueScope.run(() =>
    queueFactory({
      ...vue,
      validateTranscriptCommand,
      api: queueApi,
      ApiError,
      onMounted: () => {},
      onBeforeUnmount: (callback: () => void) => {
        queueDispose = callback;
      },
    }),
  )!;
  cleanup.push(() => {
    queueDispose();
    queueScope.stop();
  });
  await queue.load();
  const original = structuredClone(queue.state.value!);
  const props = vue.reactive<Props>({
    projectId: "project",
    assetId: "asset",
    get revision() {
      return queue.state.value?.revision;
    },
    jobs: app.catalog.listJobs(),
    flush: vi.fn(() => queue.flush()),
  });
  const api = {
    acceptSuggestion: vi.fn((id: string, receipt: Acceptance["receipt"]) =>
      app.knowledge.acceptSuggestion(id, receipt),
    ),
    reviewSuggestions: vi.fn(
      (
        assetId: string,
        status?: TranscriptReviewSuggestion["status"],
        offset = 0,
        limit = 100,
      ) => app.knowledge.suggestionsList(assetId, { status, offset, limit }),
    ),
    reviewProvider: vi.fn(async () => app.knowledge.languageProvider()),
    reviewRecovery: vi.fn(async (jobId: string) =>
      app.knowledge.reviewRecoveryStatus(jobId),
    ),
    jobs: vi.fn(async () => ({ jobs: app.catalog.listJobs() })),
    reviewBatches: vi.fn(async (jobId: string) => ({
      batches: app.knowledge.batches(jobId),
    })),
    runReview: vi.fn(
      (assetId: string, options: { source: "glossary" | "language" }) =>
        app.runKnowledgeReview(assetId, options),
    ),
    reviewBatchAction: vi.fn(
      async (jobId: string, index: number, action: "retry" | "skip") =>
        action === "retry"
          ? app.retryKnowledgeReview(jobId, index)
          : app.knowledge.skipBatch(jobId, index),
    ),
  };
  const panelScope = vue.effectScope();
  let panelDispose = () => {};
  const events: Array<[string, unknown[]]> = [];
  const panel = panelScope.run(() =>
    panelFactory({
      ...vue,
      api,
      ApiError,
      post: vi.fn(),
      useI18n: () => ({ t: (key: string) => key }),
      defineProps: () => props,
      defineEmits:
        () =>
        (event: string, ...args: unknown[]) =>
          events.push([event, args]),
      defineExpose: () => {},
      onMounted: () => {},
      onBeforeUnmount: (callback: () => void) => {
        panelDispose = callback;
      },
    }),
  )!;
  cleanup.push(() => {
    panelDispose();
    panelScope.stop();
  });
  return {
    app,
    sourceHash,
    provider,
    original,
    queue,
    props,
    api,
    panel,
    events,
    storage,
    acceptanceKey: "openfilm:review-accept:project:asset",
    dispose: () => panelDispose(),
    holdRead() {
      const held = { entered: deferred<void>(), response: deferred<void>() };
      heldRead = held;
      return {
        entered: held.entered.promise,
        release: () => held.response.resolve(),
      };
    },
    async suggestions() {
      app.knowledge.glossaryUpsert({
        scope: "project",
        source: "youtube",
        replacement: "YouTube",
      });
      await app.runKnowledgeReview("asset", { source: "glossary" });
      props.jobs = app.catalog.listJobs();
      return (
        await app.knowledge.suggestionsList("asset", { status: "pending" })
      ).suggestions;
    },
  };
}

describe("review operation reservations", () => {
  it("reserves the first Accept through clean-load preparation, lost ACK and exact receipt replay", async () => {
    const test = await fixture();
    const suggestions = await test.suggestions();
    const read = test.holdRead();
    const loading = test.queue.load(0, false);
    await read.entered;
    const acknowledgment = deferred<void>(),
      committed = deferred<void>();
    const originalAccept = test.api.acceptSuggestion.getMockImplementation()!;
    let attempts = 0;
    test.api.acceptSuggestion.mockImplementation(async (id, receipt) => {
      const result = await originalAccept(id, receipt);
      if (++attempts === 1) {
        committed.resolve();
        await acknowledgment.promise;
        throw new TypeError("Committed acceptance acknowledgment lost");
      }
      return result;
    });
    const first = test.panel.accept(suggestions[0]!),
      second = test.panel.accept(suggestions[1]!);
    let settled = false;
    const navigation = test.panel.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(test.panel.busy.value).toBe(true);
    expect(settled).toBe(false);
    expect(test.api.acceptSuggestion).not.toHaveBeenCalled();
    read.release();
    await loading;
    await committed.promise;
    expect(test.api.acceptSuggestion).toHaveBeenCalledTimes(1);
    const packet = structuredClone(test.panel.uncertainAcceptance.value!);
    expect(packet.suggestionId).toBe(suggestions[0]!.id);
    expect(packet.receipt.baseRevision).toBe(test.original.revision);
    expect(settled).toBe(false);
    acknowledgment.resolve();
    await Promise.all([first, second]);
    expect(await navigation).toBe(false);
    expect(test.panel.uncertainAcceptance.value).toEqual(packet);
    expect(test.storage.get(test.acceptanceKey)).toBe(JSON.stringify(packet));
    expect(await test.panel.flush()).toBe(false);
    await test.panel.retryAcceptance();
    expect(test.api.acceptSuggestion.mock.calls).toEqual([
      [suggestions[0]!.id, packet.receipt],
      [suggestions[0]!.id, packet.receipt],
    ]);
    expect(test.props.flush).toHaveBeenCalledTimes(1);
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(2);
    expect(
      test.app.catalog.knowledge.getSuggestion(suggestions[0]!.id),
    ).toMatchObject({
      status: "accepted",
      requestId: packet.receipt.requestId,
    });
    expect(
      test.app.catalog.knowledge.getSuggestion(suggestions[1]!.id)?.status,
    ).not.toBe("accepted");
    expect(
      test.app.catalog.transcripts.getFull(
        "asset",
        test.sourceHash,
        test.original.revision,
      )!.document,
    ).toEqual(test.provider);
    expect(test.storage.has(test.acceptanceKey)).toBe(false);
    expect(await test.panel.flush()).toBe(true);
    expect(test.api.jobs).not.toHaveBeenCalled();
  });

  it.each(["false", "error"] as const)(
    "does not publish or send an Accept receipt after %s preflush",
    async (outcome) => {
      const test = await fixture(),
        suggestions = await test.suggestions();
      const failure = new TypeError("Transcript save unavailable");
      test.props.flush = vi.fn(async () => {
        if (outcome === "error") throw failure;
        return false;
      });
      await test.panel.accept(suggestions[0]!).catch(() => {});
      expect(test.api.acceptSuggestion).not.toHaveBeenCalled();
      expect(test.panel.uncertainAcceptance.value).toBeUndefined();
      expect(test.storage.has(test.acceptanceKey)).toBe(false);
      expect(test.panel.busy.value).toBe(false);
      if (outcome === "error") expect(test.panel.error.value).toBe(failure);
    },
  );

  it.each(["context", "dispose"] as const)(
    "does not send Accept after %s changes during preparation",
    async (change) => {
      const test = await fixture(),
        suggestions = await test.suggestions();
      const held = deferred<boolean>();
      test.props.flush = vi.fn(() => held.promise);
      const accepting = test.panel.accept(suggestions[0]!);
      await drain();
      if (change === "context") test.props.assetId = "different-asset";
      else test.dispose();
      held.resolve(true);
      await accepting;
      expect(test.api.acceptSuggestion).not.toHaveBeenCalled();
      expect(test.panel.uncertainAcceptance.value).toBeUndefined();
      expect(test.storage.has(test.acceptanceKey)).toBe(false);
      expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(
        1,
      );
    },
  );

  it("reserves an initial review before its shared preflush and keeps navigation waiting through submission", async () => {
    const test = await fixture();
    test.app.knowledge.glossaryUpsert({
      scope: "project",
      source: "youtube",
      replacement: "YouTube",
    });
    const held = deferred<boolean>(),
      submitted = deferred<void>(),
      finished = deferred<void>();
    test.props.flush = vi.fn(() => held.promise);
    const start = test.api.runReview.getMockImplementation()!;
    test.api.runReview.mockImplementation(async (assetId, options) => {
      submitted.resolve();
      await finished.promise;
      return start(assetId, options);
    });
    const first = test.panel.run("glossary"),
      second = test.panel.run("glossary");
    let settled = false;
    const navigation = test.panel.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(test.panel.busy.value).toBe(true);
    expect(settled).toBe(false);
    held.resolve(true);
    await submitted.promise;
    expect(test.api.runReview).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    finished.resolve();
    await Promise.all([first, second]);
    expect(await navigation).toBe(true);
    expect(test.props.flush).toHaveBeenCalledTimes(1);
    expect(test.app.catalog.listJobs()).toHaveLength(1);
  });
});

describe("review retry transcript boundaries", () => {
  it("persists a dirty transcript before retry, then rejects its old revision without another provider call or rebasing", async () => {
    const test = await fixture();
    const generate = vi.fn(async () => {
      throw new Error("Deterministic failing provider fixture");
    });
    test.app.knowledge.registerLanguageProvider({
      id: "fixture-language",
      name: "Not real AI",
      kind: "language",
      execution: "local",
      dataKinds: ["text", "transcripts"],
      generate,
    });
    const job = await test.app.runKnowledgeReview("asset", {
      source: "language",
      jobId: "original-failed-review",
    });
    const batch = test.app.knowledge.batches(job.id)[0]!;
    expect(batch.status).toBe("failed");
    expect(generate).toHaveBeenCalledTimes(1);
    test.props.jobs = test.app.catalog.listJobs();
    const originalRetry = test.api.reviewBatchAction.getMockImplementation()!;
    const observed: string[] = [];
    test.api.reviewBatchAction.mockImplementation(
      async (jobId, index, action) => {
        observed.push(
          (await test.app.transcriptEditor.get("asset")).document!.segments[0]!
            .text,
        );
        return originalRetry(jobId, index, action);
      },
    );
    expect(
      test.queue.command({
        type: "replace-text",
        segmentId: "segment-0",
        text: "User corrected source text",
      }),
    ).toBe(true);
    await test.panel.batchAction(batch, "retry");
    expect(test.props.flush).toHaveBeenCalledTimes(1);
    expect(test.queue.hasPending.value).toBe(false);
    expect(observed).toEqual(["User corrected source text"]);
    expect(test.panel.error.value).toMatchObject({
      code: "review.suggestionStale",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(test.app.knowledge.batches(job.id)[0]).toEqual(batch);
    expect(
      test.app.catalog.transcripts.getFull(
        "asset",
        test.sourceHash,
        test.original.revision,
      )!.document,
    ).toEqual(test.provider);
  });

  it.each(["false", "error"] as const)(
    "does not retry after a %s transcript flush",
    async (outcome) => {
      const test = await fixture();
      const failure = new TypeError("Cannot save current draft");
      test.props.flush = vi.fn(async () => {
        if (outcome === "error") throw failure;
        return false;
      });
      const batch: ReviewBatch = {
        jobId: "failed-job",
        index: 0,
        assetId: "asset",
        sourceRevisionId: test.original.revision!,
        providerId: "fixture-language",
        segmentIds: ["segment-0"],
        status: "failed",
        attempts: 1,
      };
      await test.panel.batchAction(batch, "retry").catch(() => {});
      expect(test.props.flush).toHaveBeenCalledTimes(1);
      expect(test.api.reviewBatchAction).not.toHaveBeenCalled();
      expect(test.panel.busy.value).toBe(false);
      if (outcome === "error") expect(test.panel.error.value).toBe(failure);
    },
  );

  it("keeps exposed flush waiting for a reserved retry preflight and ignores a concurrent retry", async () => {
    const test = await fixture();
    const held = deferred<boolean>();
    test.props.flush = vi.fn(() => held.promise);
    const batch: ReviewBatch = {
      jobId: "failed-job",
      index: 0,
      assetId: "asset",
      sourceRevisionId: test.original.revision!,
      providerId: "fixture-language",
      segmentIds: ["segment-0"],
      status: "failed",
      attempts: 1,
    };
    const first = test.panel.batchAction(batch, "retry"),
      second = test.panel.batchAction(batch, "retry");
    let settled = false;
    const navigation = test.panel.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(settled).toBe(false);
    expect(test.api.reviewBatchAction).not.toHaveBeenCalled();
    held.resolve(false);
    await Promise.all([first, second]);
    await navigation;
    expect(test.props.flush).toHaveBeenCalledTimes(1);
    expect(test.api.reviewBatchAction).not.toHaveBeenCalled();
  });
});
