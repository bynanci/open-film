import { readFileSync } from "node:fs";
import { loadComponent } from "./helpers/vue-sfc-host";
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
  selectedIndex: number;
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
    selectedIndex: -1,
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
  dependencies["./BilingualTextControls.vue"] = loadComponent(
    "apps/desktop/src/components/BilingualTextControls.vue",
    dependencies,
  );
  dependencies["./TitleFinishingControls.vue"] = loadComponent(
    "apps/desktop/src/components/TitleFinishingControls.vue",
    dependencies,
  );
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
    allowPhotoPresentation: true,
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
    control: (key: string) =>
      flatten(root).find((item) => item.props["aria-label"] === label(key)),
    reset,
    editText,
    update: async (value: core.Clip) => {
      props.clip = structuredClone(value);
      await vue.nextTick();
    },
  };
}

describe("recoverable legacy title styles", () => {
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
          ["select", "input"].includes(item.tag) &&
          [
            "editor.presentation.titleRole",
            "editor.presentation.titlePosition",
            "editor.presentation.titleBackground",
            "editor.presentation.titleFontWeight",
            "editor.presentation.titleFontSize",
            "editor.presentation.titleFadeOut",
            "editor.presentation.titleBottomSafeMargin",
          ].some((key) => item.props["aria-label"] === mounted.label(key)),
      );
      expect(titleControls).toHaveLength(7);
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

describe("native text timing and bottom placement", () => {
  const valid: core.Clip = {
    ...legacy,
    titleStyle: { version: 1, role: "subtitle" },
  };
  it.each([
    ["en-US", en],
    ["zh-TW", zh],
    ["ja-JP", ja],
    ["en-XA", pseudoMessages(en)],
  ] as const)(
    "exposes defaults without persisting them in %s",
    async (locale, messages) => {
      const mounted = await mount(locale, messages, valid);
      expect(mounted.control("editor.presentation.titleFadeOut")?.value).toBe(
        0,
      );
      expect(
        mounted.control("editor.presentation.titleFontWeight")?.options[
          mounted.control("editor.presentation.titleFontWeight")!.selectedIndex
        ]?.value,
      ).toBe(400);
      expect(
        mounted.control("editor.presentation.titleBottomSafeMargin")?.value,
      ).toBe(8);
      expect(mounted.control("editor.presentation.titleFontSize")?.value).toBe(
        25.92,
      );
      expect(mounted.commands).toEqual([]);
      expect(mounted.props.clip.titleStyle).toEqual(valid.titleStyle);
    },
  );
  it("stores seconds and normalized margin independently, then follows history and clip changes", async () => {
    const mounted = await mount("en-US", en, valid);
    const set = async (key: string, value: number) => {
      const control = mounted.control(key)!;
      (control.props["onUpdate:modelValue"] as (value: number) => void)(value);
      await vue.nextTick();
      (control.props.onChange as () => void)();
    };
    await set("editor.presentation.titleFadeOut", 1.5);
    expect(mounted.commands[0]).toMatchObject({
      titleStyle: { version: 1, role: "subtitle", fadeOut: 1.5 },
    });
    expect(
      (mounted.commands[0] as { titleStyle: object }).titleStyle,
    ).not.toHaveProperty("bottomSafeMargin");
    await mounted.update({
      ...valid,
      titleStyle: { ...valid.titleStyle!, fadeOut: 1.5 },
    });
    await set("editor.presentation.titleBottomSafeMargin", 12);
    expect(mounted.commands[1]).toMatchObject({
      titleStyle: {
        version: 1,
        role: "subtitle",
        fadeOut: 1.5,
        bottomSafeMargin: 0.12,
      },
    });
    await mounted.update({
      ...valid,
      titleStyle: {
        ...valid.titleStyle!,
        fadeOut: 1.5,
        bottomSafeMargin: 0.12,
      },
    });
    await mounted.update(valid);
    expect(mounted.control("editor.presentation.titleFadeOut")?.value).toBe(0);
    expect(
      mounted.control("editor.presentation.titleBottomSafeMargin")?.value,
    ).toBe(8);
    await mounted.update({
      ...valid,
      id: "another",
      titleStyle: {
        version: 1,
        role: "film-title",
        position: "center",
        fadeOut: 0.4,
        bottomSafeMargin: 0.2,
      },
    });
    expect(mounted.control("editor.presentation.titleFadeOut")?.value).toBe(
      0.4,
    );
    expect(
      mounted.control("editor.presentation.titleBottomSafeMargin"),
    ).toBeUndefined();
    expect(mounted.commands).toHaveLength(2);
  });
  it("preserves a saved custom weight until the person explicitly chooses bold", async () => {
    const custom = {
      ...valid,
      titleStyle: { ...valid.titleStyle!, fontWeight: 500 },
    };
    const mounted = await mount("en-US", en, custom);
    const control = mounted.control("editor.presentation.titleFontWeight")!;
    expect(control.options[control.selectedIndex]?.value).toBe(500);
    expect(
      control.options.some((option) => Number(option.props.value) === 500),
    ).toBe(true);
    expect(mounted.commands).toEqual([]);
    (control.props["onUpdate:modelValue"] as (value: number) => void)(700);
    await vue.nextTick();
    (control.props.onChange as () => void)();
    expect(mounted.commands).toEqual([
      {
        type: "presentation",
        clipId: valid.id,
        title: valid.title,
        titleStyle: { ...custom.titleStyle, fontWeight: 700 },
      },
    ]);
  });
  it("follows implicit role/frame defaults but preserves authored fractional sizes until explicitly reset", async () => {
    const mounted = await mount("en-US", en, valid);
    const size = () => mounted.control("editor.presentation.titleFontSize")!;
    expect(size().value).toBe(25.92);
    await mounted.update({
      ...valid,
      titleStyle: { version: 1, role: "film-title" },
    });
    expect(size().value).toBe(54);
    mounted.props.frame.height = 1080;
    await vue.nextTick();
    expect(size().value).toBe(81);
    const custom = {
      ...valid,
      titleStyle: {
        version: 1 as const,
        role: "subtitle" as const,
        fontSize: 53.125675,
        fontWeight: 700,
        fadeOut: 1,
        bottomSafeMargin: 0.12,
      },
    };
    await mounted.update(custom);
    expect(size().value).toBe(53.125675);
    await mounted.update({
      ...custom,
      titleStyle: { ...custom.titleStyle, role: "scene-statement" },
    });
    expect(size().value).toBe(53.125675);
    mounted.props.frame.height = 720;
    await vue.nextTick();
    expect(size().value).toBe(53.125675);
    expect(mounted.commands).toEqual([]);
    const reset = flatten(mounted.root).find(
      (item) =>
        item.tag === "button" &&
        text(item) ===
          mounted.label("editor.presentation.titleFontSizeDefault"),
    )!;
    expect(reset).toBeDefined();
    (reset.props.onClick as () => void)();
    expect(mounted.commands).toEqual([
      {
        type: "presentation",
        clipId: custom.id,
        title: custom.title,
        titleStyle: {
          version: 1,
          role: "scene-statement",
          fontWeight: 700,
          fadeOut: 1,
          bottomSafeMargin: 0.12,
        },
      },
    ]);
    expect(mounted.props.clip.titleStyle?.fontSize).toBe(53.125675);
  });
  it("writes only an explicitly entered size and preserves other native text settings", async () => {
    const custom = {
      ...valid,
      titleStyle: {
        ...valid.titleStyle!,
        fontWeight: 700,
        fadeOut: 1,
        bottomSafeMargin: 0.12,
      },
    };
    const mounted = await mount("en-US", en, custom);
    const input = mounted.control("editor.presentation.titleFontSize")!;
    (input.props["onUpdate:modelValue"] as (value: number) => void)(64);
    await vue.nextTick();
    (input.props.onChange as () => void)();
    expect(mounted.commands).toEqual([
      {
        type: "presentation",
        clipId: custom.id,
        title: custom.title,
        titleStyle: { ...custom.titleStyle, fontSize: 64 },
      },
    ]);
    expect(mounted.props.clip.titleStyle).toEqual(custom.titleStyle);
  });
});

describe("photo movement without changing framing", () => {
  it.each([
    ["en-US", en],
    ["zh-TW", zh],
    ["ja-JP", ja],
    ["en-XA", pseudoMessages(en)],
  ] as const)(
    "offers pull-out on original photos in %s",
    async (locale, messages) => {
      const clip: core.Clip = {
        ...legacy,
        titleStyle: { version: 1, role: "subtitle", fontWeight: 700 },
      };
      const mounted = await mount(locale, messages, clip);
      const pullOut = flatten(mounted.root).find(
        (item) =>
          item.tag === "button" &&
          text(item) ===
            mounted.label("editor.presentation.motionPresets.pull-out"),
      );
      expect(pullOut).toBeDefined();
      (pullOut!.props.onClick as () => void)();
      expect(mounted.commands).toEqual([
        {
          type: "presentation",
          clipId: clip.id,
          motion: {
            version: 1,
            preset: "pull-out",
            easing: "ease-in-out",
            from: { scale: 1.06, x: 0, y: 0 },
            to: { scale: 1, x: 0, y: 0 },
          },
        },
      ]);
      expect(mounted.commands[0]).not.toHaveProperty("layout");
      expect(mounted.props.clip).toEqual(clip);
      const motion = (
        mounted.commands[0] as Extract<
          TimelineCommand,
          { type: "presentation" }
        >
      ).motion!;
      await mounted.update({ ...clip, motion });
      const layout = mounted.control("editor.presentation.layout")!;
      expect(layout.options[layout.selectedIndex]?.value).toBe("original");
      const selected = flatten(mounted.root).find(
        (item) =>
          item.tag === "button" &&
          text(item) ===
            mounted.label("editor.presentation.motionPresets.pull-out"),
      );
      expect(selected!.props["aria-pressed"]).toBe(true);
      expect(mounted.props.clip.titleStyle).toEqual(clip.titleStyle);
    },
  );
});
