import { afterEach, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import {
  vue,
  flatten,
  hostNode,
  loadComponent,
  mountComponent,
  type HostNode,
} from "./helpers/vue-sfc-host";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.unstubAllGlobals();
});
async function settle() {
  await vue.nextTick();
  await vue.nextTick();
}
async function mountPhoto(diptych = false, text = false) {
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const component = loadComponent(
    "apps/desktop/src/components/PhotoPresentationPreview.vue",
    {
      "@openfilm/core": core,
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        sourceUrl: (id: string, version?: string | number) =>
          `/source/${id}?v=${encodeURIComponent(version ?? "")}`,
        titlePreviewUrl: () => "/title.png",
        photoFillPreviewUrl: (
          _composition: string,
          _clip: string,
          revision: string,
          project: string,
        ) => `/fill/${project}/${revision}.png`,
      },
      "../i18n": { formatDuration: String },
    },
  );
  const clip: core.Clip = {
    id: "photo",
    assetId: "primary",
    timelineStart: 0,
    timelineDuration: 5,
    layout: diptych
      ? { version: 1, preset: "diptych", secondary: { assetId: "secondary" } }
      : { version: 1, preset: "contain" },
  };
  const assets: core.MediaAsset[] = ["primary", "secondary"].map((id) => ({
    id,
    name: id,
    uri: `file:///old/${id}.png`,
    mediaType: "image",
    dimensions: { width: 640, height: 480 },
    tags: [],
    state: {},
    metadata: {},
  }));
  if (text) {
    delete clip.layout;
    clip.title = "粗體字幕";
    clip.titleStyle = {
      version: 1,
      role: "subtitle",
      fadeOut: 2,
      fontWeight: 700,
    };
  }
  const props = vue.reactive({
    clip,
    assets,
    frame: { width: 320, height: 180, frameRate: 24 },
    viewport: { width: 640, height: 360 },
    transportTarget: "#photo-controls",
    compositionId: "film",
    projectId: "project",
    revision: "revision",
    active: true,
    sourceVersion: 1,
  });
  const controls = hostNode("div");
  const { root, unmount } = mountComponent(component, props, {
    "#photo-controls": controls,
  });
  cleanup.push(unmount);
  await settle();
  const images = () => flatten(root).filter((element) => element.tag === "img");
  const failed = () =>
    flatten(root).some(
      (element) =>
        element.props.role === "status" &&
        (element.text.includes("editor.presentation.sourceWarning") ||
          element.text.includes("editor.presentation.fillFailed")),
    );
  const error = async (image: HostNode) => {
    (image.props.onError as () => void)();
    await settle();
  };
  const load = async (image: HostNode) => {
    (image.props.onLoad as (() => void) | undefined)?.();
    await settle();
  };
  return { props, images, failed, error, load, controls };
}

it("requires current ambient readiness and ignores failed images removed by a source reconnect", async () => {
  const photo = await mountPhoto();
  photo.props.clip = {
    ...photo.props.clip,
    layout: {
      version: 2,
      preset: "contain",
      fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
    },
  };
  await settle();
  const ambient = photo
    .images()
    .find((image) => image.props.class === "photo-presentation-ambient");
  expect(ambient).toBeDefined();
  await photo.error(ambient!);
  expect(photo.failed()).toBe(true);
  photo.props.sourceVersion++;
  await settle();
  const current = photo
    .images()
    .find((image) => image.props.class === "photo-presentation-ambient")!;
  expect(current).not.toBe(ambient);
  await photo.load(current);
  await photo.load(
    photo
      .images()
      .find((image) => image.props.class !== "photo-presentation-ambient")!,
  );
  expect(photo.failed()).toBe(false);
  await photo.error(ambient!);
  expect(photo.failed()).toBe(false);
});

it("retains direct legacy image children for Record readiness and existing Monitor integration", async () => {
  const photo = await mountPhoto(true);
  expect(photo.images()).toHaveLength(2);
  for (const image of photo.images())
    expect(image.parent?.props.class).toBe("photo-presentation-layers");
});

it("fades a plain photo's native bold text using the existing local seek clock without fading its source", async () => {
  const photo = await mountPhoto(false, true);
  const title = () =>
    photo
      .images()
      .find((image) => image.props.class === "photo-presentation-title")!;
  expect((title().props.style as { opacity: number }).opacity).toBe(1);
  const seek = flatten(photo.controls).find(
    (element) => element.tag === "input",
  )!;
  (seek.props.onInput as (event: { target: { value: string } }) => void)({
    target: { value: "4" },
  });
  await settle();
  expect((title().props.style as { opacity: number }).opacity).toBe(0.5);
  expect(photo.images()[0]!.props.style).not.toHaveProperty("opacity");
  photo.props.clip = { ...photo.props.clip, timelineDuration: 3 };
  await settle();
  expect((title().props.style as { opacity: number }).opacity).toBe(0);
});

it("reloads a failed photo after a same-ID URI relink and ignores the removed source error", async () => {
  const photo = await mountPhoto();
  const first = photo.images()[0]!;
  await photo.error(first);
  expect(photo.failed()).toBe(true);
  photo.props.assets = photo.props.assets.map((asset: core.MediaAsset) =>
    asset.id === "primary"
      ? { ...asset, uri: "file:///new/primary.png" }
      : asset,
  );
  await settle();
  expect(photo.images()[0] === first).toBe(false);
  expect(photo.images()[0]!.props.src).not.toBe(first.props.src);
  await photo.load(photo.images()[0]!);
  expect(photo.failed()).toBe(false);
  await photo.error(first);
  expect(photo.failed()).toBe(false);
});

it("recovers after only the source reconnect version changes", async () => {
  const photo = await mountPhoto();
  const first = photo.images()[0]!;
  await photo.error(first);
  expect(photo.failed()).toBe(true);
  photo.props.sourceVersion += 1;
  await settle();
  await photo.load(photo.images()[0]!);
  expect(photo.failed()).toBe(false);
  await photo.error(first);
  expect(photo.failed()).toBe(false);
});

it("keeps the diptych warning until every current failed layer has recovered", async () => {
  const photo = await mountPhoto(true);
  const [primary, secondary] = photo.images();
  await photo.error(primary!);
  await photo.error(secondary!);
  await photo.load(primary!);
  expect(photo.failed()).toBe(true);
  await photo.load(secondary!);
  expect(photo.failed()).toBe(false);
  await photo.error(secondary!);
  photo.props.assets = photo.props.assets.map((asset: core.MediaAsset) =>
    asset.id === "secondary"
      ? { ...asset, uri: "file:///new/secondary.png" }
      : asset,
  );
  await settle();
  await photo.load(photo.images()[1]!);
  expect(photo.failed()).toBe(false);
  await photo.error(secondary!);
  expect(photo.failed()).toBe(false);
});

it("clears a removed diptych layer failure when the layout becomes a single photo", async () => {
  const photo = await mountPhoto(true);
  await photo.error(photo.images()[1]!);
  expect(photo.failed()).toBe(true);
  photo.props.clip = {
    ...photo.props.clip,
    layout: { version: 1, preset: "contain" },
  };
  await settle();
  expect(photo.images()).toHaveLength(1);
  expect(photo.failed()).toBe(false);
});
