import { afterEach, expect, it, vi } from "vitest";
import type { CollectCoverageReview } from "@openfilm/application";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host.js";
const stops: Array<() => void> = [];
afterEach(() =>
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop()),
);
const text = (node: HostNode) =>
  flatten(node)
    .map((item) => item.text)
    .join(" ")
    .trim();
function response(
  name: string,
  projectId = "one",
): { review: CollectCoverageReview } {
  return {
    review: {
      coverageId: "c".repeat(64),
      baseline: {
        id: "b".repeat(64),
        projectId,
        revision: "a".repeat(64),
        scope: "current-film",
        storyIds: ["story"],
        compositionIds: ["film"],
        items: [
          {
            resourceId: "asset:clip",
            kind: "media",
            displayName: name,
            rightsDeclared: false,
            status: "blocked",
            issues: ["rights.required"],
          },
        ],
        complete: false,
        totalBytes: 100,
        uniqueMediaBytes: 100,
        versionsIncluded: false,
        issues: [],
      },
      coverage: {
        version: 1,
        projectId,
        revision: "a".repeat(64),
        baselinePlanId: "b".repeat(64),
        mode: "trimmed-originals",
        handlesSeconds: 2,
        status: "review-only",
        executable: false,
        quality: "requires-lossless-parity",
        entries: [
          {
            assetId: "clip",
            action: "trim-candidate",
            uses: [],
            ranges: [{ start: 0, end: 3 }],
            reasons: [],
            sourceDuration: 5,
            retainedSeconds: 3,
            removedSeconds: 2,
          },
        ],
      },
    },
  };
}
type Read = (
  body: unknown,
  signal: AbortSignal,
) => Promise<{ review: CollectCoverageReview }>;
async function fixture(read = vi.fn<Read>(async () => response("Synthetic"))) {
  const create = vi.fn();
  const component = loadComponent(
    "apps/desktop/src/components/CollectCoverageReview.vue",
    {
      "vue-i18n": {
        useI18n: () => ({ t: (key: string) => key, locale: vue.ref("zh-TW") }),
      },
      "../api": {
        api: { collectCoverage: read, createCollectedMedia: create },
      },
      "../i18n": { localizeError: (cause: unknown) => String(cause) },
    },
  );
  const busy = vi.fn();
  const props = vue.shallowReactive({
    request: {
      projectId: "one",
      scope: "current-film" as const,
      compositionId: "film",
    },
    disabled: false,
    onBusy: busy,
  });
  const mounted = mountComponent(component, props);
  stops.push(mounted.unmount);
  await vue.nextTick();
  const button = (key: string) =>
    flatten(mounted.root).find(
      (node) => node.tag === "button" && text(node) === key,
    );
  const click = async (key: string) => {
    const node = button(key);
    expect(node, key).toBeDefined();
    expect(node!.props.disabled).not.toBe(true);
    if (node!.props.onClick)
      await (node!.props.onClick as () => Promise<void>)();
    else
      await (
        flatten(mounted.root).find((element) => element.tag === "form")!.props
          .onSubmit as (event: unknown) => Promise<void>
      )({ preventDefault() {}, stopPropagation() {} });
    await vue.nextTick();
  };
  return { ...mounted, props, busy, read, create, button, click };
}
it("requests a read-only range review with default two-second handles and never creates a derivative package", async () => {
  const f = await fixture();
  await f.click("collectDelivery.review");
  expect(f.read).toHaveBeenCalledWith(
    {
      ...f.props.request,
      delivery: { version: 1, mode: "trimmed-originals", handlesSeconds: 2 },
    },
    expect.any(AbortSignal),
  );
  expect(text(f.root)).toContain("Synthetic");
  expect(text(f.root)).toContain("collectDelivery.planningOnly");
  expect(f.create).not.toHaveBeenCalled();
  expect(f.busy.mock.calls).toEqual([[true], [false]]);
});
it("requires an explicit quality acceptance and clears it when the delivery changes", async () => {
  const f = await fixture(
    vi.fn(async () => {
      const result = response("Synthetic");
      result.review.baseline.complete = true;
      return result;
    }),
  );
  await f.click("collectDelivery.review");
  expect(f.button("collectDelivery.create")!.props.disabled).toBe(true);
  const checkbox = flatten(f.root).find(
    (node) => node.tag === "input" && node.props.type === "checkbox",
  );
  expect(checkbox).toBeDefined();
  (checkbox!.props.onChange as (event: unknown) => void)({
    target: { checked: true },
  });
  await vue.nextTick();
  expect(f.button("collectDelivery.create")!.props.disabled).toBe(false);
  f.props.request = { ...f.props.request, projectId: "two" };
  await vue.nextTick();
  expect(f.button("collectDelivery.create")).toBeUndefined();
  expect(f.create).not.toHaveBeenCalled();
});
it("requires new acceptance when a fresh revision is reviewed with unchanged request props", async () => {
  let count = 0;
  const f = await fixture(
    vi.fn(async () => {
      const result = response(`Review ${++count}`);
      result.review.baseline.complete = true;
      result.review.coverageId = String(count).repeat(64);
      result.review.baseline.revision = String(count).repeat(64);
      return result;
    }),
  );
  await f.click("collectDelivery.review");
  let checkbox = flatten(f.root).find(
    (node) => node.tag === "input" && node.props.type === "checkbox",
  )!;
  (checkbox.props.onChange as (event: unknown) => void)({
    target: { checked: true },
  });
  await vue.nextTick();
  expect(f.button("collectDelivery.create")!.props.disabled).toBe(false);
  await f.click("collectDelivery.review");
  checkbox = flatten(f.root).find(
    (node) => node.tag === "input" && node.props.type === "checkbox",
  )!;
  expect(checkbox.props.checked).toBe(false);
  expect(f.button("collectDelivery.create")!.props.disabled).toBe(true);
  expect(f.create).not.toHaveBeenCalled();
});
it("aborts and discards a late review after the project changes", async () => {
  let finish!: (value: { review: CollectCoverageReview }) => void;
  const read = vi.fn<Read>(
    () =>
      new Promise<{ review: CollectCoverageReview }>((resolve) => {
        finish = resolve;
      }),
  );
  const f = await fixture(read);
  const pending = f.click("collectDelivery.review");
  await vue.nextTick();
  const signal = read.mock.calls[0]![1] as AbortSignal;
  f.props.request = { ...f.props.request, projectId: "two" };
  await vue.nextTick();
  expect(signal.aborted).toBe(true);
  finish(response("OLD PROJECT"));
  await pending;
  expect(text(f.root)).not.toContain("OLD PROJECT");
  expect(f.button("collectDelivery.review")!.props.disabled).not.toBe(true);
});
it("keeps a newer review busy when an old cancelled request finishes", async () => {
  const finish: Array<(value: { review: CollectCoverageReview }) => void> = [];
  const read = vi.fn<Read>(
    () =>
      new Promise<{ review: CollectCoverageReview }>((resolve) =>
        finish.push(resolve),
      ),
  );
  const f = await fixture(read);
  const first = f.click("collectDelivery.review");
  await vue.nextTick();
  await f.click("collectDelivery.cancel");
  const second = f.click("collectDelivery.review");
  await vue.nextTick();
  finish[0]!(response("OLD"));
  await first;
  expect(f.button("collectDelivery.cancel")).toBeDefined();
  expect(f.button("collectDelivery.review")!.props.disabled).toBe(true);
  finish[1]!(response("NEW"));
  await second;
  expect(text(f.root)).toContain("NEW");
  expect(text(f.root)).not.toContain("OLD");
});
it("keeps each native label limited to its control caption", async () => {
  const f = await fixture();
  const label = flatten(f.root).find(
    (node) =>
      node.tag === "label" && text(node).includes("collectDelivery.mode"),
  );
  expect(label).toBeDefined();
  expect(text(label!)).toBe("collectDelivery.mode");
});
