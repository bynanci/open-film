<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  validateGraphicScenes,
  type GraphicScene,
  type GraphicNode,
  type GraphicEasing,
  type PhotoDepthRecipe,
} from "@openfilm/core";
import type { MediaAsset } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import GraphicSceneAgentReview from "./GraphicSceneAgentReview.vue";
import PhotoDepthControls from "./PhotoDepthControls.vue";
const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  scenes: readonly GraphicScene[];
  duration: number;
  frameRate: number;
  assets: readonly MediaAsset[];
  dependencyVersion?: string;
  disabled: boolean;
  agentDisabled: boolean;
  selectedSceneId?: string;
  selectedNodeId?: string;
  snapping: boolean;
  guides: boolean;
}>();
const emit = defineEmits<{
  command: [command: TimelineCommand, referencedAssets?: readonly MediaAsset[]];
  selection: [selection: { sceneId: string; nodeId: string }];
  previewTime: [time: number];
  importAssets: [];
  "update:snapping": [value: boolean];
  "update:guides": [value: boolean];
  agentBusy: [value: boolean];
  agentPending: [value: boolean];
  agentAccepted: [];
  agentReload: [];
}>();
const { t } = useI18n();
const sceneId = ref("");
const nodeId = ref("");
const error = ref(false);
watch(
  () => props.scenes,
  (scenes) => {
    if (!scenes.some((scene) => scene.id === sceneId.value))
      sceneId.value = scenes[0]?.id ?? "";
  },
  { immediate: true },
);
const scene = computed(() =>
  props.scenes.find((scene) => scene.id === sceneId.value),
);
const flatten = (
  nodes: readonly GraphicNode[],
  depth = 0,
  lockedAncestor = false,
): {
  node: GraphicNode;
  depth: number;
  siblings: readonly GraphicNode[];
  lockedAncestor: boolean;
}[] =>
  nodes
    .slice()
    .sort((first, second) => second.zIndex - first.zIndex)
    .flatMap((node) => [
      { node, depth, siblings: nodes, lockedAncestor },
      ...(node.type === "group"
        ? flatten(node.children, depth + 1, lockedAncestor || !!node.locked)
        : []),
    ]);
