import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReviewDecision,
  ReviewDecisionOperation,
  SourceDraft,
  SourceSelection,
  Story,
} from "@openfilm/core";
import type {
  CatalogOccurrencePage,
  SourceDiscoverySummary,
  SourceSelectionInput,
  SourceAnalysisRunRecord,
  SourceAnalysisReviewItem,
} from "@openfilm/application";
import type { PickedSources } from "../../apps/desktop/src/sourcePicker.js";
import * as sourceReviewAcceptance from "../../apps/desktop/src/source-review-acceptance.js";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host.js";

const cleanup: Array<() => void> = [];
beforeEach(() => {
  class HostDocument {
    activeElement = null;
  }
  const storage = new Map<string, string>();
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
    await vue.nextTick();
  }
}

const input = (name: string) => ({
  kind: "file" as const,
  displayName: name,
  accessClass: "native-path" as const,
  accessRef: `/synthetic/${name}`,
  recursive: false,
});

function fixture(
  options: {
    delayedRead?: Promise<{ draft: SourceDraft }>;
    initialDraft?: SourceDraft;
    switchedDraft?: SourceDraft;
    availability?: "available" | "needs-permission" | "needs-reselection";
    browserFolderError?: Error;
    nativeDropRegistration?: Promise<() => void>;
    addError?: Error;
    nativeFilesResult?: Promise<{
      sources: SourceSelectionInput[];
      rejected: [];
    }>;
    nativeDropResult?: PickedSources;
    staleAddDraft?: SourceDraft;
    delayedAdd?: Promise<{ draft: SourceDraft }>;
    lostAddDraft?: SourceDraft;
    removeDraft?: SourceDraft;
    delayedRemove?: Promise<{ draft: SourceDraft }>;
    lostRemoveDraft?: SourceDraft;
    updateError?: Error;
    reloadError?: Error;
    scanResult?: SourceDiscoverySummary;
    occurrencePage?: CatalogOccurrencePage;
    scanError?: Error;
    browserFiles?: Array<{
      relativePath: string;
      file: File;
      modifiedAt: string;
    }>;
    scanReadiness?: SourceDiscoverySummary;
    stagedOccurrenceIds?: string[];
    reviewDecisions?: ReviewDecision[];
    analysisResults?: SourceAnalysisRunRecord["results"];
    reviewStories?: Story[];
    verifiedManifestMembers?: Array<{
      bindingId: string;
      assetId: string;
      contentHash: string;
      contextRevision: string;
    }>;
  } = {},
) {
  let draft: SourceDraft =
    options.initialDraft ??
    ({
      schemaVersion: 1,
      projectId: "project-a",
      revision: 0,
      selections: [],
    } satisfies SourceDraft);
  let sequence = 0;
  let staleThrown = false;
  let lostAcknowledgement = false;
  let lostRemoveAcknowledgement = false;
  let draftReads = 0;
  const sourceDraft = vi.fn(async () => {
    draftReads++;
    if (draftReads > 1 && options.reloadError) throw options.reloadError;
    if (draftReads > 1 && options.switchedDraft)
      return { draft: structuredClone(options.switchedDraft) };
    return options.delayedRead ?? { draft: structuredClone(draft) };
  });
  const addSourceSelections = vi.fn(
    async (request: {
      requestId: string;
      sources: ReturnType<typeof input>[];
    }) => {
      if (options.delayedAdd) return options.delayedAdd;
      if (options.addError) throw options.addError;
      if (options.staleAddDraft && !staleThrown) {
        staleThrown = true;
        draft = structuredClone(options.staleAddDraft);
        throw Object.assign(new Error("draft changed"), {
          code: "import.draftStale",
        });
      }
      if (options.lostAddDraft) {
        draft = structuredClone(options.lostAddDraft);
        if (!lostAcknowledgement) {
          lostAcknowledgement = true;
          throw new Error("response connection lost");
        }
        return { draft: structuredClone(draft) };
      }
      draft = {
        ...draft,
        revision: draft.revision + 1,
        selections: [
          ...draft.selections,
          ...request.sources.map((source): SourceSelection => ({
            ...source,
            id: `source-${++sequence}`,
            projectId: draft.projectId,
            selectionRevision: draft.revision + 1,
          })),
        ],
      };
      return { draft: structuredClone(draft) };
    },
  );
  const removeSourceSelection = vi.fn(
    async (_selectionId: string, _request: { requestId: string }) => {
      if (options.delayedRemove) return options.delayedRemove;
      if (options.lostRemoveDraft) {
        draft = structuredClone(options.lostRemoveDraft);
        if (!lostRemoveAcknowledgement) {
          lostRemoveAcknowledgement = true;
          throw new Error("remove response connection lost");
        }
      }
      return { draft: structuredClone(options.removeDraft ?? draft) };
    },
  );
  const updateSourceSelection = vi.fn(
    async (
      selectionId: string,
      request: { recursive: boolean },
    ): Promise<{ draft: SourceDraft }> => {
      if (options.updateError) throw options.updateError;
      draft = {
        ...draft,
        revision: draft.revision + 1,
        selections: draft.selections.map((source) =>
          source.id === selectionId
            ? {
                ...source,
                recursive: request.recursive,
                selectionRevision: draft.revision + 1,
              }
            : source,
        ),
      };
      return { draft: structuredClone(draft) };
    },
  );
  const scanSourceDraft = vi.fn(
    async (request: { projectId: string; baseRevision: number }) => {
      if (options.scanError) throw options.scanError;
      return {
        summary:
          options.scanResult ??
          ({
            projectId: request.projectId,
            draftRevision: request.baseRevision,
            sourcesRequested: draft.selections.length,
            sourcesScanned: draft.selections.length,
            discovered: 2,
            supported: 2,
            possibleDuplicates: 0,
            skipped: 0,
            failed: 0,
            cancelled: false,
            failures: [],
          } satisfies SourceDiscoverySummary),
      };
    },
  );
  const progressSummary = (projectId: string, draftRevision: number) =>
    options.scanResult ?? {
      projectId,
      draftRevision,
      sourcesRequested: draft.selections.length,
      sourcesScanned: draft.selections.length,
      discovered: 2,
      supported: 2,
      possibleDuplicates: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
      failures: [],
    };
  const sourceDiscoveryProgress = vi.fn(async (requestId: string) => ({
    progress: {
      requestId,
      projectId: draft.projectId,
      status: "completed" as const,
      summary: progressSummary(draft.projectId, draft.revision),
    },
  }));
  const browserScanCounts = new Map<string, number>();
  const browserSourceScan = vi.fn(
    async (request: {
      projectId: string;
      baseRevision: number;
      requestId: string;
      selectionId: string;
      phase: "begin" | "page" | "finish" | "cancel";
      candidates?: Array<{
        relativePath: string;
        name: string;
        size: number;
        modifiedAt: string;
      }>;
    }) => {
      const count =
        request.phase === "begin"
          ? 0
          : (browserScanCounts.get(request.requestId) ?? 0) +
            (request.phase === "page" ? (request.candidates?.length ?? 0) : 0);
      browserScanCounts.set(request.requestId, count);
      return {
        scanRevision: 1,
        summary: {
          projectId: request.projectId,
          draftRevision: request.baseRevision,
          sourcesRequested: 1,
          sourcesScanned: request.phase === "begin" ? 0 : 1,
          discovered: count,
          supported: count,
          possibleDuplicates: 0,
          skipped: 0,
          failed: 0,
          cancelled: request.phase === "cancel",
          failures: [],
        } satisfies SourceDiscoverySummary,
      };
    },
  );
  const sourceDiscoveryReadiness = vi.fn(async () => ({
    summary: options.scanReadiness,
  }));
  const browserStagedOccurrences = vi.fn(
    async (selectionId: string, offset = 0, limit = 500) => {
      void selectionId;
      return {
        page: {
          occurrenceIds: (options.stagedOccurrenceIds ?? []).slice(
            offset,
            offset + limit,
          ),
          offset,
          limit,
          hasMore: offset + limit < (options.stagedOccurrenceIds ?? []).length,
        },
      };
    },
  );
  const stageBrowserSource = vi.fn(async () => ({
    receipt: {
      occurrenceId: "occurrence-1",
      contentHash: "a".repeat(64),
      byteLength: 123,
    },
  }));
  const sourceOccurrences = vi.fn(async () => ({
    page:
      options.occurrencePage ??
      ({
        items: [
          {
            occurrence: {
              id: "occurrence-1",
              logicalRootId: "root:source-1",
              displayName: "one.jpg",
              relativePath: "one.jpg",
              fileKind: "image" as const,
              byteLength: 123,
              availability: "available" as const,
              scanRevision: 1,
            },
            included: true,
          },
        ],
        offset: 0,
        limit: 20,
        hasMore: false,
      } satisfies CatalogOccurrencePage),
  }));
  const setSourceOccurrenceIncluded = vi.fn(
    async (
      occurrenceId: string,
      input: { selectionId: string; included: boolean },
    ) => ({
      membership: {
        selectionId: input.selectionId,
        occurrenceId,
        included: input.included,
        revision: draft.revision,
      },
    }),
  );
  const createSourceBatch = vi.fn(async () => ({
    result: {
      batch: {
        id: "batch-1",
        projectId: draft.projectId,
        draftRevision: draft.revision,
        scopeMode: "selected-sources",
        status: "sealed",
        expectedManifestId: "expected-1",
        createdAt: "2026-10-29T00:00:00.000Z",
      },
      expectedManifest: {
        id: "expected-1",
        batchId: "batch-1",
        revision: draft.revision,
        selectionHash: "a".repeat(64),
        entries: [],
        partialPolicy: "require-all",
        createdAt: "2026-10-29T00:00:00.000Z",
      },
      verifiedManifest: {
        id: "verified-1",
        expectedManifestId: "expected-1",
        members: options.verifiedManifestMembers ?? [],
        failures: [],
        excludedOccurrenceIds: [],
        createdAt: "2026-10-29T00:00:00.000Z",
      },
      status: "sealed",
      expected: 1,
      included: 1,
      verified: 1,
      failed: 0,
      excluded: 0,
    },
  }));
  const sourceBatchProgress = vi.fn(async (requestId: string) => ({
    state: {
      requestId,
      projectId: draft.projectId,
      status: "completed" as const,
      progress: {
        batchId: "batch-1",
        stage: "completed" as const,
        completed: 1,
        total: 1,
        failed: 0,
        cancelled: false,
      },
    },
  }));
  const analysisRun = {
    id: "analysis-run-1",
    projectId: draft.projectId,
    manifestId: "verified-1",
    scopeMode: "selected-sources" as const,
    algorithmVersion: "common-events-duplicates-v1",
    taxonomyVersion: "common-evidence-v1",
    configHash: "c".repeat(64),
    inputFingerprint: "d".repeat(64),
    inputBindingIds: ["binding-1"],
    status: "completed" as const,
    createdAt: "2026-10-29T00:00:00.000Z",
  };
  const sourceAnalysisRecord: SourceAnalysisRunRecord = {
    run: analysisRun,
    results: options.analysisResults ?? [
      {
        id: "result-1",
        runId: analysisRun.id,
        kind: "event" as const,
        reviewStatus: "pending" as const,
        evidence: {
          type: "event" as const,
          assetIds: ["asset-1"],
          labels: [],
          confidence: 0.2,
        },
        bindingIds: ["binding-1"],
      },
    ],
    attempts: [],
  };
  const sourceAnalysisProgress = vi.fn(async (requestId: string) => ({
    state: {
      requestId,
      projectId: draft.projectId,
      status: "completed" as const,
      progress: {
        runId: analysisRun.id,
        stage: "completed" as const,
        completed: 1,
        total: 1,
      },
      result: sourceAnalysisRecord,
    },
  }));
  const createSourceAnalysis = vi.fn(async () => ({
    result: sourceAnalysisRecord,
  }));
  const visionSampleProviders = vi.fn(async () => ({ providers: [] }));
  const grantVisionSampleConsent = vi.fn(async () => ({ providers: [] }));
  const revokeVisionSampleConsent = vi.fn(async () => ({ providers: [] }));
  const searchSourceAnalysisReview = vi.fn(
    async (_runId: string, _query = "", offset = 0, limit = 50) => ({
      result: {
        items: sourceAnalysisRecord.results
          .slice(offset, offset + limit)
          .map((result): SourceAnalysisReviewItem => ({
            ...result,
            sourceBounds: [
              { assetId: "asset-1", mediaType: "video", duration: 8 },
            ],
          })),
        total: sourceAnalysisRecord.results.length,
        offset,
        limit,
      },
      decisions: structuredClone(options.reviewDecisions ?? []),
    }),
  );
  const previewSourceAnalysisReview = vi.fn(
    async (_runId: string, operation: ReviewDecisionOperation) => ({
      preview: {
        outcome: "ready" as const,
        operation,
        operationFingerprint: "f".repeat(64),
        targetIds: ["result-1"],
        runId: analysisRun.id,
        manifestId: "verified-1",
        beforeFingerprint: "e".repeat(64),
        affectedAssetIds: ["asset-1"],
      },
    }),
  );
  const acceptSourceAnalysisReview = vi.fn(
    async (
      _runId: string,
      _request: Parameters<
        typeof import("../../apps/desktop/src/api.js").api.acceptSourceAnalysisReview
      >[1],
    ) => ({
      decision: {
        id: "decision-1",
        outcome: "applied",
        operation: { kind: "reject-results", resultIds: ["result-1"] },
      },
    }),
  );
  const sourceAnalysisRun = vi.fn(async () => ({
    result: sourceAnalysisRecord,
  }));
  const project = vi.fn(async () => ({
    project: { id: draft.projectId, stories: options.reviewStories ?? [] },
    path: null,
  }));
  const retrySourceAnalysis = vi.fn(async () => ({
    result: sourceAnalysisRecord,
  }));
  const cancelSourceAnalysis = vi.fn(async () => ({ ok: true as const }));
  const releaseBrowserSources = vi.fn(
    async (
      _projectId: string,
      _sources: readonly Pick<
        SourceSelectionInput,
        "accessClass" | "accessRef"
      >[],
      _retained: ReadonlySet<string>,
    ) => {},
  );
  const classifyNativeDrop = vi.fn(async () =>
    Promise.resolve(
      options.nativeDropResult ?? {
        sources: [input("dropped.mp4")],
        rejected: [] as [],
      },
    ),
  );
  const sourceAvailabilities = vi.fn(
    async (_owner: string, sources: SourceSelection[]) =>
      Object.fromEntries(
        sources.map((source) => [
          source.id,
          options.availability ?? "available",
        ]),
      ),
  );
  let nativeDropListener:
    | ((event: {
        type: "enter" | "over" | "drop" | "leave";
        paths: string[];
      }) => void)
    | undefined;
  const pickNativeFiles = options.nativeFilesResult
    ? vi.fn(() => options.nativeFilesResult!)
    : vi
        .fn()
        .mockResolvedValueOnce({
          sources: [input("1.mp4"), input("2.mp4"), input("3.mp4")],
          rejected: [],
        })
        .mockResolvedValueOnce({
          sources: [input("4.mp4"), input("5.mp4")],
          rejected: [],
        })
        .mockResolvedValueOnce({ sources: [], rejected: [] });
  const component = loadComponent(
    "apps/desktop/src/components/ImportPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        api: {
          sourceDraft,
          addSourceSelections,
          removeSourceSelection,
          updateSourceSelection,
          scanSourceDraft,
          browserSourceScan,
          sourceDiscoveryReadiness,
          browserStagedOccurrences,
          stageBrowserSource,
          sourceDiscoveryProgress,
          sourceOccurrences,
          setSourceOccurrenceIncluded,
          createSourceBatch,
          sourceBatchProgress,
          sourceAnalysisProgress,
          createSourceAnalysis,
          visionSampleProviders,
          grantVisionSampleConsent,
          revokeVisionSampleConsent,
          searchSourceAnalysisReview,
          previewSourceAnalysisReview,
          acceptSourceAnalysisReview,
          sourceAnalysisRun,
          project,
          retrySourceAnalysis,
          cancelSourceAnalysis,
        },
      },
      "../sourcePicker": {
        pickNativeFiles,
        pickNativeFolders: vi.fn(async () => ({ sources: [], rejected: [] })),
        pickBrowserFiles: vi.fn(),
        pickBrowserFolder: vi.fn(async () => {
          if (options.browserFolderError) throw options.browserFolderError;
          return undefined;
        }),
        pickBrowserFallbackFolders: vi.fn(),
        sourcesFromBrowserDrop: vi.fn(),
        classifyNativeDrop,
        clearBrowserEphemeral: vi.fn(),
        releaseBrowserSources,
        browserFilesForSelections: vi.fn(),
        iterateBrowserSelectionFiles: async function* () {
          for (const entry of options.browserFiles ?? []) yield entry;
        },
        sourceAvailabilities,
        listenForNativeDrop: vi.fn(async (listener) => {
          nativeDropListener = listener;
          return options.nativeDropRegistration ?? (() => {});
        }),
      },
      "../source-review-acceptance": sourceReviewAcceptance,
      "../i18n": { formatNumber: String },
      "./Icon.vue": { render: () => null },
    },
  );
  const props = vue.reactive({
    projectId: "project-a",
    native: true,
    busy: false,
    expert: false,
    progress: undefined as
      | {
          completed: number;
          total: number;
          bytesUploaded: number;
          totalBytes: number;
        }
      | undefined,
    onError: vi.fn(),
    onClose: vi.fn(),
    onFolder: vi.fn(),
    onFiles: vi.fn(),
    onUpload: vi.fn(),
    onCancel: vi.fn(),
  });
  const mounted = mountComponent(component, props);
  cleanup.push(mounted.unmount);
  const nodes = () => flatten(mounted.root);
  const button = (key: string) =>
    nodes().find(
      (node) =>
        node.tag === "button" &&
        flatten(node)
          .map((child) => child.text)
          .join("")
          .includes(key),
    );
  return {
    ...mounted,
    props,
    nodes,
    button,
    sourceDraft,
    addSourceSelections,
    removeSourceSelection,
    updateSourceSelection,
    scanSourceDraft,
    browserSourceScan,
    sourceDiscoveryReadiness,
    browserStagedOccurrences,
    stageBrowserSource,
    sourceDiscoveryProgress,
    sourceOccurrences,
    setSourceOccurrenceIncluded,
    createSourceBatch,
    sourceBatchProgress,
    sourceAnalysisProgress,
    createSourceAnalysis,
    visionSampleProviders,
    grantVisionSampleConsent,
    revokeVisionSampleConsent,
    searchSourceAnalysisReview,
    previewSourceAnalysisReview,
    acceptSourceAnalysisReview,
    sourceAnalysisRun,
    sourceAnalysisRecord,
    project,
    retrySourceAnalysis,
    sourceAvailabilities,
    releaseBrowserSources,
    pickNativeFiles,
    classifyNativeDrop,
    nativeDrop(event: {
      type: "enter" | "over" | "drop" | "leave";
      paths: string[];
    }) {
      nativeDropListener?.(event);
    },
    onFiles: props.onFiles,
  };
}

