<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  SourceDraft,
  SourceSelection,
  TravelContextV1,
  TravelTrackV1,
  ReviewDecisionOperation,
  Story,
} from "@openfilm/core";
import type {
  CatalogOccurrencePage,
  SourceBatchProgress,
  SourceBatchSealResult,
  SourceDiscoverySummary,
  SourceAnalysisRunRecord,
  SourceAnalysisReviewPreview,
  SourceAnalysisReviewItem,
  SourceSelectionInput,
} from "@openfilm/application";
import type { BrowserSourceAvailability } from "../browserSourceAccess";
import { api } from "../api";
import type {
  SourceAnalysisProgressState,
  VisionSampleProviderInfo,
} from "../api";
import {
  classifyNativeDrop,
  browserFilesForSelections,
  clearBrowserEphemeral,
  iterateBrowserSelectionFiles,
  listenForNativeDrop,
  pickBrowserFallbackFolders,
  pickBrowserFiles,
  pickBrowserFolder,
  pickNativeFiles,
  pickNativeFolders,
  releaseBrowserSources,
  sourcesFromBrowserDrop,
  sourceAvailabilities,
  type PickedSources,
} from "../sourcePicker";
import Icon from "./Icon.vue";
import {
  clearSourceReviewAcceptance,
  readSourceReviewAcceptance,
  retainSourceReviewAcceptance,
  type PendingSourceReviewAcceptance,
} from "../source-review-acceptance";

const props = defineProps<{
  projectId: string;
  native: boolean;
  busy: boolean;
  expert: boolean;
  progress?: {
    completed: number;
    total: number;
    bytesUploaded: number;
    totalBytes: number;
  };
}>();
const emit = defineEmits<{
  error: [error: unknown];
  close: [];
  cancel: [];
  folder: [path: string];
  files: [paths: string[]];
  upload: [files: File[]];
  reviewed: [projectId: string];
}>();
const { t } = useI18n();
const draft = ref<SourceDraft>();
const loading = ref(false);
const mutating = ref(false);
const dragging = ref(false);
const rejected = ref<PickedSources["rejected"]>([]);
const access = ref<Record<string, BrowserSourceAvailability>>({});
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const serverPath = ref("");
const serverPathOpen = ref(false);
const sourcePage = ref(0);
const scanSummary = ref<SourceDiscoverySummary>();
const scanning = ref(false);
const sealing = ref(false);
const sealProgress = ref<SourceBatchProgress>();
const sealResult = ref<SourceBatchSealResult>();
const analysisRecord = ref<SourceAnalysisRunRecord>();
const analysisProgress = ref<SourceAnalysisProgressState>();
const analyzing = ref(false);
const wholeProjectConfirmed = ref(false);
const analysisRunId = ref("");
const travelEnabled = ref(false);
const travelTrack = ref<TravelTrackV1>();
const travelParsing = ref(false);
const travelClockOffsetMinutes = ref(0);
const travelTimeZone = ref("");
const travelFileInput = ref<HTMLInputElement | null>(null);
const visualSamplingEnabled = ref(false);
const visualProviderId = ref("");
const visualConsentAcknowledged = ref(false);
const visionSampleProviders = ref<VisionSampleProviderInfo[]>([]);
const visionProvidersLoading = ref(false);
const visionConsentBusy = ref(false);
const reviewQuery = ref("");
const reviewResults = ref<SourceAnalysisReviewItem[]>([]);
const reviewTotal = ref(0);
const reviewOffset = ref(0);
const selectedReviewIds = ref<string[]>([]);
const reviewOperationKind = ref<
  "reject" | "merge" | "split" | "correct" | "adopt"
>("reject");
const reviewAxis = ref<
  "label" | "capture-time" | "location" | "narrative-note"
>("narrative-note");
const reviewCorrection = ref("");
const reviewSplitStart = ref(0);
const reviewSplitEnd = ref(1);
const reviewSplitAssetId = ref("");
const reviewStoryId = ref("");
const reviewStories = ref<Story[]>([]);
const reviewPreview = ref<SourceAnalysisReviewPreview>();
const reviewDecisions = ref<import("@openfilm/core").ReviewDecision[]>([]);
const reviewing = ref(false);
const reviewSearching = ref(false);
const reviewPreviewFormKey = ref("");
const pendingReviewAcceptance = ref<PendingSourceReviewAcceptance>();
const reviewStorageFailed = ref(false);
const reviewSupersedesDecisionId = ref("");
let reviewSearchSequence = 0;
let reviewSearchTimer: ReturnType<typeof setTimeout> | undefined;
const loadingOccurrences = ref(false);
const occurrencePage = ref<CatalogOccurrencePage>();
const occurrenceSelectionId = ref("");
const occurrenceOffset = ref(0);
let generation = 0;
let draftReadSequence = 0;
const activeBrowserScans = new Map<
  string,
  { selectionId: string; scanRevision: number; baseRevision: number }
>();
let availabilityReadSequence = 0;
let removeNativeDrop: (() => void) | undefined;
let scanController: AbortController | undefined;
let sealController: AbortController | undefined;
let analysisController: AbortController | undefined;

const SOURCE_PAGE_SIZE = 100;
const OCCURRENCE_PAGE_SIZE = 20;
const REJECTED_PREVIEW_SIZE = 5;

const blocked = computed(
  () =>
    props.busy ||
    loading.value ||
    mutating.value ||
    scanning.value ||
    sealing.value ||
    analyzing.value ||
    travelParsing.value ||
    Boolean(pendingReviewAcceptance.value),
);
const canSeal = computed(
  () =>
    !!draft.value &&
    !!scanSummary.value &&
    scanSummary.value.draftRevision === draft.value.revision &&
    !scanSummary.value.cancelled &&
    scanSummary.value.failed === 0 &&
    scanSummary.value.sourcesScanned === scanSummary.value.sourcesRequested &&
    scanSummary.value.supported > 0 &&
    draft.value.selections.length > 0 &&
    draft.value.selections.every(
      (source) =>
        source.accessClass === "native-path" ||
        source.accessClass === "persistent-browser-handle" ||
        source.accessClass === "ephemeral-browser-file",
    ),
);
const canAnalyze = computed(
  () =>
    !blocked.value &&
    Boolean(sealResult.value?.verifiedManifest.members.length) &&
    (!travelEnabled.value || Boolean(travelTrack.value)) &&
    (!visualSamplingEnabled.value ||
      !visualProviderId.value ||
      selectedVisionProvider.value?.execution !== "remote" ||
      selectedVisionProvider.value.enabled) &&
    (!wholeProjectConfirmed.value ||
      Boolean(sealResult.value?.verifiedManifest.members.length)),
);
const travelAssetCount = computed(
  () =>
    new Set(
      sealResult.value?.verifiedManifest.members.map(
        ({ assetId }) => assetId,
      ) ?? [],
    ).size,
);
const travelTrackPointCount = computed(
  () =>
    travelTrack.value?.segments.reduce(
      (sum, segment) => sum + segment.points.length,
      0,
    ) ?? 0,
);
const selectedVisionProvider = computed(() =>
  visionSampleProviders.value.find(({ id }) => id === visualProviderId.value),
);
const selectedReviewResults = computed(() =>
  reviewResults.value.filter(({ id }) => selectedReviewIds.value.includes(id)),
);
const supersedableReviewDecisions = computed(() =>
  reviewDecisions.value.filter(
    (decision) =>
      decision.outcome === "conflicted" &&
      decision.targetIds.some((id) => selectedReviewIds.value.includes(id)),
  ),
);
const reviewTargetStoryTitle = computed(() => {
  const operation = reviewPreview.value?.operation;
  return operation?.kind === "adopt-story"
    ? (reviewStories.value.find(({ id }) => id === operation.storyId)?.title ??
        operation.storyId)
    : "";
});
watch(supersedableReviewDecisions, (decisions) => {
  if (!decisions.some(({ id }) => id === reviewSupersedesDecisionId.value))
    reviewSupersedesDecisionId.value = "";
});
const selectedReviewSourceBounds = computed(
  () => selectedReviewResults.value[0]?.sourceBounds ?? [],
);
const selectedReviewSourceBound = computed(() =>
  selectedReviewSourceBounds.value.find(
    ({ assetId }) => assetId === reviewSplitAssetId.value,
  ),
);
watch(
  selectedReviewSourceBounds,
  (bounds) => {
    if (!bounds.some(({ assetId }) => assetId === reviewSplitAssetId.value))
      reviewSplitAssetId.value = bounds[0]?.assetId ?? "";
  },
  { flush: "sync" },
);
watch(
  selectedReviewSourceBound,
  (bound) => {
    if (bound && reviewSplitEnd.value >= bound.duration)
      reviewSplitEnd.value = bound.duration / 2;
    if (reviewSplitStart.value >= reviewSplitEnd.value)
      reviewSplitStart.value = 0;
  },
  { flush: "sync" },
);
const reviewFormKey = computed(() =>
  JSON.stringify([
    props.projectId,
    analysisRecord.value?.run.id,
    [...selectedReviewIds.value].sort(),
    reviewOperationKind.value,
    reviewAxis.value,
    reviewCorrection.value,
    reviewSplitStart.value,
    reviewSplitEnd.value,
    reviewSplitAssetId.value,
    selectedReviewSourceBound.value?.duration,
    reviewStoryId.value,
    reviewSupersedesDecisionId.value,
  ]),
);
watch(
  reviewFormKey,
  () => {
    reviewPreview.value = undefined;
    reviewPreviewFormKey.value = "";
  },
  { flush: "sync" },
);
const folderCount = computed(
  () =>
    draft.value?.selections.filter((source) => source.kind === "folder")
      .length ?? 0,
);
const fileCount = computed(
  () =>
    draft.value?.selections.filter((source) => source.kind === "file").length ??
    0,
);
const sourcePageCount = computed(() =>
  Math.max(
    1,
    Math.ceil((draft.value?.selections.length ?? 0) / SOURCE_PAGE_SIZE),
  ),
);
const visibleSources = computed(() => {
  const start = sourcePage.value * SOURCE_PAGE_SIZE;
  return (draft.value?.selections ?? []).slice(start, start + SOURCE_PAGE_SIZE);
});
const sourceRangeStart = computed(() =>
  visibleSources.value.length ? sourcePage.value * SOURCE_PAGE_SIZE + 1 : 0,
);
const sourceRangeEnd = computed(
  () => sourceRangeStart.value + visibleSources.value.length - 1,
);
const visibleRejected = computed(() =>
  rejected.value.slice(0, REJECTED_PREVIEW_SIZE),
);
const hiddenRejectedCount = computed(() =>
  Math.max(0, rejected.value.length - visibleRejected.value.length),
);
const compatibleStart = computed(() => {
  const selections = draft.value?.selections ?? [];
  if (!selections.length) return false;
  if (
    selections.length === 1 &&
    selections[0]!.kind === "folder" &&
    selections[0]!.accessClass === "native-path" &&
    selections[0]!.recursive
  )
    return true;
  if (
    selections.every(
      (source) =>
        source.kind === "file" && source.accessClass === "native-path",
    )
  )
    return true;
  return selections.every(
    (source) =>
      source.kind === "file" &&
      source.accessClass === "ephemeral-browser-file" &&
      access.value[source.id] === "available",
  );
});

