<script setup lang="ts">
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  useId,
} from "vue";
import {
  resolveClipGeometry,
  resolveFilmLook,
  resolvePreviewClipGeometry,
  evaluateAudioGain,
  type Clip,
  type CaptionTrack,
  type FrameSize,
  type Job,
  type ProjectSettings,
  type StoryBeat,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  prepareShorteningPlan,
  shorteningCommands,
  type EditorDocument,
  type PreparedShorteningPlan,
  type ShorteningSuggestionPreview,
  type TimelineCommand,
} from "@openfilm/solver";
import {
  sourceUrl,
  thumbnailUrl,
  titlePreviewUrl,
  type EditorState,
  type SourceStatus,
} from "../api";
import { useTimelineEditor } from "../composables/useTimelineEditor";
import { api } from "../api";
import Icon from "./Icon.vue";
import TimelineClip from "./TimelineClip.vue";
import SourceDetails from "./SourceDetails.vue";
import PrecisionEditor from "./PrecisionEditor.vue";
import TranscriptEditor from "./TranscriptEditor.vue";
import GraphicSceneInspector from "./GraphicSceneInspector.vue";
import GraphicScenePreview from "./GraphicScenePreview.vue";
import PhotoPresentationPreview from "./PhotoPresentationPreview.vue";
import NativeTitlePreview from "./NativeTitlePreview.vue";
import PhotoPresentationInspector from "./PhotoPresentationInspector.vue";
import FilmLookInspector from "./FilmLookInspector.vue";
import FilmLookFilter from "./FilmLookFilter.vue";
import SceneDirectionReview from "./SceneDirectionReview.vue";
import SoundtrackPanel from "./SoundtrackPanel.vue";
import { sourcePresentation } from "../sourcePresentation";
import { useI18n } from "vue-i18n";
import {
  formatDuration as duration,
  formatNumber,
  formatDate,
  localizeError,
} from "../i18n";
import { durationStatus } from "../duration";
import { clipControls, shorteningAction } from "../editorPresentation";
import { nativeBenchmark } from "../nativeBenchmark";
import {
  clampFrameStep,
  formatTimecode,
  frameGuideRect,
  mapFramePixelOffsetToViewport,
  nextStableWorkspaceHeight,
  playbackBoundaryAction,
  restartTimeAtClipBoundary,
  roundFrameDimensions,
} from "../monitor";
const { t } = useI18n();

const props = defineProps<{
  projectId: string;
  compositionId: string;
  active: boolean;
  sourceStatuses?: Record<string, SourceStatus>;
  sourceVersion?: number;
  previewVisible?: boolean;
  jobs?: readonly Job[];
  analysisRecovery?: Record<string, import("../api").AnalysisJobRecoveryState>;
  recoveringAnalysisJobs?: Record<string, boolean>;
  projectSettings: ProjectSettings;
}>();
const emit = defineEmits<{
  change: [state: EditorState];
  edited: [];
  playback: [];
  relink: [assetId: string];
  activity: [];
  recoverAnalysis: [job: Job, input: import("../api").AnalysisRecoveryInput];
}>();
const {
  state,
  status,
  message,
  messageDetail,
  reportError,
  reportNotice,
  hasPending: compositionHasPending,
  historyBusy: compositionHistoryBusy,
  command: compositionCommand,
  flush: flushComposition,
  history: compositionHistory,
  reapplyDraft,
  addNativeCaptionTrack,
  discardDraft,
  downloadDraft,
  load,
} = useTimelineEditor(
  props.projectId,
  props.compositionId,
  (value) => emit("change", value),
  () => emit("edited"),
);
const transcriptEditor = ref<InstanceType<typeof TranscriptEditor> | null>(
  null,
);
const precisionEditor = ref<InstanceType<typeof PrecisionEditor> | null>(null);
const directionReview = ref<InstanceType<typeof SceneDirectionReview> | null>(
  null,
);
const directionPending = computed(() => !!directionReview.value?.hasPending);
const directionBlocked = computed(() => !!directionReview.value?.blocksEdits);
const historyBusy = computed(
  () => compositionHistoryBusy.value || directionBlocked.value,
);
const directionPreview = ref<Clip | null>(null);
function command(input: TimelineCommand | TimelineCommand[]) {
  if (directionBlocked.value) return false;
  directionPreview.value = null;
  return compositionCommand(input);
}
const hasPending = computed(
  () =>
    compositionHasPending.value ||
    !!transcriptEditor.value?.hasPending ||
    !!precisionEditor.value?.hasPending ||
    directionPending.value,
);
async function history(direction: "undo" | "redo") {
  if (precisionEditor.value?.hasPending || directionBlocked.value) return false;
  return compositionHistory(direction);
}
async function flushInputs() {
  if (!(await flushComposition())) return false;
  if (transcriptEditor.value && !(await transcriptEditor.value.flush()))
    return false;
  return (await precisionEditor.value?.flush()) ?? true;
}
async function flush() {
  if (directionPending.value) return false;
  if (!(await flushInputs())) return false;
  return (await directionReview.value?.flush()) ?? true;
}
async function reloadDirectionState() {
  await load();
  return status.value === "saved";
}
defineExpose({ flush, hasPending, reload: load });
const selectedClipId = ref("");
const selectedBeatId = ref("");
const inspector = ref<"clip" | "beat" | "sound" | "captions" | "graphics">(
  "clip",
);
const selectedCaptionTrackId = ref("");
const selectedCaptionCueId = ref("");
const captionSourceTrackId = ref("");
const captionImporting = ref(false);
const captionImportError = ref("");
let captionImportGeneration = 0;
let captionImportController: AbortController | undefined;
const photoPlayer = ref<InstanceType<typeof PhotoPresentationPreview> | null>(
  null,
);
const editMode = ref<"story" | "precision" | "transcript">("story");
let nativeEditGeneration = 0;
let nativeEditDisposed = false;
let nativeEditReadyForVisit = false;
let cancelNativeEditReady: (() => void) | undefined;
const showFit = ref(false);
const inspectorOpen = ref(true);
const editorElement = ref<HTMLElement | null>(null);
const workspaceElement = ref<HTMLElement | null>(null);
const sourceScreenElement = ref<HTMLElement | null>(null);
const sourceViewport = ref<FrameSize>({ width: 1, height: 1 });
const sourcePreviewSize = ref<FrameSize>();
const sourceTime = ref(0);
const monitorFrameRate = computed(
  () => playbackAsset.value?.frameRate ?? props.projectSettings.frameRate,
);
const loopClip = ref(false);
const showRuleOfThirds = ref(false);
const showSafeFrame = ref(false);
const monitorAspect = ref<"landscape" | "vertical" | "square">("landscape");
let playbackBoundaryHandled = false;
const precisionElement = ref<HTMLElement | null>(null);
const transcriptElement = ref<HTMLElement | null>(null);
async function setEditMode(mode: "story" | "precision" | "transcript") {
  if (mode === editMode.value || !(await flush())) return;
  editMode.value = mode;
}
const workspaceHeight = ref<number>();
let layoutObserver: ResizeObserver | undefined;
let layoutFrame = 0;
const skippedClipIds = ref<string[]>([]);
// Reviewed command plans must remain plain data: their validation clones the
// exact commands, and a deep Vue ref would turn them into uncloneable proxies.
const fitPreview = shallowRef<ShorteningSuggestionPreview | null>(null);
const draftAction = ref<"discard" | "reapply" | null>(null);
const draftConfirmation = ref<HTMLElement | null>(null);
let draftTrigger: HTMLElement | null = null;
const draggedClipId = ref("");
const replacementId = ref("");
const sourcePlayer = ref<HTMLMediaElement | null>(null);
const sourceError = ref("");
const titlePreviewFailed = ref(false);
const titlePreviewRetry = ref(0);
const unsupportedSpeedMessage = "speed";
const playing = ref(false);
const clipFields = ref({
  sourceIn: 0,
  sourceOut: 0,
  duration: 0,
  speed: 1,
  volume: 1,
  scale: 1,
  rotation: 0,
  x: 0,
  y: 0,
  transitionDuration: 0.3,
});
const beatFields = ref({
  title: "",
  intent: "",
  targetDuration: 0,
  minDuration: 0,
  maxDuration: 0,
});
const allClips = computed(
  () => state.value?.composition.tracks.flatMap((track) => track.clips) ?? [],
);
const captionTracks = computed(
  () => state.value?.composition.captionTracks ?? [],
);
const captionSourceTracks = computed(
  () =>
    state.value?.composition.tracks.filter((track) =>
      ["video", "audio", "music"].includes(track.type),
    ) ?? [],
);
const selectedCaptionTrack = computed(() =>
  captionTracks.value.find(
    (track) => track.id === selectedCaptionTrackId.value,
  ),
);
const selectedCaptionCue = computed(() =>
  selectedCaptionTrack.value?.cues.find(
    (cue) => cue.id === selectedCaptionCueId.value,
  ),
);
const captionDuration = computed(() =>
  Math.max(0.001, state.value?.composition.duration ?? 0),
);
watch(
  captionTracks,
  (tracks) => {
    if (!tracks.some((track) => track.id === selectedCaptionTrackId.value))
      selectedCaptionTrackId.value = tracks[0]?.id ?? "";
    if (
      !selectedCaptionTrack.value?.cues.some(
        (cue) => cue.id === selectedCaptionCueId.value,
      )
    )
      selectedCaptionCueId.value = "";
  },
  { immediate: true },
);
watch(
  captionSourceTracks,
  (tracks) => {
    if (!tracks.some((track) => track.id === captionSourceTrackId.value))
      captionSourceTrackId.value = tracks[0]?.id ?? "";
  },
  { immediate: true },
);
// Keep source-picker props stable during selection, playback and Activity updates.
// Composition/assets and translated fallback labels still invalidate the list.
const clipOptions = computed(() =>
  allClips.value.map((clip) => ({ id: clip.id, label: name(clip) })),
);
const selectedClip = computed(() =>
  allClips.value.find((clip) => clip.id === selectedClipId.value),
);
const photoPresentationAllowed = computed(
  () =>
    state.value?.composition.tracks.some(
      (track) =>
        track.type === "video" &&
        track.clips.some((clip) => clip.id === selectedClipId.value),
    ) ?? false,
);
const assetMap = computed(
  () => new Map(state.value?.assets.map((asset) => [asset.id, asset]) ?? []),
);
const selectedAsset = computed(
  () => selectedClip.value && assetMap.value.get(selectedClip.value.assetId),
);
const clipSourceLocked = computed(
  () =>
    !!selectedAsset.value?.state.locked ||
    !!assetMap.value.get(selectedClip.value?.layout?.secondary?.assetId ?? "")
      ?.state.locked,
);
const lockedOverlaySource = computed(
  () =>
    !!selectedAsset.value?.state.locked &&
    !!state.value?.composition.tracks.some(
      (track) =>
        track.timing === "overlay" &&
        track.clips.some((clip) => clip.id === selectedClipId.value),
    ),
);
const playbackAsset = computed(
  () => playbackClip.value && assetMap.value.get(playbackClip.value.assetId),
);
const photoPresentationActive = computed(
  () =>
    playbackAsset.value?.mediaType === "image" &&
    !!(
      playbackClip.value?.layout ||
      playbackClip.value?.motion ||
      (playbackClip.value?.title && playbackClip.value.titleStyle?.fadeOut)
    ),
);
const filmLookFilterId = `film-look-${useId().replaceAll(":", "")}`;
const playbackLook = computed(() =>
  state.value && playbackClip.value && lookEligible.value
    ? resolveFilmLook(state.value.composition, playbackClip.value).look
    : { version: 1 as const, preset: "none" as const, strength: 1 },
);
const playbackLookActive = computed(
  () => playbackLook.value.preset !== "none" && playbackLook.value.strength > 0,
);
const playbackLookStyle = computed(() =>
  playbackLookActive.value ? { filter: `url(#${filmLookFilterId})` } : {},
);
const lookEligible = computed(
  () =>
    !!selectedAsset.value &&
    ["image", "video"].includes(selectedAsset.value.mediaType) &&
    !!state.value?.composition.tracks.some(
      (track) =>
        ["video", "overlay"].includes(track.type) &&
        track.clips.some((clip) => clip.id === selectedClipId.value),
    ),
);
const playbackSourceInfo = computed(() =>
  playbackAsset.value
    ? sourcePresentation(playbackAsset.value, {
        translate: t,
        formatNumber,
        formatDate,
      })
    : undefined,
);
const playbackSourceStatus = computed(() =>
  playbackAsset.value
    ? props.sourceStatuses?.[playbackAsset.value.id]
    : undefined,
);
const playbackUnavailable = computed(
  () =>
    playbackSourceStatus.value &&
    playbackSourceStatus.value.status !== "available",
);
const selectedSourceInfo = computed(() =>
  selectedAsset.value
    ? sourcePresentation(selectedAsset.value, {
        translate: t,
        formatNumber,
        formatDate,
      })
    : undefined,
);
const selectedSourceStatus = computed(() =>
  selectedAsset.value
    ? props.sourceStatuses?.[selectedAsset.value.id]
    : undefined,
);
const sourceUnavailable = computed(
  () =>
    selectedSourceStatus.value &&
    selectedSourceStatus.value.status !== "available",
);
const sourcePlaybackKey = computed(
  () =>
    `${playbackAsset.value?.id}:${playbackAsset.value?.uri}:${props.sourceVersion ?? 0}`,
);
watch(
  [selectedClipId, () => state.value?.revision, () => props.sourceVersion],
  () => {
    directionPreview.value = null;
    titlePreviewFailed.value = false;
  },
);
const selectedBeat = computed(() =>
  state.value?.story.beats.find((beat) => beat.id === selectedBeatId.value),
);
const groups = computed(() => {
  const beats = state.value?.story.beats ?? [];
  const storyClips =
    state.value?.composition.tracks
      .filter(
        (track) =>
          !(
            track.timing === "overlay" &&
            (track.type === "audio" || track.type === "music")
          ),
      )
      .flatMap((track) => track.clips) ?? [];
  const list = beats.map((beat) => ({
    id: beat.id,
    title: beat.title,
    intent: beat.intent,
    clips: storyClips.filter((clip) => clip.beatId === beat.id),
  }));
  const loose = storyClips.filter(
    (clip) => !beats.some((beat) => beat.id === clip.beatId),
  );
  if (loose.length)
    list.push({
      id: "unassigned",
      title: t("editor.otherMoments"),
      intent: undefined,
      clips: loose,
    });
  return list;
});
const peers = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return [];
  return (
    state.value?.composition.tracks
      .find((track) => track.clips.some((item) => item.id === clip.id))
      ?.clips.filter((item) => item.beatId === clip.beatId) ?? []
  );
});
const selectedIndex = computed(() =>
  peers.value.findIndex((clip) => clip.id === selectedClipId.value),
);
const target = computed(
  () =>
    state.value?.story.targetDuration ?? state.value?.composition.duration ?? 0,
);
const maximum = computed(() => state.value?.story.maxDuration ?? target.value);
const overLimit = computed(
  () =>
    !!state.value && state.value.composition.duration > maximum.value + 0.001,
);
const fitPlan = computed(() => {
  if (!state.value || !showFit.value || target.value <= 0) return null;
  try {
    return prepareShorteningPlan(
      state.value,
      state.value.assets,
      target.value,
      skippedClipIds.value,
    );
  } catch {
    return null;
  }
});
const fitSuggestions = computed(() => fitPlan.value?.suggestions ?? []);
function applyFit(
  preview: PreparedShorteningPlan | ShorteningSuggestionPreview | null,
) {
  if (!state.value || !preview) return;
  try {
    command(
      shorteningCommands(
        state.value,
        state.value.assets,
        target.value,
        preview,
        skippedClipIds.value,
      ),
    );
  } catch (error) {
    reportError(error);
  }
}
const replacements = computed(
  () =>
    state.value?.assets.filter(
      (asset) =>
        !asset.state.rejected &&
        asset.id !== selectedAsset.value?.id &&
        (selectedAsset.value?.mediaType === "audio"
          ? asset.mediaType === "audio"
          : asset.mediaType !== "audio"),
    ) ?? [],
);
const saveLabel = computed(() => t(`editor.save.${status.value}`));
const regenerateModes = [
  { mode: "regenerate", label: "editor.rhythm.regenerate" },
  { mode: "shorten", label: "editor.rhythm.shorten" },
  { mode: "more-video", label: "editor.rhythm.more-video" },
  { mode: "more-photos", label: "editor.rhythm.more-photos" },
  { mode: "replace-similar", label: "editor.rhythm.replace-similar" },
  { mode: "remove-repetition", label: "editor.rhythm.remove-repetition" },
] as const;
const monitorAspects = [
  { value: "landscape", label: "editor.monitor.landscape", ratio: "16:9" },
  { value: "vertical", label: "editor.monitor.vertical", ratio: "9:16" },
  { value: "square", label: "editor.monitor.square", ratio: "1:1" },
] as const;

