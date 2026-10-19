<script setup lang="ts">
import { computed, ref, toRaw, watch } from "vue";
import {
  evaluateGraphicSceneAtTime,
  graphicEasing,
  type EvaluatedGraphicNode,
  type GraphicNode,
  type GraphicScene,
} from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { useI18n } from "vue-i18n";

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Mode = "move" | "resize" | "rotate";
type NodeGeometry = {
  scene: GraphicScene;
  node: GraphicNode;
  evaluated: EvaluatedGraphicNode;
  parentMatrix: Matrix;
  worldMatrix: Matrix;
  corners: Point[];
  locked: boolean;
};
type Gesture = {
  mode: Mode;
  handle?: Handle;
  scene: GraphicScene;
  sceneId: string;
  nodeId: string;
  revision: string;
  node: GraphicNode;
  evaluated: EvaluatedGraphicNode;
  parentMatrix: Matrix;
  worldMatrix: Matrix;
  startPointer: Point;
  startParentPoint: Point;
  startLocalPoint: Point;
  startAngle: number;
  pointerId: number;
};

const props = defineProps<{
  scenes: readonly GraphicScene[];
  revision: string;
  time: number;
  frameWidth: number;
  frameHeight: number;
  selectedSceneId: string;
  selectedNodeId: string;
  enabled: boolean;
  snapping: boolean;
  guides: boolean;
}>();
const emit = defineEmits<{
  select: [selection: { sceneId: string; nodeId: string }];
  command: [command: TimelineCommand];
}>();
const { t } = useI18n();
const svg = ref<SVGSVGElement | null>(null);
const draftScene = ref<GraphicScene | null>(null);
const guideX = ref<number | null>(null);
const guideY = ref<number | null>(null);
let gesture: Gesture | undefined;

