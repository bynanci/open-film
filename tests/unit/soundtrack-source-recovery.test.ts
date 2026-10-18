import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import {
  vue,
  flatten,
  loadComponent,
  mountComponent,
} from "./helpers/vue-sfc-host";

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop()),
);

async function mountSound(overlay = true) {
  const component = loadComponent(
    "apps/desktop/src/components/SoundtrackPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "@openfilm/core": core,
      "../api": {
        sourceUrl: (id: string, version?: string | number) =>
          `/source/${id}?v=${encodeURIComponent(version ?? "")}`,
      },
      "../i18n": { formatDuration: String },
    },
  );
  const clip: core.Clip = {
    id: "sound",
    assetId: "audio",
    timelineStart: 0,
    timelineDuration: 2,
    sourceIn: 0.25,
    sourceOut: 2.25,
    audioAutomation: { version: 1, role: "music" },
  };
  const asset: core.MediaAsset = {
    id: "audio",
    name: "Music",
    uri: "file:///old/music.wav",
    mediaType: "audio",
    duration: 3,
    tags: [],
    state: {},
    metadata: {},
  };
  const props = vue.reactive({
    composition: {
      id: "film",
      storyId: "story",
      duration: 5,
      tracks: [
        {
          id: "music",
          type: "music",
          timing: overlay ? "overlay" : undefined,
          clips: [clip],
        },
      ],
    },
    selectedClip: clip,
    assets: [asset],
    sourceVersion: 1,
    active: true,
    busy: false,
  });
  const { root, unmount } = mountComponent(component, props);
  cleanup.push(unmount);
  await vue.nextTick();
  const audio = () => flatten(root).find((element) => element.tag === "audio")!;
  const failed = () =>
    flatten(root).some(
      (element) =>
        element.props.role === "status" &&
        element.text.includes("editor.source.error.playback"),
    );
  return { props, root, audio, failed };
}

it("replaces failed sound media and clears failure after a same-ID URI change", async () => {
  const sound = await mountSound();
  const first = sound.audio();
  first.pause = vi.fn();
  (first.props.onError as () => void)();
  await vue.nextTick();
  expect(sound.failed()).toBe(true);
  sound.props.assets = [
    { ...sound.props.assets[0], uri: "file:///new/music.wav" },
  ];
  await vue.nextTick();
  await vue.nextTick();
  expect(sound.audio() === first).toBe(false);
  expect(first.parent).toBeNull();
  expect(first.pause).toHaveBeenCalledTimes(1);
  expect(sound.audio().props.src).not.toBe(first.props.src);
  expect(sound.failed()).toBe(false);
  (sound.audio().props.onLoadedmetadata as () => void)();
  expect(sound.audio().currentTime).toBe(0.25);
  (first.props.onError as (event: object) => void)({ currentTarget: first });
  await vue.nextTick();
  expect(sound.failed()).toBe(false);
});

it("replaces a failed sound resource when only reconnect version changes", async () => {
  const sound = await mountSound();
  const first = sound.audio();
  (first.props.onError as () => void)();
  await vue.nextTick();
  expect(sound.failed()).toBe(true);
  sound.props.sourceVersion += 1;
  await vue.nextTick();
  await vue.nextTick();
  expect(sound.audio() === first).toBe(false);
  expect(sound.audio().props.src).not.toBe(first.props.src);
  expect(sound.failed()).toBe(false);
});

it("passes source reconnect version from the timeline to the sound workspace", () => {
  const source = readFileSync(
    resolve("apps/desktop/src/components/TimelineEditor.vue"),
    "utf8",
  );
  const panel = source.match(/<SoundtrackPanel[\s\S]*?\/>/)?.[0] ?? "";
  expect(panel.includes(':source-version="sourceVersion"')).toBe(true);
});

it("keeps ordinary story audio outside the soundtrack panel controls", async () => {
  const ordinary = await mountSound(false);
  expect(ordinary.audio() === undefined).toBe(true);
  const list = flatten(ordinary.root).find((element) =>
    String(element.props.class).includes("editor-soundtrack-list"),
  )!;
  expect(
    flatten(list).filter((element) => element.tag === "button"),
  ).toHaveLength(0);
  const labelText = (element: ReturnType<typeof flatten>[number]): string =>
    element.text + element.children.map(labelText).join("");
  expect(
    flatten(ordinary.root).filter(
      (element) =>
        element.tag === "label" &&
        labelText(element).includes("editor.sound.start"),
    ),
  ).toHaveLength(1);
  const sound = await mountSound();
  expect(sound.audio() !== undefined).toBe(true);
  const overlayList = flatten(sound.root).find((element) =>
    String(element.props.class).includes("editor-soundtrack-list"),
  )!;
  expect(
    flatten(overlayList).filter((element) => element.tag === "button"),
  ).toHaveLength(1);
  expect(
    flatten(sound.root).filter(
      (element) =>
        element.tag === "label" &&
        labelText(element).includes("editor.sound.start"),
    ),
  ).toHaveLength(2);
});