function name(clip: Clip) {
  return (
    assetMap.value.get(clip.assetId)?.name ?? clip.title ?? t("editor.media")
  );
}
function beatDuration(clips: Clip[]) {
  return clips.length
    ? Math.max(
        ...clips.map((clip) => clip.timelineStart + clip.timelineDuration),
      ) - Math.min(...clips.map((clip) => clip.timelineStart))
    : 0;
}
function chooseClip(clip: Clip, openInspector = true) {
  if (precisionEditor.value?.hasPending || directionBlocked.value) return;
  if (editMode.value === "transcript" && transcriptEditor.value) {
    void transcriptEditor.value.flush().then((saved) => {
      if (saved) applyClipSelection(clip, openInspector);
    });
    return;
  }
  applyClipSelection(clip, openInspector);
}
function applyClipSelection(clip: Clip, openInspector = true) {
  fitPreview.value = null;
  directionPreview.value = null;
  if (openInspector) inspectorOpen.value = true;
  selectedClipId.value = clip.id;
  selectedBeatId.value = clip.beatId ?? "";
  inspector.value = "clip";
}
function chooseBeat(beatId: string) {
  if (directionBlocked.value) return;
  inspectorOpen.value = true;
  selectedBeatId.value = beatId;
  inspector.value = "beat";
}
function selectCaption(track: CaptionTrack, cueId = "") {
  if (directionBlocked.value) return;
  selectedCaptionTrackId.value = track.id;
  selectedCaptionCueId.value = cueId;
  inspectorOpen.value = true;
  inspector.value = "captions";
}
function addCaptionTrack() {
  const track: CaptionTrack = {
    version: 1,
    id: crypto.randomUUID(),
    name: t("editor.captions.defaultTrack"),
    style: {
      version: 1,
      role: "subtitle",
      fontFamily: "Noto Sans CJK TC",
      fontSize: 32,
      lineHeight: 1.2,
      background: "scrim",
      position: "bottom",
      align: "center",
      safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.12 },
    },
    cues: [],
  };
  if (command({ type: "caption.track.add", track })) selectCaption(track);
}
function addCaptionCue() {
  const track = selectedCaptionTrack.value;
  const durationMs = Math.max(1, Math.round(captionDuration.value * 1000));
  if (!track) return;
  const cue = {
    version: 1 as const,
    id: crypto.randomUUID(),
    startMs: 0,
    endMs: Math.min(2_000, durationMs),
    text: t("editor.captions.defaultCueText"),
    source: { kind: "manual" as const },
    manualRevision: 0,
  };
  if (command({ type: "caption.cue.add", trackId: track.id, cue }))
    selectedCaptionCueId.value = cue.id;
}
function updateCaptionCue(patch: {
  text?: string;
  startMs?: number;
  endMs?: number;
}) {
  const track = selectedCaptionTrack.value;
  const cue = selectedCaptionCue.value;
  if (track && cue)
    command({
      type: "caption.cue.update",
      trackId: track.id,
      cueId: cue.id,
      patch,
    });
}
function deleteCaptionCue() {
  const track = selectedCaptionTrack.value;
  const cue = selectedCaptionCue.value;
  if (!track || !cue) return;
  command({ type: "caption.cue.delete", trackId: track.id, cueId: cue.id });
  selectedCaptionCueId.value = "";
}
function updateCaptionStyle(key: "fontFamily" | "fontSize", event: Event) {
  const track = selectedCaptionTrack.value;
  if (!track) return;
  const target = event.target as HTMLInputElement;
  const value = key === "fontSize" ? Number(target.value) : target.value;
  command({
    type: "caption.track.style",
    trackId: track.id,
    style: { ...track.style, [key]: value },
  });
}
function updateCaptionSafeArea(
  side: "left" | "right" | "top" | "bottom",
  event: Event,
) {
  const track = selectedCaptionTrack.value;
  if (!track) return;
  const target = event.target as HTMLInputElement;
  const safeArea = {
    left: track.style.safeArea?.left ?? 0.08,
    right: track.style.safeArea?.right ?? 0.08,
    top: track.style.safeArea?.top ?? 0.08,
    bottom: track.style.safeArea?.bottom ?? 0.12,
    [side]: Number(target.value) / 100,
  };
  command({
    type: "caption.track.style",
    trackId: track.id,
    style: { ...track.style, safeArea },
  });
}
function locateCaption(track: CaptionTrack, cueId: string) {
  const cue = track.cues.find((item) => item.id === cueId);
  if (!cue) return;
  const startSeconds = cue.startMs / 1000;
  const transcriptClipId =
    cue.source.kind === "transcript" ? cue.source.clipId : undefined;
  const clip =
    (transcriptClipId
      ? allClips.value.find((item) => item.id === transcriptClipId)
      : undefined) ??
    allClips.value.find(
      (item) =>
        startSeconds >= item.timelineStart &&
        startSeconds < item.timelineStart + item.timelineDuration,
    );
  if (!clip) return;
  chooseClip(clip);
  const sourceTarget =
    (clip.sourceIn ?? 0) +
    Math.max(0, startSeconds - clip.timelineStart) *
      (clip.transform?.speed ?? 1);
  sourceTime.value = Math.min(clip.sourceOut ?? sourceTarget, sourceTarget);
  if (sourcePlayer.value) sourcePlayer.value.currentTime = sourceTime.value;
}
async function importNativeCaptions() {
  if (
    captionImporting.value ||
    !captionSourceTrackId.value ||
    !state.value ||
    directionBlocked.value
  )
    return;
  captionImportController?.abort();
  const controller = new AbortController();
  captionImportController = controller;
  const generation = ++captionImportGeneration;
  const projectId = props.projectId;
  const compositionId = state.value.composition.id;
  const current = () =>
    !nativeEditDisposed &&
    !controller.signal.aborted &&
    generation === captionImportGeneration &&
    projectId === props.projectId &&
    compositionId === props.compositionId;
  captionImporting.value = true;
  captionImportError.value = "";
  try {
    if (!(await flush()) || !current()) return;
    const context = await api.captionContext(
      projectId,
      compositionId,
      controller.signal,
    );
    if (!current()) return;
    if (
      context.projectId !== projectId ||
      context.compositionId !== compositionId ||
      !context.revision
    )
      throw new Error("Caption context changed. Retry from the current edit.");
    const snapshot = await api.prepareCaptions(
      {
        projectId,
        compositionId,
        trackId: captionSourceTrackId.value,
        baseRevision: context.revision,
      },
      controller.signal,
    );
    if (!current()) return;
    if (
      snapshot.projectId !== projectId ||
      snapshot.compositionId !== compositionId ||
      snapshot.stale
    )
      throw new Error("Caption preview changed. Retry from the current edit.");
    const trackId = crypto.randomUUID();
    if (
      (await addNativeCaptionTrack(
        {
          projectId,
          snapshotId: snapshot.id,
          name: t("editor.captions.importedTrack"),
          trackId,
          requestId: crypto.randomUUID(),
        },
        controller.signal,
      )) &&
      current()
    ) {
      const track = state.value?.composition.captionTracks?.find(
        (item) => item.id === trackId,
      );
      if (track) selectCaption(track, track.cues[0]?.id ?? "");
    }
  } catch (cause) {
    if (current()) captionImportError.value = localizeError(cause);
  } finally {
    if (generation === captionImportGeneration) captionImporting.value = false;
  }
}
function editClip(
  input:
    | Omit<Extract<TimelineCommand, { type: "trim" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "duration" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "speed" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "volume" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "transform" }>, "clipId">
    | Omit<Extract<TimelineCommand, { type: "transition" }>, "clipId">,
) {
  if (selectedClip.value)
    command({ ...input, clipId: selectedClip.value.id } as TimelineCommand);
}
function trim() {
  editClip({
    type: "trim",
    sourceIn: Number(clipFields.value.sourceIn),
    sourceOut: Number(clipFields.value.sourceOut),
  });
}
function transform() {
  const { scale, rotation, x, y } = clipFields.value;
  editClip({ type: "transform", scale, rotation, x, y });
}
function rotateSelected(degrees: -90 | 90) {
  const { scale, rotation, x, y } = clipFields.value;
  editClip({ type: "transform", scale, rotation: rotation + degrees, x, y });
}
function resetSelectedTransform() {
  clipFields.value = { ...clipFields.value, scale: 1, rotation: 0, x: 0, y: 0 };
  editClip({ type: "transform", scale: 1, rotation: 0, x: 0, y: 0 });
}
function previewNumber(
  value: unknown,
  fallback: number,
  positive = false,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    (!positive || value > 0)
    ? value
    : fallback;
}
const previewGeometry = computed(() => {
  const committed = resolveClipGeometry(selectedClip.value?.transform);
  return resolvePreviewClipGeometry(
    {
      scale: previewNumber(clipFields.value.scale, committed.scale, true),
      rotation: previewNumber(clipFields.value.rotation, committed.rotation),
      x: previewNumber(clipFields.value.x, committed.x),
      y: previewNumber(clipFields.value.y, committed.y),
    },
    sourcePreviewSize.value ??
      selectedAsset.value?.dimensions ??
      props.projectSettings,
    props.projectSettings,
    sourceViewport.value,
  );
});
const monitorAspectRatio = computed(
  () =>
    ({ landscape: 16 / 9, vertical: 9 / 16, square: 1 })[monitorAspect.value],
);
const monitorGuideFrame = computed(() =>
  frameGuideRect(
    sourceViewport.value.width,
    sourceViewport.value.height,
    monitorAspectRatio.value,
  ),
);
const monitorGuideStyle = computed(() => ({
  width: `${monitorGuideFrame.value.width}px`,
  height: `${monitorGuideFrame.value.height}px`,
}));
const previewFrameStyle = computed(() => ({
  width: `${roundFrameDimensions(previewGeometry.value.frame).width}px`,
  height: `${roundFrameDimensions(previewGeometry.value.frame).height}px`,
}));
const previewMediaStyle = computed(() => {
  const geometry = previewGeometry.value;
  const x = mapFramePixelOffsetToViewport(geometry.x, geometry.frame.scale);
  const y = mapFramePixelOffsetToViewport(geometry.y, geometry.frame.scale);
  return {
    width: `${roundFrameDimensions(geometry.media).width}px`,
    height: `${roundFrameDimensions(geometry.media).height}px`,
    transform: `translate3d(${x}px, ${y}px, 0) rotate(${geometry.rotation}deg) scale(${geometry.scale})`,
  };
});
function capturePreviewSize(event: Event) {
  const media = event.currentTarget;
  const width =
    media instanceof HTMLImageElement
      ? media.naturalWidth
      : media instanceof HTMLVideoElement
        ? media.videoWidth
        : 0;
  const height =
    media instanceof HTMLImageElement
      ? media.naturalHeight
      : media instanceof HTMLVideoElement
        ? media.videoHeight
        : 0;
  if (width > 0 && height > 0) sourcePreviewSize.value = { width, height };
}
function transition(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  editClip({
    type: "transition",
    transition: value === "crossfade" ? "crossfade" : "cut",
    duration: clipFields.value.transitionDuration,
  });
}
function move(direction: number) {
  if (selectedClip.value)
    command({
      type: "reorder",
      clipId: selectedClip.value.id,
      toIndex: selectedIndex.value + direction,
    });
}
function startClipDrag(clipId: string) {
  draggedClipId.value = clipId;
}
function endClipDrag() {
  draggedClipId.value = "";
}
function drop(targetClip: Clip) {
  const dragged = allClips.value.find(
    (clip) => clip.id === draggedClipId.value,
  );
  const track = state.value?.composition.tracks.find((item) =>
    item.clips.some((clip) => clip.id === targetClip.id),
  );
  if (
    dragged &&
    dragged.beatId === targetClip.beatId &&
    track?.clips.some((clip) => clip.id === dragged.id)
  ) {
    command({
      type: "reorder",
      clipId: dragged.id,
      toIndex: track.clips
        .filter((clip) => clip.beatId === targetClip.beatId)
        .findIndex((clip) => clip.id === targetClip.id),
    });
  } else reportNotice("editor.moveWithinBeat");
  draggedClipId.value = "";
}
function deleteSelected() {
  if (selectedClip.value)
    command({ type: "delete", clipId: selectedClip.value.id });
}
function editBeat() {
  if (!selectedBeat.value) return;
  const fields = {
    ...beatFields.value,
    targetDuration: Number(beatFields.value.targetDuration),
    minDuration: Number(beatFields.value.minDuration),
    maxDuration: Number(beatFields.value.maxDuration),
  };
  const before = beatValues(selectedBeat.value);
  const patch = Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) => value !== before[key as keyof typeof before],
    ),
  );
  if (Object.keys(patch).length)
    command({ type: "beat", beatId: selectedBeat.value.id, patch });
}
function replace() {
  if (selectedClip.value && replacementId.value)
    command({
      type: "replace",
      clipId: selectedClip.value.id,
      assetId: replacementId.value,
    });
}
function configurePlayer() {
  const player = sourcePlayer.value;
  const clip = playbackClip.value;
  if (!player || !clip) return;
  player.currentTime = clip.sourceIn ?? 0;
  sourceTime.value = clip.sourceIn ?? 0;
  playbackBoundaryHandled = false;
  try {
    player.playbackRate = clip.transform?.speed ?? 1;
    if (sourceError.value === unsupportedSpeedMessage) sourceError.value = "";
  } catch {
    player.pause();
    sourceError.value = unsupportedSpeedMessage;
  }
  player.volume =
    (clip.transform?.volume ?? 1) *
    evaluateAudioGain(clip.audioAutomation, 0, clip.timelineDuration);
}
function stopAtOut() {
  const player = sourcePlayer.value;
  const clip = playbackClip.value;
  const sourceOut = clip?.sourceOut ?? selectedAsset.value?.duration;
  if (!player) return;
  const action = playbackBoundaryAction({
    playing: !player.paused,
    seeking: player.seeking,
    currentTime: player.currentTime,
    sourceOut,
    frameRate: monitorFrameRate.value,
    handled: playbackBoundaryHandled,
    loop: loopClip.value,
  });
  if (action === "continue") {
    playbackBoundaryHandled = false;
    return;
  }
  if (action !== "loop" && action !== "stop") return;
  playbackBoundaryHandled = true;
  if (action === "loop") {
    player.currentTime = clip?.sourceIn ?? 0;
    sourceTime.value = player.currentTime;
  } else {
    if (sourceOut === undefined) return;
    player.pause();
    player.currentTime = sourceOut;
    sourceTime.value = sourceOut;
  }
}
function updateSourceTime() {
  if (!sourcePlayer.value) return;
  sourceTime.value = sourcePlayer.value.currentTime;
  const clip = playbackClip.value;
  if (clip?.audioAutomation) {
    const time =
      (sourceTime.value - (clip.sourceIn ?? 0)) / (clip.transform?.speed ?? 1);
    sourcePlayer.value.volume =
      (clip.transform?.volume ?? 1) *
      evaluateAudioGain(clip.audioAutomation, time, clip.timelineDuration);
  }
  stopAtOut();
}
function sourcePlaybackStarted() {
  const player = sourcePlayer.value;
  const clip = playbackClip.value;
  const sourceOut = clip?.sourceOut ?? selectedAsset.value?.duration;
  if (player && clip && playbackBoundaryHandled) {
    const restart = restartTimeAtClipBoundary({
      boundaryHandled: playbackBoundaryHandled,
      currentTime: player.currentTime,
      sourceIn: clip.sourceIn ?? 0,
      sourceOut,
      frameRate: monitorFrameRate.value,
    });
    if (restart !== undefined) {
      player.currentTime = restart;
      sourceTime.value = restart;
    }
  }
  playbackBoundaryHandled = false;
  playing.value = true;
}
function stepSourceFrame(direction: -1 | 1) {
  const player = sourcePlayer.value;
  const clip = playbackClip.value;
  if (!player || selectedAsset.value?.mediaType !== "video" || !clip) return;
  const minimum = clip.sourceIn ?? 0;
  const maximum =
    clip.sourceOut ?? selectedAsset.value.duration ?? player.duration;
  const next = clampFrameStep(
    player.currentTime,
    direction,
    monitorFrameRate.value,
    minimum,
    maximum,
  );
  player.pause();
  playbackBoundaryHandled = false;
  player.currentTime = next;
  sourceTime.value = next;
}
function seekSource(event: Event) {
  const player = sourcePlayer.value;
  const clip = playbackClip.value;
  const requested = Number((event.target as HTMLInputElement).value);
  if (!player || !clip || !Number.isFinite(requested)) return;
  const minimum = clip.sourceIn ?? 0;
  const maximum = clip.sourceOut ?? playbackAsset.value?.duration ?? minimum;
  player.pause();
  playbackBoundaryHandled = false;
  player.currentTime = Math.max(minimum, Math.min(maximum, requested));
  sourceTime.value = player.currentTime;
}
function toggleMonitorGuides() {
  const next = !(showRuleOfThirds.value && showSafeFrame.value);
  showRuleOfThirds.value = next;
  showSafeFrame.value = next;
}
function togglePlayback() {
  if (selectedSourceInfo.value?.previewSupported === false) return;
  if (photoPresentationActive.value) {
    photoPlayer.value?.toggle();
    return;
  }
  const player = sourcePlayer.value;
  if (!player) {
    emit("playback");
    return;
  }
  if (player.paused) {
    const clip = playbackClip.value;
    const sourceOut = clip?.sourceOut ?? selectedAsset.value?.duration;
    if (
      clip &&
      sourceOut !== undefined &&
      player.currentTime >=
        sourceOut - 0.5 / Math.max(1, monitorFrameRate.value)
    ) {
      player.currentTime = clip.sourceIn ?? 0;
      sourceTime.value = player.currentTime;
      playbackBoundaryHandled = false;
    }
    void player.play().catch(() => {
      sourceError.value = "playback";
    });
  } else player.pause();
}
function keyboard(event: KeyboardEvent) {
  if (directionBlocked.value) return;
  if (editMode.value === "transcript") return;
  if (!props.active || event.defaultPrevented) return;
  if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
  if (draftAction.value) {
    if (event.key === "Escape") draftAction.value = null;
    return;
  }
  const element = event.target as HTMLElement | null;
  if (element?.closest("input, textarea, select, [contenteditable='true']"))
    return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    void history(event.shiftKey ? "redo" : "undo");
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (editMode.value !== "story") return;
  if (event.key.toLowerCase() === "g") {
    event.preventDefault();
    toggleMonitorGuides();
  }
  if (event.code === "Space" && !element?.closest("button")) {
    event.preventDefault();
    togglePlayback();
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const clips = groups.value.flatMap((group) => group.clips);
    const index = clips.findIndex((clip) => clip.id === selectedClipId.value);
    const next = clips[index + (event.key === "ArrowRight" ? 1 : -1)];
    if (next) {
      chooseClip(next);
      void nextTick(() => revealClip(next.id));
    }
  }
}
function revealClip(id: string) {
  const clip = document.getElementById(`clip-${id}`);
  const rail = clip?.closest<HTMLElement>(".editor-story-rail");
  const lane = clip?.closest<HTMLElement>(".editor-clip-lane");
  if (!clip || !rail || !lane) return;
  const bounds = clip.getBoundingClientRect();
  const vertical = rail.getBoundingClientRect();
  const horizontal = lane.getBoundingClientRect();
  if (bounds.top < vertical.top + 8)
    rail.scrollTop += bounds.top - vertical.top - 8;
  else if (bounds.bottom > vertical.bottom - 8)
    rail.scrollTop += bounds.bottom - vertical.bottom + 8;
  if (bounds.left < horizontal.left + 8)
    lane.scrollLeft += bounds.left - horizontal.left - 8;
  else if (bounds.right > horizontal.right - 8)
    lane.scrollLeft += bounds.right - horizontal.right + 8;
}
function measureWorkspace() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    if (sourceScreenElement.value) {
      const width = sourceScreenElement.value.clientWidth;
      const height = sourceScreenElement.value.clientHeight;
      if (width > 0 && height > 0) {
        const nextViewport = roundFrameDimensions({ width, height });
        if (
          nextViewport.width !== sourceViewport.value.width ||
          nextViewport.height !== sourceViewport.value.height
        )
          sourceViewport.value = nextViewport;
      }
    }
    const workspace =
      editMode.value === "precision"
        ? precisionElement.value
        : editMode.value === "transcript"
          ? transcriptElement.value
          : workspaceElement.value;
    if (!props.active || !workspace) return;
    const footer = editorElement.value?.querySelector(".editor-shortcuts");
    const footerHeight = footer?.getBoundingClientRect().height ?? 0;
    const measuredHeight = Math.max(
      editMode.value !== "story" ? 416 : 272,
      Math.floor(
        window.innerHeight -
          Math.max(0, workspace.getBoundingClientRect().top) -
          footerHeight -
          16,
      ),
    );
    const stableHeight = nextStableWorkspaceHeight(
      workspaceHeight.value,
      measuredHeight,
    );
    if (stableHeight !== workspaceHeight.value)
      workspaceHeight.value = stableHeight;
  });
}
watch(
  allClips,
  (clips) => {
    if (!clips.some((clip) => clip.id === selectedClipId.value)) {
      const first = clips[0];
      if (first) chooseClip(first, false);
      else selectedClipId.value = "";
    }
  },
  { immediate: true },
);

