// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
});
async function flush() {
  await Promise.resolve();
  await vue.nextTick();
  await Promise.resolve();
  await vue.nextTick();
}
it("drops late caption decode after a project switch and uses half-open Composition frames", async () => {
  const path = "apps/desktop/src/components/NativeCaptionPreview.vue";
  expect(existsSync(path)).toBe(true);
  const pending: Array<{
    resolve: (value: Blob) => void;
    signal: AbortSignal;
  }> = [];
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const revoked: string[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:${pending.length}`,
    revokeObjectURL: (value: string) => revoked.push(value),
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return Promise.resolve();
      }
    },
  );
  const props = vue.reactive({
    compositionId: "film",
    projectId: "one",
    revision: "r1",
    frame: 26,
    frameRate: 30,
    active: true,
    composition: {
      id: "film",
      storyId: "s",
      duration: 2,
      tracks: [],
      captionTracks: [
        {
          version: 1,
          id: "captions",
          name: "Captions",
          style: { version: 1, role: "subtitle" },
          cues: [
            {
              version: 1,
              id: "cue",
              startMs: 900,
              endMs: 1500,
              text: "A",
              source: { kind: "manual" },
              manualRevision: 0,
            },
          ],
        },
      ],
    },
  });
  const mounted = mountComponent(
    loadComponent(path, {
      "@openfilm/core": core,
      "vue-i18n": { useI18n: () => ({ t: String }) },
      "../api": {
        nativeTextOverlay: (_input: unknown, signal: AbortSignal) =>
          new Promise<Blob>((resolve) => pending.push({ resolve, signal })),
        nativeTextInspection: async () => ({
          status: "measured",
          runFonts: [],
          warnings: [],
        }),
      },
    }),
    props,
  );
  cleanup.push(mounted.unmount);
  expect(pending).toHaveLength(0);
  props.frame = 27;
  await flush();
  expect(pending).toHaveLength(1);
  props.projectId = "two";
  await flush();
  expect(pending[0]!.signal.aborted).toBe(true);
  expect(pending).toHaveLength(2);
  pending[0]!.resolve(new Blob(["old"]));
  await flush();
  expect(
    flatten(mounted.root).filter((node) => node.tag === "img"),
  ).toHaveLength(0);
  pending[1]!.resolve(new Blob(["new"]));
  await flush();
  expect(
    flatten(mounted.root).filter((node) => node.tag === "img"),
  ).toHaveLength(1);
  props.frame = 45;
  await flush();
  expect(
    flatten(mounted.root).filter((node) => node.tag === "img"),
  ).toHaveLength(0);
  expect(revoked.length).toBeGreaterThan(0);
});

it("draws overlapping active cues in the same sorted order as MP4 and clears an expired cue", async () => {
  const path = "apps/desktop/src/components/NativeCaptionPreview.vue";
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  let serial = 0;
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:${++serial}`,
    revokeObjectURL: () => {},
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return Promise.resolve();
      }
    },
  );
  const cue = {
    version: 1,
    startMs: 900,
    endMs: 1500,
    text: "A",
    source: { kind: "manual" },
    manualRevision: 0,
  };
  const props = vue.reactive({
    compositionId: "film",
    projectId: "one",
    revision: "r1",
    frame: 33,
    frameRate: 30,
    frameWidth: 320,
    frameHeight: 180,
    active: true,
    composition: {
      id: "film",
      storyId: "s",
      duration: 2,
      tracks: [],
      captionTracks: [
        {
          version: 1,
          id: "captions",
          name: "Captions",
          style: { version: 1, role: "subtitle" },
          cues: [
            { ...cue, id: "later", startMs: 1000, endMs: 1600 },
            { ...cue, id: "earlier" },
          ],
        },
      ],
    },
  });
  const mounted = mountComponent(
    loadComponent(path, {
      "@openfilm/core": core,
      "vue-i18n": { useI18n: () => ({ t: String }) },
      "../api": {
        nativeTextOverlay: async () => new Blob(["png"]),
        nativeTextInspection: async () => ({
          status: "measured",
          runFonts: [],
          warnings: [],
        }),
      },
    }),
    props,
  );
  cleanup.push(mounted.unmount);
  for (let turn = 0; turn < 8; turn++) await flush();
  expect(
    flatten(mounted.root)
      .filter((node) => node.tag === "img")
      .map((node) => node.props["data-cue-id"]),
  ).toEqual(["earlier", "later"]);
  props.frame = 45;
  for (let turn = 0; turn < 8; turn++) await flush();
  expect(
    flatten(mounted.root)
      .filter((node) => node.tag === "img")
      .map((node) => node.props["data-cue-id"]),
  ).toEqual(["later"]);
});
