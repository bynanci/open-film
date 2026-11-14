import { afterEach, expect, it, vi } from "vitest";
import type {
  ProjectVersionCreateInput,
  VersionComparisonPreviewDescriptor,
  VersionComparisonPreviewInput,
} from "@openfilm/application";
import { VersionComparisonPlayback } from "../../apps/desktop/src/versionComparisonPlayback.js";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host.js";

const projectId = "project-1",
  snapshotId = "11111111-1111-4111-8111-111111111111",
  variantA = {
    id: "a",
    name: "Baseline",
    intent: "Original cut",
    scope: { type: "film" },
    createdAt: "2026-11-14T00:00:00.000Z",
    derivedCompositionId: "composition-a",
    status: "compared",
  },
  variantB = {
    id: "b",
    name: "Alt cut",
    intent: "Alternative pacing",
    scope: { type: "film" },
    createdAt: "2026-11-14T00:00:00.000Z",
    derivedCompositionId: "composition-b",
    status: "compared",
  };

const descriptor = {
  version: 1,
  id: "22222222-2222-4222-8222-222222222222",
  projectId,
  expiresAt: "2030-01-01T00:00:00.000Z",
  a: {
    versionId: snapshotId,
    versionName: "Baseline vs Alt cut",
    projectHash: "a".repeat(64),
    catalogHash: "b".repeat(64),
    snapshotIdentity: "c".repeat(64),
    compositionId: "composition-a",
    compositionSha256: "d".repeat(64),
    settingsSha256: "e".repeat(64),
    sourceKeyDigest: "f".repeat(64),
    compositionDuration: 2,
    duration: 2,
    frameRate: 24,
    hasAudio: true,
    sha256: "1".repeat(64),
    bytes: 1000,
    warnings: [],
  },
  b: {
    versionId: snapshotId,
    versionName: "Baseline vs Alt cut",
    projectHash: "a".repeat(64),
    catalogHash: "b".repeat(64),
    snapshotIdentity: "c".repeat(64),
    compositionId: "composition-b",
    compositionSha256: "5".repeat(64),
    settingsSha256: "e".repeat(64),
    sourceKeyDigest: "f".repeat(64),
    compositionDuration: 2.5,
    duration: 2.5,
    frameRate: 24,
    hasAudio: true,
    sha256: "6".repeat(64),
    bytes: 1200,
    warnings: [],
  },
} satisfies VersionComparisonPreviewDescriptor;

afterEach(() => vi.unstubAllGlobals());

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await vue.nextTick();
  await Promise.resolve();
  await vue.nextTick();
}