const controls = computed(() => clipControls(selectedAsset.value?.mediaType));
const durationState = computed(() =>
  durationStatus(
    state.value?.composition.duration ?? 0,
    target.value,
    maximum.value,
  ),
);
const fitPreviewAfter = computed(() => {
  if (!fitPreview.value || !state.value) return undefined;
  try {
    const commands = shorteningCommands(
      state.value,
      state.value.assets,
      target.value,
      fitPreview.value,
      skippedClipIds.value,
    );
    const next = commands.reduce<EditorDocument>(
      (current, item) =>
        applyTimelineCommand(current, state.value!.assets, item),
      state.value,
    );
    return next.composition.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === fitPreview.value?.clipId);
  } catch {
    return undefined;
  }
});
const playbackClip = computed(
  () => directionPreview.value ?? fitPreviewAfter.value ?? selectedClip.value,
);
function toggleFit() {
  showFit.value = !showFit.value;
  skippedClipIds.value = [];
  fitPreview.value = null;
}
function suggestionName(suggestion: ShorteningSuggestionPreview) {
  const clip = allClips.value.find((clip) => clip.id === suggestion.clipId);
  return clip ? name(clip) : t("editor.storyMoment");
}
function suggestionDescription(suggestion: ShorteningSuggestionPreview) {
  return t(`editor.fit.action.${shorteningAction(suggestion.commands[0])}`, {
    name: suggestionName(suggestion),
    saved: secondsLabel(suggestion.secondsSaved),
  });
}
function secondsLabel(value: number) {
  return t("editor.seconds", {
    value: formatNumber(value, { maximumFractionDigits: 3 }),
  });
}
function previewFit(suggestion: ShorteningSuggestionPreview) {
  if (!state.value) return;
  try {
    shorteningCommands(
      state.value,
      state.value.assets,
      target.value,
      suggestion,
      skippedClipIds.value,
    );
    const clip = allClips.value.find((item) => item.id === suggestion.clipId);
    if (clip) chooseClip(clip);
    fitPreview.value = suggestion;
    void nextTick(configurePlayer);
  } catch (cause) {
    reportError(cause);
  }
}
function skipFit(suggestion: ShorteningSuggestionPreview) {
  skippedClipIds.value = [
    ...new Set([...skippedClipIds.value, suggestion.clipId]),
  ];
  fitPreview.value = null;
}
async function confirmDraftAction() {
  const action = draftAction.value;
  draftAction.value = null;
  if (action === "discard") await discardDraft();
  if (action === "reapply") await reapplyDraft();
}
watch(draftAction, (action) => {
  if (action) {
    draftTrigger = document.activeElement as HTMLElement | null;
    void nextTick(() =>
      draftConfirmation.value?.querySelector("button")?.focus(),
    );
  } else void nextTick(() => draftTrigger?.focus());
});
function draftKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Escape") draftAction.value = null;
  if (event.key !== "Tab") return;
  const buttons = Array.from(
    draftConfirmation.value?.querySelectorAll("button") ?? [],
  );
  const first = buttons[0];
  const last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
