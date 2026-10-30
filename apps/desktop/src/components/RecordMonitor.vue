<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-26. See LICENSE/NOTICE.
import {
  computed,
  onBeforeUnmount,
  shallowReactive,
  shallowRef,
  useId,
  watch,
} from "vue";
import {
  assetDisplayDimensions,
  evaluateAudioGain,
  primaryEditFrames,
  resolveClipFrameRange,
  resolveClipSourceRange,
  resolveCompositionFrame,
  resolveFilmLook,
  resolvePrimaryColor,
  resolvePreviewClipGeometry,
  resolveProjectTimebase,
  sequenceTimeAt,
  timebaseKey,
  timebaseRate,
  type Clip,
  type Composition,
  type MediaAsset,
  type ProjectSettings,
  type ResolvedSequenceClip,
} from "@openfilm/core";
import { sourceUrl, titlePreviewUrl, type SourceStatus } from "../api";
import { useRecordTransport } from "../composables/useRecordTransport";
import PhotoPresentationPreview from "./PhotoPresentationPreview.vue";
import NativeTitlePreview from "./NativeTitlePreview.vue";
import NativeCaptionPreview from "./NativeCaptionPreview.vue";
import GraphicScenePreview from "./GraphicScenePreview.vue";
import PrimaryColorFilter from "./PrimaryColorFilter.vue";
import { sourceColorStyle } from "../source-color";
import FilmLookFilter from "./FilmLookFilter.vue";

const props = defineProps<{
  projectId: string;
  composition: Composition;
  assets: readonly MediaAsset[];
  revision: string;
  settings: ProjectSettings;
  sourceStatuses?: Record<string, SourceStatus>;
  sourceVersion?: number;
  active: boolean;
  /** Diagnostic preview only. Never enters media ownership or saved state. */
  bypassLook?: boolean;
  captionTrackId?: string | null;
}>();
type IssueCode =
  | "record.not-ready"
  | "record.source-missing"
  | "record.source-inaccessible"
  | "record.decode-failed"
  | "record.invalid-composition"
  | "record.audio-gain-unavailable";
interface MonitorIssue {
  code: IssueCode;
  clipId?: string;
  assetId?: string;
  trackId?: string;
  requestedGain?: number;
  frame: number;
  ownerKey: string;
}
const emit = defineEmits<{
  frame: [frame: number];
  playing: [playing: boolean];
  selectClip: [clipId: string];
  split: [split: { clipId: string; sourceTime: number }];
  issue: [issue: MonitorIssue];
}>();
const timebase = computed(() => resolveProjectTimebase(props.settings));
const ownerKey = computed(() =>
  JSON.stringify([
    props.projectId,
    props.composition.id,
    props.revision,
    timebaseKey(timebase.value),
  ]),
);
// Availability generations do not own the clock: only this owner's play intent
// may survive a reconnect. Every generation gets fresh DOM event targets.
const assetGeneration = shallowRef(0);
watch(
  () => props.assets.map((asset) => [asset.id, asset.uri]),
  () => {
    assetGeneration.value++;
  },
  { flush: "sync" },
);
const resourceOwner = computed(() =>
  JSON.stringify([
    ownerKey.value,
    props.sourceVersion ?? 0,
    assetGeneration.value,
  ]),
);
const transport = useRecordTransport({
  composition: () => props.composition,
  timebase,
  active: () => props.active,
  ownerKey,
});
const resolved = shallowRef<ReturnType<typeof resolveCompositionFrame>>();
interface Resource {
  key: string;
  owner: string;
  entry: ResolvedSequenceClip;
  element: HTMLMediaElement | HTMLImageElement | null;
  ready: boolean;
  failed: boolean;
  running: boolean;
  playGeneration: number;
}
const pictures = new Map<string, Resource>();
const sounds = new Map<string, Resource>();
const banks = shallowRef<Resource[]>([]);
const layers = shallowRef<Resource[]>([]);
const audible = shallowRef<Resource[]>([]);
const primaryFilterId = `record-primary-${useId().replaceAll(":", "")}`;
const filterId = `record-look-${useId().replaceAll(":", "")}`;
let disposed = false;
let reconciling = false;
type ReconcileCause = "clock" | "command" | "lifecycle";
let queuedReconcile:
  | {
      owner: string;
      frame: number;
      crossing: boolean;
      force: boolean;
      cause: ReconcileCause;
    }
  | undefined;
