<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  Composition,
  GraphNodeLayout,
  GraphViewState,
  IdeaSource,
  MediaAsset,
  Story,
  StoryBeat,
  StoryGraph,
  StoryGraphEdge,
  StoryGraphEdgeType,
  StoryGraphNode,
} from "@openfilm/core";
import { createInitialStoryGraph, detectGraphCycle } from "@openfilm/core";
import { computeStoryGraphAutoLayout } from "@openfilm/story";
import { api, thumbnailUrl, type SourceStatus } from "../api";
import Icon from "./Icon.vue";
import StoryPlanReviewModal from "./StoryPlanReviewModal.vue";

const { t } = useI18n();

const props = defineProps<{
  story: Story;
  composition?: Composition | null;
  assets: MediaAsset[];
  mediaStatuses?: Record<string, SourceStatus>;
  activeBeatId?: string | null;
}>();

const emit = defineEmits<{
  "select-beat": [beatId: string];
  "update-story": [story: Story];
  "navigate-timeline": [beatId: string];
  compose: [];
}>();

// --- Responsive Sidebar Toggles (for <=1024px) ---
const assetsSidebarOpen = ref(true);
const inspectorSidebarOpen = ref(true);

// --- Graph & View State ---
const graph = ref<StoryGraph>({
  version: 1,
  nodes: [],
  edges: [],
});

const viewState = ref<GraphViewState>({
  version: 1,
  storyId: props.story.id,
  pan: { x: 0, y: 0 },
  zoom: 1,
  nodes: {},
  selectedNodeId: null,
  selectedEdgeId: null,
});

// Layout undo history stack
const layoutHistory = ref<Record<string, GraphNodeLayout>[]>([]);

// Selection
const selectedNodeId = ref<string | null>(
  props.activeBeatId ? `beat-node-${props.activeBeatId}` : null,
);
const selectedEdgeId = ref<string | null>(null);

// Storyboard Proposal Plan Modal
const planModalOpen = ref(false);

function handleAdopted(res: { story: Story; composition: Composition }) {
  planModalOpen.value = false;
  emit("update-story", res.story);
}

// Search query
const searchQuery = ref("");

// Dragging state
const isDraggingNode = ref(false);
const draggingNodeId = ref<string | null>(null);
const dragStartMousePos = ref({ x: 0, y: 0 });
const dragStartNodePos = ref({ x: 0, y: 0 });

// Panning canvas state
const isPanningCanvas = ref(false);
const panStartMousePos = ref({ x: 0, y: 0 });
const panStartViewPos = ref({ x: 0, y: 0 });

// IME composition guard
const isImeComposing = ref(false);

// Inspector editing state
const beatDraft = ref<{
  title: string;
  targetDuration: number;
  intent: string;
  narration: string;
  visualDirection: string;
}>({
  title: "",
  targetDuration: 10,
  intent: "",
  narration: "",
  visualDirection: "",
});

const ideaDraft = ref<{
  text: string;
  intent: string;
  source: IdeaSource;
}>({
  text: "",
  intent: "",
  source: "user-memory",
});

const themeDraft = ref<{
  title: string;
  description: string;
  color: string;
}>({
  title: "",
  description: "",
  color: "#ecac7c",
});

// Quick action dropdown selections
const quickAddAssetId = ref("");
const quickEchoTargetId = ref("");
const quickNextBeatTargetId = ref("");
const edgeCycleError = ref<string | null>(null);

// Asset mention state in Idea text
const showAssetMentionDropdown = ref(false);
const mentionQuery = ref("");

// --- Computed Helpers ---
const assetMap = computed(() => new Map(props.assets.map((a) => [a.id, a])));

const filteredAssets = computed(() => {
  if (!searchQuery.value.trim()) return props.assets;
  const q = searchQuery.value.toLowerCase();
  return props.assets.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.tags.some((tag) => tag.toLowerCase().includes(q)),
  );
});

const selectedNode = computed(() => {
  if (!selectedNodeId.value) return null;
  return graph.value.nodes.find((n) => n.id === selectedNodeId.value) ?? null;
});

const selectedEdge = computed(() => {
  if (!selectedEdgeId.value) return null;
  return graph.value.edges.find((e) => e.id === selectedEdgeId.value) ?? null;
});

const selectedBeat = computed((): StoryBeat | null => {
  if (!selectedNode.value || selectedNode.value.type !== "beat") return null;
  const beatId = selectedNode.value.beatId;
  return props.story.beats.find((b) => b.id === beatId) ?? null;
});

// Clip mapping status for selected beat
const selectedBeatClipMapping = computed(() => {
  if (!selectedBeat.value || !props.composition) return null;
  const beatId = selectedBeat.value.id;
  for (const track of props.composition.tracks) {
    for (const clip of track.clips) {
      if (clip.beatId === beatId) {
        return {
          mapped: true,
          clipId: clip.id,
          timelineStart: clip.timelineStart,
          timelineDuration: clip.timelineDuration,
        };
      }
    }
  }
  return { mapped: false };
});

// Highlighted connected node IDs when a node is selected
const highlightedNodeIds = computed(() => {
  if (!selectedNodeId.value) return new Set<string>();
  const set = new Set<string>([selectedNodeId.value]);
  for (const edge of graph.value.edges) {
    if (edge.from === selectedNodeId.value) set.add(edge.to);
    if (edge.to === selectedNodeId.value) set.add(edge.from);
  }
  return set;
});

// Highlighted edge IDs
const highlightedEdgeIds = computed(() => {
  if (!selectedNodeId.value) return new Set<string>();
  const set = new Set<string>();
  for (const edge of graph.value.edges) {
    if (
      edge.from === selectedNodeId.value ||
      edge.to === selectedNodeId.value
    ) {
      set.add(edge.id);
    }
  }
  return set;
});

// Nodes with search match
const matchingNodeIds = computed(() => {
  if (!searchQuery.value.trim()) return null;
  const q = searchQuery.value.toLowerCase();
  const matched = new Set<string>();
  for (const node of graph.value.nodes) {
    if (node.type === "theme" && node.title.toLowerCase().includes(q))
      matched.add(node.id);
    else if (node.type === "beat") {
      const beat = props.story.beats.find((b) => b.id === node.beatId);
      if (
        beat &&
        (beat.title.toLowerCase().includes(q) ||
          beat.intent?.toLowerCase().includes(q))
      ) {
        matched.add(node.id);
      }
    } else if (node.type === "asset") {
      const asset = assetMap.value.get(node.assetId);
      if (asset && asset.name.toLowerCase().includes(q)) matched.add(node.id);
    } else if (node.type === "idea") {
      if (
        node.text.toLowerCase().includes(q) ||
        node.intent?.toLowerCase().includes(q)
      ) {
        matched.add(node.id);
      }
    }
  }
  return matched;
});

