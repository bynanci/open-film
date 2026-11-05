<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { GRAPHIC_SCENE_TEMPLATE_LIMITS } from "@openfilm/core";
import type {
  ConversationSourceRecord,
  GraphicEasing,
  GraphicSceneTemplateRecord,
  PhotoRelationshipTemplateRecord,
  ProjectContentLocale,
} from "@openfilm/core";
import type { GraphicScene, MediaAsset } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import { api } from "../api";
import {
  createConversationCard,
  createPhotoRelationship,
  createRouteStory,
  parseGpxRoute,
  type ConversationCardMessage,
  type GpxCoordinate,
  type GpxWaypoint,
  type ParsedGpxRoute,
} from "@openfilm/story";

const props = defineProps<{
  scenes: readonly GraphicScene[];
  records: readonly GraphicSceneTemplateRecord[];
  duration: number;
  width: number;
  height: number;
  locale: ProjectContentLocale;
  assets: readonly MediaAsset[];
  disabled: boolean;
}>();
const emit = defineEmits<{
  command: [
    command: TimelineCommand,
    referencedAssets: MediaAsset[],
    complete: (accepted: boolean) => void,
  ];
}>();
const { t } = useI18n();
type TemplateId = GraphicSceneTemplateRecord["templateId"];
const graphemeSegmenter = new Intl.Segmenter("und", {
  granularity: "grapheme",
});
const selectedTemplate = ref<TemplateId>("conversation-card");
const selectedSceneId = ref("");
const start = ref(0);
const sceneDuration = ref(Math.min(8, props.duration));
const messages = ref<ConversationCardMessage[]>([
  {
    id: "message-1",
    speaker: "",
    text: "",
    start: 0,
    end: Math.min(8, props.duration),
  },
]);
const routeText = ref("");
const waypointText = ref("");
const importedRoute = ref<ParsedGpxRoute | null>(null);
const routeFileError = ref("");
const relationship =
  ref<PhotoRelationshipTemplateRecord["data"]["relationship"]>("focus-reveal");
const photoIds = ref<string[]>([""]);
const focalPoints = ref<Array<{ x: number; y: number }>>([{ x: 0.5, y: 0.5 }]);
const protectedRegions = ref<
  Array<{ x: number; y: number; width: number; height: number } | undefined>
>([undefined]);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const photoCatalogBusy = ref(false);
const photoCatalogLoaded = ref(false);
const photoCatalogError = ref(false);
const photoPageSize = 200;
const photoPageOffset = ref(0);
const photoPageCount = ref(0);
const photoTotal = ref(0);
const photoNextCursor = ref<string | null>(null);
const photoPageCursors = new Map<number, string>();
const catalogImages = ref<MediaAsset[]>([]);
const selectedCatalogPhotos = ref<MediaAsset[]>([]);
let photoCatalogGeneration = 0;
const motionEnabled = ref(true);
const motionDuration = ref(0.4);
const motionEasing = ref<GraphicEasing>("ease-out");
const imageAssets = computed(() =>
  [
    ...new Map(
      [...catalogImages.value, ...selectedCatalogPhotos.value].map((asset) => [
        asset.id,
        asset,
      ]),
    ).values(),
  ].filter((asset) => asset.mediaType === "image" && !asset.state.rejected),
);
const existing = computed(() =>
  props.records.find((record) => record.sceneId === selectedSceneId.value),
);
const sceneForRecord = (record: GraphicSceneTemplateRecord | undefined) =>
  props.scenes.find((scene) => scene.id === record?.sceneId);
const editingScene = computed(() => sceneForRecord(existing.value));
const frame = computed(() => ({ width: props.width, height: props.height }));
const templateOptions: { id: TemplateId; key: string }[] = [
  { id: "conversation-card", key: "conversation" },
  { id: "route-story", key: "route" },
  { id: "photo-relationship", key: "photos" },
];

function copySource(
  source: ConversationSourceRecord,
): ConversationSourceRecord {
  return {
    originalText: source.originalText,
    citation: source.citation,
    attribution: source.attribution,
    ...(source.excerpt
      ? { excerpt: { start: source.excerpt.start, end: source.excerpt.end } }
      : {}),
  };
}

