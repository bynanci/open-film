import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as interaction from "../../apps/desktop/src/photoFocalInteraction";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";

beforeEach(() =>
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 }),
  ),
);
afterEach(() => vi.unstubAllGlobals());
function mount() {
  const preview = vi.fn(),
    commit = vi.fn(),
    activity = vi.fn(),
    cancelled = vi.fn();
  const geometry = interaction.resolvePhotoFocalGeometry(
    { assetId: "photo", x: 0, y: 0, width: 100, height: 200 },
    { scale: 1, x: 0, y: 0 },
    undefined,
    { width: 100, height: 200 },
    { left: 0, top: 0, width: 100, height: 200 },
  );
  const props = vue.reactive({
    point: { x: 0.5, y: 0.5 },
    geometry,
    disabled: false,
    sessionKey: "project:cut:r1:photo",
    onPreview: (point: { x: number; y: number }) => {
      preview(point);
      props.point = point;
    },
    onCommit: commit,
    onActivity: activity,
    onCancelled: cancelled,
  });
  const component = loadComponent(
    "apps/desktop/src/components/PhotoFocalOverlay.vue",
    {
      "../photoFocalInteraction": interaction,
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
    },
  );
  const production = component as {
    setup: (props: Record<string, unknown>, context: unknown) => unknown;
  };
  const setup = production.setup;
  let currentProps: Record<string, unknown> = {};
  production.setup = (input, context) => {
    currentProps = vue.toRaw(input);
    return setup(input, context);
  };
  const mounted = mountComponent(component, props);
  const surface = flatten(mounted.root).find(
    (node) => node.props.role === "group",
  )!;
  let pointer: number | undefined;
  const surfaceRect = { left: 0, top: 0, width: 100, height: 200 };
  Object.assign(surface, {
    getBoundingClientRect: () => ({ ...surfaceRect }),
    setPointerCapture: (id: number) => {
      pointer = id;
    },
    hasPointerCapture: (id: number) => pointer === id,
    releasePointerCapture: () => {
      pointer = undefined;
    },
  });
  const button = flatten(mounted.root).find((node) => node.tag === "button")!;
  Object.assign(button, { focus() {} });
  const event = (x: number, y: number, id = 1) =>
    ({
      clientX: x,
      clientY: y,
      pointerId: id,
      button: 0,
      isPrimary: true,
      currentTarget: button,
      preventDefault() {},
      stopPropagation() {},
    }) as unknown as PointerEvent;
  const invoke = (node: HostNode, name: string, value: unknown) =>
    (node.props[name] as (event: unknown) => void)(value);
  return {
    ...mounted,
    props,
    currentProps,
    preview,
    commit,
    activity,
    cancelled,
    surface,
    surfaceRect,
    button,
    event,
    invoke,
  };
}

it("previews with frozen source geometry and commits only once at pointer release", async () => {
  const test = mount();
  test.invoke(test.button, "onPointerdown", test.event(50, 100));
  test.invoke(test.surface, "onPointermove", test.event(60, 100));
  await vue.nextTick();
  expect(test.commit).not.toHaveBeenCalled();
  test.props.geometry = {
    ...test.props.geometry,
    sourceToViewport: [200, 0, 0, 200, -50, 0],
  };
  await vue.nextTick();
  test.invoke(test.surface, "onPointerup", test.event(70, 100));
  expect(test.commit).toHaveBeenCalledExactlyOnceWith({ x: 0.7, y: 0.5 });
  test.invoke(test.surface, "onPointerup", test.event(70, 100));
  expect(test.commit).toHaveBeenCalledTimes(1);
  test.unmount();
});

it.each(["pointercancel", "blur", "resize", "session", "disabled"])(
  "cancels %s without a saved edit",
  async (reason) => {
    const test = mount();
    test.invoke(test.button, "onPointerdown", test.event(50, 100));
    test.invoke(test.surface, "onPointermove", test.event(70, 100));
    if (reason === "pointercancel")
      test.invoke(test.surface, "onPointercancel", test.event(70, 100));
    else if (reason === "session") test.props.sessionKey = "other-project";
    else if (reason === "disabled") test.props.disabled = true;
    else window.dispatchEvent(new Event(reason));
    await vue.nextTick();
    test.invoke(test.surface, "onPointerup", test.event(70, 100));
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.cancelled).toHaveBeenCalledOnce();
    test.unmount();
  },
);

