import { existsSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import * as core from "@openfilm/core";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host";
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.splice(0)) f();
});
async function settle() {
  for (let i = 0; i < 8; i++) await vue.nextTick();
}
const field = (root: HostNode, name: string) =>
  flatten(root).find((n) => n.props["data-testid"] === name)!;
const text = (root: HostNode, name: string) =>
  flatten(field(root, name))
    .map((n) => n.text)
    .join("");
async function mount(independent = false) {
  const path = "apps/desktop/src/components/AudioTimingInspector.vue";
  expect(existsSync(path)).toBe(true);
  let respond!: (value: boolean) => void;
  const commands: unknown[] = [],
    facts = {
      version: 1,
      clipId: "c",
      assetId: "a",
      revision: "r1",
      sourceHash: "a".repeat(64),
      sampleRate: 48000,
      lengthSamples: 960000,
    };
  const props = vue.reactive({
    projectId: "p",
    compositionId: "cut",
    revision: "r1",
    compositionDuration: 12,
    clip: {
      id: "c",
      assetId: "a",
      timelineStart: 6,
      timelineDuration: 6,
      sourceIn: 2,
      sourceOut: 8,
      ...(independent
        ? {
            audioTiming: {
              version: 1,
              sampleRate: 48000,
              timelineStartSample: 252001,
              sourceInSample: 60001,
              sourceOutSample: 384000,
            },
          }
        : {}),
    } as core.Clip,
    asset: {
      id: "a",
      name: "Audio",
      uri: "file:///a.mp4",
      mediaType: "video",
      duration: 20,
      contentHash: "a".repeat(64),
      tags: [],
      state: {},
      metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
    } as core.MediaAsset,
    busy: false,
    active: true,
    commit: async (command: unknown) => {
      commands.push(command);
      return new Promise<boolean>((resolve) => {
        respond = resolve;
      });
    },
  });
  const mounted = mountComponent(
    loadComponent(path, {
      "@openfilm/core": core,
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": { api: { audioHandles: async () => facts } },
      "../i18n": { formatNumber: String },
    }),
    props,
  );
  clean.push(mounted.unmount);
  await settle();
  return {
    ...mounted,
    props,
    commands,
    respond: (value: boolean) => respond(value),
  };
}
it("shows linked sound, validates verified handles, and waits for durable Apply/Reset acknowledgement", async () => {
  const { root, props, commands, respond } = await mount();
  expect(text(root, "sound-state")).toContain("linked");
  (field(root, "sound-start-ms").props.onInput as (event: unknown) => void)({
    target: { value: "-750" },
  });
  (field(root, "sound-end-ms").props.onInput as (event: unknown) => void)({
    target: { value: "0" },
  });
  await settle();
  (field(root, "sound-apply").props.onClick as () => void)();
  await settle();
  expect(commands).toEqual([
    {
      type: "audio.timing",
      clipId: "c",
      timing: {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 252000,
        sourceInSample: 60000,
        sourceOutSample: 384000,
      },
    },
  ]);
  expect(text(root, "sound-state")).toContain("linked");
  expect(field(root, "sound-apply").props.disabled).toBe(true);
  respond(false);
  await settle();
  expect(text(root, "sound-error")).toContain("saveFailed");
  expect(props.clip.audioTiming).toBeUndefined();
});
it("keeps sample remainders when editing an independent range and disables locked or exhausted changes", async () => {
  const { root, props, commands, respond } = await mount(true);
  expect(text(root, "sound-state")).toContain("independent");
  expect(text(root, "sound-sample-remainder")).toContain("1");
  (field(root, "sound-start-ms").props.onInput as (event: unknown) => void)({
    target: { value: "-1" },
  });
  await settle();
  (field(root, "sound-apply").props.onClick as () => void)();
  await settle();
  expect(commands[0]).toMatchObject({
    timing: {
      timelineStartSample: 251953,
      sourceInSample: 59953,
      sourceOutSample: 384000,
    },
  });
  respond(true);
  await settle();
  props.asset.state.locked = true;
  await settle();
  expect(field(root, "sound-apply").props.disabled).toBe(true);
  expect(text(root, "sound-hint")).toContain("locked");
  props.asset.state.locked = false;
  (field(root, "sound-start-ms").props.onInput as (event: unknown) => void)({
    target: { value: "-60001" },
  });
  await settle();
  expect(field(root, "sound-apply").props.disabled).toBe(true);
  expect(text(root, "sound-split-hint")).toContain("split");
});

it("reuses role/fade/duck controls for embedded independent sound and delegates audition to Record", async () => {
  const clip: core.Clip = {
      id: "v",
      assetId: "a",
      timelineStart: 0,
      timelineDuration: 2,
      sourceIn: 0,
      sourceOut: 2,
      audioTiming: {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 0,
        sourceInSample: 0,
        sourceOutSample: 192000,
      },
    },
    asset: core.MediaAsset = {
      id: "a",
      name: "Video",
      uri: "file:///a.mp4",
      mediaType: "video",
      duration: 10,
      tags: [],
      state: {},
      metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
    },
    commands: unknown[] = [];
  const mounted = mountComponent(
    loadComponent("apps/desktop/src/components/SoundtrackPanel.vue", {
      "@openfilm/core": core,
      "vue-i18n": { useI18n: () => ({ t: String }) },
      "../api": { sourceUrl: String },
      "../i18n": { formatDuration: String },
    }),
    {
      composition: {
        id: "c",
        storyId: "s",
        duration: 5,
        tracks: [{ id: "v", type: "video", clips: [clip] }],
      },
      assets: [asset],
      selectedClip: clip,
      busy: false,
      active: true,
      onCommand: (command: unknown) => commands.push(command),
    },
  );
  clean.push(mounted.unmount);
  await settle();
  const nodes = flatten(mounted.root);
  expect(nodes.filter((n) => n.tag === "audio")).toHaveLength(0);
  const role = nodes.find(
    (n) => n.props["data-testid"] === "selected-audio-role",
  );
  expect(role).toBeDefined();
  expect(nodes.some((n) => n.tag === "input" && n.props.max === 4)).toBe(true);
  (role!.props.onChange as (event: unknown) => void)({
    target: { value: "ambience" },
  });
  expect(commands).toEqual([
    expect.objectContaining({
      type: "audio.configure",
      clipId: "v",
      automation: expect.objectContaining({ role: "ambience" }),
    }),
  ]);
});