function node(scene: GraphicScene, id: string) {
  return scene.nodes.find((item) => item.id === id);
}
function loadRecord(record: GraphicSceneTemplateRecord | undefined) {
  error.value = "";
  notice.value = "";
  importedRoute.value = null;
  routeFileError.value = "";
  if (!record) {
    start.value = 0;
    sceneDuration.value = Math.min(8, props.duration);
    messages.value = [
      {
        id: "message-1",
        speaker: "",
        text: "",
        start: 0,
        end: sceneDuration.value,
      },
    ];
    routeText.value = "";
    waypointText.value = "";
    relationship.value = "focus-reveal";
    photoIds.value = [imageAssets.value[0]?.id ?? ""];
    focalPoints.value = [{ x: 0.5, y: 0.5 }];
    protectedRegions.value = [undefined];
    motionEnabled.value = true;
    motionDuration.value = 0.4;
    motionEasing.value = "ease-out";
    return;
  }
  selectedTemplate.value = record.templateId;
  const scene = sceneForRecord(record);
  if (scene) {
    start.value = scene.start;
    sceneDuration.value = scene.duration;
    const animated = scene.nodes
      .flatMap((item) => (item.type === "group" ? item.children : [item]))
      .find((item) => item.animation?.enter);
    motionEnabled.value = !!animated?.animation?.enter;
    motionDuration.value = animated?.animation?.enter?.duration ?? 0.4;
    motionEasing.value = animated?.animation?.enter?.easing ?? "ease-out";
  }
  if (record.templateId === "conversation-card") {
    messages.value = record.data.messages.map((binding) => {
      const speaker = scene ? node(scene, binding.speakerNodeId) : undefined;
      const text = scene ? node(scene, binding.textNodeId) : undefined;
      return {
        id: binding.id,
        speaker: speaker?.type === "text" ? speaker.text : "",
        text: text?.type === "text" ? text.text : "",
        start: text?.start ?? 0,
        end: text?.end ?? sceneDuration.value,
        ...(binding.source ? { source: copySource(binding.source) } : {}),
      };
    });
  } else if (record.templateId === "route-story") {
    routeText.value = record.data.points
      .map((point) => `${point.latitude},${point.longitude}`)
      .join("\n");
    waypointText.value = record.data.waypoints
      .map(
        (waypoint) =>
          `${waypoint.label},${waypoint.latitude},${waypoint.longitude}`,
      )
      .join("\n");
    if (record.data.source.kind === "gpx") {
      importedRoute.value = {
        fileName: record.data.source.fileName,
        sha256: record.data.source.sha256,
        ...(record.data.source.trackName
          ? { trackName: record.data.source.trackName }
          : {}),
        points: record.data.points.map(({ latitude, longitude }) => ({
          latitude,
          longitude,
        })),
        waypoints: record.data.waypoints.map(
          ({ label, latitude, longitude }) => ({ label, latitude, longitude }),
        ),
      };
    }
  } else {
    relationship.value = record.data.relationship;
    photoIds.value = record.data.photos.map((photo) => photo.assetId);
    focalPoints.value = record.data.photos.map(
      (photo) => photo.layout.focalPoint ?? { x: 0.5, y: 0.5 },
    );
    protectedRegions.value = record.data.photos.map(
      (photo) => photo.layout.protectedRegion,
    );
  }
}
watch(
  () => props.records,
  (records) => {
    if (!records.length) return;
    if (!records.some((record) => record.sceneId === selectedSceneId.value)) {
      const preferred =
        records.find(
          (record) => record.templateId === selectedTemplate.value,
        ) ?? records[0]!;
      selectedSceneId.value = preferred.sceneId;
      loadRecord(preferred);
    }
  },
  { immediate: true },
);
watch(selectedSceneId, (id) => {
  const record = props.records.find((item) => item.sceneId === id);
  if (record) loadRecord(record);
});
watch(selectedTemplate, (template) => {
  if (existing.value?.templateId !== template) selectedSceneId.value = "";
  if (!selectedSceneId.value) loadRecord(undefined);
  if (template === "photo-relationship" && !photoCatalogLoaded.value)
    void loadPhotoCatalog();
});
watch(
  () => [props.width, props.height, props.duration, props.locale] as const,
  () => {
    if (!existing.value && sceneDuration.value > props.duration)
      sceneDuration.value = props.duration;
  },
  { immediate: true },
);

async function loadPhotoCatalog(offset = 0) {
  if (photoCatalogBusy.value || (offset > 0 && !photoPageCursors.has(offset)))
    return;
  const generation = ++photoCatalogGeneration;
  photoCatalogBusy.value = true;
  photoCatalogError.value = false;
  try {
    const query = new URLSearchParams({
      mediaType: "image",
      limit: String(photoPageSize),
      cursorMode: "keyset",
    });
    const cursor = offset > 0 ? photoPageCursors.get(offset) : undefined;
    if (cursor) query.set("cursor", cursor);
    const page = await api.assets(query);
    if (generation !== photoCatalogGeneration) return;
    catalogImages.value = page.assets;
    photoPageOffset.value = offset;
    photoPageCount.value = page.assets.length;
    photoTotal.value = page.total;
    photoNextCursor.value = page.nextCursor ?? null;
    const nextOffset = offset + photoPageSize;
    if (page.nextCursor) photoPageCursors.set(nextOffset, page.nextCursor);
    else photoPageCursors.delete(nextOffset);
    photoCatalogLoaded.value = true;
    if (page.assets.length === 0 && photoIds.value.length)
      photoIds.value[0] = "";
    if (
      photoIds.value.length &&
      !photoIds.value[0] &&
      page.assets.some((asset) => !asset.state.rejected)
    )
      photoIds.value[0] =
        page.assets.find((asset) => !asset.state.rejected)?.id ?? "";
  } catch {
    if (generation === photoCatalogGeneration) photoCatalogError.value = true;
  } finally {
    if (generation === photoCatalogGeneration) photoCatalogBusy.value = false;
  }
}

