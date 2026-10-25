import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceDraft, SourceSelection } from "@openfilm/core";
import type { SourceSelectionInput } from "@openfilm/application";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action();
});

async function settle() {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
    await vue.nextTick();
  }
}

const input = (name: string) => ({
  kind: "file" as const,
  displayName: name,
  accessClass: "native-path" as const,
  accessRef: `/synthetic/${name}`,
  recursive: false,
});

function fixture(
  options: {
    delayedRead?: Promise<{ draft: SourceDraft }>;
    initialDraft?: SourceDraft;
    availability?: "available" | "needs-permission" | "needs-reselection";
    browserFolderError?: Error;
    nativeDropRegistration?: Promise<() => void>;
    addError?: Error;
    nativeFilesResult?: Promise<{
      sources: SourceSelectionInput[];
      rejected: [];
    }>;
    staleAddDraft?: SourceDraft;
    delayedAdd?: Promise<{ draft: SourceDraft }>;
    lostAddDraft?: SourceDraft;
    removeDraft?: SourceDraft;
    delayedRemove?: Promise<{ draft: SourceDraft }>;
    lostRemoveDraft?: SourceDraft;
    reloadError?: Error;
  } = {},
) {
  let draft: SourceDraft =
    options.initialDraft ??
    ({
      schemaVersion: 1,
      projectId: "project-a",
      revision: 0,
      selections: [],
    } satisfies SourceDraft);
  let sequence = 0;
  let staleThrown = false;
  let lostAcknowledgement = false;
  let lostRemoveAcknowledgement = false;
  let draftReads = 0;
  const sourceDraft = vi.fn(async () => {
    draftReads++;
    if (draftReads > 1 && options.reloadError) throw options.reloadError;
    return options.delayedRead ?? { draft: structuredClone(draft) };
  });
  const addSourceSelections = vi.fn(
    async (request: {
      requestId: string;
      sources: ReturnType<typeof input>[];
    }) => {
      if (options.delayedAdd) return options.delayedAdd;
      if (options.addError) throw options.addError;
      if (options.staleAddDraft && !staleThrown) {
        staleThrown = true;
        draft = structuredClone(options.staleAddDraft);
        throw Object.assign(new Error("draft changed"), {
          code: "import.draftStale",
        });
      }
      if (options.lostAddDraft) {
        draft = structuredClone(options.lostAddDraft);
        if (!lostAcknowledgement) {
          lostAcknowledgement = true;
          throw new Error("response connection lost");
        }
        return { draft: structuredClone(draft) };
      }
      draft = {
        ...draft,
        revision: draft.revision + 1,
        selections: [
          ...draft.selections,
          ...request.sources.map((source): SourceSelection => ({
            ...source,
            id: `source-${++sequence}`,
            projectId: draft.projectId,
            selectionRevision: draft.revision + 1,
          })),
        ],
      };
      return { draft: structuredClone(draft) };
    },
  );
  const removeSourceSelection = vi.fn(
    async (_selectionId: string, _request: { requestId: string }) => {
      if (options.delayedRemove) return options.delayedRemove;
      if (options.lostRemoveDraft) {
        draft = structuredClone(options.lostRemoveDraft);
        if (!lostRemoveAcknowledgement) {
          lostRemoveAcknowledgement = true;
          throw new Error("remove response connection lost");
        }
      }
      return { draft: structuredClone(options.removeDraft ?? draft) };
    },
  );
  const updateSourceSelection = vi.fn();
  const releaseBrowserSources = vi.fn(
    async (
      _projectId: string,
      _sources: readonly Pick<
        SourceSelectionInput,
        "accessClass" | "accessRef"
      >[],
      _retained: ReadonlySet<string>,
    ) => {},
  );
  const classifyNativeDrop = vi.fn(async () => ({
    sources: [input("dropped.mp4")],
    rejected: [] as [],
  }));
  let nativeDropListener:
    | ((event: {
        type: "enter" | "over" | "drop" | "leave";
        paths: string[];
      }) => void)
    | undefined;
  const pickNativeFiles = options.nativeFilesResult
    ? vi.fn(() => options.nativeFilesResult!)
    : vi
        .fn()
        .mockResolvedValueOnce({
          sources: [input("1.mp4"), input("2.mp4"), input("3.mp4")],
          rejected: [],
        })
        .mockResolvedValueOnce({
          sources: [input("4.mp4"), input("5.mp4")],
          rejected: [],
        })
        .mockResolvedValueOnce({ sources: [], rejected: [] });
  const component = loadComponent(
    "apps/desktop/src/components/ImportPanel.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": {
        api: {
          sourceDraft,
          addSourceSelections,
          removeSourceSelection,
          updateSourceSelection,
        },
      },
      "../sourcePicker": {
        pickNativeFiles,
        pickNativeFolders: vi.fn(async () => ({ sources: [], rejected: [] })),
        pickBrowserFiles: vi.fn(),
        pickBrowserFolder: vi.fn(async () => {
          if (options.browserFolderError) throw options.browserFolderError;
          return undefined;
        }),
        pickBrowserFallbackFolders: vi.fn(),
        sourcesFromBrowserDrop: vi.fn(),
        classifyNativeDrop,
        clearBrowserEphemeral: vi.fn(),
        releaseBrowserSources,
        browserFilesForSelections: vi.fn(),
        sourceAvailability: vi.fn(
          async () => options.availability ?? "available",
        ),
        listenForNativeDrop: vi.fn(async (listener) => {
          nativeDropListener = listener;
          return options.nativeDropRegistration ?? (() => {});
        }),
      },
      "../i18n": { formatNumber: String },
      "./Icon.vue": { render: () => null },
    },
  );
  const props = vue.reactive({
    projectId: "project-a",
    native: true,
    busy: false,
    expert: false,
    progress: undefined as
      | {
          completed: number;
          total: number;
          bytesUploaded: number;
          totalBytes: number;
        }
      | undefined,
    onError: vi.fn(),
    onClose: vi.fn(),
    onFolder: vi.fn(),
    onFiles: vi.fn(),
    onUpload: vi.fn(),
    onCancel: vi.fn(),
  });
  const mounted = mountComponent(component, props);
  cleanup.push(mounted.unmount);
  const nodes = () => flatten(mounted.root);
  const button = (key: string) =>
    nodes().find(
      (node) =>
        node.tag === "button" &&
        flatten(node)
          .map((child) => child.text)
          .join("")
          .includes(key),
    );
  return {
    ...mounted,
    props,
    nodes,
    button,
    sourceDraft,
    addSourceSelections,
    removeSourceSelection,
    releaseBrowserSources,
    pickNativeFiles,
    classifyNativeDrop,
    nativeDrop(event: {
      type: "enter" | "over" | "drop" | "leave";
      paths: string[];
    }) {
      nativeDropListener?.(event);
    },
    onFiles: props.onFiles,
  };
}