// Mentionable assets for @ autocomplete
const mentionCandidates = computed(() => {
  if (!mentionQuery.value) return props.assets.slice(0, 8);
  const q = mentionQuery.value.toLowerCase();
  return props.assets
    .filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    )
    .slice(0, 8);
});

// --- Methods ---

function recordLayoutUndo() {
  const currentLayout = JSON.parse(JSON.stringify(viewState.value.nodes));
  layoutHistory.value.push(currentLayout);
  if (layoutHistory.value.length > 50) layoutHistory.value.shift();
}

function undoLayout() {
  if (layoutHistory.value.length === 0) return;
  const prev = layoutHistory.value.pop();
  if (prev) {
    viewState.value.nodes = prev;
    persistViewState();
  }
}

async function loadGraphAndState() {
  try {
    const res = await api.storyGraph(props.story.id);
    if (res.graph && res.graph.nodes.length > 0) {
      graph.value = res.graph;
    } else {
      graph.value = createInitialStoryGraph(props.story, props.assets);
      await api.updateStoryGraph(props.story.id, graph.value);
    }
  } catch {
    graph.value = createInitialStoryGraph(props.story, props.assets);
  }

  try {
    const viewRes = await api.storyGraphView(props.story.id);
    if (viewRes.viewState && Object.keys(viewRes.viewState.nodes).length > 0) {
      viewState.value = viewRes.viewState;
    } else {
      const layout = computeStoryGraphAutoLayout(graph.value, props.story);
      viewState.value.nodes = layout;
      persistViewState();
    }
  } catch {
    const layout = computeStoryGraphAutoLayout(graph.value, props.story);
    viewState.value.nodes = layout;
  }
}

function persistViewState() {
  api.updateStoryGraphView(props.story.id, viewState.value).catch(() => {});
}

function handleAutoLayout() {
  recordLayoutUndo();
  const newLayout = computeStoryGraphAutoLayout(graph.value, props.story);
  viewState.value.nodes = newLayout;
  persistViewState();
}

function fitContent() {
  const nodeEntries = Object.values(viewState.value.nodes);
  if (nodeEntries.length === 0) {
    viewState.value.pan = { x: 0, y: 0 };
    viewState.value.zoom = 1;
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pos of nodeEntries) {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x + 240 > maxX) maxX = pos.x + 240;
    if (pos.y + 160 > maxY) maxY = pos.y + 160;
  }

  const padding = 60;
  const contentWidth = Math.max(maxX - minX + padding * 2, 400);
  const contentHeight = Math.max(maxY - minY + padding * 2, 300);

  const containerWidth = 900;
  const containerHeight = 600;

  const zoomX = containerWidth / contentWidth;
  const zoomY = containerHeight / contentHeight;
  const fitZoom = Math.min(Math.max(Math.min(zoomX, zoomY), 0.3), 1.5);

  viewState.value.zoom = fitZoom;
  viewState.value.pan = {
    x: -minX * fitZoom + padding,
    y: -minY * fitZoom + padding,
  };
  persistViewState();
}

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId;
  selectedEdgeId.value = null;
  edgeCycleError.value = null;

  const node = graph.value.nodes.find((n) => n.id === nodeId);
  if (node && node.type === "beat") {
    emit("select-beat", node.beatId);
    const beat = props.story.beats.find((b) => b.id === node.beatId);
    if (beat) {
      beatDraft.value = {
        title: beat.title,
        targetDuration: beat.targetDuration ?? 10,
        intent: beat.intent ?? "",
        narration: beat.script?.narration ?? "",
        visualDirection: beat.script?.visualDirection ?? "",
      };
    }
  } else if (node && node.type === "idea") {
    ideaDraft.value = {
      text: node.text,
      intent: node.intent ?? "",
      source: node.source,
    };
  } else if (node && node.type === "theme") {
    themeDraft.value = {
      title: node.title,
      description: node.description ?? "",
      color: node.color ?? "#ecac7c",
    };
  }
}

function selectEdge(edgeId: string) {
  selectedEdgeId.value = edgeId;
  selectedNodeId.value = null;
  edgeCycleError.value = null;
}

function clearSelection() {
  selectedNodeId.value = null;
  selectedEdgeId.value = null;
  edgeCycleError.value = null;
}

