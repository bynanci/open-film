import {
  GRAPHIC_SCENE_LIMITS,
  validateGraphicScenes,
  type GraphicNode,
  type GraphicScene,
} from "@openfilm/core";

export type GraphicSceneAgentField =
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotation"
  | "opacity"
  | "zIndex"
  | "hidden"
  | "text"
  | "fill";

export type GraphicSceneAgentOperation =
  | {
      kind: "translate";
      nodeId: string;
      dx: number;
      dy: number;
      reason: string;
    }
  | {
      kind: "set";
      nodeId: string;
      field: GraphicSceneAgentField;
      value: string | number | boolean;
      reason: string;
    };

export interface GraphicSceneAgentAction {
  id: string;
  nodeId: string;
  operation: GraphicSceneAgentOperation;
  reason: string;
  before: unknown;
  after: unknown;
  requiresActionIds: string[];
}

export interface GraphicSceneAgentConflict {
  code:
    | "unsupported"
    | "invalid"
    | "unselected"
    | "missing"
    | "locked"
    | "duplicate";
  nodeId?: string;
  text: string;
}

export interface PreparedGraphicSceneAgentProposal {
  scene: GraphicScene;
  actions: GraphicSceneAgentAction[];
  conflicts: GraphicSceneAgentConflict[];
}

type CandidateValidator = (candidate: GraphicScene) => void;

const fields: readonly GraphicSceneAgentField[] = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
  "zIndex",
  "hidden",
  "text",
  "fill",
];
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit &&
    ![...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
    })
  );
}

function conciseReason(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let end = limit - 1;
  const before = value.charCodeAt(end - 1);
  const after = value.charCodeAt(end);
  if (
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  )
    end--;
  return `${value.slice(0, end)}…`;
}

/** Parse provider JSON as data only. No markdown, executable text or extra keys are admitted. */
export function parseGraphicSceneAgentOperations(
  value: string,
): GraphicSceneAgentOperation[] {
  if (typeof value !== "string" || value.length > 24_000)
    throw new Error("The language provider returned an oversized proposal.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The language provider must return one JSON object.");
  }
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ["operations"]) ||
    !Array.isArray(parsed.operations) ||
    parsed.operations.length > 12
  )
    throw new Error(
      "The proposal must contain at most 12 allowlisted operations.",
    );
  return parsed.operations.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !boundedText(entry.nodeId, 128) ||
      !boundedText(entry.reason, 300)
    )
      throw new Error(
        `Operation ${index + 1} has invalid identity or reason text.`,
      );
    if (entry.kind === "translate") {
      if (
        !hasOnlyKeys(entry, ["kind", "nodeId", "dx", "dy", "reason"]) ||
        typeof entry.dx !== "number" ||
        !Number.isFinite(entry.dx) ||
        Math.abs(entry.dx) > 4096 ||
        typeof entry.dy !== "number" ||
        !Number.isFinite(entry.dy) ||
        Math.abs(entry.dy) > 4096
      )
        throw new Error(
          `Operation ${index + 1} has invalid translation values.`,
        );
      return {
        kind: "translate",
        nodeId: entry.nodeId,
        dx: entry.dx,
        dy: entry.dy,
        reason: entry.reason,
      };
    }
    if (
      entry.kind !== "set" ||
      !hasOnlyKeys(entry, ["kind", "nodeId", "field", "value", "reason"]) ||
      typeof entry.field !== "string" ||
      !fields.includes(entry.field as GraphicSceneAgentField) ||
      !(
        typeof entry.value === "number" ||
        typeof entry.value === "boolean" ||
        typeof entry.value === "string"
      ) ||
      (typeof entry.value === "number" && !Number.isFinite(entry.value)) ||
      (typeof entry.value === "string" && entry.value.length > 10_000)
    )
      throw new Error(
        `Operation ${index + 1} is outside the GraphicScene allowlist.`,
      );
    return {
      kind: "set",
      nodeId: entry.nodeId,
      field: entry.field as GraphicSceneAgentField,
      value: entry.value,
      reason: entry.reason,
    };
  });
}

