import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GraphicSceneTemplateRecord,
  GraphicTextNode,
} from "@openfilm/core";
import { graphicSceneTemplateSourceLabel } from "@openfilm/core";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import {
  graphicNode,
  graphicScene,
} from "../../../tests/fixtures/graphic-scene.js";

const applications = new Set<OpenFilmApplication>();
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications) app.close();
  applications.clear();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  scene = graphicScene({
    nodes: [
      graphicNode({ id: "selected", x: 12 }),
      graphicNode({ id: "private-unselected", x: 90 }),
    ],
  }),
  templateRecords?: GraphicSceneTemplateRecord[],
) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-graphic-agent-"));
  directories.push(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "agent.openfilm"),
    "Synthetic GraphicScene agent",
  );
  applications.add(app);
  app.project.stories.push({ id: "story", title: "Synthetic", beats: [] });
  app.project.timelines.push({
    id: "composition",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [scene],
    ...(templateRecords ? { graphicSceneTemplates: templateRecords } : {}),
  });
  await app.save();
  return { app, editor: new TimelineEditor(app), directory: app.directory };
}

function request(
  editor: TimelineEditor,
  mode: "local" | "provider" = "local",
  instruction = "move right 16",
) {
  const state = editor.get("composition");
  return {
    baseRevision: state.revision,
    sceneId: state.composition.graphicScenes![0]!.id,
    nodeIds: ["selected"],
    instruction,
    mode,
  };
}

