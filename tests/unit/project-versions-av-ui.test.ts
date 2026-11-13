import { expect, it, vi } from "vitest";
import type {
  ProjectVersionPreviewTargets,
  VersionComparisonPreviewDescriptor,
} from "@openfilm/application";
import type { Job } from "@openfilm/core";
import { VersionComparisonPlayback } from "../../apps/desktop/src/versionComparisonPlayback.js";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host.js";

const projectId = "project",
  versionA = "11111111-1111-4111-8111-111111111111",
  versionB = "22222222-2222-4222-8222-222222222222",
  compositionId = "edit";
class FakeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
const targets = (versionId: string, name: string) =>
  ({
    projectId,
    versionId,
    name,
    projectHash: "a".repeat(64),
    catalogHash: "b".repeat(64),
    identity: "c".repeat(64),
    compositions: [
      {
        id: compositionId,
        storyId: "story",
        title: name,
        duration: 1,
        frameRate: 24,
      },
    ],
  }) satisfies ProjectVersionPreviewTargets;
const descriptor = {
  version: 1,
  id: "33333333-3333-4333-8333-333333333333",
  projectId,
  expiresAt: "2030-01-01T00:00:00.000Z",
  a: {
    versionId: versionA,
    versionName: "A",
    projectHash: "a".repeat(64),
    catalogHash: "b".repeat(64),
    snapshotIdentity: "c".repeat(64),
    compositionId,
    compositionSha256: "d".repeat(64),
    settingsSha256: "e".repeat(64),
    sourceKeyDigest: "f".repeat(64),
    compositionDuration: 1,
    duration: 1,
    frameRate: 24,
    hasAudio: true,
    sha256: "1".repeat(64),
    bytes: 1000,
    warnings: [],
  },
  b: {
    versionId: versionB,
    versionName: "B",
    projectHash: "2".repeat(64),
    catalogHash: "3".repeat(64),
    snapshotIdentity: "4".repeat(64),
    compositionId,
    compositionSha256: "5".repeat(64),
    settingsSha256: "6".repeat(64),
    sourceKeyDigest: "7".repeat(64),
    compositionDuration: 1,
    duration: 1,
    frameRate: 24,
    hasAudio: true,
    sha256: "8".repeat(64),
    bytes: 1000,
    warnings: [],
  },
} satisfies VersionComparisonPreviewDescriptor;
function setup(api: Record<string, unknown>) {
  const component = loadComponent(
    "apps/desktop/src/components/ProjectVersionsPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../i18n": { localizeError: (error: unknown) => String(error) },
      "../api": {
        ApiError: FakeApiError,
        api,
        versionComparisonMediaUrl: (
          id: string,
          side: "a" | "b",
          owner: string,
        ) => `/api/version-comparisons/${id}/media/${side}?projectId=${owner}`,
      },
      "../versionComparisonPlayback": { VersionComparisonPlayback },
    },
  );
  const mounted = mountComponent(component, { projectId, disabled: false });
  return { mounted, nodes: () => flatten(mounted.root) };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await vue.nextTick();
  await Promise.resolve();
  await vue.nextTick();
}
function fixtureApi(overrides: Record<string, unknown> = {}) {
  return {
    projectVersions: vi.fn(async () => ({
      versions: [
        { id: versionB, name: "B", createdAt: "2026-11-13T00:00:00Z" },
        { id: versionA, name: "A", createdAt: "2026-11-12T00:00:00Z" },
      ],
    })),
    diffProjectVersions: vi.fn(async () => ({ diff: { entries: [] } })),
    versionPreviewTargets: vi.fn(async (id: string) => ({
      targets: targets(id, id === versionA ? "A" : "B"),
    })),
    jobs: vi.fn(async (): Promise<{ jobs: Job[] }> => ({ jobs: [] })),
    prepareVersionComparison: vi.fn(async () => descriptor),
    cancelVersionComparison: vi.fn(async () => ({ ok: true })),
    projectVersionRevision: vi.fn(async () => ({
      projectId,
      revision: "a".repeat(64),
    })),
    ...overrides,
  };
}