const nodes = computed(() => flatten(scene.value?.nodes ?? []));
const node = computed(
  () => nodes.value.find((item) => item.node.id === nodeId.value)?.node,
);
const selectedLayerProtected = computed(() => isLayerProtected(nodeId.value));
const sceneHasLockedLayer = computed(() =>
  nodes.value.some((item) => item.node.locked),
);
watch(
  [() => props.selectedSceneId, () => props.selectedNodeId],
  ([selectedScene, selectedNode]) => {
    if (selectedScene && props.scenes.some((item) => item.id === selectedScene))
      sceneId.value = selectedScene;
    if (
      selectedNode &&
      flatten(
        props.scenes.find((item) => item.id === selectedScene)?.nodes ?? [],
      ).some((item) => item.node.id === selectedNode)
    )
      nodeId.value = selectedNode;
  },
  { immediate: true },
);
watch(nodes, (list) => {
  if (!list.some((item) => item.node.id === nodeId.value))
    nodeId.value = list[0]?.node.id ?? "";
});
watch(
  [sceneId, nodeId],
  () => {
    if (scene.value && node.value)
      emit("selection", { sceneId: scene.value.id, nodeId: node.value.id });
  },
  { flush: "post" },
);
const images = computed(() =>
  props.assets.filter((asset) => asset.mediaType === "image"),
);
const isRootImageNode = computed(
  () =>
    node.value?.type === "image" &&
    scene.value?.nodes.some((item) => item.id === node.value?.id),
);
const value = (event: Event) => (event.target as HTMLInputElement).value;
const numericFields = [
  "x",
  "y",
  "width",
  "height",
  "opacity",
  "rotation",
  "zIndex",
  "start",
  "end",
] as const;
const animatedFields = [
  "x",
  "y",
  "width",
  "height",
  "opacity",
  "rotation",
] as const;
const phases = ["enter", "exit"] as const;
const easingOptions: GraphicEasing[] = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
];
function save(next: GraphicScene) {
  if (props.disabled) return;
  try {
    validateGraphicScenes(
      [...props.scenes.filter((item) => item.id !== next.id), next],
      props.duration,
    );
    error.value = false;
    emit("command", { type: "graphic.scene.upsert", scene: next });
  } catch {
    error.value = true;
  }
}
function updateScene(
  key: "name" | "start" | "duration" | "zIndex",
  event: Event,
) {
  if (scene.value)
    save({
      ...structuredClone(scene.value),
      [key]: key === "name" ? value(event) : Number(value(event)),
    });
}
function updateNode(update: (node: GraphicNode) => void) {
  if (!scene.value || !node.value || isLayerProtected(node.value.id)) return;
  updateLayer(node.value.id, update);
}
function isLayerProtected(id: string): boolean {
  const entry = nodes.value.find((item) => item.node.id === id);
  return !entry || entry.lockedAncestor || containsLockedLayer(entry.node);
}
function updateLayer(id: string, update: (node: GraphicNode) => void) {
  if (!scene.value) return;
  const next = structuredClone(scene.value);
  const selected = flatten(next.nodes).find(
    (item) => item.node.id === id,
  )?.node;
  if (!selected) return;
  const priorImageAssetId =
    selected.type === "image" ? selected.assetId : undefined;
  update(selected);
  if (
    selected.type === "image" &&
    priorImageAssetId !== selected.assetId &&
    next.photoDepth?.nodeId === id
  ) {
    const bound = next.photoDepth;
    const replacement = props.assets.find(
      (asset) => asset.id === selected.assetId,
    );
    const duration = selected.end - selected.start;
    if (
      replacement?.contentHash &&
      /^[a-f0-9]{64}$/u.test(replacement.contentHash) &&
      duration >= 3 &&
      duration <= 6
    ) {
      next.photoDepth = {
        version: 1,
        id: bound.id,
        nodeId: id,
        mode: "fallback",
        duration,
        sourceAssetId: selected.assetId,
        sourceSha256: replacement.contentHash,
        fallbackReason: "mask-unreliable",
      } satisfies PhotoDepthRecipe;
    } else delete next.photoDepth;
  } else if (selected.type === "image" && next.photoDepth?.nodeId === id) {
    next.photoDepth.duration = selected.end - selected.start;
  }
  save(next);
}
function addScene() {
  const next: GraphicScene = {
    version: 1,
    id: crypto.randomUUID(),
    name: t("editor.graphics.defaultScene"),
    start: 0,
    duration: Math.min(6, props.duration),
    zIndex: 0,
    nodes: [],
  };
  save(next);
  sceneId.value = next.id;
}
function addNode(type: GraphicNode["type"]) {
  if (!scene.value) return;
  const next = structuredClone(scene.value);
  const base = {
    id: crypto.randomUUID(),
    x: 0,
    y: 0,
    width: 160,
    height: 80,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: next.duration,
  };
  let added: GraphicNode;
  if (type === "shape")
    added = { ...base, type, shape: "rect", fill: "#edb84f" };
  else if (type === "text")
    added = {
      ...base,
      width: 360,
      height: 100,
      type,
      text: t("editor.graphics.defaultText"),
      fontSize: 36,
    };
  else if (type === "image") {
    if (!images.value[0]) return;
    added = { ...base, type, assetId: images.value[0].id };
  } else added = { ...base, type, children: [] };
  const parent = flatten(next.nodes).find(
    (item) => item.node.id === nodeId.value,
  )?.node;
  if (parent?.type === "group" && !parent.locked) parent.children.push(added);
  else next.nodes.push(added);
  save(next);
  nodeId.value = added.id;
}
function removeNode() {
  if (!scene.value) return;
  const next = structuredClone(scene.value);
  const remove = (list: GraphicNode[]): GraphicNode[] =>
    list
      .filter((item) => item.id !== nodeId.value)
      .map((item) =>
        item.type === "group"
          ? { ...item, children: remove(item.children) }
          : item,
      );
  next.nodes = remove(next.nodes);
  if (next.photoDepth?.nodeId === nodeId.value) delete next.photoDepth;
  save(next);
}
function nudgeLayer(event: KeyboardEvent) {
  if (!node.value || isLayerProtected(node.value.id)) return;
  const amount = event.shiftKey ? 10 : 1;
  const delta =
    event.key === "ArrowLeft"
      ? { x: -amount, y: 0 }
      : event.key === "ArrowRight"
        ? { x: amount, y: 0 }
        : event.key === "ArrowUp"
          ? { x: 0, y: -amount }
          : event.key === "ArrowDown"
            ? { x: 0, y: amount }
            : null;
  if (!delta) return;
  event.preventDefault();
  updateNode((item) => {
    item.x += delta.x;
    item.y += delta.y;
  });
}
function reorderNode(id: string, offset: -1 | 1) {
  if (!scene.value) return;
  const next = structuredClone(scene.value);
  const selected = flatten(next.nodes).find(
    (item) => item.node.id === id,
  )?.node;
  const container = findContainer(next.nodes, id);
  if (!selected || !container || isLayerProtected(id)) return;
  nodeId.value = id;
  selected.zIndex =
    offset > 0
      ? Math.min(1000, Math.max(...container.map((item) => item.zIndex)) + 1)
      : Math.max(-1000, Math.min(...container.map((item) => item.zIndex)) - 1);
  save(next);
}
function findContainer(
  nodes: GraphicNode[],
  id: string,
): GraphicNode[] | undefined {
  if (nodes.some((item) => item.id === id)) return nodes;
  for (const item of nodes) {
    if (item.type === "group") {
      const found = findContainer(item.children, id);
      if (found) return found;
    }
  }
}
function containsLockedLayer(node: GraphicNode): boolean {
  return (
    !!node.locked ||
    (node.type === "group" && node.children.some(containsLockedLayer))
  );
}
function animationDuration(phase: "enter" | "exit", event: Event) {
  const duration = Number(value(event));
  updateNode((item) => {
    if (duration === 0) {
      if (item.animation) {
        delete item.animation[phase];
        if (!item.animation.enter && !item.animation.exit)
          delete item.animation;
      }
      return;
    }
    item.animation ??= {};
    if (phase === "enter")
      item.animation.enter = {
        duration,
        easing: item.animation.enter?.easing ?? "linear",
        from: item.animation.enter?.from ?? { x: item.x - 80, opacity: 0 },
      };
    else
      item.animation.exit = {
        duration,
        easing: item.animation.exit?.easing ?? "linear",
        to: item.animation.exit?.to ?? { x: item.x + 80, opacity: 0 },
      };
  });
}
function endpoint(
  phase: "enter" | "exit",
  key: (typeof animatedFields)[number],
  event: Event,
) {
  updateNode((item) => {
    const animation = item.animation?.[phase];
    if (!animation) return;
    const values = "from" in animation ? animation.from : animation.to;
    values[key] = Number(value(event));
  });
}
function endpointValue(
  phase: "enter" | "exit",
  key: (typeof animatedFields)[number],
) {
  const animation = node.value?.animation?.[phase];
  if (!animation) return node.value?.[key];
  const values = "from" in animation ? animation.from : animation.to;
  return values[key] ?? node.value?.[key];
}
</script>

