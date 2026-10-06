import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile } from "@openfilm/media";
import {
  ApiError,
  type TranscriptEditorState,
  type TranscriptSearchState,
} from "../../apps/desktop/src/api";

const requireDesktop = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const vue = requireDesktop("vue") as Record<string, unknown> & {
  nextTick: () => Promise<void>;
  effectScope: () => {
    run: <T>(callback: () => T) => T | undefined;
    stop: () => void;
  };
};
type Ref<T> = { value: T };
interface Editor {
  state: Ref<TranscriptEditorState | null>;
  query: Ref<string>;
  caseSensitive: Ref<boolean>;
  search: Ref<TranscriptSearchState | undefined>;
  searchIsCurrent: Ref<boolean>;
  searchBusy: Ref<boolean>;
  matchIndex: Ref<number>;
  currentMatch: Ref<
    | (TranscriptSearchState["matches"][number] & {
        range: { start: number; end: number };
      })
    | undefined
  >;
  selectedId: Ref<string>;
  localError: Ref<unknown>;
  load: (offset?: number, recover?: boolean) => Promise<boolean>;
  find: () => Promise<void>;
  seekMatch: (direction: number) => Promise<void>;
}
let queueFactory: (
  dependencies: Record<string, unknown>,
) => Record<string, unknown>;
let editorFactory: (dependencies: Record<string, unknown>) => Editor;
const cleanup: (() => void | Promise<unknown>)[] = [];
async function compile(source: string, result: string) {
  const code = (await transform(source, { loader: "ts", format: "esm" })).code
    .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "")
    .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "");
  return (dependencies: Record<string, unknown>) =>
    new Function(
      "dependencies",
      `const {${Object.keys(dependencies).join(",")}}=dependencies;\n${code}\n${result}`,
    )(dependencies);
}
beforeAll(async () => {
  queueFactory = await compile(
    await readFile(
      new URL(
        "../../apps/desktop/src/composables/useTranscriptEditor.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    "return {useTranscriptEditor};",
  );
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/components/TranscriptEditor.vue",
      import.meta.url,
    ),
    "utf8",
  );
  editorFactory = await compile(
    source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]!,
    "return {state,query,caseSensitive,search,searchIsCurrent,searchBusy,matchIndex,currentMatch,selectedId,localError,load,find,seekMatch};",
  );
});
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(count = 101) {
  vi.useFakeTimers();
  const directory = await mkdtemp(
    join(tmpdir(), "openfilm-search-navigation-"),
  );
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "identity.wav");
  await writeFile(
    source,
    "Identity-only search fixture, no speech quality claim.",
  );
  const sourceHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Paged transcript search",
    {},
    { userDataDirectory: join(directory, "user-data") },
  );
  cleanup.push(() => app.close());
  const asset = {
    id: "asset",
    uri: pathToFileURL(source).href,
    name: "identity.wav",
    mediaType: "audio" as const,
    duration: count,
    contentHash: sourceHash,
    tags: [],
    metadata: {},
    state: {},
  };
  app.catalog.upsertAsset(asset);
  app.catalog.intelligence.replaceTranscript({
    id: "search-fixture",
    assetId: asset.id,
    provenance: {
      providerId: "fixture-not-asr",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: Array.from({ length: count }, (_, index) => ({
      id: `segment-${index}`,
      start: index,
      end: index + 1,
      text:
        index === 0
          ? "alpha first alpha"
          : index === count - 1
            ? "alpha last alpha alpha"
            : `alpha memory ${index}`,
    })),
  });
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const api = {
    transcript: vi.fn((assetId: string, offset = 0, limit = 100) =>
      app.transcriptEditor.get(assetId, { offset, limit }),
    ),
    transcriptSearch: vi.fn(
      (
        assetId: string,
        query: string,
        caseSensitive = false,
        offset = 0,
        limit = 100,
      ) =>
        app.transcriptEditor.search(assetId, {
          query,
          caseSensitive,
          offset,
          limit,
        }),
    ),
  };
  const lifecycle = {
    onMounted: () => {},
    onBeforeUnmount: (callback: () => void) => cleanup.push(callback),
  };
  const dependencies = {
    ...vue,
    ...core,
    ...lifecycle,
    api,
    ApiError,
    defineEmits: () => vi.fn(),
    defineExpose: () => {},
    useI18n: () => ({ t: (key: string) => key }),
    post: vi.fn(),
    sourceUrl: () => "identity.wav",
    errorDetail: String,
    formatNumber: String,
    formatDate: String,
    localizeError: String,
    GlossaryPanel: {},
    ReviewPanel: {},
  };
  const scope = vue.effectScope();
  cleanup.push(() => scope.stop());
  const queue = queueFactory(dependencies) as {
    useTranscriptEditor: (...args: unknown[]) => Record<string, unknown>;
  };
  const editor = scope.run(() =>
    editorFactory({
      ...dependencies,
      useTranscriptEditor: queue.useTranscriptEditor,
      defineProps: () => ({
        projectId: app.project.id,
        asset,
        active: true,
        jobs: [],
        clips: [],
      }),
    }),
  )!;
  await editor.load();
  editor.query.value = "alpha";
  await editor.find();
  await vue.nextTick();
  return { app, api, editor };
}
async function lastOccurrence(editor: Editor) {
  const count = editor.search.value!.totalMatches;
  for (let index = 1; index < count; index++) await editor.seekMatch(1);
}