it("prepares real snapshot media through the API and never writes a clip array", async () => {
  const api = fixtureApi(),
    mountedHost = setup(api);
  try {
    await settle();
    const prepare = mountedHost
      .nodes()
      .find((node) => node.props["data-testid"] === "comparison-prepare")!;
    await (prepare.props.onClick as () => Promise<void>)();
    await settle();
    expect(api.prepareVersionComparison).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        a: { versionId: versionA, compositionId },
        b: { versionId: versionB, compositionId },
      }),
    );
    const videos = mountedHost.nodes().filter((node) => node.tag === "video");
    expect(videos).toHaveLength(2);
    expect(videos.map((video) => video.props.src)).toEqual([
      `/api/version-comparisons/${descriptor.id}/media/a?projectId=${projectId}`,
      `/api/version-comparisons/${descriptor.id}/media/b?projectId=${projectId}`,
    ]);
    expect(mountedHost.nodes().some((node) => "clips" in node.props)).toBe(
      false,
    );
  } finally {
    mountedHost.mounted.unmount();
  }
});

it("waits for cancel acknowledgement, unloads both sources, and ignores a late prepare response", async () => {
  let finishPrepare!: (value: VersionComparisonPreviewDescriptor) => void,
    acknowledgeCancel!: (value: { ok: true }) => void;
  const api = fixtureApi({
    prepareVersionComparison: vi.fn(
      () =>
        new Promise<VersionComparisonPreviewDescriptor>(
          (resolve) => (finishPrepare = resolve),
        ),
    ),
    cancelVersionComparison: vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => (acknowledgeCancel = resolve)),
    ),
  });
  const mountedHost = setup(api);
  try {
    await settle();
    const prepare = mountedHost
      .nodes()
      .find((node) => node.props["data-testid"] === "comparison-prepare")!;
    const preparing = (prepare.props.onClick as () => Promise<void>)();
    await settle();
    const cancel = mountedHost
      .nodes()
      .find((node) => node.props["data-testid"] === "comparison-cancel")!;
    const cancelling = (cancel.props.onClick as () => Promise<boolean>)();
    await settle();
    expect(cancel.props.disabled).toBe(true);
    expect(api.cancelVersionComparison).toHaveBeenCalledOnce();
    acknowledgeCancel({ ok: true });
    await cancelling;
    finishPrepare(descriptor);
    await preparing;
    await settle();
    expect(mountedHost.nodes().some((node) => node.tag === "video")).toBe(
      false,
    );
    expect(
      mountedHost
        .nodes()
        .map((node) => node.text)
        .join(" "),
    ).toContain("app.versions.previewStatus.cancelled");
  } finally {
    mountedHost.mounted.unmount();
  }
});

it("does not offer a cancel action for a job owned by another process", async () => {
  const api = fixtureApi();
  api.prepareVersionComparison = vi.fn(async () => {
    throw new FakeApiError("already running", 409, "jobs.busy");
  });
  api.jobs = vi.fn(async (): Promise<{ jobs: Job[] }> => ({
    jobs: [
      {
        id: "foreign",
        type: "render",
        stage: "version-comparison-preview",
        status: "running",
        progress: 0.5,
      },
    ],
  }));
  const mountedHost = setup(api);
  try {
    await settle();
    const prepare = mountedHost
      .nodes()
      .find((node) => node.props["data-testid"] === "comparison-prepare")!;
    await (prepare.props.onClick as () => Promise<void>)();
    await settle();
    expect(
      mountedHost
        .nodes()
        .some((node) => node.props["data-testid"] === "comparison-cancel"),
    ).toBe(false);
    expect(
      mountedHost
        .nodes()
        .some((node) => node.props["data-testid"] === "comparison-retry"),
    ).toBe(true);
  } finally {
    mountedHost.mounted.unmount();
  }
});