async function reviewFixture(options: Parameters<typeof fixture>[0] = {}) {
  const h = fixture({
    initialDraft: {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 3,
      selections: [
        {
          ...input("review-media"),
          kind: "folder",
          id: "source-review",
          projectId: "project-a",
          selectionRevision: 1,
          recursive: true,
        },
      ],
    },
    verifiedManifestMembers: [
      {
        bindingId: "binding-1",
        assetId: "asset-1",
        contentHash: "a".repeat(64),
        contextRevision: "b".repeat(64),
      },
    ],
    ...options,
  });
  await runReviewAnalysis(h);
  return h;
}

async function runReviewAnalysis(h: ReturnType<typeof fixture>) {
  await settle();
  for (const action of [
    "app.import.scan.action",
    "app.import.seal.action",
    "app.import.analysis.run",
  ]) {
    await (h.button(action)!.props.onClick as () => Promise<void>)();
    await settle();
  }
}

function selectReviewResult(h: ReturnType<typeof fixture>, id = "result-1") {
  const checkbox = h
    .nodes()
    .find(
      (node) =>
        node.tag === "input" &&
        node.props.type === "checkbox" &&
        node.props.value === id,
    );
  expect(checkbox).toBeDefined();
  (checkbox!.props["onUpdate:modelValue"] as (value: string[]) => void)([id]);
}