function loadNextPhotoPage() {
  if (photoNextCursor.value)
    void loadPhotoCatalog(photoPageOffset.value + photoPageSize);
}

function loadPreviousPhotoPage() {
  if (photoPageOffset.value > 0)
    void loadPhotoCatalog(Math.max(0, photoPageOffset.value - photoPageSize));
}

function retainSelectedPhotos() {
  const selectedIds = [...new Set(photoIds.value.filter(Boolean))];
  selectedCatalogPhotos.value = selectedIds.flatMap((assetId) => {
    const asset =
      catalogImages.value.find((candidate) => candidate.id === assetId) ??
      selectedCatalogPhotos.value.find(
        (candidate) => candidate.id === assetId,
      ) ??
      props.assets.find((candidate) => candidate.id === assetId);
    return asset && asset.mediaType === "image" ? [asset] : [];
  });
}

watch(
  [() => photoIds.value.join("\u0000"), () => catalogImages.value],
  retainSelectedPhotos,
  { immediate: true },
);

onBeforeUnmount(() => {
  photoCatalogGeneration++;
});

function addMessage() {
  if (messages.value.length >= 4) return;
  messages.value.push({
    id: `message-${crypto.randomUUID()}`,
    speaker: "",
    text: "",
    start: 0,
    end: sceneDuration.value,
  });
}
function removeMessage(index: number) {
  if (messages.value.length <= 1) return;
  messages.value.splice(index, 1);
}
function moveMessage(index: number, offset: -1 | 1) {
  const destination = index + offset;
  if (destination < 0 || destination >= messages.value.length) return;
  const [message] = messages.value.splice(index, 1);
  if (message) messages.value.splice(destination, 0, message);
}
function setSource(message: ConversationCardMessage, enabled: boolean) {
  if (enabled) {
    message.source ??= {
      originalText: message.text,
      citation: "",
      attribution: "quoted",
    };
  } else delete message.source;
}
function graphemeBoundaries(text: string): number[] {
  const boundaries = [0];
  for (const part of graphemeSegmenter.segment(text))
    boundaries.push(part.index + part.segment.length);
  return boundaries;
}
function graphemeCount(text: string) {
  return graphemeBoundaries(text).length - 1;
}
function graphemeIndexAtOffset(text: string, offset: number) {
  const boundaries = graphemeBoundaries(text);
  let index = 0;
  while (index < boundaries.length - 1 && boundaries[index + 1]! <= offset)
    index++;
  return index;
}
function offsetAtGraphemeIndex(text: string, index: number) {
  const boundaries = graphemeBoundaries(text);
  const bounded = Math.max(
    0,
    Math.min(Math.floor(index), boundaries.length - 1),
  );
  return boundaries[bounded]!;
}
function excerptFieldIndex(
  message: ConversationCardMessage,
  edge: "start" | "end",
) {
  const source = message.source;
  if (!source) return 0;
  const offset =
    source.excerpt?.[edge] ??
    (edge === "start" ? 0 : source.originalText.length);
  return graphemeIndexAtOffset(source.originalText, offset);
}
function setAttribution(
  message: ConversationCardMessage,
  attribution: "quoted" | "excerpt" | "adapted",
) {
  const source = message.source;
  if (!source) return;
  source.attribution = attribution;
  delete source.excerpt;
  if (attribution === "quoted") {
    message.text = source.originalText;
  } else if (attribution === "excerpt") {
    const count = graphemeCount(source.originalText);
    if (count < 2) {
      source.attribution = "quoted";
      return;
    }
    const end = offsetAtGraphemeIndex(source.originalText, count - 1);
    source.excerpt = { start: 0, end };
    message.text = source.originalText.slice(0, end);
  }
}
function syncSourceText(message: ConversationCardMessage) {
  const source = message.source;
  if (!source || source.attribution === "adapted") return;
  if (source.attribution === "quoted") {
    message.text = source.originalText;
    return;
  }
  const count = graphemeCount(source.originalText);
  if (count < 2) {
    source.attribution = "quoted";
    delete source.excerpt;
    message.text = source.originalText;
    return;
  }
  const startIndex = Math.min(
    graphemeIndexAtOffset(source.originalText, source.excerpt?.start ?? 0),
    count - 1,
  );
  const endIndex = Math.max(
    startIndex + 1,
    Math.min(
      graphemeIndexAtOffset(
        source.originalText,
        source.excerpt?.end ?? source.originalText.length,
      ),
      count,
    ),
  );
  const start = offsetAtGraphemeIndex(source.originalText, startIndex);
  const end = offsetAtGraphemeIndex(source.originalText, endIndex);
  source.excerpt = { start, end };
  message.text = source.originalText.slice(start, end);
}
function updateExcerptRange(
  message: ConversationCardMessage,
  edge: "start" | "end",
  value: number,
) {
  const source = message.source;
  if (!source || source.attribution !== "excerpt") return;
  const count = graphemeCount(source.originalText);
  if (count < 2) {
    source.attribution = "quoted";
    delete source.excerpt;
    message.text = source.originalText;
    return;
  }
  const currentStart = excerptFieldIndex(message, "start");
  const currentEnd = excerptFieldIndex(message, "end");
  const requested = Number.isFinite(value) ? Math.floor(value) : 0;
  const startIndex =
    edge === "start"
      ? Math.max(0, Math.min(requested, count - 1))
      : currentStart;
  const endIndex =
    edge === "end"
      ? Math.max(startIndex + 1, Math.min(requested, count))
      : Math.max(startIndex + 1, Math.min(currentEnd, count));
  const start = offsetAtGraphemeIndex(source.originalText, startIndex);
  const end = offsetAtGraphemeIndex(source.originalText, endIndex);
  source.excerpt = { start, end };
  message.text = source.originalText.slice(start, end);
}
function adaptSourceLabel(message: ConversationCardMessage) {
  const source = message.source;
  if (!source || source.attribution === "adapted") return;
  const attributedText =
    source.attribution === "quoted"
      ? source.originalText
      : source.originalText.slice(
          source.excerpt?.start ?? 0,
          source.excerpt?.end ?? 0,
        );
  if (message.text !== attributedText) {
    source.attribution = "adapted";
    delete source.excerpt;
  }
}
function parseManualRoute() {
  const parsePoints = (raw: string): GpxCoordinate[] =>
    raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const fields = line.split(",").map((part) => part.trim());
        const latitude = Number(fields[0]);
        const longitude = Number(fields[1]);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
          throw new Error(t("editor.templates.routeFormatError"));
        return { latitude, longitude };
      });
  const waypoints: GpxWaypoint[] = waypointText.value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(",").map((part) => part.trim());
      const latitude = Number(fields[1]);
      const longitude = Number(fields[2]);
      if (
        !fields[0] ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      )
        throw new Error(t("editor.templates.routeFormatError"));
      return { label: fields[0], latitude, longitude };
    });
  return { points: parsePoints(routeText.value), waypoints };
}
async function importGpx(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  busy.value = true;
  routeFileError.value = "";
  try {
    if (file.size > GRAPHIC_SCENE_TEMPLATE_LIMITS.gpxBytes)
      throw new Error(t("editor.templates.gpxTooLarge"));
    const route = await parseGpxRoute(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
    );
    importedRoute.value = route;
    routeText.value = route.points
      .map((point) => `${point.latitude},${point.longitude}`)
      .join("\n");
    waypointText.value = route.waypoints
      .map((point) => `${point.label},${point.latitude},${point.longitude}`)
      .join("\n");
    notice.value = t("editor.templates.gpxLoaded", {
      count: route.points.length,
      hash: route.sha256.slice(0, 12),
    });
  } catch (cause) {
    routeFileError.value =
      cause instanceof Error ? cause.message : t("editor.templates.gpxFailed");
    importedRoute.value = null;
  } finally {
    busy.value = false;
    input.value = "";
  }
}
function write(
  scene: GraphicScene,
  templateRecord: GraphicSceneTemplateRecord,
) {
  const referencedAssets =
    templateRecord.templateId === "photo-relationship"
      ? templateRecord.data.photos.flatMap((photo) => {
          const asset = imageAssets.value.find(
            (item) => item.id === photo.assetId,
          );
          return asset ? [asset] : [];
        })
      : [];
  emit(
    "command",
    { type: "graphic.scene.upsert", scene, templateRecord },
    referencedAssets,
    (accepted) => {
      if (!accepted) {
        notice.value = "";
        error.value = t("editor.templates.commandRejected");
        return;
      }
      selectedSceneId.value = scene.id;
      notice.value = t("editor.templates.saved");
      error.value = "";
    },
  );
}
function configureMotion(scene: GraphicScene): GraphicScene {
  const next = structuredClone(scene);
  const visit = (items: import("@openfilm/core").GraphicNode[]) => {
    for (const item of items) {
      if (item.type === "group") {
        visit(item.children);
        continue;
      }
      if (!motionEnabled.value) {
        if (item.animation) {
          delete item.animation.enter;
          if (!item.animation.exit) delete item.animation;
        }
        continue;
      }
      const maximum = item.end - item.start;
      const duration = Math.max(0.01, Math.min(motionDuration.value, maximum));
      item.animation ??= {};
      item.animation.enter ??= {
        duration,
        easing: motionEasing.value,
        from: { opacity: 0 },
      };
      item.animation.enter.duration = duration;
      item.animation.enter.easing = motionEasing.value;
    }
  };
  visit(next.nodes);
  return next;
}
function saveConversation() {
  const sceneId = editingScene.value?.id ?? crypto.randomUUID();
  try {
    const values = messages.value.map((message) => {
      return {
        id: message.id,
        speaker: message.speaker,
        text: message.text,
        start: message.start,
        end: message.end,
        ...(message.source ? { source: copySource(message.source) } : {}),
      };
    });
    const result = createConversationCard({
      sceneId,
      start: start.value,
      duration: sceneDuration.value,
      frame: frame.value,
      locale: props.locale,
      messages: values,
    });
    write(configureMotion(result.scene), result.record);
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : t("editor.templates.invalid");
  }
}
function saveRoute() {
  const sceneId = editingScene.value?.id ?? crypto.randomUUID();
  try {
    const manual = parseManualRoute();
    const sameCoordinates = (
      left: readonly GpxCoordinate[],
      right: readonly GpxCoordinate[],
    ) =>
      left.length === right.length &&
      left.every(
        (point, index) =>
          point.latitude === right[index]!.latitude &&
          point.longitude === right[index]!.longitude,
      );
    const sameWaypoints = (
      left: readonly GpxWaypoint[],
      right: readonly GpxWaypoint[],
    ) =>
      left.length === right.length &&
      left.every(
        (point, index) =>
          point.label === right[index]!.label &&
          point.latitude === right[index]!.latitude &&
          point.longitude === right[index]!.longitude,
      );
    const sameGeometry =
      importedRoute.value &&
      sameCoordinates(manual.points, importedRoute.value.points) &&
      sameWaypoints(manual.waypoints, importedRoute.value.waypoints);
    const route = sameGeometry
      ? {
          ...importedRoute.value!,
          points: manual.points,
          waypoints: manual.waypoints,
        }
      : { kind: "manual" as const, ...manual };
    const result = createRouteStory({
      sceneId,
      start: start.value,
      duration: sceneDuration.value,
      frame: frame.value,
      locale: props.locale,
      route,
    });
    write(configureMotion(result.scene), result.record);
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : t("editor.templates.invalid");
  }
}
function setPhotoCount(count: number) {
  const current = photoIds.value;
  photoIds.value = Array.from(
    { length: count },
    (_, index) => current[index] ?? imageAssets.value[index]?.id ?? "",
  );
  focalPoints.value = Array.from(
    { length: count },
    (_, index) => focalPoints.value[index] ?? { x: 0.5, y: 0.5 },
  );
  protectedRegions.value = Array.from(
    { length: count },
    (_, index) => protectedRegions.value[index],
  );
}
function setProtected(index: number, enabled: boolean) {
  if (!enabled) {
    protectedRegions.value[index] = undefined;
    return;
  }
  const focus = focalPoints.value[index] ?? { x: 0.5, y: 0.5 };
  protectedRegions.value[index] = {
    x: Math.min(0.8, Math.max(0, focus.x - 0.1)),
    y: Math.min(0.8, Math.max(0, focus.y - 0.1)),
    width: 0.2,
    height: 0.2,
  };
}
watch(relationship, (value) => setPhotoCount(value === "focus-reveal" ? 1 : 2));
function savePhotos() {
  const sceneId = editingScene.value?.id ?? crypto.randomUUID();
  try {
    const photos = photoIds.value.map((assetId, index) => {
      const asset = imageAssets.value.find((item) => item.id === assetId);
      if (!asset) throw new Error(t("editor.templates.photoRequired"));
      return {
        assetId,
        ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
        focalPoint: { ...focalPoints.value[index]! },
        ...(protectedRegions.value[index]
          ? { protectedRegion: { ...protectedRegions.value[index]! } }
          : {}),
      };
    });
    const result = createPhotoRelationship({
      sceneId,
      start: start.value,
      duration: sceneDuration.value,
      frame: frame.value,
      locale: props.locale,
      relationship: relationship.value,
      photos,
    });
    write(configureMotion(result.scene), result.record);
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : t("editor.templates.invalid");
  }
}
function selectRecord(event: Event) {
  selectedSceneId.value = (event.target as HTMLSelectElement).value;
}
</script>