describe("actual transcript component with SQLite search pages", () => {
  it.each([101, 201])(
    "Next wraps from the final occurrence to the first page across %i matching segments",
    async (count) => {
      const { editor } = await fixture(count);
      await lastOccurrence(editor);
      expect(editor.currentMatch.value?.segmentId).toBe(`segment-${count - 1}`);
      expect(editor.currentMatch.value?.range.start).toBe(17);
      await editor.seekMatch(1);
      expect(editor.search.value?.offset).toBe(0);
      expect(editor.currentMatch.value?.segmentId).toBe("segment-0");
      expect(editor.currentMatch.value?.range.start).toBe(0);
      expect(editor.selectedId.value).toBe("segment-0");
      expect(editor.state.value?.offset).toBe(0);
    },
  );
  it.each([101, 201])(
    "Previous wraps to the final page and final occurrence across %i matching segments",
    async (count) => {
      const { editor } = await fixture(count);
      await editor.seekMatch(-1);
      expect(editor.search.value?.offset).toBe(
        Math.floor((count - 1) / 100) * 100,
      );
      expect(editor.currentMatch.value?.segmentId).toBe(`segment-${count - 1}`);
      expect(editor.currentMatch.value?.range.start).toBe(17);
      expect(editor.selectedId.value).toBe(`segment-${count - 1}`);
    },
  );
  it("keeps each occurrence within a segment in navigation order", async () => {
    const { editor } = await fixture();
    await editor.seekMatch(1);
    expect(editor.currentMatch.value?.segmentId).toBe("segment-0");
    expect(editor.currentMatch.value?.range.start).toBe(12);
    await editor.seekMatch(1);
    expect(editor.currentMatch.value?.segmentId).toBe("segment-1");
    await editor.seekMatch(-1);
    expect(editor.currentMatch.value?.segmentId).toBe("segment-0");
    expect(editor.currentMatch.value?.range.start).toBe(12);
  });
  it("cycles a single search page without another search read", async () => {
    const { api, editor } = await fixture(2);
    api.transcriptSearch.mockClear();
    for (let index = 0; index < 5; index++) await editor.seekMatch(1);
    expect(editor.currentMatch.value?.segmentId).toBe("segment-0");
    expect(editor.currentMatch.value?.range.start).toBe(0);
    await editor.seekMatch(-1);
    expect(editor.currentMatch.value?.segmentId).toBe("segment-1");
    expect(editor.currentMatch.value?.range.start).toBe(17);
    expect(api.transcriptSearch).not.toHaveBeenCalled();
  });
  it.each(["query", "case", "revision"] as const)(
    "discards a delayed boundary page after its %s context changes",
    async (change) => {
      const { app, api, editor } = await fixture();
      await lastOccurrence(editor);
      const gate = deferred();
      const actualSearch = api.transcriptSearch.getMockImplementation()!;
      api.transcriptSearch.mockImplementationOnce(async (...args) => {
        const result = await actualSearch(...args);
        await gate.promise;
        return result;
      });
      const reading = editor.seekMatch(1);
      expect(api.transcriptSearch.mock.calls.at(-1)?.[3]).toBe(0);
      if (change === "query") editor.query.value = "first";
      else if (change === "case") editor.caseSensitive.value = true;
      else {
        const state = await app.transcriptEditor.get("asset");
        await app.transcriptEditor.edit("asset", {
          baseRevision: state.revision!,
          requestId: "external-edit",
          commands: [
            {
              type: "replace-text",
              segmentId: "segment-0",
              text: "alpha changed",
            },
          ],
        });
        await editor.load(0, false);
      }
      gate.resolve();
      await reading;
      expect(editor.currentMatch.value).toBeUndefined();
      expect(editor.search.value).toBeUndefined();
      expect(editor.searchIsCurrent.value).toBe(false);
    },
  );
});