function requestId(): string {
  return crypto.randomUUID();
}

async function refreshAvailability(
  snapshot: SourceDraft,
  owner: string,
  token: number,
): Promise<void> {
  const start = sourcePage.value * SOURCE_PAGE_SIZE;
  const page = snapshot.selections.slice(start, start + SOURCE_PAGE_SIZE);
  const included = new Set(page.map((source) => source.id));
  const sources = [
    ...page,
    ...snapshot.selections.filter(
      (source) =>
        source.accessClass === "ephemeral-browser-file" &&
        !included.has(source.id),
    ),
  ];
  const readSequence = ++availabilityReadSequence;
  const entries = await sourceAvailabilities(owner, sources);
  if (
    readSequence !== availabilityReadSequence ||
    token !== generation ||
    owner !== props.projectId ||
    draft.value?.revision !== snapshot.revision
  )
    return;
  access.value = { ...access.value, ...entries };
}

function acceptDraft(next: SourceDraft, owner: string, token: number): void {
  if (token !== generation || owner !== props.projectId) return;
  if (draft.value && draft.value.revision !== next.revision) {
    scanSummary.value = undefined;
    occurrencePage.value = undefined;
    occurrenceSelectionId.value = "";
    occurrenceOffset.value = 0;
    sealProgress.value = undefined;
    sealResult.value = undefined;
    travelTrack.value = undefined;
  }
  draft.value = next;
  sourcePage.value = Math.min(
    sourcePage.value,
    Math.max(0, Math.ceil(next.selections.length / SOURCE_PAGE_SIZE) - 1),
  );
  access.value = {};
  void refreshAvailability(next, owner, token).catch((error) => {
    if (token === generation && owner === props.projectId) emit("error", error);
  });
}

async function prepareTravelGpx(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  travelTrack.value = undefined;
  if (!file) return;
  const owner = props.projectId;
  const token = generation;
  if (file.size > 5 * 1024 * 1024) {
    emit("error", new Error(t("app.import.analysis.travel.tooLarge")));
    return;
  }
  travelParsing.value = true;
  try {
    const trackId = `gpx-${crypto.randomUUID()}`;
    const { track } = await api.parseTravelGpx(trackId, file);
    if (token === generation && owner === props.projectId)
      travelTrack.value = track;
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
  } finally {
    if (token === generation && owner === props.projectId)
      travelParsing.value = false;
  }
}

function currentTravelContext(): TravelContextV1 | undefined {
  if (!travelEnabled.value) return undefined;
  const track = travelTrack.value;
  const manifest = sealResult.value?.verifiedManifest;
  if (!track || !manifest)
    throw new Error(t("app.import.analysis.travel.required"));
  const assetIds = [
    ...new Set(manifest.members.map(({ assetId }) => assetId)),
  ].sort();
  if (!assetIds.length)
    throw new Error(t("app.import.analysis.travel.required"));
  const offsetMilliseconds = Math.round(
    Number(travelClockOffsetMinutes.value || 0) * 60_000,
  );
  const timeZone = travelTimeZone.value.trim();
  const clockMappings =
    offsetMilliseconds !== 0 || timeZone
      ? [
          {
            id: `clock-${crypto.randomUUID()}`,
            assetIds,
            offsetMilliseconds,
            ...(timeZone ? { timeZone } : {}),
            source: "manual" as const,
          },
        ]
      : [];
  return {
    version: 1,
    algorithmVersion: "travel-v1",
    tracks: [track],
    clockMappings,
    assignments: [{ trackId: track.id, assetIds }],
  };
}

function currentVisualSampling() {
  if (!visualSamplingEnabled.value) return undefined;
  return {
    version: 1 as const,
    algorithmVersion: "representative-frames-v1" as const,
    ...(visualProviderId.value ? { providerId: visualProviderId.value } : {}),
  };
}

async function refreshVisionSampleProviders(
  owner: string,
  token: number,
): Promise<void> {
  visionProvidersLoading.value = true;
  try {
    const result = await api.visionSampleProviders();
    if (owner === props.projectId && token === generation) {
      visionSampleProviders.value = result.providers;
      if (
        visualProviderId.value &&
        !result.providers.some(({ id }) => id === visualProviderId.value)
      )
        visualProviderId.value = "";
    }
  } catch (error) {
    if (owner === props.projectId && token === generation) emit("error", error);
  } finally {
    if (owner === props.projectId && token === generation)
      visionProvidersLoading.value = false;
  }
}

async function grantSelectedVisionConsent(): Promise<void> {
  const provider = selectedVisionProvider.value;
  if (
    !provider ||
    provider.execution !== "remote" ||
    visualConsentAcknowledged.value !== true
  )
    return;
  const owner = props.projectId;
  const token = generation;
  visionConsentBusy.value = true;
  try {
    const result = await api.grantVisionSampleConsent(provider.id);
    if (owner === props.projectId && token === generation) {
      visionSampleProviders.value = result.providers;
      visualConsentAcknowledged.value = false;
    }
  } catch (error) {
    if (owner === props.projectId && token === generation) emit("error", error);
  } finally {
    if (owner === props.projectId && token === generation)
      visionConsentBusy.value = false;
  }
}

async function revokeSelectedVisionConsent(): Promise<void> {
  const provider = selectedVisionProvider.value;
  if (!provider || provider.execution !== "remote") return;
  const owner = props.projectId;
  const token = generation;
  visionConsentBusy.value = true;
  try {
    const result = await api.revokeVisionSampleConsent(provider.id);
    if (owner === props.projectId && token === generation)
      visionSampleProviders.value = result.providers;
  } catch (error) {
    if (owner === props.projectId && token === generation) emit("error", error);
  } finally {
    if (owner === props.projectId && token === generation)
      visionConsentBusy.value = false;
  }
}

async function loadReviewPage(): Promise<void> {
  const runId = analysisRecord.value?.run.id;
  if (!runId) return;
  const owner = props.projectId;
  const token = generation;
  const sequence = ++reviewSearchSequence;
  const query = reviewQuery.value;
  const offset = reviewOffset.value;
  const current = () =>
    owner === props.projectId &&
    token === generation &&
    sequence === reviewSearchSequence &&
    analysisRecord.value?.run.id === runId &&
    query === reviewQuery.value &&
    offset === reviewOffset.value;
  reviewSearching.value = true;
  selectedReviewIds.value = [];
  reviewResults.value = [];
  try {
    const response = await api.searchSourceAnalysisReview(
      runId,
      query,
      offset,
      50,
    );
    if (!current()) return;
    reviewResults.value = response.result.items;
    reviewTotal.value = response.result.total;
    reviewDecisions.value = response.decisions;
  } catch (error) {
    if (current()) emit("error", error);
  } finally {
    if (current()) reviewSearching.value = false;
  }
}

function makeReviewOperation(): ReviewDecisionOperation {
  const resultIds = selectedReviewIds.value;
  if (!resultIds.length)
    throw new Error(t("app.import.analysis.review.selectResults"));
  if (reviewOperationKind.value === "reject")
    return { kind: "reject-results", resultIds: [...resultIds] };
  if (reviewOperationKind.value === "merge")
    return { kind: "merge-results", resultIds: [...resultIds] };
  if (reviewOperationKind.value === "adopt") {
    if (!reviewStoryId.value)
      throw new Error(t("app.import.analysis.review.storyRequired"));
    return {
      kind: "adopt-story",
      storyId: reviewStoryId.value,
      resultIds: [...resultIds],
    };
  }
  if (resultIds.length !== 1)
    throw new Error(t("app.import.analysis.review.selectOne"));
  const resultId = resultIds[0]!;
  if (reviewOperationKind.value === "split") {
    if (
      !selectedReviewSourceBound.value ||
      !Number.isFinite(reviewSplitStart.value) ||
      !Number.isFinite(reviewSplitEnd.value) ||
      reviewSplitStart.value < 0 ||
      reviewSplitEnd.value <= reviewSplitStart.value ||
      reviewSplitEnd.value >= selectedReviewSourceBound.value.duration
    )
      throw new Error(t("app.import.analysis.review.invalidRange"));
    return {
      kind: "split-result",
      resultId,
      ranges: [
        {
          assetId: selectedReviewSourceBound.value.assetId,
          start: reviewSplitStart.value,
          end: reviewSplitEnd.value,
        },
        {
          assetId: selectedReviewSourceBound.value.assetId,
          start: reviewSplitEnd.value,
          end: selectedReviewSourceBound.value.duration,
        },
      ],
    };
  }
  if (reviewOperationKind.value === "correct") {
    const selected = selectedReviewResults.value[0];
    if (selected?.kind !== "observation" || !reviewCorrection.value.trim())
      throw new Error(t("app.import.analysis.review.correctionRequired"));
    return {
      kind: "set-observation",
      resultId,
      axis: reviewAxis.value,
      value: reviewCorrection.value.trim(),
    };
  }
  throw new Error(t("app.import.analysis.review.selectResults"));
}

async function previewReviewOperation(): Promise<void> {
  if (
    !analysisRecord.value ||
    reviewing.value ||
    reviewSearching.value ||
    blocked.value
  )
    return;
  const owner = props.projectId;
  const token = generation;
  const runId = analysisRecord.value.run.id;
  const formKey = reviewFormKey.value;
  const current = () =>
    owner === props.projectId &&
    token === generation &&
    analysisRecord.value?.run.id === runId &&
    formKey === reviewFormKey.value;
  reviewPreview.value = undefined;
  reviewing.value = true;
  try {
    const operation = makeReviewOperation();
    const { preview } = await api.previewSourceAnalysisReview(runId, operation);
    if (current()) {
      reviewPreviewFormKey.value = formKey;
      reviewPreview.value = preview;
    }
  } catch (error) {
    if (current()) emit("error", error);
  } finally {
    if (owner === props.projectId && token === generation)
      reviewing.value = false;
  }
}

async function acceptReviewOperation(): Promise<void> {
  const run = analysisRecord.value?.run;
  const preview = reviewPreview.value;
  if (
    !run ||
    !preview ||
    preview.outcome !== "ready" ||
    reviewing.value ||
    blocked.value ||
    reviewSearching.value ||
    reviewPreviewFormKey.value !== reviewFormKey.value ||
    preview.runId !== run.id
  )
    return;
  try {
    const receipt: PendingSourceReviewAcceptance = {
      version: 1,
      runId: run.id,
      payload: {
        projectId: props.projectId,
        operation: structuredClone(toRaw(preview.operation)),
        expectedManifestId: preview.manifestId,
        expectedBeforeFingerprint: preview.beforeFingerprint,
        expectedOperationFingerprint: preview.operationFingerprint,
        ...(preview.storyRevision
          ? { expectedStoryRevision: preview.storyRevision }
          : {}),
        requestId: requestId(),
        ...(reviewSupersedesDecisionId.value
          ? { supersedesDecisionId: reviewSupersedesDecisionId.value }
          : {}),
      },
    };
    retainSourceReviewAcceptance(receipt);
    pendingReviewAcceptance.value = receipt;
    reviewStorageFailed.value = false;
    reviewPreview.value = undefined;
  } catch (error) {
    reviewStorageFailed.value = true;
    emit("error", error);
    return;
  }
  await sendPendingReviewAcceptance();
}

