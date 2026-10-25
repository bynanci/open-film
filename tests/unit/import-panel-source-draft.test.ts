import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceDraft, SourceSelection } from "@openfilm/core";
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
  const sourceDraft = vi.fn(
    async () => options.delayedRead ?? { draft: structuredClone(draft) },
  );
  const addSourceSelections = vi.fn(
    async (request: { sources: ReturnType<typeof input>[] }) => {
      if (options.addError) throw options.addError;
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
  const removeSourceSelection = vi.fn();
  const updateSourceSelection = vi.fn();
  const pickNativeFiles = vi
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
        classifyNativeDrop: vi.fn(),
        clearBrowserEphemeral: vi.fn(),
        browserFilesForSelections: vi.fn(),
        sourceAvailability: vi.fn(
          async () => options.availability ?? "available",
        ),
        listenForNativeDrop: vi.fn(
          async () => options.nativeDropRegistration ?? (() => {}),
        ),
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
    pickNativeFiles,
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
});