let lastPublication: { owner: string; frame: number } | undefined;
let previousFrame = 0;
let explicitSeek = false;
const graphicSeekGeneration = shallowRef(0);
let lastIssue = "";
const gainIssues = new Set<string>();

function id(entry: ResolvedSequenceClip) {
  return `${entry.trackIndex}:${entry.clipIndex}:${entry.clip.id}`;
}
function mediaKey(entry: ResolvedSequenceClip) {
  return `${resourceOwner.value}:${id(entry)}:${props.sourceStatuses?.[entry.asset.id]?.status ?? "available"}`;
}
function media(resource: Resource): HTMLMediaElement | undefined {
  return resource.entry.asset.mediaType !== "image"
    ? (resource.element as HTMLMediaElement | undefined)
    : undefined;
}
function release(resource: Resource) {
  const element = media(resource);
  if (element) {
    element.pause();
    element.muted = true;
    element.removeAttribute?.("src");
    element.load?.();
  }
  resource.element = null;
  resource.running = false;
  resource.playGeneration++;
}
function clearResources() {
  for (const resource of [...pictures.values(), ...sounds.values()])
    release(resource);
  pictures.clear();
  sounds.clear();
  banks.value = [];
  layers.value = [];
  audible.value = [];
}
function resourceFor(
  entry: ResolvedSequenceClip,
  collection = pictures,
): Resource {
  const key = mediaKey(entry);
  let resource = collection.get(key);
  if (!resource) {
    resource = shallowReactive({
      key,
      owner: resourceOwner.value,
      entry,
      element: null,
      ready: false,
      failed: false,
      running: false,
      playGeneration: 0,
    });
    collection.set(key, resource);
  } else resource.entry = entry;
  return resource;
}
function valid(resource: Resource, event?: Event) {
  return (
    !disposed &&
    props.active &&
    resource.owner === resourceOwner.value &&
    resource.key === mediaKey(resource.entry) &&
    (pictures.get(resource.key) === resource ||
      sounds.get(resource.key) === resource) &&
    (!event || event.currentTarget === resource.element)
  );
}
function availability(entry: ResolvedSequenceClip): IssueCode | undefined {
  const status = props.sourceStatuses?.[entry.asset.id]?.status;
  return status === "missing"
    ? "record.source-missing"
    : status === "inaccessible"
      ? "record.source-inaccessible"
      : undefined;
}
function issueFor(entry: ResolvedSequenceClip): IssueCode | undefined {
  const unavailable = availability(entry);
  if (unavailable) return unavailable;
  const resource = pictures.get(mediaKey(entry));
  return resource?.failed
    ? "record.decode-failed"
    : !resource?.ready
      ? "record.not-ready"
      : undefined;
}
function publishIssue(code: IssueCode, entry?: ResolvedSequenceClip) {
  const key = `${resourceOwner.value}:${code}:${entry ? id(entry) : ""}`;
  if (key === lastIssue || disposed) return;
  lastIssue = key;
  emit("issue", {
    code,
    clipId: entry?.clip.id,
    assetId: entry?.asset.id,
    frame: transport.frame.value,
    ownerKey: ownerKey.value,
  });
}
function resolve(frame: number) {
  return resolveCompositionFrame(
    props.composition,
    props.assets,
    frame,
    timebase.value,
  );
}
const edits = computed(() =>
  primaryEditFrames(props.composition, timebase.value),
);
function nextPrimary(frame: number, current?: ResolvedSequenceClip) {
  for (const edit of edits.value) {
    if (edit <= frame) continue;
    const next = resolve(edit).primary;
    if (next && (!current || id(next) !== id(current))) return next;
  }
}
function trim(collection: Map<string, Resource>, retained: Resource[]) {
  const keys = new Set(retained.map((resource) => resource.key));
  for (const [key, resource] of collection)
    if (!keys.has(key)) {
      release(resource);
      collection.delete(key);
    }
}
function reconcile(
  requested = transport.frame.value,
  crossing = false,
  force = false,
  cause: ReconcileCause = "lifecycle",
  nested = false,
) {
  if (disposed) return;
  const owner = resourceOwner.value;
  if (reconciling) {
    const previous = queuedReconcile;
    const sameTarget =
      previous?.owner === owner && previous.frame === requested;
    // A same-target media callback cannot erase a queued position command.
    queuedReconcile = {
      owner,
      frame: requested,
      crossing: crossing || (sameTarget && previous.crossing),
      force: force || (sameTarget && previous.force),
      cause: sameTarget && previous.cause === "command" ? "command" : cause,
    };
    return;
  }
  reconciling = true;
  try {
    if (!props.active) {
      clearResources();
      return;
    }
    let frame = requested;
    if (crossing && transport.playing.value && !force) {
      const boundaries =
        transport.shuttleRate.value > 0
          ? edits.value.filter(
              (edit) => edit > previousFrame && edit <= requested,
            )
          : edits.value
              .filter((edit) => edit <= previousFrame && edit > requested)
              .reverse()
              .map((edit) => edit - 1);
      for (const boundary of boundaries) {
        const primary = resolve(boundary).primary;
        if (primary && issueFor(primary)) {
          frame = boundary;
          break;
        }
      }
    }
    if (frame !== requested) {
      transport.buffering.value = true;
      transport.seek(frame);
    }
    const result = resolve(frame);
    const primary = result.primary;
    const next = nextPrimary(frame, primary);
    banks.value = [primary, next]
      .filter((entry): entry is ResolvedSequenceClip => !!entry)
      .map((entry) => resourceFor(entry));
    layers.value = result.visual.map((entry) => resourceFor(entry));
    // Updating an outgoing tail must not overwrite the current bank's exact time.
    trim(pictures, [...banks.value, ...layers.value]);
    audible.value = result.audible
      .filter((entry) => !availability(entry))
      .map((entry) => resourceFor(entry, sounds));
    trim(sounds, audible.value);
    resolved.value = result;
    const issue = primary ? issueFor(primary) : undefined;
    transport.buffering.value = issue !== undefined;
    if (issue) {
      if (issue !== "record.not-ready") transport.pause();
      publishIssue(issue, primary);
    } else lastIssue = "";
    if (disposed || owner !== resourceOwner.value) return;
    previousFrame = frame;
    syncMedia(force);
    // Readiness/media lifecycle is not a sequence-position publication. An
    // external command may republish an unchanged frame, but its nested echo
    // and the native callbacks caused by its resync must stay silent.
    if (
      lastPublication?.owner !== owner ||
      lastPublication.frame !== frame ||
      (cause === "command" && !nested)
    ) {
      lastPublication = { owner, frame };
      emit("frame", frame);
    }
  } catch {
    transport.pause();
    transport.buffering.value = true;
    clearResources();
    resolved.value = undefined;
    publishIssue("record.invalid-composition");
  } finally {
    reconciling = false;
    const queued = queuedReconcile;
    queuedReconcile = undefined;
    if (queued)
      reconcile(
        queued.frame,
        queued.crossing,
        queued.force,
        queued.cause,
        true,
      );
  }
}
const forward = computed(
  () =>
    props.active &&
    transport.playing.value &&
    transport.shuttleRate.value > 0 &&
    !transport.buffering.value,
);
function syncPosition(resource: Resource, force: boolean) {
  const element = media(resource);
  if (!element) return;
  const frameRate = resource.entry.asset.frameRate;
  // Without reliable source metadata only explicit operations can resync.
  const tolerance =
    frameRate && Number.isFinite(frameRate) && frameRate > 0
      ? 0.5 / frameRate
      : Infinity;
  if (
    force ||
    Math.abs(element.currentTime - resource.entry.sourceTime) > tolerance
  )
    element.currentTime = resource.entry.sourceTime;
}
function run(resource: Resource, running: boolean) {
  const element = media(resource);
  if (!element) return;
  running = running && !exhausted(resource.entry);
  element.muted = !running || pictures.get(resource.key) === resource;
  if (running) {
    element.playbackRate =
      (resource.entry.clip.transform?.speed ?? 1) * transport.shuttleRate.value;
    if (!resource.running) {
      resource.running = true;
      const owner = resource.owner;
      const generation = ++resource.playGeneration;
      void element.play?.()?.catch(() => {
        if (
          owner === resourceOwner.value &&
          valid(resource) &&
          resource.running &&
          generation === resource.playGeneration
        ) {
          resource.failed = true;
          transport.pause();
          publishIssue("record.decode-failed", resource.entry);
        }
      });
    }
  } else {
    resource.running = false;
    resource.playGeneration++;
    element.pause();
  }
}
function exhausted(entry: ResolvedSequenceClip) {
  return (
    entry.sourceTime >=
    resolveClipSourceRange(entry.clip, entry.asset).sourceOut
  );
}
function syncMedia(force = false) {
  for (const resource of pictures.values()) {
    syncPosition(resource, force);
    const active =
      layers.value.includes(resource) &&
      resource.ready &&
      resource.entry.localTime < resource.entry.clip.timelineDuration;
    run(resource, forward.value && active);
  }
  for (const resource of audible.value) {
    const element = media(resource);
    if (!element) continue;
    syncPosition(resource, force);
    const entry = resource.entry;
    const gain =
      (entry.clip.transform?.volume ?? 1) *
      evaluateAudioGain(
        entry.clip.audioAutomation,
        entry.localTime,
        entry.clip.timelineDuration,
      );
    if (!Number.isFinite(gain) || gain < 0) {
      run(resource, false);
      publishIssue("record.invalid-composition", entry);
      continue;
    }
    element.volume = Math.min(1, gain);
    if (gain > 1 && !gainIssues.has(resource.key)) {
      gainIssues.add(resource.key);
      emit("issue", {
        code: "record.audio-gain-unavailable",
        clipId: entry.clip.id,
        assetId: entry.asset.id,
        trackId: entry.trackId,
        requestedGain: gain,
        frame: transport.frame.value,
        ownerKey: ownerKey.value,
      });
    }
    run(resource, forward.value && !resource.failed);
  }
}
function bind(resource: Resource, element: unknown) {
  if (!element || disposed || resource.owner !== resourceOwner.value) return;
  if (resource.element === element) return;
  resource.element = element as Resource["element"];
  syncPosition(resource, true);
  syncMedia();
}
function ready(resource: Resource, event: Event) {
  if (!valid(resource, event)) return;
  resource.ready = true;
  resource.failed = false;
  // Native canplay also follows a seek. Do not turn a satisfied seek into
  // another seek/readiness cycle; retain the reliable half-frame tolerance.
  syncPosition(resource, false);
  reconcile();
}
function failed(resource: Resource, event: Event) {
  if (!valid(resource, event)) return;
  resource.ready = false;
  resource.failed = true;
  if (banks.value[0] === resource) reconcile();
  else if (sounds.get(resource.key) === resource) {
    run(resource, false);
    publishIssue("record.decode-failed", resource.entry);
  }
}
function waiting(resource: Resource, event: Event) {
  if (!valid(resource, event)) return;
  resource.ready = false;
  if (banks.value[0] === resource) reconcile();
}
function photoReadiness(
  resource: Resource,
  status: { ready: boolean; failed: boolean },
) {
  if (!valid(resource)) return;
  resource.ready = status.ready;
  resource.failed = status.failed;
  if (banks.value[0] === resource) reconcile();
  else if (status.failed) publishIssue("record.decode-failed", resource.entry);
}
function timeupdate(resource: Resource, event: Event) {
  if (!valid(resource, event)) return;
  // Media never owns sequence time; it may only correct its own source drift.
  syncPosition(resource, false);
}
const pictureResources = computed(() => [
  ...layers.value,
  ...banks.value.filter((resource) => !layers.value.includes(resource)),
]);
// The saved clip index remains the resource identity. FFmpeg composites each
// track chronologically, with original array order breaking equal-start ties.
const compositeOrder = computed(
  () =>
    new Map(
      props.composition.tracks
        .flatMap((track, trackIndex) =>
          track.clips
            .map((clip, clipIndex) => ({ clip, clipIndex }))
            .sort(
              (a, b) =>
                a.clip.timelineStart - b.clip.timelineStart ||
                a.clipIndex - b.clipIndex,
            )
            .map(
              ({ clip, clipIndex }) => `${trackIndex}:${clipIndex}:${clip.id}`,
            ),
        )
        .map((key, index) => [key, index]),
    ),
);
function shown(resource: Resource) {
  return (
    layers.value.includes(resource) &&
    resource.ready &&
    !availability(resource.entry)
  );
}
function bankRole(resource: Resource) {
  const index = banks.value.indexOf(resource);
  return index < 0 ? undefined : index === 0 ? "current" : "next";
}
function geometry(resource: Resource) {
  const entry = resource.entry;
  const geometry = resolvePreviewClipGeometry(
    entry.clip.transform,
    assetDisplayDimensions(entry.asset) ?? props.settings,
    props.settings,
    props.settings,
  );
  const look = resolveFilmLook(props.composition, entry.clip).look;
  return {
    width: `${(geometry.media.width / props.settings.width) * 100}%`,
    height: `${(geometry.media.height / props.settings.height) * 100}%`,
    transform: `translate(${(geometry.x / geometry.media.width) * 100}%, ${(geometry.y / geometry.media.height) * 100}%) rotate(${geometry.rotation}deg) scale(${geometry.scale})`,
    ...sourceColorStyle(
      resolvePrimaryColor(props.composition, entry.clip).correction,
      look,
      {
        primary: `${primaryFilterId}-${entry.trackIndex}-${entry.clipIndex}`,
        look: `${filterId}-${entry.trackIndex}-${entry.clipIndex}`,
      },
      props.bypassLook,
    ),
  };
}
const titles = computed(() => {
  if (!resolved.value) return [];
  return props.composition.tracks.flatMap((track, trackIndex) =>
    track.type !== "titles"
      ? []
      : track.clips.flatMap((clip, clipIndex) => {
          const range = resolveClipFrameRange(clip, timebase.value);
          if (
            resolved.value!.frame < range.startFrame ||
            resolved.value!.frame >= range.endFrame
          )
            return [];
          // Presentation-only normalization makes the existing title evaluator consume
          // Composition-local seconds even when a title has no backing media asset.
          return [
            {
              key: `${trackIndex}:${clipIndex}:${clip.id}`,
              clip: titleClip(clip),
              time: sequenceTimeAt(
                resolved.value!.frame - range.startFrame,
                timebase.value,
              ),
            },
          ];
        }),
  );
});
function titleClip(clip: Clip): Clip {
  return { ...clip, sourceIn: 0, transform: { ...clip.transform, speed: 1 } };
}
function positionCommand(command: () => void) {
  if (disposed) return;
  // A discontinuous position command owns an exact new texture request, even
  // while positive transport intent continues. Retire the sampled request.
  graphicSeekGeneration.value++;
  explicitSeek = true;
  const frame = transport.frame.value;
  try {
    command();
    if (transport.frame.value === frame)
      reconcile(frame, false, true, "command");
  } finally {
    explicitSeek = false;
  }
}
function seek(frame: number) {
  positionCommand(() => transport.seek(frame));
}
function step(direction: -1 | 1, seconds = false) {
  positionCommand(() => transport.step(direction, seconds));
}
function previousEdit() {
  positionCommand(transport.previousEdit);
}
function nextEdit() {
  positionCommand(transport.nextEdit);
}
function split() {
  const entry = resolved.value?.primary;
  if (!disposed && entry)
    emit("split", { clipId: entry.clip.id, sourceTime: entry.sourceTime });
}
function select(resource: Resource) {
  if (valid(resource) && shown(resource))
    emit("selectClip", resource.entry.clip.id);
}
watch(
  resourceOwner,
  () => {
    clearResources();
    gainIssues.clear();
    reconcile();
  },
  { flush: "sync", immediate: true },
);
watch(
  () => props.sourceStatuses,
  () => reconcile(),
  { flush: "sync", deep: true },
);
watch(
  () => transport.frame.value,
  (frame) =>
    reconcile(frame, true, explicitSeek, explicitSeek ? "command" : "clock"),
  { flush: "sync" },
);
watch(
  () => props.active,
  () => reconcile(),
  { flush: "sync" },
);
watch(
  [transport.playing, transport.shuttleRate, transport.buffering],
  () => {
    syncMedia();
    emit("playing", transport.playing.value);
  },
  { flush: "sync" },
);
function dispose() {
  if (disposed) return;
  disposed = true;
  transport.dispose();
  clearResources();
}
onBeforeUnmount(dispose);
defineExpose({
  ...transport,
  seek,
  step,
  previousEdit,
  nextEdit,
  split,
  dispose,
});
</script>