it("captures one named snapshot before rendering and previews the selected variant Compositions", async () => {
  const longVariantA = { ...variantA, name: "🙂".repeat(64) },
    longVariantB = { ...variantB, name: "🎞️".repeat(64) };
  const comparisonResult = {
    comparison: {
      variantA: longVariantA,
      variantB: longVariantB,
      diff: {
        baselineDuration: 2,
        targetDuration: 2.5,
        deltaSeconds: 0.5,
        beatDiffs: [],
      },
    },
  };
  let resolveFirstCompare!: (value: typeof comparisonResult) => void;
  const delayedComparison = new Promise<typeof comparisonResult>((resolve) => {
    resolveFirstCompare = resolve;
  });
  const api = {
    creativeVariantsList: vi.fn(async () => ({
      variants: [longVariantA, longVariantB],
    })),
    creativeVariantsCompare: vi
      .fn()
      .mockReturnValueOnce(delayedComparison)
      .mockResolvedValue(comparisonResult),
    projectVersionRevision: vi.fn(async () => ({
      projectId,
      revision: "9".repeat(64),
    })),
    createProjectVersion: vi.fn(async (_input: ProjectVersionCreateInput) => ({
      version: {
        id: snapshotId,
        name: "Baseline vs Alt cut",
        projectId,
      },
    })),
    prepareVersionComparison: vi.fn(
      async (_input: VersionComparisonPreviewInput) => descriptor,
    ),
    jobs: vi.fn(async () => ({
      jobs: [
        {
          id: api.prepareVersionComparison.mock.calls[0]?.[0].requestId,
          status: "completed",
        },
      ],
    })),
    cancelVersionComparison: vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary cancel failure."))
      .mockResolvedValue({ ok: true }),
    discardVersionComparison: vi.fn(async () => ({ ok: true })),
    deleteProjectVersion: vi.fn(async () => ({ removedVersionId: snapshotId })),
    creativeVariantsDelete: vi.fn(async () => ({ ok: true })),
    creativeVariantsAdopt: vi.fn(),
    creativeVariantsPreviewImpact: vi.fn(),
    creativeVariantsCreate: vi.fn(),
  };
  const component = loadComponent(
    "apps/desktop/src/components/CreativeVariantComparisonModal.vue",
    {
      "vue-i18n": {
        useI18n: () => ({
          t: (key: string, params?: Record<string, string>) =>
            key === "app.variants.previewSnapshotName"
              ? `A/B review: ${params?.a} vs ${params?.b}`
              : key,
        }),
      },
      "../api": {
        api,
        versionComparisonMediaUrl: (
          id: string,
          side: "a" | "b",
          owner: string,
        ) => `/api/version-comparisons/${id}/media/${side}?projectId=${owner}`,
      },
      "./Icon.vue": { render: () => null },
      "../versionComparisonPlayback": { VersionComparisonPlayback },
    },
  );
  vi.stubGlobal("window", {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback: FrameRequestCallback) {
      callback(0);
      return 0;
    },
  });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class HTMLElement {});
  const mounted = mountComponent(component, {
    show: true,
    project: { id: projectId },
    activeCompositionId: "composition-a",
    flushProjectPending: async () => true,
  });

  try {
    await settle();
    const compare = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "variant-compare-b",
    );
    expect(compare).toBeDefined();
    await (compare!.props.onClick as () => Promise<void>)();
    await settle();

    const createTab = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "variant-tab-create",
    );
    expect(createTab).toBeDefined();
    await (createTab!.props.onClick as () => Promise<void>)();
    resolveFirstCompare(comparisonResult);
    await settle();
    expect(
      flatten(mounted.root).find(
        (node) => node.props["data-testid"] === "variant-tab-create",
      )?.props["aria-pressed"],
    ).toBe(true);
    expect(
      flatten(mounted.root).some(
        (node) => node.props.class === "compare-content",
      ),
    ).toBe(false);

    const returnToListTab = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "variant-tab-list",
    );
    await (returnToListTab!.props.onClick as () => Promise<void>)();
    await settle();
    const compareAgain = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "variant-compare-b",
    );
    await (compareAgain!.props.onClick as () => Promise<void>)();
    await settle();

    expect(api.createProjectVersion).not.toHaveBeenCalled();
    const saveAndPreview = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "variant-av-preview",
    );
    expect(saveAndPreview).toBeDefined();
    await (saveAndPreview!.props.onClick as () => Promise<void>)();
    await settle();

    expect(api.createProjectVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.any(String),
        expectedProjectId: projectId,
        baseRevision: "9".repeat(64),
        requestId: expect.any(String),
      }),
    );
    const createInput = api.createProjectVersion.mock.calls[0]?.[0];
    expect(createInput).toBeDefined();
    const snapshotName = createInput!.name;
    expect(snapshotName?.length).toBeLessThanOrEqual(128);
    expect(snapshotName).not.toMatch(/[\uD800-\uDBFF]$/u);
    const expiredMedia = flatten(mounted.root).find(
      (node) => node.tag === "video",
    );
    expect(expiredMedia).toBeDefined();
    (expiredMedia!.props.onError as () => void)();
    await settle();

    const retry = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "variant-av-retry",
    );
    expect(retry).toBeDefined();
    await (retry!.props.onClick as () => Promise<void>)();
    await settle();

    expect(api.prepareVersionComparison).toHaveBeenCalledTimes(2);
    expect(api.prepareVersionComparison).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId,
        a: { versionId: snapshotId, compositionId: "composition-a" },
        b: { versionId: snapshotId, compositionId: "composition-b" },
      }),
    );
    const firstPrepare = api.prepareVersionComparison.mock.calls[0]?.[0],
      secondPrepare = api.prepareVersionComparison.mock.calls[1]?.[0];
    expect(firstPrepare).toBeDefined();
    expect(secondPrepare).toBeDefined();
    expect(firstPrepare!.requestId).not.toBe(secondPrepare!.requestId);
    expect(api.createProjectVersion).toHaveBeenCalledTimes(1);
    expect(
      flatten(mounted.root).filter((node) => node.tag === "video"),
    ).toHaveLength(2);
    expect(
      flatten(mounted.root)
        .filter((node) => node.tag === "video")
        .map((node) => node.props.src),
    ).toEqual([
      `/api/version-comparisons/${descriptor.id}/media/a?projectId=${projectId}`,
      `/api/version-comparisons/${descriptor.id}/media/b?projectId=${projectId}`,
    ]);
    expect(flatten(mounted.root).some((node) => "clips" in node.props)).toBe(
      false,
    );
    const listTab = flatten(mounted.root).find(
      (node) => node.props["data-testid"] === "variant-tab-list",
    );
    expect(listTab).toBeDefined();
    await (listTab!.props.onClick as () => Promise<void>)();
    await settle();
    expect(
      flatten(mounted.root).some(
        (node) => node.props.class === "compare-content",
      ),
    ).toBe(true);
    expect(
      flatten(mounted.root).some(
        (node) =>
          node.props.role === "alert" &&
          node.props.class === "variant-av-error",
      ),
    ).toBe(true);

    await (listTab!.props.onClick as () => Promise<void>)();
    expect(api.cancelVersionComparison).toHaveBeenCalledWith({
      projectId,
      requestId: expect.any(String),
    });
    expect(api.cancelVersionComparison).toHaveBeenCalledTimes(2);
    expect(
      flatten(mounted.root).some(
        (node) => node.props["data-testid"] === "variant-av-transport",
      ),
    ).toBe(false);
    expect(api.deleteProjectVersion).not.toHaveBeenCalled();
  } finally {
    mounted.unmount();
  }
});