<template>
  <section
    class="editor-inspector-section graphic-template-studio"
    aria-labelledby="template-studio-heading"
  >
    <div class="editor-inspector-title">
      <h3 id="template-studio-heading">{{ t("editor.templates.heading") }}</h3>
      <p>{{ t("editor.templates.description") }}</p>
    </div>
    <div
      class="template-gallery"
      role="group"
      :aria-label="t('editor.templates.gallery')"
    >
      <button
        v-for="option in templateOptions"
        :key="option.id"
        type="button"
        class="editor-button"
        :class="{ selected: selectedTemplate === option.id }"
        :aria-pressed="selectedTemplate === option.id"
        :disabled="disabled"
        @click="selectedTemplate = option.id"
      >
        {{ t(`editor.templates.${option.key}`) }}
      </button>
    </div>
    <label
      v-if="records.some((record) => record.templateId === selectedTemplate)"
      class="template-field"
    >
      {{ t("editor.templates.savedScene") }}
      <select
        :value="
          existing?.templateId === selectedTemplate ? selectedSceneId : ''
        "
        @change="selectRecord"
      >
        <option value="">{{ t("editor.templates.newScene") }}</option>
        <option
          v-for="record in records.filter(
            (item) => item.templateId === selectedTemplate,
          )"
          :key="record.sceneId"
          :value="record.sceneId"
        >
          {{
            scenes.find((item) => item.id === record.sceneId)?.name ??
            record.sceneId
          }}
        </option>
      </select>
    </label>
    <div class="template-grid">
      <label class="template-field"
        >{{ t("editor.graphics.start") }}
        <input
          v-model.number="start"
          type="number"
          min="0"
          :max="Math.max(0, duration - 0.1)"
          step="0.1"
          :disabled="disabled"
        />
      </label>
      <label class="template-field"
        >{{ t("editor.graphics.duration") }}
        <input
          v-model.number="sceneDuration"
          type="number"
          min="0.1"
          :max="Math.min(30, duration - start)"
          step="0.1"
          :disabled="disabled"
        />
      </label>
    </div>
    <div class="template-grid template-motion">
      <label class="template-field template-source-toggle">
        <input v-model="motionEnabled" type="checkbox" :disabled="disabled" />
        {{ t("editor.templates.animate") }}
      </label>
      <label class="template-field"
        >{{ t("editor.graphics.enter") }}
        <input
          v-model.number="motionDuration"
          type="number"
          min="0.01"
          max="3"
          step="0.05"
          :disabled="disabled || !motionEnabled"
        />
      </label>
      <label class="template-field"
        >{{ t("editor.graphics.easing") }}
        <select v-model="motionEasing" :disabled="disabled || !motionEnabled">
          <option value="linear">{{ t("editor.graphics.linear") }}</option>
          <option value="ease-in">{{ t("editor.graphics.ease-in") }}</option>
          <option value="ease-out">{{ t("editor.graphics.ease-out") }}</option>
          <option value="ease-in-out">
            {{ t("editor.graphics.ease-in-out") }}
          </option>
        </select>
      </label>
    </div>
    <p class="template-help">{{ t("editor.templates.safeArea") }}</p>

    <template v-if="selectedTemplate === 'conversation-card'">
      <article
        v-for="(message, index) in messages"
        :key="message.id"
        class="template-card"
      >
        <header>
          <strong>{{
            t("editor.templates.message", { number: index + 1 })
          }}</strong>
          <button
            type="button"
            class="editor-button"
            :aria-label="t('editor.templates.moveMessageUp')"
            :disabled="disabled || index === 0"
            @click="moveMessage(index, -1)"
          >
            ↑ {{ t("editor.templates.moveMessageUp") }}
          </button>
          <button
            type="button"
            class="editor-button"
            :aria-label="t('editor.templates.moveMessageDown')"
            :disabled="disabled || index === messages.length - 1"
            @click="moveMessage(index, 1)"
          >
            ↓ {{ t("editor.templates.moveMessageDown") }}
          </button>
          <button
            v-if="messages.length > 1"
            type="button"
            class="editor-button"
            :disabled="disabled"
            @click="removeMessage(index)"
          >
            {{ t("editor.templates.removeMessage") }}
          </button>
        </header>
        <label class="template-field"
          >{{ t("editor.templates.speaker")
          }}<input
            v-model="message.speaker"
            maxlength="128"
            :disabled="disabled"
        /></label>
        <label class="template-field"
          >{{ t("editor.templates.messageText")
          }}<textarea
            v-model="message.text"
            maxlength="512"
            rows="3"
            :disabled="disabled"
            @input="adaptSourceLabel(message)"
          />
        </label>
        <div class="template-grid">
          <label class="template-field"
            >{{ t("editor.graphics.start")
            }}<input
              v-model.number="message.start"
              type="number"
              min="0"
              :max="sceneDuration"
              step="0.1"
              :disabled="disabled"
          /></label>
          <label class="template-field"
            >{{ t("editor.graphics.end")
            }}<input
              v-model.number="message.end"
              type="number"
              min="0.1"
              :max="sceneDuration"
              step="0.1"
              :disabled="disabled"
          /></label>
        </div>
        <label class="template-field template-source-toggle">
          <input
            type="checkbox"
            :checked="!!message.source"
            :disabled="disabled"
            @change="
              setSource(message, ($event.target as HTMLInputElement).checked)
            "
          />
          {{ t("editor.templates.retainSource") }}
        </label>
        <details v-if="message.source" open>
          <summary>{{ t("editor.templates.sourceDetails") }}</summary>
          <label class="template-field"
            >{{ t("editor.templates.originalText")
            }}<textarea
              v-model="message.source.originalText"
              maxlength="16384"
              rows="3"
              :disabled="disabled"
              @input="syncSourceText(message)"
            />
          </label>
          <label class="template-field"
            >{{ t("editor.templates.sourceAttribution")
            }}<select
              :value="message.source.attribution"
              :disabled="disabled"
              @change="
                setAttribution(
                  message,
                  ($event.target as HTMLSelectElement).value as
                    'quoted' | 'excerpt' | 'adapted',
                )
              "
            >
              <option value="quoted">{{ t("editor.templates.quoted") }}</option>
              <option
                value="excerpt"
                :disabled="graphemeCount(message.source.originalText) < 2"
              >
                {{ t("editor.templates.excerpt") }}
              </option>
              <option value="adapted">
                {{ t("editor.templates.adapted") }}
              </option>
            </select>
          </label>
          <div
            v-if="message.source.attribution === 'excerpt'"
            class="template-grid"
          >
            <label class="template-field"
              >{{ t("editor.templates.excerptStart")
              }}<input
                :value="excerptFieldIndex(message, 'start')"
                type="number"
                min="0"
                :max="
                  Math.max(0, graphemeCount(message.source.originalText) - 1)
                "
                step="1"
                :disabled="disabled"
                @input="
                  updateExcerptRange(
                    message,
                    'start',
                    Number(($event.target as HTMLInputElement).value),
                  )
                "
            /></label>
            <label class="template-field"
              >{{ t("editor.templates.excerptEnd")
              }}<input
                :value="excerptFieldIndex(message, 'end')"
                type="number"
                :min="excerptFieldIndex(message, 'start') + 1"
                :max="graphemeCount(message.source.originalText)"
                step="1"
                :disabled="disabled"
                @input="
                  updateExcerptRange(
                    message,
                    'end',
                    Number(($event.target as HTMLInputElement).value),
                  )
                "
            /></label>
          </div>
          <label class="template-field"
            >{{ t("editor.templates.citation")
            }}<input
              v-model="message.source.citation"
              maxlength="256"
              :disabled="disabled"
          /></label>
          <p class="template-help">
            {{ t("editor.templates.sourceRetained") }}
          </p>
        </details>
      </article>
      <button
        v-if="messages.length < 4"
        type="button"
        class="editor-button"
        :disabled="disabled"
        @click="addMessage"
      >
        {{ t("editor.templates.addMessage") }}
      </button>
      <button
        type="button"
        class="editor-button editor-button-primary"
        :disabled="disabled"
        @click="saveConversation"
      >
        {{ t("editor.templates.save") }}
      </button>
    </template>

    <template v-else-if="selectedTemplate === 'route-story'">
      <label class="template-field"
        >{{ t("editor.templates.importGpx") }}
        <input
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          :disabled="disabled || busy"
          @change="importGpx"
        />
      </label>
      <p class="template-help">{{ t("editor.templates.gpxSafety") }}</p>
      <p v-if="importedRoute" class="template-notice">
        {{
          t("editor.templates.gpxIdentity", {
            file: importedRoute.fileName,
            hash: importedRoute.sha256,
          })
        }}
      </p>
      <label class="template-field"
        >{{ t("editor.templates.routePoints")
        }}<textarea
          v-model="routeText"
          rows="4"
          :disabled="disabled || busy"
          :placeholder="t('editor.templates.routeFormat')"
        />
      </label>
      <label class="template-field"
        >{{ t("editor.templates.waypoints")
        }}<textarea
          v-model="waypointText"
          rows="2"
          :disabled="disabled || busy"
          :placeholder="t('editor.templates.waypointFormat')"
        />
      </label>
      <p v-if="routeFileError" role="alert" class="template-error">
        {{ routeFileError }}
      </p>
      <button
        type="button"
        class="editor-button editor-button-primary"
        :disabled="disabled || busy"
        @click="saveRoute"
      >
        {{ t("editor.templates.save") }}
      </button>
    </template>

    <template v-else>
      <label class="template-field"
        >{{ t("editor.templates.relationship") }}
        <select v-model="relationship" :disabled="disabled">
          <option value="focus-reveal">
            {{ t("editor.templates.focusReveal") }}
          </option>
          <option value="compare">{{ t("editor.templates.compare") }}</option>
          <option value="bookends">{{ t("editor.templates.bookends") }}</option>
        </select>
      </label>
      <p v-if="photoCatalogError" class="template-error" role="alert">
        {{ t("editor.templates.photoCatalogFailed") }}
        <button
          type="button"
          class="editor-button"
          :disabled="photoCatalogBusy"
          @click="loadPhotoCatalog(0)"
        >
          {{ t("editor.graphics.retry") }}
        </button>
      </p>
      <p v-else-if="photoCatalogBusy" role="status" class="template-help">
        {{ t("editor.templates.loadingPhotos") }}
      </p>
      <p v-else-if="!imageAssets.length" class="template-help">
        {{ t("editor.templates.noPhotos") }}
      </p>
      <div
        v-if="photoTotal > photoPageSize"
        role="group"
        :aria-label="t('editor.templates.photoCatalogPages')"
        class="template-photo-pages"
      >
        <button
          type="button"
          class="editor-button"
          :disabled="disabled || photoCatalogBusy || photoPageOffset === 0"
          @click="loadPreviousPhotoPage"
        >
          {{ t("editor.templates.previousPhotos") }}
        </button>
        <span role="status">
          {{
            t("editor.templates.photoCatalogPage", {
              from: photoPageCount ? photoPageOffset + 1 : 0,
              to: Math.min(photoPageOffset + photoPageCount, photoTotal),
              total: photoTotal,
            })
          }}
        </span>
        <button
          type="button"
          class="editor-button"
          :disabled="disabled || photoCatalogBusy || !photoNextCursor"
          @click="loadNextPhotoPage"
        >
          {{ t("editor.templates.nextPhotos") }}
        </button>
      </div>
      <fieldset
        v-for="(_assetId, index) in photoIds"
        :key="index"
        class="template-card"
      >
        <legend>
          {{ t("editor.templates.photo", { number: index + 1 }) }}
        </legend>
        <label class="template-field"
          >{{ t("editor.templates.replacePhoto") }}
          <select
            v-model="photoIds[index]"
            :disabled="disabled || photoCatalogBusy"
          >
            <option value="">{{ t("editor.templates.choosePhoto") }}</option>
            <option
              v-for="asset in imageAssets"
              :key="asset.id"
              :value="asset.id"
            >
              {{ asset.name }}
            </option>
          </select>
        </label>
        <div class="template-grid">
          <label class="template-field"
            >{{ t("editor.presentation.focalX")
            }}<input
              v-model.number="focalPoints[index]!.x"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :disabled="disabled"
          /></label>
          <label class="template-field"
            >{{ t("editor.presentation.focalY")
            }}<input
              v-model.number="focalPoints[index]!.y"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :disabled="disabled"
          /></label>
        </div>
        <label class="template-field template-source-toggle">
          <input
            type="checkbox"
            :checked="!!protectedRegions[index]"
            :disabled="disabled"
            @change="
              setProtected(index, ($event.target as HTMLInputElement).checked)
            "
          />
          {{ t("editor.templates.protectFocus") }}
        </label>
        <div v-if="protectedRegions[index]" class="template-grid">
          <label class="template-field"
            >{{ t("editor.templates.regionX")
            }}<input
              v-model.number="protectedRegions[index]!.x"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :disabled="disabled"
          /></label>
          <label class="template-field"
            >{{ t("editor.templates.regionY")
            }}<input
              v-model.number="protectedRegions[index]!.y"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :disabled="disabled"
          /></label>
          <label class="template-field"
            >{{ t("editor.templates.regionWidth")
            }}<input
              v-model.number="protectedRegions[index]!.width"
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              :disabled="disabled"
          /></label>
          <label class="template-field"
            >{{ t("editor.templates.regionHeight")
            }}<input
              v-model.number="protectedRegions[index]!.height"
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              :disabled="disabled"
          /></label>
        </div>
        <p class="template-help">
          {{ t("editor.templates.protectedRegionHint") }}
        </p>
      </fieldset>
      <button
        type="button"
        class="editor-button editor-button-primary"
        :disabled="disabled || photoCatalogBusy || !imageAssets.length"
        @click="savePhotos"
      >
        {{ t("editor.templates.save") }}
      </button>
    </template>
    <p v-if="error" role="alert" class="template-error">{{ error }}</p>
    <p v-else-if="notice" role="status" class="template-notice">{{ notice }}</p>
  </section>
