import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import * as story from "@openfilm/story";
import {
  flatten,
  hostNode,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

function nodeText(node: ReturnType<typeof hostNode>): string {
  return (
    node.text +
    node.children
      .map((child) => nodeText(child as ReturnType<typeof hostNode>))
      .join("")
  );
}
function testNode(tag: string) {
  return Object.assign(hostNode(tag), {
    tagName: tag.toUpperCase(),
    value: "",
    getRootNode: () => globalThis.document,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
}

class HostDocument {
  activeElement = null;
}
afterEach(() => vi.unstubAllGlobals());

it("pages the photo catalog instead of materializing every Library image", async () => {
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  const library = Array.from({ length: 10_000 }, (_, index) => ({
    id: `photo-${index}`,
    name: `Photo ${index}`,
    mediaType: "image",
    uri: `file:///synthetic/${index}.jpg`,
    contentHash: "a".repeat(64),
    tags: [],
    state: {},
    metadata: {},
  }));
  let returnedAssets = 0;
  const assets = vi.fn(async (params: URLSearchParams) => {
    const offset = Number(params.get("cursor") ?? 0);
    const limit = Number(params.get("limit"));
    const page = library.slice(offset, offset + limit);
    returnedAssets += page.length;
    return {
      assets: page,
      total: library.length,
      nextCursor:
        offset + page.length < library.length ? String(offset + limit) : null,
    };
  });
  const component = loadComponent(
    "apps/desktop/src/components/GraphicSceneTemplateStudio.vue",
    {
      "@openfilm/core": core,
      "@openfilm/story": story,
      "@openfilm/solver": {},
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": { api: { assets } },
    },
  );
  const props = vue.reactive({
    scenes: [] as core.GraphicScene[],
    records: [] as core.GraphicSceneTemplateRecord[],
    duration: 8,
    width: 320,
    height: 180,
    locale: "en-US" as const,
    assets: [] as core.MediaAsset[],
    disabled: false,
  });
  const mounted = mountComponent(component, props);
  const nodes = () => flatten(mounted.root);
  const button = (key: string) =>
    nodes().find(
      (item) => item.tag === "button" && nodeText(item).includes(key),
    );
  const settle = async () => {
    for (let i = 0; i < 16; i++) {
      await Promise.resolve();
      await vue.nextTick();
    }
  };
  try {
    await settle();
    (button("editor.templates.photos")!.props.onClick as () => void)();
    await settle();
    expect(assets).toHaveBeenCalledTimes(1);
    expect(returnedAssets).toBe(200);
    expect(assets.mock.calls[0]![0].get("limit")).toBe("200");
    expect(assets.mock.calls[0]![0].get("cursorMode")).toBe("keyset");
    expect(
      nodes().some(
        (item) => item.tag === "option" && item.props.value === "photo-9999",
      ),
    ).toBe(false);
    expect(button("editor.templates.nextPhotos")).toBeDefined();

    (button("editor.templates.nextPhotos")!.props.onClick as () => void)();
    await settle();
    expect(assets).toHaveBeenCalledTimes(2);
    expect(assets.mock.calls[1]![0].get("cursor")).toBe("200");
    expect(
      nodes().some(
        (item) => item.tag === "option" && item.props.value === "photo-200",
      ),
    ).toBe(true);
    expect(
      nodes().some(
        (item) => item.tag === "option" && item.props.value === "photo-0",
      ),
    ).toBe(true);
    expect(
      nodes().filter(
        (item) =>
          item.tag === "option" &&
          String(item.props.value).startsWith("photo-"),
      ).length,
    ).toBeLessThanOrEqual(201);
  } finally {
    mounted.unmount();
  }
});

it("shows a command rejection instead of reporting a template as saved", async () => {
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  const component = loadComponent(
    "apps/desktop/src/components/GraphicSceneTemplateStudio.vue",
    {
      "@openfilm/core": core,
      "@openfilm/story": story,
      "@openfilm/solver": {},
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": { assets: async () => ({ assets: [], total: 0 }) },
    },
  );
  const rejectedProps = vue.reactive({
    scenes: [] as core.GraphicScene[],
    records: [] as core.GraphicSceneTemplateRecord[],
    duration: 8,
    width: 320,
    height: 180,
    locale: "en-US" as const,
    assets: [] as core.MediaAsset[],
    disabled: false,
  });
  const renderer = vue.createRenderer({
    createElement: testNode,
    createText: (value: string) => ({ ...testNode("text"), text: value }),
    createComment: () => testNode("comment"),
    setText: (element: ReturnType<typeof hostNode>, value: string) => {
      element.text = value;
    },
    setElementText: (element: ReturnType<typeof hostNode>, value: string) => {
      element.text = value;
      element.children = [];
    },
    patchProp: (
      element: ReturnType<typeof hostNode>,
      key: string,
      _previous: unknown,
      value: unknown,
    ) => {
      element.props[key] = value;
    },
    insert: (
      element: ReturnType<typeof hostNode>,
      parent: ReturnType<typeof hostNode>,
      anchor?: ReturnType<typeof hostNode>,
    ) => {
      if (element.parent) {
        const current = element.parent.children.indexOf(element);
        if (current >= 0) element.parent.children.splice(current, 1);
      }
      element.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(element);
      else parent.children.splice(index, 0, element);
    },
    remove: (element: ReturnType<typeof hostNode>) => {
      if (!element.parent) return;
      const index = element.parent.children.indexOf(element);
      if (index >= 0) element.parent.children.splice(index, 1);
      element.parent = null;
    },
    parentNode: (element: ReturnType<typeof hostNode>) => element.parent,
    nextSibling: (element: ReturnType<typeof hostNode>) =>
      element.parent?.children[element.parent.children.indexOf(element) + 1] ??
      null,
  });
  const root = testNode("root");
  const app = renderer.createApp({
    render: () =>
      vue.h(component, {
        ...rejectedProps,
        onCommand: (
          _command: unknown,
          _assets: core.MediaAsset[],
          complete: (accepted: boolean) => void,
        ) => complete(false),
      }),
  });
  app.mount(root);
  try {
    await vue.nextTick();
    const labels = flatten(root).filter((item) => item.tag === "label");
    const speaker = labels
      .find((label) => nodeText(label).includes("editor.templates.speaker"))
      ?.children.find((child) => child.tag === "input");
    const text = labels
      .find((label) => nodeText(label).includes("editor.templates.messageText"))
      ?.children.find((child) => child.tag === "textarea");
    expect(speaker).toBeDefined();
    expect(text).toBeDefined();
    (speaker!.props["onUpdate:modelValue"] as (value: string) => void)(
      "Synthetic speaker",
    );
    (text!.props["onUpdate:modelValue"] as (value: string) => void)(
      "Synthetic dialogue",
    );
    await vue.nextTick();
    const save = flatten(root).find(
      (item) =>
        item.tag === "button" &&
        nodeText(item).includes("editor.templates.save"),
    );
    expect(save).toBeDefined();
    (save!.props.onClick as () => void)();
    await vue.nextTick();
    const rendered = flatten(root);
    expect(
      rendered.some(
        (item) =>
          item.props.role === "alert" &&
          nodeText(item).includes("editor.templates.commandRejected"),
      ),
    ).toBe(true);
    expect(
      rendered.some((item) =>
        nodeText(item).includes("editor.templates.saved"),
      ),
    ).toBe(false);
  } finally {
    app.unmount();
  }
});
