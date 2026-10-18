import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import en from "../../apps/desktop/src/i18n/modules/editor/en-US";
import zh from "../../apps/desktop/src/i18n/modules/editor/zh-TW";
import ja from "../../apps/desktop/src/i18n/modules/editor/ja-JP";
import { pseudoMessages } from "../../apps/desktop/src/i18n/pseudo";

const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
interface HostNode {
  tag: string;
  tagName: string;
  text: string;
  value: unknown;
  selected: boolean;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  options: HostNode[];
  addEventListener: () => void;
  removeEventListener: () => void;
  getRootNode: () => unknown;
}
interface HostApp {
  mount: (root: HostNode) => void;
  unmount: () => void;
}
const vue = requireDesktop("vue") as Record<string, unknown> & {
  createRenderer: (host: object) => {
    createApp: (component: object) => HostApp;
  };
  reactive: <T extends object>(value: T) => T;
  h: (component: object, props: object) => object;
  nextTick: () => Promise<void>;
};
const compiler = requireDesktop("vue/compiler-sfc") as {
  parse: (source: string, options: object) => { descriptor: unknown };
  compileScript: (descriptor: unknown, options: object) => { content: string };
};
const { createI18n } = requireDesktop("vue-i18n") as {
  createI18n: (options: object) => { global: { t: (key: string) => string } };
};
function node(tag: string, text = ""): HostNode {
  return {
    tag,
    tagName: tag.toUpperCase(),
    text,
    value: "",
    selected: false,
    props: {},
    children: [],
    parent: null,
    get options() {
      return this.children
        .flatMap(flatten)
        .filter((item) => item.tag === "option");
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getRootNode: () => document,
  };
}
function flatten(value: HostNode): HostNode[] {
  return [value, ...value.children.flatMap(flatten)];
}
function text(value: HostNode): string {
  return value.text + value.children.map(text).join("");
}
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});

const legacy: core.Clip = {
  id: "clip",
  assetId: "photo",
  timelineStart: 0,
  timelineDuration: 8,
  title: "我們的故事 Our story",
  titleStyle: { version: 1, role: "subtitle", tracking: 50 },
};