<template>
  <section class="graphic-inspector" :aria-label="t('editor.graphics.tab')">
    <p class="editor-muted">{{ t("editor.graphics.help") }}</p>
    <div class="graphic-layer-options">
      <label>
        <input
          type="checkbox"
          :checked="snapping"
          @change="
            emit('update:snapping', ($event.target as HTMLInputElement).checked)
          "
        />
        {{ t("editor.graphics.snapping") }}
      </label>
      <label>
        <input
          type="checkbox"
          :checked="guides"
          @change="
            emit('update:guides', ($event.target as HTMLInputElement).checked)
          "
        />
        {{ t("editor.graphics.guides") }}
      </label>
    </div>
    <p class="editor-muted graphic-keyboard-hint">
      {{ t("editor.graphics.keyboardHint") }}
    </p>
    <p v-if="error" role="alert">{{ t("editor.graphics.invalid") }}</p>
    <button
      class="editor-button"
      :disabled="disabled || duration <= 0 || scenes.length >= 8"
      @click="addScene"
    >
      {{ t("editor.graphics.addScene") }}
    </button>
    <fieldset :disabled="disabled">
      <label
        >{{ t("editor.graphics.scene")
        }}<select v-model="sceneId" data-testid="graphic-scene-select">
          <option v-for="item in scenes" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select></label
      >
      <template v-if="scene">
        <label
          >{{ t("editor.graphics.name")
          }}<input :value="scene.name" @change="updateScene('name', $event)"
        /></label>
        <div class="graphic-field-grid">
          <label
            v-for="field in ['start', 'duration', 'zIndex'] as const"
            :key="field"
            >{{ t(`editor.graphics.${field}`)
            }}<input
              type="number"
              step="any"
              :disabled="sceneHasLockedLayer"
              :value="scene[field]"
              @change="updateScene(field, $event)"
          /></label>
        </div>
        <div
          v-if="nodes.length"
          class="graphic-layer-list"
          :aria-label="t('editor.graphics.node')"
        >
          <div
            v-for="item in nodes"
            :key="item.node.id"
            class="graphic-layer-row"
            :class="{ selected: item.node.id === nodeId }"
          >
            <button
              type="button"
              class="graphic-layer-select"
              :aria-pressed="item.node.id === nodeId"
              :aria-label="
                t('editor.graphics.selectLayer', { id: item.node.id })
              "
              @click="nodeId = item.node.id"
              @keydown.stop="nudgeLayer"
            >
              <span aria-hidden="true">{{ "· ".repeat(item.depth) }}</span>
              {{ t(`editor.graphics.${item.node.type}`) }} ·
              {{ item.node.id.slice(0, 8) }}
              <span v-if="item.node.hidden" class="graphic-layer-state">{{
                t("editor.graphics.hidden")
              }}</span>
            </button>
            <button
              type="button"
              class="editor-button graphic-layer-action"
              :aria-label="
                t(
                  item.node.hidden
                    ? 'editor.graphics.showLayer'
                    : 'editor.graphics.hideLayer',
                )
              "
              :aria-pressed="!!item.node.hidden"
              :disabled="item.lockedAncestor || containsLockedLayer(item.node)"
              @click="
                updateLayer(item.node.id, (layer) => {
                  layer.hidden = !layer.hidden;
                })
              "
            >
              {{
                item.node.hidden
                  ? t("editor.graphics.showLayer")
                  : t("editor.graphics.hideLayer")
              }}
            </button>
            <button
              type="button"
              class="editor-button graphic-layer-action"
              :aria-label="
                t(
                  item.node.locked
                    ? 'editor.graphics.unlockLayer'
                    : 'editor.graphics.lockLayer',
                )
              "
              :aria-pressed="!!item.node.locked"
              :disabled="item.lockedAncestor"
              @click="
                updateLayer(item.node.id, (layer) => {
                  layer.locked = !layer.locked;
                })
              "
            >
              {{
                item.node.locked
                  ? t("editor.graphics.unlockLayer")
                  : t("editor.graphics.lockLayer")
              }}
            </button>
            <div class="graphic-layer-order-actions">
              <button
                type="button"
                class="editor-button"
                :aria-label="t('editor.graphics.raiseLayer')"
                :disabled="
                  item.lockedAncestor || containsLockedLayer(item.node)
                "
                @click="reorderNode(item.node.id, 1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="editor-button"
                :aria-label="t('editor.graphics.lowerLayer')"
                :disabled="
                  item.lockedAncestor || containsLockedLayer(item.node)
                "
                @click="reorderNode(item.node.id, -1)"
              >
                ↓
              </button>
            </div>
          </div>
        </div>
        <div class="graphic-actions">
          <button
            v-for="type in ['image', 'text', 'shape', 'group'] as const"
            :key="type"
            class="editor-button"
            :disabled="type === 'image' && !images.length"
            @click="addNode(type)"
          >
            {{ t(`editor.graphics.${type}`) }}
          </button>
        </div>
        <label
          >{{ t("editor.graphics.node")
          }}<select v-model="nodeId" data-testid="graphic-node-select">
            <option
              v-for="item in nodes"
              :key="item.node.id"
              :value="item.node.id"
            >
              {{ "· ".repeat(item.depth)
              }}{{ t(`editor.graphics.${item.node.type}`) }} ·
              {{ item.node.id.slice(0, 8) }}
            </option>
          </select></label
        >
        <template v-if="node">
          <fieldset
            class="graphic-node-edit-fields"
            :disabled="selectedLayerProtected"
          >
            <p v-if="node.type === 'group'" class="editor-muted">
              {{ t("editor.graphics.groupHelp") }}
            </p>
            <div class="graphic-field-grid">
              <label v-for="field in numericFields" :key="field"
                >{{ t(`editor.graphics.${field}`)
                }}<input
                  type="number"
                  step="any"
                  :data-testid="`graphic-node-${field}`"
                  :value="node[field]"
                  @change="
                    updateNode((item) => {
                      item[field] = Number(value($event));
                    })
                  "
              /></label>
            </div>
            <label class="graphic-opacity-slider"
              >{{ t("editor.graphics.opacity") }}
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="node.opacity"
                :disabled="!!node.locked"
                @change="
                  updateNode((item) => {
                    item.opacity = Number(value($event));
                  })
                "
              />
            </label>
            <template v-if="node.type === 'text'">
              <label
                >{{ t("editor.graphics.textContent")
                }}<textarea
                  :value="node.text"
                  data-testid="graphic-text"
                  @change="
                    updateNode((item) => {
                      if (item.type === 'text') item.text = value($event);
                    })
                  "
                />
              </label>
              <label
                >{{ t("editor.graphics.fontSize")
                }}<input
                  type="number"
                  :value="node.fontSize"
                  @change="
                    updateNode((item) => {
                      if (item.type === 'text')
                        item.fontSize = Number(value($event));
                    })
                  "
              /></label>
              <label
                >{{ t("editor.graphics.fontFamily")
                }}<input
                  :value="node.fontFamily ?? ''"
                  @change="
                    updateNode((item) => {
                      if (item.type === 'text') {
                        const text = value($event);
                        if (text) item.fontFamily = text;
                        else delete item.fontFamily;
                      }
                    })
                  "
              /></label>
              <label
                >{{ t("editor.graphics.fontWeight")
                }}<select
                  :value="node.fontWeight ?? 400"
                  @change="
                    updateNode((item) => {
                      if (item.type === 'text')
                        item.fontWeight = Number(value($event)) as 400 | 700;
                    })
                  "
                >
                  <option :value="400">400</option>
                  <option :value="700">700</option>
                </select></label
              >
            </template>
            <label v-if="node.type === 'image'"
              >{{ t("editor.graphics.image")
              }}<select
                data-testid="graphic-node-image-asset"
                :value="node.assetId"
                @change="
                  updateNode((item) => {
                    if (item.type === 'image') item.assetId = value($event);
                  })
                "
              >
                <option
                  v-for="asset in images"
                  :key="asset.id"
                  :value="asset.id"
                >
                  {{ asset.name }}
                </option>
              </select></label
            >
            <PhotoDepthControls
              v-if="node.type === 'image' && isRootImageNode && scene"
              :project-id="projectId"
              :dependency-version="dependencyVersion"
              :scene="scene"
              :node="node"
              :assets="assets"
              :duration="duration"
              :frame-rate="frameRate"
              :disabled="disabled || selectedLayerProtected"
              @command="(command, assets) => emit('command', command, assets)"
              @preview="emit('previewTime', $event)"
              @import-assets="emit('importAssets')"
            />
            <template v-if="node.type === 'shape'"
              ><label
                >{{ t("editor.graphics.shape")
                }}<select
                  :value="node.shape"
                  @change="
                    updateNode((item) => {
                      if (item.type === 'shape')
                        item.shape = value($event) as 'rect' | 'ellipse';
                    })
                  "
                >
                  <option value="rect">{{ t("editor.graphics.rect") }}</option>
                  <option value="ellipse">
                    {{ t("editor.graphics.ellipse") }}
                  </option>
                </select></label
              ><label
                >{{ t("editor.graphics.fill")
                }}<input
                  type="color"
                  :value="node.fill"
                  @change="
                    updateNode((item) => {
                      if (item.type === 'shape') item.fill = value($event);
                    })
                  " /></label
            ></template>
            <fieldset v-for="phase in phases" :key="phase">
              <legend>{{ t(`editor.graphics.${phase}`) }}</legend>
              <label
                >{{ t("editor.graphics.duration")
                }}<input
                  type="number"
                  min="0"
                  step="0.1"
                  :data-testid="`graphic-${phase}-duration`"
                  :value="node.animation?.[phase]?.duration ?? 0"
                  @change="animationDuration(phase, $event)"
              /></label>
              <template v-if="node.animation?.[phase]"
                ><label
                  >{{ t("editor.graphics.easing")
                  }}<select
                    :value="node.animation?.[phase]?.easing"
                    @change="
                      updateNode((item) => {
                        const animation = item.animation?.[phase];
                        if (animation)
                          animation.easing = value($event) as GraphicEasing;
                      })
                    "
                  >
                    <option
                      v-for="easing in easingOptions"
                      :key="easing"
                      :value="easing"
                    >
                      {{ t(`editor.graphics.${easing}`) }}
                    </option>
                  </select></label
                >
                <div class="graphic-field-grid">
                  <label v-for="field in animatedFields" :key="field"
                    >{{ t(`editor.graphics.${phase}`) }}
                    {{ t(`editor.graphics.${field}`)
                    }}<input
                      type="number"
                      step="any"
                      :value="endpointValue(phase, field)"
                      @change="endpoint(phase, field, $event)"
                  /></label></div
              ></template>
            </fieldset>
            <button class="editor-button" @click="removeNode">
              {{ t("editor.graphics.removeNode") }}
            </button>
          </fieldset>
        </template>
        <button
          class="editor-button"
          :disabled="sceneHasLockedLayer"
          @click="
            emit('command', { type: 'graphic.scene.remove', sceneId: scene.id })
          "
        >
          {{ t("editor.graphics.removeScene") }}
        </button>
      </template>
    </fieldset>
    <GraphicSceneAgentReview
      v-if="scene && node"
      :project-id="projectId"
      :composition-id="compositionId"
      :revision="revision"
      :scene="scene"
      :selected-node-id="node.id"
      :disabled="agentDisabled || selectedLayerProtected"
      @busy="emit('agentBusy', $event)"
      @pending="emit('agentPending', $event)"
      @accepted="emit('agentAccepted')"
      @reload="emit('agentReload')"
    />
  </section>
</template>
