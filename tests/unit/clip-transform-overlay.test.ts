import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as interaction from "../../apps/desktop/src/clipTransformInteraction";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";

type MutableHost = HostNode & {
  focus: () => void;
  setPointerCapture: (id: number) => void;
  hasPointerCapture: (id: number) => boolean;
  releasePointerCapture: (id: number) => void;
};

const labels: Record<string, string> = {
  "editor.picture.group": "Picture transform",
  "editor.picture.move": "Move picture",
  "editor.picture.nw": "Resize picture top left",
  "editor.picture.ne": "Resize picture top right",
  "editor.picture.se": "Resize picture bottom right",
  "editor.picture.sw": "Resize picture bottom left",
  "editor.picture.hint": "Drag, use arrows, or press Escape to cancel.",
};

function component() {
  return loadComponent("apps/desktop/src/components/ClipTransformOverlay.vue", {
    "vue-i18n": { useI18n: () => ({ t: (key: string) => labels[key] ?? key }) },
    "../clipTransformInteraction": interaction,
  });
}

function mount(overrides: Record<string, unknown> = {}) {
  const preview = vi.fn();
  const commit = vi.fn();
  const activity = vi.fn();
  const cancelled = vi.fn();
  const props = vue.reactive({
    value: { x: 0, y: 0, scale: 1, rotation: 0 },
    geometry: {
      frame: {
        scale: 0.5,
        width: 960,
        height: 540,
        offsetX: 0,
        offsetY: 0,
      },
      media: { width: 800, height: 400 },
      scale: 1,
      rotation: 0,
      x: 0,
      y: 0,
    },
    disabled: false,
    sessionKey: "project:cut:revision:clip",
    onPreview: preview,
    onCommit: commit,
    onActivity: activity,
    onCancelled: cancelled,
    ...overrides,
  });
  const mounted = mountComponent(component(), props);
  return { ...mounted, props, preview, commit, activity, cancelled };
}

beforeEach(() =>
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("ClipTransformOverlay", () => {
  it("exposes one labelled move target and four labelled corner targets", () => {
    const mounted = mount();
    const nodes = flatten(mounted.root);
    const group = nodes.find(
      (node) => node.props.role === "group" && node.props["aria-label"],
    );
    const buttons = nodes.filter((node) => node.tag === "button");

    expect(group?.props["aria-label"]).toBe("Picture transform");
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Move picture",
      "Resize picture top left",
      "Resize picture top right",
      "Resize picture bottom right",
      "Resize picture bottom left",
    ]);
    mounted.unmount();
  });

  it("previews and commits one keyboard move in composition pixels", () => {
    const mounted = mount();
    const move = flatten(mounted.root).find(
      (node) => node.props["aria-label"] === "Move picture",
    )!;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    (move.props.onKeydown as (event: KeyboardEvent) => void)({
      key: "ArrowRight",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      preventDefault,
      stopPropagation,
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(mounted.preview).toHaveBeenCalledWith({
      x: 10,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    expect(mounted.commit).toHaveBeenCalledWith({
      x: 10,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    mounted.unmount();
  });

  it("restores the initial value when a captured pointer gesture is cancelled", () => {
    const mounted = mount();
    const nodes = flatten(mounted.root);
    const surface = nodes.find(
      (node) => node.props.role === "group",
    ) as MutableHost;
    const move = nodes.find(
      (node) => node.props["aria-label"] === "Move picture",
    ) as MutableHost;
    let captured = -1;
    surface.setPointerCapture = (id) => {
      captured = id;
    };
    surface.hasPointerCapture = (id) => captured === id;
    surface.releasePointerCapture = () => {
      captured = -1;
    };
    move.focus = vi.fn();

    (move.props.onPointerdown as (event: PointerEvent) => void)({
      button: 0,
      isPrimary: true,
      pointerId: 7,
      clientX: 100,
      clientY: 50,
      currentTarget: move,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as PointerEvent);
    (surface.props.onPointermove as (event: PointerEvent) => void)({
      pointerId: 7,
      clientX: 120,
      clientY: 60,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent);
    (surface.props.onPointercancel as () => void)();

    expect(mounted.activity.mock.calls).toEqual([[true], [false]]);
    expect(mounted.preview).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    expect(mounted.commit).not.toHaveBeenCalled();
    expect(mounted.cancelled).toHaveBeenCalledOnce();
    mounted.unmount();
  });

  it("cancels a captured gesture when its session owner changes", async () => {
    const mounted = mount();
    const nodes = flatten(mounted.root);
    const surface = nodes.find(
      (node) => node.props.role === "group",
    ) as MutableHost;
    const move = nodes.find(
      (node) => node.props["aria-label"] === "Move picture",
    ) as MutableHost;
    let captured = -1;
    surface.setPointerCapture = (id) => {
      captured = id;
    };
    surface.hasPointerCapture = (id) => captured === id;
    surface.releasePointerCapture = () => {
      captured = -1;
    };
    move.focus = vi.fn();
    (move.props.onPointerdown as (event: PointerEvent) => void)({
      button: 0,
      isPrimary: true,
      pointerId: 9,
      clientX: 80,
      clientY: 40,
      currentTarget: move,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as PointerEvent);

    mounted.props.sessionKey = "another-project:another-revision";
    await vue.nextTick();
    (surface.props.onPointerup as (event: PointerEvent) => void)({
      pointerId: 9,
      clientX: 120,
      clientY: 60,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent);

    expect(mounted.activity.mock.calls).toEqual([[true], [false]]);
    expect(mounted.cancelled).toHaveBeenCalledOnce();
    expect(mounted.commit).not.toHaveBeenCalled();
    mounted.unmount();
  });
});

it("keeps coarse-pointer hit targets at least 44 CSS pixels", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile("apps/desktop/src/components/ClipTransformOverlay.vue", "utf8"),
  );
  expect(source).toMatch(/@media\s*\(pointer:\s*coarse\)/u);
  expect(source).toMatch(/min-width:\s*44px/u);
  expect(source).toMatch(/min-height:\s*44px/u);
});
