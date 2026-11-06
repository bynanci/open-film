// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import {
  flatten,
  loadComponent,
  mountComponent,
  type HostNode,
} from "./helpers/vue-sfc-host";

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup()),
);

function asset(dimensions?: MediaAsset["dimensions"]): MediaAsset {
  return {
    id: "memory",
    uri: "/memories/photo.jpg",
    mediaType: "image",
    name: "photo.jpg",
    dimensions,
    tags: [],
    state: {},
    metadata: {},
    thumbnailUri: "/cache/photo.jpg",
  };
}

function mount(dimensions?: MediaAsset["dimensions"]) {
  const component = loadComponent("apps/desktop/src/components/AssetCard.vue", {
    "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
    "../api": { thumbnailUrl: () => "/thumbnail" },
    "../i18n": { formatDuration: () => "00:00" },
    "../sourcePresentation": {
      sourcePresentation: () => ({
        requiresReframedExport: false,
        previewSupported: true,
      }),
    },
    "./Icon.vue": { render: () => null },
  });
  const view = mountComponent(component, { asset: asset(dimensions) });
  cleanups.push(view.unmount);
  return flatten(view.root).find(
    (node: HostNode) => node.props.class === "asset-image-button",
  )!;
}

describe("memory thumbnails preserve source composition", () => {
  it.each([
    {
      name: "portrait",
      dimensions: { width: 900, height: 1600 },
      ratio: "0.68",
      fit: "contain",
    },
    {
      name: "landscape",
      dimensions: { width: 1600, height: 900 },
      ratio: "1.6",
      fit: "contain",
    },
    {
      name: "square",
      dimensions: { width: 1200, height: 1200 },
      ratio: "1",
      fit: "cover",
    },
    {
      name: "missing metadata",
      dimensions: undefined,
      ratio: "1",
      fit: "cover",
    },
  ])(
    "keeps $name media in a bounded, composition-aware tile",
    ({ dimensions, ratio, fit }) => {
      const button = mount(dimensions);
      expect(button.props.style).toMatchObject({
        "--asset-aspect-ratio": ratio,
        "--asset-object-fit": fit,
      });
    },
  );
});