async function sendPendingReviewAcceptance(): Promise<void> {
  const receipt = pendingReviewAcceptance.value;
  const owner = props.projectId;
  const token = generation;
  if (
    !receipt ||
    reviewing.value ||
    props.busy ||
    receipt.payload.projectId !== owner
  )
    return;
  try {
    retainSourceReviewAcceptance(toRaw(receipt));
    reviewStorageFailed.value = false;
  } catch (error) {
    reviewStorageFailed.value = true;
    emit("error", error);
    return;
  }
  const current = () =>
    owner === props.projectId &&
    token === generation &&
    pendingReviewAcceptance.value?.payload.requestId ===
      receipt.payload.requestId;
  reviewing.value = true;
  let acknowledged = false;
  try {
    const { decision } = await api.acceptSourceAnalysisReview(
      receipt.runId,
      receipt.payload,
    );
    acknowledged = true;
    if (!current()) return;
    selectedReviewIds.value = [];
    const response = await api.sourceAnalysisRun(receipt.runId);
    if (!current()) return;
    analysisRecord.value = response.result;
    await loadReviewPage();
    if (!current()) return;
    clearSourceReviewAcceptance(receipt);
    pendingReviewAcceptance.value = undefined;
    reviewStorageFailed.value = false;
    if (!reviewDecisions.value.some(({ id }) => id === decision.id))
      reviewDecisions.value = [...reviewDecisions.value, decision];
    if (
      receipt.payload.operation.kind === "adopt-story" &&
      decision.outcome === "applied"
    ) {
      emit("reviewed", owner);
    }
  } catch (error) {
    if (!current()) return;
    // Only an explicit rejection of the acceptance itself proves no commit occurred.
    if (
      !acknowledged &&
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 400 &&
      error.status < 500
    ) {
      try {
        clearSourceReviewAcceptance(receipt);
        pendingReviewAcceptance.value = undefined;
      } catch {
        reviewStorageFailed.value = true;
      }
    }
    emit("error", error);
  } finally {
    if (owner === props.projectId && token === generation)
      reviewing.value = false;
  }
}

function readStoredReviewAcceptance(): void {
  try {
    pendingReviewAcceptance.value = readSourceReviewAcceptance(props.projectId);
    reviewStorageFailed.value = false;
  } catch {
    reviewStorageFailed.value = true;
  }
}

async function loadReviewStories(owner: string, token: number): Promise<void> {
  try {
    const { project } = await api.project();
    if (owner === props.projectId && token === generation) {
      reviewStories.value = project?.stories ?? [];
      if (
        reviewStoryId.value &&
        !reviewStories.value.some(({ id }) => id === reviewStoryId.value)
      )
        reviewStoryId.value = "";
    }
  } catch (error) {
    if (owner === props.projectId && token === generation) emit("error", error);
  }
}

async function loadOccurrences(selectionId: string, offset = 0): Promise<void> {
  const owner = props.projectId;
  const token = generation;
  const revision = scanSummary.value?.draftRevision;
  if (
    !selectionId ||
    revision === undefined ||
    draft.value?.revision !== revision
  )
    return;
  loadingOccurrences.value = true;
  try {
    const result = await api.sourceOccurrences(
      selectionId,
      offset,
      OCCURRENCE_PAGE_SIZE,
    );
    if (
      token === generation &&
      owner === props.projectId &&
      draft.value?.revision === revision &&
      occurrenceSelectionId.value === selectionId
    ) {
      occurrencePage.value = result.page;
      occurrenceOffset.value = offset;
    }
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
  } finally {
    if (token === generation && owner === props.projectId)
      loadingOccurrences.value = false;
  }
}

function emptyDiscoverySummary(
  projectId: string,
  draftRevision: number,
  sourcesRequested: number,
): SourceDiscoverySummary {
  return {
    projectId,
    draftRevision,
    sourcesRequested,
    sourcesScanned: 0,
    discovered: 0,
    supported: 0,
    possibleDuplicates: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
    failures: [],
  };
}

function combineDiscoverySummaries(
  projectId: string,
  draftRevision: number,
  sourcesRequested: number,
  summaries: readonly SourceDiscoverySummary[],
): SourceDiscoverySummary {
  const result = emptyDiscoverySummary(
    projectId,
    draftRevision,
    sourcesRequested,
  );
  for (const summary of summaries) {
    result.sourcesScanned += summary.sourcesScanned;
    result.discovered += summary.discovered;
    result.supported += summary.supported;
    result.possibleDuplicates += summary.possibleDuplicates;
    result.skipped += summary.skipped;
    result.failed += summary.failed;
    result.cancelled ||= summary.cancelled;
    result.failures.push(...summary.failures);
  }
  return result;
}

