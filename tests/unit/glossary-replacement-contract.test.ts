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
import type { GlossaryEntry, GlossaryInput } from "@openfilm/core";
import type { TranscriptMutationInput } from "@openfilm/catalog";
import {
  ApiError,
  type TranscriptEditorState,
} from "../../apps/desktop/src/api";

// Use the real SFC setup and compiled template. Vue's existing server renderer
// avoids adding a DOM/browser dependency before CI installs Chromium.
const requireDesktop = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const vue = requireDesktop("vue") as Record<string, unknown> & {
  createSSRApp: (component: unknown, props?: object) => unknown;
  nextTick: () => Promise<void>;
  effectScope: () => {
    run: <T>(callback: () => T) => T | undefined;
    stop: () => void;
  };
};
const { parse, compileScript, compileTemplate } = requireDesktop(
  "vue/compiler-sfc",
) as {
  parse: (source: string) => {
    descriptor: {
      template: { content: string };
      scriptSetup: { content: string };
    };
  };
  compileScript: (
    descriptor: unknown,
    options: object,
  ) => { bindings: Record<string, string> };
  compileTemplate: (options: object) => { code: string; errors: unknown[] };
};
const { renderToString } = requireDesktop("vue/server-renderer") as {
  renderToString: (app: unknown) => Promise<string>;
};
type Ref<T> = { value: T };
type Glossary = {
  scope: Ref<"project" | "global">;
  source: Ref<string>;
  replacement: Ref<string>;
  entries: Ref<GlossaryEntry[]>;
  error: Ref<unknown>;
  load: () => Promise<void>;
  edit: (entry: GlossaryEntry) => void;
  save: () => Promise<boolean>;
  toggle: (entry: GlossaryEntry) => Promise<boolean>;
  remove: (entry: GlossaryEntry) => Promise<boolean>;
  changeScope: () => Promise<void>;
};
type Editor = {
  state: Ref<TranscriptEditorState | null>;
  text: Ref<string>;
  selectedId: Ref<string>;
  rememberableCorrection: Ref<unknown>;
  corrections: Ref<unknown>;
  queueText: () => void;
  load: () => Promise<boolean>;
  flush: () => Promise<boolean>;
  remember: () => Promise<boolean>;
  undo: (direction: "undo" | "redo") => Promise<void>;
};
let glossaryFactory: (dependencies: Record<string, unknown>) => Glossary;
let editorFactory: (dependencies: Record<string, unknown>) => Editor;
let queueFactory: (
  dependencies: Record<string, unknown>,
) => Record<string, unknown>;
let glossaryRender: unknown;
const cleanup: (() => void | Promise<unknown>)[] = [];
async function factory(source: string, result: string) {
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
  const glossary = await readFile(
    new URL(
      "../../apps/desktop/src/components/GlossaryPanel.vue",
      import.meta.url,
    ),
    "utf8",
  );
  const { descriptor } = parse(glossary);
  glossaryFactory = await factory(
    descriptor.scriptSetup.content,
    "return {scope,source,replacement,entries,error,load,edit,save,toggle,remove,changeScope,caseSensitive,editId,busy,unavailable,hasPending,flushPending,page,pages,visible,reset,find,t,errorDetail,localizeError,GLOSSARY_SOURCE_LIMIT:dependencies.GLOSSARY_SOURCE_LIMIT,GLOSSARY_REPLACEMENT_LIMIT:dependencies.GLOSSARY_REPLACEMENT_LIMIT};",
  );
  const rendered = compileTemplate({
    source: descriptor.template.content,
    filename: "GlossaryPanel.vue",
    id: "contract",
    compilerOptions: {
      bindingMetadata: compileScript(descriptor, { id: "contract" }).bindings,
    },
  });
  expect(rendered.errors).toEqual([]);
  const renderSource = (
    await transform(rendered.code, { loader: "ts", format: "esm" })
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
  glossaryRender = new Function("Vue", `${renderSource};return render;`)(vue);
  const editor = await readFile(
    new URL(
      "../../apps/desktop/src/components/TranscriptEditor.vue",
      import.meta.url,
    ),
    "utf8",
  );
  editorFactory = await factory(
    parse(editor).descriptor.scriptSetup.content,
    "return {state,text,selectedId,rememberableCorrection,corrections,queueText,load,flush,remember,undo};",
  );
  queueFactory = await factory(
    await readFile(
      new URL(
        "../../apps/desktop/src/composables/useTranscriptEditor.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    "return {useTranscriptEditor};",
  );
});
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
  vi.unstubAllGlobals();
});
async function fixture(before = "Original term", blocked = false) {
  const directory = await mkdtemp(
    join(tmpdir(), "openfilm-glossary-contract-"),
  );
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source.wav");
  await writeFile(
    source,
    "Identity-only source; no transcription quality claim.",
  );
  const sourceHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Glossary contract",
    {},
    { userDataDirectory: join(directory, "user-data") },
  );
  cleanup.push(() => app.close());
  const asset = {
    id: "asset",
    uri: pathToFileURL(source).href,
    name: "source.wav",
    mediaType: "audio" as const,
    duration: 4,
    contentHash: sourceHash,
    tags: [],
    metadata: {},
    state: {},
  };
  app.catalog.upsertAsset(asset);
  app.catalog.intelligence.replaceTranscript({
    id: "provider-result",
    assetId: asset.id,
    provenance: {
      providerId: "fixture-not-asr",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: [before, "Other segment"].map((text, index) => ({
      id: `segment-${index}`,
      start: index * 2,
      end: index * 2 + 2,
      text,
      words: [{ start: index * 2, end: index * 2 + 2, text }],
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
    glossary: vi.fn(async (scope: "project" | "global") => ({
      entries: app.knowledge.glossaryList(scope),
    })),
    saveGlossary: vi.fn(async (input: GlossaryInput) =>
      app.knowledge.glossaryUpsert(input),
    ),
    deleteGlossary: vi.fn(async (id: string, scope: "project" | "global") =>
      app.knowledge.glossaryDelete(id, scope),
    ),
    transcript: vi.fn((assetId: string, offset = 0, limit = 100) =>
      app.transcriptEditor.get(assetId, { offset, limit }),
    ),
    editTranscript: vi.fn((assetId: string, input: TranscriptMutationInput) =>
      app.transcriptEditor.edit(assetId, input),
    ),
    transcriptHistory: vi.fn(
      (
        assetId: string,
        direction: "undo" | "redo",
        input: { baseRevision: string; requestId: string },
      ) => app.transcriptEditor[direction](assetId, input),
    ),
    transcriptRevisions: vi.fn((assetId: string, offset = 0) =>
      app.transcriptEditor.revisions(assetId, { offset }),
    ),
    intelligenceProviders: vi.fn(async () => ({
      transcription: { available: false },
    })),
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
    sourceUrl: () => "identity-only.wav",
    errorDetail: String,
    formatNumber: String,
    formatDate: String,
    localizeError: String,
    GlossaryPanel: {},
    ReviewPanel: {},
  };
  const editorScope = vue.effectScope();
  const queueExport = queueFactory(dependencies) as {
    useTranscriptEditor: (...args: unknown[]) => Record<string, unknown>;
  };
  const editor = editorScope.run(() =>
    editorFactory({
      ...dependencies,
      useTranscriptEditor: queueExport.useTranscriptEditor,
      defineProps: () => ({
        projectId: "project",
        asset,
        active: true,
        jobs: [],
      }),
    }),
  )!;
  cleanup.push(() => editorScope.stop());
  await editor.load();
  await vue.nextTick();
  let glossary!: Glossary;
  const glossaryComponent = {
    props: ["assetId", "flush", "blocked", "taskBusy"],
    setup: (props: object) => {
      glossary = glossaryFactory({ ...dependencies, defineProps: () => props });
      return glossary;
    },
    render: glossaryRender,
  };
  await renderToString(
    vue.createSSRApp(glossaryComponent, {
      assetId: "asset",
      flush: () => editor.flush(),
      blocked,
    }),
  );
  // Render the mounted setup's live state after edits without resetting the form.
  const render = () =>
    renderToString(
      vue.createSSRApp({ setup: () => glossary, render: glossaryRender }),
    );
  return { app, api, editor, glossary, render };
}
function glossaryField(html: string, key: "sourceTerm" | "replacementTerm") {
  const field = html.match(
    new RegExp(
      `transcript\\.${key}[\\s\\S]*?<(input|textarea)\\b([^>]*)>`,
      "u",
    ),
  );
  expect(field, html).not.toBeNull();
  return {
    tag: field![1],
    maxLength: Number(field![2]!.match(/maxlength="(\d+)"/u)?.[1]),
    disabled: /(?:^|\s)disabled(?:\s|=|$)/u.test(field![2]!),
  };
}
const replacementField = (html: string) =>
  glossaryField(html, "replacementTerm");

describe("rendered glossary form and persisted replacement contract", () => {
  it("disables both text controls while the transcript editor blocks glossary changes", async () => {
    const test = await fixture("Original term", true);
    const html = await test.render();
    expect(glossaryField(html, "sourceTerm").disabled).toBe(true);
    expect(replacementField(html).disabled).toBe(true);
    expect(await test.glossary.save()).toBe(false);
    expect(test.api.saveGlossary).not.toHaveBeenCalled();
  });
  it.each(["project", "global"] as const)(
    "preserves 0/512/513/4096 replacements across %s create/edit/toggle/remove",
    async (scope) => {
      const test = await fixture();
      test.glossary.scope.value = scope;
      await test.glossary.changeScope();
      const field = replacementField(await test.render());
      for (const length of [0, 512, 513, 4096]) {
        const replacement = "字".repeat(length);
        test.glossary.source.value = `Term ${length}`;
        test.glossary.replacement.value = replacement;
        expect(length).toBeLessThanOrEqual(field.maxLength);
        expect(await test.glossary.save()).toBe(true);
        let entry = test.app.knowledge
          .glossaryList(scope)
          .find((item) => item.source === `Term ${length}`)!;
        expect(entry.replacement).toBe(replacement);
        expect(await test.glossary.toggle(entry)).toBe(true);
        entry = test.app.knowledge
          .glossaryList(scope)
          .find((item) => item.id === entry.id)!;
        expect(entry.enabled).toBe(false);
        test.glossary.edit(entry);
        expect(test.glossary.replacement.value).toBe(replacement);
        expect(await test.glossary.save()).toBe(true);
        entry = test.app.knowledge
          .glossaryList(scope)
          .find((item) => item.id === entry.id)!;
        expect(entry).toMatchObject({ replacement, enabled: false, scope });
        expect(await test.glossary.remove(entry)).toBe(true);
        expect(
          test.app.knowledge
            .glossaryList(scope)
            .some((item) => item.id === entry.id),
        ).toBe(false);
      }
    },
  );

  it.each(["project", "global"] as const)(
    "renders multiline source/replacement controls and preserves %s loaded values on Save",
    async (scope) => {
      const test = await fixture();
      test.glossary.scope.value = scope;
      await test.glossary.changeScope();
      const html = await test.render();
      expect(replacementField(html).tag).toBe("textarea");
      expect(glossaryField(html, "sourceTerm")).toMatchObject({
        tag: "textarea",
        maxLength: 512,
      });
      const source = "Source\n青森\r\n\tTowada";
      const replacement = "青森\n十和田湖\tTowada";
      test.glossary.source.value = source;
      test.glossary.replacement.value = replacement;
      expect(await test.glossary.save()).toBe(true);
      const entry = test.app.knowledge.glossaryList(scope)[0]!;
      expect(entry).toMatchObject({ source, replacement });
      await test.glossary.load();
      test.glossary.edit(test.glossary.entries.value[0]!);
      expect(test.glossary.source.value).toBe(source);
      expect(test.glossary.replacement.value).toBe(replacement);
      expect(await test.glossary.save()).toBe(true);
      expect(test.app.knowledge.glossaryList(scope)[0]).toMatchObject({
        id: entry.id,
        source,
        replacement,
        scope,
        enabled: entry.enabled,
      });
    },
  );

  it("keeps source at 512 while rejecting replacement4097 without changing persisted entries", async () => {
    const test = await fixture();
    const accepted = test.app.knowledge.glossaryUpsert({
      scope: "project",
      source: "x".repeat(512),
      replacement: "valid",
    });
    test.glossary.edit(accepted);
    test.glossary.replacement.value = "x".repeat(4097);
    expect(await test.glossary.save()).toBe(false);
    expect(test.app.knowledge.glossaryList("project")).toEqual([accepted]);
    test.glossary.source.value = "x".repeat(513);
    test.glossary.replacement.value = "valid";
    expect(await test.glossary.save()).toBe(false);
    expect(test.app.knowledge.glossaryList("project")).toEqual([accepted]);
  });
});

describe("Remember replacement boundaries and correction ownership", () => {
  it.each([512, 513, 4096])(
    "offers and persists a %i-character corrected replacement",
    async (length) => {
      const test = await fixture();
      const after = "字".repeat(length);
      test.editor.text.value = after;
      test.editor.queueText();
      await test.editor.flush();
      await vue.nextTick();
      expect(test.editor.rememberableCorrection.value).toMatchObject({
        before: "Original term",
        after,
      });
      expect(await test.editor.remember()).toBe(true);
      expect(test.app.knowledge.glossaryList("project")[0]).toMatchObject({
        source: "Original term",
        replacement: after,
        scope: "project",
      });
    },
  );

  it.each([
    "replacement4097",
    "source513",
    "empty",
    "changed-selection",
    "undo",
  ] as const)("does not Remember %s", async (reason) => {
    const test = await fixture(
      reason === "source513" ? "x".repeat(513) : "Original term",
    );
    const after =
      reason === "replacement4097"
        ? "字".repeat(4097)
        : reason === "empty"
          ? ""
          : "字".repeat(513);
    test.editor.text.value = after;
    test.editor.queueText();
    await test.editor.flush();
    await vue.nextTick();
    if (reason === "changed-selection") {
      test.editor.selectedId.value = "segment-1";
      await vue.nextTick();
    }
    if (reason === "undo") await test.editor.undo("undo");
    expect(test.editor.rememberableCorrection.value).toBeNull();
    expect(await test.editor.remember()).toBe(false);
    expect(test.app.knowledge.glossaryList("project")).toEqual([]);
    expect(test.api.saveGlossary).not.toHaveBeenCalled();
  });
});