const identity: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}
function rotate(degrees: number): Matrix {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, 0, 0];
}
function scale(x: number, y: number): Matrix {
  return [x, 0, 0, y, 0, 0];
}
function point(matrix: Matrix, value: Point): Point {
  return {
    x: matrix[0] * value.x + matrix[2] * value.y + matrix[4],
    y: matrix[1] * value.x + matrix[3] * value.y + matrix[5],
  };
}
function inverse(matrix: Matrix): Matrix {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) < 1e-9) return identity;
  const inverseDeterminant = 1 / determinant;
  const a = matrix[3] * inverseDeterminant;
  const b = -matrix[1] * inverseDeterminant;
  const c = -matrix[2] * inverseDeterminant;
  const d = matrix[0] * inverseDeterminant;
  return [
    a,
    b,
    c,
    d,
    -(a * matrix[4] + c * matrix[5]),
    -(b * matrix[4] + d * matrix[5]),
  ];
}
function containsLocked(node: GraphicNode): boolean {
  return (
    !!node.locked ||
    (node.type === "group" && node.children.some(containsLocked))
  );
}
const entries = computed(() => {
  const result: NodeGeometry[] = [];
  const scenes = props.scenes
    .slice()
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((scene) =>
      draftScene.value?.id === scene.id ? draftScene.value : scene,
    );
  const collect = (
    scene: GraphicScene,
    nodes: readonly EvaluatedGraphicNode[],
    sourceNodes: readonly GraphicNode[],
    parentMatrix: Matrix,
    lockedAncestor = false,
  ) => {
    for (const evaluated of nodes) {
      const source = sourceNodes.find((node) => node.id === evaluated.id);
      if (!source) continue;
      const local = multiply(
        multiply(
          translate(evaluated.x, evaluated.y),
          rotate(evaluated.rotation ?? 0),
        ),
        scale(
          evaluated.width / evaluated.baseWidth,
          evaluated.height / evaluated.baseHeight,
        ),
      );
      const worldMatrix = multiply(parentMatrix, local);
      const corners = [
        point(worldMatrix, {
          x: -evaluated.baseWidth / 2,
          y: -evaluated.baseHeight / 2,
        }),
        point(worldMatrix, {
          x: evaluated.baseWidth / 2,
          y: -evaluated.baseHeight / 2,
        }),
        point(worldMatrix, {
          x: evaluated.baseWidth / 2,
          y: evaluated.baseHeight / 2,
        }),
        point(worldMatrix, {
          x: -evaluated.baseWidth / 2,
          y: evaluated.baseHeight / 2,
        }),
      ];
      result.push({
        scene,
        node: source,
        evaluated,
        parentMatrix,
        worldMatrix,
        corners,
        locked:
          lockedAncestor ||
          !!source.locked ||
          (source.type === "group" && source.children.some(containsLocked)),
      });
      if (source.type === "group" && evaluated.children)
        collect(
          scene,
          evaluated.children,
          source.children,
          worldMatrix,
          lockedAncestor || !!source.locked,
        );
    }
  };
  for (const scene of scenes) {
    const localTime = props.time - scene.start;
    if (localTime < 0 || localTime >= scene.duration) continue;
    const evaluated = evaluateGraphicSceneAtTime(scene, props.time);
    collect(scene, evaluated.nodes, scene.nodes, identity);
  }
  return result;
});
const selected = computed(
  () =>
    entries.value.find(
      (entry) =>
        entry.scene.id === props.selectedSceneId &&
        entry.node.id === props.selectedNodeId,
    ) ?? null,
);
const selectedHandles = computed(() => {
  const shape = selected.value;
  if (!shape || shape.locked) return [];
  const [nw, ne, se, sw] = shape.corners;
  const n = point(shape.worldMatrix, {
    x: 0,
    y: -shape.evaluated.baseHeight / 2,
  });
  const e = point(shape.worldMatrix, {
    x: shape.evaluated.baseWidth / 2,
    y: 0,
  });
  const s = point(shape.worldMatrix, {
    x: 0,
    y: shape.evaluated.baseHeight / 2,
  });
  const w = point(shape.worldMatrix, {
    x: -shape.evaluated.baseWidth / 2,
    y: 0,
  });
  return [
    { id: "nw" as const, point: nw! },
    { id: "n" as const, point: n },
    { id: "ne" as const, point: ne! },
    { id: "e" as const, point: e },
    { id: "se" as const, point: se! },
    { id: "s" as const, point: s },
    { id: "sw" as const, point: sw! },
    { id: "w" as const, point: w },
  ];
});
const selectedRotationHandle = computed(() => {
  const shape = selected.value;
  if (!shape || shape.locked) return null;
  const top = point(shape.worldMatrix, {
    x: 0,
    y: -shape.evaluated.baseHeight / 2,
  });
  const origin = point(shape.worldMatrix, { x: 0, y: 0 });
  const dx = top.x - origin.x;
  const dy = top.y - origin.y;
  const length = Math.hypot(dx, dy) || 1;
  const pad = handleUnit.value * 20;
  return { x: top.x + (dx / length) * pad, y: top.y + (dy / length) * pad };
});
const handleUnit = computed(() => {
  const rect = svg.value?.getBoundingClientRect();
  return rect?.width ? props.frameWidth / rect.width : 1;
});
const handleRadius = computed(() => handleUnit.value * 5);
const rotationLine = computed(() => {
  const shape = selected.value;
  const handle = selectedRotationHandle.value;
  if (!shape || !handle) return null;
  const top = point(shape.worldMatrix, {
    x: 0,
    y: -shape.evaluated.baseHeight / 2,
  });
  return { top, handle };
});

