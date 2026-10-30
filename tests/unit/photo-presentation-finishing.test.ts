import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";

afterEach(() => vi.unstubAllGlobals());
function mount() {
  class HostDocument {
    activeElement = null;
  }
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  const commands: TimelineCommand[] = [];
  const asset: core.MediaAsset = {
    id: "photo",
    name: "Synthetic",
    mediaType: "image",
    uri: "file:///synthetic.png",
    dimensions: { width: 100, height: 200 },
    metadata: {},
    state: {},
    tags: [],
  };
  const clip: core.Clip = {
    id: "clip",
    assetId: "photo",
    timelineStart: 0,
    timelineDuration: 6,
    layout: {
      version: 2,
      preset: "hero",
      focalPoint: { x: 0.5, y: 0.5 },
      fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
    },
    motion: {
      version: 2,
      preset: "pan",
      easing: {
        version: 1,
        kind: "cubic-bezier",
        x1: 0.25,
        y1: 0.1,
        x2: 0.25,
        y2: 1,
      },
      from: { scale: 1.08, x: -6, y: 0 },
      to: { scale: 1.08, x: 6, y: 0 },
    },
  };
  const props = vue.reactive({
    clip,
    asset,
    assets: [asset],
    frame: { width: 320, height: 180, frameRate: 30 },
    allowPhotoPresentation: true,
    onCommand: (command: TimelineCommand) => commands.push(command),
  });
  const component = loadComponent(
    "apps/desktop/src/components/PhotoPresentationInspector.vue",
    {
      "@openfilm/core": core,
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
    },
  );
  const mounted = mountComponent(component, props);
  const nodes = () => flatten(mounted.root);
  const click = (label: string) => {
    const button = nodes().find(
      (node) => node.tag === "button" && node.text === label,
    )!;
    expect(button).toBeDefined();
    (button.props.onClick as () => void)();
  };
  const update = (node: HostNode, value: unknown) =>
    (node.props["onUpdate:modelValue"] as (value: unknown) => void)(value);
  return { ...mounted, props, commands, nodes, click, update };
}

it("preserves versioned ambient fill through focal edits and custom easing through preset edits", async () => {
  const test = mount();
  const focal = test
    .nodes()
    .find((node) => node.props["aria-label"] === "editor.presentation.focalX")!;
  test.update(focal, 0.7);
  (focal.props.onChange as () => void)();
  expect(test.commands[0]).toMatchObject({
    type: "presentation",
    layout: {
      version: 2,
      focalPoint: { x: 0.7 },
      fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
    },
  });
  test.click("editor.presentation.motionPresets.push-in");
  expect(test.commands[1]).toMatchObject({
    type: "presentation",
    motion: {
      version: 2,
      preset: "push-in",
      easing: test.props.clip.motion!.easing,
    },
  });
  test.unmount();
});

it("requires explicit Apply, rejects an invalid curve and downgrades only explicitly removed features", async () => {
  const test = mount();
  const curve = test
    .nodes()
    .find(
      (node) => node.props["aria-label"] === "editor.presentation.curveX1",
    )!;
  expect(curve).toBeDefined();
  test.update(curve, 0.9);
  test.click("editor.presentation.applyEasing");
  expect(test.commands).toEqual([]);
  const easing = test
    .nodes()
    .find((node) => node.props["aria-label"] === "editor.presentation.easing")!;
  test.update(easing, "linear");
  test.click("editor.presentation.applyEasing");
  expect(test.commands[0]).toMatchObject({
    motion: { version: 1, easing: "linear" },
  });
  const toggle = test
    .nodes()
    .find(
      (node) => node.props["aria-label"] === "editor.presentation.ambientFill",
    )!;
  test.update(toggle, false);
  expect(test.commands).toHaveLength(1);
  test.click("editor.presentation.applyFill");
  expect(test.commands[1]).toMatchObject({
    layout: { version: 1, preset: "hero", focalPoint: { x: 0.5, y: 0.5 } },
  });
  expect(
    (test.commands[1] as Extract<TimelineCommand, { type: "presentation" }>)
      .layout,
  ).not.toHaveProperty("fill");
  expect(test.props.clip.motion?.version).toBe(2);
  expect(test.props.clip.layout?.version).toBe(2);
  test.unmount();
});

it("leaves an absent legacy layout absent when applying an already disabled background", async () => {
  const test = mount();
  test.props.clip = { ...test.props.clip, layout: undefined };
  await vue.nextTick();
  test.click("editor.presentation.applyFill");
  expect(test.commands).toEqual([]);
  test.unmount();
});