describe("additive source draft panel", () => {
  it("adds 3 then 2 files, treats picker cancellation as no-op and never imports", async () => {
    const h = fixture();
    await settle();
    expect(h.sourceDraft).toHaveBeenCalledTimes(1);
    for (let count = 0; count < 3; count++) {
      const button = h.button("app.import.addFiles");
      expect(button).toBeDefined();
      await (button!.props.onClick as () => Promise<void>)();
      await settle();
    }
    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.pickNativeFiles).toHaveBeenCalledTimes(3);
    expect(
      h.nodes().filter((node) => node.props["data-source-id"]).length,
    ).toBe(5);
    expect(
      h.nodes().some((node) => node.text.includes("app.import.started")),
    ).toBe(false);
    expect(h.onFiles).not.toHaveBeenCalled();
    await (
      h.button("app.import.startCompatible")!.props
        .onClick as () => Promise<void>
    )();
    expect(h.onFiles).toHaveBeenCalledWith([
      "/synthetic/1.mp4",
      "/synthetic/2.mp4",
      "/synthetic/3.mp4",
      "/synthetic/4.mp4",
      "/synthetic/5.mp4",
    ]);
  });

  it("shows access details only in expert mode over the same draft", async () => {
    const h = fixture();
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(
      h.nodes().some((node) => node.text.includes("/synthetic/1.mp4")),
    ).toBe(false);
    h.props.expert = true;
    await settle();
    expect(
      h.nodes().some((node) => node.text.includes("/synthetic/1.mp4")),
    ).toBe(true);
    expect(h.addSourceSelections).toHaveBeenCalledTimes(1);
  });

  it("ignores a delayed draft read after the project changes", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const pending = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const h = fixture({ delayedRead: pending });
    await settle();
    h.props.projectId = "project-b";
    await settle();
    resolve({
      draft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 9,
        selections: [
          {
            ...input("late.mp4"),
            id: "late",
            projectId: "project-a",
            selectionRevision: 9,
          },
        ],
      },
    });
    await settle();
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "late"),
    ).toBe(false);
  });

  it("marks an expired browser file for reselection after reopen", async () => {
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 2,
        selections: [
          {
            ...input("旅程.mp4"),
            id: "browser-file",
            projectId: "project-a",
            accessClass: "ephemeral-browser-file",
            accessRef: "browser-file:expired",
            selectionRevision: 2,
          },
        ],
      },
      availability: "needs-reselection",
    });
    h.props.native = false;
    await settle();
    expect(
      h
        .nodes()
        .some((node) =>
          node.text.includes("app.import.access.needs-reselection"),
        ),
    ).toBe(true);
  });

  it("adds a server folder path to the draft before an explicit compatible import", async () => {
    const h = fixture();
    h.props.native = false;
    await settle();
    await (h.button("app.import.addPath")!.props.onClick as () => void)();
    await settle();
    const path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    expect(path).toBeDefined();
    (path!.props.onInput as (event: unknown) => void)({
      target: { value: "/synthetic/家庭旅程" },
    });
    await settle();
    const form = h
      .nodes()
      .find((node) => node.tag === "form" && node.props.onSubmit);
    await (form!.props.onSubmit as (event: unknown) => Promise<void>)({
      preventDefault() {},
    });
    await settle();
    expect(h.addSourceSelections).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [
          expect.objectContaining({
            kind: "folder",
            displayName: "家庭旅程",
            accessClass: "native-path",
            accessRef: "/synthetic/家庭旅程",
          }),
        ],
      }),
    );
    expect(h.props.onFolder).not.toHaveBeenCalled();
    await (
      h.button("app.import.startCompatible")!.props
        .onClick as () => Promise<void>
    )();
    expect(h.props.onFolder).toHaveBeenCalledWith("/synthetic/家庭旅程");
  });

  it("reports a browser folder picker storage failure without an unhandled rejection", async () => {
    const failure = new Error("IndexedDB unavailable");
    const h = fixture({ browserFolderError: failure });
    h.props.native = false;
    await settle();
    await (h.button("app.import.addFolder")!.props.onClick as () => void)();
    await settle();
    expect(h.props.onError).toHaveBeenCalledWith(failure);
  });

  it("disposes a native drop registration that resolves after unmount", async () => {
    let resolve!: (dispose: () => void) => void;
    const pending = new Promise<() => void>((done) => {
      resolve = done;
    });
    const dispose = vi.fn();
    const h = fixture({ nativeDropRegistration: pending });
    await settle();
    h.unmount();
    resolve(dispose);
    await settle();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps a folder path editable when saving the draft fails", async () => {
    const failure = new Error("source draft unavailable");
    const h = fixture({ addError: failure });
    h.props.native = false;
    await settle();
    await (h.button("app.import.addPath")!.props.onClick as () => void)();
    await settle();
    let path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    (path!.props.onInput as (event: unknown) => void)({
      target: { value: "/synthetic/retry" },
    });
    await settle();
    const form = h
      .nodes()
      .find((node) => node.tag === "form" && node.props.onSubmit);
    await (form!.props.onSubmit as (event: unknown) => Promise<void>)({
      preventDefault() {},
    });
    await settle();

    path = h
      .nodes()
      .find(
        (node) => node.tag === "input" && node.props.name === "media-folder",
      );
    expect(path?.props.value).toBe("/synthetic/retry");
    expect(h.props.onError).toHaveBeenCalledWith(failure);
  });

  it("does not offer the recursive legacy importer for a nonrecursive folder", async () => {
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [
          {
            id: "folder-shallow",
            projectId: "project-a",
            kind: "folder",
            displayName: "Only this folder",
            accessClass: "native-path",
            accessRef: "/synthetic/shallow",
            recursive: false,
            selectionRevision: 1,
          },
        ],
      },
    });
    await settle();
    expect(h.button("app.import.startCompatible")?.props.disabled).toBe(true);
    expect(h.props.onFolder).not.toHaveBeenCalled();
  });

  it("keeps close disabled and cancellation visible throughout an upload", async () => {
    const h = fixture();
    await settle();
    h.props.busy = true;
    await settle();
    let close = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.close",
      );
    expect(close?.props.disabled).toBe(false);
    h.props.progress = {
      completed: 0,
      total: 1,
      bytesUploaded: 0,
      totalBytes: 9,
    };
    await settle();
    close = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.close",
      );
    expect(close?.props.disabled).toBe(true);
    expect(h.button("app.import.cancelUpload")).toBeDefined();
  });

  it("discards and releases a picker result that resolves after the panel unmounts", async () => {
    let resolve!: (result: {
      sources: SourceSelectionInput[];
      rejected: [];
    }) => void;
    const pending = new Promise<{
      sources: SourceSelectionInput[];
      rejected: [];
    }>((done) => {
      resolve = done;
    });
    const h = fixture({ nativeFilesResult: pending });
    await settle();
    const choosing = (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    h.unmount();
    const late: SourceSelectionInput = {
      ...input("late.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:late",
    };
    resolve({ sources: [late], rejected: [] });
    await choosing;
    await settle();
    expect(h.addSourceSelections).not.toHaveBeenCalled();
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [late],
      expect.any(Set),
    );
  });

  it("releases browser access when adding its source to the draft fails", async () => {
    const failure = Object.assign(new Error("draft rejected"), {
      code: "request.invalid",
    });
    const browserSource: SourceSelectionInput = {
      ...input("private.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:private",
    };
    const h = fixture({
      addError: failure,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [browserSource],
      expect.any(Set),
    );
  });

  it("releases removed browser access after the revised draft is accepted", async () => {
    const source: SourceSelection = {
      ...input("private.mp4"),
      id: "private-source",
      projectId: "project-a",
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:private",
      selectionRevision: 1,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [source],
      },
      removeDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 2,
        selections: [],
      },
    });
    await settle();
    const remove = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.removeSource",
      );
    await (remove!.props.onClick as () => Promise<void>)();
    await settle();
    expect(h.removeSourceSelection).toHaveBeenCalledWith(
      "private-source",
      expect.any(Object),
    );
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [source],
      new Set(),
    );
  });

  it("retains access from an authoritative add response that arrives after unmount", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const response = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const browserSource: SourceSelectionInput = {
      ...input("committed.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:committed",
    };
    const committed: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 1,
      selections: [
        {
          ...browserSource,
          id: "committed-source",
          projectId: "project-a",
          recursive: false,
          selectionRevision: 1,
        },
      ],
    };
    const h = fixture({
      delayedAdd: response,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    const choosing = (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();
    h.unmount();
    resolve({ draft: committed });
    await choosing;

    const retained = h.releaseBrowserSources.mock.calls[0]?.[2];
    expect(retained).toContain("browser-file:committed");
  });

  it("reuses one request identity after a committed add loses its response", async () => {
    const browserSource: SourceSelectionInput = {
      ...input("reconciled.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:reconciled",
    };
    const committed: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 1,
      selections: [
        {
          ...browserSource,
          id: "reconciled-source",
          projectId: "project-a",
          recursive: false,
          selectionRevision: 1,
        },
      ],
    };
    const h = fixture({
      lostAddDraft: committed,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.addSourceSelections.mock.calls[0]![0].requestId).toBe(
      h.addSourceSelections.mock.calls[1]![0].requestId,
    );
    const retained = h.releaseBrowserSources.mock.calls[0]?.[2];
    expect(retained).toContain("browser-file:reconciled");
  });

  it("reloads authoritative state when both same-receipt mutation attempts lose their response", async () => {
    const failure = new Error("workspace transport unavailable");
    const browserSource: SourceSelectionInput = {
      ...input("uncertain.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:uncertain",
    };
    const h = fixture({
      addError: failure,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.addSourceSelections.mock.calls[0]![0].requestId).toBe(
      h.addSourceSelections.mock.calls[1]![0].requestId,
    );
    expect(h.props.onError).toHaveBeenCalledWith(failure);
    expect(h.sourceDraft).toHaveBeenCalledTimes(2);
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [browserSource],
      new Set(),
    );
  });

  it("conservatively retains access when mutation and authoritative reload are both unavailable", async () => {
    const failure = new Error("workspace transport unavailable");
    const reloadFailure = new Error("authoritative read unavailable");
    const browserSource: SourceSelectionInput = {
      ...input("uncertain.mp4"),
      accessClass: "ephemeral-browser-file",
      accessRef: "browser-file:uncertain",
    };
    const h = fixture({
      addError: failure,
      reloadError: reloadFailure,
      nativeFilesResult: Promise.resolve({
        sources: [browserSource],
        rejected: [],
      }),
    });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
    expect(h.sourceDraft).toHaveBeenCalledTimes(2);
    expect(h.props.onError).toHaveBeenCalledWith(reloadFailure);
    expect(h.releaseBrowserSources).not.toHaveBeenCalled();
  });

  it("releases a removed source from an authoritative response after unmount", async () => {
    let resolve!: (value: { draft: SourceDraft }) => void;
    const response = new Promise<{ draft: SourceDraft }>((done) => {
      resolve = done;
    });
    const source: SourceSelection = {
      ...input("removed.mp4"),
      id: "removed-source",
      projectId: "project-a",
      accessClass: "persistent-browser-handle",
      accessRef: "browser-handle:removed",
      selectionRevision: 1,
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [source],
      },
      delayedRemove: response,
    });
    await settle();
    const remove = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.removeSource",
      );
    const removing = (remove!.props.onClick as () => Promise<void>)();
    await settle();
    h.unmount();
    resolve({
      draft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 2,
        selections: [],
      },
    });
    await removing;
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [source],
      new Set(),
    );
  });

  it("reuses one request identity when a committed removal loses its response", async () => {
    const source: SourceSelection = {
      ...input("removed.mp4"),
      id: "removed-source",
      projectId: "project-a",
      accessClass: "persistent-browser-handle",
      accessRef: "browser-handle:removed",
      selectionRevision: 1,
    };
    const removed: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 2,
      selections: [],
    };
    const h = fixture({
      initialDraft: {
        schemaVersion: 1,
        projectId: "project-a",
        revision: 1,
        selections: [source],
      },
      lostRemoveDraft: removed,
    });
    await settle();
    const remove = h
      .nodes()
      .find(
        (node) =>
          node.tag === "button" &&
          node.props["aria-label"] === "app.import.removeSource",
      );
    await (remove!.props.onClick as () => Promise<void>)();
    await settle();

    expect(h.removeSourceSelection).toHaveBeenCalledTimes(2);
    expect(h.removeSourceSelection.mock.calls[0]![1].requestId).toBe(
      h.removeSourceSelection.mock.calls[1]![1].requestId,
    );
    expect(h.releaseBrowserSources).toHaveBeenCalledWith(
      "project-a",
      [source],
      new Set(),
    );
  });

  it("reloads the latest draft after a stale mutation and permits another edit", async () => {
    const latest: SourceDraft = {
      schemaVersion: 1,
      projectId: "project-a",
      revision: 1,
      selections: [
        {
          ...input("remote.mp4"),
          id: "remote",
          projectId: "project-a",
          selectionRevision: 1,
        },
      ],
    };
    const h = fixture({ staleAddDraft: latest });
    await settle();
    await (
      h.button("app.import.addFiles")!.props.onClick as () => Promise<void>
    )();
    await settle();

    expect(h.sourceDraft).toHaveBeenCalledTimes(2);
    expect(
      h.nodes().some((node) => node.props["data-source-id"] === "remote"),
    ).toBe(true);
    expect(h.button("app.import.addFiles")?.props.disabled).toBe(false);

    h.nativeDrop({ type: "drop", paths: ["/synthetic/dropped.mp4"] });
    await settle();
    expect(h.classifyNativeDrop).toHaveBeenCalledWith([
      "/synthetic/dropped.mp4",
    ]);
    expect(h.addSourceSelections).toHaveBeenCalledTimes(2);
  });
});
