import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../apps/desktop/src/api";
import en from "../../apps/desktop/src/i18n/locales/en-US";
import zh from "../../apps/desktop/src/i18n/locales/zh-TW";
import ja from "../../apps/desktop/src/i18n/locales/ja-JP";
import { pseudoMessages } from "../../apps/desktop/src/i18n/pseudo";

const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
const vue = requireDesktop("vue");
const { parse, compileScript } = requireDesktop("vue/compiler-sfc");
const { createI18n } = requireDesktop("vue-i18n");
interface HostNode {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
}
function node(tag: string, text = ""): HostNode {
  return { tag, text, props: {}, children: [], parent: null };
}
function flatten(root: HostNode): HostNode[] {
  return [root, ...root.children.flatMap(flatten)];
}
function text(root: HostNode): string {
  return root.text + root.children.map(text).join("");
}
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});

// Compile and mount the actual SFC setup, template, hooks and event handlers.
// Only browser storage, API transport and the renderer's DOM host are supplied.
async function mountReview(
  locale: string,
  messages: typeof en | typeof zh | typeof ja,
) {
  vi.stubGlobal("localStorage", { getItem: () => null });
  const descriptor = {
    id: "remote-script-provider",
    name: "Explicit remote review provider",
    execution: "remote",
    endpoint: "https://review.invalid/declared-destination",
    dataKinds: ["text"],
  };
  let allowed = false;
  const api = {
    reviewProvider: vi.fn(async () => ({
      configured: true,
      available: allowed,
      provider: structuredClone(descriptor),
    })),
    reviewConsent: vi.fn(async (allow: boolean) => {
      allowed = allow;
      return api.reviewProvider();
    }),
    scriptReviewSuggestions: vi.fn(async () => ({
      suggestions: [],
      total: 0,
      offset: 0,
      limit: 10,
      revision: "saved-field",
    })),
    runScriptReview: vi.fn(async () => ({
      job: {
        id: "explicit-job",
        type: "scene-script-review",
        status: "queued",
      },
    })),
  };
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: { [locale]: messages },
  });
  const path = resolve("apps/desktop/src/components/StoryScriptReview.vue");
  const compiled = compileScript(
    parse(readFileSync(path, "utf8"), { filename: path }).descriptor,
    { id: "scene-script-consent", inlineTemplate: true },
  );
  const module = { exports: {} as { default?: object } };
  const dependencies: Record<string, unknown> = {
    vue,
    "vue-i18n": { useI18n: () => ({ t: i18n.global.t }) },
    "../api": { api, ApiError, post: vi.fn() },
    "../i18n": {
      errorDetail: String,
      localizeError: String,
      formatNumber: String,
    },
  };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(compiled.content, { loader: "ts", format: "cjs" }).code,
  )(
    (name: string) => {
      if (!(name in dependencies))
        throw new Error(`Unexpected component dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  const renderer = vue.createRenderer({
    createElement: (tag: string) => node(tag),
    createText: (value: string) => node("#text", value),
    createComment: (value: string) => node("#comment", value),
    setText: (element: HostNode, value: string) => {
      element.text = value;
    },
    setElementText: (element: HostNode, value: string) => {
      element.text = value;
      element.children = [];
    },
    patchProp: (
      element: HostNode,
      key: string,
      _old: unknown,
      value: unknown,
    ) => {
      element.props[key] = value;
    },
    insert: (element: HostNode, parent: HostNode, anchor?: HostNode) => {
      if (element.parent) {
        const index = element.parent.children.indexOf(element);
        if (index >= 0) element.parent.children.splice(index, 1);
      }
      element.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, element);
      else parent.children.push(element);
    },
    remove: (element: HostNode) => {
      const parent = element.parent;
      if (!parent) return;
      const index = parent.children.indexOf(element);
      if (index >= 0) parent.children.splice(index, 1);
      element.parent = null;
    },
    parentNode: (element: HostNode) => element.parent,
    nextSibling: (element: HostNode) =>
      element.parent?.children[element.parent.children.indexOf(element) + 1] ??
      null,
  });
  const root = node("root");
  const prepare = vi.fn(async () => true);
  const storyId = "Legacy story ID: private anniversary note";
  const beatId = "Legacy scene ID: personal memory";
  const app = renderer.createApp(module.exports.default, {
    projectId: "project",
    storyId,
    beatId,
    jobs: [],
    disabled: false,
    prepare,
  });
  app.mount(root);
  cleanup.push(() => app.unmount());
  for (let index = 0; index < 12; index++) await Promise.resolve();
  await vue.nextTick();
  return { root, api, prepare, descriptor, storyId, beatId };
}

describe("scene-script remote consent disclosure", () => {
  it.each([
    ["en-US", en, "story and scene IDs"],
    ["zh-TW", zh, "故事與場景識別碼"],
    ["ja-JP", ja, "ストーリーとシーンのID"],
    ["en-XA", pseudoMessages(en), "støry ánd scënë ÏDs"],
  ] as const)(
    "discloses opaque identifiers before opt-in in %s",
    async (locale, messages, identifiers) => {
      const h = await mountReview(locale, messages);
      const all = flatten(h.root);
      const disclosure = all.find(
        (element) => element.tag === "p" && text(element).includes(identifiers),
      );
      expect(
        disclosure,
        "The visible payload disclosure must identify story and scene IDs before consent",
      ).toBeDefined();
      expect(text(disclosure!)).toBe(messages.scriptReview.dataAccess);
      const grant = all.find(
        (element) =>
          element.tag === "button" &&
          text(element) === messages.scriptReview.grantConsent,
      )!;
      expect(grant).toBeDefined();
      expect(all.indexOf(disclosure!)).toBeLessThan(all.indexOf(grant));
      for (let parent = disclosure!.parent; parent; parent = parent.parent)
        expect(parent.tag).not.toBe("details");
      expect(text(h.root)).toContain(h.descriptor.endpoint);
      expect(text(h.root)).toContain(messages.transcript.dataKinds.text);
      expect(text(h.root)).not.toContain("scriptReview.dataAccess");
      const generate = all.find(
        (element) => element.props["data-testid"] === "script-review-generate",
      )!;
      expect(generate.props.disabled).toBe(true);
      await (generate.props.onClick as () => Promise<void>)();
      expect(h.api.runScriptReview).not.toHaveBeenCalled();
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.api.reviewConsent).not.toHaveBeenCalled();
      await (grant.props.onClick as () => Promise<void>)();
      await vue.nextTick();
      expect(h.api.reviewConsent).toHaveBeenCalledWith(
        true,
        h.descriptor,
        "scene-script",
      );
      expect(h.api.runScriptReview).not.toHaveBeenCalled();
      const enabled = flatten(h.root).find(
        (element) => element.props["data-testid"] === "script-review-generate",
      )!;
      expect(enabled.props.disabled).toBe(false);
      await (enabled.props.onClick as () => Promise<void>)();
      expect(h.api.runScriptReview).toHaveBeenCalledWith(h.storyId, {
        beatId: h.beatId,
        field: "narration",
      });
    },
  );
});