watch([target, maximum], () => {
  skippedClipIds.value = [];
  fitPreview.value = null;
});
watch([() => fitPlan.value?.baseState, () => props.sourceVersion], () => {
  if (fitPreview.value) {
    fitPreview.value = null;
    void nextTick(configurePlayer);
  }
});

function clipValues(clip: Clip) {
  return {
    sourceIn: clip.sourceIn ?? 0,
    sourceOut:
      clip.sourceOut ??
      assetMap.value.get(clip.assetId)?.duration ??
      clip.timelineDuration,
    duration: clip.timelineDuration,
    speed: clip.transform?.speed ?? 1,
    volume: clip.transform?.volume ?? 1,
    scale: clip.transform?.scale ?? 1,
    rotation: clip.transform?.rotation ?? 0,
    x: clip.transform?.x ?? 0,
    y: clip.transform?.y ?? 0,
    transitionDuration: clip.transition?.duration ?? 0.3,
  };
}
watch(selectedClip, (clip, previous) => {
  if (!clip) return;
  if (!previous || previous.id !== clip.id) {
    loopClip.value = false;
    playbackBoundaryHandled = false;
    sourceTime.value = clip.sourceIn ?? 0;
  }
  const next = clipValues(clip);
  if (
    !previous ||
    previous.id !== clip.id ||
    previous.assetId !== clip.assetId
  ) {
    clipFields.value = next;
    replacementId.value = "";
  } else {
    const before = clipValues(previous);
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (next[key] !== before[key]) clipFields.value[key] = next[key];
    }
  }
  if (
    !previous ||
    previous.id !== clip.id ||
    previous.assetId !== clip.assetId ||
    previous.sourceIn !== clip.sourceIn ||
    previous.transform?.speed !== clip.transform?.speed ||
    previous.transform?.volume !== clip.transform?.volume
  )
    void nextTick(configurePlayer);
});
function beatValues(beat: StoryBeat) {
  return {
    title: beat.title,
    intent: beat.intent ?? "",
    targetDuration: beat.targetDuration ?? target.value,
    minDuration: beat.minDuration ?? 0,
    maxDuration: beat.maxDuration ?? beat.targetDuration ?? maximum.value,
  };
}
watch(selectedBeat, (beat, previous) => {
  if (!beat) return;
  const next = beatValues(beat);
  if (!previous || previous.id !== beat.id) beatFields.value = next;
  else {
    const before = beatValues(previous);
    const changed = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => before[key as keyof typeof before] !== value,
      ),
    );
    beatFields.value = { ...beatFields.value, ...changed };
  }
});
watch([sourcePlaybackKey, () => selectedSourceStatus.value?.status], () => {
  sourceError.value = "";
  playing.value = false;
  sourceTime.value = selectedClip.value?.sourceIn ?? 0;
  sourcePreviewSize.value = undefined;
});
watch(
  () => props.active,
  (active) => {
    if (!active) sourcePlayer.value?.pause();
    else void nextTick(measureWorkspace);
  },
);
watch(
  () => props.previewVisible,
  () => void nextTick(measureWorkspace),
);
watch(editMode, () => {
  directionPreview.value = null;
  sourcePlayer.value?.pause();
  fitPreview.value = null;
  void nextTick(measureWorkspace);
});
watch(
  [sourceScreenElement, () => props.active, editMode],
  ([screen, active, mode], [previousScreen]) => {
    if (previousScreen) layoutObserver?.unobserve(previousScreen);
    if (screen && active && mode === "story") {
      layoutObserver?.observe(screen);
      measureWorkspace();
    }
  },
  { flush: "post" },
);
function checkpointNativeEditReady(generation: number) {
  if (
    typeof window === "undefined" ||
    !window.__TAURI_INTERNALS__ ||
    nativeEditReadyForVisit ||
    nativeEditDisposed ||
    generation !== nativeEditGeneration
  )
    return;
  cancelNativeEditReady?.();
  cancelNativeEditReady = undefined;
  const snapshot = state.value;
  const root = editorElement.value;
  const count = allClips.value.length;
  const current = () =>
    !nativeEditDisposed &&
    generation === nativeEditGeneration &&
    props.active &&
    editMode.value === "story" &&
    status.value === "saved" &&
    !hasPending.value &&
    !!snapshot &&
    state.value === snapshot &&
    !!root?.getClientRects().length &&
    root.querySelectorAll(".editor-clip").length === count &&
    root.querySelectorAll('.editor-clip[aria-pressed="true"]').length ===
      (count ? 1 : 0);
  // This means usable Story Edit DOM, not decoded thumbnails/video or an
  // independently verified compositor presentation on the physical display.
  cancelNativeEditReady = nativeBenchmark.afterFrames(
    "edit-ready",
    { clipCount: count },
    current,
    () => {
      if (current()) nativeEditReadyForVisit = true;
    },
  );
}
watch(
  [() => props.active, () => state.value, status, editMode, hasPending],
  () => {
    if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) return;
    cancelNativeEditReady?.();
    cancelNativeEditReady = undefined;
    const generation = ++nativeEditGeneration;
    if (!props.active) nativeEditReadyForVisit = false;
    if (!nativeEditReadyForVisit)
      void nextTick(() => checkpointNativeEditReady(generation));
  },
  { immediate: true, flush: "sync" },
);
onMounted(() => {
  inspectorOpen.value = !window.matchMedia("(max-width: 1100px)").matches;
  window.addEventListener("keydown", keyboard);
  window.addEventListener("resize", measureWorkspace);
  layoutObserver = new ResizeObserver(measureWorkspace);
  if (sourceScreenElement.value && props.active && editMode.value === "story")
    layoutObserver.observe(sourceScreenElement.value);
  measureWorkspace();
});
onBeforeUnmount(() => {
  captionImportController?.abort();
  captionImportGeneration++;
  nativeEditDisposed = true;
  nativeEditGeneration++;
  cancelNativeEditReady?.();
  cancelNativeEditReady = undefined;
  window.removeEventListener("keydown", keyboard);
  window.removeEventListener("resize", measureWorkspace);
  layoutObserver?.disconnect();
  cancelAnimationFrame(layoutFrame);
});
</script>