async function mount(locale = "en-US", messages: object = en, clip = legacy) {
  class HostDocument {
    activeElement = null;
  }
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  const path = resolve(
    "apps/desktop/src/components/PhotoPresentationInspector.vue",
  );
  const compiled = compiler.compileScript(
    compiler.parse(readFileSync(path, "utf8"), { filename: path }).descriptor,
    { id: "title-style-recovery", inlineTemplate: true },
  );
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: { [locale]: messages },
  });
  const module = { exports: {} as { default?: object } };
  const dependencies: Record<string, unknown> = {
    vue,
    "vue-i18n": { useI18n: () => ({ t: i18n.global.t }) },
    "@openfilm/core": core,
  };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(compiled.content, { loader: "ts", format: "cjs" }).code,
  )(
    (name: string) => {
      if (!(name in dependencies))
        throw new Error(`Unexpected Inspector dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  const props = vue.reactive({
    clip: structuredClone(clip),
    asset: {
      id: "photo",
      name: "Photo",
      uri: "file:///original/photo.jpg",
      mediaType: "image",
      dimensions: { width: 640, height: 360 },
      state: {},
      metadata: {},
      tags: [],
    } as core.MediaAsset,
    assets: [] as core.MediaAsset[],
    frame: { width: 1280, height: 720, frameRate: 30 },
  });
  props.assets = [props.asset];
  const commands: TimelineCommand[] = [];
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
      _previous: unknown,
      value: unknown,
    ) => {
      element.props[key] = value;
      if (key === "value") element.value = value;
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
      if (!element.parent) return;
      const index = element.parent.children.indexOf(element);
      if (index >= 0) element.parent.children.splice(index, 1);
      element.parent = null;
    },
    parentNode: (element: HostNode) => element.parent,
    nextSibling: (element: HostNode) =>
      element.parent?.children[element.parent.children.indexOf(element) + 1] ??
      null,
  });
  const root = node("root");
  const app = renderer.createApp({
    render: () =>
      vue.h(module.exports.default!, {
        ...props,
        onCommand: (command: TimelineCommand) => commands.push(command),
      }),
  });
  cleanup.push(() => app.unmount());
  app.mount(root);
  await vue.nextTick();
  const label = (key: string) => i18n.global.t(key);
  const reset = () =>
    flatten(root).find(
      (item) =>
        item.tag === "button" &&
        text(item) === label("editor.presentation.resetTitleStyle"),
    );
  const editText = async (value: string) => {
    const textarea = flatten(root).find((item) => item.tag === "textarea")!;
    (textarea.props["onUpdate:modelValue"] as (value: string) => void)(value);
    await vue.nextTick();
    (textarea.props.onChange as () => void)();
  };
  return {
    root,
    props,
    commands,
    label,
    reset,
    editText,
    update: async (value: core.Clip) => {
      props.clip = structuredClone(value);
      await vue.nextTick();
    },
  };
}

describe("recoverable legacy title styles", () => {
  it("places a title above faces without losing its typography or fades", async () => {
    const clip: core.Clip = {
      ...legacy,
      titleStyle: {
        version: 1,
        role: "subtitle",
        fontSize: 44,
        fontWeight: 700,
        fadeIn: 0.2,
        fadeOut: 0.3,
        bottomInset: 0.15,
      },
    };
    const mounted = await mount("en-US", en, clip);
    const select = flatten(mounted.root).find(
      (item) =>
        item.props["aria-label"] ===
        mounted.label("editor.presentation.titlePosition"),
    )!;
    const top = select.options.find((option) => option.value === "top");
    expect(
      top,
      "Top placement must be available to avoid covering faces",
    ).toBeDefined();
    (select.props["onUpdate:modelValue"] as (value: string) => void)("top");
    await vue.nextTick();
    (select.props.onChange as () => void)();
    expect(mounted.commands.at(-1)).toMatchObject({
      type: "presentation",
      titleStyle: { ...clip.titleStyle, position: "top" },
    });
  });

  it("edits typography, fades and percent inset without dropping other authored fields", async () => {
    const clip: core.Clip = {
      ...legacy,
      titleStyle: {
        version: 1,
        role: "subtitle",
        fontFamily: "Microsoft JhengHei",
        fontSize: 40,
        fontWeight: 700,
        tracking: 1,
        lineHeight: 1.25,
        maxWidth: 900,
        position: "center",
        background: "none",
        fadeIn: 0.2,
        fadeOut: 0.3,
        bottomInset: 0.15,
      },
    };
    const mounted = await mount("en-US", en, clip);
    const edits = [
      ["titleFontSize", "fontSize", 44, 44],
      ["titleFontWeight", "fontWeight", 600, 600],
      ["titleFadeIn", "fadeIn", 0.4, 0.4],
      ["titleFadeOut", "fadeOut", 0.5, 0.5],
      ["titleBottomInset", "bottomInset", 20, 0.2],
    ] as const;
    let acknowledged = clip;
    for (const [label, field, entered, expected] of edits) {
      const input = flatten(mounted.root).find(
        (item) =>
          item.props["aria-label"] ===
          mounted.label(`editor.presentation.${label}`),
      );
      expect(input, `Missing editable ${field} control`).toBeDefined();
      (input!.props["onUpdate:modelValue"] as (value: number) => void)(entered);
      await vue.nextTick();
      (input!.props.onChange as () => void)();
      const command = mounted.commands.at(-1);
      expect(command).toEqual({
        type: "presentation",
        clipId: clip.id,
        title: clip.title,
        titleStyle: { ...acknowledged.titleStyle, [field]: expected },
      });
      acknowledged = {
        ...acknowledged,
        titleStyle: { ...acknowledged.titleStyle!, [field]: expected },
      };
      await mounted.update(acknowledged);
    }
    // Undo/Redo delivers saved immutable clip snapshots, not stale local fields.
    await mounted.update(clip);
    const inset = flatten(mounted.root).find(
      (item) =>
        item.props["aria-label"] ===
        mounted.label("editor.presentation.titleBottomInset"),
    )!;
    expect(inset.value).toBe(15);
  });

  it.each([
    ["en-US", en],
    ["zh-TW", zh],
    ["ja-JP", ja],
    ["en-XA", pseudoMessages(en)],
  ] as const)(
    "mounts a localized recovery state without modifying authored data in %s",
    async (locale, messages) => {
      const mounted = await mount(locale, messages);
      expect(text(mounted.root)).toContain(
        mounted.label("editor.presentation.titleStyleRecoveryWarning"),
      );
      expect(mounted.reset()).toBeDefined();
      expect(mounted.commands).toEqual([]);
      expect(mounted.props.clip).toEqual(legacy);
      const titleControls = flatten(mounted.root).filter(
        (item) =>
          item.tag === "select" &&
          [
            "editor.presentation.titleRole",
            "editor.presentation.titlePosition",
            "editor.presentation.titleBackground",
          ].some((key) => item.props["aria-label"] === mounted.label(key)),
      );
      expect(titleControls).toHaveLength(3);
      expect(titleControls.every((item) => item.props.disabled)).toBe(true);
    },
  );

  it("survives valid to legacy watcher updates, explicit reset, and Undo into the legacy style", async () => {
    const valid = {
      ...legacy,
      titleStyle: {
        version: 1 as const,
        role: "subtitle" as const,
        tracking: 1,
      },
    };
    const mounted = await mount("en-US", en, valid);
    expect(mounted.reset()).toBeUndefined();
    await mounted.update(legacy);
    expect(mounted.reset()).toBeDefined();
    (mounted.reset()!.props.onClick as () => void)();
    expect(mounted.commands).toEqual([
      { type: "presentation", clipId: legacy.id, titleStyle: null },
    ]);
    const reset = { ...legacy };
    delete reset.titleStyle;
    await mounted.update(reset);
    expect(mounted.reset()).toBeUndefined();
    expect(mounted.props.clip.title).toBe(legacy.title);
    await mounted.update(legacy);
    expect(mounted.reset()).toBeDefined();
    expect(mounted.props.clip.titleStyle).toEqual(legacy.titleStyle);
    expect(mounted.commands).toHaveLength(1);
  });

  it("keeps text corrections and clear accessible while requiring explicit style reset", async () => {
    const mounted = await mount();
    await mounted.editText("更好的文字");
    expect(mounted.commands[0]).toEqual({
      type: "presentation",
      clipId: legacy.id,
      title: "更好的文字",
    });
    expect(mounted.props.clip.titleStyle).toEqual(legacy.titleStyle);
    await mounted.editText("");
    expect(mounted.commands[1]).toEqual({
      type: "presentation",
      clipId: legacy.id,
      title: null,
      titleStyle: null,
    });
  });

  it.each(["clip", "asset"] as const)(
    "does not reset a %s-locked title",
    async (lock) => {
      const mounted = await mount(
        "en-US",
        en,
        lock === "clip" ? { ...legacy, locked: true } : legacy,
      );
      if (lock === "asset") {
        mounted.props.asset.state.locked = true;
        await vue.nextTick();
      }
      expect(mounted.reset()!.props.disabled).toBe(true);
      (mounted.reset()!.props.onClick as () => void)();
      expect(mounted.commands).toEqual([]);
      expect(mounted.props.clip.titleStyle).toEqual(legacy.titleStyle);
    },
  );
});