function toFrame(event: PointerEvent): Point {
  const rect = svg.value?.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: ((event.clientX - rect.left) / rect.width - 0.5) * props.frameWidth,
    y: ((event.clientY - rect.top) / rect.height - 0.5) * props.frameHeight,
  };
}
function flatFind(nodes: GraphicNode[], id: string): GraphicNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const child = flatFind(node.children, id);
      if (child) return child;
    }
  }
}
function findContainer(
  nodes: GraphicNode[],
  id: string,
): GraphicNode[] | undefined {
  if (nodes.some((node) => node.id === id)) return nodes;
  for (const node of nodes) {
    if (node.type === "group") {
      const found = findContainer(node.children, id);
      if (found) return found;
    }
  }
}
function influence(
  node: GraphicNode,
  field: "x" | "y" | "width" | "height" | "rotation",
  localTime: number,
) {
  const elapsed = localTime - node.start;
  const enter = node.animation?.enter;
  if (
    enter &&
    elapsed >= 0 &&
    elapsed < enter.duration &&
    Object.hasOwn(enter.from, field)
  )
    return graphicEasing(enter.easing, elapsed / enter.duration);
  const exit = node.animation?.exit;
  if (
    exit &&
    localTime >= node.end - exit.duration &&
    Object.hasOwn(exit.to, field)
  )
    return (
      1 -
      graphicEasing(
        exit.easing,
        (localTime - node.end + exit.duration) / exit.duration,
      )
    );
  return 1;
}
function startGesture(
  event: PointerEvent,
  shape: NodeGeometry,
  mode: Mode,
  handle?: Handle,
) {
  if (!props.enabled) return;
  event.preventDefault();
  event.stopPropagation();
  selectShape(shape);
  if (shape.locked) return;
  const scene = structuredClone(shape.scene);
  const node = flatFind(scene.nodes, shape.node.id);
  if (!node) return;
  const startPointer = toFrame(event);
  const startParentPoint = point(inverse(shape.parentMatrix), startPointer);
  const startLocalPoint = point(inverse(shape.worldMatrix), startPointer);
  gesture = {
    mode,
    handle,
    scene,
    sceneId: scene.id,
    nodeId: node.id,
    revision: props.revision,
    node,
    evaluated: structuredClone(shape.evaluated),
    parentMatrix: shape.parentMatrix,
    worldMatrix: shape.worldMatrix,
    startPointer,
    startParentPoint,
    startLocalPoint,
    startAngle: Math.atan2(
      startParentPoint.y - node.y,
      startParentPoint.x - node.x,
    ),
    pointerId: event.pointerId,
  };
  draftScene.value = scene;
  svg.value?.setPointerCapture(event.pointerId);
}
function selectShape(shape: NodeGeometry) {
  emit("select", { sceneId: shape.scene.id, nodeId: shape.node.id });
}
function snap(value: number, candidates: number[], enabled: boolean) {
  if (!enabled) return { value, guide: null as number | null };
  let snapped = Math.round(value / 8) * 8;
  let guide: number | null = null;
  for (const candidate of candidates) {
    if (
      Math.abs(candidate - value) <= 7 &&
      (guide === null || Math.abs(candidate - value) < Math.abs(guide - value))
    ) {
      snapped = candidate;
      guide = candidate;
    }
  }
  return { value: snapped, guide };
}
function pointerMove(event: PointerEvent) {
  const active = gesture;
  if (!active || active.revision !== props.revision) {
    if (active) cancelGesture();
    return;
  }
  const world = toFrame(event);
  const parentPoint = point(inverse(active.parentMatrix), world);
  const localTime = props.time - active.scene.start;
  const next = structuredClone(active.scene);
  const node = flatFind(next.nodes, active.nodeId);
  if (!node) return cancelGesture();
  if (active.mode === "move") {
    const xInfluence = influence(active.node, "x", localTime);
    const yInfluence = influence(active.node, "y", localTime);
    const container = findContainer(next.nodes, node.id) ?? next.nodes;
    const peers = container.filter((candidate) => candidate.id !== node.id);
    const xCandidates = [0, ...peers.map((peer) => peer.x)];
    const yCandidates = [0, ...peers.map((peer) => peer.y)];
    const x = snap(
      active.node.x +
        (parentPoint.x - active.startParentPoint.x) /
          Math.max(xInfluence, 0.02),
      xCandidates,
      props.snapping,
    );
    const y = snap(
      active.node.y +
        (parentPoint.y - active.startParentPoint.y) /
          Math.max(yInfluence, 0.02),
      yCandidates,
      props.snapping,
    );
    node.x = x.value;
    node.y = y.value;
    guideX.value = props.guides ? x.guide : null;
    guideY.value = props.guides ? y.guide : null;
  } else if (active.mode === "rotate") {
    const angle = Math.atan2(
      parentPoint.y - active.node.y,
      parentPoint.x - active.node.x,
    );
    const delta = ((angle - active.startAngle) * 180) / Math.PI;
    const factor = influence(active.node, "rotation", localTime);
    node.rotation =
      (active.node.rotation ?? 0) + delta / Math.max(factor, 0.02);
  } else {
    const start = active.startLocalPoint;
    const current = point(inverse(active.worldMatrix), world);
    const handle = active.handle!;
    const signX = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
    const signY = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
    const effectiveScaleX = active.evaluated.width / active.evaluated.baseWidth;
    const effectiveScaleY =
      active.evaluated.height / active.evaluated.baseHeight;
    const widthFactor = influence(active.node, "width", localTime);
    const heightFactor = influence(active.node, "height", localTime);
    const deltaWidth =
      (signX * (current.x - start.x) * effectiveScaleX) /
      Math.max(widthFactor, 0.02);
    const deltaHeight =
      (signY * (current.y - start.y) * effectiveScaleY) /
      Math.max(heightFactor, 0.02);
    const width = Math.max(1, Math.min(4096, active.node.width + deltaWidth));
    const height = Math.max(
      1,
      Math.min(4096, active.node.height + deltaHeight),
    );
    const appliedWidthDelta = width - active.node.width;
    const appliedHeightDelta = height - active.node.height;
    const shiftX = (signX * appliedWidthDelta * widthFactor) / 2;
    const shiftY = (signY * appliedHeightDelta * heightFactor) / 2;
    const radians = ((active.evaluated.rotation ?? 0) * Math.PI) / 180;
    const xFactor = influence(active.node, "x", localTime);
    const yFactor = influence(active.node, "y", localTime);
    node.width = width;
    node.height = height;
    node.x +=
      (Math.cos(radians) * shiftX - Math.sin(radians) * shiftY) /
      Math.max(xFactor, 0.02);
    node.y +=
      (Math.sin(radians) * shiftX + Math.cos(radians) * shiftY) /
      Math.max(yFactor, 0.02);
    guideX.value = null;
    guideY.value = null;
  }
  draftScene.value = next;
}
function finishGesture(event: PointerEvent) {
  const active = gesture;
  if (!active) return;
  if (svg.value?.hasPointerCapture(event.pointerId))
    svg.value.releasePointerCapture(event.pointerId);
  const scene = draftScene.value
    ? structuredClone(toRaw(draftScene.value))
    : null;
  gesture = undefined;
  draftScene.value = null;
  guideX.value = null;
  guideY.value = null;
  if (active.revision === props.revision && scene)
    emit("command", { type: "graphic.scene.upsert", scene });
}
function cancelGesture() {
  if (gesture && svg.value?.hasPointerCapture(gesture.pointerId))
    svg.value.releasePointerCapture(gesture.pointerId);
  gesture = undefined;
  draftScene.value = null;
  guideX.value = null;
  guideY.value = null;
}
function nudge(event: KeyboardEvent) {
  if (!props.enabled || !selected.value || selected.value.locked) return;
  const amount = event.shiftKey ? 10 : 1;
  const deltas: Record<string, Point> = {
    ArrowLeft: { x: -amount, y: 0 },
    ArrowRight: { x: amount, y: 0 },
    ArrowUp: { x: 0, y: -amount },
    ArrowDown: { x: 0, y: amount },
  };
  const delta = deltas[event.key];
  if (!delta) return;
  event.preventDefault();
  const scene = structuredClone(selected.value.scene);
  const node = flatFind(scene.nodes, selected.value.node.id);
  if (!node || node.locked) return;
  node.x += delta.x;
  node.y += delta.y;
  emit("command", { type: "graphic.scene.upsert", scene });
}
watch(
  () => props.revision,
  () => {
    if (gesture) cancelGesture();
  },
);
</script>