describe("reviewable GraphicScene agent edits", () => {
  it("keeps provenance-bound template edits out of the selectable proposal", async () => {
    const sourceText = "今天很開心";
    const scene = graphicScene({
      nodes: [
        {
          id: "speaker",
          type: "text",
          text: "朋友",
          fontSize: 24,
          x: 0,
          y: 0,
          width: 120,
          height: 60,
          opacity: 1,
          zIndex: 0,
          start: 0,
          end: 6,
        } satisfies GraphicTextNode,
        {
          id: "message",
          type: "text",
          text: sourceText,
          fontSize: 24,
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          opacity: 1,
          zIndex: 1,
          start: 0,
          end: 6,
        } satisfies GraphicTextNode,
        {
          id: "source-label",
          type: "text",
          text: graphicSceneTemplateSourceLabel("zh-TW", "quoted", "合成聊天"),
          fontSize: 14,
          x: 0,
          y: 0,
          width: 320,
          height: 40,
          opacity: 1,
          zIndex: 2,
          start: 0,
          end: 6,
        } satisfies GraphicTextNode,
      ],
    });
    const templateRecords: GraphicSceneTemplateRecord[] = [
      {
        version: 1,
        sceneId: scene.id,
        templateId: "conversation-card",
        data: {
          locale: "zh-TW",
          messages: [
            {
              id: "message-1",
              speakerNodeId: "speaker",
              textNodeId: "message",
              sourceLabelNodeId: "source-label",
              source: {
                originalText: sourceText,
                citation: "合成聊天",
                attribution: "quoted",
              },
            },
          ],
        },
      },
    ];
    const { editor } = await fixture(scene, templateRecords);
    const proposal = await editor.previewGraphicSceneAgent("composition", {
      ...request(editor),
      sceneId: scene.id,
      nodeIds: ["message"],
      instruction: "文字改為已更新",
    });
    expect(proposal.actions).toEqual([]);
    expect(proposal.conflicts).toMatchObject([
      { code: "invalid", nodeId: "message" },
    ]);
  });

  it("previews without saving and accepts only explicit actions as one undoable edit", async () => {
    const { app, editor, directory } = await fixture();
    const before = editor.get("composition");
    const save = vi.spyOn(app, "save");
    const proposal = await editor.previewGraphicSceneAgent(
      "composition",
      request(editor),
    );
    expect(proposal).toMatchObject({
      baseRevision: before.revision,
      source: "local",
      nodeIds: ["selected"],
      conflicts: [],
      actions: [
        {
          nodeId: "selected",
          before: { x: 12, y: 0 },
          after: { x: 28, y: 0 },
        },
      ],
    });
    expect(save).not.toHaveBeenCalled();
    const acceptance = {
      planId: proposal.id,
      baseRevision: proposal.baseRevision,
      actionIds: [proposal.actions[0]!.id],
      requestId: "accept-local-agent-edit",
    };
    const accepted = await editor.acceptGraphicSceneAgent(
      "composition",
      acceptance,
    );
    const replay = await editor.acceptGraphicSceneAgent(
      "composition",
      acceptance,
    );
    expect(replay.revision).toBe(accepted.revision);
    expect(replay.acknowledgedRevision).toBe(accepted.revision);
    expect(save).toHaveBeenCalledTimes(1);
    expect(accepted.canUndo).toBe(true);
    expect(accepted.composition.graphicScenes![0]).not.toHaveProperty(
      "userOverrides",
    );
    expect(accepted.composition.graphicScenes![0]!.nodes).toMatchObject([
      { id: "selected", x: 28 },
      { id: "private-unselected", x: 90 },
    ]);
    const undone = await editor.undo("composition", accepted.revision);
    expect(undone.composition.graphicScenes![0]!.nodes).toMatchObject([
      { id: "selected", x: 12 },
      { id: "private-unselected", x: 90 },
    ]);
    const redone = await editor.redo("composition", undone.revision);
    expect(redone.composition).toEqual(accepted.composition);
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    expect(
      new TimelineEditor(reopened).get("composition").composition.graphicScenes,
    ).toEqual(accepted.composition.graphicScenes);
  });

  it.each(["automatic-first", "direct-first"] as const)(
    "binds request replay to its producer authority (%s)",
    async (order) => {
      const { app, editor, directory } = await fixture();
      const before = editor.get("composition");
      const proposal = await editor.previewGraphicSceneAgent(
        "composition",
        request(editor),
      );
      const scene = structuredClone(before.composition.graphicScenes![0]!);
      scene.nodes[0]!.x = 28;
      const acceptance = {
        planId: proposal.id,
        baseRevision: proposal.baseRevision,
        actionIds: proposal.actions.map((action) => action.id),
        requestId: `shared-producer-${order}`,
      };
      const edit = {
        baseRevision: before.revision,
        requestId: acceptance.requestId,
        commands: [{ type: "graphic.scene.upsert" as const, scene }],
      };
      const automatic = () =>
        editor.acceptGraphicSceneAgent("composition", acceptance);
      const direct = () => editor.edit("composition", edit);
      const first = order === "automatic-first" ? automatic : direct;
      const second = order === "automatic-first" ? direct : automatic;
      const accepted = await first();
      const project = structuredClone(app.project);
      const bytes = await readFile(join(directory, "project.json"));
      await expect(second()).rejects.toMatchObject({ status: 409 });
      expect(editor.get("composition")).toEqual(accepted);
      expect(app.project).toEqual(project);
      expect(await readFile(join(directory, "project.json"))).toEqual(bytes);
      const replay = await first();
      expect(replay.revision).toBe(accepted.revision);
      expect(replay.acknowledgedRevision).toBe(accepted.revision);
      expect(
        accepted.composition.graphicScenes![0]!.userOverrides?.isUserPinned,
      ).toBe(order === "direct-first" ? true : undefined);
      const undone = await editor.undo("composition", accepted.revision);
      expect(undone.composition).toEqual(before.composition);
      expect(undone.canUndo).toBe(false);
    },
  );

  it("rejects a pinned scene before publication and preserves an explicit release on acceptance", async () => {
    const { app, editor, directory } = await fixture();
    const before = editor.get("composition");
    const scene = structuredClone(before.composition.graphicScenes![0]!);
    scene.nodes[0]!.x = 20;
    const pinned = await editor.edit("composition", {
      baseRevision: before.revision,
      commands: [{ type: "graphic.scene.upsert", scene }],
    });
    expect(
      pinned.composition.graphicScenes![0]!.userOverrides?.isUserPinned,
    ).toBe(true);
    const proposal = await editor.previewGraphicSceneAgent(
      "composition",
      request(editor),
    );
    const previousProject = app.project;
    const bytes = await readFile(join(directory, "project.json"));
    const save = vi.spyOn(app, "save");
    await expect(
      editor.acceptGraphicSceneAgent("composition", {
        planId: proposal.id,
        baseRevision: proposal.baseRevision,
        actionIds: proposal.actions.map((action) => action.id),
        requestId: "pinned-agent-edit",
      }),
    ).rejects.toMatchObject({ code: "timeline.pinConflict", status: 409 });
    expect(save).not.toHaveBeenCalled();
    expect(app.project).toBe(previousProject);
    expect(editor.get("composition")).toEqual(pinned);
    expect(await readFile(join(directory, "project.json"))).toEqual(bytes);
    const released = await editor.edit("composition", {
      baseRevision: pinned.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "graphic-scene", sceneId: scene.id },
          pinned: false,
        },
      ],
    });
    const fresh = await editor.previewGraphicSceneAgent(
      "composition",
      request(editor),
    );
    const accepted = await editor.acceptGraphicSceneAgent("composition", {
      planId: fresh.id,
      baseRevision: fresh.baseRevision,
      actionIds: fresh.actions.map((action) => action.id),
      requestId: "released-agent-edit",
    });
    expect(accepted.composition.graphicScenes![0]!.userOverrides).toEqual({
      version: 1,
      isUserPinned: false,
      lockedAttributes: [],
    });
    expect(accepted.composition.graphicScenes![0]!.nodes[0]!.x).toBe(36);
    const undone = await editor.undo("composition", accepted.revision);
    expect(undone.composition).toEqual(released.composition);
    const repinned = await editor.undo("composition", undone.revision);
    expect(repinned.composition).toEqual(pinned.composition);
    const original = await editor.undo("composition", repinned.revision);
    expect(original.composition).toEqual(before.composition);
  });

  it.each(["writer", "CAS"] as const)(
    "keeps automatic acceptance and retry history atomic on a real %s failure",
    async (failure) => {
      const { app, editor, directory } = await fixture();
      const before = editor.get("composition");
      const proposal = await editor.previewGraphicSceneAgent(
        "composition",
        request(editor),
      );
      const acceptance = {
        planId: proposal.id,
        baseRevision: proposal.baseRevision,
        actionIds: proposal.actions.map((action) => action.id),
        requestId: `failed-automatic-${failure}`,
      };
      const path = join(directory, "project.json");
      const backup = `${path}.backup`;
      const previousProject = app.project;
      if (failure === "writer") {
        await rename(path, backup);
        await symlink(backup, path);
      } else {
        const other = await OpenFilmApplication.open(directory);
        applications.add(other);
        other.project.title = "A concurrent writer's title";
        await other.save();
      }
      const bytes = await readFile(path);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const accepted = editor.acceptGraphicSceneAgent(
            "composition",
            acceptance,
          );
          if (failure === "writer")
            await expect(accepted).rejects.toThrow(
              "Project file must be regular",
            );
          else
            await expect(accepted).rejects.toMatchObject({
              code: "story.planConflict",
              status: 409,
            });
          expect(app.project).toBe(previousProject);
          expect(editor.get("composition")).toEqual(before);
          expect(await readFile(path)).toEqual(bytes);
          await expect(
            editor.undo("composition", before.revision),
          ).rejects.toThrow("Nothing to undo");
        }
      } finally {
        if (failure === "writer") {
          await unlink(path);
          await rename(backup, path);
        }
      }
      if (failure === "writer") {
        const accepted = await editor.acceptGraphicSceneAgent(
          "composition",
          acceptance,
        );
        expect(accepted.composition.graphicScenes![0]).not.toHaveProperty(
          "userOverrides",
        );
        expect(
          (await editor.undo("composition", accepted.revision)).composition,
        ).toEqual(before.composition);
      }
    },
  );

  it("uses ProviderRegistry consent and sends only the selected layer snapshot", async () => {
    const { app, editor } = await fixture();
    const generate = vi.fn<LanguageProvider["generate"]>(async () =>
      JSON.stringify({
        operations: [
          {
            kind: "set",
            nodeId: "private-unselected",
            field: "x",
            value: 400,
            reason: "Do not apply this unselected operation.",
          },
          {
            kind: "set",
            nodeId: "selected",
            field: "x",
            value: 24,
            reason: "Move the selected layer.",
          },
        ],
      }),
    );
    const provider: LanguageProvider = {
      id: "graphic-agent-remote-fixture",
      name: "Synthetic review provider",
      kind: "language",
      execution: "remote",
      endpoint: "https://review.example.invalid",
      dataKinds: ["text"],
      generate,
    };
    app.knowledge.registerLanguageProvider(provider);
    await expect(
      editor.previewGraphicSceneAgent(
        "composition",
        request(editor, "provider", "Move the selected rectangle."),
      ),
    ).rejects.toMatchObject({ code: "review.providerUnavailable" });
    expect(generate).not.toHaveBeenCalled();
    app.knowledge.grantConsent({
      providerId: provider.id,
      dataKinds: ["text"],
      grantedAt: "2026-10-19T00:00:00.000Z",
    });
    const proposal = await editor.previewGraphicSceneAgent(
      "composition",
      request(editor, "provider", "Move the selected rectangle."),
    );
    expect(proposal.source).toBe("provider");
    expect(proposal.conflicts).toMatchObject([
      { code: "unselected", nodeId: "private-unselected" },
    ]);
    expect(proposal.actions).toHaveLength(1);
    const payload = JSON.parse(
      generate.mock.calls[0]![0].split("\n").at(-1)!,
    ) as { allowedNodeIds: string[]; nodes: { id: string }[] };
    expect(payload.allowedNodeIds).toEqual(["selected"]);
    expect(payload.nodes.map((node) => node.id)).toEqual(["selected"]);
    expect(generate.mock.calls[0]![0]).not.toContain("private-unselected");
    expect(generate.mock.calls[0]![0]).not.toContain("project.json");
    const accepted = await editor.acceptGraphicSceneAgent("composition", {
      planId: proposal.id,
      baseRevision: proposal.baseRevision,
      actionIds: proposal.actions.map((action) => action.id),
      requestId: "accept-provider-agent-edit",
    });
    expect(accepted.composition.graphicScenes![0]!.nodes).toMatchObject([
      { id: "selected", x: 24 },
      { id: "private-unselected", x: 90 },
    ]);
  });

  it("rejects stale proposals and reports locked selected layers without actions", async () => {
    const { editor: lockedEditor } = await fixture(
      graphicScene({ nodes: [graphicNode({ id: "selected", locked: true })] }),
    );
    const locked = await lockedEditor.previewGraphicSceneAgent(
      "composition",
      request(lockedEditor),
    );
    expect(locked.actions).toEqual([]);
    expect(locked.conflicts).toMatchObject([
      { code: "locked", nodeId: "selected" },
    ]);

    const { editor } = await fixture();
    const proposal = await editor.previewGraphicSceneAgent(
      "composition",
      request(editor),
    );
    const current = editor.get("composition");
    const editedScene = structuredClone(current.composition.graphicScenes![0]!);
    editedScene.nodes[0]!.x = 44;
    const edited = await editor.edit("composition", {
      baseRevision: current.revision,
      commands: [{ type: "graphic.scene.upsert", scene: editedScene }],
    });
    await expect(
      editor.acceptGraphicSceneAgent("composition", {
        planId: proposal.id,
        baseRevision: proposal.baseRevision,
        actionIds: [proposal.actions[0]!.id],
        requestId: "stale-agent-edit",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(editor.get("composition").revision).toBe(edited.revision);
    expect(
      editor.get("composition").composition.graphicScenes![0]!.nodes[0]!.x,
    ).toBe(44);
  });
});
