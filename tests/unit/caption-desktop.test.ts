import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  api as desktopApi,
  captionDownloadUrl,
} from "../../apps/desktop/src/api";

// Run the production Vue setup with real reactivity; only transport delivery is controlled.
const requireDesktop = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const vue = requireDesktop("vue");
const { parse, compileScript, compileTemplate } =
  requireDesktop("vue/compiler-sfc");
const { renderToString } = requireDesktop("vue/server-renderer");
interface CaptionPanel {
  trackId: { value: string };
  tracks: { value: { id: string }[] };
  snapshot: { value: ReturnType<typeof snapshot> | null };
  publication: { value: { id: string } | null };
  stale: { value: boolean };
  canExport: { value: boolean };
  error: { value: unknown };
  loading: { value: boolean };
  status: { value: string };
  generate: () => Promise<void>;
  loadPage: (offset: number, issueOffset: number) => Promise<void>;
  publish: (format: "srt" | "vtt") => Promise<void>;
  cancel: () => void;
  time: (milliseconds: number) => string;
}
let factory: (dependencies: Record<string, unknown>) => CaptionPanel;
let render: unknown;
const cleanup: (() => void)[] = [];
beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/components/CaptionExport.vue",
      import.meta.url,
    ),
    "utf8",
  );
  const { descriptor } = parse(source);
  const bindings = compileScript(descriptor, { id: "caption" }).bindings;
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
    filename: "CaptionExport.vue",
    id: "caption",
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
  for (const fn of cleanup.splice(0).reverse()) fn();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function snapshot(overrides = {}) {
  return {
    id: "snapshot",
    version: 1,
    optionsVersion: 1,
    projectId: "project",
    compositionId: "composition",
    compositionRevision: "revision",
    trackId: "video",
    createdAt: "2026-10-08T00:00:00Z",
    cues: [
      {
        id: "cue",
        startMs: 1250,
        endMs: 3500,
        text: "十和田湖 <tag> & memory",
        assetId: "asset",
        transcriptRevisionId: "transcript-revision",
        transcriptId: "transcript",
        clipId: "clip",
        segmentId: "segment",
        sourceIn: 2,
        sourceOut: 4.25,
      },
    ],
    issues: [],
    cueCount: 1,
    issueCount: 0,
    errorCount: 0,
    warningCount: 0,
    exportable: true,
    offset: 0,
    limit: 100,
    issueOffset: 0,
    issueLimit: 100,
    sources: [],
    stale: false,
    staleReasons: [],
    ...overrides,
  };
}
function fixture() {
  const props = vue.reactive({
    projectId: "project",
    composition: {
      id: "composition",
      storyId: "story",
      duration: 4,
      tracks: [
        { id: "video", type: "video", clips: [] },
        { id: "music", type: "music", clips: [] },
        { id: "titles", type: "titles", clips: [] },
      ],
    },
    busy: false,
  });
  const api = {
    captionContext: vi.fn(async () => ({
      projectId: "project",
      compositionId: "composition",
      revision: "revision",
    })),
    prepareCaptions: vi.fn(async (_body: unknown, _signal?: AbortSignal) =>
      snapshot(),
    ),
    captionSnapshot: vi.fn(
      async (_id: string, _options: unknown, _signal?: AbortSignal) =>
        snapshot(),
    ),
    exportCaptions: vi.fn(async () => ({
      id: "publication",
      snapshotId: "snapshot",
      projectId: "project",
      format: "srt",
      fileName: "captions.srt",
      mediaType: "application/x-subrip",
      relativePath: "captions/publication/captions.srt",
      cueCount: 1,
      createdAt: "2026-10-08T00:00:00Z",
    })),
  };
  let unmount = () => {};
  const scope = vue.effectScope();
  const state = scope.run(() =>
    factory({
      ...vue,
      defineProps: () => props,
      useI18n: () => ({ t: (key: string) => key, te: () => true }),
      api,
      ApiError,
      localizeError: (error: unknown) => String(error),
      errorDetail: String,
      formatNumber: String,
      captionDownloadUrl: (id: string, projectId: string, kind: string) =>
        `/api/captions/file?${new URLSearchParams({ id, projectId, kind })}`,
      onBeforeUnmount: (callback: () => void) => {
        unmount = callback;
      },
    }),
  )!;
  cleanup.push(() => {
    unmount();
    scope.stop();
  });
  return {
    props,
    api,
    state,
    unmount: () => unmount(),
    html: () =>
      renderToString(
        vue.createSSRApp(
          {
            props: ["projectId", "composition", "busy"],
            setup: () => state,
            render,
          },
          props,
        ),
      ),
  };
}

