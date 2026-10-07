import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

interface Asset {
  id: string;
  name: string;
  rating?: number;
  state: { favorite?: boolean; locked?: boolean; rejected?: boolean };
}
type StateKey = "favorite" | "locked" | "rejected";
interface VNode {
  type: unknown;
  props?: Record<string, unknown> | null;
  children?: unknown;
}
const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
const vue = requireDesktop("vue") as {
  ref: <T>(value: T) => { value: T };
  proxyRefs: <T extends object>(value: T) => T;
  [key: string]: unknown;
};
const { parse, compileTemplate } = requireDesktop("@vue/compiler-sfc") as {
  parse: (source: string) => { descriptor: { template: { content: string } } };
  compileTemplate: (options: object) => { code: string; errors: unknown[] };
};
const appSource = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const cardSource = readFileSync(
  resolve("apps/desktop/src/components/AssetCard.vue"),
  "utf8",
);
function renderTemplate(template: string) {
  const compiled = compileTemplate({
    source: template,
    id: "pending-selection",
  });
  if (compiled.errors.length) throw new Error(String(compiled.errors));
  const compiledCode = transformSync(compiled.code, { format: "cjs" }).code;
  const module = {
    exports: {} as { render?: (values: object, cache: object[]) => VNode },
  };
  new Function("require", "module", "exports", compiledCode)(
    () => ({ ...vue, resolveComponent: (name: string) => name }),
    module,
    module.exports,
  );
  return (values: object) => module.exports.render!(values, []);
}
const renderCard = renderTemplate(
  parse(cardSource).descriptor.template.content,
);
const inspector = appSource.match(
  /<div class="inspector-controls">([\s\S]*?)<\/div>/u,
)?.[0];
const libraryCard = appSource.match(
  /<AssetCard\s+v-for="asset in assets"[\s\S]*?\/>/u,
)?.[0];
const clearRating = appSource.match(
  /<button\s+v-if="selectedAsset.rating"[\s\S]*?class="text-button clear-rating"[\s\S]*?<\/button>/u,
)?.[0];
if (!inspector || !libraryCard || !clearRating)
  throw new Error("Missing actual Library mutation controls");