function changeReviewAction(h: ReturnType<typeof fixture>, kind: string) {
  const select = h
    .nodes()
    .find(
      (node) =>
        node.tag === "select" &&
        flatten(node).some((child) => child.props.value === "split"),
    );
  (select!.props["onUpdate:modelValue"] as (value: string) => void)(kind);
}

describe("additive source draft panel", () => {
  it("previews multiple selected analysis results for story adoption", async () => {
    const h = await reviewFixture({
      reviewStories: [{ id: "story-a", title: "合成故事", beats: [] }],
      analysisResults: ["result-1", "result-2"].map((id, index) => ({
        id,
        runId: "analysis-run-1",
        kind: "event",
        reviewStatus: "pending",
        bindingIds: ["binding-1"],
        evidence: {
          type: "event",
          assetIds: [`asset-${index + 1}`],
          labels: [],
        },
      })),
    });
    const checkbox = h
      .nodes()
      .find((node) => node.tag === "input" && node.props.value === "result-1")!;
    (checkbox.props["onUpdate:modelValue"] as (v: string[]) => void)([
      "result-1",
      "result-2",
    ]);
    changeReviewAction(h, "adopt");
    await settle();
    const story = h
      .nodes()
      .find(
        (node) =>
          node.tag === "select" &&
          flatten(node).some((child) => child.props.value === "story-a"),
      )!;
    (story.props["onUpdate:modelValue"] as (v: string) => void)("story-a");
    await settle();
    await (
      h.button("app.import.analysis.review.preview")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    expect(h.previewSourceAnalysisReview).toHaveBeenCalledWith(
      "analysis-run-1",
      {
        kind: "adopt-story",
        storyId: "story-a",
        resultIds: ["result-1", "result-2"],
      },
    );
  });

  it("scans the saved draft and pages only relative discovered paths", async () => {
    const selected: SourceSelection = {
      ...input("film-media"),
      kind: "folder",
      id: "source-1",
      projectId: "project-a",
      selectionRevision: 1,
      recursive: true,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 4,
        selections: [selected],
      },
      scanResult: {
        projectId: "project-a",
        draftRevision: 4,
        sourcesRequested: 1,
        sourcesScanned: 1,
        discovered: 3,
        supported: 2,
        possibleDuplicates: 1,
        skipped: 1,
        failed: 0,
        cancelled: false,
        failures: [],
      },
    });
    await settle();

    await (
      h.button("app.import.scan.action")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.scanSourceDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-a",
        baseRevision: 4,
        selectionIds: ["source-1"],
      }),
      expect.any(AbortSignal),
    );
    expect(h.sourceOccurrences).toHaveBeenCalledWith("source-1", 0, 20);
    expect(h.nodes().some((node) => node.text.includes("one.jpg"))).toBe(true);
    expect(
      h
        .nodes()
        .some((node) =>
          node.text.includes("app.import.scan.possibleDuplicates"),
        ),
    ).toBe(true);
    expect(
      h.nodes().some((node) => node.text.includes("/synthetic/film-media")),
    ).toBe(false);
  });

  it("edits independent file membership and seals the reviewed native selection", async () => {
    const selected: SourceSelection = {
      ...input("film-media"),
      kind: "folder",
      id: "source-1",
      projectId: "project-a",
      selectionRevision: 1,
      recursive: true,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 4,
        selections: [selected],
      },
      scanResult: {
        projectId: "project-a",
        draftRevision: 4,
        sourcesRequested: 1,
        sourcesScanned: 1,
        discovered: 1,
        supported: 1,
        possibleDuplicates: 0,
        skipped: 0,
        failed: 0,
        cancelled: false,
        failures: [],
      },
    });
    await settle();
    await (
      h.button("app.import.scan.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    const checkbox = h
      .nodes()
      .filter((node) => node.tag === "input" && node.props.type === "checkbox")
      .at(-1);
    expect(checkbox).toBeDefined();
    await (checkbox!.props.onChange as (event: unknown) => Promise<void>)({
      target: { checked: false },
    });
    expect(h.setSourceOccurrenceIncluded).toHaveBeenCalledWith(
      "occurrence-1",
      expect.objectContaining({
        projectId: "project-a",
        baseRevision: 4,
        selectionId: "source-1",
        included: false,
      }),
    );

    await (
      h.button("app.import.seal.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.createSourceBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-a",
        baseRevision: 4,
        selectionIds: ["source-1"],
        partialPolicy: "require-all",
      }),
      expect.any(AbortSignal),
    );
    expect(
      h
        .nodes()
        .some((node) => node.text.includes("app.import.seal.result.sealed")),
    ).toBe(true);
  });

  it("discovers browser files in pages and stages only included bytes before sealing", async () => {
    const selected: SourceSelection = {
      ...input("Browser album"),
      kind: "folder",
      id: "browser-source-1",
      projectId: "project-a",
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:ephemeral",
      selectionRevision: 1,
      recursive: true,
    };
    const file = Object.assign(new Blob(["x".repeat(123)]), {
      name: "one.jpg",
      lastModified: 0,
    }) as File;
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 4,
        selections: [selected],
      },
      browserFiles: [
        {
          relativePath: "day-one/one.jpg",
          file,
          modifiedAt: new Date(0).toISOString(),
        },
      ],
      occurrencePage: {
        items: [
          {
            occurrence: {
              id: "browser-occurrence",
              logicalRootId: "root:browser-source-1",
              displayName: "one.jpg",
              relativePath: "day-one/one.jpg",
              fileKind: "image",
              byteLength: 123,
              modifiedAt: new Date(0).toISOString(),
              availability: "available",
              scanRevision: 1,
            },
            included: true,
          },
        ],
        offset: 0,
        limit: 500,
        hasMore: false,
      },
    });
    await settle();
    await (
      h.button("app.import.scan.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.browserSourceScan).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionId: "browser-source-1",
        phase: "begin",
      }),
      expect.any(AbortSignal),
    );
    expect(h.browserSourceScan).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionId: "browser-source-1",
        phase: "page",
        candidates: [
          {
            relativePath: "day-one/one.jpg",
            name: "one.jpg",
            size: 123,
            modifiedAt: new Date(0).toISOString(),
          },
        ],
      }),
      expect.any(AbortSignal),
    );
    expect(h.sourceOccurrences).toHaveBeenCalledWith("browser-source-1", 0, 20);

    await (
      h.button("app.import.seal.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.stageBrowserSource).toHaveBeenCalledWith(
      {
        selectionId: "browser-source-1",
        occurrenceId: "browser-occurrence",
        baseRevision: 4,
        file,
      },
      expect.any(AbortSignal),
    );
    expect(h.createSourceBatch).toHaveBeenCalled();
  });

  it("reuses fully staged bytes after reopening when ephemeral browser files expired", async () => {
    const selected: SourceSelection = {
      ...input("Browser album"),
      kind: "folder",
      id: "browser-source-1",
      projectId: "project-a",
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:expired",
      selectionRevision: 1,
      recursive: true,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 4,
        selections: [selected],
      },
      availability: "needs-reselection",
      scanReadiness: {
        projectId: "project-a",
        draftRevision: 4,
        sourcesRequested: 1,
        sourcesScanned: 1,
        discovered: 1,
        supported: 1,
        possibleDuplicates: 0,
        skipped: 0,
        failed: 0,
        cancelled: false,
        failures: [],
      },
      stagedOccurrenceIds: ["occurrence-1"],
    });
    await settle();
    expect(h.nodes().some((node) => node.text.includes("one.jpg"))).toBe(true);
    expect(h.button("app.import.seal.action")?.props.disabled).toBe(false);
    await (
      h.button("app.import.seal.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.browserStagedOccurrences).toHaveBeenCalledWith(
      "browser-source-1",
      0,
      500,
    );
    expect(h.stageBrowserSource).not.toHaveBeenCalled();
    expect(h.createSourceBatch).toHaveBeenCalled();
  });

  it("analyzes only the sealed manifest by default and makes whole-project scope explicit", async () => {
    const selected: SourceSelection = {
      ...input("film-media"),
      kind: "folder",
      id: "source-1",
      projectId: "project-a",
      selectionRevision: 1,
      recursive: true,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 4,
        selections: [selected],
      },
      verifiedManifestMembers: [
        {
          bindingId: "binding-1",
          assetId: "asset-1",
          contentHash: "a".repeat(64),
          contextRevision: "b".repeat(64),
        },
      ],
    });
    await settle();
    await (
      h.button("app.import.scan.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    await (
      h.button("app.import.seal.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    await (
      h.button("app.import.analysis.run")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.createSourceAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedManifestId: "verified-1",
        scopeMode: "selected-sources",
      }),
      expect.any(AbortSignal),
    );
    expect(h.nodes().some((node) => node.text.includes("asset-1"))).toBe(true);

    const scopeLabel = h
      .nodes()
      .find(
        (node) =>
          node.tag === "label" &&
          flatten(node).some((child) =>
            child.text.includes("app.import.analysis.projectScope"),
          ),
      );
    const scopeCheckbox =
      scopeLabel &&
      flatten(scopeLabel).find(
        (node) => node.tag === "input" && node.props.type === "checkbox",
      );
    expect(scopeCheckbox).toBeDefined();
    await (
      scopeCheckbox!.props["onUpdate:modelValue"] as (value: boolean) => void
    )(true);
    await settle();
    await (
      h.button("app.import.analysis.runAgain")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    expect(h.createSourceAnalysis).toHaveBeenLastCalledWith(
      expect.objectContaining({
        verifiedManifestId: "verified-1",
        scopeMode: "project-catalog",
        confirmProjectCatalog: true,
      }),
      expect.any(AbortSignal),
    );
  });

  it("requires select, preview and explicit accept for analysis review actions", async () => {
    const selected: SourceSelection = {
      ...input("review-media"),
      kind: "folder",
      id: "source-review",
      projectId: "project-a",
      selectionRevision: 1,
      recursive: true,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 3,
        selections: [selected],
      },
      verifiedManifestMembers: [
        {
          bindingId: "binding-1",
          assetId: "asset-1",
          contentHash: "a".repeat(64),
          contextRevision: "b".repeat(64),
        },
      ],
    });
    await settle();
    await (
      h.button("app.import.scan.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    await (
      h.button("app.import.seal.action")!.props.onClick as () => Promise<void>
    )();
    await settle();
    await (
      h.button("app.import.analysis.run")!.props.onClick as () => Promise<void>
    )();
    await settle();
    const resultCheckbox = h
      .nodes()
      .find(
        (node) =>
          node.tag === "input" &&
          node.props.type === "checkbox" &&
          node.props.value === "result-1",
      );
    expect(resultCheckbox).toBeDefined();
    (resultCheckbox!.props["onUpdate:modelValue"] as (value: string[]) => void)(
      ["result-1"],
    );
    await settle();
    expect(h.button("app.import.analysis.review.preview")).toBeDefined();
    await (
      h.button("app.import.analysis.review.preview")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    expect(h.previewSourceAnalysisReview).toHaveBeenCalledWith(
      "analysis-run-1",
      { kind: "reject-results", resultIds: ["result-1"] },
    );
    expect(h.acceptSourceAnalysisReview).not.toHaveBeenCalled();
    await (
      h.button("app.import.analysis.review.accept")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    expect(h.acceptSourceAnalysisReview).toHaveBeenCalledOnce();
    expect(h.acceptSourceAnalysisReview).toHaveBeenCalledWith(
      "analysis-run-1",
      expect.objectContaining({
        expectedManifestId: "verified-1",
        expectedBeforeFingerprint: "e".repeat(64),
        expectedOperationFingerprint: "f".repeat(64),
      }),
    );
  });

  it.each(["start", "end", "axis", "correction", "story"])(
    "invalidates a review preview when the %s field changes",
    async (field) => {
      const h = await reviewFixture({
        reviewStories: [
          { id: "story-a", title: "First story", beats: [] },
          { id: "story-b", title: "Second story", beats: [] },
        ],
        analysisResults: [
          {
            id: "result-1",
            runId: "analysis-run-1",
            kind: "observation",
            reviewStatus: "pending",
            bindingIds: ["binding-1"],
            evidence: {
              type: "visual-sample",
              algorithmVersion: "representative-frames-v1",
              sampleId: "sample-1",
              sampleFingerprint: "a".repeat(64),
              assetId: "asset-1",
              sourceHash: "a".repeat(64),
              sourceTimeRange: { start: 0, end: 0 },
              status: "unknown",
              reason: "provider-not-configured",
              suggestedLabels: [],
              manualReviewRequired: true,
            },
          },
        ],
      });
      selectReviewResult(h);
      changeReviewAction(
        h,
        field === "story"
          ? "adopt"
          : field === "axis" || field === "correction"
            ? "correct"
            : "split",
      );
      await settle();
      const control = (label: string, tag: string) => {
        const parent = h
          .nodes()
          .find(
            (node) =>
              node.tag === "label" &&
              flatten(node).some((child) => child.text.includes(label)),
          );
        return flatten(parent!).filter((node) => node.tag === tag);
      };
      if (field === "story") {
        (
          control("app.import.analysis.review.story", "select")[0]!.props[
            "onUpdate:modelValue"
          ] as (v: string) => void
        )("story-a");
      } else if (field === "axis" || field === "correction") {
        (
          control("app.import.analysis.review.correction", "input")[0]!.props[
            "onUpdate:modelValue"
          ] as (v: string) => void
        )("Reviewed note");
      }
      await settle();
      await (
        h.button("app.import.analysis.review.preview")!.props
          .onClick as () => Promise<void>
      )();
      await settle();
      expect(h.button("app.import.analysis.review.accept")).toBeDefined();
      const changed =
        field === "story"
          ? control("app.import.analysis.review.story", "select")[0]!
          : field === "axis"
            ? control("app.import.analysis.review.axis", "select")[0]!
            : field === "correction"
              ? control("app.import.analysis.review.correction", "input")[0]!
              : control("app.import.analysis.review.splitRange", "input")[
                  field === "start" ? 0 : 1
                ]!;
      (changed.props["onUpdate:modelValue"] as (v: string | number) => void)(
        field === "story"
          ? "story-b"
          : field === "axis"
            ? "label"
            : field === "correction"
              ? "Updated note"
              : field === "start"
                ? 0.25
                : 2,
      );
      await settle();
      expect(h.button("app.import.analysis.review.accept")).toBeUndefined();
    },
  );

  it("does not publish a delayed preview after its form changes", async () => {
    const h = await reviewFixture();
    selectReviewResult(h);
    await settle();
    type Response = Awaited<ReturnType<typeof h.previewSourceAnalysisReview>>;
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const response = await h.previewSourceAnalysisReview("analysis-run-1", {
      kind: "reject-results",
      resultIds: ["result-1"],
    });
    h.previewSourceAnalysisReview.mockImplementationOnce(() => pending);
    const previewing = (
      h.button("app.import.analysis.review.preview")!.props
        .onClick as () => Promise<void>
    )();
    changeReviewAction(h, "split");
    await settle();
    resolve(response);
    await previewing;
    await settle();
    expect(h.button("app.import.analysis.review.accept")).toBeUndefined();
  });

  it("keeps the newest search results when earlier responses arrive last", async () => {
    const h = await reviewFixture();
    vi.useFakeTimers();
    cleanup.push(() => vi.useRealTimers());
    type Response = Awaited<ReturnType<typeof h.searchSourceAnalysisReview>>;
    let resolve!: (value: Response) => void;
    const earlier = new Promise<Response>((done) => {
      resolve = done;
    });
    const result = h.sourceAnalysisRecord.results[0]!;
    const response = (id: string): Response => ({
      result: { items: [{ ...result, id }], total: 1, offset: 0, limit: 50 },
      decisions: [],
    });
    h.searchSourceAnalysisReview
      .mockImplementationOnce(() => earlier)
      .mockResolvedValueOnce(response("newer-result"));
    const search = h
      .nodes()
      .find((node) => node.tag === "input" && node.props.type === "search")!;
    (search.props["onUpdate:modelValue"] as (v: string) => void)("earlier");
    await settle();
    await vi.advanceTimersByTimeAsync(180);
    (search.props["onUpdate:modelValue"] as (v: string) => void)("newer");
    await settle();
    await vi.advanceTimersByTimeAsync(180);
    await settle();
    expect(h.nodes().some((node) => node.props.value === "newer-result")).toBe(
      true,
    );
    resolve(response("earlier-result"));
    await settle();
    expect(h.nodes().some((node) => node.props.value === "newer-result")).toBe(
      true,
    );
    expect(
      h.nodes().some((node) => node.props.value === "earlier-result"),
    ).toBe(false);
  });

  it("retries a lost acceptance acknowledgment with the exact original receipt", async () => {
    const h = await reviewFixture();
    selectReviewResult(h);
    await settle();
    await (
      h.button("app.import.analysis.review.preview")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    h.acceptSourceAnalysisReview.mockRejectedValueOnce(
      new Error("connection lost after commit"),
    );
    await (
      h.button("app.import.analysis.review.accept")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    const retry =
      h.button("app.import.analysis.review.retryAccept") ??
      h.button("app.import.analysis.review.accept");
    await (retry!.props.onClick as () => Promise<void>)();
    await settle();
    expect(h.acceptSourceAnalysisReview.mock.calls).toHaveLength(2);
    expect(h.acceptSourceAnalysisReview.mock.calls[1]).toEqual(
      h.acceptSourceAnalysisReview.mock.calls[0],
    );
    expect(h.button("app.import.analysis.review.accept")).toBeUndefined();
  });

  it("does not automatically supersede an unrelated conflicted decision", async () => {
    const h = await reviewFixture({
      reviewDecisions: [
        {
          schemaVersion: 1,
          id: "review:unrelated-conflict",
          projectId: "project-a",
          baseRunId: "analysis-run-1",
          baseResultIds: ["other-result"],
          targetIds: ["other-result"],
          operation: { kind: "reject-results", resultIds: ["other-result"] },
          operationFingerprint: "f".repeat(64),
          beforeFingerprint: "e".repeat(64),
          manifestId: "verified-1",
          outcome: "conflicted",
          createdAt: "2026-10-29T00:00:00.000Z",
        },
      ],
    });
    selectReviewResult(h);
    await settle();
    await (
      h.button("app.import.analysis.review.preview")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    await (
      h.button("app.import.analysis.review.accept")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    expect(
      h.acceptSourceAnalysisReview.mock.calls[0]![1].supersedesDecisionId,
    ).toBeUndefined();
  });

  it("recovers the exact unresolved acceptance after the import panel remounts", async () => {
    const h = await reviewFixture();
    selectReviewResult(h);
    await settle();
    await (
      h.button("app.import.analysis.review.preview")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    h.acceptSourceAnalysisReview.mockRejectedValueOnce(
      new Error("response lost after applying"),
    );
    await (
      h.button("app.import.analysis.review.accept")!.props
        .onClick as () => Promise<void>
    )();
    const original = h.acceptSourceAnalysisReview.mock.calls[0]!;
    h.unmount();
    cleanup.splice(cleanup.indexOf(h.unmount), 1);
    const recovered = fixture();
    await settle();
    const retry = recovered.button("app.import.analysis.review.retryAccept");
    expect(Boolean(retry)).toBe(true);
    await (retry!.props.onClick as () => Promise<void>)();
    await settle();
    expect(recovered.acceptSourceAnalysisReview.mock.calls[0]).toEqual(
      original,
    );
    expect(
      Boolean(recovered.button("app.import.analysis.review.retryAccept")),
    ).toBe(false);
  });

  it("does not send acceptance when its durable receipt cannot be retained", async () => {
    const h = await reviewFixture();
    selectReviewResult(h);
    await settle();
    await (
      h.button("app.import.analysis.review.preview")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    await (
      h.button("app.import.analysis.review.accept")!.props
        .onClick as () => Promise<void>
    )();
    await settle();
    expect(h.acceptSourceAnalysisReview.mock.calls).toHaveLength(0);
    expect(
      h
        .nodes()
        .some((node) =>
          node.text.includes("app.import.analysis.review.storageFailed"),
        ),
    ).toBe(true);
  });

  it("adds 3 then 2 files, treats picker cancellation as no-op and never imports", async () => {
    const h = fixture();
    await settle();
    expect(h.sourceDraft).toHaveBeenCalledTimes(1);
    for (let count = 0; count < 3; count++) {
      const button = h.button("app.import.addFiles");
      expect(button).toBeDefined();
      await (button!.props.onClick as () => Promise<void>)();
      await settle();
    }
    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.pickNativeFiles).toHaveBeenCalledTimes(3);
    expect(
      h.nodes().filter((node) => node.props["data-source-id"]).length,
    ).toBe(5);
    expect(
      h.nodes().some((node) => node.text.includes("app.import.started")),
    ).toBe(false);
    expect(h.onFiles).not.toHaveBeenCalled();
    await (
      h.button("app.import.startCompatible")!.props
        .onClick as () => Promise<void>
    )();
    expect(h.onFiles).toHaveBeenCalledWith([
      "/synthetic/1.mp4",
      "/synthetic/2.mp4",
      "/synthetic/3.mp4",
      "/synthetic/4.mp4",
      "/synthetic/5.mp4",
    ]);
  });

  it("shows access details only in expert mode over the same draft", async () => {
    const h = fixture();
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    h.props.native = false;
    await settle();
    expect(
      h.nodes().some((node) => node.text.includes("/synthetic/1.mp4")),
    ).toBe(false);
    expect(
      h.nodes().some((node) => node.text.includes("app.import.savedRevision")),
    ).toBe(false);
    expect(h.nodes().some((node) => node.tag === "details")).toBe(true);
    h.props.expert = true;
    await settle();
    expect(
      h.nodes().some((node) => node.text.includes("/synthetic/1.mp4")),
    ).toBe(true);
    expect(
      h.nodes().some((node) => node.text.includes("app.import.savedRevision")),
    ).toBe(true);
    expect(h.nodes().some((node) => node.tag === "details")).toBe(false);
    expect(h.addSourceSelections).toHaveBeenCalledTimes(1);
  });

  it("renders large drafts in bounded pages while keeping every source reachable", async () => {
    const selections = Array.from(
      { length: 205 },
      (_, index): SourceSelection => ({
        ...input(`clip-${index}.mp4`),
        id: `source-${index}`,
        projectId: "project-a",
        selectionRevision: 1,
      }),
    );
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections,
      },
    });
    await settle();

    expect(
      h.nodes().filter((node) => node.props["data-source-id"]).length,
    ).toBe(100);
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "source-0"),
    ).toBe(true);
    await (
      h.button("app.import.nextSources")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(
      h.nodes().filter((node) => node.props["data-source-id"]).length,
    ).toBe(100);
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "source-100"),
    ).toBe(true);
    await (
      h.button("app.import.nextSources")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(
      h.nodes().filter((node) => node.props["data-source-id"]).length,
    ).toBe(5);
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "source-204"),
    ).toBe(true);
  });

  it("refreshes browser permissions only for the visible persistent-source page", async () => {
    const selections = Array.from(
      { length: 205 },
      (_, index): SourceSelection => ({
        ...input(`clip-${index}.mp4`),
        id: `source-${index}`,
        projectId: "project-a",
        accessClass: "persistent-browser-handle",
        accessRef: `browser-handle:${index}`,
        selectionRevision: 1,
      }),
    );
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections,
      },
    });
    h.props.native = false;
    await settle();

    expect(h.sourceAvailabilities).toHaveBeenLastCalledWith(
      "project-a",
      selections.slice(0, 100),
    );
    await (
      h.button("app.import.nextSources")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.sourceAvailabilities).toHaveBeenLastCalledWith(
      "project-a",
      selections.slice(100, 200),
    );
  });

  it("does not move the new project's source page for a delayed add response", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const delayedAdd = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const switchedSelections = Array.from(
      { length: 205 },
      (_, index): SourceSelection => ({
        ...input(`switched-${index}.mp4`),
        id: `switched-${index}`,
        projectId: "project-b",
        selectionRevision: 1,
      }),
    );
    const h = fixture({
      delayedAdd,
      switchedDraft: {
        schemaVersion: 1,
        projectId: "project-b",
        revision: 1,
        selections: switchedSelections,
      },
      nativeFilesResult: Promise.resolve({
        sources: [input("late.mp4")],
        rejected: [],
      }),
    });
    await settle();

    const choosing = (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    h.props.projectId = "project-b";
    await settle();
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "switched-0"),
    ).toBe(true);

    resolve({
      draft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [],
      },
    });
    await choosing;
    await settle();

    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "switched-0"),
    ).toBe(true);
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "switched-200"),
    ).toBe(false);
  });

  it("unblocks the new project while an old add response is delayed", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const delayedAdd = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const h = fixture({
      delayedAdd,
      switchedDraft: {
        schemaVersion: 1,
        projectId: "project-b",
        revision: 0,
        selections: [],
      },
      nativeFilesResult: Promise.resolve({
        sources: [input("late.mp4")],
        rejected: [],
      }),
    });
    await settle();

    const choosing = (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.button("app.import.addFiles")?.props.disabled).toBe(true);

    h.props.projectId = "project-b";
    await settle();
    expect(h.button("app.import.addFiles")?.props.disabled).toBe(false);

    resolve({
      draft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [],
      },
    });
    await choosing;
    await settle();
    expect(h.button("app.import.addFiles")?.props.disabled).toBe(false);
  });

  it("keeps a new project's path input when an old path add finishes", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const delayedAdd = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const h = fixture({
      delayedAdd,
      switchedDraft: {
        schemaVersion: 1,
        projectId: "project-b",
        revision: 0,
        selections: [],
      },
    });
    h.props.native = false;
    await settle();
    await (h.button("app.import.addPath")!.props.onClick as () => void)();
    await settle();
    let path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    (path!.props.onInput as (event: unknown) => void)({
      target: { value: "/synthetic/project-a" },
    });
    await settle();
    const form = h
      .nodes()
      .find((node) => node.tag === "form" && node.props.onSubmit);
    const saving = (form!.props.onSubmit as (event: unknown) => Promise<void>)({
      preventDefault() {},
    });
    await settle();

    h.props.projectId = "project-b";
    await settle();
    await (h.button("app.import.addPath")!.props.onClick as () => void)();
    await settle();
    path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    (path!.props.onInput as (event: unknown) => void)({
      target: { value: "/synthetic/project-b" },
    });
    await settle();

    resolve({
      draft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [],
      },
    });
    await saving;
    await settle();

    path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    expect(path?.props.value).toBe("/synthetic/project-b");
  });

  it("shows bounded, actionable reasons for rejected dropped sources", async () => {
    const h = fixture({
      nativeDropResult: {
        sources: [],
        rejected: [
          { label: "private-link", kind: "symlink" },
          { label: "damaged.mov", kind: "unreadable" },
          { label: "socket", kind: "unsupported" },
        ],
      },
    });
    await settle();
    h.nativeDrop({ type: "drop", paths: ["ignored"] });
    await settle();

    const copy = h
      .nodes()
      .map((node) => node.text)
      .join(" ");
    expect(copy).toContain("private-link");
    expect(copy).toContain("app.import.rejectedReason.symlink");
    expect(copy).toContain("damaged.mov");
    expect(copy).toContain("app.import.rejectedReason.unreadable");
    expect(copy).toContain("app.import.rejectedReason.unsupported");
  });

  it("ignores a delayed draft read after the project changes", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const pending = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const h = fixture({ delayedRead: pending });
    await settle();
    h.props.projectId = "project-b";
    await settle();
    resolve({
      draft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 9,
        selections: [
          {
            ...input("late.mp4"),
            id: "late",
            projectId: "project-a",
            selectionRevision: 9,
          },
        ],
      },
    });
    await settle();
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "late"),
    ).toBe(false);
  });

  it("marks an expired browser file for reselection after reopen", async () => {
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 2,
        selections: [
          {
            ...input("旅程.mp4"),
            id: "browser-file",
            projectId: "project-a",
            accessClass: "ephemeral-browser-file",
            accessRef: "browser-file:expired",
            selectionRevision: 2,
          },
        ],
      },
      availability: "needs-reselection",
    });
    h.props.native = false;
    await settle();
    expect(
      h
        .nodes()
        .some((node) =>
          node.text.includes("app.import.access.needs-reselection"),
        ),
    ).toBe(true);
  });

  it("adds a server folder path to the draft before an explicit compatible import", async () => {
    const h = fixture();
    h.props.native = false;
    await settle();
    await (h.button("app.import.addPath")!.props.onClick as () => void)();
    await settle();
    const path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    expect(path).toBeDefined();
    (path!.props.onInput as (event: unknown) => void)({
      target: { value: "/synthetic/家庭旅程" },
    });
    await settle();
    const form = h
      .nodes()
      .find((node) => node.tag === "form" && node.props.onSubmit);
    await (form!.props.onSubmit as (event: unknown) => Promise<void>)({
      preventDefault() {},
    });
    await settle();
    expect(h.addSourceSelections).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [
          expect.objectContaining({
            kind: "folder",
            displayName: "家庭旅程",
            accessClass: "native-path",
            accessRef: "/synthetic/家庭旅程",
          }),
        ],
      }),
    );
    expect(h.props.onFolder).not.toHaveBeenCalled();
    await (
      h.button("app.import.startCompatible")!.props
        .onClick as () => Promise<void>
    )();
    expect(h.props.onFolder).toHaveBeenCalledWith("/synthetic/家庭旅程");
  });

  it("reports a browser folder picker storage failure without an unhandled rejection", async () => {
    const failure = new Error("IndexedDB unavailable");
    const h = fixture({ browserFolderError: failure });
    h.props.native = false;
    await settle();
    await (h.button("app.import.addFolder")!.props.onClick as () => void)();
    await settle();
    expect(h.props.onError).toHaveBeenCalledWith(failure);
  });

  it("disposes a native drop registration that resolves after unmount", async () => {
    let resolve!: (dispose: () => void) => void;
    const pending = new Promise<() => void>((done) => {
      resolve = done;
    });
    const dispose = vi.fn();
    const h = fixture({ nativeDropRegistration: pending });
    await settle();
    h.unmount();
    resolve(dispose);
    await settle();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps a folder path editable when saving the draft fails", async () => {
    const failure = new Error("source draft unavailable");
    const h = fixture({ addError: failure });
    h.props.native = false;
    await settle();
    await (h.button("app.import.addPath")!.props.onClick as () => void)();
    await settle();
    let path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    (path!.props.onInput as (event: unknown) => void)({
      target: { value: "/synthetic/retry" },
    });
    await settle();
    const form = h
      .nodes()
      .find((node) => node.tag === "form" && node.props.onSubmit);
    await (form!.props.onSubmit as (event: unknown) => Promise<void>)({
      preventDefault() {},
    });
    await settle();

    path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    expect(path?.props.value).toBe("/synthetic/retry");
    expect(h.props.onError).toHaveBeenCalledWith(failure);
  });

  it("rolls a recursive checkbox back when the saved mutation fails", async () => {
    const failure = Object.assign(new Error("revision rejected"), {
      code: "request.invalid",
    });
    const h = fixture({
      updateError: failure,
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [
          {
            id: "folder-recursive",
            projectId: "project-a",
            kind: "folder",
            displayName: "Story",
            accessClass: "native-path",
            accessRef: "/synthetic/story",
            recursive: true,
            selectionRevision: 1,
          },
        ],
      },
    });
    await settle();
    const checkbox = h
      .nodes()
      .find((node) => node.tag === "input" && node.props.type === "checkbox");
    const target = { checked: false };

    await (checkbox!.props.onChange as (event: unknown) => Promise<void>)({
      target,
    });
    await settle();

    expect(h.updateSourceSelection).toHaveBeenCalledTimes(1);
    expect(target.checked).toBe(true);
    expect(h.props.onError).toHaveBeenCalledWith(failure);
  });

  it("does not offer the recursive legacy importer for a nonrecursive folder", async () => {
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [
          {
            id: "folder-shallow",
            projectId: "project-a",
            kind: "folder",
            displayName: "Only this folder",
            accessClass: "native-path",
            accessRef: "/synthetic/shallow",
            recursive: false,
            selectionRevision: 1,
          },
        ],
      },
    });
    await settle();
    expect(h.button("app.import.startCompatible")?.props.disabled).toBe(true);
    expect(h.props.onFolder).not.toHaveBeenCalled();
  });

  it("keeps close disabled and cancellation visible throughout an upload", async () => {
    const h = fixture();
    await settle();
    h.props.busy = true;
    await settle();
    let close = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.close",
      );
    expect(close?.props.disabled).toBe(false);
    h.props.progress = {
      completed: 0,
      total: 1,
      bytesUploaded: 0,
      totalBytes: 9,
    };
    await settle();
    close = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.close",
      );
    expect(close?.props.disabled).toBe(true);
    expect(h.button("app.import.cancelUpload")).toBeDefined();
  });

  it("discards and releases a picker result that resolves after the panel unmounts", async () => {
    let resolve!: (result: {
      sources: SourceSelectionInput[];
      rejected: [];
    }) => void;
    const pending = new Promise<{
      sources: SourceSelectionInput[];
      rejected: [];
    }>((done) => {
      resolve = done;
    });
    const h = fixture({ nativeFilesResult: pending });
    await settle();
    const choosing = (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    h.unmount();
    const late: SourceSelectionInput = {
      ...input("late.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:late",
    };
    resolve({ sources: [late], rejected: [] });
    await choosing;
    await settle();
    expect(h.addSourceSelections).not.toHaveBeenCalled();
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [late],
      expect.any(Set),
    );
  });

  it("releases browser access when adding its source to the draft fails", async () => {
    const failure = Object.assign(new Error("draft rejected"), {
      code: "request.invalid",
    });
    const browserSource: SourceSelectionInput = {
      ...input("private.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:private",
    };
    const h = fixture({
      addError: failure,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [browserSource],
      expect.any(Set),
    );
  });

  it("releases removed browser access after the revised draft is accepted", async () => {
    const source: SourceSelection = {
      ...input("private.mp4"),
      id: "private-source",
      projectId: "project-a",
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:private",
      selectionRevision: 1,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [source],
      },
      removeDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 2,
        selections: [],
      },
    });
    await settle();
    const remove = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.removeSource",
      );
    await (remove!.props.onClick as () => Promise<void>)();
    await settle();
    expect(h.removeSourceSelection).toHaveBeenCalledWith(
      "private-source",
      expect.any(Object),
    );
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [source],
      new Set(),
    );
  });

  it("retains access from an authoritative add response that arrives after unmount", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const response = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const browserSource: SourceSelectionInput = {
      ...input("committed.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:committed",
    };
    const committed: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 1,
      selections: [
        {
          ...browserSource,
          id: "committed-source",
          projectId: "project-a",
          recursive: false,
          selectionRevision: 1,
        },
      ],
    };
    const h = fixture({
      delayedAdd: response,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    const choosing = (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    h.unmount();
    resolve({ draft: committed });
    await choosing;

    const retained = h.releaseBrowserSources.mock.calls[0]?.[2];
    expect(retained).toContain("browser-file:committed");
  });

  it("reuses one request identity after a committed add loses its response", async () => {
    const browserSource: SourceSelectionInput = {
      ...input("reconciled.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:reconciled",
    };
    const committed: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 1,
      selections: [
        {
          ...browserSource,
          id: "reconciled-source",
          projectId: "project-a",
          recursive: false,
          selectionRevision: 1,
        },
      ],
    };
    const h = fixture({
      lostAddDraft: committed,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.addSourceSelections.mock.calls[0]![0].requestId).toBe(
      h.addSourceSelections.mock.calls[1]![0].requestId,
    );
    const retained = h.releaseBrowserSources.mock.calls[0]?.[2];
    expect(retained).toContain("browser-file:reconciled");
  });

  it("reloads authoritative state when both same-receipt mutation attempts lose their response", async () => {
    const failure = Object.assign(
      new Error("workspace transport unavailable"),
      {
        code: "workspace.unavailable",
        status: 0,
      },
    );
    const browserSource: SourceSelectionInput = {
      ...input("uncertain.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:uncertain",
    };
    const h = fixture({
      addError: failure,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.addSourceSelections.mock.calls[0]![0].requestId).toBe(
      h.addSourceSelections.mock.calls[1]![0].requestId,
    );
    expect(h.props.onError).toHaveBeenCalledWith(failure);
    expect(h.sourceDraft).toHaveBeenCalledTimes(2);
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [browserSource],
      new Set(),
    );
  });

  it("conservatively retains access when mutation and authoritative reload are both unavailable", async () => {
    const failure = Object.assign(
      new Error("workspace transport unavailable"),
      {
        code: "workspace.unavailable",
        status: 0,
      },
    );
    const reloadFailure = new Error("authoritative read unavailable");
    const browserSource: SourceSelectionInput = {
      ...input("uncertain.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:uncertain",
    };
    const h = fixture({
      addError: failure,
      reloadError: reloadFailure,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.sourceDraft).toHaveBeenCalledTimes(2);
    expect(h.props.onError).toHaveBeenCalledWith(reloadFailure);
    expect(h.releaseBrowserSources).not.toHaveBeenCalled();
  });

  it("releases a removed source from an authoritative response after unmount", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const response = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const source: SourceSelection = {
      ...input("removed.mp4"),
      id: "removed-source",
      projectId: "project-a",
      accessClass: "persistent-browser-handle",
      accessRef: "browser-handle:removed",
      selectionRevision: 1,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [source],
      },
      delayedRemove: response,
    });
    await settle();
    const remove = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.removeSource",
      );
    const removing = (remove!.props.onClick as () => Promise<void>)();
    await settle();
    h.unmount();
    resolve({
      draft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 2,
        selections: [],
      },
    });
    await removing;
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [source],
      new Set(),
    );
  });

  it("reuses one request identity when a committed removal loses its response", async () => {
    const source: SourceSelection = {
      ...input("removed.mp4"),
      id: "removed-source",
      projectId: "project-a",
      accessClass: "persistent-browser-handle",
      accessRef: "browser-handle:removed",
      selectionRevision: 1,
    };
    const removed: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 2,
      selections: [],
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [source],
      },
      lostRemoveDraft: removed,
    });
    await settle();
    const remove = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.removeSource",
      );
    await (remove!.props.onClick as () => Promise<void>)();
    await settle();

    expect(h.removeSourceSelection).toHaveBeenCalledTimes(2);
    expect(h.removeSourceSelection.mock.calls[0]![1].requestId).toBe(
      h.removeSourceSelection.mock.calls[1]![1].requestId,
    );
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [source],
      new Set(),
    );
  });

  it("reloads the latest draft after a stale mutation and permits another edit", async () => {
    const latest: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 1,
      selections: [
        {
          ...input("remote.mp4"),
          id: "remote",
          projectId: "project-a",
          selectionRevision: 1,
        },
      ],
    };
    const h = fixture({ staleAddDraft: latest });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.sourceDraft).toHaveBeenCalledTimes(2);
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "remote"),
    ).toBe(true);
    expect(h.button("app.import.addFiles")?.props.disabled).toBe(false);

    h.nativeDrop({ type: "drop", paths: ["/synthetic/dropped.mp4"] });
    await settle();
    expect(h.classifyNativeDrop).toHaveBeenCalledWith([
      "/synthetic/dropped.mp4",
    ]);
    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
  });
});
