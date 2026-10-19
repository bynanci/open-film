import { describe, expect, it } from "vitest";
import type { GraphicGroupNode } from "@openfilm/core";
import {
  applyGraphicSceneAgentActions,
  parseGraphicSceneAgentOperations,
  parseLocalGraphicSceneInstruction,
  prepareGraphicSceneAgentProposal,
} from "../src/index.js";
import {
  graphicNode,
  graphicScene,
} from "../../../tests/fixtures/graphic-scene.js";

describe("reviewable GraphicScene agent operations", () => {
  it("parses a deterministic local command into an allowlisted typed operation", () => {
    const scene = graphicScene();
    const node = scene.nodes[0]!;
    const parsed = parseLocalGraphicSceneInstruction("move right 16", node);
    expect(parsed).toEqual({
      operations: [
        {
          kind: "translate",
          nodeId: node.id,
          dx: 16,
          dy: 0,
          reason: "move right 16",
        },
      ],
      conflicts: [],
    });
    expect(
      parseLocalGraphicSceneInstruction("向左移動 12 像素", node).operations,
    ).toMatchObject([{ kind: "translate", dx: -12, dy: 0 }]);
    expect(
      parseLocalGraphicSceneInstruction("size 320 180", node).operations,
    ).toMatchObject([
      { kind: "set", field: "width", value: 320 },
      { kind: "set", field: "height", value: 180 },
    ]);
    const caption = {
      id: "caption",
      type: "text" as const,
      text: "原始文字",
      fontSize: 32,
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      opacity: 1,
      zIndex: 1,
      start: 0,
      end: 6,
    };
    expect(
      parseLocalGraphicSceneInstruction("文字改為新的標題", caption).operations,
    ).toMatchObject([{ kind: "set", field: "text", value: "新的標題" }]);
    expect(
      parseLocalGraphicSceneInstruction("make it cinematic", node),
    ).toMatchObject({
      operations: [],
      conflicts: [{ code: "unsupported" }],
    });
  });

  it("rejects provider output outside the JSON operation whitelist", () => {
    expect(() =>
      parseGraphicSceneAgentOperations(
        '{"operations":[{"kind":"set","nodeId":"rectangle","field":"x","value":4,"reason":"move","html":"<script>"}]}',
      ),
    ).toThrow(/allowlist/i);
    expect(() =>
      parseGraphicSceneAgentOperations('```json\n{"operations":[]}\n```'),
    ).toThrow(/JSON/i);
  });

  it("reports before and after values and applies only selected actions", () => {
    const scene = graphicScene();
    const nodeId = scene.nodes[0]!.id;
    const proposal = prepareGraphicSceneAgentProposal(
      scene,
      [nodeId],
      [
        {
          kind: "translate",
          nodeId,
          dx: 16,
          dy: 0,
          reason: "Move the selected layer right.",
        },
        {
          kind: "set",
          nodeId,
          field: "opacity",
          value: 0.5,
          reason: "Reduce opacity.",
        },
      ],
      6,
    );
    expect(proposal.conflicts).toEqual([]);
    expect(proposal.actions).toHaveLength(2);
    expect(proposal.actions[0]).toMatchObject({
      nodeId,
      before: { x: 0, y: 0 },
      after: { x: 16, y: 0 },
    });
    const selected = applyGraphicSceneAgentActions(
      scene,
      [nodeId],
      proposal.actions,
      [proposal.actions[1]!.id],
      6,
    );
    expect(selected.nodes[0]).toMatchObject({ x: 0, opacity: 0.5 });
  });

  it("never compiles unselected, locked or conflicting operations", () => {
    const scene = graphicScene({
      nodes: [
        graphicNode({ id: "selected" }),
        graphicNode({ id: "other", x: 20 }),
      ],
    });
    const proposal = prepareGraphicSceneAgentProposal(
      scene,
      ["selected"],
      [
        {
          kind: "set",
          nodeId: "other",
          field: "x",
          value: 30,
          reason: "not selected",
        },
        {
          kind: "set",
          nodeId: "selected",
          field: "x",
          value: 4,
          reason: "first",
        },
        {
          kind: "set",
          nodeId: "selected",
          field: "x",
          value: 8,
          reason: "conflict",
        },
      ],
      6,
    );
    expect(proposal.actions).toHaveLength(1);
    expect(proposal.conflicts.map((item) => item.code)).toEqual([
      "unselected",
      "duplicate",
    ]);

    const child = graphicNode({ id: "locked-child", locked: true });
    const groupBase = graphicNode();
    const { shape: _shape, fill: _fill, ...fields } = groupBase;
    const group: GraphicGroupNode = {
      ...fields,
      id: "group",
      type: "group",
      children: [child],
    };
    const locked = prepareGraphicSceneAgentProposal(
      graphicScene({ nodes: [group] }),
      [child.id],
      [{ kind: "translate", nodeId: child.id, dx: 10, dy: 0, reason: "move" }],
      6,
    );
    expect(locked.actions).toEqual([]);
    expect(locked.conflicts).toMatchObject([
      { code: "locked", nodeId: child.id },
    ]);
    const protectedGroup = prepareGraphicSceneAgentProposal(
      graphicScene({ nodes: [group] }),
      [group.id],
      [
        {
          kind: "translate",
          nodeId: group.id,
          dx: 10,
          dy: 0,
          reason: "move group",
        },
      ],
      6,
    );
    expect(protectedGroup.actions).toEqual([]);
    expect(protectedGroup.conflicts).toMatchObject([
      { code: "locked", nodeId: group.id },
    ]);
  });
});
