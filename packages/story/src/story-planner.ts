// Modified by OpenFilm contributors on 2026-10-22. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  createId,
  detectGraphCycle,
  validateStoryPlan,
  type IdeaSource,
  type MediaAsset,
  type Story,
  type StoryGraph,
  type StoryGraphNode,
  type StoryPlan,
  type StoryPlanAssetReference,
  type StoryPlanOptions,
  type StoryPlanPath,
  type StoryPlanScene,
} from "@openfilm/core";

const UNSUPPORTED_INTENT_KEYWORDS = [
  "drone-shot",
  "3d-hologram",
  "voice-clone",
  "ai-actor",
  "bullet-time",
  "hyper-lapse",
  "cgi-explosion",
  "virtual-set",
];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Pure deterministic 64-character hexadecimal digest.
 * Cross-platform without external runtime or Node crypto dependencies.
 */
function digest(value: unknown): string {
  const str = canonical(value);
  let h1 = 0x811c9dc5n;
  let h2 = 0x9e3779b9n;
  let h3 = 0x85ebca6bn;
  let h4 = 0xc2b2ae35n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    const code = BigInt(str.charCodeAt(i));
    h1 = ((h1 ^ code) * prime) & 0xffffffffffffffffn;
    h2 = ((h2 ^ (code + 1n)) * prime) & 0xffffffffffffffffn;
    h3 = ((h3 ^ (code + 2n)) * prime) & 0xffffffffffffffffn;
    h4 = ((h4 ^ (code + 3n)) * prime) & 0xffffffffffffffffn;
  }
  return [h1, h2, h3, h4].map((h) => h.toString(16).padStart(16, "0")).join("");
}

/**
 * Calculates estimated narration reading time in seconds based on reading pace:
 * ~3.5 CJK characters per second, ~2.5 Latin words per second.
 * Minimum baseline: 3.0 seconds.
 * Narrative protection: never fabricates fake microsecond or word timings.
 */
