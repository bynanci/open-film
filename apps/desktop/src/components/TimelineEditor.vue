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
  resolvePrimaryColor,
  PRIMARY_COLOR_IDENTITY,
  resolvePreviewClipGeometry,
  evaluateAudioGain,
  resolveCompositionFrame,
  resolveProjectTimebase,
  formatSequenceTimecode,
  sequenceFrameAt,
  sequenceTimeAt,
  timebaseKey,
  type Clip,
  type CaptionTrack,
  type TitleTextRuns,
  type FrameSize,
  type Job,
  type MediaAsset,
  type ProjectSettings,
  type ProjectTimebaseV1,
  type ProjectContentLocale,
  type PhotoFocalPoint,
  type StoryBeat,
  type Track,
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
import {
  useTimelineEditor,
  type CommitTransactionOptions,
} from "../composables/useTimelineEditor";
import { api } from "../api";
import Icon from "./Icon.vue";
import TimelineClip from "./TimelineClip.vue";
import SourceDetails from "./SourceDetails.vue";
import PrecisionEditor from "./PrecisionEditor.vue";
import RecordMonitor from "./RecordMonitor.vue";
import SequenceWaveform from "./SequenceWaveform.vue";
import EditDecisionRibbon from "./EditDecisionRibbon.vue";
import ShortcutSheet from "./ShortcutSheet.vue";
import {
  preferences,
  setCutDeskMonitorLayout,
  setCutDeskSplitRatio,
} from "../preferences";
import ClipTransformOverlay from "./ClipTransformOverlay.vue";
import TimecodeField from "./TimecodeField.vue";
import { sameRateDropFrameChoice } from "../projectTimebase";
import TranscriptEditor from "./TranscriptEditor.vue";
import GraphicSceneInspector from "./GraphicSceneInspector.vue";
import GraphicSceneTemplateStudio from "./GraphicSceneTemplateStudio.vue";
import GraphicScenePreview from "./GraphicScenePreview.vue";
import PhotoPresentationPreview from "./PhotoPresentationPreview.vue";
import NativeTitlePreview from "./NativeTitlePreview.vue";
import NativeCaptionPreview from "./NativeCaptionPreview.vue";
import NativeTextFontStatus from "./NativeTextFontStatus.vue";
import BilingualTextControls from "./BilingualTextControls.vue";
import TitleFinishingControls from "./TitleFinishingControls.vue";
import PhotoPresentationInspector from "./PhotoPresentationInspector.vue";
import PrimaryColorInspector from "./PrimaryColorInspector.vue";
import PrimaryColorFilter from "./PrimaryColorFilter.vue";
import { sourceColorStyle } from "../source-color";
import FilmLookInspector from "./FilmLookInspector.vue";
import FilmLookFilter from "./FilmLookFilter.vue";
import SceneDirectionReview from "./SceneDirectionReview.vue";
import SoundtrackPanel from "./SoundtrackPanel.vue";
import AudioTimingInspector from "./AudioTimingInspector.vue";
import VisualQaPanel from "./VisualQaPanel.vue";
import AudioGenerationPanel from "./AudioGenerationPanel.vue";
import MotionGenerationPanel from "./MotionGenerationPanel.vue";
import AudioQualityPanel from "./AudioQualityPanel.vue";
import type { ClipTransformDraft } from "../clipTransformInteraction";
const audioQualityOpen = ref(false);
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
import { hasGraphicSceneAgentReceipt } from "../graphic-scene-agent-receipt";
import {
  clampFrameStep,
  formatTimecode,
  frameGuideRect,
  mapFramePixelOffsetToViewport,
  nextStableWorkspaceHeight,
  playbackBoundaryAction,
  restartTimeAtClipBoundary,
  roundFrameDimensions,
  ownsSourceShortcut,
} from "../monitor";
const { t } = useI18n();

const props = defineProps<{
  projectId: string;
  compositionId: string;
  active: boolean;
  expertMode?: boolean;
  shortcutsBlocked?: boolean;
  timebasePending?: boolean;
  timebaseError?: string;
  sourceStatuses?: Record<string, SourceStatus>;
  sourceVersion?: number;
  previewVisible?: boolean;
  jobs?: readonly Job[];
  analysisRecovery?: Record<string, import("../api").AnalysisJobRecoveryState>;
  recoveringAnalysisJobs?: Record<string, boolean>;
  projectSettings: ProjectSettings;
  projectContentLocale?: ProjectContentLocale;
  captionTrackId?: string | null;
}>();
const emit = defineEmits<{
  change: [state: EditorState];
  edited: [];
  playback: [];
  importAssets: [];
  relink: [assetId: string];
  activity: [];
  recoverAnalysis: [job: Job, input: import("../api").AnalysisRecoveryInput];
  timebaseChange: [timebase: ProjectTimebaseV1];
  captionTrack: [trackId: string | null | undefined];
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
  transactionBusy: compositionTransactionBusy,
  command: compositionCommand,
  commitTransaction: compositionCommitTransaction,
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
  () => resolveProjectTimebase(props.projectSettings),
);
const transcriptEditor = ref<InstanceType<typeof TranscriptEditor> | null>(
  null,
);
const precisionEditor = ref<InstanceType<typeof PrecisionEditor> | null>(null);
const precisionEditorDual = ref<InstanceType<typeof PrecisionEditor> | null>(
  null,
);
const currentPrecision = computed(
  () =>
    (cutDeskDualMode.value
      ? precisionEditorDual.value
      : precisionEditor.value) ?? precisionEditor.value,
);
const clipTransformOverlay = ref<InstanceType<
  typeof ClipTransformOverlay
> | null>(null);
const pictureAdjusting = ref(false);
const pictureGestureActive = ref(false);
const pictureTransactionPending = ref(false);
const focalEditing = ref(false);
const focalGestureActive = ref(false);
const focalTransactionPending = ref(false);
const focalDraft = shallowRef<Clip | null>(null);
let focalContext: {
  key: string;
  projectId: string;
  compositionId: string;
  clipId: string;
  revision: string;
  epoch: number;
} | null = null;
let focalAbort: AbortController | undefined;
let focalEpoch = 0;
const directionReview = ref<InstanceType<typeof SceneDirectionReview> | null>(
  null,
);
const generationImportBusy = ref(false);
const audioGenerationOpen = ref(false);
let generationImportEpoch = 0;
let generationImportDisposed = false;
const graphicAgentBusy = ref(false);
watch(
  () => [props.projectId, props.compositionId],
  () => {
    generationImportEpoch++;
    generationImportBusy.value = false;
  },
);
const graphicAgentPending = ref(
  hasGraphicSceneAgentReceipt(props.projectId, props.compositionId),
);
watch(
  [() => props.projectId, () => props.compositionId],
  () => {
    graphicAgentPending.value = hasGraphicSceneAgentReceipt(
      props.projectId,
      props.compositionId,
    );
  },
  { flush: "sync" },
);
const directionPending = computed(() => !!directionReview.value?.hasPending);
const directionBlocked = computed(() => !!directionReview.value?.blocksEdits);
const historyBusy = computed(
  () =>
    generationImportBusy.value ||
    compositionHistoryBusy.value ||
    compositionTransactionBusy.value ||
    pictureGestureActive.value ||
    pictureTransactionPending.value ||
    focalGestureActive.value ||
    focalTransactionPending.value ||
    directionBlocked.value ||
    graphicAgentBusy.value ||
    graphicAgentPending.value,
);
const directionPreview = ref<Clip | null>(null);
const visualQaOpen = ref(false);
const visualQaToggle = ref<HTMLButtonElement | null>(null);
const visualQaPopover = ref<HTMLElement | null>(null);
async function toggleVisualQa() {
  visualQaOpen.value = !visualQaOpen.value;
  if (visualQaOpen.value) {
    await nextTick();
    visualQaPopover.value?.focus();
  } else {
    visualQaToggle.value?.focus();
  }
}
async function closeVisualQa() {
  visualQaOpen.value = false;
  await nextTick();
  visualQaToggle.value?.focus();
}
function command(
  input: TimelineCommand | TimelineCommand[],
  referencedAssets: readonly MediaAsset[] = [],
) {
  if (
    generationImportBusy.value ||
    directionBlocked.value ||
    graphicAgentBusy.value ||
    graphicAgentPending.value ||
    focalGestureActive.value ||
    focalTransactionPending.value
  )
    return false;
  if (focalEditing.value) cancelFocal();
  directionPreview.value = null;
  return compositionCommand(input, referencedAssets);
}
async function changeUserPin(
  target: import("@openfilm/core").OverrideTarget,
  pinned: boolean,
  resolve = false,
) {
  if (
    directionBlocked.value ||
    graphicAgentBusy.value ||
    graphicAgentPending.value
  )
    return;
  const result = await compositionCommitTransaction(
    resolve
      ? {
          type: "user-pin.resolve",
          targets: [target],
          scope: { kind: "composition" },
          mode: "regenerate",
        }
      : { type: "user-pin.set", target, pinned },
  );
  if (result.status === "accepted") reportNotice("editor.pins.saved");
}
async function commitSource(
  input: TimelineCommand,
  signal?: AbortSignal,
  options?: CommitTransactionOptions,
) {
  if (
    generationImportBusy.value ||
    directionBlocked.value ||
    graphicAgentBusy.value ||
    graphicAgentPending.value
  )
    return { status: "failed" as const };
  directionPreview.value = null;
  return compositionCommitTransaction(input, [], signal, options);
}
async function commitSoundTiming(input: TimelineCommand): Promise<boolean> {
  const result = await commitSource(input);
  return result.status === "accepted";
}
function templateCommand(
  input: TimelineCommand,
  referencedAssets: MediaAsset[],
  complete: (accepted: boolean) => void,
) {
  complete(command(input, referencedAssets));
}
const hasPending = computed(
  () =>
    generationImportBusy.value ||
    compositionHasPending.value ||
    pictureGestureActive.value ||
    pictureTransactionPending.value ||
    focalGestureActive.value ||
    focalTransactionPending.value ||
    !!transcriptEditor.value?.hasPending ||
    !!currentPrecision.value?.hasPending ||
    directionPending.value ||
    graphicAgentPending.value,
);
async function history(direction: "undo" | "redo") {
  if (currentPrecision.value?.hasPending || historyBusy.value) return false;
  clipTransformOverlay.value?.cancel();
  return compositionHistory(direction);
}
async function flushInputs() {
  if (focalTransactionPending.value) return false;
  cancelFocal();
  clipTransformOverlay.value?.cancel();
  if (!(await flushComposition())) return false;
  if (transcriptEditor.value && !(await transcriptEditor.value.flush()))
    return false;
  return (await currentPrecision.value?.flush()) ?? true;
}
async function flush() {
  if (generationImportBusy.value) return false;
  if (directionPending.value || graphicAgentPending.value) return false;
  if (!(await flushInputs())) return false;
  return (await directionReview.value?.flush()) ?? true;
}
async function reloadDirectionState() {
  await load();
  return status.value === "saved";
}
const selectedClipId = ref("");
const selectedBeatId = ref("");
const inspector = ref<
  "clip" | "beat" | "sound" | "captions" | "graphics" | "templates"
>("clip");
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
const shortcutSheetOpen = ref(false);
const activeTarget = ref<"record" | "source">("record");
const cutDeskMonitorLayout = computed(() => preferences.cutDeskMonitorLayout);
const cutDeskSplitRatio = computed(() => preferences.cutDeskSplitRatio);
const cutDeskDualMode = computed(
  () => !!props.expertMode && cutDeskMonitorLayout.value === "dual",
);
const isResizingSplitter = ref(false);
let startSplitX = 0;
let startSplitRatio = 0.5;
let splitterContainerWidth = 1;

function onSplitterPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.currentTarget as HTMLElement | null;
  const container = target?.closest(
    ".cut-desk-dual-container",
  ) as HTMLElement | null;
  if (!container) return;
  splitterContainerWidth = container.getBoundingClientRect().width;
  startSplitX = event.clientX;
  startSplitRatio = cutDeskSplitRatio.value;
  isResizingSplitter.value = true;
  window.addEventListener("pointermove", onSplitterPointerMove);
  window.addEventListener("pointerup", onSplitterPointerUp);
  window.addEventListener("pointercancel", onSplitterPointerUp);
}