// --- Node Dragging ---
function onNodeMouseDown(nodeId: string, event: MouseEvent) {
  if (event.button !== 0) return;
  event.stopPropagation();
  selectNode(nodeId);

  isDraggingNode.value = true;
  draggingNodeId.value = nodeId;
  dragStartMousePos.value = { x: event.clientX, y: event.clientY };

  const currentPos = viewState.value.nodes[nodeId] ?? { x: 100, y: 100 };
  dragStartNodePos.value = { ...currentPos };

  recordLayoutUndo();

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function onCanvasMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  if ((event.target as HTMLElement).closest(".graph-node")) return;
  if ((event.target as HTMLElement).closest(".graph-edge")) return;

  clearSelection();
  isPanningCanvas.value = true;
  panStartMousePos.value = { x: event.clientX, y: event.clientY };
  panStartViewPos.value = { ...viewState.value.pan };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function onMouseMove(event: MouseEvent) {
  if (isDraggingNode.value && draggingNodeId.value) {
    const dx =
      (event.clientX - dragStartMousePos.value.x) / viewState.value.zoom;
    const dy =
      (event.clientY - dragStartMousePos.value.y) / viewState.value.zoom;
    viewState.value.nodes[draggingNodeId.value] = {
      x: Math.round(dragStartNodePos.value.x + dx),
      y: Math.round(dragStartNodePos.value.y + dy),
      collapsed: viewState.value.nodes[draggingNodeId.value]?.collapsed,
    };
  } else if (isPanningCanvas.value) {
    const dx = event.clientX - panStartMousePos.value.x;
    const dy = event.clientY - panStartMousePos.value.y;
    viewState.value.pan = {
      x: Math.round(panStartViewPos.value.x + dx),
      y: Math.round(panStartViewPos.value.y + dy),
    };
  }
}

function onMouseUp() {
  if (isDraggingNode.value) {
    isDraggingNode.value = false;
    draggingNodeId.value = null;
    persistViewState();
  }
  if (isPanningCanvas.value) {
    isPanningCanvas.value = false;
    persistViewState();
  }
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
}

function onCanvasWheel(event: WheelEvent) {
  event.preventDefault();
  const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.min(
    Math.max(viewState.value.zoom * zoomFactor, 0.25),
    3,
  );
  viewState.value.zoom = Number(newZoom.toFixed(2));
  persistViewState();
}

// --- Quick Actions ---
async function handleQuickAddAsset(assetId?: string) {
  const targetAssetId = assetId || quickAddAssetId.value;
  if (!targetAssetId || !selectedBeat.value) return;

  try {
    const res = await api.storyGraphQuickAction(props.story.id, {
      action: "add-asset",
      beatId: selectedBeat.value.id,
      assetId: targetAssetId,
    });
    if (res.story) emit("update-story", res.story);
    if (res.graph) graph.value = res.graph;

    // Position new asset node under beat if not yet positioned
    const assetNodeId = `asset-node-${targetAssetId}`;
    if (!viewState.value.nodes[assetNodeId]) {
      const beatPos = viewState.value.nodes[
        `beat-node-${selectedBeat.value.id}`
      ] ?? { x: 200, y: 200 };
      viewState.value.nodes[assetNodeId] = {
        x: beatPos.x,
        y: beatPos.y + 180,
      };
      persistViewState();
    }
    quickAddAssetId.value = "";
  } catch (err) {
    console.error("Failed to add asset:", err);
  }
}

async function handleQuickCreateEcho() {
  if (!selectedNodeId.value || !quickEchoTargetId.value) return;
  try {
    const res = await api.storyGraphQuickAction(props.story.id, {
      action: "create-echo",
      fromNodeId: selectedNodeId.value,
      toNodeId: quickEchoTargetId.value,
    });
    if (res.graph) graph.value = res.graph;
    quickEchoTargetId.value = "";
  } catch (err) {
    console.error("Failed to create echo:", err);
  }
}

async function handleQuickSetNextBeat() {
  if (!selectedBeat.value || !quickNextBeatTargetId.value) return;
  try {
    const res = await api.storyGraphQuickAction(props.story.id, {
      action: "set-next-beat",
      currentBeatId: selectedBeat.value.id,
      targetBeatId: quickNextBeatTargetId.value,
    });
    if (res.story) emit("update-story", res.story);
    if (res.graph) graph.value = res.graph;
    quickNextBeatTargetId.value = "";
  } catch (err) {
    console.error("Failed to set next beat:", err);
  }
}

async function handleRemoveSelectedNode() {
  if (!selectedNodeId.value) return;
  try {
    const res = await api.storyGraphQuickAction(props.story.id, {
      action: "remove-node",
      nodeId: selectedNodeId.value,
    });
    if (res.graph) graph.value = res.graph;
    clearSelection();
  } catch (err) {
    console.error("Failed to remove node:", err);
  }
}

async function handleRemoveSelectedEdge() {
  if (!selectedEdgeId.value) return;
  try {
    const res = await api.storyGraphQuickAction(props.story.id, {
      action: "remove-edge",
      edgeId: selectedEdgeId.value,
    });
    if (res.graph) graph.value = res.graph;
    clearSelection();
  } catch (err) {
    console.error("Failed to remove edge:", err);
  }
}

async function handleUpdateEdgeType(newType: StoryGraphEdgeType) {
  if (!selectedEdge.value) return;
  edgeCycleError.value = null;

  const candidateEdge = { ...selectedEdge.value, type: newType };
  const candidateEdges = graph.value.edges.map((e) =>
    e.id === candidateEdge.id ? candidateEdge : e,
  );

  if (newType === "contains" || newType === "precedes") {
    const cycle = detectGraphCycle(graph.value.nodes, candidateEdges, newType);
    if (cycle) {
      edgeCycleError.value = t("app.storyGraph.inspector.cycleWarning");
      return;
    }
  }

  const updatedGraph: StoryGraph = {
    ...graph.value,
    edges: candidateEdges,
  };
  try {
    const res = await api.updateStoryGraph(props.story.id, updatedGraph);
    graph.value = res.graph;
  } catch (err) {
    edgeCycleError.value = String(err);
  }
}

async function saveBeatChanges() {
  if (!selectedBeat.value) return;
  const updatedBeat: StoryBeat = {
    ...selectedBeat.value,
    title: beatDraft.value.title.trim() || selectedBeat.value.title,
    targetDuration: Number(beatDraft.value.targetDuration) || 10,
    intent: beatDraft.value.intent.trim() || undefined,
    script:
      beatDraft.value.narration.trim() || beatDraft.value.visualDirection.trim()
        ? {
            narration: beatDraft.value.narration.trim(),
            visualDirection: beatDraft.value.visualDirection.trim(),
          }
        : undefined,
  };

  const updatedBeats = props.story.beats.map((b) =>
    b.id === updatedBeat.id ? updatedBeat : b,
  );
  const updatedStory: Story = {
    ...props.story,
    beats: updatedBeats,
  };
  emit("update-story", updatedStory);
}

async function saveIdeaChanges() {
  if (!selectedNode.value || selectedNode.value.type !== "idea") return;
  const updatedNode: StoryGraphNode = {
    ...selectedNode.value,
    text: ideaDraft.value.text,
    intent: ideaDraft.value.intent || undefined,
    source: ideaDraft.value.source,
  };

  const updatedNodes = graph.value.nodes.map((n) =>
    n.id === updatedNode.id ? updatedNode : n,
  );
  const updatedGraph: StoryGraph = {
    ...graph.value,
    nodes: updatedNodes,
  };
  try {
    const res = await api.updateStoryGraph(props.story.id, updatedGraph);
    graph.value = res.graph;
  } catch (err) {
    console.error("Failed to save idea changes:", err);
  }
}

async function saveThemeChanges() {
  if (!selectedNode.value || selectedNode.value.type !== "theme") return;
  const updatedNode: StoryGraphNode = {
    ...selectedNode.value,
    title: themeDraft.value.title,
    description: themeDraft.value.description || undefined,
    color: themeDraft.value.color || undefined,
  };

  const updatedNodes = graph.value.nodes.map((n) =>
    n.id === updatedNode.id ? updatedNode : n,
  );
  const updatedGraph: StoryGraph = {
    ...graph.value,
    nodes: updatedNodes,
  };
  try {
    const res = await api.updateStoryGraph(props.story.id, updatedGraph);
    graph.value = res.graph;
  } catch (err) {
    console.error("Failed to save theme changes:", err);
  }
}

function handleAddTheme() {
  const id = `theme-${Date.now()}`;
  const newNode: StoryGraphNode = {
    id,
    type: "theme",
    title: t("app.storyGraph.nodeTypes.theme"),
  };
  graph.value.nodes.push(newNode);
  viewState.value.nodes[id] = { x: 100, y: 50 };
  selectNode(id);
  api.updateStoryGraph(props.story.id, graph.value);
  persistViewState();
}

function handleAddIdea() {
  const id = `idea-${Date.now()}`;
  const newNode: StoryGraphNode = {
    id,
    type: "idea",
    text: "New idea note",
    source: "planned",
  };
  graph.value.nodes.push(newNode);
  viewState.value.nodes[id] = { x: 250, y: 350 };
  selectNode(id);
  api.updateStoryGraph(props.story.id, graph.value);
  persistViewState();
}

// @ Mention autocomplete handler
function onIdeaTextInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  const text = target.value;
  const cursorPos = target.selectionStart;
  const textBefore = text.slice(0, cursorPos);
  const match = /@([\w.-]*)$/.exec(textBefore);

  if (match) {
    showAssetMentionDropdown.value = true;
    mentionQuery.value = match[1]!;
  } else {
    showAssetMentionDropdown.value = false;
  }
}