function findNode(
  nodes: GraphicNode[],
  nodeId: string,
  lockedAncestor = false,
): { node: GraphicNode; locked: boolean } | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) {
      const lockedDescendant =
        node.type === "group" && node.children.some(containsLockedNode);
      return {
        node,
        locked: lockedAncestor || !!node.locked || lockedDescendant,
      };
    }
    if (node.type === "group") {
      const found = findNode(
        node.children,
        nodeId,
        lockedAncestor || !!node.locked,
      );
      if (found) return found;
    }
  }
}

function containsLockedNode(node: GraphicNode): boolean {
  return (
    !!node.locked ||
    (node.type === "group" && node.children.some(containsLockedNode))
  );
}

export function graphicSceneNodeLockState(scene: GraphicScene, nodeId: string) {
  const found = findNode(scene.nodes, nodeId);
  return found
    ? { exists: true, locked: found.locked }
    : { exists: false, locked: false };
}

function nodeFor(scene: GraphicScene, nodeId: string): GraphicNode | undefined {
  return findNode(scene.nodes, nodeId)?.node;
}

function scalar(node: GraphicNode, field: GraphicSceneAgentField): unknown {
  if (field === "rotation") return node.rotation ?? 0;
  if (field === "hidden") return !!node.hidden;
  if (field === "text" && node.type === "text") return node.text;
  if (field === "fill" && node.type === "shape") return node.fill;
  return node[field as keyof GraphicNode];
}