<template>
  <section
    ref="editorElement"
    class="timeline-editor timeline-editor-contained"
    :aria-label="t('editor.timeline')"
  >
    <header class="editor-toolbar">
      <div class="editor-heading">
        <h2>{{ t("editor.heading") }}</h2>
      </div>
      <div
        class="editor-mode-switch"
        role="group"
        :aria-label="t('precision.modeLabel')"
      >
        <button
          v-for="mode in ['story', 'precision', 'transcript'] as const"
          :key="mode"
          class="editor-button"
          :disabled="directionBlocked"
          :aria-pressed="editMode === mode"
          :class="{ selected: editMode === mode }"
          @click="setEditMode(mode)"
        >
          {{
            t(
              mode === "story"
                ? "precision.storyMode"
                : mode === "precision"
                  ? "precision.precisionMode"
                  : "transcript.mode",
            )
          }}
        </button>
      </div>
      <span
        class="editor-save-state"
        data-testid="editor-save-state"
        :class="{
          failed: status === 'failed' || status === 'conflict',
          saving: status === 'saving',
        }"
        role="status"
        aria-live="polite"
        ><Icon :name="status === 'saved' ? 'check' : 'refresh'" :size="14" />{{
          saveLabel
        }}</span
      >
      <div class="editor-actions">
        <button
          v-show="editMode !== 'transcript'"
          class="editor-button"
          :aria-label="t('editor.undoLabel')"
          :disabled="
            historyBusy ||
            precisionEditor?.hasPending ||
            (!state?.canUndo && !compositionHasPending)
          "
          @click="history('undo')"
        >
          {{ t("editor.undo") }}
        </button>
        <button
          v-show="editMode !== 'transcript'"
          class="editor-button"
          :aria-label="t('editor.redoLabel')"
          :disabled="
            historyBusy ||
            precisionEditor?.hasPending ||
            !state?.canRedo ||
            hasPending
          "
          @click="history('redo')"
        >
          {{ t("editor.redo") }}
        </button>
        <button
          v-show="editMode === 'story'"
          class="editor-button"
          :class="{ selected: showFit }"
          :aria-expanded="showFit"
          @click="toggleFit"
        >
          {{ t("editor.fit.title") }}
        </button>
        <button
          v-show="editMode === 'story'"
          class="editor-button"
          :aria-expanded="inspectorOpen"
          aria-controls="timeline-inspector"
          :disabled="directionBlocked"
          @click="inspectorOpen = !inspectorOpen"
        >
          {{
            t(inspectorOpen ? "editor.hideInspector" : "editor.showInspector")
          }}
        </button>
      </div>
    </header>
    <div
      v-if="message || status === 'failed' || status === 'conflict'"
      class="editor-message error"
      role="alert"
    >
      <span>{{ message || t("editor.draft.kept") }}</span>
      <details v-if="messageDetail" class="editor-technical-details">
        <summary>{{ t("editor.technicalDetails") }}</summary>
        <pre>{{ messageDetail }}</pre>
      </details>
      <button
        v-if="status === 'failed'"
        class="editor-button"
        @click="state && hasPending ? flush() : load()"
      >
        {{ t("editor.draft.retry") }}
      </button>
      <button
        v-if="status === 'conflict' && !hasPending"
        class="editor-button"
        @click="load"
      >
        {{ t("editor.draft.reload") }}
      </button>
      <template v-if="status === 'conflict' && hasPending"
        ><button class="editor-button" @click="flush">
          {{ t("editor.draft.retry") }}</button
        ><button class="editor-button" @click="draftAction = 'reapply'">
          {{ t("editor.draft.reapply") }}
        </button></template
      >
      <template
        v-if="hasPending && (status === 'failed' || status === 'conflict')"
        ><button class="editor-button" @click="downloadDraft">
          {{ t("editor.draft.download") }}</button
        ><button class="editor-button danger" @click="draftAction = 'discard'">
          {{ t("editor.draft.discard") }}
        </button></template
      >
    </div>
    <div
      v-if="draftAction"
      ref="draftConfirmation"
      class="editor-message"
      role="alertdialog"
      :aria-label="t('editor.draft.confirmTitle')"
      aria-describedby="draft-confirm-description"
      @keydown="draftKeydown"
    >
      <p id="draft-confirm-description">
        {{
          t(
            draftAction === "discard"
              ? "editor.draft.confirmDiscard"
              : "editor.draft.confirmReapply",
          )
        }}
      </p>
      <button class="editor-button" @click="draftAction = null">
        {{ t("editor.cancel") }}</button
      ><button class="editor-button primary" @click="confirmDraftAction">
        {{ t("editor.confirm") }}
      </button>
    </div>
    <div v-if="!state" class="editor-empty">
      {{ t(status === "loading" ? "editor.opening" : "editor.openFailed") }}
    </div>
    <template v-else>
      <div
        class="editor-duration"
        :class="{ 'over-limit': overLimit }"
        :aria-label="t('editor.duration.feedback')"
      >
        <strong
          >{{ duration(state.composition.duration) }}
          <span
            >/ {{ duration(maximum) }} {{ t("editor.duration.maximum") }}</span
          ></strong
        >
        <span>{{
          t("editor.duration.target", { time: duration(target) })
        }}</span>
        <span class="editor-duration-status" :class="durationState">{{
          t(`editor.duration.${durationState}`)
        }}</span>
        <div class="editor-duration-track">
          <i
            :style="{
              width: `${Math.min(100, (state.composition.duration / Math.max(maximum, 1)) * 100)}%`,
            }"
          />
        </div>
        <span v-if="overLimit">{{
          t("editor.duration.overBy", {
            time: duration(state.composition.duration - maximum),
          })
        }}</span>
      </div>
      <section
        v-if="showFit && editMode === 'story'"
        class="editor-fit-panel"
        :aria-label="t('editor.fit.suggestions')"
      >
        <div class="editor-fit-heading">
          <div>
            <h3>{{ t("editor.fit.heading") }}</h3>
            <p>{{ t("editor.fit.explanation") }}</p>
          </div>
          <button
            class="editor-button primary"
            :disabled="!fitPlan?.commands.length || historyBusy"
            @click="applyFit(fitPlan)"
          >
            {{ t("editor.fit.applyAll") }}
          </button>
        </div>
        <p v-if="fitPlan?.commands.length" class="editor-note">
          {{
            t("editor.fit.total", {
              saved: secondsLabel(fitPlan.secondsSaved),
              after: duration(fitPlan.afterDuration, { fractional: true }),
            })
          }}
          <span v-if="fitPlan.afterDuration > target + 0.001">{{
            t("editor.fit.infeasible")
          }}</span>
        </p>
        <p v-if="skippedClipIds.length" class="editor-note">
          {{
            t(
              "editor.fit.skipped",
              { count: formatNumber(skippedClipIds.length) },
              skippedClipIds.length,
            )
          }}
          <button class="editor-button" @click="skippedClipIds = []">
            {{ t("editor.fit.resetSkipped") }}
          </button>
        </p>
        <div
          v-for="suggestion in fitSuggestions"
          :key="suggestion.id"
          :data-clip-id="suggestion.clipId"
          class="editor-suggestion"
          :class="{ selected: fitPreview?.id === suggestion.id }"
        >
          <div>
            <strong>{{ suggestionName(suggestion) }}</strong>
            <p>{{ suggestionDescription(suggestion) }}</p>
          </div>
          <span>−{{ secondsLabel(suggestion.secondsSaved) }}</span>
          <div class="editor-suggestion-actions">
            <button
              class="editor-button"
              :aria-label="
                t('editor.fit.previewLabel', {
                  name: suggestionName(suggestion),
                })
              "
              :aria-pressed="fitPreview?.id === suggestion.id"
              :disabled="historyBusy"
              @click="previewFit(suggestion)"
            >
              {{ t("editor.fit.preview") }}
            </button>
            <button
              class="editor-button"
              :aria-label="
                t('editor.fit.applyLabel', {
                  reason: suggestionDescription(suggestion),
                })
              "
              :disabled="historyBusy"
              @click="applyFit(suggestion)"
            >
              {{ t("editor.fit.apply") }}
            </button>
            <button
              class="editor-button"
              :aria-label="
                t('editor.fit.skipLabel', { name: suggestionName(suggestion) })
              "
              :disabled="historyBusy"
              @click="skipFit(suggestion)"
            >
              {{ t("editor.fit.skip") }}
            </button>
          </div>
        </div>
        <div v-if="fitPreview" class="editor-fit-preview" role="status">
          <strong>{{
            t("editor.fit.previewTitle", { name: suggestionName(fitPreview) })
          }}</strong>
          <p>
            {{
              t("editor.fit.comparison", {
                before: duration(fitPreview.beforeDuration, {
                  fractional: true,
                }),
                after: duration(fitPreview.afterDuration, { fractional: true }),
              })
            }}
          </p>
          <p v-if="fitPreviewAfter">
            {{
              t("editor.fit.clipComparison", {
                before: duration(selectedClip?.timelineDuration, {
                  fractional: true,
                }),
                after: duration(fitPreviewAfter.timelineDuration, {
                  fractional: true,
                }),
              })
            }}
            <span v-if="selectedAsset?.mediaType !== 'image'">{{
              t("editor.fit.sourceRange", {
                start: duration(fitPreviewAfter.sourceIn, { fractional: true }),
                end: duration(fitPreviewAfter.sourceOut, { fractional: true }),
              })
            }}</span>
          </p>
          <p v-else>{{ t("editor.fit.removePreview") }}</p>
          <p class="editor-note">{{ t("editor.fit.previewNote") }}</p>
          <button
            class="editor-button"
            @click="
              fitPreview = null;
              configurePlayer();
            "
          >
            {{ t("editor.fit.closePreview") }}
          </button>
        </div>
        <p v-if="!fitSuggestions.length" class="editor-note">
          {{
            t(
              state.composition.duration <= target + 0.001
                ? "editor.fit.alreadyFits"
                : fitPlan?.commands.length
                  ? "editor.fit.overlap"
                  : "editor.fit.noSuggestions",
            )
          }}
        </p>
      </section>
      <div v-show="editMode === 'precision'" ref="precisionElement">
        <PrecisionEditor
          ref="precisionEditor"
          :project-id="projectId"
          :asset="selectedAsset"
          :clip="selectedClip"
          :active="active && editMode === 'precision' && !draftAction"
          :busy="historyBusy"
          :source-edits-locked="lockedOverlaySource"
          :analysis-recovery="analysisRecovery"
          :recovering-analysis-jobs="recoveringAnalysisJobs"
          :unavailable="
            !!sourceUnavailable ||
            selectedSourceInfo?.previewSupported === false
          "
          :source-version="sourceVersion"
          :height="workspaceHeight"
          :clips="clipOptions"
          :submit="command"
          @select="
            (id) => {
              const clip = allClips.find((item) => item.id === id);
              if (clip) chooseClip(clip);
            }
          "
          @activity="emit('activity')"
          @recover-analysis="
            (job, input) => emit('recoverAnalysis', job, input)
          "
        />
      </div>
      <div v-show="editMode === 'transcript'" ref="transcriptElement">
        <TranscriptEditor
          v-if="editMode === 'transcript' && selectedAsset"
          :key="`${projectId}:${selectedAsset.id}`"
          ref="transcriptEditor"
          :project-id="projectId"
          :asset="selectedAsset"
          :clip="selectedClip"
          :active="active && editMode === 'transcript' && !draftAction"
          :unavailable="
            !!sourceUnavailable ||
            selectedSourceInfo?.previewSupported === false
          "
          :source-version="sourceVersion"
          :jobs="jobs"
          :analysis-recovery="analysisRecovery"
          :recovering-analysis-jobs="recoveringAnalysisJobs"
          :height="workspaceHeight"
          :clips="clipOptions"
          @select="
            (id) => {
              const clip = allClips.find((item) => item.id === id);
              if (clip) chooseClip(clip);
            }
          "
          @activity="emit('activity')"
          @recover-analysis="
            (job, input) => emit('recoverAnalysis', job, input)
          "
          @changed="emit('activity')"
        />
      </div>
      <div
        v-show="editMode === 'story'"
        ref="workspaceElement"
        class="editor-body editor-workspace"
        :class="{ 'editor-inspector-collapsed': !inspectorOpen }"
        :style="
          workspaceHeight
            ? { '--editor-workspace-height': `${workspaceHeight}px` }
            : undefined
        "
      >
        <div class="editor-stage editor-main">
          <div class="editor-player-region">
            <div ref="sourceScreenElement" class="editor-source-screen">
              <FilmLookFilter :id="filmLookFilterId" :look="playbackLook" />
              <template v-if="playbackAsset">
                <div v-if="playbackUnavailable" class="editor-missing-source">
                  <img
                    v-if="playbackAsset.thumbnailUri"
                    :src="thumbnailUrl(playbackAsset.id)"
                    alt=""
                  />
                  <div>
                    <Icon name="folder" :size="24" /><strong>{{
                      t(
                        playbackSourceStatus?.status === "inaccessible"
                          ? "editor.source.inaccessible"
                          : "editor.source.missing",
                      )
                    }}</strong
                    ><span>{{ t("editor.source.editsSafe") }}</span>
                  </div>
                </div>
                <div
                  v-else-if="playbackSourceInfo?.previewSupported === false"
                  class="editor-unsupported-source"
                >
                  <img
                    v-if="playbackAsset.thumbnailUri"
                    :src="thumbnailUrl(playbackAsset.id)"
                    alt=""
                  />
                  <div>
                    <Icon name="film" :size="28" /><strong>{{
                      t(
                        playbackSourceInfo.requiresReframedExport
                          ? "editor.source.spherical"
                          : "editor.source.unavailable",
                      )
                    }}</strong
                    ><span>{{ playbackSourceInfo.kindLabel }}</span>
                    <p>
                      {{
                        t(
                          playbackSourceInfo.requiresReframedExport
                            ? "editor.source.reframe"
                            : "editor.source.convert",
                        )
                      }}
                    </p>
                  </div>
                </div>
                <PhotoPresentationPreview
                  v-else-if="playbackClip && photoPresentationActive"
                  ref="photoPlayer"
                  :clip="playbackClip"
                  :assets="state.assets"
                  :frame="projectSettings"
                  :viewport="sourceViewport"
                  :transport-target="`#photo-transport-${compositionId}`"
                  :composition-id="compositionId"
                  :revision="state.revision"
                  :project-id="projectId"
                  :source-version="sourceVersion"
                  :active="active && editMode === 'story'"
                  :look="playbackLook"
                  ><template #default="slot"
                    ><GraphicScenePreview
                      v-if="state.composition.graphicScenes?.length"
                      :composition-id="compositionId"
                      :project-id="projectId"
                      :revision="state.revision"
                      :source-version="sourceVersion"
                      :frame-rate="projectSettings.frameRate"
                      :duration="state.composition.duration"
                      :active="
                        active && editMode === 'story' && status === 'saved'
                      "
                      :time="playbackClip.timelineStart + slot.time"
                      :playing="slot.playing" /></template
                ></PhotoPresentationPreview>
                <div
                  v-else-if="playbackAsset.mediaType === 'image'"
                  class="editor-composition-frame"
                  :style="previewFrameStyle"
                >
                  <img
                    :key="sourcePlaybackKey"
                    :src="sourceUrl(playbackAsset.id, sourcePlaybackKey)"
                    :alt="playbackAsset.name"
                    :style="[previewMediaStyle, playbackLookStyle]"
                    @load="capturePreviewSize"
                    @error="sourceError = 'photo'"
                  />
                  <NativeTitlePreview
                    v-if="playbackClip?.title"
                    :key="`title:${state.revision}:${titlePreviewRetry}`"
                    class="editor-title-overlay"
                    :src="
                      titlePreviewUrl(
                        compositionId,
                        playbackClip.id,
                        state.revision,
                        projectId,
                      )
                    "
                    :clip="playbackClip"
                    :source-time="sourceTime"
                    @load="titlePreviewFailed = false"
                    @error="titlePreviewFailed = true"
                  />
                  <GraphicScenePreview
                    v-if="
                      state.composition.graphicScenes?.length && playbackClip
                    "
                    :composition-id="compositionId"
                    :project-id="projectId"
                    :revision="state.revision"
                    :source-version="sourceVersion"
                    :frame-rate="projectSettings.frameRate"
                    :duration="state.composition.duration"
                    :active="
                      active && editMode === 'story' && status === 'saved'
                    "
                    :time="
                      playbackClip.timelineStart +
                      (sourceTime - (playbackClip.sourceIn ?? 0)) /
                        (playbackClip.transform?.speed ?? 1)
                    "
                    :playing="playing"
                  />
                </div>
                <div
                  v-else-if="playbackAsset.mediaType === 'audio'"
                  class="editor-audio-preview"
                >
                  <Icon name="volume" :size="40" /><audio
                    v-if="active && editMode === 'story'"
                    ref="sourcePlayer"
                    :key="sourcePlaybackKey"
                    :src="sourceUrl(playbackAsset.id, sourcePlaybackKey)"
                    controls
                    preload="metadata"
                    :aria-label="t('editor.source.preview')"
                    @loadedmetadata="configurePlayer"
                    @timeupdate="updateSourceTime"
                    @play="sourcePlaybackStarted"
                    @pause="playing = false"
                    @error="sourceError = 'playback'"
                  />
                </div>
                <div
                  v-else-if="active && editMode === 'story'"
                  class="editor-composition-frame"
                  :style="previewFrameStyle"
                >
                  <video
                    ref="sourcePlayer"
                    :key="sourcePlaybackKey"
                    :src="sourceUrl(playbackAsset.id, sourcePlaybackKey)"
                    :poster="
                      playbackAsset.thumbnailUri
                        ? thumbnailUrl(playbackAsset.id)
                        : undefined
                    "
                    :controls="!playbackLookActive"
                    preload="metadata"
                    :aria-label="t('editor.source.preview')"
                    :style="[previewMediaStyle, playbackLookStyle]"
                    @loadedmetadata="
                      capturePreviewSize($event);
                      configurePlayer();
                    "
                    @seeked="updateSourceTime"
                    @timeupdate="updateSourceTime"
                    @play="sourcePlaybackStarted"
                    @pause="playing = false"
                    @error="sourceError = 'playback'"
                  />
                  <NativeTitlePreview
                    v-if="playbackClip?.title"
                    :key="`title:${state.revision}:${titlePreviewRetry}`"
                    class="editor-title-overlay"
                    :src="
                      titlePreviewUrl(
                        compositionId,
                        playbackClip.id,
                        state.revision,
                        projectId,
                      )
                    "
                    :clip="playbackClip"
                    :source-time="sourceTime"
                    :player="sourcePlayer"
                    @load="titlePreviewFailed = false"
                    @error="titlePreviewFailed = true"
                  />
                  <GraphicScenePreview
                    v-if="
                      state.composition.graphicScenes?.length && playbackClip
                    "
                    :composition-id="compositionId"
                    :project-id="projectId"
                    :revision="state.revision"
                    :source-version="sourceVersion"
                    :frame-rate="projectSettings.frameRate"
                    :duration="state.composition.duration"
                    :active="
                      active && editMode === 'story' && status === 'saved'
                    "
                    :time="
                      playbackClip.timelineStart +
                      (sourceTime - (playbackClip.sourceIn ?? 0)) /
                        (playbackClip.transform?.speed ?? 1)
                    "
                    :playing="playing"
                  />
                </div>
              </template>
              <div v-else class="editor-source-empty">
                <Icon name="film" :size="30" /><span>{{
                  t("editor.source.choose")
                }}</span>
              </div>
              <template
                v-if="
                  playbackAsset &&
                  !playbackUnavailable &&
                  playbackSourceInfo?.previewSupported !== false &&
                  playbackAsset.mediaType !== 'audio'
                "
              >
                <div
                  class="editor-monitor-tools"
                  role="group"
                  :aria-label="t('editor.monitor.controls')"
                >
                  <label class="sr-only" for="monitor-aspect-guide">{{
                    t("editor.monitor.aspect")
                  }}</label>
                  <select id="monitor-aspect-guide" v-model="monitorAspect">
                    <option
                      v-for="choice in monitorAspects"
                      :key="choice.value"
                      :value="choice.value"
                    >
                      {{ choice.ratio }} · {{ t(choice.label) }}
                    </option>
                  </select>
                  <button
                    class="editor-button"
                    :aria-pressed="showRuleOfThirds"
                    @click="showRuleOfThirds = !showRuleOfThirds"
                  >
                    {{ t("editor.monitor.thirds") }}
                  </button>
                  <button
                    class="editor-button"
                    :aria-pressed="showSafeFrame"
                    @click="showSafeFrame = !showSafeFrame"
                  >
                    {{ t("editor.monitor.safe") }}
                  </button>
                  <kbd aria-label="G">G</kbd>
                  <span class="editor-monitor-guide-note">{{
                    t("editor.monitor.previewOnly")
                  }}</span>
                </div>
                <div
                  v-if="showRuleOfThirds || showSafeFrame"
                  class="editor-monitor-guide-layer"
                  aria-hidden="true"
                >
                  <div
                    class="editor-monitor-guide-frame"
                    :style="monitorGuideStyle"
                  >
                    <div
                      v-if="showRuleOfThirds"
                      class="editor-monitor-thirds"
                    />
                    <div
                      v-if="showSafeFrame"
                      class="editor-monitor-safe editor-monitor-safe-action"
                    />
                    <div
                      v-if="showSafeFrame"
                      class="editor-monitor-safe editor-monitor-safe-title"
                    />
                  </div>
                </div>
              </template>
            </div>
            <div class="editor-source-caption">
              <span :title="playbackAsset?.name"
                >{{ playbackAsset?.name ?? t("editor.yourStory") }}
                <small
                  >·
                  {{
                    t(
                      fitPreview || directionPreview
                        ? "editor.fit.preview"
                        : "editor.source.selected",
                    )
                  }}</small
                ></span
              >
              <div
                v-show="photoPresentationActive"
                :id="`photo-transport-${compositionId}`"
                class="photo-presentation-target"
              />
              <div
                v-if="
                  playbackAsset &&
                  playbackAsset.mediaType !== 'image' &&
                  !playbackUnavailable &&
                  playbackSourceInfo?.previewSupported !== false
                "
                class="editor-monitor-transport"
                role="group"
                :aria-label="t('editor.monitor.transport')"
              >
                <time :aria-label="t('editor.monitor.timecode')">{{
                  formatTimecode(sourceTime, monitorFrameRate)
                }}</time>
                <template v-if="playbackAsset.mediaType === 'video'">
                  <input
                    v-if="playbackLookActive"
                    class="editor-source-seek"
                    type="range"
                    :aria-label="t('editor.source.seek')"
                    :min="playbackClip?.sourceIn ?? 0"
                    :max="
                      playbackClip?.sourceOut ?? playbackAsset.duration ?? 0
                    "
                    :step="1 / monitorFrameRate"
                    :value="sourceTime"
                    @input="seekSource"
                  />
                  <button
                    class="editor-button"
                    :aria-label="t('editor.monitor.previousFrame')"
                    @click="stepSourceFrame(-1)"
                  >
                    −1f
                  </button>
                  <button
                    class="editor-button"
                    :aria-label="t('editor.monitor.nextFrame')"
                    @click="stepSourceFrame(1)"
                  >
                    +1f
                  </button>
                </template>
                <button
                  class="editor-button"
                  :aria-pressed="loopClip"
                  @click="loopClip = !loopClip"
                >
                  {{
                    t(
                      loopClip
                        ? "editor.monitor.loopEnabled"
                        : "editor.monitor.loop",
                    )
                  }}
                </button>
              </div>
              <button
                v-if="
                  playbackAsset &&
                  !playbackUnavailable &&
                  playbackSourceInfo?.previewSupported !== false &&
                  playbackAsset.mediaType !== 'image'
                "
                class="editor-button"
                @click="togglePlayback"
              >
                {{ t(playing ? "editor.source.pause" : "editor.source.play") }}
              </button>
            </div>
            <div
              v-if="titlePreviewFailed"
              class="editor-source-warning"
              role="status"
            >
              <p>{{ t("editor.presentation.titleFailed") }}</p>
              <button
                class="editor-button"
                @click="
                  titlePreviewFailed = false;
                  titlePreviewRetry++;
                "
              >
                {{ t("editor.presentation.retryTitle") }}
              </button>
            </div>
            <div
              v-if="playbackUnavailable || sourceError"
              class="editor-source-warning"
              role="status"
            >
              <p>
                {{
                  t(
                    playbackUnavailable
                      ? "editor.source.reconnect"
                      : `editor.source.error.${sourceError}`,
                  )
                }}
              </p>
              <details v-if="playbackSourceStatus?.message">
                <summary>{{ t("editor.technicalDetails") }}</summary>
                <p>{{ playbackSourceStatus.message }}</p>
              </details>
              <button
                v-if="playbackAsset && sourceError !== unsupportedSpeedMessage"
                class="editor-button"
                :aria-label="t('editor.source.relinkLabel')"
                @click="emit('relink', playbackAsset.id)"
              >
                {{ t("editor.source.locate") }}<Icon name="arrow" :size="14" />
              </button>
            </div>
          </div>
          <div
            class="editor-beats editor-story-rail"
            role="region"
            tabindex="0"
            :aria-label="t('editor.beats.timeline')"
          >
            <section
              v-for="(group, index) in groups"
              :key="group.id"
              class="editor-beat"
              :class="{
                selected: selectedBeatId === group.id,
                'editor-beat-empty': !group.clips.length,
              }"
              :aria-label="t('editor.beats.beatLabel', { title: group.title })"
            >
              <button
                class="editor-beat-heading"
                :title="group.title"
                :aria-label="
                  t('editor.beats.editLabel', { title: group.title })
                "
                @click="chooseBeat(group.id)"
              >
                <span class="editor-beat-number">{{
                  formatNumber(index + 1, { minimumIntegerDigits: 2 })
                }}</span
                ><span class="editor-beat-copy"
                  ><strong>{{ group.title }}</strong
                  ><small :title="group.intent">{{
                    group.intent || t("editor.beats.intentHint")
                  }}</small></span
                ><span class="editor-beat-time"
                  >{{ duration(beatDuration(group.clips))
                  }}<small>{{
                    t(
                      "editor.beats.clipCount",
                      { count: formatNumber(group.clips.length) },
                      group.clips.length,
                    )
                  }}</small></span
                >
              </button>
              <div
                class="editor-clip-lane"
                role="group"
                :aria-label="
                  t('editor.beats.clipsLabel', { title: group.title })
                "
              >
                <TimelineClip
                  v-for="clip in group.clips"
                  :key="clip.id"
                  :clip="clip"
                  :selected="selectedClipId === clip.id"
                  :asset-name="assetMap.get(clip.assetId)?.name"
                  :thumbnail-src="
                    assetMap.get(clip.assetId)?.thumbnailUri
                      ? thumbnailUrl(clip.assetId)
                      : undefined
                  "
                  :media-type="assetMap.get(clip.assetId)?.mediaType"
                  :source-status="sourceStatuses?.[clip.assetId]?.status"
                  @select="chooseClip"
                  @drag-start="startClipDrag"
                  @drag-end="endClipDrag"
                  @drop="drop"
                />
                <p v-if="!group.clips.length" class="editor-note">
                  {{ t("editor.beats.empty") }}
                </p>
              </div>
            </section>
            <section
              class="editor-caption-lane"
              :aria-label="t('editor.captions.timeline')"
            >
              <header class="editor-caption-lane-heading">
                <div>
                  <strong>{{ t("editor.captions.timeline") }}</strong>
                  <small>{{ t("editor.captions.timelineHint") }}</small>
                </div>
                <div class="editor-caption-actions">
                  <label
                    v-if="captionSourceTracks.length"
                    class="editor-caption-source"
                  >
                    <span>{{ t("editor.captions.sourceTrack") }}</span>
                    <select
                      v-model="captionSourceTrackId"
                      :aria-label="t('editor.captions.sourceTrack')"
                      data-testid="caption-source-track"
                      :disabled="captionImporting || historyBusy"
                    >
                      <option
                        v-for="track in captionSourceTracks"
                        :key="track.id"
                        :value="track.id"
                      >
                        {{ track.type }} · {{ track.id }}
                      </option>
                    </select>
                  </label>
                  <button
                    v-if="captionSourceTracks.length"
                    class="editor-button"
                    data-testid="caption-import-track"
                    :disabled="captionImporting || historyBusy"
                    @click="importNativeCaptions"
                  >
                    {{
                      t(
                        captionImporting
                          ? "editor.captions.importing"
                          : "editor.captions.importTranscript",
                      )
                    }}
                  </button>
                  <button
                    class="editor-button"
                    data-testid="caption-add-track"
                    :disabled="historyBusy"
                    @click="addCaptionTrack"
                  >
                    {{ t("editor.captions.addTrack") }}
                  </button>
                </div>
              </header>
              <p
                v-if="captionImportError"
                class="editor-caption-error"
                role="alert"
              >
                {{ captionImportError }}
              </p>
              <p v-if="!captionTracks.length" class="editor-note">
                {{ t("editor.captions.empty") }}
              </p>
              <div
                v-for="track in captionTracks"
                :key="track.id"
                class="editor-caption-track"
              >
                <button
                  class="editor-caption-track-name"
                  :aria-pressed="selectedCaptionTrackId === track.id"
                  @click="selectCaption(track)"
                >
                  {{ track.name }}
                </button>
                <div
                  class="editor-caption-cues"
                  role="group"
                  :aria-label="
                    t('editor.captions.trackLane', { name: track.name })
                  "
                  @click="selectCaption(track)"
                >
                  <button
                    v-for="cue in track.cues"
                    :key="cue.id"
                    class="editor-caption-cue"
                    :class="{
                      selected:
                        selectedCaptionTrackId === track.id &&
                        selectedCaptionCueId === cue.id,
                    }"
                    :style="{
                      left: `${Math.max(0, (cue.startMs / (captionDuration * 1000)) * 100)}%`,
                      width: `${Math.max(2, ((cue.endMs - cue.startMs) / (captionDuration * 1000)) * 100)}%`,
                    }"
                    :aria-pressed="
                      selectedCaptionTrackId === track.id &&
                      selectedCaptionCueId === cue.id
                    "
                    :aria-label="
                      t('editor.captions.selectCue', {
                        time: duration(cue.startMs / 1000, {
                          fractional: true,
                        }),
                        text: cue.text,
                      })
                    "
                    :title="`${duration(cue.startMs / 1000, { fractional: true })} · ${cue.text}`"
                    data-testid="caption-cue"
                    @click.stop="selectCaption(track, cue.id)"
                    @dblclick="locateCaption(track, cue.id)"
                  >
                    {{ cue.text.replaceAll("\n", " / ") }}
                  </button>
                  <span v-if="!track.cues.length" class="editor-caption-empty">
                    {{ t("editor.captions.noCues") }}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
        <aside
          v-show="inspectorOpen"
          id="timeline-inspector"
          class="editor-inspector"
          :aria-label="t('editor.inspector')"
        >
          <div class="editor-inspector-tabs">
            <button
              :class="{ selected: inspector === 'clip' }"
              :aria-pressed="inspector === 'clip'"
              :disabled="directionBlocked"
              @click="inspector = 'clip'"
            >
              {{ t("editor.clip.title") }}</button
            ><button
              :class="{ selected: inspector === 'beat' }"
              :aria-pressed="inspector === 'beat'"
              :disabled="directionBlocked"
              @click="inspector = 'beat'"
            >
              {{ t("editor.beats.title") }}
            </button>
            <button
              :class="{ selected: inspector === 'sound' }"
              :aria-pressed="inspector === 'sound'"
              :disabled="directionBlocked"
              @click="inspector = 'sound'"
            >
              {{ t("editor.sound.tab") }}
            </button>
            <button
              :class="{ selected: inspector === 'captions' }"
              :aria-pressed="inspector === 'captions'"
              :disabled="directionBlocked"
              data-testid="caption-inspector-tab"
              @click="inspector = 'captions'"
            >
              {{ t("editor.captions.tab") }}
            </button>
            <button
              :class="{ selected: inspector === 'graphics' }"
              :aria-pressed="inspector === 'graphics'"
              :disabled="directionBlocked"
              data-testid="graphic-inspector-tab"
              @click="inspector = 'graphics'"
            >
              {{ t("editor.graphics.tab") }}
            </button>
          </div>
          <GraphicSceneInspector
            v-if="inspector === 'graphics'"
            :scenes="state.composition.graphicScenes ?? []"
            :duration="state.composition.duration"
            :assets="state.assets"
            :disabled="
              directionBlocked ||
              historyBusy ||
              status === 'conflict' ||
              status === 'failed'
            "
            @command="command"
          />
          <template
            v-if="inspector === 'clip' && selectedClip && selectedAsset"
          >
            <div class="editor-inspector-title">
              <h3>{{ selectedAsset.name }}</h3>
              <button
                class="editor-button"
                :aria-label="
                  t(
                    selectedClip.locked
                      ? 'editor.clip.unlock'
                      : 'editor.clip.lock',
                  )
                "
                :aria-pressed="!!selectedClip.locked"
                @click="
                  command({
                    type: 'lock',
                    clipId: selectedClip.id,
                    locked: !selectedClip.locked,
                  })
                "
              >
                <Icon name="lock" :size="14" />{{
                  t(
                    selectedClip.locked
                      ? "editor.clip.locked"
                      : "editor.clip.lock",
                  )
                }}
              </button>
            </div>
            <div
              v-if="selectedAsset.mediaType !== 'image'"
              class="editor-stat-grid"
            >
              <div class="editor-stat">
                <small>{{ t("editor.clip.source") }}</small
                ><strong>{{ duration(selectedAsset.duration) }}</strong>
              </div>
              <div class="editor-stat">
                <small>{{ t("editor.clip.selected") }}</small
                ><strong>{{
                  duration(
                    (selectedClip.sourceOut ?? 0) -
                      (selectedClip.sourceIn ?? 0),
                  )
                }}</strong>
              </div>
              <div class="editor-stat">
                <small>{{ t("editor.clip.timeline") }}</small
                ><strong>{{ duration(selectedClip.timelineDuration) }}</strong>
              </div>
            </div>
            <p v-if="selectedClip.locked" class="editor-note">
              {{ t("editor.clip.protected") }}
            </p>
            <FilmLookInspector
              :composition="state.composition"
              :clip="selectedClip"
              :clip-eligible="lookEligible"
              :clip-protected="!!selectedClip.locked || clipSourceLocked"
              :disabled="historyBusy || directionBlocked"
              @command="command"
            />
            <fieldset
              class="editor-fields"
              :disabled="
                !!selectedClip.locked || lockedOverlaySource || historyBusy
              "
            >
              <template v-if="controls.duration"
                ><label class="editor-field"
                  >{{ t("editor.clip.photoDuration")
                  }}<input
                    v-model.number="clipFields.duration"
                    :aria-label="t('editor.clip.photoDurationLabel')"
                    type="number"
                    min="0.01"
                    step="0.1"
                    @change="
                      editClip({
                        type: 'duration',
                        duration: Number(clipFields.duration),
                      })
                    "
                /></label>
                <div class="editor-presets">
                  <button
                    v-for="seconds in [1.5, 2, 2.5, 3, 4, 5]"
                    :key="seconds"
                    class="editor-button"
                    :class="{
                      selected: selectedClip.timelineDuration === seconds,
                    }"
                    :aria-label="
                      t('editor.clip.photoPreset', {
                        seconds: formatNumber(seconds),
                      })
                    "
                    @click="editClip({ type: 'duration', duration: seconds })"
                  >
                    {{ t("editor.seconds", { value: formatNumber(seconds) }) }}
                  </button>
                </div></template
              >
              <template v-if="controls.trim"
                ><div class="editor-field-pair">
                  <label class="editor-field"
                    >{{ t("editor.clip.sourceIn")
                    }}<input
                      v-model.number="clipFields.sourceIn"
                      :aria-label="t('editor.clip.sourceInLabel')"
                      type="number"
                      min="0"
                      :max="selectedAsset.duration"
                      step="0.01"
                      @change="trim" /></label
                  ><label class="editor-field"
                    >{{ t("editor.clip.sourceOut")
                    }}<input
                      v-model.number="clipFields.sourceOut"
                      :aria-label="t('editor.clip.sourceOutLabel')"
                      type="number"
                      min="0"
                      :max="selectedAsset.duration"
                      step="0.01"
                      @change="trim"
                  /></label></div
              ></template>
              <template v-if="controls.speed"
                ><label class="editor-field"
                  >{{ t("editor.clip.speed")
                  }}<input
                    v-model.number="clipFields.speed"
                    :aria-label="t('editor.clip.speed')"
                    type="number"
                    min="0.01"
                    step="0.1"
                    @change="
                      editClip({
                        type: 'speed',
                        speed: Number(clipFields.speed),
                      })
                    "
                /></label>
                <div class="editor-presets">
                  <button
                    v-for="speed in [0.5, 0.75, 1, 1.25, 1.5, 2]"
                    :key="speed"
                    class="editor-button"
                    :class="{ selected: clipFields.speed === speed }"
                    :aria-label="
                      t('editor.clip.speedPreset', {
                        speed: formatNumber(speed),
                      })
                    "
                    @click="editClip({ type: 'speed', speed })"
                  >
                    {{ formatNumber(speed) }}×
                  </button>
                </div></template
              >
              <template v-if="controls.volume"
                ><label class="editor-field"
                  >{{ t("editor.clip.volume") }} ·
                  {{
                    formatNumber(clipFields.volume, {
                      style: "percent",
                      maximumFractionDigits: 0,
                    })
                  }}<input
                    v-model.number="clipFields.volume"
                    :aria-label="t('editor.clip.volumeLabel')"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    @input="
                      editClip({
                        type: 'volume',
                        volume: Number(clipFields.volume),
                      })
                    " /></label
                ><button
                  class="editor-button"
                  :aria-pressed="clipFields.volume === 0"
                  @click="
                    editClip({
                      type: 'volume',
                      volume: clipFields.volume === 0 ? 1 : 0,
                    })
                  "
                >
                  {{
                    t(
                      clipFields.volume === 0
                        ? "editor.clip.unmute"
                        : "editor.clip.mute",
                    )
                  }}
                </button></template
              >
              <template v-if="controls.visual"
                ><div class="editor-divider" />
                <div class="editor-field-pair">
                  <label class="editor-field"
                    >{{ t("editor.clip.transition")
                    }}<select
                      :aria-label="t('editor.clip.transitionLabel')"
                      :value="selectedClip.transition?.type ?? 'cut'"
                      @change="transition"
                    >
                      <option value="cut">{{ t("editor.clip.cut") }}</option>
                      <option value="crossfade">
                        {{ t("editor.clip.crossfade") }}
                      </option>
                    </select></label
                  ><label v-if="selectedClip.transition" class="editor-field"
                    >{{ t("editor.clip.fadeDuration")
                    }}<input
                      v-model.number="clipFields.transitionDuration"
                      :aria-label="t('editor.clip.fadeDurationLabel')"
                      type="number"
                      min="0.01"
                      :max="selectedClip.timelineDuration"
                      step="0.1"
                      @change="
                        editClip({
                          type: 'transition',
                          transition: 'crossfade',
                          duration: Number(clipFields.transitionDuration),
                        })
                      "
                  /></label>
                </div>
                <div class="editor-field-pair">
                  <label class="editor-field"
                    >{{ t("editor.clip.scale")
                    }}<input
                      v-model.number="clipFields.scale"
                      :aria-label="t('editor.clip.scaleLabel')"
                      type="number"
                      min="0.01"
                      step="0.1"
                      @change="transform" /></label
                  ><label class="editor-field"
                    >{{ t("editor.clip.rotation")
                    }}<input
                      v-model.number="clipFields.rotation"
                      :aria-label="t('editor.clip.rotationLabel')"
                      type="number"
                      step="1"
                      @change="transform"
                  /></label>
                </div>
                <div class="editor-field-pair">
                  <label class="editor-field"
                    >{{ t("editor.clip.x")
                    }}<input
                      v-model.number="clipFields.x"
                      :aria-label="t('editor.clip.xLabel')"
                      type="number"
                      step="1"
                      @change="transform" /></label
                  ><label class="editor-field"
                    >{{ t("editor.clip.y")
                    }}<input
                      v-model.number="clipFields.y"
                      :aria-label="t('editor.clip.yLabel')"
                      type="number"
                      step="1"
                      @change="transform"
                  /></label>
                </div>
                <div class="editor-actions editor-geometry-actions">
                  <button class="editor-button" @click="rotateSelected(-90)">
                    ↺ −90°
                  </button>
                  <button class="editor-button" @click="rotateSelected(90)">
                    ↻ +90°
                  </button>
                  <button class="editor-button" @click="resetSelectedTransform">
                    {{ t("editor.monitor.resetTransform") }}
                  </button>
                </div>
              </template>
              <fieldset
                v-if="controls.visual"
                class="editor-fields"
                :disabled="clipSourceLocked"
              >
                <p v-if="clipSourceLocked" class="editor-note">
                  {{ t("editor.clip.sourceProtected") }}
                </p>
                <PhotoPresentationInspector
                  :clip="selectedClip"
                  :asset="selectedAsset"
                  :assets="state.assets"
                  :frame="projectSettings"
                  :allow-photo-presentation="photoPresentationAllowed"
                  @command="command"
                />
              </fieldset>
            </fieldset>
            <SceneDirectionReview
              v-if="
                selectedAsset.mediaType === 'image' && photoPresentationAllowed
              "
              ref="directionReview"
              :project-id="projectId"
              :composition-id="compositionId"
              :state="state"
              :clip="selectedClip"
              :frame="projectSettings"
              :source-version="sourceVersion"
              :disabled="
                !!selectedClip.locked ||
                clipSourceLocked ||
                !!sourceUnavailable ||
                compositionHistoryBusy
              "
              :flush-inputs="flushInputs"
              :reload-saved="reloadDirectionState"
              @preview="directionPreview = $event"
              @edited="emit('edited')"
            />
            <fieldset
              class="editor-fields"
              :disabled="
                !!selectedClip.locked || lockedOverlaySource || historyBusy
              "
            >
              <div class="editor-divider" />
              <div class="editor-actions">
                <button
                  class="editor-button"
                  :aria-label="t('editor.clip.earlierLabel')"
                  :disabled="selectedIndex <= 0"
                  @click="move(-1)"
                >
                  ← {{ t("editor.clip.earlier") }}</button
                ><button
                  class="editor-button"
                  :aria-label="t('editor.clip.laterLabel')"
                  :disabled="selectedIndex >= peers.length - 1"
                  @click="move(1)"
                >
                  {{ t("editor.clip.later") }} →
                </button>
              </div>
              <label class="editor-field"
                >{{ t("editor.clip.replaceWith")
                }}<select
                  v-model="replacementId"
                  :aria-label="t('editor.clip.replacementLabel')"
                  :disabled="clipSourceLocked"
                >
                  <option value="">
                    {{ t("editor.clip.chooseReplacement") }}
                  </option>
                  <option
                    v-for="asset in replacements"
                    :key="asset.id"
                    :value="asset.id"
                  >
                    {{ asset.name }}
                  </option>
                </select></label
              >
              <div class="editor-actions">
                <button
                  class="editor-button"
                  :disabled="!replacementId || clipSourceLocked"
                  @click="replace"
                >
                  {{ t("editor.clip.replace") }}</button
                ><button
                  class="editor-button danger"
                  :disabled="clipSourceLocked"
                  @click="deleteSelected"
                >
                  {{ t("editor.clip.delete") }}
                </button>
              </div>
            </fieldset>
            <details class="editor-technical-details">
              <summary>{{ t("editor.sourceDetails") }}</summary>
              <SourceDetails :asset="selectedAsset" compact />
            </details>
          </template>
          <SoundtrackPanel
            v-else-if="inspector === 'sound'"
            :composition="state.composition"
            :assets="state.assets"
            :selected-clip="selectedClip"
            :busy="historyBusy"
            :active="active && editMode === 'story'"
            :source-version="sourceVersion"
            @command="command"
            @select="
              (clip) => {
                chooseClip(clip);
                inspector = 'sound';
              }
            "
          />
          <template v-else-if="inspector === 'captions'">
            <div class="editor-inspector-title">
              <h3>{{ t("editor.captions.inspector") }}</h3>
              <button
                class="editor-button"
                :disabled="historyBusy"
                @click="addCaptionCue"
              >
                {{ t("editor.captions.addCue") }}
              </button>
            </div>
            <label v-if="captionTracks.length" class="editor-field">
              {{ t("editor.captions.track") }}
              <select
                :value="selectedCaptionTrackId"
                :disabled="historyBusy"
                @change="
                  selectCaption(
                    captionTracks.find(
                      (track) =>
                        track.id === ($event.target as HTMLSelectElement).value,
                    )!,
                  )
                "
              >
                <option
                  v-for="track in captionTracks"
                  :key="track.id"
                  :value="track.id"
                >
                  {{ track.name }}
                </option>
              </select>
            </label>
            <template v-if="selectedCaptionTrack">
              <div v-if="selectedCaptionCue" class="editor-fields">
                <label class="editor-field">
                  {{ t("editor.captions.text") }}
                  <textarea
                    :value="selectedCaptionCue.text"
                    :aria-label="t('editor.captions.text')"
                    maxlength="2000"
                    rows="3"
                    :disabled="historyBusy"
                    data-testid="caption-text"
                    @change="
                      updateCaptionCue({
                        text: ($event.target as HTMLTextAreaElement).value,
                      })
                    "
                  />
                </label>
                <div class="editor-field-pair">
                  <label class="editor-field">
                    {{ t("editor.captions.startMs") }}
                    <input
                      :value="selectedCaptionCue.startMs"
                      type="number"
                      min="0"
                      :max="selectedCaptionCue.endMs - 1"
                      step="100"
                      :disabled="historyBusy"
                      data-testid="caption-start"
                      @change="
                        updateCaptionCue({
                          startMs: Number(
                            ($event.target as HTMLInputElement).value,
                          ),
                        })
                      "
                    />
                  </label>
                  <label class="editor-field">
                    {{ t("editor.captions.endMs") }}
                    <input
                      :value="selectedCaptionCue.endMs"
                      type="number"
                      :min="selectedCaptionCue.startMs + 1"
                      :max="Math.round(captionDuration * 1000)"
                      step="100"
                      :disabled="historyBusy"
                      data-testid="caption-end"
                      @change="
                        updateCaptionCue({
                          endMs: Number(
                            ($event.target as HTMLInputElement).value,
                          ),
                        })
                      "
                    />
                  </label>
                </div>
                <button
                  class="editor-button"
                  :disabled="historyBusy"
                  @click="
                    locateCaption(selectedCaptionTrack, selectedCaptionCue.id)
                  "
                >
                  {{ t("editor.captions.locate") }}
                </button>
                <button
                  class="editor-button danger"
                  :disabled="historyBusy"
                  @click="deleteCaptionCue"
                >
                  {{ t("editor.captions.deleteCue") }}
                </button>
              </div>
              <fieldset class="editor-fields" :disabled="historyBusy">
                <legend>{{ t("editor.captions.style") }}</legend>
                <label class="editor-field">
                  {{ t("editor.captions.font") }}
                  <input
                    :value="
                      selectedCaptionTrack.style.fontFamily ??
                      'Noto Sans CJK TC'
                    "
                    :aria-label="t('editor.captions.font')"
                    type="text"
                    maxlength="120"
                    data-testid="caption-font"
                    @change="updateCaptionStyle('fontFamily', $event)"
                  />
                </label>
                <label class="editor-field">
                  {{ t("editor.captions.fontSize") }}
                  <input
                    :value="selectedCaptionTrack.style.fontSize ?? 32"
                    :aria-label="t('editor.captions.fontSize')"
                    type="number"
                    min="8"
                    max="240"
                    step="1"
                    data-testid="caption-font-size"
                    @change="updateCaptionStyle('fontSize', $event)"
                  />
                </label>
                <fieldset
                  class="editor-caption-safe-area"
                  :disabled="historyBusy"
                >
                  <legend>{{ t("editor.captions.safeArea") }}</legend>
                  <label
                    v-for="side in ['left', 'right', 'top', 'bottom'] as const"
                    :key="side"
                    class="editor-field"
                  >
                    {{ t(`editor.captions.${side}`) }}
                    <input
                      :value="
                        Math.round(
                          (selectedCaptionTrack.style.safeArea?.[side] ??
                            (side === 'bottom' ? 0.12 : 0.08)) * 100,
                        )
                      "
                      type="number"
                      min="0"
                      max="30"
                      step="1"
                      :data-testid="`caption-safe-${side}`"
                      :aria-label="t(`editor.captions.${side}`)"
                      @change="updateCaptionSafeArea(side, $event)"
                    />
                  </label>
                </fieldset>
              </fieldset>
              <p v-if="!selectedCaptionCue" class="editor-note">
                {{ t("editor.captions.chooseCue") }}
              </p>
              <p class="editor-note">{{ t("editor.captions.manualReview") }}</p>
            </template>
            <p v-else class="editor-note">{{ t("editor.captions.empty") }}</p>
          </template>
          <template v-else-if="inspector === 'beat' && selectedBeat"
            ><div class="editor-inspector-title">
              <h3>{{ selectedBeat.title }}</h3>
            </div>
            <fieldset class="editor-fields" :disabled="historyBusy">
              <label class="editor-field"
                >{{ t("editor.beats.name")
                }}<input
                  v-model="beatFields.title"
                  :aria-label="t('editor.beats.nameLabel')"
                  @change="editBeat" /></label
              ><label class="editor-field"
                >{{ t("editor.beats.intent")
                }}<textarea
                  v-model="beatFields.intent"
                  :aria-label="t('editor.beats.intentLabel')"
                  rows="3"
                  @change="editBeat"
                /></label
              ><label class="editor-field"
                >{{ t("editor.beats.target")
                }}<input
                  v-model.number="beatFields.targetDuration"
                  :aria-label="t('editor.beats.targetLabel')"
                  type="number"
                  min="0.01"
                  step="0.1"
                  @change="editBeat"
              /></label>
              <div class="editor-field-pair">
                <label class="editor-field"
                  >{{ t("editor.beats.minimum")
                  }}<input
                    v-model.number="beatFields.minDuration"
                    :aria-label="t('editor.beats.minimumLabel')"
                    type="number"
                    min="0"
                    step="0.1"
                    @change="editBeat" /></label
                ><label class="editor-field"
                  >{{ t("editor.beats.maximum")
                  }}<input
                    v-model.number="beatFields.maxDuration"
                    :aria-label="t('editor.beats.maximumLabel')"
                    type="number"
                    min="0.01"
                    step="0.1"
                    @change="editBeat"
                /></label>
              </div>
              <div class="editor-divider" />
              <h3>{{ t("editor.rhythm.title") }}</h3>
              <p class="editor-note">{{ t("editor.rhythm.scope") }}</p>
              <div class="editor-presets">
                <button
                  v-for="action in regenerateModes"
                  :key="action.mode"
                  class="editor-button"
                  @click="
                    command({
                      type: 'regenerate-beat',
                      beatId: selectedBeat.id,
                      mode: action.mode,
                    })
                  "
                >
                  {{ t(action.label) }}
                </button>
              </div>
            </fieldset></template
          >
          <p v-else class="editor-note">
            {{
              t(
                inspector === "beat"
                  ? "editor.beats.choose"
                  : "editor.clip.choose",
              )
            }}
          </p>
        </aside>
      </div>
      <footer v-show="editMode === 'story'" class="editor-shortcuts">
        <span>{{ t("editor.originalsSafe") }}</span
        ><span>{{ t("editor.shortcuts") }}</span>
      </footer>
    </template>
  </section>
</template>