<template>
  <div
    class="record-monitor"
    :data-frame="resolved?.frame"
    :aria-busy="transport.buffering.value"
  >
    <div
      class="record-frame"
      :style="{ aspectRatio: `${settings.width} / ${settings.height}` }"
    >
      <div class="record-canvas">
        <div
          v-for="resource in pictureResources"
          :key="resource.key"
          class="record-layer"
          :data-record-layer="
            layers.includes(resource) ? resource.entry.clip.id : undefined
          "
          :style="{
            opacity: resource.entry.opacity,
            visibility: shown(resource) ? 'visible' : 'hidden',
            zIndex: compositeOrder.get(id(resource.entry)),
          }"
          @click="select(resource)"
        >
          <PrimaryColorFilter
            :id="`${primaryFilterId}-${resource.entry.trackIndex}-${resource.entry.clipIndex}`"
            :correction="
              resolvePrimaryColor(composition, resource.entry.clip).correction
            "
          />
          <FilmLookFilter
            :id="`${filterId}-${resource.entry.trackIndex}-${resource.entry.clipIndex}`"
            :look="resolveFilmLook(composition, resource.entry.clip).look"
          />
          <video
            v-if="resource.entry.asset.mediaType !== 'image'"
            :ref="(element) => bind(resource, element)"
            :data-bank="bankRole(resource)"
            :data-clip-id="resource.entry.clip.id"
            crossorigin="anonymous"
            :src="
              availability(resource.entry)
                ? undefined
                : sourceUrl(resource.entry.asset.id, resource.key)
            "
            preload="auto"
            muted
            playsinline
            :style="geometry(resource)"
            @canplay="ready(resource, $event)"
            @loadedmetadata="timeupdate(resource, $event)"
            @waiting="waiting(resource, $event)"
            @stalled="waiting(resource, $event)"
            @timeupdate="timeupdate(resource, $event)"
            @error="failed(resource, $event)"
          />
          <template v-else>
            <PhotoPresentationPreview
              :data-bank="bankRole(resource)"
              :data-clip-id="resource.entry.clip.id"
              :clip="resource.entry.clip"
              :assets="assets"
              :frame="settings"
              :viewport="settings"
              transport-target=""
              :composition-id="composition.id"
              :project-id="projectId"
              :revision="revision"
              :source-version="sourceVersion"
              :active="active"
              :primary-color="
                resolvePrimaryColor(composition, resource.entry.clip).correction
              "
              :look="
                bypassLook
                  ? undefined
                  : resolveFilmLook(composition, resource.entry.clip).look
              "
              :external-time="resource.entry.localTime"
              :external-playing="forward"
              @readiness="photoReadiness(resource, $event)"
            />
          </template>
          <NativeTitlePreview
            v-if="
              resource.entry.asset.mediaType !== 'image' &&
              resource.entry.clip.title &&
              layers.includes(resource)
            "
            class="record-title"
            :clip="titleClip(resource.entry.clip)"
            :source-time="resource.entry.localTime"
            :src="
              titlePreviewUrl(
                composition.id,
                resource.entry.clip.id,
                revision,
                projectId,
              )
            "
          />
        </div>
        <NativeTitlePreview
          v-for="title in titles"
          :key="`${resourceOwner}:${title.key}`"
          class="record-title record-standalone-title"
          :clip="title.clip"
          :source-time="title.time"
          :src="
            titlePreviewUrl(composition.id, title.clip.id, revision, projectId)
          "
        />
        <GraphicScenePreview
          v-if="composition.graphicScenes?.length && resolved"
          :key="`${resourceOwner}:${graphicSeekGeneration}`"
          :composition-id="composition.id"
          :project-id="projectId"
          :revision="revision"
          :source-version="sourceVersion"
          :time="resolved.time"
          :frame-rate="timebaseRate(timebase)"
          :duration="composition.duration"
          :active="active"
          :playing="forward"
          :scenes="composition.graphicScenes"
        />
        <NativeCaptionPreview
          v-if="composition.captionTracks?.length"
          :composition="composition"
          :composition-id="composition.id"
          :project-id="projectId"
          :revision="revision"
          :frame="transport.frame.value"
          :frame-rate="timebaseRate(timebase)"
          :caption-track-id="captionTrackId"
          :frame-width="settings.width"
          :frame-height="settings.height"
          :active="active"
        />
      </div>
    </div>
    <audio
      v-for="resource in audible"
      :key="resource.key"
      :ref="(element) => bind(resource, element)"
      :data-clip-id="resource.entry.clip.id"
      crossorigin="anonymous"
      :src="sourceUrl(resource.entry.asset.id, resource.key)"
      preload="auto"
      :muted="!forward || exhausted(resource.entry) || resource.failed"
      @canplay="ready(resource, $event)"
      @timeupdate="timeupdate(resource, $event)"
      @error="failed(resource, $event)"
    />
  </div>
</template>

<style scoped>
.record-frame {
  position: relative;
  overflow: hidden;
  background: #000;
}
.record-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.record-layer,
.record-title {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.record-layer > video {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  object-fit: contain;
}
.record-title {
  object-fit: contain;
  pointer-events: none;
}
.record-standalone-title {
  z-index: 100000000;
}
.record-canvas :deep(.graphic-preview-root) {
  z-index: 100000001;
}
.record-canvas :deep(.native-caption-layer) {
  z-index: 100000002;
}
</style>
