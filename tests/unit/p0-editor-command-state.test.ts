import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTimelineCommand, type TimelineCommand } from "@openfilm/solver";
import { ApiError, type EditorState } from "../../apps/desktop/src/api";

// Exercise the production command/autosave path rather than a second UI store.
const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as { computed: unknown; ref: unknown; shallowRef: unknown };

type Editor = {
  state: { value: EditorState | null };
  status: { value: string };
  hasPending: { value: boolean };
  command: (input: TimelineCommand) => boolean;
  flush: () => Promise<boolean>;
  history: (direction: "undo" | "redo") => Promise<boolean>;
};
let factory: (dependencies: Record<string, unknown>) => Editor;

beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/composables/useTimelineEditor.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const transformed = await transform(source, { loader: "ts", format: "esm" });
  const code = transformed.code
    .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "")
    .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "");
  factory = new Function(
    "dependencies",
    `
    const {computed,ref,shallowRef,onMounted,onBeforeUnmount,applyTimelineCommand,api,ApiError,useI18n,errorDetail,localizeError} = dependencies;
    ${code}
    return useTimelineEditor('project', 'cut', () => {}, () => {});
    `,
  ) as typeof factory;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function initialState(): EditorState {
  return {
    revision: "r1",
    canUndo: false,
    canRedo: false,
    story: {
      id: "story",
      title: "Fixture",
      beats: [{ id: "beat", title: "Opening", candidateAssetIds: ["photo"] }],
    },
    composition: {
      id: "cut",
      storyId: "story",
      duration: 4,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "photo",
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 4,
            },
          ],
        },
      ],
    },
    assets: [
      {
        id: "photo",
        uri: "file:///synthetic.png",
        name: "Fixture",
        mediaType: "image",
        tags: [],
        state: {},
        metadata: {},
      },
    ],
  };
}

async function mountEditor(
  api: {
    editor: ReturnType<typeof vi.fn>;
    edit: ReturnType<typeof vi.fn>;
    history?: ReturnType<typeof vi.fn>;
  },
) {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  const editor = factory({
    ...vue,
    onMounted: (fn: () => void) => fn(),
    onBeforeUnmount: () => {},
    applyTimelineCommand,
    api,
    ApiError,
    useI18n: () => ({ t: (key: string) => key }),
    errorDetail: () => "",
    localizeError: () => "error",
  });
  await vi.waitFor(() => expect(editor.state.value).not.toBeNull());
  return { editor, storage };
}

describe("P0 Inspector / Timeline command-state contract", () => {
  it("routes inspector transform and timeline lock through one optimistic command queue", async () => {
    const initial = initialState();
    let saved = initial;
    const api = {
      editor: vi.fn(async () => saved),
      edit: vi.fn(
        async (_id: string, batch: { commands: TimelineCommand[] }) => {
          for (const command of batch.commands) {
            saved = {
              ...saved,
              ...applyTimelineCommand(saved, saved.assets, command),
            };
          }
          saved = { ...saved, revision: "r2", canUndo: true };
          return saved;
        },
      ),
    };
    const { editor, storage } = await mountEditor(api);
    const transform: TimelineCommand = {
      type: "transform",
      clipId: "clip",
      x: 24,
      y: -12,
    };
    expect(editor.command(transform)).toBe(true);
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBe(24);
    expect(editor.status.value).toBe("saving");
    expect(editor.hasPending.value).toBe(true);
    expect(
      editor.command({ type: "lock", clipId: "clip", locked: true }),
    ).toBe(true);
    expect(editor.state.value?.composition.tracks[0]?.clips[0]?.locked).toBe(
      true,
    );
    expect(await editor.flush()).toBe(true);
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(api.edit.mock.calls[0]?.[1]?.commands).toEqual([
      transform,
      { type: "lock", clipId: "clip", locked: true },
    ]);
    expect(editor.status.value).toBe("saved");
    expect(editor.hasPending.value).toBe(false);
    expect(storage.has("openfilm:editor:project:cut")).toBe(false);
    // A locked clip cannot be modified via Inspector, even if the UI fails to disable it.
    expect(
      editor.command({ type: "transform", clipId: "clip", x: 30 }),
    ).toBe(false);
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBe(24);
  });

  it("flushes pending edits before invoking server Undo", async () => {
    const initial = initialState();
    let saved = initial;
    const order: string[] = [];
    const api = {
      editor: vi.fn(async () => initial),
      edit: vi.fn(
        async (_id: string, batch: { commands: TimelineCommand[] }) => {
          order.push("edit");
          saved = {
            ...saved,
            ...applyTimelineCommand(saved, saved.assets, batch.commands[0]!),
            revision: "r2",
            canUndo: true,
          };
          return saved;
        },
      ),
      history: vi.fn(
        async (_id: string, direction: string, revision: string) => {
          order.push(direction);
          expect(revision).toBe("r2");
          return { ...initial, revision: "r3", canRedo: true };
        },
      ),
    };
    const { editor } = await mountEditor(api);
    expect(
      editor.command({ type: "transform", clipId: "clip", x: 7 }),
    ).toBe(true);
    expect(await editor.history("undo")).toBe(true);
    expect(order).toEqual(["edit", "undo"]);
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBeUndefined();
    expect(editor.status.value).toBe("saved");
  });

  it("retains the draft and reports conflict rather than false Saved", async () => {
    const initial = initialState();
    const api = {
      editor: vi.fn(async () => initial),
      edit: vi.fn(async () => {
        throw new ApiError("Revision changed", 409);
      }),
    };
    const { editor, storage } = await mountEditor(api);
    expect(
      editor.command({ type: "transform", clipId: "clip", x: 11 }),
    ).toBe(true);
    expect(await editor.flush()).toBe(false);
    expect(editor.status.value).toBe("conflict");
    expect(editor.hasPending.value).toBe(true);
    expect(storage.has("openfilm:editor:project:cut")).toBe(true);
  });
});
