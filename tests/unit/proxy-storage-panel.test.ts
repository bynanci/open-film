import { afterEach, expect, it, vi } from "vitest";
import type { ProxyCacheHealth, ProxyCleanupPreview } from "@openfilm/core";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host.js";
const stops: Array<() => void> = [];
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.restoreAllMocks();
});
const health = (projectId = "one"): ProxyCacheHealth => ({
  version: 1,
  projectId,
  policy: { version: 1, revision: 0, quotaBytes: 5 * 1024 ** 3 },
  managedBytes: 1024,
  unmanagedBytes: 0,
  temporaryBytes: 0,
  inventoryComplete: true,
  running: false,
  queued: 0,
  entries: [
    {
      assetId: "clip",
      name: "合成影片",
      status: "missing",
      protected: false,
      verification: "unchecked",
    },
  ],
  total: 1,
  offset: 0,
  hasNext: false,
});
const text = (node: HostNode) =>
  flatten(node)
    .map((child) => child.text)
    .join(" ")
    .trim();
async function fixture(overrides: Record<string, unknown> = {}) {
  const read = vi.fn(async (projectId: string) => ({
    health: health(projectId),
  }));
  const write = vi.fn(async () => ({}));
  const api = {
    proxyCache: read,
    proxyQueue: write,
    proxyRun: write,
    proxyCancel: write,
    proxyResume: write,
    proxyVerify: write,
    proxyPolicy: write,
    proxyCleanupPreview: write,
    proxyCleanupAccept: write,
    proxyRecover: write,
    ...overrides,
  };
  const component = loadComponent(
    "apps/desktop/src/components/ProxyStoragePanel.vue",
    {
      "vue-i18n": {
        useI18n: () => ({ t: (key: string) => key, locale: vue.ref("zh-TW") }),
      },
      "../api": { api },
      "../i18n": { localizeError: (error: unknown) => String(error) },
    },
  );
  const changed = vi.fn();
  const props = vue.shallowReactive({
    projectId: "one",
    dependencyVersion: "first",
    disabled: false,
    onChanged: changed,
  });
  const mounted = mountComponent(component, props);
  stops.push(mounted.unmount);
  await vue.nextTick();
  await Promise.resolve();
  await vue.nextTick();
  const click = async (key: string) => {
    const button = flatten(mounted.root).find(
      (node) => node.tag === "button" && text(node) === key,
    );
    expect(button, key).toBeDefined();
    expect(button!.props.disabled).not.toBe(true);
    await (button!.props.onClick as () => Promise<void>)();
    await vue.nextTick();
  };
  return { ...mounted, props, api, changed, click };
}
it("discards an older project's health response and aborts it on switch", async () => {
  let finish!: (value: { health: ProxyCacheHealth }) => void;
  let oldSignal: AbortSignal | undefined;
  const read = vi.fn((id: string, _offset: number, signal: AbortSignal) => {
    if (id === "one") {
      oldSignal = signal;
      return new Promise<{ health: ProxyCacheHealth }>((resolve) => {
        finish = resolve;
      });
    }
    return Promise.resolve({ health: health("two") });
  });
  const f = await fixture({ proxyCache: read });
  f.props.projectId = "two";
  await vue.nextTick();
  await Promise.resolve();
  await vue.nextTick();
  expect(oldSignal?.aborted).toBe(true);
  finish({
    health: {
      ...health(),
      entries: [{ ...health().entries[0]!, name: "OLD PROJECT" }],
    },
  });
  await Promise.resolve();
  await vue.nextTick();
  expect(text(f.root)).not.toContain("OLD PROJECT");
  expect(f.changed).not.toHaveBeenCalled();
});
it("requires a native checkbox before accepting the exact cleanup preview", async () => {
  const preview: ProxyCleanupPreview = {
    version: 1,
    projectId: "one",
    previewId: "review",
    fingerprint: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    entries: [
      {
        artifactId: "b".repeat(64),
        assetId: "clip",
        name: "合成影片",
        byteLength: 1024,
      },
    ],
    bytes: 1024,
    hasMore: false,
    protectedCount: 0,
  };
  const accept = vi.fn(async () => ({
    result: {
      removedBytes: 1024,
      removedArtifactIds: ["b".repeat(64)],
      failedArtifactIds: [],
    },
  }));
  const f = await fixture({
    proxyCleanupPreview: async () => ({ result: preview }),
    proxyCleanupAccept: accept,
  });
  await f.click("proxyStorage.previewCleanup");
  const button = flatten(f.root).find(
    (node) =>
      node.tag === "button" && text(node) === "proxyStorage.acceptCleanup",
  );
  expect(button!.props.disabled).toBe(true);
  expect(accept).not.toHaveBeenCalled();
  const check = flatten(f.root).find(
    (node) => node.tag === "input" && node.props.type === "checkbox",
  )!;
  (check.props["onUpdate:modelValue"] as (value: boolean) => void)(true);
  await vue.nextTick();
  await f.click("proxyStorage.acceptCleanup");
  expect(accept).toHaveBeenCalledWith(
    {
      projectId: "one",
      previewId: "review",
      fingerprint: preview.fingerprint,
      confirmed: true,
    },
    expect.any(AbortSignal),
  );
  expect(f.changed).toHaveBeenCalledWith("one");
});
it("keeps cancellation usable while a verification request is pending", async () => {
  let finish!: (value: unknown) => void;
  const verify = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const cancel = vi.fn(async () => ({ jobs: [] }));
  const f = await fixture({ proxyVerify: verify, proxyCancel: cancel });
  const pending = f.click("proxyStorage.verify");
  await vue.nextTick();
  await f.click("proxyStorage.cancel");
  expect(cancel).toHaveBeenCalled();
  finish({ result: { results: [] } });
  await pending;
});
