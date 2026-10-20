import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GraphicImageNode,
  GraphicScene,
  MediaAsset,
  PhotoDepthRecipe,
} from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { canCreatePhotoDepth } from "../../apps/desktop/src/photo-depth-controls.js";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.unstubAllGlobals();
});

const hash = "a".repeat(64);
const parallax: PhotoDepthRecipe = {
  version: 1,
  id: "recipe",
  nodeId: "photo",
  mode: "parallax",
  duration: 6,
  sourceAssetId: "source",
  sourceSha256: hash,
  maskAssetId: "mask-a",
  maskSha256: hash,
  background: { kind: "source" },
  protectedRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  foregroundDepth: 1.2,
  backgroundDepth: 0.25,
  amplitude: 0.5,
  camera: {
    from: { x: 0, y: 0, scale: 1 },
    to: { x: 0.02, y: 0, scale: 1.04 },
  },
  easing: "ease-in-out",
};
const fallback: PhotoDepthRecipe = {
  version: 1,
  id: "recipe",
  nodeId: "photo",
  mode: "fallback",
  duration: 6,
  sourceAssetId: "source",
  sourceSha256: hash,
  fallbackReason: "protected-subject-overlap",
};

function text(node: HostNode): string {
  return flatten(node)
    .map((child) => child.text)
    .join(" ")
    .trim();
}
async function fixture(recipe?: PhotoDepthRecipe, initialAssetIds?: string[]) {
  class HostDocument {
    activeElement = null;
  }
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  const component = loadComponent(
    "apps/desktop/src/components/PhotoDepthControls.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": { thumbnailUrl: () => "/synthetic-thumbnail.png" },
      "../photo-depth-controls": { canCreatePhotoDepth },
    },
  );
  const image: GraphicImageNode = {
    id: "photo",
    type: "image",
    assetId: "source",
    x: 0,
    y: 0,
    width: 160,
    height: 90,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 6,
  };
  const scene: GraphicScene = {
    version: 1,
    id: "scene",
    name: "Synthetic photo",
    start: 0,
    duration: 6,
    zIndex: 0,
    nodes: [image, { ...image, id: "other-photo" }],
    ...(recipe ? { photoDepth: structuredClone(recipe) } : {}),
  };
  const assets = ["source", "mask-a", "background", "mask-b", "mask-c"].map(
    (id): MediaAsset => ({
      id,
      name: `${id}.${id === "background" ? "jpg" : "png"}`,
      codec: id === "background" ? "mjpeg" : "png",
      mediaType: "image",
      uri: `file:///synthetic/${id}`,
      contentHash: hash,
      tags: [],
      state: {},
      metadata: {},
    }),
  );
  const commands: TimelineCommand[] = [];
  const props = vue.shallowReactive({
    scene,
    node: image,
    assets: initialAssetIds
      ? assets.filter((asset) => initialAssetIds.includes(asset.id))
      : assets,
    duration: 6,
    frameRate: 30,
    disabled: false,
    onCommand: (command: TimelineCommand) => {
      commands.push(command);
      if (command.type === "graphic.scene.upsert") props.scene = command.scene;
    },
  });
  const mounted = mountComponent(component, props);
  cleanup.push(mounted.unmount);
  await vue.nextTick();
  const control = (key: string) =>
    flatten(mounted.root)
      .find((node) => node.tag === "label" && text(node).includes(key))
      ?.children.find((node) => ["select", "input"].includes(node.tag));
  const button = (key: string) =>
    flatten(mounted.root).find(
      (node) => node.tag === "button" && text(node) === key,
    );
  const model = async (key: string, value: string) => {
    const node = control(key);
    expect(node, key).toBeDefined();
    (node!.props["onUpdate:modelValue"] as (value: string) => void)(value);
    await vue.nextTick();
  };
  const click = async (key: string) => {
    const node = button(key);
    expect(node, key).toBeDefined();
    (node!.props.onClick as () => void)();
    await vue.nextTick();
  };
  const savedRecipe = () => {
    const command = commands.at(-1);
    if (command?.type !== "graphic.scene.upsert")
      throw new Error("Expected a saved scene");
    return command.scene.photoDepth!;
  };
  return {
    props,
    commands,
    control,
    button,
    model,
    click,
    savedRecipe,
    assets,
  };
}