export function estimateNarrationDuration(text?: string): number {
  if (!text || !text.trim()) {
    return 3.0;
  }
  const clean = text.trim();
  const cjkMatches = clean.match(/[\u4e00-\u9fa5]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const latinText = clean.replace(/[\u4e00-\u9fa5\p{P}\p{S}]/gu, " ").trim();
  const latinWords = latinText
    ? latinText.split(/\s+/).filter(Boolean).length
    : 0;

  const seconds = cjkCount / 3.5 + latinWords / 2.5;
  return Math.max(3.0, Math.round(seconds * 10) / 10);
}

/**
 * Generates a reviewable Storyboard proposal (StoryPlan) from Story and StoryGraph.
 * StoryPlan is a proposal, NOT a second Timeline.
 * Strict guarantees:
 * 1. Narrative order is never inferred from canvas (x, y) coordinates.
 * 2. Unresolved alternative branches and cycles are explicitly flagged in conflicts.
 * 3. Echo assets are marked with distinct roles without creating fake asset IDs.
 * 4. Missing assets and duration conflicts are tracked as actionable gaps.
 * 5. Aesthetic suggestions are editorial rationales, never fake numerical scores.
 */
export function generateStoryPlanFromGraph(
  story: Story,
  graph: StoryGraph,
  assets: MediaAsset[],
  options: StoryPlanOptions = {},
): StoryPlan {
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const targetDuration = options.targetDuration ?? story.targetDuration ?? 30;
  const maxDuration =
    options.maxDuration ?? story.maxDuration ?? Math.max(targetDuration, 30);
  const title = options.title ?? `${story.title} Storyboard Plan`;
  const transition = options.transition ?? "cut";

  const conflicts: string[] = [];
  const unsupportedIntents: string[] = [];

  // 1. Check for unsupported freeform text intents in brief or story
  const textsToCheck = [
    options.brief ?? "",
    ...story.beats.flatMap((b) => [
      b.intent ?? "",
      b.script?.visualDirection ?? "",
    ]),
  ];
  for (const text of textsToCheck) {
    for (const kw of UNSUPPORTED_INTENT_KEYWORDS) {
      if (text.toLowerCase().includes(kw)) {
        const warning = `Unsupported freeform direction "${kw}" requested; will use standard framing and pacing instead.`;
        if (!unsupportedIntents.includes(warning)) {
          unsupportedIntents.push(warning);
        }
      }
    }
  }

  // 2. Cycle Detection along 'precedes' edges
  const cycle = detectGraphCycle(graph.nodes, graph.edges, "precedes");
  const cycleDetected = cycle ?? undefined;
  if (cycle) {
    conflicts.push(
      `Cyclic narrative dependency detected along beats: ${cycle.join(" -> ")}. Resolve cycle before adoption.`,
    );
  }

  // 3. Alternative Edge Detection
  const alternativeEdges = graph.edges.filter((e) => e.type === "alternative");
  const unresolvedAlternatives: Array<{
    fromNodeId: string;
    candidates: string[];
  }> = [];

  for (const altEdge of alternativeEdges) {
    // If selectedNodeIds is provided and disambiguates the alternative, it's resolved.
    const selected = options.selectedNodeIds;
    if (selected) {
      const fromSelected = selected.includes(altEdge.from);
      const toSelected = selected.includes(altEdge.to);
      if (fromSelected && toSelected) {
        unresolvedAlternatives.push({
          fromNodeId: altEdge.from,
          candidates: [altEdge.from, altEdge.to],
        });
        conflicts.push(
          `Unresolved alternative branch between "${altEdge.from}" and "${altEdge.to}". Select only one branch before adoption.`,
        );
      }
    } else {
      unresolvedAlternatives.push({
        fromNodeId: altEdge.from,
        candidates: [altEdge.from, altEdge.to],
      });
      conflicts.push(
        `Unresolved alternative branch between "${altEdge.from}" and "${altEdge.to}". Resolve alternatives before adoption.`,
      );
    }
  }

  // 4. Determine Candidate Nodes & Narrative Sequence
  // Canvas (x, y) coordinates MUST NEVER be used to infer order!
  let candidateNodes: StoryGraphNode[];
  if (options.selectedNodeIds && options.selectedNodeIds.length > 0) {
    const selectedSet = new Set(options.selectedNodeIds);
    candidateNodes = graph.nodes.filter((n) => selectedSet.has(n.id));
  } else {
    // If beat nodes exist, beats are the primary narrative spine.
    // Idea nodes attached to a beat (via contains, supports, or echoes) annotate that beat,
    // rather than becoming a duplicate separate scene card.
    const beatNodes = graph.nodes.filter((n) => n.type === "beat");
    if (beatNodes.length > 0) {
      const beatNodeIds = new Set(beatNodes.map((b) => b.id));
      const attachedIdeaNodeIds = new Set<string>();
      for (const e of graph.edges) {
        if (
          e.type === "contains" ||
          e.type === "supports" ||
          e.type === "echoes"
        ) {
          if (beatNodeIds.has(e.from)) attachedIdeaNodeIds.add(e.to);
          if (beatNodeIds.has(e.to)) attachedIdeaNodeIds.add(e.from);
        }
      }
      candidateNodes = graph.nodes.filter(
        (n) =>
          n.type === "beat" ||
          (n.type === "idea" && !attachedIdeaNodeIds.has(n.id)),
      );
    } else {
      candidateNodes = graph.nodes.filter(
        (n) => n.type === "beat" || n.type === "idea",
      );
      if (candidateNodes.length === 0) {
        candidateNodes = [...graph.nodes];
      }
    }
  }

  // Extract precedes edges between candidate nodes
  const candidateNodeIds = new Set(candidateNodes.map((n) => n.id));
  const candidatePrecedesEdges = graph.edges.filter(
    (e) =>
      e.type === "precedes" &&
      candidateNodeIds.has(e.from) &&
      candidateNodeIds.has(e.to),
  );

  // Topological sorting for precedence
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of candidateNodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of candidatePrecedesEdges) {
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, inDegree.get(e.to)! + 1);
  }

  // If there are multiple disconnected roots without precedence edges, flag ambiguity
  const roots = candidateNodes.filter((n) => inDegree.get(n.id) === 0);
  let isAmbiguous = false;
  if (unresolvedAlternatives.length > 0) {
    isAmbiguous = true;
  }

  let orderedNodeIds: string[];
  if (cycle) {
    // If cycle, fall back to canonical story beat order or initial candidate order
    isAmbiguous = true;
    orderedNodeIds = candidateNodes.map((n) => n.id);
  } else if (candidatePrecedesEdges.length > 0) {
    // Process topological sort
    const queue = roots.map((r) => r.id);
    if (roots.length > 1 && candidateNodes.length > roots.length) {
      // Multiple roots with partial precedes edges -> ambiguous order
      isAmbiguous = true;
      conflicts.push(
        "Multiple disconnected narrative paths detected without explicit precedence ordering. Set explicit sequence with 'Set as next beat' or precedes links.",
      );
    }
    const visited: string[] = [];
    while (queue.length > 0) {
      // Deterministic sort by node ID to maintain consistency
      queue.sort();
      const curr = queue.shift()!;
      visited.push(curr);
      for (const next of adj.get(curr) ?? []) {
        inDegree.set(next, inDegree.get(next)! - 1);
        if (inDegree.get(next) === 0) {
          queue.push(next);
        }
      }
    }
    orderedNodeIds = visited;
  } else {
    // No precedes edges: rely on canonical story.beats order if beat nodes exist
    const beatOrderMap = new Map(story.beats.map((b, i) => [b.id, i]));
    const sortedCandidates = [...candidateNodes].sort((a, b) => {
      const aBeatId = a.type === "beat" ? a.beatId : "";
      const bBeatId = b.type === "beat" ? b.beatId : "";
      const aIdx = beatOrderMap.get(aBeatId) ?? 999;
      const bIdx = beatOrderMap.get(bBeatId) ?? 999;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.id.localeCompare(b.id);
    });
    orderedNodeIds = sortedCandidates.map((n) => n.id);
    if (candidateNodes.length > 1 && story.beats.length <= 1) {
      isAmbiguous = true;
      conflicts.push(
        "No explicit narrative sequence defined for selected nodes. Please set explicit sequence with 'Set as next beat' or precedes links.",
      );
    }
  }

  const path: StoryPlanPath = {
    nodeIds: orderedNodeIds,
    isAmbiguous,
    ...(unresolvedAlternatives.length > 0 ? { unresolvedAlternatives } : {}),
    ...(cycleDetected ? { cycleDetected } : {}),
  };

  // 5. Build StoryPlanScenes
  // Detect echo edges in graph
  const echoEdges = graph.edges.filter((e) => e.type === "echoes");
  const echoNodeIds = new Set<string>();
  for (const e of echoEdges) {
    echoNodeIds.add(e.from);
    echoNodeIds.add(e.to);
  }

  // Count asset occurrences across all nodes to detect repeated assets (thematic echo)
  const assetOccurrenceCount = new Map<string, number>();

  const scenes: StoryPlanScene[] = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // First pass: count assets
  for (const nodeId of orderedNodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    if (node.type === "beat") {
      const beat = story.beats.find((b) => b.id === node.beatId);
      for (const aid of beat?.selectedAssetIds ?? []) {
        assetOccurrenceCount.set(aid, (assetOccurrenceCount.get(aid) ?? 0) + 1);
      }
    } else if (node.type === "asset") {
      assetOccurrenceCount.set(
        node.assetId,
        (assetOccurrenceCount.get(node.assetId) ?? 0) + 1,
      );
    }
  }

  // Second pass: construct scenes
  for (let idx = 0; idx < orderedNodeIds.length; idx++) {
    const nodeId = orderedNodeIds[idx]!;
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    let sceneId = `scene-${node.id}`;
    let beatId: string | undefined;
    let title = `Scene ${idx + 1}`;
    let intent = "Develop the narrative sequence";
    let visualDirection =
      "Establish scene with clear composition and steady pacing.";
    let rationale =
      "Sequenced as a primary narrative progression step in the storyboard proposal.";
    let narration: string | undefined;
    let targetSceneDuration = 4.0;
    let sourceNature: IdeaSource = "unknown";
    const sceneAssets: StoryPlanAssetReference[] = [];
    const missingAssets: string[] = [];

    if (node.type === "beat") {
      beatId = node.beatId;
      sceneId = `scene-${node.beatId}`;
      const beat = story.beats.find((b) => b.id === node.beatId);
      if (beat) {
        title = beat.title || `Beat ${idx + 1}`;
        if (beat.intent) intent = beat.intent;
        if (beat.script?.visualDirection) {
          visualDirection = beat.script.visualDirection;
        }
        if (beat.script?.narration) {
          narration = beat.script.narration;
        }
        if (beat.targetDuration) {
          targetSceneDuration = beat.targetDuration;
        }

        // Find connected ideas to infer sourceNature
        const connectedIdeaEdges = graph.edges.filter(
          (e) =>
            (e.from === node.id || e.to === node.id) &&
            (e.type === "contains" ||
              e.type === "supports" ||
              e.type === "echoes"),
        );
        for (const edge of connectedIdeaEdges) {
          const otherId = edge.from === node.id ? edge.to : edge.from;
          const otherNode = nodeMap.get(otherId);
          if (otherNode?.type === "idea") {
            sourceNature = otherNode.source;
            break;
          }
        }

        // Gather beat assets
        const beatAssetIds = [
          ...(beat.selectedAssetIds ?? []),
          ...graph.edges
            .filter(
              (e) =>
                e.from === node.id &&
                (e.type === "supports" || e.type === "contains"),
            )
            .map((e) => {
              const targetNode = nodeMap.get(e.to);
              return targetNode?.type === "asset" ? targetNode.assetId : null;
            })
            .filter((id): id is string => id !== null),
        ];

        const uniqueAssetIds = [...new Set(beatAssetIds)];
        for (const aid of uniqueAssetIds) {
          const asset = assetMap.get(aid);
          if (!asset) {
            missingAssets.push(aid);
            continue;
          }
          const isEcho =
            (assetOccurrenceCount.get(aid) ?? 0) > 1 ||
            echoNodeIds.has(node.id);
          const hasDepth = Boolean(asset.metadata?.["openfilm.depth"]);
          sceneAssets.push({
            assetId: asset.id,
            name: asset.name,
            role: isEcho
              ? "echo"
              : sceneAssets.length === 0
                ? "hero"
                : "supporting",
            isEcho: isEcho || undefined,
            photoDepthSupported: hasDepth,
            photoDepthFallback: hasDepth ? undefined : "standard-hold",
          });
        }
      }
    } else if (node.type === "idea") {
      sceneId = `scene-idea-${node.id}`;
      title = node.text.slice(0, 30) || "Story Idea";
      intent = node.intent || node.text;
      sourceNature = node.source;
      rationale = `Derived directly from ${node.source} thought to preserve authorial intent without conflating into past facts.`;
      visualDirection =
        node.source === "wish" || node.source === "planned"
          ? "Present with aspirational, forward-looking visual treatment."
          : "Present with reflective hold to highlight personal memory.";

      for (const aid of node.assetReferences ?? []) {
        const asset = assetMap.get(aid);
        if (!asset) {
          missingAssets.push(aid);
          continue;
        }
        const isEcho = (assetOccurrenceCount.get(aid) ?? 0) > 1;
        const hasDepth = Boolean(asset.metadata?.["openfilm.depth"]);
        sceneAssets.push({
          assetId: asset.id,
          name: asset.name,
          role: isEcho
            ? "echo"
            : sceneAssets.length === 0
              ? "hero"
              : "supporting",
          isEcho: isEcho || undefined,
          photoDepthSupported: hasDepth,
          photoDepthFallback: hasDepth ? undefined : "standard-hold",
        });
      }
    } else if (node.type === "asset") {
      sceneId = `scene-asset-${node.id}`;
      const asset = assetMap.get(node.assetId);
      if (asset) {
        title = asset.name;
        intent = `Highlight key imagery from ${asset.name}`;
        sourceNature = "user-memory";
        const hasDepth = Boolean(asset.metadata?.["openfilm.depth"]);
        sceneAssets.push({
          assetId: asset.id,
          name: asset.name,
          role: "hero",
          photoDepthSupported: hasDepth,
          photoDepthFallback: hasDepth ? undefined : "standard-hold",
        });
      } else {
        missingAssets.push(node.assetId);
      }
    }

    // Default source nature if still unknown
    if (sourceNature === "unknown") {
      sourceNature = sceneAssets.length > 0 ? "user-memory" : "unknown";
    }

    // Narration estimated duration
    const estimatedDuration = estimateNarrationDuration(narration);
    targetSceneDuration = Math.max(targetSceneDuration, estimatedDuration);

    // Gaps check
    let gaps: StoryPlanScene["gaps"] = undefined;
    if (missingAssets.length > 0 || sceneAssets.length === 0) {
      const missingList = [...missingAssets];
      if (missingList.length === 0) {
        missingList.push("(no assets assigned)");
      }
      gaps = { missingAssets: missingList };
    }

    // Rationale formatting
    if (sceneAssets.some((a) => a.isEcho)) {
      rationale +=
        " Features thematic recurrence (echo) connecting opening and closing elements.";
    }

    scenes.push({
      sceneId,
      ...(beatId ? { beatId } : {}),
      title,
      intent,
      visualDirection,
      rationale,
      ...(narration ? { narration } : {}),
      targetDuration: targetSceneDuration,
      estimatedDuration,
      sourceNature,
      assets: sceneAssets,
      ...(gaps ? { gaps } : {}),
    });
  }

  // Fallback if no scenes were generated
  if (scenes.length === 0) {
    scenes.push({
      sceneId: "scene-default-1",
      title: "Opening Scene",
      intent: "Introduce the story",
      visualDirection: "Calm hold with gentle transition",
      rationale: "Default opening scene proposal",
      targetDuration: 4.0,
      estimatedDuration: 3.0,
      sourceNature: "unknown",
      assets: [],
      gaps: { missingAssets: ["(no assets assigned)"] },
    });
  }

  // Duration conflict check
  const totalSceneDuration = scenes.reduce(
    (sum, s) => sum + s.targetDuration,
    0,
  );
  if (totalSceneDuration > maxDuration) {
    conflicts.push(
      `Total estimated scene duration (${totalSceneDuration.toFixed(1)}s) exceeds max duration (${maxDuration}s). Adjust scene pacing.`,
    );
  }

  // Compute immutable signatures
  const inputRevision = digest({
    storyId: story.id,
    beats: story.beats,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
  });

  const sourceSignature = digest({
    assetIds: assets.map((a) => a.id).sort(),
    options,
  });

  const plan: StoryPlan = {
    version: 1,
    id: createId("plan"),
    storyId: story.id,
    title,
    targetDuration,
    maxDuration,
    inputRevision,
    sourceSignature,
    path,
    scenes,
    unsupportedIntents,
    conflicts,
    transition,
    createdAt: new Date().toISOString(),
  };

  return validateStoryPlan(plan);
}