function insertAssetMention(asset: MediaAsset) {
  const mentionText = `@[${asset.name}](asset:${asset.id}) `;
  const text = ideaDraft.value.text;
  const match = /@([\w.-]*)$/.exec(text);
  if (match) {
    ideaDraft.value.text = text.slice(0, match.index) + mentionText;
  } else {
    ideaDraft.value.text += ` ${mentionText}`;
  }
  showAssetMentionDropdown.value = false;
  saveIdeaChanges();
}

// Keyboard navigation
function onKeyDown(event: KeyboardEvent) {
  if (isImeComposing.value) return;
  if (
    (event.target as HTMLElement).tagName === "INPUT" ||
    (event.target as HTMLElement).tagName === "TEXTAREA"
  ) {
    return;
  }

  if (event.key === "Escape") {
    clearSelection();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    if (selectedNodeId.value) handleRemoveSelectedNode();
    else if (selectedEdgeId.value) handleRemoveSelectedEdge();
  } else if (
    selectedNodeId.value &&
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
  ) {
    event.preventDefault();
    const step = event.shiftKey ? 50 : 10;
    const current = viewState.value.nodes[selectedNodeId.value] ?? {
      x: 100,
      y: 100,
    };
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowUp") dy = -step;
    if (event.key === "ArrowDown") dy = step;
    if (event.key === "ArrowLeft") dx = -step;
    if (event.key === "ArrowRight") dx = step;

    viewState.value.nodes[selectedNodeId.value] = {
      x: current.x + dx,
      y: current.y + dy,
      collapsed: current.collapsed,
    };
    persistViewState();
  }
}