it.each(["innerWidth", "innerHeight"] as const)(
  "cancels a pointer release after %s changes before the resize event arrives",
  (dimension) => {
    const test = mount();
    test.invoke(test.button, "onPointerdown", test.event(50, 100));
    test.invoke(test.surface, "onPointermove", test.event(70, 100));
    Object.assign(window, { [dimension]: window[dimension] + 40 });
    test.invoke(test.surface, "onPointerup", test.event(70, 100));
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.cancelled).toHaveBeenCalledOnce();
    expect(test.props.point).toEqual({ x: 0.5, y: 0.5 });
    test.unmount();
  },
);

it("cancels a keyboard release after viewport resize before its event arrives", () => {
  const test = mount();
  const key = {
    key: "ArrowRight",
    preventDefault() {},
    stopPropagation() {},
  };
  test.invoke(test.button, "onKeydown", key);
  Object.assign(window, { innerWidth: window.innerWidth + 40 });
  test.invoke(test.button, "onKeyup", key);
  expect(test.commit).not.toHaveBeenCalled();
  expect(test.cancelled).toHaveBeenCalledOnce();
  expect(test.props.point).toEqual({ x: 0.5, y: 0.5 });
  test.unmount();
});

it.each(["left", "top", "width", "height"] as const)(
  "cancels a pointer release after the actual surface %s changes before observation",
  (field) => {
    const test = mount();
    test.invoke(test.button, "onPointerdown", test.event(50, 100));
    test.invoke(test.surface, "onPointermove", test.event(70, 100));
    test.surfaceRect[field] += 10;
    test.invoke(test.surface, "onPointerup", test.event(70, 100));
    expect(test.commit).not.toHaveBeenCalled();
    expect(test.cancelled).toHaveBeenCalledOnce();
    expect(test.props.point).toEqual({ x: 0.5, y: 0.5 });
    test.unmount();
  },
);

it("checks the current source session before a queued owner watcher runs", () => {
  const test = mount();
  test.invoke(test.button, "onPointerdown", test.event(50, 100));
  test.invoke(test.surface, "onPointermove", test.event(70, 100));
  // Change the already-delivered prop without flushing its observer.
  test.currentProps.sessionKey = "replacement-source";
  test.invoke(test.surface, "onPointerup", test.event(70, 100));
  expect(test.commit).not.toHaveBeenCalled();
  expect(test.cancelled).toHaveBeenCalledOnce();
  test.unmount();
});

it("coalesces repeated keyboard nudges until keyup and cancels Escape", () => {
  const test = mount();
  const key = (name: string, shiftKey = false) => ({
    key: name,
    shiftKey,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
  });
  test.invoke(test.button, "onKeydown", key("ArrowRight"));
  test.invoke(test.button, "onKeydown", key("ArrowRight"));
  expect(test.commit).not.toHaveBeenCalled();
  test.invoke(test.button, "onKeyup", key("ArrowRight"));
  expect(test.commit).toHaveBeenCalledExactlyOnceWith({ x: 0.52, y: 0.5 });
  test.invoke(test.button, "onKeydown", key("ArrowUp", true));
  test.invoke(test.button, "onKeydown", key("Escape"));
  test.invoke(test.button, "onKeyup", key("ArrowUp"));
  expect(test.commit).toHaveBeenCalledTimes(1);
  test.unmount();
});

it("lets Escape leave an idle focus tool without saving a crop", () => {
  const test = mount();
  const event = new Event("keydown");
  Object.defineProperty(event, "key", { value: "Escape" });
  window.dispatchEvent(event);
  expect(test.cancelled).toHaveBeenCalledOnce();
  expect(test.commit).not.toHaveBeenCalled();
  test.unmount();
});