describe("PhotoDepth recipe controls", () => {
  it("recreates parallax directly from an active fallback while retaining its recipe ID", async () => {
    const panel = await fixture(fallback);
    expect(panel.control("editor.photoDepth.foregroundMask")).toBeDefined();
    await panel.model("editor.photoDepth.foregroundMask", "mask-b");
    await panel.click("editor.photoDepth.create");
    expect(panel.savedRecipe()).toMatchObject({
      id: "recipe",
      mode: "parallax",
      maskAssetId: "mask-b",
    });
  });

  it("switches a freshly reopened source-background recipe to an available local background", async () => {
    const panel = await fixture(parallax);
    await panel.model("editor.photoDepth.backgroundMode", "asset");
    (
      panel.control("editor.photoDepth.backgroundMode")!.props
        .onChange as () => void
    )();
    await vue.nextTick();
    expect(panel.savedRecipe()).toMatchObject({
      background: { kind: "asset", assetId: "background", sha256: hash },
    });
    expect(panel.control("editor.photoDepth.background")).toBeDefined();
  });

  it("can switch source mode after a background becomes available in the Library", async () => {
    const panel = await fixture(parallax, ["source", "mask-a"]);
    panel.props.assets = panel.assets;
    await vue.nextTick();
    await panel.model("editor.photoDepth.backgroundMode", "asset");
    (
      panel.control("editor.photoDepth.backgroundMode")!.props
        .onChange as () => void
    )();
    await vue.nextTick();
    expect(panel.savedRecipe()).toMatchObject({
      background: { kind: "asset", assetId: "background", sha256: hash },
    });
  });

  it("records the selected fallback reason on the first creation", async () => {
    const panel = await fixture();
    await panel.model("editor.photoDepth.fallbackReason", "mask-unreliable");
    await panel.click("editor.photoDepth.useFallback");
    expect(panel.savedRecipe()).toMatchObject({
      mode: "fallback",
      fallbackReason: "mask-unreliable",
    });
  });

  it("starts another image's fallback reason from its own default", async () => {
    const panel = await fixture(fallback);
    panel.props.node = panel.props.scene.nodes[1] as GraphicImageNode;
    await vue.nextTick();
    await panel.click("editor.photoDepth.useFallback");
    expect(panel.savedRecipe()).toMatchObject({
      nodeId: "other-photo",
      mode: "fallback",
      fallbackReason: "mask-not-available",
    });
  });

  it("retains a pending mask choice through an acknowledged parameter edit", async () => {
    const panel = await fixture(parallax);
    await panel.model("editor.photoDepth.foregroundMask", "mask-b");
    (
      panel.control("editor.photoDepth.amplitude")!.props.onChange as (
        event: unknown,
      ) => void
    )({ target: { value: "0.6" } });
    await vue.nextTick();
    await panel.click("editor.photoDepth.update");
    expect(panel.savedRecipe()).toMatchObject({
      mode: "parallax",
      maskAssetId: "mask-b",
      amplitude: 0.6,
    });
  });

  it("uses a newly saved mask identity after an external recipe change", async () => {
    const panel = await fixture(parallax);
    await panel.model("editor.photoDepth.foregroundMask", "mask-b");
    panel.props.scene = {
      ...panel.props.scene,
      photoDepth: { ...structuredClone(parallax), maskAssetId: "mask-c" },
    };
    await vue.nextTick();
    await panel.click("editor.photoDepth.update");
    expect(panel.savedRecipe()).toMatchObject({
      mode: "parallax",
      maskAssetId: "mask-c",
    });
  });

  it("retains a chosen fallback reason while saving parallax parameters", async () => {
    const panel = await fixture(parallax);
    await panel.model("editor.photoDepth.fallbackReason", "mask-unreliable");
    (
      panel.control("editor.photoDepth.amplitude")!.props.onChange as (
        event: unknown,
      ) => void
    )({ target: { value: "0.6" } });
    await vue.nextTick();
    await panel.click("editor.photoDepth.useFallback");
    expect(panel.savedRecipe()).toMatchObject({
      mode: "fallback",
      fallbackReason: "mask-unreliable",
    });
  });

  it("does not save parallax or fallback actions while editing is disabled", async () => {
    const panel = await fixture(parallax);
    panel.props.disabled = true;
    await vue.nextTick();
    expect(panel.button("editor.photoDepth.update")!.props.disabled).toBe(true);
    expect(panel.button("editor.photoDepth.useFallback")!.props.disabled).toBe(
      true,
    );
    await panel.click("editor.photoDepth.update");
    await panel.click("editor.photoDepth.useFallback");
    expect(panel.commands).toEqual([]);
  });
});
