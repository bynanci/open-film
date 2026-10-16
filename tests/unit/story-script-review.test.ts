import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../apps/desktop/src/api";
import en from "../../apps/desktop/src/i18n/locales/en-US";
import zh from "../../apps/desktop/src/i18n/locales/zh-TW";
import ja from "../../apps/desktop/src/i18n/locales/ja-JP";

const requireDesktop = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const vue = requireDesktop("vue");
const { parse, compileScript, compileTemplate } =
  requireDesktop("vue/compiler-sfc");
const { renderToString } = requireDesktop("vue/server-renderer");
const { createI18n } = requireDesktop("vue-i18n");
type Field = "narration" | "visualDirection";
type Suggestion = {
  id: string;
  kind: "scene-script";
  target: { storyId: string; beatId: string; field: Field };
  before: string;
  after: string;
  reason: string;
  status: "pending" | "accepted" | "skipped" | "stale";
  sourceRevisionId: string;
  source: { type: "provider"; id: string };
  createdAt: string;
};
type Panel = {
  field: { value: Field };
  history: { value: boolean };
  busy: { value: boolean };
  data: {
    value: { suggestions: Suggestion[]; total: number; revision: string };
  };
  refresh: (offset?: number) => Promise<void>;
  generate: () => Promise<void>;
  accept: (suggestion: Suggestion) => Promise<void>;
  skip: (suggestion: Suggestion) => Promise<void>;
  consent: (allow: boolean) => Promise<void>;
  retryAcceptance: () => Promise<void>;
  flushPending: () => Promise<boolean>;
};
let factory: (dependencies: Record<string, unknown>) => Panel;
let render: unknown;
const cleanup: Array<() => void> = [];
beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/components/StoryScriptReview.vue",
      import.meta.url,
    ),
    "utf8",
  );
  const { descriptor } = parse(source);
  const bindings = compileScript(descriptor, { id: "story-review" }).bindings;
  const setup = (
    await transform(descriptor.scriptSetup.content, {
      loader: "ts",
      format: "esm",
    })
  ).code.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");
  factory = (dependencies) =>
    new Function(
      "dependencies",
      `const {${Object.keys(dependencies).join(",")}}=dependencies;\n${setup}\nreturn {${Object.keys(
        bindings,
      )
        .filter((key) => bindings[key] !== "props")
        .join(",")}};`,
    )(dependencies);
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: "StoryScriptReview.vue",
    id: "story-review",
    compilerOptions: { bindingMetadata: bindings },
  });
  expect(compiled.errors).toEqual([]);
  const code = (
    await transform(compiled.code, { loader: "ts", format: "esm" })
  ).code
    .replace(
      /import \{([^}]+)\} from "vue"/gu,
      (_match: string, names: string) =>
        `const {${names
          .split(",")
          .map((name) => name.trim().replace(/\s+as\s+/u, ":"))
          .join(",")}}=Vue;`,
    )
    .replace("export function render", "function render")
    .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "");
  render = new Function("Vue", `${code};return render;`)(vue);
});
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});
function suggestion(field: Field = "narration"): Suggestion {
  return {
    id: `suggestion-${field}`,
    kind: "scene-script",
    target: { storyId: "story", beatId: "beat", field },
    before: "Our original words",
    after: "Our reviewed words",
    reason: "An explicit fixture reason",
    status: "pending",
    sourceRevisionId: "field-revision",
    source: { type: "provider", id: "local-fixture" },
    createdAt: "2026-10-16T00:00:00Z",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function drain() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await vue.nextTick();
}
function fixture(storage = new Map<string, string>(), locale = "en-US") {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const props = vue.reactive({
    projectId: "project",
    storyId: "story",
    beatId: "beat",
    disabled: false,
    jobs: [],
    prepare: vi.fn(async () => true),
  });
  const emit = vi.fn();
  const story = {
    id: "story",
    title: "Saved Story",
    beats: [
      {
        id: "beat",
        title: "Beat",
        script: {
          narration: "Our reviewed words",
          visualDirection: "Keep direction",
        },
      },
    ],
  };
  const api = {
    reviewProvider: vi.fn(async () => ({
      configured: true,
      available: true,
      provider: {
        id: "local-fixture",
        name: "Local fixture",
        execution: "local",
        dataKinds: ["text"],
      },
    })),
    reviewConsent: vi.fn(async () => ({ configured: true, available: true })),
    scriptReviewSuggestions: vi.fn(
      async (_storyId: string, input: { field: Field; offset?: number }) => ({
        suggestions: [suggestion(input.field)],
        total: 1,
        offset: input.offset ?? 0,
        limit: 10,
        revision: "field-revision",
      }),
    ),
    runScriptReview: vi.fn(async () => ({
      job: { id: "job", type: "scene-script-review", status: "queued" },
    })),
    acceptScriptSuggestion: vi.fn(
      async (
        _id: string,
        _receipt: { baseRevision: string; requestId: string },
      ) => ({ story }),
    ),
    skipScriptSuggestion: vi.fn(async () => ({
      suggestion: { ...suggestion(), status: "skipped" },
    })),
    reviewRecovery: vi.fn(async () => ({
      jobId: "job",
      ownerState: "alive",
      manualRecoveryAllowed: false,
    })),
    recoverReview: vi.fn(async () => ({
      job: { id: "job", status: "cancelled" },
    })),
  };
  let dispose = () => {};
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: { "en-US": en, "zh-TW": zh, "ja-JP": ja },
  });
  const scope = vue.effectScope();
  const panel = scope.run(() =>
    factory({
      ...vue,
      api,
      ApiError,
      post: vi.fn(),
      useI18n: () => ({ t: i18n.global.t }),
      errorDetail: String,
      localizeError: String,
      formatNumber: String,
      defineProps: () => props,
      defineEmits: () => emit,
      defineExpose: () => {},
      onMounted: () => {},
      onBeforeUnmount: (stop: () => void) => {
        dispose = stop;
      },
    }),
  )! as Panel;
  cleanup.push(() => {
    dispose();
    scope.stop();
  });
  const html = () =>
    renderToString(vue.createSSRApp({ setup: () => panel, render }));
  return {
    panel,
    props,
    api,
    emit,
    storage,
    story,
    html,
    dispose: () => dispose(),
  };
}

