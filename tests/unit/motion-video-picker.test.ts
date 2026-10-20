import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
  type HostNode,
} from "./helpers/vue-sfc-host.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  vi.unstubAllGlobals();
});
const video = (number: number) => ({
  id: `video-${number}`,
  name: `Video ${String(number).padStart(3, "0")}`,
  mediaType: "video",
  uri: `file:///synthetic/${number}.mp4`,
  state: { locked: number === 2, rejected: number === 3 },
  metadata: {},
});
async function settle() {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
    await vue.nextTick();
  }
}
async function fixture() {
  class HostDocument {
    activeElement = null;
  }
  vi.stubGlobal("Document", HostDocument);
  vi.stubGlobal("ShadowRoot", class {});
  vi.stubGlobal("document", new HostDocument());
  const library = Array.from({ length: 205 }, (_, i) => video(i + 1));
  const assets = vi.fn(async (params: URLSearchParams) => {
    const found = library.filter((item) =>
      item.name.includes(params.get("search") ?? ""),
    );
    const offset = Number(params.get("offset") ?? 0);
    return {
      assets: found.slice(offset, offset + Number(params.get("limit"))),
      total: found.length,
    };
  });
  const previewMotion = vi.fn(
    async (_input: unknown, _signal?: AbortSignal) => [],
  );
  const component = loadComponent(
    "apps/desktop/src/components/MotionGenerationPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        api: { assets, previewMotion, revokeMotion: async () => {} },
        sourceUrl: String,
        motionMediaUrl: String,
      },
    },
  );
  const props = vue.reactive({
    projectId: "project",
    compositionId: "film",
    sourceVersion: 0,
    state: { revision: "saved", composition: { graphicScenes: [] } },
    clip: { id: "photo", timelineStart: 0, timelineDuration: 4 },
    asset: { id: "photo-source", mediaType: "image", metadata: {} },
    frame: { width: 160, height: 90, frameRate: 12 },
    disabled: false,
    flushInputs: async () => true,
  });
  const mounted = mountComponent(component, props);
  cleanup.push(mounted.unmount);
  const nodes = () => flatten(mounted.root);
  const button = (key: string) =>
    nodes().find((node) => node.tag === "button" && node.text === key);
  async function click(key: string) {
    const found = button(key);
    expect(found).toBeDefined();
    expect(found!.props.disabled).not.toBe(true);
    await (found!.props.onClick as () => unknown)();
    await settle();
  }
  function model(node: HostNode, value: unknown) {
    (node.props["onUpdate:modelValue"] as (value: unknown) => void)(value);
  }
  model(
    nodes().find((node) => node.tag === "select")!,
    "local-motion-import",
  );
  await settle();
  const choose = async (id: string) => {
    const input = nodes().find(
      (node) => node.tag === "input" && node.props.value === id,
    );
    expect(input).toBeDefined();
    expect(input!.props.disabled).not.toBe(true);
    if (typeof input!.props.onChange === "function")
      await (input!.props.onChange as (event: unknown) => unknown)({
        target: { checked: !input!.props.checked },
      });
    else model(input!, [id]);
    await settle();
  };
  return {
    ...mounted,
    props,
    nodes,
    assets,
    previewMotion,
    button,
    click,
    choose,
    model,
  };
}

describe("external motion Library picker", () => {
  it("reaches videos after the first100, keeps at most3 cross-page choices and submits their exact IDs", async () => {
    const h = await fixture();
    await h.click("motion.loadVideos");
    expect(
      h
        .nodes()
        .filter(
          (node) =>
            node.tag === "input" &&
            String(node.props.value).startsWith("video-"),
        ).length,
    ).toBeLessThanOrEqual(100);
    expect(h.nodes().some((node) => node.props.value === "video-2")).toBe(
      false,
    );
    expect(h.nodes().some((node) => node.props.value === "video-3")).toBe(
      false,
    );
    await h.choose("video-1");
    await h.click("motion.nextVideos");
    await h.choose("video-101");
    await h.click("motion.nextVideos");
    await h.choose("video-205");
    expect(h.button("motion.nextVideos")?.props.disabled).toBe(true);
    expect(
      h.nodes().find((node) => node.props.value === "video-204")?.props
        .disabled,
    ).toBe(true);
    await h.click("motion.previousVideos");
    expect(
      h.nodes().find((node) => node.props.value === "video-101")?.props.checked,
    ).toBe(true);
    const labels = h.nodes().filter((node) => node.tag === "label");
    const inputFor = (key: string) =>
      flatten(
        labels.find((label) =>
          flatten(label).some((node) => node.text === key),
        )!,
      ).find((node) => node.tag === "input" || node.tag === "textarea")!;
    h.model(inputFor("motion.prompt"), "Synthetic intent");
    h.model(inputFor("motion.negative"), "Preserve detail");
    h.model(inputFor("motion.consent"), true);
    await settle();
    await h.click("motion.generate");
    expect(h.previewMotion.mock.calls[0]![0]).toMatchObject({
      projectId: "project",
      candidateAssetIds: ["video-1", "video-101", "video-205"],
    });
    for (const [params] of h.assets.mock.calls)
      expect(Number(params.get("limit"))).toBeLessThanOrEqual(200);
  });

  it("searches the full Library and starts changed searches on the first page", async () => {
    const h = await fixture();
    await h.click("motion.loadVideos");
    await h.click("motion.nextVideos");
    const search = h
      .nodes()
      .find((node) => node.tag === "input" && node.props.type === "search");
    expect(search).toBeDefined();
    h.model(search!, "Video 205");
    await h.click("motion.loadVideos");
    expect(h.nodes().some((node) => node.props.value === "video-205")).toBe(
      true,
    );
    expect(h.button("motion.previousVideos")?.props.disabled).toBe(true);
    expect(h.assets.mock.calls.at(-1)![0].get("offset")).toBe("0");
    expect(h.assets.mock.calls.at(-1)![0].get("search")).toBe("Video 205");
  });

  it.each(["project", "revision", "source"])(
    "clears selected video identities and ignores a delayed read after %s changes",
    async (owner) => {
      const h = await fixture();
      await h.click("motion.loadVideos");
      await h.choose("video-1");
      let resolve!: (value: {
        assets: ReturnType<typeof video>[];
        total: number;
      }) => void;
      const pending = new Promise<{
        assets: ReturnType<typeof video>[];
        total: number;
      }>((done) => {
        resolve = done;
      });
      h.assets.mockImplementationOnce(() => pending);
      const loading = h.click("motion.loadVideos");
      await settle();
      if (owner === "project") h.props.projectId = "foreign";
      else if (owner === "revision") h.props.state.revision = "new-saved";
      else h.props.sourceVersion++;
      await settle();
      resolve({ assets: [video(999)], total: 1 });
      await loading;
      expect(
        h.nodes().some((node) => String(node.props.value).startsWith("video-")),
      ).toBe(false);
      expect(h.nodes().some((node) => node.props.role === "alert")).toBe(false);
    },
  );

  it("cancels a pending page and ignores its late failure while allowing a fresh load", async () => {
    const h = await fixture();
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    h.assets.mockImplementationOnce(() => pending);
    const loading = h.click("motion.loadVideos");
    await settle();
    await h.click("motion.cancel");
    reject(new Error("Old request failed"));
    await loading;
    expect(h.nodes().some((node) => node.props.role === "alert")).toBe(false);
    await h.click("motion.loadVideos");
    expect(h.nodes().some((node) => node.props.value === "video-1")).toBe(true);
  });
});