const renderInspector = renderTemplate(inspector);
const renderLibraryCard = renderTemplate(libraryCard);
const renderClearRating = renderTemplate(clearRating);
const appFunctions = ["run", "toggleAsset", "rateAsset"];
const appCode = transformSync(
  appFunctions
    .map((name) => {
      const start = appSource.indexOf(`async function ${name}(`);
      const end = appSource.indexOf("\n}", start) + 2;
      if (start < 0 || end < 2) throw new Error(`Missing App function ${name}`);
      return appSource.slice(start, end);
    })
    .join("\n"),
  { loader: "ts", format: "esm" },
).code;
function nodes(value: unknown): VNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("type" in value)) return [];
  const node = value as VNode;
  return [node, ...nodes(node.children)];
}
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function host() {
  const held = deferred<void>();
  const remembered: Asset = {
    id: "spoken-memory",
    name: "spoken.mp4",
    rating: 5,
    state: {},
  };
  const exactCopy: Asset = { id: "exact-copy", name: "copy.jpg", state: {} };
  const dependencies = {
    busy: vue.ref(""),
    error: vue.ref<unknown>(""),
    notice: vue.ref<unknown>(null),
    assetCache: vue.ref<Record<string, Asset>>({
      [remembered.id]: remembered,
      [exactCopy.id]: exactCopy,
    }),
    assets: vue.ref([remembered, exactCopy]),
    stateFilter: vue.ref(""),
    reloadAssets: vi.fn(async () => {}),
    cacheAssets: (incoming: Asset[]) => {
      for (const asset of incoming)
        dependencies.assetCache.value[asset.id] = asset;
    },
    patch: vi.fn(
      async (
        path: string,
        patch: { state?: Asset["state"]; rating?: number },
      ) => {
        if (dependencies.patch.mock.calls.length === 1) await held.promise;
        const id = path.split("/").at(-1)!;
        const previous = dependencies.assetCache.value[id]!;
        return {
          asset: {
            ...previous,
            ...patch,
            state: { ...previous.state, ...patch.state },
          },
        };
      },
    ),
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies;\n${appCode}\nreturn {${appFunctions.join(",")}};`,
  )(dependencies) as {
    toggleAsset: (asset: Asset, key: StateKey) => Promise<void>;
    rateAsset: (asset: Asset, rating: number) => Promise<void>;
  };
  const t = (key: string) => key;
  function controls(asset: Asset) {
    const values = vue.proxyRefs({
      ...dependencies,
      selectedAsset: asset,
      selectedAssetId: asset.id,
      sourceStatuses: {},
      toggleAsset: app.toggleAsset,
      inspectAsset: vi.fn(),
      rateAsset: app.rateAsset,
      t,
    });
    const parentCard = nodes(renderLibraryCard(values)).find(
      (node) =>
        node.type === "AssetCard" &&
        (node.props?.asset as Asset | undefined)?.id === asset.id,
    )!;
    const child = renderCard({
      ...parentCard.props,
      mutationDisabled: parentCard.props?.["mutation-disabled"],
      sourceInfo: { requiresReframedExport: false, previewSupported: true },
      kind: "kindVideo",
      t,
      $emit: (_event: string, selected: Asset, key: StateKey) =>
        app.toggleAsset(selected, key),
    });
    const card = nodes(child).filter(
      (node) =>
        node.type === "button" &&
        node.props?.["aria-label"] &&
        String(node.props["aria-label"]).startsWith("media.card.") &&
        String(node.props["aria-label"]) !== "media.card.inspect",
    );
    const inspect = nodes(child).find(
      (node) =>
        node.type === "button" &&
        node.props?.["aria-label"] === "media.card.inspect",
    )!;
    const inspectorButtons = nodes(renderInspector(values)).filter(
      (node) => node.type === "button",
    );
    const clear = nodes(renderClearRating(values)).find(
      (node) => node.type === "button",
    );
    return { card, inspector: inspectorButtons, clear, inspect };
  }
  return { ...dependencies, ...app, held, remembered, exactCopy, controls };
}

// Compile the real Vue templates and run App's real mutation functions. Only
// transport is held, reproducing a slow acknowledged PATCH without timers.
describe("Library mutation controls during a pending asset acknowledgement", () => {
  it("keeps inspection usable and enables idle mutation controls", () => {
    const h = host();
    const controls = h.controls(h.remembered);
    expect(controls.card).toHaveLength(3);
    expect(controls.inspector).toHaveLength(3);
    for (const button of [
      ...controls.card,
      ...controls.inspector,
      controls.clear!,
    ])
      expect(!!button.props?.disabled).toBe(false);
  });

  it.each<StateKey>(["favorite", "locked", "rejected"])(
    "a pending %s acknowledgement blocks equivalent controls until Reject can be sent",
    async (key) => {
      const h = host();
      const saving = h.toggleAsset(h.remembered, key);
      expect(h.busy.value).toBe("savingSelection");
      const controls = h.controls(h.exactCopy);
      expect(controls.card).toHaveLength(3);
      expect(controls.inspector).toHaveLength(3);
      for (const button of [...controls.card, ...controls.inspector])
        expect(button.props?.disabled).toBe(true);
      expect(!!controls.inspect.props?.disabled).toBe(false);
      // A native disabled button cannot emit this second action. After the
      // first acknowledgement it becomes actionable and sends the real PATCH.
      expect(h.patch).toHaveBeenCalledTimes(1);
      h.held.release();
      await saving;
      const ready = h
        .controls(h.exactCopy)
        .card.find(
          (button) => button.props?.["aria-label"] === "media.card.reject",
        )!;
      expect(!!ready.props?.disabled).toBe(false);
      await (ready.props!.onClick as () => Promise<void>)();
      expect(h.patch).toHaveBeenCalledTimes(2);
      expect(h.assetCache.value[h.exactCopy.id]!.state.rejected).toBe(true);
    },
  );

  it.each([0, 5])(
    "pending rating %s disables card, inspector and clear-rating mutations",
    async (rating) => {
      const h = host();
      const saving = h.rateAsset(h.remembered, rating);
      const controls = h.controls(h.remembered);
      for (const button of [
        ...controls.card,
        ...controls.inspector,
        controls.clear!,
      ])
        expect(button.props?.disabled).toBe(true);
      h.held.release();
      await saving;
      expect(h.busy.value).toBe("");
      expect(h.assetCache.value[h.remembered.id]!.rating).toBe(rating);
    },
  );
});