describe("saved Story script review", () => {
  it("requests bounded suggestions for only the selected saved field and renders their evidence", async () => {
    const h = fixture();
    await h.panel.refresh();
    expect(h.api.scriptReviewSuggestions).toHaveBeenLastCalledWith("story", {
      beatId: "beat",
      field: "narration",
      status: "pending",
      offset: 0,
      limit: 10,
    });
    const html = await h.html();
    expect(html).toContain("Our original words");
    expect(html).toContain("Our reviewed words");
    expect(html).toContain("An explicit fixture reason");
    expect(html).toContain('data-testid="script-review-accept"');
    expect(h.api.acceptScriptSuggestion).not.toHaveBeenCalled();
    h.panel.field.value = "visualDirection";
    await drain();
    await h.panel.refresh();
    expect(h.api.scriptReviewSuggestions).toHaveBeenLastCalledWith("story", {
      beatId: "beat",
      field: "visualDirection",
      status: "pending",
      offset: 0,
      limit: 10,
    });
  });
  it("keeps the optional-provider absence honest without sending a generation request", async () => {
    const h = fixture();
    h.api.reviewProvider.mockResolvedValue({
      configured: false,
      available: false,
    } as never);
    await h.panel.refresh();
    await h.panel.generate();
    expect(await h.html()).toContain(en.scriptReview.providerMissing);
    expect(h.api.runScriptReview).not.toHaveBeenCalled();
  });
  it("reserves navigation through draft preparation and transport, aborting when saving leaves newer typing", async () => {
    const h = fixture();
    await h.panel.refresh();
    const prepared = deferred<boolean>();
    h.props.prepare.mockImplementation(() => prepared.promise);
    const work = h.panel.generate();
    let settled = false;
    const navigation = h.panel.flushPending().then((ok) => {
      settled = true;
      return ok;
    });
    await drain();
    expect(settled).toBe(false);
    expect(h.api.runScriptReview).not.toHaveBeenCalled();
    prepared.resolve(false);
    await work;
    expect(await navigation).toBe(false);
    expect(h.api.runScriptReview).not.toHaveBeenCalled();
  });
  it("sends only the chosen field after draft preparation and never applies provider output", async () => {
    const h = fixture();
    await h.panel.refresh();
    h.panel.field.value = "visualDirection";
    await drain();
    await h.panel.refresh();
    await h.panel.generate();
    expect(h.props.prepare).toHaveBeenCalledTimes(1);
    expect(h.api.runScriptReview).toHaveBeenCalledWith("story", {
      beatId: "beat",
      field: "visualDirection",
    });
    expect(h.emit.mock.calls.some((call) => call[0] === "accepted")).toBe(
      false,
    );
  });
  it("publishes an accepted Story before a failed follow-up read", async () => {
    const h = fixture();
    await h.panel.refresh();
    h.api.scriptReviewSuggestions.mockRejectedValue(
      new Error("read unavailable"),
    );
    await h.panel.accept(suggestion());
    expect(h.emit).toHaveBeenCalledWith("accepted", h.story);
    expect(h.storage.size).toBe(0);
    expect(await h.panel.flushPending()).toBe(true);
  });
  it("retains a lost-ack receipt and offers exact retry even after the pending card disappears and after remount", async () => {
    const h = fixture();
    await h.panel.refresh();
    h.api.acceptScriptSuggestion.mockRejectedValue(
      new Error("lost acknowledgement"),
    );
    await h.panel.accept(suggestion());
    const original = h.api.acceptScriptSuggestion.mock.calls[0];
    expect(original).toBeDefined();
    expect(h.storage.size).toBe(1);
    h.api.scriptReviewSuggestions.mockResolvedValue({
      suggestions: [],
      total: 0,
      offset: 0,
      limit: 10,
      revision: "accepted-revision",
    });
    await h.panel.refresh();
    expect(await h.html()).toContain(
      'data-testid="script-review-retry-accept"',
    );
    expect(await h.panel.flushPending()).toBe(false);
    const reopened = fixture(h.storage);
    await reopened.panel.refresh();
    await reopened.panel.retryAcceptance();
    expect(reopened.api.acceptScriptSuggestion).toHaveBeenCalledWith(
      ...original!,
    );
    expect(reopened.props.prepare).not.toHaveBeenCalled();
    expect(h.storage.size).toBe(0);
  });
  it("keeps uncertain acceptance on transport failures and clears only definitive stale responses", async () => {
    const h = fixture();
    await h.panel.refresh();
    h.api.acceptScriptSuggestion.mockRejectedValue(new Error("offline"));
    await h.panel.accept(suggestion());
    await h.panel.generate();
    await h.panel.skip(suggestion());
    expect(h.api.runScriptReview).not.toHaveBeenCalled();
    expect(h.api.skipScriptSuggestion).not.toHaveBeenCalled();
    h.api.acceptScriptSuggestion.mockRejectedValue(
      new ApiError("Changed", 409, { code: "review.suggestionStale" }),
    );
    await h.panel.retryAcceptance();
    expect(h.storage.size).toBe(0);
    expect(await h.panel.flushPending()).toBe(true);
  });
  it("discards late reads and acceptance callbacks after losing the project/beat owner", async () => {
    const h = fixture();
    await h.panel.refresh();
    const read =
      deferred<Awaited<ReturnType<typeof h.api.scriptReviewSuggestions>>>();
    h.api.scriptReviewSuggestions.mockImplementation(() => read.promise);
    const work = h.panel.refresh();
    h.props.beatId = "different-beat";
    read.resolve({
      suggestions: [suggestion()],
      total: 1,
      offset: 0,
      limit: 10,
      revision: "wrong-owner",
    });
    await work;
    expect(h.panel.data.value.revision).not.toBe("wrong-owner");
    const accepted = deferred<{ story: typeof h.story }>();
    h.api.acceptScriptSuggestion.mockImplementation(() => accepted.promise);
    h.props.beatId = "beat";
    await drain();
    const accepting = h.panel.accept(suggestion());
    await drain();
    h.dispose();
    h.emit.mockClear();
    accepted.resolve({ story: h.story });
    await accepting;
    expect(h.emit.mock.calls.some((call) => call[0] === "accepted")).toBe(
      false,
    );
  });
  it("passes the exact remote descriptor and scene-script workflow through consent", async () => {
    const h = fixture();
    const descriptor = {
      id: "remote",
      name: "Explicit provider",
      execution: "remote",
      endpoint: "https://review.invalid/destination",
      dataKinds: ["text", "metadata"],
    };
    h.api.reviewProvider.mockResolvedValue({
      configured: true,
      available: false,
      provider: descriptor,
    } as never);
    await h.panel.refresh();
    const html = await h.html();
    expect(html).toContain(descriptor.endpoint);
    expect(html).toContain(en.transcript.dataKinds.metadata);
    await h.panel.consent(true);
    expect(h.api.reviewConsent).toHaveBeenCalledWith(
      true,
      descriptor,
      "scene-script",
    );
    expect(h.api.runScriptReview).not.toHaveBeenCalled();
  });
});