function onSplitterPointerMove(event: PointerEvent) {
  if (!isResizingSplitter.value || splitterContainerWidth <= 0) return;
  const deltaX = event.clientX - startSplitX;
  const newRatio = startSplitRatio + deltaX / splitterContainerWidth;
  setCutDeskSplitRatio(newRatio);
}

function onSplitterPointerUp() {
  isResizingSplitter.value = false;
  window.removeEventListener("pointermove", onSplitterPointerMove);
  window.removeEventListener("pointerup", onSplitterPointerUp);
  window.removeEventListener("pointercancel", onSplitterPointerUp);
}

function onSplitterKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    setCutDeskSplitRatio(
      cutDeskSplitRatio.value - (event.shiftKey ? 0.05 : 0.02),
    );
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    setCutDeskSplitRatio(
      cutDeskSplitRatio.value + (event.shiftKey ? 0.05 : 0.02),
    );
  } else if (event.key === "Home") {
    event.preventDefault();
    setCutDeskSplitRatio(0.25);
  } else if (event.key === "End") {
    event.preventDefault();
    setCutDeskSplitRatio(0.75);
  }
}

const editMode = ref<"story" | "precision" | "transcript">("story");
const recordMonitor = ref<InstanceType<typeof RecordMonitor> | null>(null);
const recordTarget = computed(
  () =>
    !!props.expertMode &&
    (cutDeskDualMode.value
      ? activeTarget.value === "record"
      : editMode.value === "story"),
);
const recordActive = computed(
  () =>
    props.active &&
    !!props.expertMode &&
    (cutDeskDualMode.value
      ? activeTarget.value === "record"
      : editMode.value === "story"),
);
const projectTimebase = computed(() =>
  resolveProjectTimebase(props.projectSettings),
);
const timebaseAlternative = computed(() =>
  sameRateDropFrameChoice(props.projectSettings),
);
const lastRecordFrame = computed(() =>
  Math.max(
    0,
    sequenceFrameAt(
      state.value?.composition.duration ?? 0,
      projectTimebase.value,
      "floor",
    ) - 1,
  ),
);
const recordFrame = computed(() => recordMonitor.value?.frame ?? 0);
// The editor may publish optimistic drafts while saving. Waveform geometry
// follows only the last acknowledged document and never becomes an edit owner.
const savedRecordState = shallowRef<EditorState | null>(null);
const savedRecordLastFrame = computed(() =>
  Math.max(
    0,
    sequenceFrameAt(
      savedRecordState.value?.composition.duration ?? 0,
      projectTimebase.value,
      "floor",
    ) - 1,
  ),
);
watch(
  [state, status, compositionHasPending],
  ([snapshot, saveStatus, pending]) => {
    if (
      snapshot &&
      snapshot.composition.id === props.compositionId &&
      saveStatus === "saved" &&
      !pending
    )
      savedRecordState.value = snapshot;
  },
  { immediate: true, flush: "post" },
);
const recordSplitPending = ref(false);
const recordIssue = ref("");
let recordDisposed = false;
// Identity, rather than equal field values, fences callbacks across leave/revisit.
const recordOwner = computed(() => ({
  projectId: props.projectId,
  compositionId: props.compositionId,
  composition: state.value?.composition,
  assets: state.value?.assets,
  revision: state.value?.revision,
  timebase: timebaseKey(projectTimebase.value),
  sourceVersion: props.sourceVersion,
  active: recordActive.value,
  workspaceActive: props.active,
  expertMode: !!props.expertMode,
  target: editMode.value,
}));
type RecordOwner = typeof recordOwner.value;
function ownsRecord(owner: RecordOwner) {
  return !recordDisposed && owner.active && recordOwner.value === owner;
}
const shortcutIsolation = computed(
  () =>
    !!props.shortcutsBlocked ||
    !!props.timebasePending ||
    directionBlocked.value ||
    historyBusy.value ||
    directionPending.value ||
    !!transcriptEditor.value?.hasPending ||
    !!currentPrecision.value?.hasPending ||
    recordSplitPending.value ||
    status.value === "failed" ||
    status.value === "conflict" ||
    !!draftAction.value,
);
const cutDeskBlocked = computed(
  () => shortcutIsolation.value || hasPending.value || status.value !== "saved",
);
function changeTimebase(event: Event) {
  const choice = timebaseAlternative.value;
  const dropFrame = (event.target as HTMLSelectElement).value === "df";
  if (!cutDeskBlocked.value && choice && choice.dropFrame === dropFrame)
    emit("timebaseChange", choice);
}
async function navigateToRecordFrame(frame: number): Promise<boolean> {
  const owner = recordOwner.value;
  const monitor = recordMonitor.value;
  if (
    !ownsRecord(owner) ||
    !monitor ||
    !Number.isSafeInteger(frame) ||
    frame < 0 ||
    frame > lastRecordFrame.value ||
    cutDeskBlocked.value
  )
    return false;
  monitor.pause();
  if (!(await flush()) || !ownsRecord(owner) || recordMonitor.value !== monitor)
    return false;
  monitor.seek(frame);
  return true;
}
async function splitRecord(owner: RecordOwner) {
  if (!ownsRecord(owner) || cutDeskBlocked.value || recordSplitPending.value)
    return;
  const monitor = recordMonitor.value;
  if (!monitor) return;
  monitor.pause();
  const frame = monitor.frame;
  recordSplitPending.value = true;
  try {
    if (
      !(await flush()) ||
      !ownsRecord(owner) ||
      recordMonitor.value !== monitor
    )
      return;
    const latest = state.value;
    if (!latest || latest.revision !== owner.revision) return;
    const primary = resolveCompositionFrame(
      latest.composition,
      latest.assets,
      frame,
      projectTimebase.value,
    ).primary;
    if (!primary) return;
    // Task 5 owns solver validation, exact request identity, recovery and history.
    await compositionCommitTransaction({
      type: "clip.split",
      clipId: primary.clip.id,
      sourceTime: primary.sourceTime,
    });
  } catch (cause) {
    if (ownsRecord(owner)) reportError(cause);
  } finally {
    recordSplitPending.value = false;
  }
}
async function insertRecord(owner: RecordOwner) {
  if (!ownsRecord(owner) || cutDeskBlocked.value) return;
  const monitor = recordMonitor.value;
  if (!monitor) return;
  const frame = monitor.frame;
  const latest = state.value;
  if (!latest || latest.revision !== owner.revision) return;
  const sourceClip = selectedClip.value;
  if (!sourceClip) return;
  const time = sequenceTimeAt(frame, projectTimebase.value);
  const sourceIn = sourceClip.sourceIn ?? 0;
  const sourceOut =
    sourceClip.sourceOut ?? sourceIn + sourceClip.timelineDuration;
  try {
    await compositionCommitTransaction({
      type: "insert",
      assetId: sourceClip.assetId,
      timelineStart: time,
      sourceIn,
      sourceOut,
    });
  } catch (cause) {
    if (ownsRecord(owner)) reportError(cause);
  }
}
async function overwriteRecord(owner: RecordOwner) {
  if (!ownsRecord(owner) || cutDeskBlocked.value) return;
  const monitor = recordMonitor.value;
  if (!monitor) return;
  const frame = monitor.frame;
  const latest = state.value;
  if (!latest || latest.revision !== owner.revision) return;
  const sourceClip = selectedClip.value;
  if (!sourceClip) return;
  const time = sequenceTimeAt(frame, projectTimebase.value);
  const sourceIn = sourceClip.sourceIn ?? 0;
  const sourceOut =
    sourceClip.sourceOut ?? sourceIn + sourceClip.timelineDuration;
  try {
    await compositionCommitTransaction({
      type: "overwrite",
      assetId: sourceClip.assetId,
      timelineStart: time,
      sourceIn,
      sourceOut,
    });
  } catch (cause) {
    if (ownsRecord(owner)) reportError(cause);
  }
}
async function liftRecord(owner: RecordOwner) {
  if (!ownsRecord(owner) || cutDeskBlocked.value) return;
  const monitor = recordMonitor.value;
  if (!monitor) return;
  const frame = monitor.frame;
  const latest = state.value;
  if (!latest || latest.revision !== owner.revision) return;
  const primary = resolveCompositionFrame(
    latest.composition,
    latest.assets,
    frame,
    projectTimebase.value,
  ).primary;
  if (!primary) return;
  try {
    await compositionCommitTransaction({
      type: "lift",
      clipId: primary.clip.id,
    });
  } catch (cause) {
    if (ownsRecord(owner)) reportError(cause);
  }
}
function toggleTrackTarget(track: Track) {
  command({
    type: "track.update",
    trackId: track.id,
    patch: { target: !track.target },
  });
}
function toggleTrackLock(track: Track) {
  command({
    type: "track.update",
    trackId: track.id,
    patch: { locked: !track.locked },
  });
}
function toggleTrackMute(track: Track) {
  command({
    type: "track.update",
    trackId: track.id,
    patch: { muted: !track.muted },
  });
}
function toggleTrackSolo(track: Track) {
  command({
    type: "track.update",
    trackId: track.id,
    patch: { solo: !track.solo },
  });
}
function toggleTrackVisible(track: Track) {
  command({
    type: "track.update",
    trackId: track.id,
    patch: { visible: track.visible === false ? true : false },
  });
}
const recordBindings = computed(() => {
  const owner = recordOwner.value;
  return {
    onSelectClip: (id: string) => {
      if (!ownsRecord(owner) || cutDeskBlocked.value) return;
      const clip = allClips.value.find((item) => item.id === id);
      if (clip) chooseClip(clip);
    },
    onSplit: () => splitRecord(owner),
    onIssue: (issue: { code: string }) => {
      if (ownsRecord(owner)) recordIssue.value = issue.code;
    },
  };
});
const cutDeskControls = computed(() => {
  const owner = recordOwner.value;
  const current = () =>
    !recordDisposed &&
    owner === recordOwner.value &&
    owner.workspaceActive &&
    owner.expertMode &&
    (owner.target === "story" || owner.target === "precision") &&
    !cutDeskBlocked.value;
  return {
    timebase: {
      onChange: (event: Event) => {
        if (current()) changeTimebase(event);
      },
    },
    seek: {
      onSeek: (frame: number) => {
        if (current()) void navigateToRecordFrame(frame);
      },
    },
    back: {
      onClick: () => {
        if (current() && ownsRecord(owner)) recordMonitor.value?.step(-1);
      },
    },
    forward: {
      onClick: () => {
        if (current() && ownsRecord(owner)) recordMonitor.value?.step(1);
      },
    },
    toggle: {
      onClick: () => {
        if (!current() || !ownsRecord(owner)) return;
        const monitor = recordMonitor.value;
        if (monitor?.playing) monitor.pause();
        else monitor?.play();
      },
    },
  };
});
watch(
  recordOwner,
  () => {
    recordIssue.value = "";
  },
  { flush: "sync" },
);
let nativeEditGeneration = 0;
let nativeEditDisposed = false;
let nativeEditReadyForVisit = false;
let cancelNativeEditReady: (() => void) | undefined;
const showFit = ref(false);
const inspectorOpen = ref(true);
const advancedToolsOpen = ref(!!props.expertMode);
watch(
  () => props.expertMode,
  (expert) => {
    advancedToolsOpen.value = !!expert;
    if (expert) {
      sourcePlayer.value?.pause();
      photoPlayer.value?.pause();
    } else pendingSourceSeek.value = sourceTime.value;
  },
);
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
  if (
    props.expertMode &&
    cutDeskDualMode.value &&
    (mode === "story" || mode === "precision")
  ) {
    activeTarget.value = mode === "story" ? "record" : "source";
    if (editMode.value !== "story") {
      if (!(await flush())) return;
      editMode.value = "story";
    }
    return;
  }
  if (mode === editMode.value || !(await flush())) return;
  editMode.value = mode;
  if (props.expertMode) {
    activeTarget.value = mode === "story" ? "record" : "source";
  }
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
const pendingSourceSeek = ref<number>();
const sourceError = ref("");
const titlePreviewFailed = ref(false);
const titlePreviewRetry = ref(0);
const unsupportedSpeedMessage = "speed";
const playing = ref(false);
const graphicSceneSelection = ref({ sceneId: "", nodeId: "" });
const graphicPreviewTime = ref<number>();
watch(
  [
    () => props.projectId,
    () => props.compositionId,
    () => state.value?.revision,
    () => props.projectSettings.frameRate,
  ],
  () => {
    graphicPreviewTime.value = undefined;
    pendingSourceSeek.value = undefined;
  },
);
const graphicSnapping = ref(true);
const graphicGuides = ref(true);
const graphicLayerEditing = computed(
  () =>
    props.active &&
    editMode.value === "story" &&
    inspector.value === "graphics" &&
    status.value === "saved" &&
    !playing.value &&
    !historyBusy.value,
);
function selectGraphicLayer(selection: { sceneId: string; nodeId: string }) {
  graphicSceneSelection.value = selection;
}
async function previewGraphicAtTime(time: number): Promise<boolean> {
  const projectId = props.projectId;
  const compositionId = props.compositionId;
  if (!Number.isFinite(time) || time < 0 || !(await flush())) return false;
  if (props.projectId !== projectId || props.compositionId !== compositionId)
    return false;
  const composition = state.value?.composition;
  if (!composition) return false;
  const rate = props.projectSettings.frameRate;
  const lastFrame = Math.floor(composition.duration * rate + 1e-7) - 1;
  if (lastFrame < 0) return false;
  sourcePlayer.value?.pause();
  playing.value = false;
  fitPreview.value = null;
  directionPreview.value = null;
  editMode.value = "story";
  inspectorOpen.value = true;
  inspector.value = "graphics";
  const requestedTime =
    Math.min(lastFrame, Math.floor(time * rate + 1e-9)) / rate;
  graphicPreviewTime.value = requestedTime;
  const clip = playbackClip.value;
  const localTime = clip ? graphicPreviewTime.value - clip.timelineStart : 0;
  const sourceAtTime = clip
    ? (clip.sourceIn ?? 0) + localTime * (clip.transform?.speed ?? 1)
    : 0;
  pendingSourceSeek.value = clip ? sourceAtTime : undefined;
  await nextTick();
  if (
    props.projectId !== projectId ||
    props.compositionId !== compositionId ||
    graphicPreviewTime.value !== requestedTime
  )
    return false;
  if (photoPresentationActive.value) photoPlayer.value?.seekTo(localTime);
  const player = sourcePlayer.value;
  if (player) {
    player.pause();
    // A newly mounted video must retain this seek until loadedmetadata.
    if (player.readyState >= 1) configurePlayer();
    else sourceTime.value = sourceAtTime;
  } else {
    pendingSourceSeek.value = undefined;
    sourceTime.value = sourceAtTime;
  }
  return true;
}
function setGraphicAgentBusy(value: boolean) {
  graphicAgentBusy.value = value;
}
function setGraphicAgentPending(value: boolean) {
  graphicAgentPending.value = value;
}
async function importGeneratedAudio(
  id: string,
  start: number,
  complete: (ok: boolean) => void,
) {
  if (hasPending.value || historyBusy.value) {
    complete(false);
    return;
  }
  generationImportBusy.value = true;
  const owner = {
    projectId: props.projectId,
    compositionId: props.compositionId,
    epoch: ++generationImportEpoch,
  };
  const owns = () =>
    !generationImportDisposed &&
    owner.projectId === props.projectId &&
    owner.compositionId === props.compositionId &&
    owner.epoch === generationImportEpoch;
  try {
    const result = await api.importGeneratedAudio(id, props.projectId, start);
    if (!owns()) {
      complete(false);
      return;
    }
    await load();
    if (!owns() || state.value?.revision !== result.baseRevision) {
      complete(false);
      return;
    }
    complete(compositionCommand(result.command, result.assets));
  } catch (error) {
    if (owns()) reportError(error);
    complete(false);
  } finally {
    if (owns()) generationImportBusy.value = false;
  }
}
async function applyMotion(
  id: string,
  action: "import" | "restore",
  complete: (ok: boolean) => void,
) {
  if (hasPending.value || historyBusy.value) {
    complete(false);
    return;
  }
  generationImportBusy.value = true;
  const owner = {
    projectId: props.projectId,
    compositionId: props.compositionId,
    epoch: ++generationImportEpoch,
  };
  const owns = () =>
    !generationImportDisposed &&
    owner.projectId === props.projectId &&
    owner.compositionId === props.compositionId &&
    owner.epoch === generationImportEpoch;
  try {
    const result = await api.applyMotion(id, owner.projectId, action);
    if (!owns()) {
      complete(false);
      return;
    }
    await load();
    if (!owns() || state.value?.revision !== result.revision) {
      complete(false);
      return;
    }
    emit("edited");
    complete(true);
  } catch (error) {
    if (owns()) reportError(error);
    complete(false);
  } finally {
    if (owns()) generationImportBusy.value = false;
  }
}
async function reloadAfterGraphicAgent() {
  await load();
  emit("edited");
}
function setGraphicSnapping(value: boolean) {
  graphicSnapping.value = value;
}
function setGraphicGuides(value: boolean) {
  graphicGuides.value = value;
}
function firstGraphicNode(
  nodes: import("@openfilm/core").GraphicNode[],
): string {
  const first = nodes[0];
  return first?.id ?? "";
}
watch(
  [() => props.projectId, () => props.compositionId],
  () => {
    graphicSceneSelection.value = { sceneId: "", nodeId: "" };
  },
  { flush: "sync" },
);
watch(
  () => state.value?.composition.graphicScenes,
  (scenes) => {
    const selection = graphicSceneSelection.value;
    const scene =
      scenes?.find((item) => item.id === selection.sceneId) ?? scenes?.[0];
    if (!scene) {
      graphicSceneSelection.value = { sceneId: "", nodeId: "" };
      return;
    }
    const hasNode = (
      nodes: import("@openfilm/core").GraphicNode[],
      id: string,
    ): boolean =>
      nodes.some(
        (node) =>
          node.id === id ||
          (node.type === "group" && hasNode(node.children, id)),
      );
    if (
      scene.id !== selection.sceneId ||
      !hasNode(scene.nodes, selection.nodeId)
    )
      graphicSceneSelection.value = {
        sceneId: scene.id,
        nodeId:
          selection.nodeId && hasNode(scene.nodes, selection.nodeId)
            ? selection.nodeId
            : firstGraphicNode(scene.nodes),
      };
  },
  { immediate: true },
);
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
const captionFontSize = ref(32);
// A cue acknowledgement replaces the track object. Keep focused typography
// input local until change, and reset only for another track or saved size.
watch(
  [
    () => selectedCaptionTrack.value?.id,
    () => selectedCaptionTrack.value?.style.fontSize,
  ],
  ([, fontSize]) => {
    captionFontSize.value = fontSize ?? 32;
  },
  { immediate: true },
);
const captionSafeArea = ref<
  Record<"left" | "right" | "top" | "bottom", number>