function setField(
  node: GraphicNode,
  field: GraphicSceneAgentField,
  value: string | number | boolean,
): void {
  if (field === "text") {
    if (node.type !== "text" || typeof value !== "string")
      throw new Error("Only a Text layer can change its text.");
    node.text = value;
    return;
  }
  if (field === "fill") {
    if (node.type !== "shape" || typeof value !== "string")
      throw new Error("Only a Shape layer can change its fill.");
    node.fill = value;
    return;
  }
  if (field === "hidden") {
    if (typeof value !== "boolean")
      throw new Error("Hidden must be a boolean.");
    node.hidden = value;
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${field} must be a finite number.`);
  if (field === "x" || field === "y") {
    if (value < -8192 || value > 8192)
      throw new Error(`${field} is out of bounds.`);
  } else if (field === "width" || field === "height") {
    if (value < 1 || value > 4096)
      throw new Error(`${field} is out of bounds.`);
  } else if (field === "rotation") {
    if (value < -3600 || value > 3600)
      throw new Error("Rotation is out of bounds.");
    node.rotation = value;
    return;
  } else if (field === "opacity") {
    if (value < 0 || value > 1)
      throw new Error("Opacity must be between zero and one.");
  } else if (field === "zIndex") {
    if (!Number.isInteger(value) || value < -1000 || value > 1000)
      throw new Error("Z-order must be an integer between -1000 and 1000.");
  }
  (node as unknown as Record<string, unknown>)[field] = value;
}

function applyOperation(
  scene: GraphicScene,
  operation: GraphicSceneAgentOperation,
  compositionDuration: number,
  validateCandidate?: CandidateValidator,
): { scene: GraphicScene; before: unknown; after: unknown } {
  const candidate = structuredClone(scene);
  const target = nodeFor(candidate, operation.nodeId);
  if (!target) throw new Error("The selected layer no longer exists.");
  let before: unknown;
  let after: unknown;
  if (operation.kind === "translate") {
    if (
      !hasOnlyKeys(operation, ["kind", "nodeId", "dx", "dy", "reason"]) ||
      typeof operation.dx !== "number" ||
      !Number.isFinite(operation.dx) ||
      Math.abs(operation.dx) > 4096 ||
      typeof operation.dy !== "number" ||
      !Number.isFinite(operation.dy) ||
      Math.abs(operation.dy) > 4096 ||
      !boundedText(operation.reason, 300)
    )
      throw new Error("Translation is outside the allowlist bounds.");
    before = { x: target.x, y: target.y };
    after = { x: target.x + operation.dx, y: target.y + operation.dy };
    setField(target, "x", (after as { x: number }).x);
    setField(target, "y", (after as { y: number }).y);
  } else if (operation.kind === "set") {
    if (
      !hasOnlyKeys(operation, ["kind", "nodeId", "field", "value", "reason"]) ||
      !fields.includes(operation.field) ||
      !(
        typeof operation.value === "number" ||
        typeof operation.value === "boolean" ||
        typeof operation.value === "string"
      ) ||
      !boundedText(operation.reason, 300)
    )
      throw new Error("Set operation is outside the allowlist.");
    before = scalar(target, operation.field);
    setField(target, operation.field, operation.value);
    after = scalar(target, operation.field);
  } else {
    throw new Error("Unknown operation kind.");
  }
  validateGraphicScenes([candidate], compositionDuration);
  validateCandidate?.(candidate);
  return { scene: candidate, before, after };
}

function operationsCanApply(
  scene: GraphicScene,
  operations: readonly GraphicSceneAgentOperation[],
  compositionDuration: number,
  validateCandidate?: CandidateValidator,
): boolean {
  let current = scene;
  try {
    for (const operation of operations)
      current = applyOperation(
        current,
        operation,
        compositionDuration,
        validateCandidate,
      ).scene;
    return true;
  } catch {
    return false;
  }
}

/** Validate one-node allowlisted operations and compile a detached preview. */
export function prepareGraphicSceneAgentProposal(
  scene: GraphicScene,
  selectedNodeIds: readonly string[],
  operations: readonly GraphicSceneAgentOperation[],
  compositionDuration: number,
  validateCandidate?: CandidateValidator,
): PreparedGraphicSceneAgentProposal {
  const selected = new Set(selectedNodeIds);
  const proposal: PreparedGraphicSceneAgentProposal = {
    scene: structuredClone(scene),
    actions: [],
    conflicts: [],
  };
  if (
    !selected.size ||
    selected.size > 8 ||
    selected.size !== selectedNodeIds.length
  ) {
    proposal.conflicts.push({
      code: "invalid",
      text: "Select between one and eight unique layers.",
    });
    return proposal;
  }
  const touched = new Set<string>();
  let current = structuredClone(scene);
  for (const [index, operation] of operations.entries()) {
    if (!isRecord(operation) || !boundedText(operation.nodeId, 128)) {
      proposal.conflicts.push({
        code: "invalid",
        text: `Operation ${index + 1} has an invalid layer ID.`,
      });
      continue;
    }
    const nodeId = operation.nodeId;
    if (!selected.has(nodeId)) {
      proposal.conflicts.push({
        code: "unselected",
        nodeId,
        text: "This operation targets a layer that was not selected.",
      });
      continue;
    }
    const found = findNode(current.nodes, nodeId);
    if (!found) {
      proposal.conflicts.push({
        code: "missing",
        nodeId,
        text: "The selected layer no longer exists.",
      });
      continue;
    }
    if (found.locked) {
      proposal.conflicts.push({
        code: "locked",
        nodeId,
        text: "This layer or one of its groups is locked.",
      });
      continue;
    }
    const keys =
      operation.kind === "translate"
        ? [`${nodeId}:x`, `${nodeId}:y`]
        : operation.kind === "set" && typeof operation.field === "string"
          ? [`${nodeId}:${operation.field}`]
          : [];
    if (!keys.length || keys.some((key) => touched.has(key))) {
      proposal.conflicts.push({
        code: "duplicate",
        nodeId,
        text: "Conflicting operations target the same layer property.",
      });
      continue;
    }
    let applied: ReturnType<typeof applyOperation>;
    try {
      applied = applyOperation(
        current,
        operation,
        compositionDuration,
        validateCandidate,
      );
    } catch (error) {
      proposal.conflicts.push({
        code: "invalid",
        nodeId,
        text:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "The operation could not be validated.",
      });
      continue;
    }
    let prerequisites: typeof proposal.actions = [];
    if (
      !operationsCanApply(
        scene,
        [operation],
        compositionDuration,
        validateCandidate,
      )
    ) {
      prerequisites = proposal.actions.slice();
      for (const previous of proposal.actions) {
        const without = prerequisites.filter(
          (action) => action.id !== previous.id,
        );
        if (
          operationsCanApply(
            scene,
            [...without.map((action) => action.operation), operation],
            compositionDuration,
            validateCandidate,
          )
        )
          prerequisites = without;
      }
    }
    // Keep only earlier reviewed actions needed to make this change valid.
    const requiresActionIds = prerequisites.map((action) => action.id);
    for (const key of keys) touched.add(key);
    current = applied.scene;
    proposal.actions.push({
      id: `agent-action-${index + 1}`,
      nodeId,
      operation: structuredClone(operation),
      reason: operation.reason,
      before: structuredClone(applied.before),
      after: structuredClone(applied.after),
      requiresActionIds,
    });
  }
  proposal.scene = current;
  return proposal;
}

/** Compile only explicitly selected proposal actions against their saved base scene. */
export function applyGraphicSceneAgentActions(
  scene: GraphicScene,
  selectedNodeIds: readonly string[],
  actions: readonly GraphicSceneAgentAction[],
  actionIds: readonly string[],
  compositionDuration: number,
  validateCandidate?: CandidateValidator,
): GraphicScene {
  if (scene.userOverrides?.isUserPinned)
    throw new Error(
      "The scene is user pinned. Release its user pin before applying suggestions.",
    );
  if (
    !Array.isArray(actionIds) ||
    !actionIds.length ||
    new Set(actionIds).size !== actionIds.length
  )
    throw new Error("Choose at least one unique proposal action.");
  const selected = new Set(actionIds);
  const selectedActions = actions.filter((action) => selected.has(action.id));
  if (selectedActions.length !== selected.size)
    throw new Error("The selected proposal action no longer exists.");
  for (const action of selectedActions)
    if (action.requiresActionIds.some((id) => !selected.has(id)))
      throw new Error("Select required earlier proposal actions first.");
  // Apply in the reviewed proposal order, independent of checkbox click order.
  const operations = selectedActions.map((action) => {
    if (!selectedNodeIds.includes(action.nodeId))
      throw new Error("Proposal actions may only update selected layers.");
    return action.operation;
  });
  const compiled = prepareGraphicSceneAgentProposal(
    scene,
    selectedNodeIds,
    operations,
    compositionDuration,
    validateCandidate,
  );
  if (
    compiled.actions.length !== operations.length ||
    compiled.conflicts.length
  )
    throw new Error("The selected proposal conflicts with the saved scene.");
  return compiled.scene;
}

/** Deterministic, deliberately small command grammar retained when no provider is configured. */
export function parseLocalGraphicSceneInstruction(
  instruction: string,
  selectedNode: GraphicNode,
): {
  operations: GraphicSceneAgentOperation[];
  conflicts: GraphicSceneAgentConflict[];
} {
  const source = instruction.trim();
  const unsupported = (): {
    operations: GraphicSceneAgentOperation[];
    conflicts: GraphicSceneAgentConflict[];
  } => ({
    operations: [],
    conflicts: [
      {
        code: "unsupported",
        nodeId: selectedNode.id,
        text: "Use a supported local command or choose an authorized language provider.",
      },
    ],
  });
  const move = source.match(
    /^(?:move|nudge)(?: the)?(?: selected)?(?: layer)? (left|right|up|down)(?: by)?\s+(\d+(?:\.\d+)?)(?:\s*(?:px|pixels))?$/iu,
  );
  const moveZh = source.match(
    /^向(左|右|上|下)(?:移動|平移)?\s*(\d+(?:\.\d+)?)\s*(?:px|像素)?$/u,
  );
  const directionMap: Record<string, "left" | "right" | "up" | "down"> = {
    左: "left",
    右: "right",
    上: "up",
    下: "down",
  };
  const englishDirection = move?.[1]?.toLowerCase();
  const moveDirection =
    (englishDirection as "left" | "right" | "up" | "down" | undefined) ??
    (moveZh?.[1] ? directionMap[moveZh[1]] : undefined);
  const moveAmount = Number(move?.[2] ?? moveZh?.[2]);
  if (
    moveDirection &&
    Number.isFinite(moveAmount) &&
    moveAmount > 0 &&
    moveAmount <= 4096
  ) {
    const vector = {
      left: [-moveAmount, 0],
      right: [moveAmount, 0],
      up: [0, -moveAmount],
      down: [0, moveAmount],
    }[moveDirection];
    return {
      operations: [
        {
          kind: "translate",
          nodeId: selectedNode.id,
          dx: vector[0]!,
          dy: vector[1]!,
          reason: source,
        },
      ],
      conflicts: [],
    };
  }
  const rotate =
    source.match(
      /^(?:rotate|turn)(?: selected)?(?: layer)?(?: by)?\s*(-?\d+(?:\.\d+)?)\s*(?:degrees?|°)$/iu,
    ) ?? source.match(/^旋轉\s*(-?\d+(?:\.\d+)?)\s*(?:度|°)$/u);
  if (rotate) {
    const current = selectedNode.rotation ?? 0;
    return {
      operations: [
        {
          kind: "set",
          nodeId: selectedNode.id,
          field: "rotation",
          value: current + Number(rotate[1]),
          reason: source,
        },
      ],
      conflicts: [],
    };
  }
  const opacity =
    source.match(/^(?:set\s+)?opacity(?:\s+to)?\s+(\d+(?:\.\d+)?)(%)?$/iu) ??
    source.match(/^透明度(?:設為|調整為|到)?\s*(\d+(?:\.\d+)?)(%)?$/u);
  if (opacity) {
    const value =
      Number(opacity[1]) / (opacity[2] || Number(opacity[1]) > 1 ? 100 : 1);
    return {
      operations: [
        {
          kind: "set",
          nodeId: selectedNode.id,
          field: "opacity",
          value,
          reason: source,
        },
      ],
      conflicts: [],
    };
  }
  if (/^(?:hide(?: the)?(?: selected)?(?: layer)?|隱藏)$/iu.test(source))
    return {
      operations: [
        {
          kind: "set",
          nodeId: selectedNode.id,
          field: "hidden",
          value: true,
          reason: source,
        },
      ],
      conflicts: [],
    };
  if (/^(?:show(?: the)?(?: selected)?(?: layer)?|顯示)$/iu.test(source))
    return {
      operations: [
        {
          kind: "set",
          nodeId: selectedNode.id,
          field: "hidden",
          value: false,
          reason: source,
        },
      ],
      conflicts: [],
    };
  const sizePair =
    source.match(
      /^(?:set\s+)?size(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*(?:x|,|\s)\s*(\d+(?:\.\d+)?)$/iu,
    ) ??
    source.match(
      /^尺寸(?:設為)?\s*(\d+(?:\.\d+)?)\s*[x,，\s]\s*(\d+(?:\.\d+)?)$/u,
    );
  if (sizePair) {
    const width = Number(sizePair[1]);
    const height = Number(sizePair[2]);
    const order =
      width * selectedNode.height <= GRAPHIC_SCENE_LIMITS.pixels ||
      selectedNode.width * height > GRAPHIC_SCENE_LIMITS.pixels
        ? (["width", "height"] as const)
        : (["height", "width"] as const);
    return {
      operations: order.map((field) => ({
        kind: "set",
        nodeId: selectedNode.id,
        field,
        value: field === "width" ? width : height,
        reason: source,
      })),
      conflicts: [],
    };
  }
  const size =
    source.match(/^(?:set\s+)?(width|height)(?:\s+to)?\s+(\d+(?:\.\d+)?)$/iu) ??
    source.match(/^(width|height)\s+(\d+(?:\.\d+)?)$/iu) ??
    source.match(/^(寬度|高度)(?:設為)?\s*(\d+(?:\.\d+)?)$/u);
  if (size)
    return {
      operations: [
        {
          kind: "set",
          nodeId: selectedNode.id,
          field:
            (
              { 寬度: "width", 高度: "height" } as Record<
                string,
                "width" | "height"
              >
            )[size[1]!] ?? (size[1]!.toLowerCase() as "width" | "height"),
          value: Number(size[2]),
          reason: source,
        },
      ],
      conflicts: [],
    };
  const text =
    source.match(/^(?:set\s+text|text)(?:\s+to)?\s+(.+)$/iu) ??
    source.match(/^文字(?:改為|設為)(.+)$/u);
  if (text && selectedNode.type === "text" && text[1]!.trim().length <= 10_000)
    return {
      operations: [
        {
          kind: "set",
          nodeId: selectedNode.id,
          field: "text",
          value: text[1]!.trim(),
          reason: conciseReason(source, 300),
        },
      ],
      conflicts: [],
    };
  const rotation = source.match(
    /^(?:set\s+)?rotation(?:\s+to)?\s+(-?\d+(?:\.\d+)?)$/iu,
  );
  if (rotation)
    return {
      operations: [
        {
          kind: "set",
          nodeId: selectedNode.id,
          field: "rotation",
          value: Number(rotation[1]),
          reason: source,
        },
      ],
      conflicts: [],
    };
  return unsupported();
}