<template>
  <svg
    ref="svg"
    class="graphic-layer-overlay"
    data-testid="graphic-layer-canvas"
    :class="{ 'graphic-layer-overlay-active': enabled }"
    :viewBox="`${-frameWidth / 2} ${-frameHeight / 2} ${frameWidth} ${frameHeight}`"
    preserveAspectRatio="none"
    role="group"
    :aria-label="t('editor.graphics.layerCanvas')"
    :tabindex="enabled ? 0 : -1"
    @keydown="nudge"
    @pointermove="pointerMove"
    @pointerup="finishGesture"
    @pointercancel="cancelGesture"
  >
    <template v-if="guides">
      <line
        class="graphic-layer-guide"
        x1="0"
        :y1="-frameHeight / 2"
        x2="0"
        :y2="frameHeight / 2"
      />
      <line
        class="graphic-layer-guide"
        :x1="-frameWidth / 2"
        y1="0"
        :x2="frameWidth / 2"
        y2="0"
      />
    </template>
    <line
      v-if="guides && guideX !== null"
      class="graphic-layer-guide graphic-layer-guide-snap"
      :x1="guideX"
      :y1="-frameHeight / 2"
      :x2="guideX"
      :y2="frameHeight / 2"
    />
    <line
      v-if="guides && guideY !== null"
      class="graphic-layer-guide graphic-layer-guide-snap"
      :x1="-frameWidth / 2"
      :y1="guideY"
      :x2="frameWidth / 2"
      :y2="guideY"
    />
    <polygon
      v-for="shape in entries"
      :key="`${shape.scene.id}:${shape.node.id}`"
      data-testid="graphic-layer-target"
      :data-layer-id="shape.node.id"
      :points="shape.corners.map((point) => `${point.x},${point.y}`).join(' ')"
      class="graphic-layer-target"
      :class="{
        'graphic-layer-target-selected':
          selectedSceneId === shape.scene.id &&
          selectedNodeId === shape.node.id,
        'graphic-layer-target-locked': shape.locked,
      }"
      :tabindex="enabled ? 0 : -1"
      role="button"
      :aria-label="t('editor.graphics.selectLayer', { id: shape.node.id })"
      :aria-pressed="
        selectedSceneId === shape.scene.id && selectedNodeId === shape.node.id
      "
      @focus="selectShape(shape)"
      @keydown.enter.stop="selectShape(shape)"
      @keydown.space.prevent.stop="selectShape(shape)"
      @pointerdown="startGesture($event, shape, 'move')"
    />
    <template v-if="selected && enabled">
      <polygon
        :points="
          selected.corners.map((point) => `${point.x},${point.y}`).join(' ')
        "
        class="graphic-layer-selection"
        :stroke-width="handleUnit * 1.5"
        pointer-events="none"
      />
      <template v-if="!selected.locked">
        <line
          v-if="rotationLine"
          class="graphic-layer-selection"
          :x1="rotationLine.top.x"
          :y1="rotationLine.top.y"
          :x2="rotationLine.handle.x"
          :y2="rotationLine.handle.y"
          :stroke-width="handleUnit * 1.5"
          pointer-events="none"
        />
        <circle
          v-if="selectedRotationHandle"
          class="graphic-layer-handle graphic-layer-rotate-handle"
          data-testid="graphic-layer-rotation-handle"
          :cx="selectedRotationHandle.x"
          :cy="selectedRotationHandle.y"
          :r="handleRadius"
          aria-hidden="true"
          @pointerdown="startGesture($event, selected, 'rotate')"
        />
        <circle
          v-for="handle in selectedHandles"
          :key="handle.id"
          class="graphic-layer-handle"
          data-testid="graphic-layer-resize-handle"
          :data-handle="handle.id"
          :class="`graphic-layer-handle-${handle.id}`"
          :cx="handle.point.x"
          :cy="handle.point.y"
          :r="handleRadius"
          aria-hidden="true"
          @pointerdown="startGesture($event, selected, 'resize', handle.id)"
        />
      </template>
    </template>
  </svg>
</template>