describe("composition caption export lifecycle", () => {
  it.each([
    [59_999, "00:00:59.999"],
    [3_599_999, "00:59:59.999"],
    [3_600_000, "01:00:00.000"],
    [3_600_123, "01:00:00.123"],
    [359_999_999, "99:59:59.999"],
  ])("formats %i ms with the export's hour-based timecode", (value, text) => {
    expect(fixture().state.time(value)).toBe(text);
  });
  it("renders cue and warning times across an hour without cumulative minutes", async () => {
    const { state, api, html } = fixture();
    api.prepareCaptions.mockResolvedValueOnce(
      snapshot({
        cues: [{ ...snapshot().cues[0], startMs: 3_599_999, endMs: 3_600_001 }],
        issueCount: 1,
        warningCount: 1,
        issues: [
          {
            code: "OVERLAP",
            severity: "warning",
            startMs: 3_600_000,
            endMs: 3_601_000,
          },
        ],
      }),
    );
    state.trackId.value = "video";
    await state.generate();
    const rendered = (await html()).replace(/<!--.*?-->/gu, "");
    expect(rendered).toContain("00:59:59.999 → 01:00:00.001");
    expect(rendered).toContain("01:00:00.000 → 01:00:01.000");
    expect(rendered).not.toContain("60:00.");
  });
  it("requires an explicit supported track and uses the fresh project-scoped revision", async () => {
    const { state, api } = fixture();
    await state.generate();
    expect(api.captionContext).not.toHaveBeenCalled();
    expect(state.tracks.value.map((track: { id: string }) => track.id)).toEqual(
      ["video", "music"],
    );
    state.trackId.value = "video";
    await state.generate();
    expect(api.captionContext).toHaveBeenCalledWith(
      "project",
      "composition",
      expect.any(AbortSignal),
    );
    expect(api.prepareCaptions).toHaveBeenCalledWith(
      {
        projectId: "project",
        compositionId: "composition",
        trackId: "video",
        baseRevision: "revision",
      },
      expect.any(AbortSignal),
    );
    expect(state.snapshot.value!.id).toBe("snapshot");
  });
  it.each(["project", "composition", "unmount"])(
    "aborts and ignores a late preparation after %s changes",
    async (change) => {
      const { state, props, api, unmount } = fixture();
      const held = deferred<ReturnType<typeof snapshot>>();
      api.prepareCaptions.mockImplementation(() => held.promise);
      state.trackId.value = "video";
      const operation = state.generate();
      await vi.waitFor(() =>
        expect(api.prepareCaptions).toHaveBeenCalledOnce(),
      );
      const signal = api.prepareCaptions.mock.calls[0]![1] as AbortSignal;
      if (change === "project") props.projectId = "other-project";
      else if (change === "composition")
        props.composition.id = "other-composition";
      else unmount();
      expect(signal.aborted).toBe(true);
      held.resolve(snapshot());
      await operation;
      expect(state.snapshot.value).toBeNull();
      expect(state.publication.value).toBeNull();
    },
  );
  it("keeps a composition-changed preview visibly stale and clears publication", async () => {
    const { state, props, api } = fixture();
    state.trackId.value = "video";
    await state.generate();
    await state.publish("srt");
    expect(state.publication.value!.id).toBe("publication");
    props.composition.duration = 9;
    expect(state.stale.value).toBe(true);
    expect(state.publication.value).toBeNull();
    expect(state.status.value).toBe("stale");
    expect(state.canExport.value).toBe(false);
    await state.publish("srt");
    expect(api.exportCaptions).toHaveBeenCalledTimes(1);
  });
  it("refreshes server revisions before export and refuses a stale transcript snapshot", async () => {
    const { state, api } = fixture();
    state.trackId.value = "video";
    await state.generate();
    api.captionSnapshot.mockImplementation(async () =>
      snapshot({ stale: true, exportable: false }),
    );
    await state.publish("srt");
    expect(api.exportCaptions).not.toHaveBeenCalled();
    expect(state.stale.value).toBe(true);
  });
  it("blocks a snapshot whose errors exist outside the visible issue page", async () => {
    const { state, api } = fixture();
    api.prepareCaptions.mockImplementation(async () =>
      snapshot({ errorCount: 1, issueCount: 101, exportable: false }),
    );
    state.trackId.value = "video";
    await state.generate();
    await state.publish("srt");
    expect(state.canExport.value).toBe(false);
    expect(api.exportCaptions).not.toHaveBeenCalled();
  });
  it("makes both scrollable preview lists keyboard focusable with labels", async () => {
    const { state, api, html } = fixture();
    api.prepareCaptions.mockImplementation(async () =>
      snapshot({
        issueCount: 1,
        warningCount: 1,
        issues: [{ code: "ALIGNMENT_STALE", severity: "warning" }],
      }),
    );
    state.trackId.value = "video";
    await state.generate();
    const rendered = await html();
    for (const testId of ["caption-cues", "caption-issues"]) {
      const openingTag = rendered.match(
        new RegExp(`<[^>]+data-testid="${testId}"[^>]*>`),
      )?.[0];
      expect(openingTag).toContain('tabindex="0"');
      expect(openingTag).toMatch(/aria-label="[^"]+"/u);
    }
  });
  it("pages cues and warnings without remapping and scopes both downloads", async () => {
    const { state, api, html } = fixture();
    state.trackId.value = "video";
    await state.generate();
    await state.loadPage(100, 20);
    expect(api.captionSnapshot).toHaveBeenCalledWith(
      "snapshot",
      {
        projectId: "project",
        offset: 100,
        limit: 100,
        issueOffset: 20,
        issueLimit: 20,
      },
      expect.any(AbortSignal),
    );
    await state.publish("srt");
    const rendered = await html();
    expect(rendered).toContain("十和田湖 &lt;tag&gt; &amp; memory");
    expect(rendered).toContain("00:00:01.250");
    expect(rendered).toContain("asset");
    expect(rendered).toContain("transcript-revision");
    expect(rendered).toContain("projectId=project&amp;kind=captions");
    expect(rendered).toContain("projectId=project&amp;kind=manifest");
  });
  it.each([
    [100, 0, "cue pagination"],
    [0, 20, "warning pagination"],
    [0, 0, "status refresh"],
  ])(
    "retains both download links during and after %s / %s (%s)",
    async (offset, issueOffset) => {
      const { state, api, html } = fixture();
      state.trackId.value = "video";
      await state.generate();
      await state.publish("srt");
      const published = state.publication.value;
      const held = deferred<ReturnType<typeof snapshot>>();
      api.captionSnapshot.mockImplementationOnce(() => held.promise);
      const paging = state.loadPage(Number(offset), Number(issueOffset));
      expect(state.loading.value).toBe(true);
      expect(state.publication.value).toBe(published);
      expect(await html()).toContain('data-testid="caption-download"');
      expect(await html()).toContain('data-testid="caption-manifest"');
      held.resolve(snapshot({ offset, issueOffset }));
      await paging;
      expect(state.publication.value).toBe(published);
      expect(api.exportCaptions).toHaveBeenCalledTimes(1);
      expect(api.prepareCaptions).toHaveBeenCalledTimes(1);
    },
  );
  it("clears publication when a server refresh marks its snapshot stale", async () => {
    const { state, api, html } = fixture();
    state.trackId.value = "video";
    await state.generate();
    await state.publish("srt");
    api.captionSnapshot.mockResolvedValueOnce(
      snapshot({ stale: true, exportable: false }),
    );
    await state.loadPage(0, 0);
    expect(state.publication.value).toBeNull();
    expect(state.status.value).toBe("stale");
    expect(state.canExport.value).toBe(false);
    expect(await html()).not.toContain('data-testid="caption-download"');
    expect(await html()).not.toContain('data-testid="caption-manifest"');
    await state.publish("srt");
    expect(api.exportCaptions).toHaveBeenCalledTimes(1);
  });
  it("retains a completed publication after a failed or cancelled refresh", async () => {
    const { state, api } = fixture();
    state.trackId.value = "video";
    await state.generate();
    await state.publish("srt");
    api.captionSnapshot.mockRejectedValueOnce(new Error("Disconnected"));
    await state.loadPage(100, 0);
    expect(state.status.value).toBe("failed");
    expect(state.publication.value!.id).toBe("publication");
    const held = deferred<ReturnType<typeof snapshot>>();
    api.captionSnapshot.mockImplementationOnce(() => held.promise);
    const paging = state.loadPage(100, 0);
    const signal = api.captionSnapshot.mock.calls.at(-1)![2]!;
    state.cancel();
    expect(signal.aborted).toBe(true);
    expect(state.status.value).toBe("cancelled");
    held.resolve(snapshot({ id: "cancelled-snapshot" }));
    await paging;
    expect(state.snapshot.value!.id).toBe("snapshot");
    expect(state.publication.value!.id).toBe("publication");
  });
  it.each(["project", "composition", "track", "unmount"])(
    "clears publication on %s change and ignores the old pending page",
    async (change) => {
      const { state, props, api, unmount } = fixture();
      state.trackId.value = "video";
      await state.generate();
      await state.publish("srt");
      const held = deferred<ReturnType<typeof snapshot>>();
      api.captionSnapshot.mockImplementationOnce(() => held.promise);
      const paging = state.loadPage(100, 0);
      const signal = api.captionSnapshot.mock.calls.at(-1)![2]!;
      if (change === "project") props.projectId = "other-project";
      else if (change === "composition")
        props.composition.id = "other-composition";
      else if (change === "track") state.trackId.value = "music";
      else unmount();
      expect(signal.aborted).toBe(true);
      expect(state.publication.value).toBeNull();
      held.resolve(snapshot());
      await paging;
      expect(state.publication.value).toBeNull();
    },
  );
  it("clears publication immediately when beginning a new preparation", async () => {
    const { state, api } = fixture();
    state.trackId.value = "video";
    await state.generate();
    await state.publish("srt");
    const held = deferred<ReturnType<typeof snapshot>>();
    api.prepareCaptions.mockImplementationOnce(() => held.promise);
    const preparing = state.generate();
    expect(state.publication.value).toBeNull();
    await vi.waitFor(() =>
      expect(api.prepareCaptions).toHaveBeenCalledTimes(2),
    );
    held.resolve(snapshot());
    await preparing;
    expect(state.publication.value).toBeNull();
  });
  it("clears publication if a refresh returns a different snapshot identity", async () => {
    const { state, api } = fixture();
    state.trackId.value = "video";
    await state.generate();
    await state.publish("srt");
    api.captionSnapshot.mockResolvedValueOnce(snapshot({ id: "new-snapshot" }));
    await state.loadPage(0, 0);
    expect(state.snapshot.value!.id).toBe("new-snapshot");
    expect(state.publication.value).toBeNull();
  });
  it("ignores a publication delivered after project switching", async () => {
    const { state, props, api } = fixture();
    const held = deferred<Awaited<ReturnType<typeof api.exportCaptions>>>();
    state.trackId.value = "video";
    await state.generate();
    api.exportCaptions.mockImplementation(() => held.promise);
    const publishing = state.publish("srt");
    await vi.waitFor(() => expect(api.exportCaptions).toHaveBeenCalledOnce());
    props.projectId = "new-film";
    held.resolve({
      id: "old-download",
      snapshotId: "snapshot",
      projectId: "project",
      format: "srt",
      fileName: "captions.srt",
      mediaType: "application/x-subrip",
      relativePath: "captions/publication/captions.srt",
      cueCount: 1,
      createdAt: "2026-10-08T00:00:00Z",
    });
    await publishing;
    expect(state.publication.value).toBeNull();
    expect(state.snapshot.value).toBeNull();
  });
  it("does not silently adopt a context returned for another project", async () => {
    const { state, api } = fixture();
    state.trackId.value = "video";
    api.captionContext.mockImplementation(async () => ({
      projectId: "other",
      compositionId: "composition",
      revision: "revision",
    }));
    await state.generate();
    expect(api.prepareCaptions).not.toHaveBeenCalled();
    expect(state.error.value).toBeTruthy();
  });
});