</template>

<style scoped>
.graphic-template-studio {
  display: grid;
  gap: var(--space-3, 12px);
}
.template-gallery,
.template-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2, 8px);
}
.template-gallery {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.template-gallery .editor-button {
  min-height: 48px;
  white-space: normal;
}
.template-photo-pages {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2, 8px);
}
.template-field {
  display: grid;
  gap: var(--space-1, 4px);
  min-width: 0;
  font-size: var(--font-size-sm, 0.875rem);
}
.template-field input,
.template-field textarea,
.template-field select {
  width: 100%;
  min-width: 0;
}
.template-field textarea {
  resize: vertical;
}
.template-source-toggle {
  display: flex;
  align-items: center;
}
.template-card {
  display: grid;
  gap: var(--space-2, 8px);
  margin: 0;
  padding: var(--space-3, 12px);
  border: 1px solid var(--color-border, #454a55);
  border-radius: var(--radius-md, 8px);
}
.template-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.template-help,
.template-notice,
.template-error {
  margin: 0;
  color: var(--color-text-muted, #b7beca);
  font-size: var(--font-size-sm, 0.875rem);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.template-error {
  color: var(--color-danger, #df655e);
}
.template-notice {
  color: var(--color-success, #64bd96);
}
summary {
  cursor: pointer;
  padding: 6px 0;
}
@media (max-width: 480px) {
  .template-gallery {
    grid-template-columns: 1fr;
  }
}
</style>