// Edge path generator
function computeEdgePath(edge: StoryGraphEdge): string {
  const fromPos = viewState.value.nodes[edge.from] ?? { x: 0, y: 0 };
  const toPos = viewState.value.nodes[edge.to] ?? { x: 200, y: 200 };

  const startX = fromPos.x + 120;
  const startY = fromPos.y + 60;
  const endX = toPos.x + 120;
  const endY = toPos.y + 60;

  const dx = endX - startX;

  // Bezier curve with control points
  const cp1X = startX + dx * 0.5;
  const cp1Y = startY;
  const cp2X = startX + dx * 0.5;
  const cp2Y = endY;

  return `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
}

// Sync selection when parent activeBeatId changes
watch(
  () => props.activeBeatId,
  (newId) => {
    if (newId) {
      const nodeId = `beat-node-${newId}`;
      if (selectedNodeId.value !== nodeId) selectNode(nodeId);
    }
  },
);

onMounted(() => {
  loadGraphAndState();
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <div class="story-graph-workspace" data-testid="story-graph-view">
    <!-- Left Compatible Assets Panel -->
    <aside
      class="graph-sidebar assets-palette"
      :class="{ 'is-collapsed': !assetsSidebarOpen }"
      :aria-label="t('app.storyGraph.toolbar.toggleAssets')"
    >
      <div class="sidebar-header">
        <h3>
          <Icon name="film" :size="16" />
          {{ t("app.storyGraph.toolbar.toggleAssets") }}
        </h3>
        <button
          class="icon-btn"
          :title="t('app.storyGraph.toolbar.toggleAssets')"
          @click="assetsSidebarOpen = !assetsSidebarOpen"
        >
          <Icon name="chevron" :size="14" />
        </button>
      </div>

      <div v-show="assetsSidebarOpen" class="sidebar-content">
        <div class="search-box">
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="t('app.storyGraph.toolbar.searchPlaceholder')"
            aria-label="Search media"
          />
        </div>

        <div class="assets-scrollable-list">
          <div
            v-for="asset in filteredAssets"
            :key="asset.id"
            class="palette-asset-card"
            tabindex="0"
            role="button"
            :aria-label="asset.name"
            @click="handleQuickAddAsset(asset.id)"
          >
            <img
              class="asset-thumb"
              :src="thumbnailUrl(asset.id)"
              :alt="asset.name"
              loading="lazy"
            />
            <div class="asset-info">
              <span class="asset-name" :title="asset.name">{{
                asset.name
              }}</span>
              <span class="asset-badge">{{ asset.mediaType }}</span>
            </div>
          </div>
          <div v-if="filteredAssets.length === 0" class="empty-hint">
            {{ t("app.story.noCandidates") }}
          </div>
        </div>
      </div>
    </aside>

    <!-- Center Canvas Section -->
    <main
      class="graph-main-canvas"
      @mousedown="onCanvasMouseDown"
      @wheel="onCanvasWheel"
    >
      <!-- Toolbar -->
      <div
        class="canvas-toolbar"
        role="toolbar"
        :aria-label="t('app.storyGraph.perspectives.graph')"
      >
        <div class="toolbar-group">
          <button
            class="secondary-btn"
            :class="{ active: assetsSidebarOpen }"
            @click="assetsSidebarOpen = !assetsSidebarOpen"
          >
            <Icon name="film" :size="14" />
            {{ t("app.storyGraph.toolbar.toggleAssets") }}
          </button>
          <button
            class="secondary-btn"
            :title="t('app.storyGraph.toolbar.fitContent')"
            @click="fitContent"
          >
            {{ t("app.storyGraph.toolbar.fitContent") }}
          </button>
          <button
            class="secondary-btn"
            :title="t('app.storyGraph.toolbar.autoLayout')"
            @click="handleAutoLayout"
          >
            {{ t("app.storyGraph.toolbar.autoLayout") }}
          </button>
          <button
            class="secondary-btn"
            :disabled="layoutHistory.length === 0"
            :title="t('app.storyGraph.toolbar.layoutUndo')"
            @click="undoLayout"
          >
            {{ t("app.storyGraph.toolbar.layoutUndo") }}
          </button>
        </div>

        <div class="toolbar-group">
          <button class="primary-btn" @click="handleAddTheme">
            <Icon name="plus" :size="14" />
            {{ t("app.storyGraph.toolbar.addTheme") }}
          </button>
          <button class="primary-btn" @click="handleAddIdea">
            <Icon name="plus" :size="14" />
            {{ t("app.storyGraph.toolbar.addIdea") }}
          </button>
          <button
            class="primary-btn plan-storyboard-btn"
            :title="t('app.storyPlan.button')"
            @click="planModalOpen = true"
          >
            <Icon name="layers" :size="14" />
            {{ t("app.storyPlan.button") }}
          </button>
        </div>

        <div class="toolbar-group zoom-group">
          <button
            class="icon-btn"
            @click="
              viewState.zoom = Math.max(0.25, viewState.zoom - 0.1);
              persistViewState();
            "
          >
            -
          </button>
          <span class="zoom-indicator"
            >{{ Math.round(viewState.zoom * 100) }}%</span
          >
          <button
            class="icon-btn"
            @click="
              viewState.zoom = Math.min(3, viewState.zoom + 0.1);
              persistViewState();
            "
          >
            +
          </button>
          <button
            class="secondary-btn"
            :class="{ active: inspectorSidebarOpen }"
            @click="inspectorSidebarOpen = !inspectorSidebarOpen"
          >
            {{ t("app.storyGraph.toolbar.toggleInspector") }}
          </button>
        </div>
      </div>

      <!-- Canvas Viewport -->
      <div
        class="canvas-viewport"
        :style="{
          transform: `translate(${viewState.pan.x}px, ${viewState.pan.y}px) scale(${viewState.zoom})`,
          transformOrigin: '0 0',
        }"
      >
        <!-- SVG Edges Layer -->
        <svg class="graph-edges-svg">
          <defs>
            <marker
              id="arrow-precedes"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--of-accent)" />
            </marker>
            <marker
              id="arrow-supports"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--of-border-strong)" />
            </marker>
            <marker
              id="arrow-contains"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--of-success)" />
            </marker>
            <marker
              id="ring-echoes"
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="6"
              markerHeight="6"
            >
              <circle
                cx="5"
                cy="5"
                r="3"
                fill="none"
                stroke="var(--of-warning)"
                stroke-width="2"
              />
            </marker>
          </defs>

          <g v-for="edge in graph.edges" :key="edge.id" class="edge-group">
            <path
              :d="computeEdgePath(edge)"
              class="graph-edge-path"
              :class="[
                `edge-${edge.type}`,
                {
                  'is-selected': selectedEdgeId === edge.id,
                  'is-highlighted': highlightedEdgeIds.has(edge.id),
                },
              ]"
              :marker-end="
                edge.type === 'precedes'
                  ? 'url(#arrow-precedes)'
                  : edge.type === 'contains'
                    ? 'url(#arrow-contains)'
                    : edge.type === 'echoes'
                      ? 'url(#ring-echoes)'
                      : 'url(#arrow-supports)'
              "
              @click.stop="selectEdge(edge.id)"
            />
          </g>
        </svg>

        <!-- HTML Nodes Layer -->
        <div class="graph-nodes-layer">
          <div
            v-for="node in graph.nodes"
            :key="node.id"
            class="graph-node"
            :class="[
              `node-${node.type}`,
              {
                'is-selected': selectedNodeId === node.id,
                'is-highlighted': highlightedNodeIds.has(node.id),
                'is-matched':
                  matchingNodeIds === null || matchingNodeIds.has(node.id),
                'is-dimmed':
                  matchingNodeIds !== null && !matchingNodeIds.has(node.id),
              },
            ]"
            :style="{
              transform: `translate(${viewState.nodes[node.id]?.x ?? 100}px, ${viewState.nodes[node.id]?.y ?? 100}px)`,
            }"
            tabindex="0"
            role="button"
            :aria-label="node.type"
            @mousedown="onNodeMouseDown(node.id, $event)"
          >
            <!-- Theme Node -->
            <template v-if="node.type === 'theme'">
              <div
                class="node-header theme-header"
                :style="{ borderColor: node.color || 'var(--of-accent)' }"
              >
                <Icon name="film" :size="14" />
                <span class="node-type-label">{{
                  t("app.storyGraph.nodeTypes.theme")
                }}</span>
              </div>
              <div class="node-body">
                <strong class="node-title">{{ node.title }}</strong>
                <p v-if="node.description" class="node-desc">
                  {{ node.description }}
                </p>
              </div>
            </template>

            <!-- Beat Node -->
            <template v-else-if="node.type === 'beat'">
              <div class="node-header beat-header">
                <span class="beat-badge">{{
                  t("app.storyGraph.nodeTypes.beat")
                }}</span>
                <span class="node-timing"
                  >{{ selectedBeat?.targetDuration ?? 10 }}s</span
                >
              </div>
              <div class="node-body">
                <strong class="node-title">
                  {{
                    props.story.beats.find((b) => b.id === node.beatId)
                      ?.title ?? "Beat"
                  }}
                </strong>
                <div class="beat-status-row">
                  <span class="count-tag">
                    {{
                      props.story.beats.find((b) => b.id === node.beatId)
                        ?.selectedAssetIds?.length ?? 0
                    }}
                    assets
                  </span>
                  <span
                    v-if="
                      selectedBeatClipMapping && selectedBeatClipMapping.mapped
                    "
                    class="clip-status-pill mapped"
                  >
                    ✓ Mapped
                  </span>
                  <span v-else class="clip-status-pill unmapped">
                    ! No clip mapping
                  </span>
                </div>
              </div>
            </template>

            <!-- Asset Node -->
            <template v-else-if="node.type === 'asset'">
              <div class="asset-node-preview">
                <img
                  :src="thumbnailUrl(node.assetId)"
                  :alt="node.caption || node.assetId"
                  loading="lazy"
                  class="node-asset-img"
                />
              </div>
              <div class="asset-node-info">
                <span
                  class="node-asset-title"
                  :title="node.caption || node.assetId"
                >
                  {{
                    node.caption ||
                    assetMap.get(node.assetId)?.name ||
                    node.assetId
                  }}
                </span>
                <span class="node-asset-type">{{
                  assetMap.get(node.assetId)?.mediaType || "asset"
                }}</span>
              </div>
            </template>

            <!-- Idea Node -->
            <template v-else-if="node.type === 'idea'">
              <div class="node-header idea-header">
                <span class="idea-source-pill" :class="`source-${node.source}`">
                  {{ t(`app.storyGraph.ideaSources.${node.source}`) }}
                </span>
              </div>
              <div class="node-body idea-body">
                <p class="idea-text">{{ node.text }}</p>
                <small v-if="node.intent" class="idea-intent">{{
                  node.intent
                }}</small>
              </div>
            </template>
          </div>
        </div>
      </div>
    </main>

    <!-- Right Inspector Panel -->
    <aside
      class="graph-sidebar inspector-palette"
      :class="{ 'is-collapsed': !inspectorSidebarOpen }"
      :aria-label="t('app.storyGraph.inspector.title')"
    >
      <div class="sidebar-header">
        <h3>
          <Icon name="check" :size="16" />
          {{ t("app.storyGraph.inspector.title") }}
        </h3>
        <button
          class="icon-btn"
          :title="t('app.storyGraph.inspector.title')"
          @click="inspectorSidebarOpen = !inspectorSidebarOpen"
        >
          <Icon name="chevron" :size="14" />
        </button>
      </div>

      <div
        v-show="inspectorSidebarOpen"
        class="sidebar-content inspector-content"
      >
        <!-- Beat Inspector -->
        <template
          v-if="selectedNode && selectedNode.type === 'beat' && selectedBeat"
        >
          <h4>{{ t("app.storyGraph.nodeTypes.beat") }}</h4>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.beatTitle") }}</span>
            <input
              v-model="beatDraft.title"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="saveBeatChanges"
            />
          </label>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.targetDuration") }}</span>
            <input
              v-model.number="beatDraft.targetDuration"
              type="number"
              min="1"
              @input="saveBeatChanges"
            />
          </label>

          <label class="field">
            <span>{{ t("app.story.intent") }}</span>
            <input
              v-model="beatDraft.intent"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="saveBeatChanges"
            />
          </label>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.narration") }}</span>
            <textarea
              v-model="beatDraft.narration"
              rows="2"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="saveBeatChanges"
            />
          </label>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.visualDirection") }}</span>
            <textarea
              v-model="beatDraft.visualDirection"
              rows="2"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="saveBeatChanges"
            />
          </label>

          <!-- Clip Mapping Section -->
          <div class="inspector-section mapping-box">
            <strong>{{ t("app.storyGraph.inspector.clipMapping") }}</strong>
            <p
              v-if="selectedBeatClipMapping && selectedBeatClipMapping.mapped"
              class="status-mapped"
            >
              {{
                t("app.storyGraph.inspector.clipPlaced", {
                  start: selectedBeatClipMapping.timelineStart,
                  duration: selectedBeatClipMapping.timelineDuration,
                })
              }}
              <button
                class="secondary-btn small-btn"
                @click="emit('navigate-timeline', selectedBeat.id)"
              >
                {{ t("app.storyGraph.inspector.goToTimeline") }}
              </button>
            </p>
            <div v-else class="status-unmapped">
              <p class="warning-text">
                {{ t("app.storyGraph.inspector.noClipMapping") }}
              </p>
              <button class="primary-btn small-btn" @click="emit('compose')">
                {{ t("app.story.compose") }}
              </button>
            </div>
          </div>

          <!-- Quick Actions Section -->
          <div class="inspector-section actions-box">
            <strong>{{ t("app.storyGraph.actions.addAsset") }}</strong>
            <div class="inline-select-row">
              <select v-model="quickAddAssetId">
                <option value="">Choose asset...</option>
                <option v-for="a in assets" :key="a.id" :value="a.id">
                  {{ a.name }}
                </option>
              </select>
              <button
                class="secondary-btn"
                :disabled="!quickAddAssetId"
                @click="handleQuickAddAsset()"
              >
                Add
              </button>
            </div>

            <strong>{{ t("app.storyGraph.actions.setNextBeat") }}</strong>
            <div class="inline-select-row">
              <select v-model="quickNextBeatTargetId">
                <option value="">Choose next beat...</option>
                <option
                  v-for="b in props.story.beats.filter(
                    (item) => item.id !== selectedBeat?.id,
                  )"
                  :key="b.id"
                  :value="b.id"
                >
                  {{ b.title }}
                </option>
              </select>
              <button
                class="secondary-btn"
                :disabled="!quickNextBeatTargetId"
                @click="handleQuickSetNextBeat"
              >
                Apply
              </button>
            </div>

            <strong>{{ t("app.storyGraph.actions.createEcho") }}</strong>
            <div class="inline-select-row">
              <select v-model="quickEchoTargetId">
                <option value="">Choose node...</option>
                <option
                  v-for="n in graph.nodes.filter(
                    (item) => item.id !== selectedNode?.id,
                  )"
                  :key="n.id"
                  :value="n.id"
                >
                  {{ n.type }}: {{ n.id }}
                </option>
              </select>
              <button
                class="secondary-btn"
                :disabled="!quickEchoTargetId"
                @click="handleQuickCreateEcho"
              >
                Echo
              </button>
            </div>
          </div>

          <div class="action-footer">
            <button class="danger-btn" @click="handleRemoveSelectedNode">
              {{ t("app.storyGraph.actions.removeNode") }}
            </button>
            <small class="notice-text">{{
              t("app.storyGraph.actions.removeAssetNotice")
            }}</small>
          </div>
        </template>

        <!-- Idea Inspector -->
        <template v-else-if="selectedNode && selectedNode.type === 'idea'">
          <h4>{{ t("app.storyGraph.nodeTypes.idea") }}</h4>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.ideaSource") }}</span>
            <select v-model="ideaDraft.source" @change="saveIdeaChanges">
              <option value="user-memory">
                {{ t("app.storyGraph.ideaSources.user-memory") }}
              </option>
              <option value="planned">
                {{ t("app.storyGraph.ideaSources.planned") }}
              </option>
              <option value="wish">
                {{ t("app.storyGraph.ideaSources.wish") }}
              </option>
              <option value="unknown">
                {{ t("app.storyGraph.ideaSources.unknown") }}
              </option>
            </select>
          </label>

          <label class="field mention-container">
            <span>{{ t("app.storyGraph.inspector.ideaText") }}</span>
            <textarea
              v-model="ideaDraft.text"
              rows="4"
              :placeholder="t('app.storyGraph.inspector.mentionAsset')"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="onIdeaTextInput"
              @blur="saveIdeaChanges"
            />
            <!-- Autocomplete Popup -->
            <div v-if="showAssetMentionDropdown" class="mention-dropdown">
              <div
                v-for="cand in mentionCandidates"
                :key="cand.id"
                class="mention-item"
                @mousedown.prevent="insertAssetMention(cand)"
              >
                {{ cand.name }}
              </div>
            </div>
          </label>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.ideaIntent") }}</span>
            <input
              v-model="ideaDraft.intent"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="saveIdeaChanges"
            />
          </label>

          <div class="action-footer">
            <button class="danger-btn" @click="handleRemoveSelectedNode">
              {{ t("app.storyGraph.actions.removeNode") }}
            </button>
          </div>
        </template>

        <!-- Theme Inspector -->
        <template v-else-if="selectedNode && selectedNode.type === 'theme'">
          <h4>{{ t("app.storyGraph.nodeTypes.theme") }}</h4>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.themeTitle") }}</span>
            <input
              v-model="themeDraft.title"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="saveThemeChanges"
            />
          </label>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.themeDescription") }}</span>
            <textarea
              v-model="themeDraft.description"
              rows="3"
              @compositionstart="isImeComposing = true"
              @compositionend="isImeComposing = false"
              @input="saveThemeChanges"
            />
          </label>

          <label class="field">
            <span>{{ t("app.storyGraph.inspector.themeColor") }}</span>
            <input
              v-model="themeDraft.color"
              type="color"
              @input="saveThemeChanges"
            />
          </label>

          <div class="action-footer">
            <button class="danger-btn" @click="handleRemoveSelectedNode">
              {{ t("app.storyGraph.actions.removeNode") }}
            </button>
          </div>
        </template>

        <!-- Edge Inspector -->
        <template v-else-if="selectedEdge">
          <h4>{{ t("app.storyGraph.inspector.edgeType") }}</h4>

          <label class="field">
            <select
              :value="selectedEdge.type"
              @change="
                handleUpdateEdgeType(
                  ($event.target as HTMLSelectElement)
                    .value as StoryGraphEdgeType,
                )
              "
            >
              <option value="contains">
                {{ t("app.storyGraph.edgeTypes.contains") }}
              </option>
              <option value="supports">
                {{ t("app.storyGraph.edgeTypes.supports") }}
              </option>
              <option value="precedes">
                {{ t("app.storyGraph.edgeTypes.precedes") }}
              </option>
              <option value="echoes">
                {{ t("app.storyGraph.edgeTypes.echoes") }}
              </option>
              <option value="alternative">
                {{ t("app.storyGraph.edgeTypes.alternative") }}
              </option>
            </select>
          </label>

          <p v-if="selectedEdge.type === 'echoes'" class="notice-text">
            {{ t("app.storyGraph.echoNotice") }}
          </p>

          <p v-if="edgeCycleError" class="error-notice" role="alert">
            {{ edgeCycleError }}
          </p>

          <div class="action-footer">
            <button class="danger-btn" @click="handleRemoveSelectedEdge">
              {{ t("app.storyGraph.actions.removeEdge") }}
            </button>
          </div>
        </template>

        <!-- No Selection -->
        <div v-else class="empty-inspector">
          <p>{{ t("app.storyGraph.inspector.noSelection") }}</p>
          <small class="hint-text">
            Keyboard shortcuts: Arrow keys to nudge nodes, Tab to focus, Delete
            to remove.
          </small>
        </div>
      </div>
    </aside>

    <!-- Storyboard Proposal Review Modal -->
    <StoryPlanReviewModal
      :show="planModalOpen"
      :story-id="props.story.id"
      :story="props.story"
      @close="planModalOpen = false"
      @adopted="handleAdopted"
    />
  </div>
</template>

<style scoped>
.story-graph-workspace {
  display: flex;
  width: 100%;
  height: calc(100vh - 120px);
  min-height: 500px;
  background: var(--of-bg);
  color: var(--of-text-primary);
  overflow: hidden;
  position: relative;
}

/* Sidebars */
.graph-sidebar {
  width: 280px;
  background: var(--of-surface-1);
  border-right: 1px solid var(--of-border-subtle);
  display: flex;
  flex-direction: column;
  transition: width var(--of-motion-normal) var(--of-motion-ease);
  z-index: 10;
}

.graph-sidebar.inspector-palette {
  border-right: none;
  border-left: 1px solid var(--of-border-subtle);
}

.graph-sidebar.is-collapsed {
  width: 48px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--of-space-3);
  border-bottom: 1px solid var(--of-border-subtle);
}

.sidebar-header h3 {
  font-size: var(--of-font-base);
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--of-space-2);
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-content {
  flex: 1;
  padding: var(--of-space-3);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--of-space-3);
}

.assets-scrollable-list {
  display: flex;
  flex-direction: column;
  gap: var(--of-space-2);
  overflow-y: auto;
}

.palette-asset-card {
  display: flex;
  align-items: center;
  gap: var(--of-space-2);
  padding: var(--of-space-2);
  border-radius: var(--of-radius-sm);
  background: var(--of-surface-2);
  cursor: pointer;
  border: 1px solid transparent;
}

.palette-asset-card:hover,
.palette-asset-card:focus {
  border-color: var(--of-accent);
}

.asset-thumb {
  width: 48px;
  height: 36px;
  object-fit: cover;
  border-radius: var(--of-radius-sm);
}

.asset-info {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.asset-name {
  font-size: var(--of-font-caption);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.asset-badge {
  font-size: 10px;
  color: var(--of-text-muted);
  text-transform: uppercase;
}

/* Center Canvas */
.graph-main-canvas {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: radial-gradient(var(--of-border-subtle) 1px, transparent 1px);
  background-size: 24px 24px;
}

.canvas-toolbar {
  position: absolute;
  top: var(--of-space-3);
  left: var(--of-space-3);
  right: var(--of-space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--of-space-2) var(--of-space-3);
  background: var(--of-surface-1);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-md);
  z-index: 20;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: var(--of-space-2);
}

.zoom-indicator {
  font-size: var(--of-font-small);
  min-width: 44px;
  text-align: center;
}

/* Canvas Viewport */
.canvas-viewport {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.graph-edges-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 10000px;
  height: 10000px;
  pointer-events: auto;
}

.graph-edge-path {
  fill: none;
  stroke: var(--of-border-strong);
  stroke-width: 2;
  cursor: pointer;
  transition: stroke var(--of-motion-fast);
}

.graph-edge-path:hover,
.graph-edge-path.is-selected {
  stroke: var(--of-accent);
  stroke-width: 3.5;
}

.graph-edge-path.edge-precedes {
  stroke: var(--of-accent);
}

.graph-edge-path.edge-contains {
  stroke: var(--of-success);
}

.graph-edge-path.edge-echoes {
  stroke: var(--of-warning);
  stroke-dasharray: 6 4;
}

.graph-edge-path.edge-alternative {
  stroke: var(--of-text-muted);
  stroke-dasharray: 2 3;
}

/* HTML Nodes */
.graph-nodes-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
}

.graph-node {
  position: absolute;
  top: 0;
  left: 0;
  width: 240px;
  background: var(--of-surface-2);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  user-select: none;
  cursor: grab;
  transition:
    border-color var(--of-motion-fast),
    box-shadow var(--of-motion-fast);
}

.graph-node:active {
  cursor: grabbing;
}

.graph-node.is-selected {
  border-color: var(--of-accent);
  box-shadow: 0 0 0 2px var(--of-accent);
}

.graph-node.is-highlighted {
  border-color: var(--of-focus);
}

.graph-node.is-dimmed {
  opacity: 0.35;
}

.node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--of-space-2) var(--of-space-3);
  border-bottom: 1px solid var(--of-border-subtle);
  font-size: var(--of-font-caption);
}

.node-body {
  padding: var(--of-space-3);
}

.node-title {
  display: block;
  font-size: var(--of-font-base);
  margin-bottom: var(--of-space-1);
}

.node-desc {
  font-size: var(--of-font-caption);
  color: var(--of-text-secondary);
  margin: 0;
}

/* Beat Node */
.beat-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--of-space-2);
}

.clip-status-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--of-radius-round);
}

.clip-status-pill.mapped {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.clip-status-pill.unmapped {
  background: var(--of-warning-soft);
  color: var(--of-warning);
}

/* Asset Node */
.asset-node-preview {
  width: 100%;
  height: 120px;
  overflow: hidden;
  border-top-left-radius: var(--of-radius-md);
  border-top-right-radius: var(--of-radius-md);
}

.node-asset-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-node-info {
  padding: var(--of-space-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.node-asset-title {
  font-size: var(--of-font-caption);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Idea Node */
.idea-source-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--of-radius-round);
  font-weight: bold;
}

.idea-source-pill.source-user-memory {
  background: var(--of-success-soft);
  color: var(--of-success);
}

.idea-source-pill.source-planned {
  background: var(--of-accent-soft);
  color: var(--of-accent);
}

.idea-source-pill.source-wish {
  background: #3c2a4d;
  color: #cca4f5;
}

.idea-source-pill.source-unknown {
  background: var(--of-surface-3);
  color: var(--of-text-muted);
}

.idea-text {
  font-size: var(--of-font-caption);
  margin: 0 0 var(--of-space-1);
}

/* Inspector Controls */
.inspector-section {
  padding: var(--of-space-3);
  background: var(--of-surface-2);
  border-radius: var(--of-radius-sm);
  display: flex;
  flex-direction: column;
  gap: var(--of-space-2);
}

.inline-select-row {
  display: flex;
  gap: var(--of-space-2);
}

.inline-select-row select {
  flex: 1;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--of-space-1);
  font-size: var(--of-font-small);
}

.field input,
.field textarea,
.field select {
  background: var(--of-surface-2);
  color: var(--of-text-primary);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
  padding: var(--of-space-2);
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  border-color: var(--of-focus);
  outline: none;
}

.mention-container {
  position: relative;
}

.mention-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--of-surface-3);
  border: 1px solid var(--of-border-strong);
  border-radius: var(--of-radius-sm);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  max-height: 160px;
  overflow-y: auto;
  z-index: 50;
}

.mention-item {
  padding: var(--of-space-2);
  cursor: pointer;
  font-size: var(--of-font-small);
}

.mention-item:hover {
  background: var(--of-accent-soft);
  color: var(--of-accent);
}

.primary-btn {
  background: var(--of-accent);
  color: var(--of-accent-ink);
  border: none;
  border-radius: var(--of-radius-sm);
  padding: var(--of-space-2) var(--of-space-3);
  cursor: pointer;
  font-weight: 500;
}

.secondary-btn {
  background: var(--of-surface-2);
  color: var(--of-text-primary);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
  padding: var(--of-space-2) var(--of-space-3);
  cursor: pointer;
}

.danger-btn {
  background: var(--of-danger-soft);
  color: var(--of-danger);
  border: 1px solid var(--of-danger);
  border-radius: var(--of-radius-sm);
  padding: var(--of-space-2);
  cursor: pointer;
}

.icon-btn {
  background: transparent;
  border: none;
  color: var(--of-text-secondary);
  cursor: pointer;
  padding: var(--of-space-1);
}

.notice-text {
  font-size: 11px;
  color: var(--of-text-muted);
}

.error-notice {
  color: var(--of-danger);
  font-size: var(--of-font-small);
  margin: var(--of-space-2) 0;
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  .graph-sidebar,
  .graph-edge-path,
  .graph-node {
    transition: none !important;
  }
}
</style>