describe("caption transport and cancellation", () => {
  it("allows WebVTT after a format-specific SRT failure without regenerating", async () => {
    const { state, api } = fixture();
    state.trackId.value = "video";
    await state.generate();
    api.exportCaptions.mockRejectedValueOnce(
      new ApiError("Literal formatting cannot be preserved", 400, {
        code: "captions.srtTextUnsupported",
      }),
    );
    await state.publish("srt");
    expect(state.error.value).toBeTruthy();
    expect(state.canExport.value).toBe(true);
    api.exportCaptions.mockResolvedValueOnce({
      id: "vtt-publication",
      snapshotId: "snapshot",
      projectId: "project",
      format: "vtt",
      fileName: "captions.vtt",
      mediaType: "text/vtt",
      relativePath: "captions/vtt-publication/captions.vtt",
      cueCount: 1,
      createdAt: "2026-10-08T00:00:00Z",
    });
    await state.publish("vtt");
    expect(state.publication.value!.id).toBe("vtt-publication");
    expect(state.error.value).toBeNull();
    expect(api.prepareCaptions).toHaveBeenCalledTimes(1);
  });
  it("aborts a cancelled preparation and ignores its eventual response", async () => {
    const { state, api } = fixture();
    const held = deferred<ReturnType<typeof snapshot>>();
    api.prepareCaptions.mockImplementation(() => held.promise);
    state.trackId.value = "video";
    const pending = state.generate();
    await vi.waitFor(() => expect(api.prepareCaptions).toHaveBeenCalledOnce());
    state.cancel();
    expect(api.prepareCaptions.mock.calls[0]![1]!.aborted).toBe(true);
    expect(state.status.value).toBe("cancelled");
    held.resolve(snapshot());
    await pending;
    expect(state.snapshot.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });
  it("encodes project identity in all requests and publication downloads", async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => ({
      ok: true,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetch);
    const projectId = "film # & 日本語";
    const signal = new AbortController().signal;
    await desktopApi.captionContext(projectId, "edit & 1", signal);
    await desktopApi.prepareCaptions(
      {
        projectId,
        compositionId: "edit & 1",
        trackId: "voice",
        baseRevision: "saved",
      },
      signal,
    );
    await desktopApi.captionSnapshot(
      "snapshot & 2",
      { projectId, offset: 100, limit: 100, issueOffset: 20, issueLimit: 20 },
      signal,
    );
    await desktopApi.exportCaptions(
      { projectId, snapshotId: "snapshot & 2", format: "vtt" },
      signal,
    );
    for (const [url, options] of fetch.mock.calls) {
      const identity = options?.body
        ? JSON.parse(String(options.body)).projectId
        : new URL(url, "http://localhost").searchParams.get("projectId");
      expect(identity).toBe(projectId);
      expect(options?.signal).toBe(signal);
    }
    for (const kind of ["captions", "manifest"] as const) {
      const url = new URL(
        captionDownloadUrl("publication # &", projectId, kind),
        "http://localhost",
      );
      expect(url.searchParams.get("projectId")).toBe(projectId);
      expect(url.searchParams.get("id")).toBe("publication # &");
      expect(url.searchParams.get("kind")).toBe(kind);
    }
  });
});
