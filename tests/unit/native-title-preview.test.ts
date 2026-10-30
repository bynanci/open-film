import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.unstubAllGlobals();
});
class Player extends EventTarget {
  currentTime = 10;
  paused = true;
  ended = false;
  play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}
async function mount(withPlayer = true) {
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  const player = new Player();
  const props = vue.reactive({
    clip: {
      id: "video",
      assetId: "source",
      sourceIn: 10,
      sourceOut: 18,
      timelineStart: 5,
      timelineDuration: 4,
      transform: { speed: 2 },
      title: "我們的故事",
      titleStyle: { version: 1, role: "subtitle", fadeOut: 2 },
    } as core.Clip,
    src: "/shared-title.png",
    sourceTime: 10,
    player: withPlayer ? player : null,
  });
  const component = loadComponent(
    "apps/desktop/src/components/NativeTitlePreview.vue",
    { "@openfilm/core": core },
  );
  const mounted = mountComponent(component, props);
  cleanup.push(mounted.unmount);
  await vue.nextTick();
  return {
    ...mounted,
    props,
    player,
    callbacks,
    imageSource: () =>
      flatten(mounted.root).find((node) => node.tag === "img")!.props.src,
    opacity: () =>
      (
        flatten(mounted.root).find((node) => node.tag === "img")!.props
          .style as { opacity: number }
      ).opacity,
    frame: async () => {
      const entries = [...callbacks.values()];
      callbacks.clear();
      entries.forEach((callback) => callback(0));
      await vue.nextTick();
    },
  };
}

it("updates only the video overlay clock each frame, with trim and speed converted to clip-local seconds", async () => {
  const mounted = await mount();
  expect(mounted.opacity()).toBe(1);
  mounted.player.play();
  mounted.player.currentTime = 16;
  await mounted.frame();
  expect(mounted.opacity()).toBe(0.5);
  expect(mounted.props.sourceTime).toBe(10);
  expect(mounted.callbacks.size).toBe(1);
  mounted.player.pause();
  await vue.nextTick();
  expect(mounted.callbacks.size).toBe(0);
  mounted.player.currentTime = 17;
  mounted.player.dispatchEvent(new Event("seeked"));
  await vue.nextTick();
  expect(mounted.opacity()).toBe(0.25);
});

it("gives a returned revision a fresh image request while clock updates keep the current request", async () => {
  const mounted = await mount(false);
  const first = mounted.imageSource();
  mounted.props.src = "/shared-title.png?revision=second";
  await vue.nextTick();
  const second = mounted.imageSource();
  expect(second).not.toBe(first);
  mounted.props.src = "/shared-title.png";
  await vue.nextTick();
  expect(mounted.imageSource()).not.toBe(first);
  expect(mounted.imageSource()).not.toBe(second);
  const returned = mounted.imageSource();
  mounted.props.sourceTime = 17;
  await vue.nextTick();
  expect(mounted.imageSource()).toBe(returned);
});

it("retains zero-fade legacy visibility and releases frames and event listeners on unmount", async () => {
  const mounted = await mount();
  mounted.props.clip = { ...mounted.props.clip, titleStyle: undefined };
  await vue.nextTick();
  mounted.player.play();
  expect(mounted.callbacks.size).toBe(0);
  mounted.props.clip = {
    ...mounted.props.clip,
    titleStyle: { version: 1, role: "subtitle", fadeOut: 1 },
  };
  await vue.nextTick();
  expect(mounted.callbacks.size).toBe(1);
  mounted.unmount();
  expect(mounted.callbacks.size).toBe(0);
  mounted.player.play();
  expect(mounted.callbacks.size).toBe(0);
});

it("supports a static photo overlay without starting an animation loop", async () => {
  const mounted = await mount(false);
  mounted.props.sourceTime = 17;
  await vue.nextTick();
  expect(mounted.opacity()).toBe(0.25);
  expect(mounted.callbacks.size).toBe(0);
});

it("evaluates preview candidate timing without requiring saved clip mutation", async () => {
  const mounted = await mount();
  mounted.player.currentTime = 15;
  mounted.player.dispatchEvent(new Event("seeked"));
  await vue.nextTick();
  expect(mounted.opacity()).toBe(0.75);
  const saved = JSON.parse(JSON.stringify(mounted.props.clip)) as core.Clip;
  mounted.props.clip = { ...saved, sourceOut: 16, timelineDuration: 3 };
  await vue.nextTick();
  expect(mounted.opacity()).toBe(0.25);
  expect(saved.timelineDuration).toBe(4);
  expect(saved.sourceOut).toBe(18);
});
