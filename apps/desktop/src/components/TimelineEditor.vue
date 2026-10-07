<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  resolveClipGeometry,
  resolvePreviewClipGeometry,
  type Clip,
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
  type EditorState,
  type SourceStatus,
} from "../api";
import { useTimelineEditor } from "../composables/useTimelineEditor";
import Icon from "./Icon.vue";
import SourceDetails from "./SourceDetails.vue";
import PrecisionEditor from "./PrecisionEditor.vue";
import TranscriptEditor from "./TranscriptEditor.vue";
import { sourcePresentation } from "../sourcePresentation";
import { useI18n } from "vue-i18n";
import { formatDuration as duration, formatNumber, formatDate } from "../i18n";
import { durationStatus } from "../duration";
import { clipControls, shorteningAction } from "../editorPresentation";
const { t } = useI18n();

const props = defineProps<{
  projectId: string;
  compositionId: string;
  active: boolean;
  sourceStatuses?: Record<string, SourceStatus>;
  sourceVersion?: number;
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
  historyBusy,
  command,
  flush: flushComposition,
  history: compositionHistory,
  reapplyDraft,
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
const hasPending = computed(
  () =>
    compositionHasPending.value ||
    !!transcriptEditor.value?.hasPending ||
    !!precisionEditor.value?.hasPending,
);
async function history(direction: "undo" | "redo") {
  if (precisionEditor.value?.hasPending) return false;
  return compositionHistory(direction);
}
async function flush() {
  if (!(await flushComposition())) return false;
  if (transcriptEditor.value && !(await transcriptEditor.value.flush()))
    return false;
  return (await precisionEditor.value?.flush()) ?? true;
}
defineExpose({ flush, hasPending, reload: load });
const selectedClipId = ref("");
const selectedBeatId = ref("");
const inspector = ref<"clip" | "beat">("clip");
const editMode = ref<"story" | "precision" | "transcript">("story");
const showFit = ref(false);
const inspectorOpen = ref(true);
const editorElement = ref<HTMLElement | null>(null);
const workspaceElement = ref<HTMLElement | null>(null);
const sourceScreenElement = ref<HTMLElement | null>(null);
const sourceViewport = ref<FrameSize>({ width: 1, height: 1 });
const sourcePreviewSize = ref<FrameSize>();
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
const fitPreview = ref<ShorteningSuggestionPreview | null>(null);
const draftAction = ref<"discard" | "reapply" | null>(null);
const draftConfirmation = ref<HTMLElement | null>(null);
let draftTrigger: HTMLElement | null = null;
const draggedClipId = ref("");
const replacementId = ref("");
const sourcePlayer = ref<HTMLMediaElement | null>(null);
const sourceError = ref("");
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
const selectedClip = computed(() =>
  allClips.value.find((clip) => clip.id === selectedClipId.value),
);
const assetMap = computed(
  () => new Map(state.value?.assets.map((asset) => [asset.id, asset]) ?? []),
);
const selectedAsset = computed(
  () => selectedClip.value && assetMap.value.get(selectedClip.value.assetId),
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
    `${selectedAsset.value?.id}:${selectedAsset.value?.uri}:${props.sourceVersion ?? 0}`,
);
const selectedBeat = computed(() =>
  state.value?.story.beats.find((beat) => beat.id === selectedBeatId.value),
);
const groups = computed(() => {
  const beats = state.value?.story.beats ?? [];
  const list = beats.map((beat) => ({
    id: beat.id,
    title: beat.title,
    intent: beat.intent,
    clips: allClips.value.filter((clip) => clip.beatId === beat.id),
  }));
  const loose = allClips.value.filter(
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
  if (precisionEditor.value?.hasPending) return;
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
  if (openInspector) inspectorOpen.value = true;
  selectedClipId.value = clip.id;
  selectedBeatId.value = clip.beatId ?? "";
  inspector.value = "clip";
}
function chooseBeat(beatId: string) {
  inspectorOpen.value = true;
  selectedBeatId.value = beatId;
  inspector.value = "beat";
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
const previewFrameStyle = computed(() => ({
  width: `${previewGeometry.value.frame.width}px`,
  height: `${previewGeometry.value.frame.height}px`,
}));
const previewMediaStyle = computed(() => ({
  width: `${previewGeometry.value.media.width}px`,
  height: `${previewGeometry.value.media.height}px`,
  transform: `translate(${previewGeometry.value.x}px, ${previewGeometry.value.y}px) rotate(${previewGeometry.value.rotation}deg) scale(${previewGeometry.value.scale})`,
}));
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
  try {
    player.playbackRate = clip.transform?.speed ?? 1;
    if (sourceError.value === unsupportedSpeedMessage) sourceError.value = "";
  } catch {
    player.pause();
    sourceError.value = unsupportedSpeedMessage;
  }
  player.volume = clip.transform?.volume ?? 1;
}
function stopAtOut() {
  const player = sourcePlayer.value;
  if (
    player &&
    playbackClip.value?.sourceOut !== undefined &&
    player.currentTime >= playbackClip.value.sourceOut
  ) {
    player.pause();
    player.currentTime = playbackClip.value?.sourceIn ?? 0;
  }
}
function togglePlayback() {
  if (selectedSourceInfo.value?.previewSupported === false) return;
  const player = sourcePlayer.value;
  if (!player) {
    emit("playback");
    return;
  }
  if (player.paused)
    void player.play().catch(() => {
      sourceError.value = "playback";
    });
  else player.pause();
}
function keyboard(event: KeyboardEvent) {
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
      if (width > 0 && height > 0) sourceViewport.value = { width, height };
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
    workspaceHeight.value = Math.max(
      editMode.value !== "story" ? 416 : 272,
      Math.floor(
        window.innerHeight -
          Math.max(0, workspace.getBoundingClientRect().top) -
          footerHeight -
          16,
      ),
    );
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
  () => fitPreviewAfter.value ?? selectedClip.value,
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
  sourcePreviewSize.value = undefined;
});
watch(
  () => props.active,
  (active) => {
    if (!active) sourcePlayer.value?.pause();
    else void nextTick(measureWorkspace);
  },
);
watch(editMode, () => {
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
onMounted(() => {
  inspectorOpen.value = !window.matchMedia("(max-width: 1100px)").matches;
  window.addEventListener("keydown", keyboard);
  window.addEventListener("resize", measureWorkspace);
  layoutObserver = new ResizeObserver(measureWorkspace);
  if (editorElement.value) {
    layoutObserver.observe(editorElement.value);
    if (editorElement.value.parentElement)
      layoutObserver.observe(editorElement.value.parentElement);
  }
  if (sourceScreenElement.value && props.active && editMode.value === "story")
    layoutObserver.observe(sourceScreenElement.value);
  measureWorkspace();
});
onBeforeUnmount(() => {
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
          :analysis-recovery="analysisRecovery"
          :recovering-analysis-jobs="recoveringAnalysisJobs"
          :unavailable="
            !!sourceUnavailable ||
            selectedSourceInfo?.previewSupported === false
          "
          :source-version="sourceVersion"
          :height="workspaceHeight"
          :clips="allClips.map((clip) => ({ id: clip.id, label: name(clip) }))"
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
          :clips="allClips.map((clip) => ({ id: clip.id, label: name(clip) }))"
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
              <template v-if="selectedAsset">
                <div v-if="sourceUnavailable" class="editor-missing-source">
                  <img
                    v-if="selectedAsset.thumbnailUri"
                    :src="thumbnailUrl(selectedAsset.id)"
                    alt=""
                  />
                  <div>
                    <Icon name="folder" :size="24" /><strong>{{
                      t(
                        selectedSourceStatus?.status === "inaccessible"
                          ? "editor.source.inaccessible"
                          : "editor.source.missing",
                      )
                    }}</strong
                    ><span>{{ t("editor.source.editsSafe") }}</span>
                  </div>
                </div>
                <div
                  v-else-if="selectedSourceInfo?.previewSupported === false"
                  class="editor-unsupported-source"
                >
                  <img
                    v-if="selectedAsset.thumbnailUri"
                    :src="thumbnailUrl(selectedAsset.id)"
                    alt=""
                  />
                  <div>
                    <Icon name="film" :size="28" /><strong>{{
                      t(
                        selectedSourceInfo.requiresReframedExport
                          ? "editor.source.spherical"
                          : "editor.source.unavailable",
                      )
                    }}</strong
                    ><span>{{ selectedSourceInfo.kindLabel }}</span>
                    <p>
                      {{
                        t(
                          selectedSourceInfo.requiresReframedExport
                            ? "editor.source.reframe"
                            : "editor.source.convert",
                        )
                      }}
                    </p>
                  </div>
                </div>
                <div
                  v-else-if="selectedAsset.mediaType === 'image'"
                  class="editor-composition-frame"
                  :style="previewFrameStyle"
                >
                  <img
                    :key="sourcePlaybackKey"
                    :src="sourceUrl(selectedAsset.id, sourcePlaybackKey)"
                    :alt="selectedAsset.name"
                    :style="previewMediaStyle"
                    @load="capturePreviewSize"
                    @error="sourceError = 'photo'"
                  />
                </div>
                <div
                  v-else-if="selectedAsset.mediaType === 'audio'"
                  class="editor-audio-preview"
                >
                  <Icon name="volume" :size="40" /><audio
                    v-if="active && editMode === 'story'"
                    ref="sourcePlayer"
                    :key="sourcePlaybackKey"
                    :src="sourceUrl(selectedAsset.id, sourcePlaybackKey)"
                    controls
                    preload="metadata"
                    :aria-label="t('editor.source.preview')"
                    @loadedmetadata="configurePlayer"
                    @timeupdate="stopAtOut"
                    @play="playing = true"
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
                    :src="sourceUrl(selectedAsset.id, sourcePlaybackKey)"
                    :poster="
                      selectedAsset.thumbnailUri
                        ? thumbnailUrl(selectedAsset.id)
                        : undefined
                    "
                    controls
                    preload="metadata"
                    :aria-label="t('editor.source.preview')"
                    :style="previewMediaStyle"
                    @loadedmetadata="
                      capturePreviewSize($event);
                      configurePlayer();
                    "
                    @timeupdate="stopAtOut"
                    @play="playing = true"
                    @pause="playing = false"
                    @error="sourceError = 'playback'"
                  />
                </div>
              </template>
              <div v-else class="editor-source-empty">
                <Icon name="film" :size="30" /><span>{{
                  t("editor.source.choose")
                }}</span>
              </div>
            </div>
            <div class="editor-source-caption">
              <span :title="selectedAsset?.name"
                >{{ selectedAsset?.name ?? t("editor.yourStory") }}
                <small
                  >·
                  {{
                    t(
                      fitPreview
                        ? "editor.fit.preview"
                        : "editor.source.selected",
                    )
                  }}</small
                ></span
              ><button
                v-if="
                  selectedAsset &&
                  !sourceUnavailable &&
                  selectedSourceInfo?.previewSupported !== false &&
                  selectedAsset.mediaType !== 'image'
                "
                class="editor-button"
                @click="togglePlayback"
              >
                {{ t(playing ? "editor.source.pause" : "editor.source.play") }}
              </button>
            </div>
            <div
              v-if="sourceUnavailable || sourceError"
              class="editor-source-warning"
              role="status"
            >
              <p>
                {{
                  t(
                    sourceUnavailable
                      ? "editor.source.reconnect"
                      : `editor.source.error.${sourceError}`,
                  )
                }}
              </p>
              <details v-if="selectedSourceStatus?.message">
                <summary>{{ t("editor.technicalDetails") }}</summary>
                <p>{{ selectedSourceStatus.message }}</p>
              </details>
              <button
                v-if="selectedAsset && sourceError !== unsupportedSpeedMessage"
                class="editor-button"
                :aria-label="t('editor.source.relinkLabel')"
                @click="emit('relink', selectedAsset.id)"
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
                <button
                  v-for="clip in group.clips"
                  :id="`clip-${clip.id}`"
                  :key="clip.id"
                  class="editor-clip"
                  :class="{
                    selected: selectedClipId === clip.id,
                    locked: clip.locked,
                  }"
                  :style="{
                    width: `${Math.min(240, Math.max(120, clip.timelineDuration * 24))}px`,
                  }"
                  :aria-label="
                    t(
                      clip.locked
                        ? 'editor.clip.selectLocked'
                        : 'editor.clip.select',
                      { name: name(clip) },
                    )
                  "
                  :aria-pressed="selectedClipId === clip.id"
                  :draggable="!clip.locked"
                  @click="chooseClip(clip)"
                  @dragstart="draggedClipId = clip.id"
                  @dragend="draggedClipId = ''"
                  @dragover.prevent
                  @drop.prevent="drop(clip)"
                >
                  <img
                    v-if="assetMap.get(clip.assetId)?.thumbnailUri"
                    :src="thumbnailUrl(clip.assetId)"
                    alt=""
                    loading="lazy"
                    draggable="false"
                  /><span v-else class="editor-source-empty"
                    ><Icon
                      :name="
                        assetMap.get(clip.assetId)?.mediaType === 'audio'
                          ? 'volume'
                          : 'film'
                      "
                  /></span>
                  <span
                    v-if="
                      sourceStatuses?.[clip.assetId] &&
                      sourceStatuses[clip.assetId]?.status !== 'available'
                    "
                    class="editor-clip-source-status"
                    >{{
                      t(
                        sourceStatuses[clip.assetId]?.status === "missing"
                          ? "editor.source.missingShort"
                          : "editor.source.inaccessibleShort",
                      )
                    }}</span
                  >
                  <span v-if="clip.locked" class="editor-clip-badge"
                    ><Icon name="lock" :size="11" />{{
                      t("editor.clip.locked")
                    }}</span
                  ><span class="editor-clip-meta"
                    ><strong>{{ name(clip) }}</strong
                    ><small
                      >{{ duration(clip.timelineDuration)
                      }}<span
                        v-if="
                          clip.transform?.speed && clip.transform.speed !== 1
                        "
                      >
                        · {{ formatNumber(clip.transform.speed) }}×</span
                      ><span v-if="clip.transition">
                        · {{ t("editor.clip.fade") }}</span
                      ></small
                    ></span
                  >
                </button>
                <p v-if="!group.clips.length" class="editor-note">
                  {{ t("editor.beats.empty") }}
                </p>
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
              @click="inspector = 'clip'"
            >
              {{ t("editor.clip.title") }}</button
            ><button
              :class="{ selected: inspector === 'beat' }"
              :aria-pressed="inspector === 'beat'"
              @click="inspector = 'beat'"
            >
              {{ t("editor.beats.title") }}
            </button>
          </div>
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
            <fieldset
              class="editor-fields"
              :disabled="!!selectedClip.locked || historyBusy"
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
              </template>
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
                  :disabled="!replacementId"
                  @click="replace"
                >
                  {{ t("editor.clip.replace") }}</button
                ><button class="editor-button danger" @click="deleteSelected">
                  {{ t("editor.clip.delete") }}
                </button>
              </div>
            </fieldset>
            <details class="editor-technical-details">
              <summary>{{ t("editor.sourceDetails") }}</summary>
              <SourceDetails :asset="selectedAsset" compact />
            </details>
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