async function scanSources(): Promise<void> {
  if (blocked.value || !draft.value?.selections.length) return;
  const owner = props.projectId;
  const token = generation;
  const snapshot = draft.value;
  const scanRequestId = requestId();
  const controller = new AbortController();
  let stopPolling = false;
  activeBrowserScans.clear();
  const nativeSelections = snapshot.selections.filter(
    ({ accessClass }) => accessClass === "native-path",
  );
  const browserSelections = snapshot.selections.filter(
    ({ accessClass }) =>
      accessClass === "persistent-browser-handle" ||
      accessClass === "ephemeral-browser-file",
  );
  const unavailableSelections = snapshot.selections.filter(
    ({ accessClass }) => accessClass === "staged-content",
  );
  let nativeSummary = emptyDiscoverySummary(
    owner,
    snapshot.revision,
    nativeSelections.length,
  );
  const browserSummaries = new Map<string, SourceDiscoverySummary>();
  const publishCombined = () => {
    if (
      token !== generation ||
      owner !== props.projectId ||
      draft.value?.revision !== snapshot.revision
    )
      return;
    const failedSources = unavailableSelections.map((source) => ({
      ...emptyDiscoverySummary(owner, snapshot.revision, 1),
      failed: 1,
      failures: [
        { selectionId: source.id, code: "import.sourceUnavailable" as const },
      ],
    }));
    scanSummary.value = combineDiscoverySummaries(
      owner,
      snapshot.revision,
      snapshot.selections.length,
      [nativeSummary, ...browserSummaries.values(), ...failedSources],
    );
  };
  scanController = controller;
  scanning.value = true;
  scanSummary.value = undefined;
  sealProgress.value = undefined;
  sealResult.value = undefined;
  travelTrack.value = undefined;
  analysisRecord.value = undefined;
  analysisProgress.value = undefined;
  occurrencePage.value = undefined;
  occurrenceSelectionId.value = "";
  const pollProgress = async () => {
    while (!stopPolling && !controller.signal.aborted) {
      try {
        const result = await api.sourceDiscoveryProgress(
          scanRequestId,
          controller.signal,
        );
        const progress = result.progress;
        if (
          token === generation &&
          owner === props.projectId &&
          draft.value?.revision === snapshot.revision &&
          progress.requestId === scanRequestId &&
          progress.projectId === owner
        ) {
          nativeSummary = progress.summary;
          publishCombined();
        }
        if (progress.status !== "running") break;
      } catch {
        if (controller.signal.aborted) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const polling = nativeSelections.length ? pollProgress() : Promise.resolve();
  try {
    if (nativeSelections.length) {
      const result = await api.scanSourceDraft(
        {
          projectId: owner,
          baseRevision: snapshot.revision,
          requestId: scanRequestId,
          selectionIds: nativeSelections.map(({ id }) => id),
        },
        controller.signal,
      );
      nativeSummary = result.summary;
      publishCombined();
    }
    for (const source of browserSelections) {
      const browserRequestId = `${scanRequestId}:${source.id}`;
      const started = await api.browserSourceScan(
        {
          projectId: owner,
          baseRevision: snapshot.revision,
          requestId: browserRequestId,
          selectionId: source.id,
          phase: "begin",
        },
        controller.signal,
      );
      const scanRevision = started.scanRevision;
      if (!Number.isSafeInteger(scanRevision))
        throw new Error("The browser scan revision is missing.");
      activeBrowserScans.set(browserRequestId, {
        selectionId: source.id,
        scanRevision: scanRevision!,
        baseRevision: snapshot.revision,
      });
      browserSummaries.set(source.id, started.summary);
      publishCombined();
      let page: Array<{
        relativePath: string;
        name: string;
        size: number;
        modifiedAt: string;
      }> = [];
      try {
        for await (const entry of iterateBrowserSelectionFiles(
          owner,
          source,
          controller.signal,
        )) {
          controller.signal.throwIfAborted();
          page.push({
            relativePath: entry.relativePath,
            name: entry.file.name,
            size: entry.file.size,
            modifiedAt: entry.modifiedAt,
          });
          if (page.length === 128) {
            const result = await api.browserSourceScan(
              {
                projectId: owner,
                baseRevision: snapshot.revision,
                requestId: browserRequestId,
                selectionId: source.id,
                phase: "page",
                scanRevision: scanRevision!,
                candidates: page,
              },
              controller.signal,
            );
            browserSummaries.set(source.id, result.summary);
            publishCombined();
            page = [];
          }
        }
        if (page.length) {
          const result = await api.browserSourceScan(
            {
              projectId: owner,
              baseRevision: snapshot.revision,
              requestId: browserRequestId,
              selectionId: source.id,
              phase: "page",
              scanRevision: scanRevision!,
              candidates: page,
            },
            controller.signal,
          );
          browserSummaries.set(source.id, result.summary);
          publishCombined();
        }
        const finished = await api.browserSourceScan(
          {
            projectId: owner,
            baseRevision: snapshot.revision,
            requestId: browserRequestId,
            selectionId: source.id,
            phase: "finish",
            scanRevision: scanRevision!,
          },
          controller.signal,
        );
        browserSummaries.set(source.id, finished.summary);
        activeBrowserScans.delete(browserRequestId);
        publishCombined();
      } catch (error) {
        if (controller.signal.aborted) {
          await api
            .browserSourceScan({
              projectId: owner,
              baseRevision: snapshot.revision,
              requestId: browserRequestId,
              selectionId: source.id,
              phase: "cancel",
              scanRevision: scanRevision!,
            })
            .catch(() => undefined);
          activeBrowserScans.delete(browserRequestId);
          throw error;
        }
        await api
          .browserSourceScan({
            projectId: owner,
            baseRevision: snapshot.revision,
            requestId: browserRequestId,
            selectionId: source.id,
            phase: "cancel",
            scanRevision: scanRevision!,
          })
          .catch(() => undefined);
        activeBrowserScans.delete(browserRequestId);
        browserSummaries.set(source.id, {
          ...emptyDiscoverySummary(owner, snapshot.revision, 1),
          failed: 1,
          failures: [
            { selectionId: source.id, code: "import.sourceUnavailable" },
          ],
        });
        publishCombined();
      }
    }
    if (
      token !== generation ||
      owner !== props.projectId ||
      draft.value?.revision !== snapshot.revision
    )
      return;
    stopPolling = true;
    await polling;
    publishCombined();
    if (browserSelections.length) {
      const availability = await sourceAvailabilities(owner, browserSelections);
      if (
        token === generation &&
        owner === props.projectId &&
        draft.value?.revision === snapshot.revision
      )
        access.value = { ...access.value, ...availability };
    }
    await refreshAvailability(snapshot, owner, token);
    const first = visibleSources.value[0];
    if (first) {
      occurrenceSelectionId.value = first.id;
      await loadOccurrences(first.id);
    }
  } catch (error) {
    stopPolling = true;
    await polling;
    const currentSummary = scanSummary.value as
      SourceDiscoverySummary | undefined;
    if (controller.signal.aborted && currentSummary)
      scanSummary.value = { ...currentSummary, cancelled: true };
    if (
      !controller.signal.aborted &&
      token === generation &&
      owner === props.projectId
    )
      emit("error", error);
  } finally {
    stopPolling = true;
    for (const [browserRequestId, scan] of activeBrowserScans) {
      await api
        .browserSourceScan({
          projectId: owner,
          baseRevision: scan.baseRevision,
          requestId: browserRequestId,
          selectionId: scan.selectionId,
          phase: "cancel",
          scanRevision: scan.scanRevision,
        })
        .catch(() => undefined);
    }
    activeBrowserScans.clear();
    if (scanController === controller) scanController = undefined;
    if (token === generation && owner === props.projectId)
      scanning.value = false;
  }
}

async function setOccurrenceIncluded(
  item: CatalogOccurrencePage["items"][number],
  event: Event,
): Promise<void> {
  if (blocked.value || !draft.value || !occurrenceSelectionId.value) return;
  const included = (event.target as HTMLInputElement).checked;
  const owner = props.projectId;
  const token = generation;
  const revision = draft.value.revision;
  sealResult.value = undefined;
  travelTrack.value = undefined;
  analysisRecord.value = undefined;
  analysisProgress.value = undefined;
  sealProgress.value = undefined;
  mutating.value = true;
  try {
    await api.setSourceOccurrenceIncluded(item.occurrence.id, {
      projectId: owner,
      baseRevision: revision,
      requestId: requestId(),
      selectionId: occurrenceSelectionId.value,
      included,
    });
    if (
      token === generation &&
      owner === props.projectId &&
      draft.value?.revision === revision
    )
      await loadOccurrences(
        occurrenceSelectionId.value,
        occurrenceOffset.value,
      );
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
    if (token === generation && owner === props.projectId)
      await loadOccurrences(
        occurrenceSelectionId.value,
        occurrenceOffset.value,
      );
  } finally {
    if (token === generation && owner === props.projectId)
      mutating.value = false;
  }
}

async function sealSources(): Promise<void> {
  if (blocked.value || !canSeal.value || !draft.value || !scanSummary.value)
    return;
  const owner = props.projectId;
  const token = generation;
  const snapshot = draft.value;
  const sealRequestId = requestId();
  const controller = new AbortController();
  let stopPolling = true;
  sealController = controller;
  sealing.value = true;
  sealProgress.value = undefined;
  sealResult.value = undefined;
  travelTrack.value = undefined;
  const pollProgress = async () => {
    while (!stopPolling && !controller.signal.aborted) {
      try {
        const { state } = await api.sourceBatchProgress(
          sealRequestId,
          controller.signal,
        );
        if (
          token === generation &&
          owner === props.projectId &&
          draft.value?.revision === snapshot.revision &&
          state.requestId === sealRequestId &&
          state.projectId === owner
        )
          sealProgress.value = state.progress;
        if (state.status !== "running") break;
      } catch {
        if (controller.signal.aborted) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  let polling: Promise<void> = Promise.resolve();
  try {
    const browserSelections = snapshot.selections.filter(
      (source) =>
        source.accessClass === "persistent-browser-handle" ||
        source.accessClass === "ephemeral-browser-file",
    );
    const planned = new Map<
      string,
      Map<string, CatalogOccurrencePage["items"][number]>
    >();
    let browserTotal = 0;
    for (const source of browserSelections) {
      const included = new Map<
        string,
        CatalogOccurrencePage["items"][number]
      >();
      for (let offset = 0; ; offset += 500) {
        const result = await api.sourceOccurrences(source.id, offset, 500);
        for (const item of result.page.items) {
          if (!item.included) continue;
          if (included.has(item.occurrence.relativePath))
            throw new Error(
              "The browser source contains duplicate relative paths; scan it again before sealing.",
            );
          included.set(item.occurrence.relativePath, item);
        }
        if (!result.page.hasMore) break;
      }
      const stagedIds = new Set<string>();
      for (let offset = 0; ; offset += 500) {
        const result = await api.browserStagedOccurrences(
          source.id,
          offset,
          500,
        );
        for (const id of result.page.occurrenceIds) stagedIds.add(id);
        if (!result.page.hasMore) break;
      }
      for (const [relativePath, item] of included)
        if (stagedIds.has(item.occurrence.id)) included.delete(relativePath);
      planned.set(source.id, included);
      browserTotal += included.size;
    }
    let browserCompleted = 0;
    if (browserTotal) {
      sealProgress.value = {
        batchId: "browser-staging",
        stage: "staging",
        completed: 0,
        total: browserTotal,
        failed: 0,
        cancelled: false,
      };
      for (const source of browserSelections) {
        const pending = planned.get(source.id)!;
        for await (const entry of iterateBrowserSelectionFiles(
          owner,
          source,
          controller.signal,
        )) {
          controller.signal.throwIfAborted();
          const item = pending.get(entry.relativePath);
          if (!item) continue;
          if (
            item.occurrence.byteLength !== undefined &&
            item.occurrence.byteLength !== entry.file.size
          )
            throw new Error(
              "A selected browser file changed size after scanning. Scan the source again.",
            );
          await api.stageBrowserSource(
            {
              selectionId: source.id,
              occurrenceId: item.occurrence.id,
              baseRevision: snapshot.revision,
              file: entry.file,
            },
            controller.signal,
          );
          pending.delete(entry.relativePath);
          browserCompleted++;
          sealProgress.value = {
            batchId: "browser-staging",
            stage: "staging",
            completed: browserCompleted,
            total: browserTotal,
            failed: 0,
            cancelled: false,
          };
        }
        if (pending.size)
          throw new Error(
            "Some included browser files need to be selected again before sealing.",
          );
      }
    }
    stopPolling = false;
    polling = pollProgress();
    const { result } = await api.createSourceBatch(
      {
        projectId: owner,
        baseRevision: snapshot.revision,
        requestId: sealRequestId,
        selectionIds: snapshot.selections.map(({ id }) => id),
        partialPolicy: "require-all",
      },
      controller.signal,
    );
    stopPolling = true;
    await polling;
    if (
      token === generation &&
      owner === props.projectId &&
      draft.value?.revision === snapshot.revision &&
      result.batch.projectId === owner
    ) {
      sealResult.value = result;
      analysisRecord.value = undefined;
      sealProgress.value = {
        batchId: result.batch.id,
        stage: "completed",
        completed: result.expected,
        total: result.expected,
        failed: result.failed,
        cancelled: result.status === "cancelled",
      };
    }
  } catch (error) {
    stopPolling = true;
    await polling;
    if (
      !controller.signal.aborted &&
      token === generation &&
      owner === props.projectId
    )
      emit("error", error);
  } finally {
    stopPolling = true;
    if (sealController === controller) sealController = undefined;
    if (token === generation && owner === props.projectId)
      sealing.value = false;
  }
}

async function analyzeVerifiedSources(retry = false): Promise<void> {
  if (
    !canAnalyze.value ||
    !draft.value ||
    !sealResult.value?.verifiedManifest.members.length
  )
    return;
  const owner = props.projectId;
  const token = generation;
  const snapshot = draft.value;
  const manifest = sealResult.value.verifiedManifest;
  const controller = new AbortController();
  const analysisRequestId = requestId();
  analysisController = controller;
  analyzing.value = true;
  analysisProgress.value = undefined;
  analysisRunId.value = analysisRecord.value?.run.id ?? "";
  let stopPolling = false;
  const pollProgress = async () => {
    while (!stopPolling && !controller.signal.aborted) {
      try {
        const { state } = await api.sourceAnalysisProgress(
          analysisRequestId,
          controller.signal,
        );
        if (
          token === generation &&
          owner === props.projectId &&
          draft.value?.revision === snapshot.revision &&
          state.projectId === owner
        ) {
          analysisProgress.value = state;
          if (state.progress.runId) analysisRunId.value = state.progress.runId;
        }
        if (state.status !== "running") break;
      } catch {
        if (controller.signal.aborted) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const polling = pollProgress();
  try {
    const travelContext = retry ? undefined : currentTravelContext();
    const visualSampling = retry ? undefined : currentVisualSampling();
    const response =
      retry && analysisRecord.value
        ? await api.retrySourceAnalysis(
            analysisRecord.value.run.id,
            { projectId: owner, requestId: analysisRequestId },
            controller.signal,
          )
        : await api.createSourceAnalysis(
            {
              projectId: owner,
              verifiedManifestId: manifest.id,
              scopeMode: wholeProjectConfirmed.value
                ? "project-catalog"
                : "selected-sources",
              ...(wholeProjectConfirmed.value
                ? { confirmProjectCatalog: true }
                : {}),
              requestId: analysisRequestId,
              ...(travelContext ? { travelContext } : {}),
              ...(visualSampling ? { visualSampling } : {}),
            },
            controller.signal,
          );
    stopPolling = true;
    await polling;
    if (
      token === generation &&
      owner === props.projectId &&
      draft.value?.revision === snapshot.revision &&
      response.result.run.manifestId === manifest.id
    ) {
      analysisRecord.value = response.result;
      analysisRunId.value = response.result.run.id;
      reviewOffset.value = 0;
      selectedReviewIds.value = [];
      reviewPreview.value = undefined;
      void loadReviewPage();
      void loadReviewStories(owner, token);
      analysisProgress.value = {
        requestId: analysisRequestId,
        projectId: owner,
        status:
          response.result.run.status === "completed"
            ? "completed"
            : response.result.run.status === "cancelled"
              ? "cancelled"
              : "failed",
        progress: {
          runId: response.result.run.id,
          stage:
            response.result.run.status === "completed"
              ? "completed"
              : response.result.run.status === "cancelled"
                ? "cancelled"
                : "failed",
          completed: response.result.results.length,
          total: response.result.results.length,
        },
        result: response.result,
      };
    }
  } catch (error) {
    stopPolling = true;
    await polling;
    if (
      !controller.signal.aborted &&
      token === generation &&
      owner === props.projectId
    )
      emit("error", error);
  } finally {
    stopPolling = true;
    if (analysisController === controller) analysisController = undefined;
    if (token === generation && owner === props.projectId)
      analyzing.value = false;
  }
}

async function cancelAnalysis(): Promise<void> {
  if (analysisRunId.value) {
    try {
      await api.cancelSourceAnalysis(analysisRunId.value, props.projectId);
    } catch {
      analysisController?.abort();
    }
  } else analysisController?.abort();
}

function cancelSeal(): void {
  sealController?.abort();
}

function cancelScan(): void {
  scanController?.abort();
}

function changeOccurrenceSource(event: Event): void {
  const selectionId = (event.target as HTMLSelectElement).value;
  occurrenceSelectionId.value = selectionId;
  occurrencePage.value = undefined;
  void loadOccurrences(selectionId);
}

async function loadDraft(): Promise<SourceDraft | undefined> {
  const owner = props.projectId;
  const token = generation;
  const readSequence = ++draftReadSequence;
  loading.value = true;
  try {
    const result = await api.sourceDraft();
    if (result.draft.projectId !== owner) return undefined;
    if (token === generation && readSequence === draftReadSequence) {
      acceptDraft(result.draft, owner, token);
      const readiness = await api.sourceDiscoveryReadiness();
      if (
        token === generation &&
        readSequence === draftReadSequence &&
        owner === props.projectId &&
        draft.value?.revision === result.draft.revision &&
        readiness.summary?.projectId === owner &&
        readiness.summary.draftRevision === result.draft.revision
      ) {
        scanSummary.value = readiness.summary;
        const first = visibleSources.value[0];
        if (first) {
          occurrenceSelectionId.value = first.id;
          await loadOccurrences(first.id);
        }
      }
    }
    return result.draft;
  } catch (error) {
    if (
      token === generation &&
      readSequence === draftReadSequence &&
      owner === props.projectId
    )
      emit("error", error);
    return undefined;
  } finally {
    if (token === generation && readSequence === draftReadSequence)
      loading.value = false;
  }
}

function applicationErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return undefined;
}

function mutationFailureIsAmbiguous(error: unknown): boolean {
  const code = applicationErrorCode(error);
  if (code === "workspace.unavailable" || code === "workspace.invalidResponse")
    return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  )
    return error.status === 0;
  return code === undefined;
}

async function handleMutationError(
  error: unknown,
  owner: string,
  token: number,
): Promise<SourceDraft | undefined> {
  if (token !== generation || owner !== props.projectId) return undefined;
  emit("error", error);
  if (applicationErrorCode(error) !== "import.draftStale") return undefined;
  mutating.value = false;
  return loadDraft();
}

type MutationAttempt<T> =
  { ok: true; value: T } | { ok: false; error: unknown; ambiguous: boolean };

async function reconcileMutationFailure(
  attempted: Extract<MutationAttempt<unknown>, { ok: false }>,
  owner: string,
  token: number,
): Promise<SourceDraft | undefined> {
  const staleDraft = await handleMutationError(attempted.error, owner, token);
  if (
    staleDraft ||
    !attempted.ambiguous ||
    token !== generation ||
    owner !== props.projectId
  )
    return staleDraft;
  mutating.value = false;
  return loadDraft();
}

async function attemptMutation<T>(
  action: () => Promise<T>,
): Promise<MutationAttempt<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    if (!mutationFailureIsAmbiguous(error))
      return { ok: false, error, ambiguous: false };
    try {
      return { ok: true, value: await action() };
    } catch (retryError) {
      return { ok: false, error: retryError, ambiguous: true };
    }
  }
}

interface AddSourcesOutcome {
  saved: boolean;
  cleanupSafe: boolean;
  authoritative?: SourceDraft;
}

async function addSources(
  sources: SourceSelectionInput[],
): Promise<AddSourcesOutcome> {
  if (!sources.length)
    return { saved: true, cleanupSafe: true, authoritative: draft.value };
  if (blocked.value || !draft.value) return { saved: false, cleanupSafe: true };
  const owner = props.projectId;
  const token = generation;
  const mutationRequestId = requestId();
  const baseRevision = draft.value.revision;
  mutating.value = true;
  try {
    const attempted = await attemptMutation(() =>
      api.addSourceSelections({
        projectId: owner,
        baseRevision,
        requestId: mutationRequestId,
        sources,
      }),
    );
    if (!attempted.ok) {
      const authoritative = await reconcileMutationFailure(
        attempted,
        owner,
        token,
      );
      return {
        saved: false,
        cleanupSafe:
          authoritative !== undefined ||
          (!attempted.ambiguous &&
            applicationErrorCode(attempted.error) !== undefined),
        authoritative,
      };
    }
    const result = attempted.value;
    acceptDraft(result.draft, owner, token);
    if (token === generation && owner === props.projectId)
      sourcePage.value = Math.max(0, sourcePageCount.value - 1);
    return {
      saved: true,
      cleanupSafe: true,
      authoritative: result.draft,
    };
  } finally {
    if (token === generation) mutating.value = false;
  }
}

function retainedAccessRefs(
  owner: string,
  authoritative?: SourceDraft,
): Set<string> {
  const snapshot = authoritative ?? draft.value;
  if (snapshot?.projectId !== owner) return new Set();
  return new Set(snapshot.selections.map((source) => source.accessRef));
}

async function releaseSources(
  owner: string,
  sources: readonly Pick<SourceSelectionInput, "accessClass" | "accessRef">[],
  token: number,
  authoritative?: SourceDraft,
): Promise<void> {
  try {
    await releaseBrowserSources(
      owner,
      sources,
      retainedAccessRefs(owner, authoritative),
    );
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
  }
}

async function applyPicked(
  action: () => Promise<PickedSources> | PickedSources,
): Promise<boolean> {
  if (blocked.value) return false;
  const owner = props.projectId;
  const token = generation;
  try {
    const result = await action();
    if (token !== generation || owner !== props.projectId) {
      await releaseSources(owner, result.sources, token);
      return false;
    }
    rejected.value = result.rejected;
    const outcome = await addSources(result.sources);
    if (outcome.cleanupSafe)
      await releaseSources(owner, result.sources, token, outcome.authoritative);
    return outcome.saved;
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
    return false;
  }
}

async function chooseFolder() {
  if (props.native) return applyPicked(pickNativeFolders);
  const owner = props.projectId;
  const token = generation;
  try {
    const picked = await pickBrowserFolder(owner);
    if (token !== generation || owner !== props.projectId) {
      if (picked) await releaseSources(owner, picked.sources, token);
      return;
    }
    if (picked === undefined) folderInput.value?.click();
    else await applyPicked(() => picked);
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
  }
}

async function chooseFiles() {
  if (props.native) return applyPicked(pickNativeFiles);
  fileInput.value?.click();
}

async function addServerFolder(): Promise<void> {
  const accessRef = serverPath.value.trim();
  if (!accessRef) return;
  const owner = props.projectId;
  const token = generation;
  const displayName =
    accessRef.split(/[\\/]/u).filter(Boolean).at(-1) ?? accessRef;
  const saved = await applyPicked(() => ({
    sources: [
      {
        kind: "folder",
        displayName,
        accessClass: "native-path",
        accessRef,
        recursive: true,
      },
    ],
    rejected: [],
  }));
  if (saved && token === generation && owner === props.projectId) {
    serverPath.value = "";
    serverPathOpen.value = false;
  }
}

async function chosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await applyPicked(() => pickBrowserFiles(props.projectId, files));
}

async function folderChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await applyPicked(() => pickBrowserFallbackFolders(props.projectId, files));
}

function startCompatible(): void {
  if (blocked.value || !compatibleStart.value || !draft.value) return;
  const selections = draft.value.selections;
  const folder = selections.length === 1 ? selections[0] : undefined;
  if (folder?.kind === "folder" && folder.accessClass === "native-path") {
    emit("folder", folder.accessRef);
    return;
  }
  if (selections.every((source) => source.accessClass === "native-path")) {
    emit(
      "files",
      selections.map((source) => source.accessRef),
    );
    return;
  }
  const files = browserFilesForSelections(props.projectId, selections);
  if (files?.length) emit("upload", files);
}

async function dropped(event: DragEvent) {
  dragging.value = false;
  if (blocked.value || props.native || !event.dataTransfer) return;
  const transfer = event.dataTransfer;
  await applyPicked(() => sourcesFromBrowserDrop(props.projectId, transfer));
}

async function removeSource(source: SourceSelection) {
  if (blocked.value || !draft.value) return;
  const owner = props.projectId;
  const token = generation;
  const mutationRequestId = requestId();
  const baseRevision = draft.value.revision;
  mutating.value = true;
  try {
    const attempted = await attemptMutation(() =>
      api.removeSourceSelection(source.id, {
        projectId: owner,
        baseRevision,
        requestId: mutationRequestId,
      }),
    );
    if (!attempted.ok) {
      const authoritative = await reconcileMutationFailure(
        attempted,
        owner,
        token,
      );
      if (authoritative)
        await releaseSources(owner, [source], token, authoritative);
      return;
    }
    const result = attempted.value;
    acceptDraft(result.draft, owner, token);
    await releaseSources(owner, [source], token, result.draft);
  } finally {
    if (token === generation) mutating.value = false;
  }
}

async function setRecursive(source: SourceSelection, input: HTMLInputElement) {
  if (blocked.value || !draft.value) return;
  const recursive = input.checked;
  const owner = props.projectId;
  const token = generation;
  const mutationRequestId = requestId();
  const baseRevision = draft.value.revision;
  mutating.value = true;
  try {
    const attempted = await attemptMutation(() =>
      api.updateSourceSelection(source.id, {
        projectId: owner,
        baseRevision,
        requestId: mutationRequestId,
        recursive,
      }),
    );
    if (!attempted.ok) {
      const authoritative = await reconcileMutationFailure(
        attempted,
        owner,
        token,
      );
      if (token === generation && owner === props.projectId) {
        const saved = (authoritative ?? draft.value)?.selections.find(
          (candidate) => candidate.id === source.id,
        );
        input.checked = saved?.recursive ?? source.recursive;
      }
      return;
    }
    const result = attempted.value;
    acceptDraft(result.draft, owner, token);
  } finally {
    if (token === generation) mutating.value = false;
  }
}

watch(
  () => props.projectId,
  (projectId, previous) => {
    scanController?.abort();
    sealController?.abort();
    analysisController?.abort();
    generation++;
    draftReadSequence++;
    availabilityReadSequence++;
    reviewSearchSequence++;
    if (reviewSearchTimer) clearTimeout(reviewSearchTimer);
    draft.value = undefined;
    access.value = {};
    rejected.value = [];
    mutating.value = false;
    dragging.value = false;
    sourcePage.value = 0;
    serverPath.value = "";
    serverPathOpen.value = false;
    scanSummary.value = undefined;
    scanning.value = false;
    sealing.value = false;
    sealProgress.value = undefined;
    sealResult.value = undefined;
    travelTrack.value = undefined;
    analysisRecord.value = undefined;
    analysisProgress.value = undefined;
    analyzing.value = false;
    wholeProjectConfirmed.value = false;
    travelEnabled.value = false;
    visualSamplingEnabled.value = false;
    visualProviderId.value = "";
    visualConsentAcknowledged.value = false;
    travelTrack.value = undefined;
    travelParsing.value = false;
    travelClockOffsetMinutes.value = 0;
    travelTimeZone.value = "";
    visualSamplingEnabled.value = false;
    visualProviderId.value = "";
    visualConsentAcknowledged.value = false;
    visionSampleProviders.value = [];
    analysisRunId.value = "";
    reviewQuery.value = "";
    reviewResults.value = [];
    reviewTotal.value = 0;
    reviewOffset.value = 0;
    selectedReviewIds.value = [];
    reviewPreview.value = undefined;
    reviewDecisions.value = [];
    reviewStories.value = [];
    reviewStoryId.value = "";
    reviewSupersedesDecisionId.value = "";
    pendingReviewAcceptance.value = undefined;
    reviewStorageFailed.value = false;
    readStoredReviewAcceptance();
    reviewing.value = false;
    reviewSearching.value = false;
    visionProvidersLoading.value = false;
    visionConsentBusy.value = false;
    loadingOccurrences.value = false;
    occurrencePage.value = undefined;
    occurrenceSelectionId.value = "";
    occurrenceOffset.value = 0;
    if (previous && previous !== projectId) clearBrowserEphemeral(previous);
    void refreshVisionSampleProviders(projectId, generation);
    void loadDraft();
  },
  { immediate: true },
);

watch(sourcePage, () => {
  if (!draft.value) return;
  const owner = props.projectId;
  const token = generation;
  void refreshAvailability(draft.value, owner, token).catch((error) => {
    if (token === generation && owner === props.projectId) emit("error", error);
  });
  if (
    scanSummary.value &&
    !visibleSources.value.some(
      (source) => source.id === occurrenceSelectionId.value,
    )
  ) {
    const next = visibleSources.value[0];
    occurrenceSelectionId.value = next?.id ?? "";
    occurrencePage.value = undefined;
    if (next) void loadOccurrences(next.id);
  }
});

watch(
  reviewQuery,
  () => {
    if (reviewSearchTimer) clearTimeout(reviewSearchTimer);
    reviewSearchSequence++;
    selectedReviewIds.value = [];
    reviewResults.value = [];
    reviewTotal.value = 0;
    reviewOffset.value = 0;
    reviewSearching.value = Boolean(analysisRecord.value);
    reviewSearchTimer = setTimeout(() => {
      void loadReviewPage();
    }, 180);
  },
  { flush: "sync" },
);

onMounted(async () => {
  if (!props.native) return;
  const token = generation;
  const owner = props.projectId;
  try {
    const dispose = await listenForNativeDrop((event) => {
      if (token !== generation || owner !== props.projectId) return;
      dragging.value = event.type === "enter" || event.type === "over";
      if (event.type === "drop" && !blocked.value)
        void applyPicked(() => classifyNativeDrop(event.paths));
    });
    if (token !== generation || owner !== props.projectId) dispose();
    else removeNativeDrop = dispose;
  } catch {
    /* Picker buttons remain usable if native drop events are unavailable. */
  }
});
onBeforeUnmount(() => {
  scanController?.abort();
  sealController?.abort();
  analysisController?.abort();
  generation++;
  if (reviewSearchTimer) clearTimeout(reviewSearchTimer);
  removeNativeDrop?.();
});
</script>

<template>
  <section
    class="import-panel inline-form"
    :class="{ 'is-expert': expert }"
    :aria-label="t('app.import.label')"
  >
    <header class="import-heading">
      <div>
        <span class="eyebrow">{{ t("app.import.eyebrow") }}</span>
        <h2>{{ t("app.import.title") }}</h2>
        <p>{{ t("app.import.description") }}</p>
      </div>
      <button
        class="icon-button"
        :disabled="!!progress"
        :aria-label="t('app.import.close')"
        @click="emit('close')"
      >
        <Icon name="reject" />
      </button>
    </header>

    <div
      v-if="pendingReviewAcceptance"
      class="callout warning"
      role="status"
      aria-live="polite"
    >
      <strong>{{ t("app.import.analysis.review.recoveryPending") }}</strong>
      <p>
        {{
          t(
            `app.import.analysis.review.operationKind.${pendingReviewAcceptance.payload.operation.kind}`,
          )
        }}
      </p>
      <p
        v-if="
          pendingReviewAcceptance.payload.operation.kind === 'set-observation'
        "
      >
        {{ pendingReviewAcceptance.payload.operation.value }}
      </p>
      <button
        class="primary"
        :disabled="busy || reviewing"
        @click="sendPendingReviewAcceptance"
      >
        {{ t("app.import.analysis.review.retryAccept") }}
      </button>
    </div>
    <div v-if="reviewStorageFailed" class="callout warning" role="alert">
      <p>{{ t("app.import.analysis.review.storageFailed") }}</p>
      <button
        class="secondary"
        :disabled="reviewing"
        @click="readStoredReviewAcceptance"
      >
        {{ t("app.import.analysis.review.retryRecovery") }}
      </button>
    </div>

    <div
      class="import-dropzone"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="dropped"
    >
      <div class="import-dropzone-copy">
        <span class="import-dropzone-icon"
          ><Icon name="folder" :size="28"
        /></span>
        <div>
          <strong>{{ t("app.import.dropTitle") }}</strong>
          <p>{{ t("app.import.drop") }}</p>
        </div>
      </div>
      <div class="import-picker-actions">
        <div class="import-actions">
          <button class="primary" :disabled="blocked" @click="chooseFolder">
            <Icon name="folder" />{{ t("app.import.addFolder") }}</button
          ><button class="secondary" :disabled="blocked" @click="chooseFiles">
            <Icon name="plus" />{{ t("app.import.addFiles") }}
          </button>
        </div>
        <button
          v-if="!native && expert"
          class="text-button import-server-path-toggle"
          :disabled="blocked"
          @click="serverPathOpen = !serverPathOpen"
        >
          {{ t("app.import.addPath") }}
        </button>
        <details v-else-if="!native" class="import-more-options">
          <summary>{{ t("app.import.moreOptions") }}</summary>
          <button
            class="text-button import-server-path-toggle"
            :disabled="blocked"
            @click="serverPathOpen = !serverPathOpen"
          >
            {{ t("app.import.addPath") }}
          </button>
        </details>
      </div>
      <input
        ref="fileInput"
        type="file"
        multiple
        hidden
        :aria-label="t('app.import.addFiles')"
        @change="chosen"
      />
      <input
        ref="folderInput"
        type="file"
        multiple
        webkitdirectory
        hidden
        :aria-label="t('app.import.addFolder')"
        @change="folderChosen"
      />
    </div>

    <form
      v-if="serverPathOpen"
      class="import-folder-form"
      @submit.prevent="addServerFolder"
    >
      <label class="field">
        {{ t("app.import.folder") }}
        <input
          :value="serverPath"
          name="media-folder"
          required
          autocomplete="off"
          @input="serverPath = ($event.target as HTMLInputElement).value"
        />
      </label>
      <button class="secondary" :disabled="blocked || !serverPath.trim()">
        {{ t("app.import.addPathSubmit") }}<Icon name="arrow" />
      </button>
    </form>

    <div class="import-summary" role="status" aria-live="polite">
      <span>{{ t("app.import.folderCount", { count: folderCount }) }}</span>
      <span>{{ t("app.import.fileCount", { count: fileCount }) }}</span>
      <span v-if="draft && expert">{{
        t("app.import.savedRevision", { revision: draft.revision })
      }}</span>
    </div>

    <p v-if="loading" class="muted" role="status">
      {{ t("app.import.loadingDraft") }}
    </p>
    <p v-else-if="!draft?.selections.length" class="import-empty">
      {{ t("app.import.emptyDraft") }}
    </p>
    <div v-else class="import-source-section">
      <div class="import-source-heading">
        <strong>{{ t("app.import.sources") }}</strong>
        <span>
          {{
            t("app.import.sourceRange", {
              start: sourceRangeStart,
              end: sourceRangeEnd,
              total: draft.selections.length,
            })
          }}
        </span>
      </div>
      <ul class="import-source-list" :aria-label="t('app.import.sources')">
        <li
          v-for="source in visibleSources"
          :key="source.id"
          class="import-source-card"
          :data-source-id="source.id"
        >
          <span class="import-source-kind" aria-hidden="true">
            <Icon :name="source.kind === 'folder' ? 'folder' : 'media'" />
          </span>
          <div class="import-source-copy">
            <strong :title="source.displayName">{{
              source.displayName
            }}</strong>
            <span>{{ t(`app.import.kind.${source.kind}`) }}</span>
            <span
              v-if="access[source.id] && access[source.id] !== 'available'"
              class="import-access-warning"
              role="status"
            >
              {{ t(`app.import.access.${access[source.id]}`) }}
            </span>
            <code v-if="expert">{{ source.accessRef }}</code>
            <small v-if="expert"
              >{{ source.accessClass }} · r{{ source.selectionRevision }}</small
            >
          </div>
          <label v-if="source.kind === 'folder'" class="import-recursive">
            <input
              type="checkbox"
              :checked="source.recursive"
              :disabled="blocked"
              @change="setRecursive(source, $event.target as HTMLInputElement)"
            />
            {{ t("app.import.includeSubfolders") }}
          </label>
          <button
            class="icon-button"
            :disabled="blocked"
            :aria-label="
              t('app.import.removeSource', { name: source.displayName })
            "
            @click="removeSource(source)"
          >
            <Icon name="reject" />
          </button>
        </li>
      </ul>
      <nav
        v-if="sourcePageCount > 1"
        class="import-source-pagination"
        :aria-label="t('app.import.sourcePagination')"
      >
        <button
          class="secondary"
          :disabled="blocked || sourcePage === 0"
          @click="sourcePage--"
        >
          {{ t("app.import.previousSources") }}
        </button>
        <span aria-live="polite">
          {{
            t("app.import.sourcePage", {
              page: sourcePage + 1,
              pages: sourcePageCount,
            })
          }}
        </span>
        <button
          class="secondary"
          :disabled="blocked || sourcePage + 1 >= sourcePageCount"
          @click="sourcePage++"
        >
          {{ t("app.import.nextSources") }}
        </button>
      </nav>
    </div>

    <section
      v-if="rejected.length"
      class="callout warning import-rejected"
      role="alert"
    >
      <strong>{{
        t("app.import.rejected", { count: rejected.length })
      }}</strong>
      <ul>
        <li v-for="item in visibleRejected" :key="`${item.kind}:${item.label}`">
          <span>{{ item.label }}</span>
          <span>{{ t(`app.import.rejectedReason.${item.kind}`) }}</span>
        </li>
      </ul>
      <p v-if="hiddenRejectedCount">
        {{ t("app.import.rejectedMore", { count: hiddenRejectedCount }) }}
      </p>
    </section>
    <div v-if="progress" class="import-progress" role="status">
      <p>
        {{
          t("app.import.uploading", {
            completed: progress.completed,
            total: progress.total,
          })
        }}
      </p>
      <progress
        :value="progress.bytesUploaded"
        :max="progress.totalBytes || 1"
        :aria-label="t('app.import.uploadProgress')"
      />
      <button class="text-button" @click="emit('cancel')">
        {{ t("app.import.cancelUpload") }}
      </button>
    </div>
    <section
      v-if="scanSummary"
      class="import-scan-results"
      role="region"
      :aria-label="t('app.import.scan.summary')"
    >
      <div class="import-scan-counts" role="status" aria-live="polite">
        <strong>{{ t("app.import.scan.summary") }}</strong>
        <span>{{
          t("app.import.scan.discovered", { count: scanSummary.discovered })
        }}</span>
        <span>{{
          t("app.import.scan.supported", { count: scanSummary.supported })
        }}</span>
        <span>{{
          t("app.import.scan.possibleDuplicates", {
            count: scanSummary.possibleDuplicates,
          })
        }}</span>
        <span>{{
          t("app.import.scan.skipped", { count: scanSummary.skipped })
        }}</span>
        <span>{{
          t("app.import.scan.failed", { count: scanSummary.failed })
        }}</span>
      </div>
      <label v-if="visibleSources.length" class="field import-scan-source">
        {{ t("app.import.scan.reviewSource") }}
        <select :value="occurrenceSelectionId" @change="changeOccurrenceSource">
          <option
            v-for="source in visibleSources"
            :key="source.id"
            :value="source.id"
          >
            {{ source.displayName }}
          </option>
        </select>
      </label>
      <p v-if="loadingOccurrences" class="muted" role="status">
        {{ t("app.import.scan.loading") }}
      </p>
      <p v-else-if="occurrencePage?.items.length === 0" class="muted">
        {{ t("app.import.scan.empty") }}
      </p>
      <ul
        v-else-if="occurrencePage"
        class="import-scan-list"
        :aria-label="t('app.import.scan.reviewSource')"
      >
        <li v-for="item in occurrencePage.items" :key="item.occurrence.id">
          <label class="import-occurrence-check">
            <input
              type="checkbox"
              :checked="item.included"
              :disabled="blocked || sealing"
              @change="setOccurrenceIncluded(item, $event)"
            />
            <span>{{ item.occurrence.relativePath }}</span>
          </label>
          <small
            >{{ t(`app.import.mediaKind.${item.occurrence.fileKind}`) }} ·
            {{ item.occurrence.byteLength ?? 0 }} B</small
          >
        </li>
      </ul>
      <nav
        v-if="occurrencePage"
        class="import-source-pagination"
        :aria-label="t('app.import.scan.reviewSource')"
      >
        <button
          class="secondary"
          :disabled="blocked || occurrenceOffset === 0"
          @click="
            loadOccurrences(
              occurrenceSelectionId,
              Math.max(0, occurrenceOffset - OCCURRENCE_PAGE_SIZE),
            )
          "
        >
          {{ t("app.import.scan.previous") }}
        </button>
        <button
          class="secondary"
          :disabled="blocked || !occurrencePage.hasMore"
          @click="
            loadOccurrences(
              occurrenceSelectionId,
              occurrenceOffset + OCCURRENCE_PAGE_SIZE,
            )
          "
        >
          {{ t("app.import.scan.next") }}
        </button>
      </nav>
    </section>
    <div
      v-if="sealing && sealProgress"
      class="import-seal-progress"
      role="status"
      aria-live="polite"
    >
      <p>
        {{
          t(`app.import.seal.stage.${sealProgress.stage}`, {
            completed: sealProgress.completed,
            total: sealProgress.total,
          })
        }}
      </p>
      <progress
        :value="sealProgress.completed"
        :max="sealProgress.total || 1"
        :aria-label="t('app.import.seal.progress')"
      />
      <button class="text-button" @click="cancelSeal">
        {{ t("app.import.seal.cancel") }}
      </button>
    </div>
    <div
      v-if="sealResult"
      class="callout import-seal-result"
      :class="sealResult.status === 'sealed' ? 'success' : 'warning'"
      role="status"
      aria-live="polite"
    >
      <strong>{{ t(`app.import.seal.result.${sealResult.status}`) }}</strong>
      <p>
        {{
          t("app.import.seal.result.counts", {
            verified: sealResult.verified,
            failed: sealResult.failed,
            excluded: sealResult.excluded,
          })
        }}
      </p>
      <small v-if="sealResult.verifiedManifest.failures.length">{{
        sealResult.verifiedManifest.failures
          .map(({ code }) => t(`app.import.seal.failure.${code}`, code))
          .join(" · ")
      }}</small>
    </div>
    <section
      v-if="sealResult?.verifiedManifest.members.length || analysisRecord"
      class="import-analysis"
      :aria-label="t('app.import.analysis.label')"
    >
      <div class="import-visual-context">
        <label class="import-analysis-scope">
          <input
            v-model="visualSamplingEnabled"
            type="checkbox"
            :disabled="blocked"
          />
          <span>{{ t("app.import.analysis.visual.enable") }}</span>
        </label>
        <div v-if="visualSamplingEnabled" class="import-visual-fields">
          <label>
            <span>{{ t("app.import.analysis.visual.provider") }}</span>
            <select
              v-model="visualProviderId"
              :disabled="blocked || visionProvidersLoading"
              @change="visualConsentAcknowledged = false"
            >
              <option value="">
                {{ t("app.import.analysis.visual.localOnly") }}
              </option>
              <option
                v-for="provider in visionSampleProviders"
                :key="provider.id"
                :value="provider.id"
              >
                {{ provider.name }} · {{ provider.execution }}
              </option>
            </select>
          </label>
          <p class="muted">
            {{ t("app.import.analysis.visual.manualReview") }}
          </p>
          <div
            v-if="selectedVisionProvider?.execution === 'remote'"
            class="callout warning"
            role="group"
            :aria-label="t('app.import.analysis.visual.remoteDisclosure')"
          >
            <strong>{{
              t("app.import.analysis.visual.remoteDisclosure")
            }}</strong>
            <p>
              {{
                t("app.import.analysis.visual.remoteDisclosureDetail", {
                  endpoint:
                    selectedVisionProvider.endpoint ??
                    selectedVisionProvider.name,
                })
              }}
            </p>
            <p>{{ t("app.import.analysis.visual.payload") }}</p>
            <label
              v-if="!selectedVisionProvider.enabled"
              class="import-analysis-scope"
            >
              <input
                v-model="visualConsentAcknowledged"
                type="checkbox"
                :disabled="blocked || visionConsentBusy"
              />
              <span>{{ t("app.import.analysis.visual.consent") }}</span>
            </label>
            <button
              v-if="!selectedVisionProvider.enabled"
              class="secondary"
              :disabled="
                blocked || visionConsentBusy || !visualConsentAcknowledged
              "
              @click="grantSelectedVisionConsent"
            >
              {{ t("app.import.analysis.visual.grant") }}
            </button>
            <button
              v-else
              class="text-button"
              :disabled="blocked || visionConsentBusy"
              @click="revokeSelectedVisionConsent"
            >
              {{ t("app.import.analysis.visual.revoke") }}
            </button>
          </div>
          <p v-if="visionProvidersLoading" class="muted" role="status">
            {{ t("app.import.analysis.visual.loading") }}
          </p>
          <p v-else-if="!visionSampleProviders.length" class="muted">
            {{ t("app.import.analysis.visual.noProvider") }}
          </p>
        </div>
      </div>
      <div class="import-travel-context">
        <label class="import-analysis-scope">
          <input v-model="travelEnabled" type="checkbox" :disabled="blocked" />
          <span>{{ t("app.import.analysis.travel.enable") }}</span>
        </label>
        <div v-if="travelEnabled" class="import-travel-fields">
          <label>
            <span>{{ t("app.import.analysis.travel.route") }}</span>
            <input
              ref="travelFileInput"
              type="file"
              accept=".gpx,application/gpx+xml,application/xml,text/xml"
              :disabled="blocked"
              @change="prepareTravelGpx"
            />
          </label>
          <label>
            <span>{{ t("app.import.analysis.travel.offset") }}</span>
            <input
              v-model.number="travelClockOffsetMinutes"
              type="number"
              min="-1440"
              max="1440"
              step="0.1"
              :disabled="blocked"
            />
          </label>
          <label>
            <span>{{ t("app.import.analysis.travel.timeZone") }}</span>
            <input
              v-model.trim="travelTimeZone"
              type="text"
              maxlength="128"
              autocomplete="off"
              placeholder="Asia/Taipei"
              :disabled="blocked"
            />
          </label>
          <p
            v-if="travelParsing"
            class="muted"
            role="status"
            aria-live="polite"
          >
            {{ t("app.import.analysis.travel.preparing") }}
          </p>
          <p v-else-if="travelTrack" class="muted" role="status">
            {{
              t("app.import.analysis.travel.summary", {
                points: travelTrackPointCount,
                assets: travelAssetCount,
              })
            }}
          </p>
          <p class="muted">{{ t("app.import.analysis.travel.manualHint") }}</p>
        </div>
      </div>
      <label class="import-analysis-scope">
        <input
          v-model="wholeProjectConfirmed"
          type="checkbox"
          :disabled="blocked"
        />
        <span>{{ t("app.import.analysis.projectScope") }}</span>
      </label>
      <p class="muted">
        {{
          t(
            wholeProjectConfirmed
              ? "app.import.analysis.projectScopeHint"
              : "app.import.analysis.selectedScopeHint",
          )
        }}
      </p>
      <button
        class="primary"
        :disabled="!canAnalyze"
        @click="analyzeVerifiedSources()"
      >
        {{
          analysisRecord
            ? t("app.import.analysis.runAgain")
            : t("app.import.analysis.run")
        }}
      </button>
      <button v-if="analyzing" class="text-button" @click="cancelAnalysis">
        {{ t("app.import.analysis.cancel") }}
      </button>
      <button
        v-else-if="analysisRecord && analysisRecord.run.status !== 'completed'"
        class="secondary"
        :disabled="blocked"
        @click="analyzeVerifiedSources(true)"
      >
        {{ t("app.import.analysis.retry") }}
      </button>
      <div
        v-if="analysisProgress"
        class="import-analysis-progress"
        role="status"
        aria-live="polite"
      >
        <strong>{{
          t(`app.import.analysis.status.${analysisProgress.status}`)
        }}</strong>
        <progress
          v-if="analyzing"
          :value="analysisProgress.progress.completed"
          :max="analysisProgress.progress.total || 1"
          :aria-label="t('app.import.analysis.progress')"
        />
      </div>
      <section
        v-if="analysisRecord"
        class="import-analysis-review"
        :aria-label="t('app.import.analysis.review.label')"
      >
        <h3>{{ t("app.import.analysis.review.label") }}</h3>
        <label>
          <span>{{ t("app.import.analysis.review.search") }}</span>
          <input
            v-model.trim="reviewQuery"
            type="search"
            maxlength="256"
            :disabled="blocked"
          />
        </label>
        <label>
          <span>{{ t("app.import.analysis.review.operation") }}</span>
          <select
            v-model="reviewOperationKind"
            :disabled="blocked"
            @change="reviewPreview = undefined"
          >
            <option value="reject">
              {{ t("app.import.analysis.review.reject") }}
            </option>
            <option value="merge">
              {{ t("app.import.analysis.review.merge") }}
            </option>
            <option value="split">
              {{ t("app.import.analysis.review.split") }}
            </option>
            <option value="correct">
              {{ t("app.import.analysis.review.correct") }}
            </option>
            <option value="adopt">
              {{ t("app.import.analysis.review.adopt") }}
            </option>
          </select>
        </label>
        <label v-if="reviewOperationKind === 'split'">
          <span>{{ t("app.import.analysis.review.splitRange") }}</span>
          <select
            v-model="reviewSplitAssetId"
            :disabled="blocked || !selectedReviewSourceBounds.length"
            :aria-label="t('app.import.analysis.review.splitSource')"
          >
            <option
              v-for="source in selectedReviewSourceBounds"
              :key="source.assetId"
              :value="source.assetId"
            >
              {{ source.assetId }}
            </option>
          </select>
          <div class="import-review-range">
            <input
              v-model.number="reviewSplitStart"
              type="number"
              min="0"
              step="0.01"
              :disabled="blocked"
              :aria-label="t('app.import.analysis.review.splitStart')"
            />
            <input
              v-model.number="reviewSplitEnd"
              type="number"
              min="0.01"
              step="0.01"
              :disabled="blocked"
              :aria-label="t('app.import.analysis.review.splitBoundary')"
            />
          </div>
          <small v-if="selectedReviewSourceBound">{{
            t("app.import.analysis.review.sourceEnd", {
              end: selectedReviewSourceBound.duration,
            })
          }}</small>
          <small v-else>{{
            t("app.import.analysis.review.noTimedSource")
          }}</small>
        </label>
        <template v-if="reviewOperationKind === 'correct'">
          <label>
            <span>{{ t("app.import.analysis.review.axis") }}</span>
            <select v-model="reviewAxis" :disabled="blocked">
              <option value="narrative-note">
                {{ t("app.import.analysis.review.axisNarrative") }}
              </option>
              <option value="label">
                {{ t("app.import.analysis.review.axisLabel") }}
              </option>
              <option value="capture-time">
                {{ t("app.import.analysis.review.axisCaptureTime") }}
              </option>
              <option value="location">
                {{ t("app.import.analysis.review.axisLocation") }}
              </option>
            </select>
          </label>
          <label>
            <span>{{ t("app.import.analysis.review.correction") }}</span>
            <input
              v-model="reviewCorrection"
              type="text"
              maxlength="1024"
              :disabled="blocked"
            />
          </label>
        </template>
        <label v-if="reviewOperationKind === 'adopt'">
          <span>{{ t("app.import.analysis.review.story") }}</span>
          <select
            v-model="reviewStoryId"
            :disabled="blocked || !reviewStories.length"
          >
            <option value="">
              {{ t("app.import.analysis.review.chooseStory") }}
            </option>
            <option
              v-for="story in reviewStories"
              :key="story.id"
              :value="story.id"
            >
              {{ story.title }}
            </option>
          </select>
        </label>
        <p class="muted">
          {{
            t("app.import.analysis.review.selectionCount", {
              count: selectedReviewIds.length,
            })
          }}
        </p>
        <label v-if="supersedableReviewDecisions.length">
          <span>{{ t("app.import.analysis.review.supersedes") }}</span>
          <select
            v-model="reviewSupersedesDecisionId"
            :disabled="blocked || reviewing"
          >
            <option value="">
              {{ t("app.import.analysis.review.keepDecisions") }}
            </option>
            <option
              v-for="decision in supersedableReviewDecisions"
              :key="decision.id"
              :value="decision.id"
            >
              {{
                t(
                  `app.import.analysis.review.operationKind.${decision.operation.kind}`,
                )
              }}
              · {{ decision.id }}
            </option>
          </select>
        </label>
        <p
          v-if="reviewSearching"
          class="muted"
          role="status"
          aria-live="polite"
        >
          {{ t("app.import.analysis.review.searching") }}
        </p>
        <p v-else-if="!reviewResults.length" class="muted" role="status">
          {{ t("app.import.analysis.review.noResults") }}
        </p>
        <ul
          class="import-analysis-results"
          :aria-label="t('app.import.analysis.review.results')"
        >
          <li v-for="result in reviewResults" :key="result.id">
            <label class="import-review-result">
              <input
                v-model="selectedReviewIds"
                type="checkbox"
                :value="result.id"
                :disabled="
                  blocked ||
                  reviewing ||
                  reviewSearching ||
                  (result.reviewStatus !== 'pending' &&
                    !(
                      reviewOperationKind === 'adopt' &&
                      result.reviewStatus === 'accepted'
                    ))
                "
                @change="reviewPreview = undefined"
              />
              <span>
                <small v-if="(result.review?.baseResultIds.length ?? 0) > 1">{{
                  t("app.import.analysis.review.mergedCount", {
                    count: result.review?.baseResultIds.length ?? 0,
                  })
                }}</small>
                <strong
                  >{{ t(`app.import.analysis.kind.${result.kind}`) }} ·
                  {{
                    t(
                      `app.import.analysis.review.status.${result.reviewStatus}`,
                    )
                  }}</strong
                >
                <small
                  v-for="correction in result.review?.corrections ?? []"
                  :key="correction.decisionId"
                  >{{ correction.value }}</small
                >
                <small
                  v-for="(range, index) in result.review?.sourceRanges ?? []"
                  :key="index"
                  >{{ range.start }}–{{ range.end }} s ·
                  {{ range.assetId }}</small
                >
                <small v-if="result.evidence.type === 'travel-observation'"
                  >{{ result.evidence.assetId }} ·
                  {{ result.evidence.classification }}</small
                >
                <small v-else-if="result.evidence.type === 'visual-sample'"
                  >{{ result.evidence.assetId }} ·
                  {{ result.evidence.status }} ·
                  {{
                    result.evidence.suggestedLabels
                      .map(({ label }) => label)
                      .join(", ") || result.evidence.reason
                  }}</small
                >
                <small v-else
                  >{{ result.evidence.assetIds.length }} ·
                  {{ result.evidence.assetIds.join(", ") }}</small
                >
              </span>
            </label>
          </li>
        </ul>
        <nav
          class="import-review-pagination"
          :aria-label="t('app.import.analysis.review.results')"
        >
          <button
            class="secondary"
            :disabled="
              blocked || reviewing || reviewSearching || reviewOffset === 0
            "
            @click="
              reviewOffset = Math.max(0, reviewOffset - 50);
              void loadReviewPage();
            "
          >
            {{ t("app.import.scan.previous") }}
          </button>
          <span
            >{{ reviewResults.length ? reviewOffset + 1 : 0 }}–{{
              Math.min(reviewOffset + reviewResults.length, reviewTotal)
            }}
            / {{ reviewTotal }}</span
          >
          <button
            class="secondary"
            :disabled="
              blocked ||
              reviewing ||
              reviewSearching ||
              reviewOffset + 50 >= reviewTotal
            "
            @click="
              reviewOffset += 50;
              void loadReviewPage();
            "
          >
            {{ t("app.import.scan.next") }}
          </button>
        </nav>
        <button
          class="secondary"
          :disabled="
            blocked ||
            reviewing ||
            reviewSearching ||
            !selectedReviewIds.length ||
            (reviewOperationKind === 'merge' && selectedReviewIds.length < 2)
          "
          @click="previewReviewOperation"
        >
          {{ t("app.import.analysis.review.preview") }}
        </button>
        <div
          v-if="reviewPreview"
          class="callout"
          :class="reviewPreview.outcome === 'ready' ? 'success' : 'warning'"
          role="status"
          aria-live="polite"
        >
          <strong>{{
            t(
              `app.import.analysis.review.previewStatus.${reviewPreview.outcome}`,
            )
          }}</strong>
          <p>
            {{
              t("app.import.analysis.review.affected", {
                ids: reviewPreview.affectedAssetIds.join(", ") || "—",
              })
            }}
          </p>
          <p v-if="reviewPreview.operation.kind === 'set-observation'">
            {{ reviewPreview.operation.value }}
          </p>
          <p
            v-for="correction in reviewPreview.review?.corrections ?? []"
            :key="correction.decisionId"
          >
            {{ correction.value }}
          </p>
          <p
            v-for="(range, index) in reviewPreview.review?.sourceRanges ?? []"
            :key="index"
          >
            {{ range.start }}–{{ range.end }} s · {{ range.assetId }}
          </p>
          <p
            v-if="reviewPreview.operation.kind === 'adopt-story'"
            class="muted"
          >
            {{ t("app.import.analysis.review.annotationHint") }}
          </p>
          <p v-if="reviewPreview.operation.kind === 'adopt-story'">
            {{ t("app.import.analysis.review.story") }}:
            {{ reviewTargetStoryTitle }}
          </p>
          <p
            v-for="(range, index) in reviewPreview.operation.kind ===
            'split-result'
              ? reviewPreview.operation.ranges
              : []"
            :key="index"
          >
            {{ range.start }}–{{ range.end }} s · {{ range.assetId }}
          </p>
          <p v-if="reviewPreview.conflictReason">
            {{
              t(
                `app.import.analysis.review.conflict.${reviewPreview.conflictReason}`,
              )
            }}
          </p>
          <button
            v-if="reviewPreview.outcome === 'ready'"
            class="primary"
            :disabled="blocked || reviewing"
            @click="acceptReviewOperation"
          >
            {{ t("app.import.analysis.review.accept") }}
          </button>
        </div>
        <ul
          v-if="reviewDecisions.length"
          class="import-analysis-results"
          :aria-label="t('app.import.analysis.review.decisions')"
        >
          <li v-for="decision in reviewDecisions" :key="decision.id">
            {{
              t(`app.import.analysis.review.decisionStatus.${decision.outcome}`)
            }}
            ·
            {{
              t(
                `app.import.analysis.review.operationKind.${decision.operation.kind}`,
              )
            }}
            · {{ decision.id }}
          </li>
        </ul>
      </section>
    </section>
    <footer class="import-draft-footer">
      <div>
        <strong>{{ t("app.import.draftSaved") }}</strong>
        <p>{{ t("app.import.draftNext") }}</p>
      </div>
      <div class="import-draft-actions">
        <button
          v-if="draft?.selections.length"
          class="secondary"
          :disabled="blocked"
          @click="scanSources"
        >
          {{ t("app.import.scan.action") }}
        </button>
        <button v-if="scanning" class="text-button" @click="cancelScan">
          {{ t("app.import.scan.cancel") }}
        </button>
        <button
          v-if="draft?.selections.length"
          class="primary"
          :disabled="blocked || !canSeal"
          @click="sealSources"
        >
          {{ t("app.import.seal.action") }}
        </button>
        <button v-if="sealing" class="text-button" @click="cancelSeal">
          {{ t("app.import.seal.cancel") }}
        </button>
        <button
          v-if="draft?.selections.length"
          class="secondary"
          :disabled="blocked || !compatibleStart"
          @click="startCompatible"
        >
          {{ t("app.import.startCompatible") }}
        </button>
        <p v-if="draft?.selections.length && !compatibleStart" class="muted">
          {{ t("app.import.startPending") }}
        </p>
        <p class="muted">{{ t("app.import.originals") }}</p>
      </div>
    </footer>
  </section>
</template>
