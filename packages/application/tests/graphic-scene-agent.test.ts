import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
