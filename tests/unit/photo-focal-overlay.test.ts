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
  const mounted = mountComponent(component, props);
  const surface = flatten(mounted.root).find(
    (node) => node.props.role === "group",
  )!;
  let pointer: number | undefined;
  Object.assign(surface, {
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
    preview,
    commit,
    activity,
    cancelled,
    surface,
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