>({
  left: 8,
  right: 8,
  top: 8,
  bottom: 12,
});
watch(
  [
    () => selectedCaptionTrack.value?.id,
    () => selectedCaptionTrack.value?.style.safeArea?.left,
    () => selectedCaptionTrack.value?.style.safeArea?.right,
    () => selectedCaptionTrack.value?.style.safeArea?.top,
    () => selectedCaptionTrack.value?.style.safeArea?.bottom,
  ],
  ([, left, right, top, bottom]) => {
    captionSafeArea.value = {
      left: Math.round((left ?? 0.08) * 100),
      right: Math.round((right ?? 0.08) * 100),
      top: Math.round((top ?? 0.08) * 100),
      bottom: Math.round((bottom ?? 0.12) * 100),
    };
  },
  { immediate: true },
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
const primaryColorFilterId = `primary-color-${useId().replaceAll(":", "")}`;
const playbackPrimaryColor = computed(() =>
  state.value && playbackClip.value && lookEligible.value
    ? resolvePrimaryColor(state.value.composition, playbackClip.value)
        .correction
    : PRIMARY_COLOR_IDENTITY,
);
const filmLookFilterId = `film-look-${useId().replaceAll(":", "")}`;
const playbackLook = computed(() =>
  state.value && playbackClip.value && lookEligible.value
    ? resolveFilmLook(state.value.composition, playbackClip.value).look
    : { version: 1 as const, preset: "none" as const, strength: 1 },
);
const playbackLookActive = computed(
  () =>
    !!sourceColorStyle(playbackPrimaryColor.value, playbackLook.value, {
      primary: primaryColorFilterId,
      look: filmLookFilterId,
    }).filter,
);
const playbackLookStyle = computed(() =>
  sourceColorStyle(playbackPrimaryColor.value, playbackLook.value, {
    primary: primaryColorFilterId,
    look: filmLookFilterId,
  }),
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
const recordResolvedFrame = computed(() => {
  const current = state.value;
  if (!current || !recordTarget.value) return undefined;
  try {
    return resolveCompositionFrame(
      current.composition,
      current.assets,
      recordFrame.value,
      projectTimebase.value,
    );
  } catch {
    return undefined;
  }
});
const ribbonClip = computed(() =>
  recordTarget.value
    ? recordResolvedFrame.value?.primary?.clip
    : selectedClip.value,
);
const ribbonAsset = computed(() =>
  recordTarget.value
    ? recordResolvedFrame.value?.primary?.asset
    : selectedAsset.value,
);
const ribbonBeat = computed(() => {
  const beatId = ribbonClip.value?.beatId;
  return state.value?.story.beats.find((beat) => beat.id === beatId);
});
const ribbonSourceSeconds = computed(() =>
  recordTarget.value
    ? (recordResolvedFrame.value?.primary?.sourceTime ?? 0)
    : (currentPrecision.value?.playhead ?? selectedClip.value?.sourceIn ?? 0),
);
const ribbonSequenceFrame = computed(() =>
  recordTarget.value
    ? recordFrame.value
    : sequenceFrameAt(
        selectedClip.value?.timelineStart ?? 0,
        projectTimebase.value,
        "nearest",
      ),
);
const ribbonSnapState = computed<"on" | "off" | "unavailable">(() => {
  if (recordTarget.value || currentPrecision.value?.snapEnabled === undefined)
    return "unavailable";
  return currentPrecision.value.snapEnabled ? "on" : "off";
});
const ribbonAction = computed(() =>
  recordSplitPending.value
    ? t("cutDesk.ribbon.splitPending")
    : t(`editor.save.${status.value}`),
);
const ribbonTransportStatus = computed<"active" | "playing" | "paused">(() =>
  recordTarget.value
    ? recordMonitor.value?.playing
      ? "playing"
      : "paused"
    : "active",
);

const recordVisualLooks = computed(() => {
  const current = state.value;
  if (!current || !recordResolvedFrame.value) return [];
  try {
    return recordResolvedFrame.value.visual.map((entry) => ({
      clipId: entry.clip.id,
      assetId: entry.asset.id,
      look: resolveFilmLook(current.composition, entry.clip).look,
    }));
  } catch {
    return [];
  }
});
const recordLookAvailable = computed(() =>
  recordVisualLooks.value.some(
    ({ look }) => look.preset !== "none" && look.strength > 0,
  ),
);
const lookCompareHeld = ref(false);
const lookCompareLatched = ref(false);
const lookCompareActive = computed(
  () =>
    recordLookAvailable.value &&
    (lookCompareHeld.value || lookCompareLatched.value),
);
const recordCompareContextKey = computed(() =>
  JSON.stringify([
    props.projectId,
    props.compositionId,
    state.value?.revision ?? "",
    props.sourceVersion ?? 0,
    timebaseKey(projectTimebase.value),
    props.active,
    recordTarget.value,
    recordVisualLooks.value.map(({ clipId, assetId }) => [clipId, assetId]),
  ]),
);
let comparePointer:
  | {
      owner: string;
      pointerId: number;
      element: HTMLElement;
    }
  | undefined;
let compareKeyboardOwner: string | undefined;
function clearCompareHold(releaseCapture = true) {
  const pointer = comparePointer;
  comparePointer = undefined;
  compareKeyboardOwner = undefined;
  lookCompareHeld.value = false;
  if (releaseCapture && pointer?.element.hasPointerCapture?.(pointer.pointerId))
    pointer.element.releasePointerCapture?.(pointer.pointerId);
}
function clearLookCompare() {
  clearCompareHold();
  lookCompareLatched.value = false;
}
function compareCurrent(owner: string) {
  return (
    owner === recordCompareContextKey.value &&
    recordTarget.value &&
    recordLookAvailable.value &&
    !cutDeskBlocked.value
  );
}
function beginComparePointer(owner: string, event: PointerEvent) {
  if (!compareCurrent(owner) || event.button !== 0 || event.isPrimary === false)
    return;
  event.preventDefault();
  event.stopPropagation();
  clearCompareHold();
  const element = event.currentTarget as HTMLElement;
  try {
    element.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic/assistive pointer events may not own an active native pointer.
    // Window-level release handling still gives the preview a bounded lifetime.
  }
  comparePointer = { owner, pointerId: event.pointerId, element };
  lookCompareHeld.value = true;
}
function endComparePointer(event: PointerEvent, releaseCapture = true) {
  if (!comparePointer || comparePointer.pointerId !== event.pointerId) return;
  clearCompareHold(releaseCapture);
}
function setCompareKey(owner: string, event: KeyboardEvent, pressed: boolean) {
  if (event.code !== "Space" && event.key !== "Enter") return;
  if (pressed) {
    if (!ownsSourceShortcut(event) || !compareCurrent(owner) || event.repeat)
      return;
    event.preventDefault();
    event.stopPropagation();
    clearCompareHold();
    compareKeyboardOwner = owner;
    lookCompareHeld.value = true;
  } else if (compareKeyboardOwner === owner) {
    // Release an owned hold even if modifiers, focus or modal ownership
    // changed after keydown, so original-view preview cannot become stuck.
    event.preventDefault();
    event.stopPropagation();
    clearCompareHold();
  }
}
const compareControls = computed(() => {
  const owner = recordCompareContextKey.value;
  return {
    hold: {
      onPointerdown: (event: PointerEvent) => beginComparePointer(owner, event),
      onPointerup: (event: PointerEvent) => endComparePointer(event),
      onPointercancel: (event: PointerEvent) => endComparePointer(event),
      onLostpointercapture: (event: PointerEvent) =>
        endComparePointer(event, false),
      onKeydown: (event: KeyboardEvent) => setCompareKey(owner, event, true),
      onKeyup: (event: KeyboardEvent) => setCompareKey(owner, event, false),
      onBlur: () => {
        if (compareKeyboardOwner === owner || comparePointer?.owner === owner)
          clearCompareHold();
      },
      onClick: (event: MouseEvent) => event.preventDefault(),
    },
    latch: {
      onClick: () => {
        if (compareCurrent(owner))
          lookCompareLatched.value = !lookCompareLatched.value;
      },
    },
  };
});
watch(recordCompareContextKey, clearLookCompare, { flush: "sync" });
watch(recordLookAvailable, (available) => {
  if (!available) clearLookCompare();
});
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
      { timebase: projectTimebase.value, origin: "automatic" },
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
        { timebase: projectTimebase.value, origin: "automatic" },
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
  if (currentPrecision.value?.hasPending || directionBlocked.value) return;
  if (editMode.value === "transcript" && transcriptEditor.value) {
    void transcriptEditor.value.flush().then((saved) => {
      if (saved) applyClipSelection(clip, openInspector);
    });
    return;
  }
  applyClipSelection(clip, openInspector);
}
function applyClipSelection(clip: Clip, openInspector = true) {
  clipTransformOverlay.value?.cancel();
  graphicPreviewTime.value = undefined;
  pendingSourceSeek.value = undefined;
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
  textRuns?: TitleTextRuns | null;
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
  event?: Event,
) {
  const track = selectedCaptionTrack.value;
  if (!track) return;
  const target = event?.target as HTMLInputElement | undefined;
  const raw =
    target?.value !== undefined ? target.value : captionSafeArea.value[side];
  const parsed = Math.max(0, Math.min(30, Number(raw) || 0));
  captionSafeArea.value[side] = parsed;
  const safeArea = {
    left: (captionSafeArea.value.left ?? 8) / 100,
    right: (captionSafeArea.value.right ?? 8) / 100,
    top: (captionSafeArea.value.top ?? 8) / 100,
    bottom: (captionSafeArea.value.bottom ?? 12) / 100,
    [side]: parsed / 100,
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
const pictureValue = computed<ClipTransformDraft>(() => {
  const committed = resolveClipGeometry(selectedClip.value?.transform);
  return {
    scale: previewNumber(clipFields.value.scale, committed.scale, true),
    rotation: previewNumber(clipFields.value.rotation, committed.rotation),
    x: previewNumber(clipFields.value.x, committed.x),
    y: previewNumber(clipFields.value.y, committed.y),
  };
});
const pictureSessionKey = computed(
  () =>
    `${props.projectId}:${props.compositionId}:${state.value?.revision ?? ""}:${selectedClipId.value}:${sourcePlaybackKey.value}`,
);
const pictureOwnsPreview = computed(
  () =>
    graphicPreviewTime.value === undefined &&
    playbackClip.value === selectedClip.value,
);
const pictureCapable = computed(
  () =>
    !props.expertMode &&
    pictureOwnsPreview.value &&
    !photoPresentationActive.value &&
    !!selectedClip.value &&
    !selectedClip.value.locked &&
    controls.value.visual &&
    !lockedOverlaySource.value &&
    !sourceUnavailable.value &&
    !sourceError.value &&
    selectedSourceInfo.value?.previewSupported !== false &&
    !!selectedAsset.value,
);
const pictureBlocked = computed(
  () =>
    compositionHistoryBusy.value ||
    compositionTransactionBusy.value ||
    pictureTransactionPending.value ||
    directionBlocked.value ||
    graphicAgentBusy.value ||
    graphicAgentPending.value ||
    status.value !== "saved" ||
    !!currentPrecision.value?.hasPending,
);
function previewPicture(value: ClipTransformDraft) {
  Object.assign(clipFields.value, value);
}
function resetPicturePreview() {
  previewPicture(resolveClipGeometry(selectedClip.value?.transform));
}
async function commitPicture(value: ClipTransformDraft) {
  const clip = selectedClip.value;
  if (!clip || !pictureCapable.value || pictureBlocked.value) return;
  const current = resolveClipGeometry(clip.transform);
  if (
    current.x === value.x &&
    current.y === value.y &&
    current.scale === value.scale &&
    current.rotation === value.rotation
  ) {
    previewPicture(current);
    reportNotice("");
    return;
  }
  pictureTransactionPending.value = true;
  try {
    const result = await commitSource({
      type: "transform",
      clipId: clip.id,
      ...value,
    });
    if (result.status !== "accepted") resetPicturePreview();
  } finally {
    pictureTransactionPending.value = false;
  }
}
function resetPicture(centerOnly = false) {
  clipTransformOverlay.value?.cancel();
  const value = {
    ...pictureValue.value,
    x: 0,
    y: 0,
    ...(centerOnly ? {} : { scale: 1, rotation: 0 }),
  };
  previewPicture(value);
  void commitPicture(value);
}
function togglePictureAdjustment() {
  clipTransformOverlay.value?.cancel();
  pictureAdjusting.value = !pictureAdjusting.value;
}
const previewGeometry = computed(() => {
  const graphics = graphicPreviewTime.value !== undefined;
  const committed = resolveClipGeometry(
    (graphics ? playbackClip.value : selectedClip.value)?.transform,
  );
  return resolvePreviewClipGeometry(
    graphics ? committed : pictureValue.value,
    sourcePreviewSize.value ??
      (graphics ? playbackAsset.value : selectedAsset.value)?.dimensions ??
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
  const mode =
    value === "crossfade"
      ? "crossfade"
      : value === "dip-to-black"
        ? "dip-to-black"
        : value === "dip-to-white"
          ? "dip-to-white"
          : "cut";
  editClip({
    type: "transition",
    transition: mode,
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
function liftSelected() {
  if (selectedClip.value)
    command({ type: "lift", clipId: selectedClip.value.id });
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
  const sourceIn = clip.sourceIn ?? 0;
  const sourceOut =
    clip.sourceOut ?? assetMap.value.get(clip.assetId)?.duration ?? Infinity;
  const requested = pendingSourceSeek.value;
  const nextTime = Math.max(
    sourceIn,
    Math.min(sourceOut, requested ?? sourceIn),
  );
  player.currentTime = nextTime;
  sourceTime.value = nextTime;
  pendingSourceSeek.value = undefined;
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

async function navigateToTime(time: number): Promise<boolean> {
  const projectId = props.projectId;
  const compositionId = props.compositionId;
  if (!Number.isFinite(time) || time < 0 || !(await flush())) return false;
  if (props.projectId !== projectId || props.compositionId !== compositionId)
    return false;
  const composition = state.value?.composition;
  if (!composition) return false;
  const visualClips = composition.tracks
    .filter((track) => track.type === "video" || track.type === "overlay")
    .flatMap((track) => track.clips);
  const coveringClip = visualClips.find(
    (item) =>
      time >= item.timelineStart &&
      time < item.timelineStart + item.timelineDuration,
  );
  if (!coveringClip && composition.graphicScenes?.length)
    return previewGraphicAtTime(time);
  if (!visualClips.length) return false;
  const clip =
    coveringClip ??
    [...visualClips].sort((left, right) => {
      const distance = (candidate: Clip) =>
        time < candidate.timelineStart
          ? candidate.timelineStart - time
          : time - (candidate.timelineStart + candidate.timelineDuration);
      return distance(left) - distance(right);
    })[0]!;
  const localTime = Math.max(
    0,
    Math.min(clip.timelineDuration, time - clip.timelineStart),
  );
  const sourceIn = clip.sourceIn ?? 0;
  const sourceOut =
    clip.sourceOut ?? assetMap.value.get(clip.assetId)?.duration ?? Infinity;
  const sourceTimeAtEdit = Math.max(
    sourceIn,
    Math.min(sourceOut, sourceIn + localTime * (clip.transform?.speed ?? 1)),
  );
  sourcePlayer.value?.pause();
  graphicPreviewTime.value = undefined;
  fitPreview.value = null;
  directionPreview.value = null;
  editMode.value = "story";
  inspectorOpen.value = true;
  inspector.value = "clip";
  selectedBeatId.value = clip.beatId ?? "";
  pendingSourceSeek.value = sourceTimeAtEdit;
  selectedClipId.value = clip.id;
  await nextTick();
  if (props.projectId !== projectId || props.compositionId !== compositionId)
    return false;
  if (photoPresentationActive.value) photoPlayer.value?.seekTo(localTime);
  const player = sourcePlayer.value;
  if (player) {
    player.pause();
    player.currentTime = sourceTimeAtEdit;
    sourceTime.value = sourceTimeAtEdit;
    pendingSourceSeek.value = undefined;
  } else sourceTime.value = sourceTimeAtEdit;
  return true;
}
function stopAtOut() {
  const player = sourcePlayer.value;
  const clip = playbackClip.value;
  const sourceOut = clip?.sourceOut ?? playbackAsset.value?.duration;
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
  if (graphicPreviewTime.value !== undefined && clip) {
    const time =
      clip.timelineStart +
      (sourceTime.value - (clip.sourceIn ?? 0)) / (clip.transform?.speed ?? 1);
    // Native clocks round seeks to microseconds; keep the exact requested frame.
    if (Math.abs(time - graphicPreviewTime.value) > 1e-5)
      graphicPreviewTime.value = Math.max(
        clip.timelineStart,
        Math.min(
          clip.timelineStart +
            clip.timelineDuration -
            1 / props.projectSettings.frameRate,
          time,
        ),
      );
  }
}
function sourcePlaybackStarted() {
  const player = sourcePlayer.value;
  const clip = playbackClip.value;
  const sourceOut = clip?.sourceOut ?? playbackAsset.value?.duration;
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
  if (!player || playbackAsset.value?.mediaType !== "video" || !clip) return;
  const minimum = clip.sourceIn ?? 0;
  const maximum =
    clip.sourceOut ?? playbackAsset.value.duration ?? player.duration;
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
  if (focalEditing.value) cancelFocal();
  if (playbackSourceInfo.value?.previewSupported === false) return;
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
    const sourceOut = clip?.sourceOut ?? playbackAsset.value?.duration;
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
  if (
    event.key === "Escape" &&
    props.active &&
    ownsSourceShortcut(event) &&
    (lookCompareHeld.value || lookCompareLatched.value)
  )
    clearLookCompare();
  const undo =
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "z";
  // History shares the same input/modal/IME guard, with its own modifier chord.
  const guarded = undo
    ? ({
        target: event.target,
        isComposing: event.isComposing,
        defaultPrevented: event.defaultPrevented,
        altKey: event.altKey,
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent)
    : event;
  if (!ownsSourceShortcut(guarded) || !props.active) return;
  if (shortcutIsolation.value) {
    if (undo) event.preventDefault();
    return;
  }
  if (editMode.value === "transcript") return;
  const element = event.target as HTMLElement | null;
  if (
    event.key === "?" &&
    !element?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  ) {
    event.preventDefault();
    shortcutSheetOpen.value = !shortcutSheetOpen.value;
    return;
  }
  if (undo) {
    event.preventDefault();
    void history(event.shiftKey ? "redo" : "undo");
    return;
  }
  if (recordTarget.value) {
    if (cutDeskBlocked.value) return;
    const monitor = recordMonitor.value;
    if (!monitor) return;
    const key = event.key.toLowerCase();
    if (event.code === "Space" && !element?.closest("button, summary")) {
      event.preventDefault();
      if (monitor.playing) monitor.pause();
      else monitor.play();
    } else if (key === "j" || key === "l") {
      event.preventDefault();
      if (!event.repeat) monitor.shuttle(key === "j" ? -1 : 1);
    } else if (key === "k") {
      event.preventDefault();
      monitor.pause();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      monitor.step(event.key === "ArrowRight" ? 1 : -1, event.shiftKey);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (event.key === "ArrowUp") monitor.previousEdit();
      else monitor.nextEdit();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      monitor.seek(event.key === "Home" ? 0 : lastRecordFrame.value);
    } else if (key === "b") {
      event.preventDefault();
      if (!event.repeat) void splitRecord(recordOwner.value);
    } else if (event.key === ",") {
      event.preventDefault();
      if (!event.repeat) void insertRecord(recordOwner.value);
    } else if (event.key === ".") {
      event.preventDefault();
      if (!event.repeat) void overwriteRecord(recordOwner.value);
    } else if (event.key === ";") {
      event.preventDefault();
      if (!event.repeat) void liftRecord(recordOwner.value);
    } else if (key === "m") {
      event.preventDefault();
    }
    return;
  }
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
  if (event.key === ";") {
    event.preventDefault();
    liftSelected();
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
function compareWindowBlur() {
  clearCompareHold();
}
function compareVisibilityChanged() {
  if (document.hidden) clearCompareHold();
}
function comparePointerReleased(event: PointerEvent) {
  endComparePointer(event);
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
      { timebase: projectTimebase.value, origin: "automatic" },
    );
    const next = commands.reduce<EditorDocument>(
      (current, item) =>
        applyTimelineCommand(current, state.value!.assets, item, {
          origin: "automatic",
          timebase: resolveProjectTimebase(props.projectSettings),
        }),
      state.value,
    );
    return next.composition.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === fitPreview.value?.clipId);
  } catch {
    return undefined;
  }
});
const playbackClip = computed(() => {
  const time = graphicPreviewTime.value;
  if (time !== undefined)
    return state.value?.composition.tracks
      .filter((track) => track.type === "video" || track.type === "overlay")
      .flatMap((track) => track.clips)
      .find(
        (clip) =>
          time >= clip.timelineStart &&
          time < clip.timelineStart + clip.timelineDuration,
      );
  return (
    focalDraft.value ??
    directionPreview.value ??
    fitPreviewAfter.value ??
    selectedClip.value
  );
});
const focalSessionKey = computed(() =>
  JSON.stringify([
    props.projectId,
    props.compositionId,
    state.value?.revision,
    selectedClip.value?.id,
    selectedAsset.value,
    props.sourceVersion,
    props.projectSettings,
  ]),
);
const focalCapable = computed(
  () =>
    !props.expertMode &&
    props.active &&
    editMode.value === "story" &&
    graphicPreviewTime.value === undefined &&
    photoPresentationAllowed.value &&
    selectedAsset.value?.mediaType === "image" &&
    selectedClip.value?.layout?.preset !== "diptych" &&
    !selectedClip.value?.locked &&
    !clipSourceLocked.value &&
    !selectedAsset.value?.state.rejected &&
    !sourceUnavailable.value &&
    !sourceError.value &&
    selectedSourceInfo.value?.previewSupported !== false,
);
const focalBlocked = computed(
  () =>
    !focalCapable.value ||
    compositionHistoryBusy.value ||
    compositionTransactionBusy.value ||
    pictureGestureActive.value ||
    pictureTransactionPending.value ||
    directionBlocked.value ||
    graphicAgentBusy.value ||
    graphicAgentPending.value ||
    status.value !== "saved" ||
    !!currentPrecision.value?.hasPending,
);
function cancelFocal() {
  const wasEditing = focalEditing.value;
  focalEditing.value = false;
  focalDraft.value = null;
  focalContext = null;
  focalGestureActive.value = false;
  focalTransactionPending.value = false;
  focalEpoch++;
  focalAbort?.abort();
  focalAbort = undefined;
  if (wasEditing) photoPlayer.value?.cancelFocus();
}
function toggleFocal() {
  if (focalEditing.value) {
    cancelFocal();
    return;
  }
  const clip = selectedClip.value;
  if (!clip || !state.value || focalBlocked.value) return;
  sourcePlayer.value?.pause();
  photoPlayer.value?.pause();
  playing.value = false;
  clipTransformOverlay.value?.cancel();
  pictureAdjusting.value = false;
  directionPreview.value = null;
  fitPreview.value = null;
  const detached: Clip = JSON.parse(JSON.stringify(clip));
  detached.layout = detached.layout
    ? {
        ...detached.layout,
        preset: "hero",
        focalPoint: detached.layout.focalPoint ?? { x: 0.5, y: 0.5 },
      }
    : { version: 1, preset: "hero", focalPoint: { x: 0.5, y: 0.5 } };
  focalContext = {
    key: focalSessionKey.value,
    projectId: props.projectId,
    compositionId: props.compositionId,
    clipId: clip.id,
    revision: state.value.revision,
    epoch: ++focalEpoch,
  };
  focalDraft.value = detached;
  focalEditing.value = true;
}
function previewFocal(point: PhotoFocalPoint) {
  if (
    !focalContext ||
    focalContext.key !== focalSessionKey.value ||
    !focalDraft.value?.layout ||
    focalBlocked.value
  )
    return;
  focalDraft.value = {
    ...focalDraft.value,
    layout: { ...focalDraft.value.layout, focalPoint: { ...point } },
  };
}
async function commitFocal(point: PhotoFocalPoint) {
  const context = focalContext;
  if (
    !context ||
    context.key !== focalSessionKey.value ||
    !focalDraft.value?.layout ||
    focalBlocked.value
  ) {
    cancelFocal();
    return;
  }
  const layout = JSON.parse(
    JSON.stringify({ ...focalDraft.value.layout, focalPoint: point }),
  );
  if (JSON.stringify(layout) === JSON.stringify(selectedClip.value?.layout)) {
    cancelFocal();
    return;
  }
  focalTransactionPending.value = true;
  const controller = new AbortController();
  focalAbort = controller;
  try {
    await commitSource(
      { type: "presentation", clipId: context.clipId, layout },
      controller.signal,
      { expectedBaseRevision: context.revision },
    );
  } finally {
    if (context.epoch === focalEpoch) cancelFocal();
  }
}
watch(
  () =>
    JSON.stringify([
      props.projectId,
      props.compositionId,
      selectedClip.value?.id,
      selectedAsset.value,
      props.sourceVersion,
      props.projectSettings,
      props.active,
      props.expertMode,
      editMode.value,
      selectedClip.value?.locked,
      clipSourceLocked.value,
    ]),
  () => {
    if (focalEditing.value) cancelFocal();
  },
);
watch(
  () => state.value?.revision,
  () => {
    if (focalEditing.value && !focalTransactionPending.value) cancelFocal();
  },
);
watch(focalBlocked, (blocked) => {
  if (blocked && focalEditing.value && !focalTransactionPending.value)
    cancelFocal();
});
onBeforeUnmount(cancelFocal);
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
      { timebase: projectTimebase.value, origin: "automatic" },
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
defineExpose({
  flush,
  hasPending,
  loading: computed(() => status.value === "loading"),
  reload: load,
  navigateToTime,
  navigateToRecordFrame,
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
    if (!active) {
      clipTransformOverlay.value?.cancel();
      sourcePlayer.value?.pause();
    } else void nextTick(measureWorkspace);
  },
);
watch(
  () => props.previewVisible,
  () => void nextTick(measureWorkspace),
);
watch(editMode, () => {
  clipTransformOverlay.value?.cancel();
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
  window.addEventListener("blur", compareWindowBlur);
  window.addEventListener("pointerup", comparePointerReleased);
  window.addEventListener("pointercancel", comparePointerReleased);
  document.addEventListener("visibilitychange", compareVisibilityChanged);
  layoutObserver = new ResizeObserver(measureWorkspace);
  if (sourceScreenElement.value && props.active && editMode.value === "story")
    layoutObserver.observe(sourceScreenElement.value);
  measureWorkspace();
});
onBeforeUnmount(() => {
  recordDisposed = true;
  generationImportDisposed = true;
  generationImportEpoch++;
  captionImportController?.abort();
  captionImportGeneration++;
  nativeEditDisposed = true;
  nativeEditGeneration++;
  cancelNativeEditReady?.();
  cancelNativeEditReady = undefined;
  window.removeEventListener("keydown", keyboard);
  window.removeEventListener("resize", measureWorkspace);
  window.removeEventListener("blur", compareWindowBlur);
  window.removeEventListener("pointerup", comparePointerReleased);
  window.removeEventListener("pointercancel", comparePointerReleased);
  document.removeEventListener("visibilitychange", compareVisibilityChanged);
  clearLookCompare();
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
          :aria-pressed="
            cutDeskDualMode
              ? mode === 'story'
                ? activeTarget === 'record'
                : mode === 'precision'
                  ? activeTarget === 'source'
                  : editMode === 'transcript'
              : editMode === mode
          "
          :class="{
            selected: cutDeskDualMode
              ? mode === 'story'
                ? activeTarget === 'record'
                : mode === 'precision'
                  ? activeTarget === 'source'
                  : editMode === 'transcript'
              : editMode === mode,
          }"
          @click="setEditMode(mode)"
        >
          {{
            t(
              mode === "story"
                ? expertMode
                  ? "cutDesk.record"
                  : "precision.storyMode"
                : mode === "precision"
                  ? expertMode
                    ? "cutDesk.source"
                    : "precision.precisionMode"
                  : "transcript.mode",
            )
          }}
        </button>
      </div>
      <div
        v-if="expertMode && editMode !== 'transcript'"
        class="cut-desk-layout-controls"
        role="group"
        :aria-label="t('cutDesk.layout.label')"
      >
        <button
          type="button"
          class="editor-button"
          :class="{ selected: cutDeskMonitorLayout === 'tabbed' }"
          :aria-pressed="cutDeskMonitorLayout === 'tabbed'"
          @click="setCutDeskMonitorLayout('tabbed')"
        >
          {{ t("cutDesk.layout.tabbed") }}
        </button>
        <button
          type="button"
          class="editor-button"
          :class="{ selected: cutDeskMonitorLayout === 'dual' }"
          :aria-pressed="cutDeskMonitorLayout === 'dual'"
          @click="setCutDeskMonitorLayout('dual')"
        >
          {{ t("cutDesk.layout.dual") }}
        </button>
      </div>
      <div v-if="expertMode" class="sr-only" role="status" aria-live="polite">
        {{
          t("cutDesk.layout.activeTarget", {
            target:
              activeTarget === "record"
                ? t("cutDesk.record")
                : t("cutDesk.source"),
          })
        }}
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
        <details
          class="editor-advanced-tools"
          :open="advancedToolsOpen"
          @toggle="
            advancedToolsOpen = ($event.target as HTMLDetailsElement).open
          "
        >
          <summary @keydown.space.stop @keydown.enter.stop>
            {{ t("app.workspaceMode.moreTools") }}
          </summary>
          <div class="editor-advanced-actions">
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
              class="editor-button"
              :aria-expanded="audioQualityOpen"
              aria-controls="audio-quality-panel"
              @click="audioQualityOpen = !audioQualityOpen"
            >
              {{ t("editor.audioQuality.title") }}
            </button>
            <button
              ref="visualQaToggle"
              class="editor-button"
              :aria-label="t('editor.visualQa.openPanel')"
              :title="t('editor.visualQa.openPanel')"
              aria-controls="visual-qa-review-panel"
              :aria-expanded="visualQaOpen"
              @click="toggleVisualQa"
            >
              <Icon name="grid" :size="15" />
            </button>
          </div>
        </details>
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
    <EditDecisionRibbon
      v-if="expertMode && editMode !== 'transcript'"
      :sequence="state?.story.title ?? state?.composition.id ?? ''"
      :beat="ribbonBeat?.title"
      :clip="ribbonClip ? ribbonClip.title || name(ribbonClip) : undefined"
      :source="ribbonAsset?.name"
      :target="recordTarget ? 'record' : 'source'"
      :transport-status="ribbonTransportStatus"
      :sequence-timecode="
        formatSequenceTimecode(ribbonSequenceFrame, projectTimebase)
      "
      :source-timecode="
        formatTimecode(
          ribbonSourceSeconds,
          ribbonAsset?.frameRate ?? projectSettings.frameRate,
        )
      "
      :clip-locked="!!ribbonClip?.locked"
      :source-locked="!!ribbonAsset?.state.locked"
      :snap-state="ribbonSnapState"
      :action="ribbonAction"
    >
      <label class="editor-field">
        {{ t("cutDesk.timebase") }}
        <select
          :aria-label="t('cutDesk.timebase')"
          :value="projectTimebase.dropFrame ? 'df' : 'ndf'"
          :disabled="cutDeskBlocked || !timebaseAlternative"
          :aria-busy="!!timebasePending"
          v-bind="cutDeskControls.timebase"
        >
          <option :value="projectTimebase.dropFrame ? 'df' : 'ndf'">
            {{
              t(
                projectTimebase.dropFrame
                  ? "cutDesk.dropFrame"
                  : "cutDesk.nonDropFrame",
              )
            }}
          </option>
          <option
            v-if="timebaseAlternative"
            :value="timebaseAlternative.dropFrame ? 'df' : 'ndf'"
          >
            {{
              t(
                timebaseAlternative.dropFrame
                  ? "cutDesk.dropFrame"
                  : "cutDesk.nonDropFrame",
              )
            }}
          </option>
        </select>
      </label>
      <span v-if="timebasePending" role="status">{{
        t("cutDesk.timebaseSaving")
      }}</span>
      <span v-if="timebaseError" role="alert">{{ timebaseError }}</span>
    </EditDecisionRibbon>
    <AudioQualityPanel
      v-if="audioQualityOpen"
      id="audio-quality-panel"
      :project-id="projectId"
      :composition-id="compositionId"
      :revision="state?.revision ?? ''"
      :clip-id="selectedClip?.id ?? ''"
      :disabled="
        hasPending ||
        historyBusy ||
        directionBlocked ||
        graphicAgentBusy ||
        graphicAgentPending
      "
      @apply="command($event)"
    />
    <div
      v-show="visualQaOpen"
      id="visual-qa-review-panel"
      ref="visualQaPopover"
      class="visual-qa-popover"
      role="dialog"
      aria-modal="false"
      :aria-label="t('editor.visualQa.region')"
      tabindex="-1"
      @keydown.esc="closeVisualQa"
    >
      <VisualQaPanel
        :project-id="projectId"
        :composition-id="compositionId"
        :revision="state?.revision ?? ''"
        @navigate="navigateToTime"
        @close="closeVisualQa"
      />
    </div>
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
      <div
        v-show="!cutDeskDualMode && editMode === 'precision'"
        ref="precisionElement"
      >
        <PrecisionEditor
          ref="precisionEditor"
          :project-id="projectId"
          :composition-id="compositionId"
          :revision="state?.revision ?? ''"
          :settings="projectSettings"
          :commit="commitSource"
          :asset="selectedAsset"
          :clip="selectedClip"
          :active="active && editMode === 'precision' && !draftAction"
          :busy="shortcutIsolation"
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
          <div
            v-if="cutDeskDualMode"
            class="editor-player-region cut-desk-dual-container"
          >
            <div
              class="cut-desk-pane cut-desk-source-pane"
              :class="{ 'is-active-target': activeTarget === 'source' }"
              :style="{ width: `${cutDeskSplitRatio * 100}%` }"
              @click="activeTarget = 'source'"
            >
              <PrecisionEditor
                ref="precisionEditorDual"
                :project-id="projectId"
                :composition-id="compositionId"
                :revision="state?.revision ?? ''"
                :settings="projectSettings"
                :commit="commitSource"
                :asset="selectedAsset"
                :clip="selectedClip"
                :active="active && activeTarget === 'source' && !draftAction"
                :busy="shortcutIsolation"
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
            <div
              class="cut-desk-splitter"
              :class="{ 'is-dragging': isResizingSplitter }"
              role="separator"
              tabindex="0"
              aria-orientation="vertical"
              :aria-label="t('cutDesk.layout.resizer')"
              :aria-valuenow="Math.round(cutDeskSplitRatio * 100)"
              aria-valuemin="25"
              aria-valuemax="75"
              @pointerdown="onSplitterPointerDown"
              @keydown="onSplitterKeydown"
            >
              <div class="cut-desk-splitter-handle" />
            </div>
            <div
              class="cut-desk-pane cut-desk-record-pane"
              :class="{ 'is-active-target': activeTarget === 'record' }"
              :style="{ width: `${(1 - cutDeskSplitRatio) * 100}%` }"
              @click="activeTarget = 'record'"
            >
              <section
                class="cut-desk-record"
                :aria-label="t('cutDesk.record')"
              >
                <RecordMonitor
                  :key="`${recordOwner.projectId}:${recordOwner.compositionId}:${recordOwner.revision}:${recordOwner.timebase}`"
                  ref="recordMonitor"
                  :project-id="projectId"
                  :composition="state.composition"
                  :assets="state.assets"
                  :revision="state.revision"
                  :settings="projectSettings"
                  :source-statuses="sourceStatuses"
                  :source-version="sourceVersion"
                  :active="!cutDeskBlocked && activeTarget === 'record'"
                  :bypass-look="lookCompareActive"
                  :caption-track-id="captionTrackId"
                  v-bind="recordBindings"
                />
                <div
                  class="cut-desk-transport"
                  role="group"
                  :aria-label="t('cutDesk.transport')"
                >
                  <TimecodeField
                    :frame="recordFrame"
                    :timebase="projectTimebase"
                    :label="t('cutDesk.sequenceTimecode')"
                    :min-frame="0"
                    :max-frame="lastRecordFrame"
                    :disabled="cutDeskBlocked"
                    v-bind="cutDeskControls.seek"
                  />
                  <button
                    class="editor-button"
                    :disabled="cutDeskBlocked"
                    v-bind="cutDeskControls.back"
                    :aria-label="t('editor.monitor.previousFrame')"
                  >
                    −1f
                  </button>
                  <button
                    class="editor-button"
                    :disabled="cutDeskBlocked"
                    v-bind="cutDeskControls.toggle"
                  >
                    {{
                      t(
                        recordMonitor?.playing
                          ? "cutDesk.pause"
                          : "cutDesk.play",
                      )
                    }}
                  </button>
                  <button
                    class="editor-button"
                    :disabled="cutDeskBlocked"
                    v-bind="cutDeskControls.forward"
                    :aria-label="t('editor.monitor.nextFrame')"
                  >
                    +1f
                  </button>
                  <div
                    v-if="recordLookAvailable"
                    class="cut-desk-monitor-actions"
                  >
                    <div
                      class="cut-desk-compare"
                      role="group"
                      :aria-label="t('cutDesk.compare.group')"
                      aria-describedby="cut-desk-compare-hint-dual"
                    >
                      <button
                        type="button"
                        class="editor-button"
                        :disabled="cutDeskBlocked"
                        :aria-label="t('cutDesk.compare.hold')"
                        :aria-pressed="lookCompareHeld"
                        v-bind="compareControls.hold"
                      >
                        {{ t("cutDesk.compare.holdShort") }}
                      </button>
                      <button
                        type="button"
                        class="editor-button"
                        :disabled="cutDeskBlocked"
                        :aria-label="t('cutDesk.compare.latch')"
                        :aria-pressed="lookCompareLatched"
                        v-bind="compareControls.latch"
                      >
                        {{ t("cutDesk.compare.latchShort") }}
                      </button>
                    </div>
                    <p
                      class="cut-desk-compare-status"
                      role="status"
                      aria-live="polite"
                    >
                      {{
                        t(
                          lookCompareHeld
                            ? "cutDesk.compare.held"
                            : lookCompareLatched
                              ? "cutDesk.compare.latched"
                              : "cutDesk.compare.inactive",
                        )
                      }}
                    </p>
                    <p
                      id="cut-desk-compare-hint-dual"
                      class="cut-desk-compare-hint sr-only"
                    >
                      {{ t("cutDesk.compare.hint") }}
                    </p>
                  </div>
                </div>
                <SequenceWaveform
                  v-if="savedRecordState"
                  :project-id="projectId"
                  :composition="savedRecordState.composition"
                  :assets="savedRecordState.assets"
                  :revision="savedRecordState.revision"
                  :timebase="projectTimebase"
                  :frame="recordFrame"
                  :max-frame="savedRecordLastFrame"
                  :source-statuses="sourceStatuses"
                  :source-version="sourceVersion"
                  :active="recordActive"
                  :disabled="cutDeskBlocked"
                  v-bind="cutDeskControls.seek"
                  @activity="emit('activity')"
                />
                <p
                  v-if="
                    recordIssue &&
                    (recordIssue !== 'record.not-ready' ||
                      recordMonitor?.buffering)
                  "
                  class="editor-note"
                  role="status"
                >
                  {{
                    t(`cutDesk.issues.${recordIssue.replace("record.", "")}`)
                  }}
                </p>
              </section>
            </div>
          </div>
          <div v-else-if="recordTarget" class="editor-player-region">
            <section
              v-if="recordActive"
              class="cut-desk-record"
              :aria-label="t('cutDesk.record')"
            >
              <RecordMonitor
                :key="`${recordOwner.projectId}:${recordOwner.compositionId}:${recordOwner.revision}:${recordOwner.timebase}`"
                ref="recordMonitor"
                :project-id="projectId"
                :composition="state.composition"
                :assets="state.assets"
                :revision="state.revision"
                :settings="projectSettings"
                :source-statuses="sourceStatuses"
                :source-version="sourceVersion"
                :active="!cutDeskBlocked"
                :bypass-look="lookCompareActive"
                :caption-track-id="captionTrackId"
                v-bind="recordBindings"
              />
              <div
                class="cut-desk-transport"
                role="group"
                :aria-label="t('cutDesk.transport')"
              >
                <TimecodeField
                  :frame="recordFrame"
                  :timebase="projectTimebase"
                  :label="t('cutDesk.sequenceTimecode')"
                  :min-frame="0"
                  :max-frame="lastRecordFrame"
                  :disabled="cutDeskBlocked"
                  v-bind="cutDeskControls.seek"
                />
                <button
                  class="editor-button"
                  :disabled="cutDeskBlocked"
                  v-bind="cutDeskControls.back"
                  :aria-label="t('editor.monitor.previousFrame')"
                >
                  −1f
                </button>
                <button
                  class="editor-button"
                  :disabled="cutDeskBlocked"
                  v-bind="cutDeskControls.toggle"
                >
                  {{
                    t(recordMonitor?.playing ? "cutDesk.pause" : "cutDesk.play")
                  }}
                </button>
                <button
                  class="editor-button"
                  :disabled="cutDeskBlocked"
                  v-bind="cutDeskControls.forward"
                  :aria-label="t('editor.monitor.nextFrame')"
                >
                  +1f
                </button>
                <div
                  v-if="recordLookAvailable"
                  class="cut-desk-monitor-actions"
                >
                  <div
                    class="cut-desk-compare"
                    role="group"
                    :aria-label="t('cutDesk.compare.group')"
                    aria-describedby="cut-desk-compare-hint"
                  >
                    <button
                      type="button"
                      class="editor-button"
                      :disabled="cutDeskBlocked"
                      :aria-label="t('cutDesk.compare.hold')"
                      :aria-pressed="lookCompareHeld"
                      v-bind="compareControls.hold"
                    >
                      {{ t("cutDesk.compare.holdShort") }}
                    </button>
                    <button
                      type="button"
                      class="editor-button"
                      :disabled="cutDeskBlocked"
                      :aria-label="t('cutDesk.compare.latch')"
                      :aria-pressed="lookCompareLatched"
                      v-bind="compareControls.latch"
                    >
                      {{ t("cutDesk.compare.latchShort") }}
                    </button>
                  </div>
                  <p
                    class="cut-desk-compare-status"
                    role="status"
                    aria-live="polite"
                  >
                    {{
                      t(
                        lookCompareHeld
                          ? "cutDesk.compare.held"
                          : lookCompareLatched
                            ? "cutDesk.compare.latched"
                            : "cutDesk.compare.inactive",
                      )
                    }}
                  </p>
                  <p
                    id="cut-desk-compare-hint"
                    class="cut-desk-compare-hint sr-only"
                  >
                    {{ t("cutDesk.compare.hint") }}
                  </p>
                </div>
              </div>
              <SequenceWaveform
                v-if="savedRecordState"
                :project-id="projectId"
                :composition="savedRecordState.composition"
                :assets="savedRecordState.assets"
                :revision="savedRecordState.revision"
                :timebase="projectTimebase"
                :frame="recordFrame"
                :max-frame="savedRecordLastFrame"
                :source-statuses="sourceStatuses"
                :source-version="sourceVersion"
                :active="recordActive"
                :disabled="cutDeskBlocked"
                v-bind="cutDeskControls.seek"
                @activity="emit('activity')"
              />
              <p
                v-if="
                  recordIssue &&
                  (recordIssue !== 'record.not-ready' ||
                    recordMonitor?.buffering)
                "
                class="editor-note"
                role="status"
              >
                {{ t(`cutDesk.issues.${recordIssue.replace("record.", "")}`) }}
              </p>
            </section>
          </div>
          <div v-else-if="!expertMode" class="editor-player-region">
            <div ref="sourceScreenElement" class="editor-source-screen">
              <PrimaryColorFilter
                :id="primaryColorFilterId"
                :correction="playbackPrimaryColor"
              />
              <FilmLookFilter :id="filmLookFilterId" :look="playbackLook" />
              <template v-if="playbackAsset">
                <div v-if="playbackUnavailable" class="editor-missing-source">
                  <img
                    v-if="playbackAsset.thumbnailUri"
                    crossorigin="anonymous"
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
                    crossorigin="anonymous"
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
                  :primary-color="playbackPrimaryColor"
                  :look="playbackLook"
                  :focal-editing="focalEditing"
                  :focal-disabled="focalBlocked || focalTransactionPending"
                  :focal-session-key="focalSessionKey"
                  @focal-preview="previewFocal"
                  @focal-commit="commitFocal"
                  @focal-activity="focalGestureActive = $event"
                  @focal-cancelled="cancelFocal"
                  ><template #default="slot"
                    ><NativeCaptionPreview
                      v-if="state.composition.captionTracks?.length"
                      :composition="state.composition"
                      :composition-id="compositionId"
                      :project-id="projectId"
                      :revision="state.revision"
                      :frame="
                        sequenceFrameAt(
                          Math.max(0, playbackClip.timelineStart + slot.time),
                          projectTimebase,
                        )
                      "
                      :frame-rate="projectSettings.frameRate"
                      :caption-track-id="captionTrackId"
                      :frame-width="projectSettings.width"
                      :frame-height="projectSettings.height"
                      :active="
                        active && status === 'saved'
                      " /><GraphicScenePreview
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
                      :playing="slot.playing"
                      :scenes="state.composition.graphicScenes ?? []"
                      :frame-width="projectSettings.width"
                      :frame-height="projectSettings.height"
                      :selected-scene-id="graphicSceneSelection.sceneId"
                      :selected-node-id="graphicSceneSelection.nodeId"
                      :editing="graphicLayerEditing"
                      :snapping="graphicSnapping"
                      :guides="graphicGuides"
                      @select="selectGraphicLayer"
                      @command="command" /></template
                ></PhotoPresentationPreview>
                <div
                  v-else-if="playbackAsset.mediaType === 'image'"
                  class="editor-composition-frame"
                  :style="previewFrameStyle"
                >
                  <img
                    :key="sourcePlaybackKey"
                    crossorigin="anonymous"
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
                  <NativeCaptionPreview
                    v-if="
                      state.composition.captionTracks?.length && playbackClip
                    "
                    :composition="state.composition"
                    :composition-id="compositionId"
                    :project-id="projectId"
                    :revision="state.revision"
                    :frame="
                      sequenceFrameAt(
                        Math.max(
                          0,
                          playbackClip.timelineStart +
                            (sourceTime - (playbackClip.sourceIn ?? 0)) /
                              (playbackClip.transform?.speed ?? 1),
                        ),
                        projectTimebase,
                      )
                    "
                    :frame-rate="projectSettings.frameRate"
                    :caption-track-id="captionTrackId"
                    :frame-width="projectSettings.width"
                    :frame-height="projectSettings.height"
                    :active="active && status === 'saved'"
                    :clip="playbackClip"
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
                      graphicPreviewTime ??
                      playbackClip.timelineStart +
                        (sourceTime - (playbackClip.sourceIn ?? 0)) /
                          (playbackClip.transform?.speed ?? 1)
                    "
                    :playing="playing"
                    :scenes="state.composition.graphicScenes ?? []"
                    :frame-width="projectSettings.width"
                    :frame-height="projectSettings.height"
                    :selected-scene-id="graphicSceneSelection.sceneId"
                    :selected-node-id="graphicSceneSelection.nodeId"
                    :editing="graphicLayerEditing"
                    :snapping="graphicSnapping"
                    :guides="graphicGuides"
                    @select="selectGraphicLayer"
                    @command="command"
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
                    crossorigin="anonymous"
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
                    crossorigin="anonymous"
                    :src="sourceUrl(playbackAsset.id, sourcePlaybackKey)"
                    :poster="
                      playbackAsset.thumbnailUri
                        ? thumbnailUrl(playbackAsset.id)
                        : undefined
                    "
                    :controls="!playbackLookActive && !pictureAdjusting"
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
                  <NativeCaptionPreview
                    v-if="
                      state.composition.captionTracks?.length && playbackClip
                    "
                    :composition="state.composition"
                    :composition-id="compositionId"
                    :project-id="projectId"
                    :revision="state.revision"
                    :frame="
                      sequenceFrameAt(
                        Math.max(
                          0,
                          playbackClip.timelineStart +
                            (sourceTime - (playbackClip.sourceIn ?? 0)) /
                              (playbackClip.transform?.speed ?? 1),
                        ),
                        projectTimebase,
                      )
                    "
                    :frame-rate="projectSettings.frameRate"
                    :caption-track-id="captionTrackId"
                    :frame-width="projectSettings.width"
                    :frame-height="projectSettings.height"
                    :active="active && status === 'saved'"
                    :player="
                      playbackAsset.mediaType === 'video'
                        ? sourcePlayer
                        : undefined
                    "
                    :clip="playbackClip"
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
                      graphicPreviewTime ??
                      playbackClip.timelineStart +
                        (sourceTime - (playbackClip.sourceIn ?? 0)) /
                          (playbackClip.transform?.speed ?? 1)
                    "
                    :playing="playing"
                    :scenes="state.composition.graphicScenes ?? []"
                    :frame-width="projectSettings.width"
                    :frame-height="projectSettings.height"
                    :selected-scene-id="graphicSceneSelection.sceneId"
                    :selected-node-id="graphicSceneSelection.nodeId"
                    :editing="graphicLayerEditing"
                    :snapping="graphicSnapping"
                    :guides="graphicGuides"
                    @select="selectGraphicLayer"
                    @command="command"
                  />
                </div>
              </template>
              <div
                v-else-if="
                  state.composition.graphicScenes?.length ||
                  state.composition.captionTracks?.length
                "
                class="editor-composition-frame"
                :style="previewFrameStyle"
              >
                <NativeCaptionPreview
                  v-if="state.composition.captionTracks?.length"
                  :composition="state.composition"
                  :composition-id="compositionId"
                  :project-id="projectId"
                  :revision="state.revision"
                  :frame="
                    sequenceFrameAt(
                      Math.max(0, graphicPreviewTime ?? 0),
                      projectTimebase,
                    )
                  "
                  :frame-rate="projectSettings.frameRate"
                  :caption-track-id="captionTrackId"
                  :frame-width="projectSettings.width"
                  :frame-height="projectSettings.height"
                  :active="active && status === 'saved'"
                />
                <GraphicScenePreview
                  v-if="state.composition.graphicScenes?.length"
                  :composition-id="compositionId"
                  :project-id="projectId"
                  :revision="state.revision"
                  :source-version="sourceVersion"
                  :frame-rate="projectSettings.frameRate"
                  :duration="state.composition.duration"
                  :active="active && editMode === 'story' && status === 'saved'"
                  :time="graphicPreviewTime ?? 0"
                  :playing="false"
                  :scenes="state.composition.graphicScenes"
                  :frame-width="projectSettings.width"
                  :frame-height="projectSettings.height"
                  :selected-scene-id="graphicSceneSelection.sceneId"
                  :selected-node-id="graphicSceneSelection.nodeId"
                  :editing="graphicLayerEditing"
                  :snapping="graphicSnapping"
                  :guides="graphicGuides"
                  @select="selectGraphicLayer"
                  @command="command"
                />
              </div>
              <div v-else class="editor-source-empty">
                <Icon name="film" :size="30" /><span>{{
                  t("editor.source.choose")
                }}</span>
              </div>
              <ClipTransformOverlay
                v-if="pictureAdjusting && pictureCapable"
                ref="clipTransformOverlay"
                :value="pictureValue"
                :geometry="previewGeometry"
                :disabled="pictureBlocked"
                :session-key="pictureSessionKey"
                @preview="previewPicture"
                @commit="commitPicture"
                @activity="pictureGestureActive = $event"
                @cancelled="resetPicturePreview"
              />
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
                  <button
                    class="editor-button"
                    :class="{ selected: pictureAdjusting }"
                    :aria-pressed="pictureAdjusting"
                    :title="
                      t(
                        photoPresentationActive
                          ? 'editor.picture.presentationHint'
                          : 'editor.picture.hint',
                      )
                    "
                    :disabled="!pictureCapable || pictureBlocked"
                    @click="togglePictureAdjustment"
                  >
                    {{ t("editor.picture.toggle") }}
                  </button>
                  <template v-if="pictureAdjusting">
                    <button
                      class="editor-button"
                      :disabled="!pictureCapable || pictureBlocked"
                      @click="resetPicture(true)"
                    >
                      {{ t("editor.picture.center") }}
                    </button>
                    <button
                      class="editor-button"
                      :disabled="!pictureCapable || pictureBlocked"
                      @click="resetPicture()"
                    >
                      {{ t("editor.picture.reset") }}
                    </button>
                  </template>
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
                v-if="!playbackAsset && state.composition.graphicScenes?.length"
                class="editor-monitor-transport"
              >
                <time :aria-label="t('editor.monitor.timecode')">{{
                  formatTimecode(
                    graphicPreviewTime ?? 0,
                    projectSettings.frameRate,
                  )
                }}</time>
              </div>
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
            v-if="state?.composition.tracks.length"
            class="cut-desk-track-controls"
            role="toolbar"
            :aria-label="t('cutDesk.tracks.label')"
          >
            <div
              v-for="track in state.composition.tracks"
              :key="track.id"
              class="cut-desk-track-header"
              :class="{
                'is-locked': track.locked,
                'is-target': track.target,
                'is-muted': track.muted,
                'is-solo': track.solo,
                'is-hidden': track.visible === false,
              }"
              :data-testid="`track-header-${track.id}`"
            >
              <span class="track-badge">{{ track.type.toUpperCase() }}</span>
              <span class="track-title" :title="track.id">{{ track.id }}</span>
              <div
                class="track-btn-group"
                role="group"
                :aria-label="t('cutDesk.tracks.controlsFor', { id: track.id })"
              >
                <button
                  type="button"
                  class="track-btn track-target-btn"
                  :class="{ active: track.target }"
                  :aria-pressed="!!track.target"
                  :aria-label="t('cutDesk.tracks.target', { id: track.id })"
                  :title="t('cutDesk.tracks.targetHint')"
                  :disabled="historyBusy"
                  @click="toggleTrackTarget(track)"
                >
                  T
                </button>
                <button
                  type="button"
                  class="track-btn track-lock-btn"
                  :class="{ active: track.locked }"
                  :aria-pressed="!!track.locked"
                  :aria-label="t('cutDesk.tracks.lock', { id: track.id })"
                  :title="t('cutDesk.tracks.lockHint')"
                  :disabled="historyBusy"
                  @click="toggleTrackLock(track)"
                >
                  <Icon :name="track.locked ? 'lock' : 'unlock'" :size="12" />
                </button>
                <button
                  v-if="['video', 'overlay', 'titles'].includes(track.type)"
                  type="button"
                  class="track-btn track-visible-btn"
                  :class="{ active: track.visible !== false }"
                  :aria-pressed="track.visible !== false"
                  :aria-label="t('cutDesk.tracks.visible', { id: track.id })"
                  :title="t('cutDesk.tracks.visibleHint')"
                  :disabled="historyBusy"
                  @click="toggleTrackVisible(track)"
                >
                  <Icon
                    :name="track.visible === false ? 'eye-off' : 'eye'"
                    :size="12"
                  />
                </button>
                <button
                  v-if="['audio', 'music', 'video'].includes(track.type)"
                  type="button"
                  class="track-btn track-mute-btn"
                  :class="{ active: track.muted }"
                  :aria-pressed="!!track.muted"
                  :aria-label="t('cutDesk.tracks.mute', { id: track.id })"
                  :title="t('cutDesk.tracks.muteHint')"
                  :disabled="historyBusy"
                  @click="toggleTrackMute(track)"
                >
                  M
                </button>
                <button
                  v-if="['audio', 'music', 'video'].includes(track.type)"
                  type="button"
                  class="track-btn track-solo-btn"
                  :class="{ active: track.solo }"
                  :aria-pressed="!!track.solo"
                  :aria-label="t('cutDesk.tracks.solo', { id: track.id })"
                  :title="t('cutDesk.tracks.soloHint')"
                  :disabled="historyBusy"
                  @click="toggleTrackSolo(track)"
                >
                  S
                </button>
              </div>
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
            <button
              :class="{ selected: inspector === 'templates' }"
              :aria-pressed="inspector === 'templates'"
              :disabled="directionBlocked"
              data-testid="graphic-template-tab"
              @click="inspector = 'templates'"
            >
              {{ t("editor.templates.tab") }}
            </button>
          </div>
          <GraphicSceneInspector
            v-if="inspector === 'graphics'"
            :project-id="projectId"
            :composition-id="compositionId"
            :revision="state.revision"
            :scenes="state.composition.graphicScenes ?? []"
            :duration="state.composition.duration"
            :frame-rate="projectSettings.frameRate"
            :assets="state.assets"
            :dependency-version="
              (jobs ?? [])
                .filter(
                  (job) =>
                    job.type === 'import' &&
                    ['completed', 'failed', 'cancelled'].includes(job.status),
                )
                .map((job) => `${job.id}:${job.status}`)
                .join('|')
            "
            :selected-scene-id="graphicSceneSelection.sceneId"
            :selected-node-id="graphicSceneSelection.nodeId"
            :snapping="graphicSnapping"
            :guides="graphicGuides"
            :agent-disabled="
              directionBlocked ||
              compositionHistoryBusy ||
              compositionHasPending ||
              status !== 'saved'
            "
            :disabled="
              directionBlocked ||
              historyBusy ||
              status === 'conflict' ||
              status === 'failed'
            "
            @command="command"
            @pin="changeUserPin"
            @selection="selectGraphicLayer"
            @preview-time="previewGraphicAtTime"
            @import-assets="emit('importAssets')"
            @update:snapping="setGraphicSnapping"
            @update:guides="setGraphicGuides"
            @agent-busy="setGraphicAgentBusy"
            @agent-pending="setGraphicAgentPending"
            @agent-accepted="reloadAfterGraphicAgent"
            @agent-reload="reloadAfterGraphicAgent"
          />
          <GraphicSceneTemplateStudio
            v-if="inspector === 'templates' && state"
            :scenes="state.composition.graphicScenes ?? []"
            :records="state.composition.graphicSceneTemplates ?? []"
            :duration="state.composition.duration"
            :width="projectSettings.width"
            :height="projectSettings.height"
            :locale="projectContentLocale ?? 'en-US'"
            :assets="state.assets"
            :disabled="
              directionBlocked ||
              historyBusy ||
              status === 'conflict' ||
              status === 'failed'
            "
            @command="templateCommand"
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
              class="editor-presets editor-user-pins"
              :title="t('editor.pins.hint')"
            >
              <button
                type="button"
                class="editor-button"
                data-testid="clip-user-pin"
                :disabled="
                  historyBusy ||
                  !!selectedClip.locked ||
                  !!selectedAsset.state.locked
                "
                :aria-pressed="!!selectedClip.userOverrides?.isUserPinned"
                @click="
                  changeUserPin(
                    { kind: 'clip', clipId: selectedClip.id },
                    !selectedClip.userOverrides?.isUserPinned,
                  )
                "
              >
                <Icon name="pin" :size="14" />{{
                  t(
                    selectedClip.userOverrides?.isUserPinned
                      ? "editor.pins.unpin"
                      : "editor.pins.pin",
                  )
                }}
              </button>
              <button
                v-if="selectedClip.userOverrides?.isUserPinned"
                type="button"
                class="editor-button"
                data-testid="clip-user-pin-resolve"
                :disabled="
                  historyBusy ||
                  !!selectedClip.locked ||
                  !!selectedAsset.state.locked
                "
                :title="t('editor.pins.releaseHint')"
                @click="
                  changeUserPin(
                    { kind: 'clip', clipId: selectedClip.id },
                    false,
                    true,
                  )
                "
              >
                {{ t("editor.pins.releaseResolve") }}
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
            <AudioTimingInspector
              v-if="
                selectedAsset.mediaType === 'audio' ||
                selectedAsset.mediaType === 'video'
              "
              :project-id="projectId"
              :composition-id="compositionId"
              :revision="state.revision"
              :composition-duration="state.composition.duration"
              :clip="selectedClip"
              :asset="selectedAsset"
              :busy="
                historyBusy ||
                directionBlocked ||
                graphicAgentBusy ||
                graphicAgentPending
              "
              :active="active"
              :source-version="sourceVersion"
              :commit="commitSoundTiming"
            />
            <PrimaryColorInspector
              :composition="state.composition"
              :clip="selectedClip"
              :assets="state.assets"
              :project-id="projectId"
              :revision="state.revision"
              :clip-eligible="lookEligible"
              :clip-protected="!!selectedClip.locked || clipSourceLocked"
              :disabled="historyBusy || directionBlocked"
              @command="command"
            />
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
                      <option value="dip-to-black">
                        {{ t("editor.clip.dipToBlack") }}
                      </option>
                      <option value="dip-to-white">
                        {{ t("editor.clip.dipToWhite") }}
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
                          transition:
                            selectedClip.transition?.type ?? 'crossfade',
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
                  :focal-editing="focalEditing"
                  :focal-disabled="focalBlocked"
                  @command="command"
                  @focus="toggleFocal"
                />
                <NativeTextFontStatus
                  v-if="selectedClip.title"
                  :project-id="projectId"
                  :composition-id="compositionId"
                  :revision="state.revision"
                  :reference="{ kind: 'title', clipId: selectedClip.id }"
                  :active="active && status === 'saved'"
                />
              </fieldset>
            </fieldset>
            <MotionGenerationPanel
              v-if="
                selectedAsset.mediaType === 'image' ||
                selectedAsset.metadata?.['openfilm.motionGeneration']
              "
              :project-id="projectId"
              :composition-id="compositionId"
              :state="state"
              :clip="selectedClip"
              :asset="selectedAsset"
              :frame="projectSettings"
              :source-version="sourceVersion"
              :disabled="
                !!selectedClip.locked ||
                clipSourceLocked ||
                !!sourceUnavailable ||
                historyBusy ||
                hasPending ||
                generationImportBusy
              "
              :flush-inputs="flushInputs"
              @apply="applyMotion"
            />
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
                historyBusy
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
          <template v-else-if="inspector === 'sound'">
            <button
              class="editor-button"
              type="button"
              :aria-expanded="audioGenerationOpen"
              @click="audioGenerationOpen = !audioGenerationOpen"
            >
              {{ t("editor.audioGeneration.title") }}
            </button>
            <AudioGenerationPanel
              v-if="audioGenerationOpen"
              :project-id="projectId"
              :composition-id="compositionId"
              :revision="state?.revision ?? ''"
              :disabled="
                hasPending ||
                historyBusy ||
                directionBlocked ||
                graphicAgentBusy ||
                graphicAgentPending
              "
              @import="importGeneratedAudio"
            />
            <SoundtrackPanel
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
          </template>
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
              {{ t("editor.titleFinishing.previewTrack") }}
              <select
                :value="
                  captionTrackId === undefined
                    ? '__default__'
                    : captionTrackId === null
                      ? '__none__'
                      : captionTrackId
                "
                :disabled="historyBusy"
                data-testid="monitor-caption-track"
                @change="
                  emit(
                    'captionTrack',
                    ($event.target as HTMLSelectElement).value === '__default__'
                      ? undefined
                      : ($event.target as HTMLSelectElement).value ===
                          '__none__'
                        ? null
                        : ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="__default__">
                  {{ t("editor.titleFinishing.firstTrack") }}
                </option>
                <option value="__none__">
                  {{ t("editor.titleFinishing.noCaptions") }}
                </option>
                <option
                  v-for="track in captionTracks"
                  :key="track.id"
                  :value="track.id"
                >
                  {{ track.name }}
                </option>
              </select>
            </label>
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
                <label v-if="!selectedCaptionCue.textRuns" class="editor-field">
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
                <BilingualTextControls
                  :key="selectedCaptionCue.id"
                  :text="selectedCaptionCue.text"
                  :runs="selectedCaptionCue.textRuns"
                  :style="selectedCaptionTrack.style"
                  :frame="projectSettings"
                  :disabled="historyBusy"
                  @change="
                    updateCaptionCue({
                      text: $event.text,
                      textRuns: $event.runs,
                    })
                  "
                />
                <NativeTextFontStatus
                  :project-id="projectId"
                  :composition-id="compositionId"
                  :revision="state.revision"
                  :reference="{
                    kind: 'caption',
                    trackId: selectedCaptionTrack.id,
                    cueId: selectedCaptionCue.id,
                  }"
                  :active="active && status === 'saved'"
                />
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
                    v-model.number="captionFontSize"
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
                      v-model.number="captionSafeArea[side]"
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
              <TitleFinishingControls
                :style="selectedCaptionTrack.style"
                :disabled="historyBusy"
                @change="
                  command({
                    type: 'caption.track.style',
                    trackId: selectedCaptionTrack.id,
                    style: $event,
                  })
                "
              />
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
      <footer
        v-show="editMode === 'story' || cutDeskDualMode"
        class="editor-shortcuts"
      >
        <span>{{ t("editor.originalsSafe") }}</span
        ><span>{{
          t(expertMode ? "cutDesk.shortcuts" : "editor.shortcuts")
        }}</span>
        <button
          v-if="expertMode"
          type="button"
          class="editor-button cut-desk-shortcuts-btn"
          :aria-label="t('cutDesk.shortcutSheet.toggle')"
          @click="shortcutSheetOpen = true"
        >
          ? {{ t("cutDesk.shortcutSheet.toggle") }}
        </button>
      </footer>
      <ShortcutSheet
        :open="shortcutSheetOpen"
        @close="shortcutSheetOpen = false"
      />
    </template>
  </section>
</template>
