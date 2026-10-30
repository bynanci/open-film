// Modified by OpenFilm contributors on 2026-10-25. See LICENSE and NOTICE.

export type SourceSelectionKind = "file" | "folder";

/** Access capabilities have different lifetimes and must never be conflated. */
export type SourceAccessClass =
  | "native-path"
  | "persistent-browser-handle"
  | "ephemeral-browser-file"
  | "staged-content";

export interface SourceSelection {
  id: string;
  projectId: string;
  kind: SourceSelectionKind;
  displayName: string;
  accessClass: SourceAccessClass;
  /** Opaque local-store key. Never a serialized browser handle or credential. */
  accessRef: string;
  recursive: boolean;
  selectionRevision: number;
}

export interface SourceDraft {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  selections: SourceSelection[];
}

/** Portable catalog projection of a source selection (access references omitted). */
export interface CatalogSourceSelection {
  id: string;
  projectId: string;
  kind: SourceSelectionKind;
  displayName: string;
  logicalRootId: string;
  recursive: boolean;
  selectionRevision: number;
}

export const SOURCE_DRAFT_LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  selections: 10_000,
});

export function estimateSourceDraftBytes(
  projectId: string,
  sources: readonly (Pick<
    SourceSelection,
    "kind" | "displayName" | "accessClass" | "accessRef"
  > & { recursive?: boolean })[],
): number {
  const selections = sources.map((source, index) => ({
    ...source,
    recursive: source.recursive ?? source.kind === "folder",
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    projectId,
    selectionRevision: 1,
  }));
  const representative = {
    schemaVersion: 1,
    projectId,
    revision: 1,
    selections,
    receipts: [
      {
        requestId: "00000000-0000-4000-8000-000000000000",
        fingerprint: "0".repeat(64),
      },
    ],
  };
  return new TextEncoder().encode(`${JSON.stringify(representative)}\n`)
    .byteLength;
}

export type FileOccurrenceAvailability =
  "available" | "needs-reselection" | "missing" | "unreadable" | "staged";

export interface FileOccurrence {
  id: string;
  logicalRootId: string;
  displayName: string;
  relativePath: string;
  fileKind: "image" | "video" | "audio" | "track" | "unsupported";
  byteLength?: number;
  modifiedAt?: string;
  availability: FileOccurrenceAvailability;
  scanRevision: number;
}

export interface SelectionMembership {
  selectionId: string;
  occurrenceId: string;
  relativePath: string;
  included: boolean;
  scanRevision: number;
}

export interface ContentIdentity {
  id: string;
  hashAlgorithm: "sha256";
  fullHash: string;
  byteLength: number;
  mediaKind: "image" | "video" | "audio" | "track";
}

export interface AssetContentVersion {
  id: string;
  assetId: string;
  occurrenceId: string;
  contentId: string;
  contextRevision: string;
  descriptorSnapshotId: string;
}

export type AnalysisScopeMode = "selected-sources" | "project-catalog";

/** Shared source-discovery bounds available to both browser UI and application services. */
export const SOURCE_DISCOVERY_LIMITS = Object.freeze({
  pageSize: 100,
  maximumPageSize: 500,
  maximumCandidatesPerRequest: 100_000,
  maximumSelectionsPerRequest: 10_000,
  browserPageSize: 128,
  maximumBrowserScans: 8,
});

export type ImportBatchStatus =
  "sealing" | "sealed" | "partial" | "failed" | "cancelled";

export type AnalysisRunStatus =
  "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";

export type JobAttemptStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "abandoned";

export interface ImportBatch {
  id: string;
  projectId: string;
  draftRevision: number;
  scopeMode: AnalysisScopeMode;
  status: ImportBatchStatus;
  expectedManifestId: string;
  createdAt: string;
}

export interface ExpectedManifestEntry {
  occurrenceId: string;
  relativePath: string;
  included: boolean;
  expectedByteLength?: number;
  expectedModifiedAt?: string;
}

export interface ExpectedManifest {
  id: string;
  batchId: string;
  revision: number;
  selectionHash: string;
  entries: ExpectedManifestEntry[];
  partialPolicy: "require-all" | "allow-readable";
  createdAt: string;
}

export interface VerifiedManifestMember {
  bindingId: string;
  assetId: string;
  contentHash: string;
  contextRevision: string;
}

export interface VerifiedManifestFailure {
  occurrenceId: string;
  code: string;
}

export interface VerifiedManifest {
  id: string;
  expectedManifestId: string;
  members: VerifiedManifestMember[];
  failures: VerifiedManifestFailure[];
  excludedOccurrenceIds: string[];
  createdAt: string;
}

export interface AnalysisRun {
  id: string;
  projectId: string;
  manifestId: string;
  scopeMode: AnalysisScopeMode;
  algorithmVersion: string;
  taxonomyVersion: string;
  configHash: string;
  inputFingerprint: string;
  inputBindingIds: string[];
  /** Explicit, versioned location/time context used by travel-v1 analysis. */
  travelContext?: TravelContextV1;
  /** Opt-in visual sampling recipe; encoded frames are never persisted in the run. */
  visualSampling?: VisualSamplingV1;
  projectCatalogRevision?: string;
  status: AnalysisRunStatus;
  createdAt: string;
}

export interface VisualSamplingV1 {
  version: 1;
  algorithmVersion: "representative-frames-v1";
  /** Omitted means local sampling only with explicit unknown/manual-review evidence. */
  providerId?: string;
}

export interface VisualSampleEvidenceV1 {
  type: "visual-sample";
  algorithmVersion: "representative-frames-v1";
  sampleId: string;
  /** Stable against retries, and changes whenever source hash/time/algorithm changes. */
  sampleFingerprint: string;
  assetId: string;
  sourceHash: string;
  frameHash?: string;
  sourceTimeRange: { start: number; end: number };
  status: "suggested" | "unknown";
  suggestedLabels: { label: string; confidence: number }[];
  reason?:
    | "provider-not-configured"
    | "provider-failed"
    | "provider-no-labels"
    | "consent-revoked"
    | "sample-unavailable"
    | "source-duration-unavailable";
  manualReviewRequired: true;
  providerReceipt?: {
    providerId: string;
    execution: "local" | "remote";
    invokedAt: string;
    consentGrantedAt?: string;
  };
}

export function validateVisualSampling(value: unknown): VisualSamplingV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Visual sampling configuration must be an object.");
  const config = value as Record<string, unknown>;
  if (
    Object.keys(config).some(
      (key) =>
        key !== "version" && key !== "algorithmVersion" && key !== "providerId",
    )
  )
    throw new Error(
      "Visual sampling configuration contains an unsupported field.",
    );
  if (
    config.version !== 1 ||
    config.algorithmVersion !== "representative-frames-v1"
  )
    throw new Error("Visual sampling version is unsupported.");
  if (
    config.providerId !== undefined &&
    (typeof config.providerId !== "string" ||
      !config.providerId.trim() ||
      config.providerId.length > 256 ||
      hasControlCharacters(config.providerId))
  )
    throw new Error("Visual sample provider ID is invalid.");
  return {
    version: 1,
    algorithmVersion: "representative-frames-v1",
    ...(typeof config.providerId === "string"
      ? { providerId: config.providerId }
      : {}),
  };
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}

export interface TravelTrackPointV1 {
  latitude: number;
  longitude: number;
  time?: string;
  elevationMeters?: number;
}

export interface TravelTrackSegmentV1 {
  index: number;
  points: TravelTrackPointV1[];
}

/** Parsed route evidence; the GPX source itself remains immutable and is hashed. */
export interface TravelTrackV1 {
  id: string;
  contentHash: string;
  segments: TravelTrackSegmentV1[];
}

/** Clock adjustments are explicit user facts, never inferred by the solver. */
export interface DeviceClockMappingV1 {
  id: string;
  assetIds: string[];
  offsetMilliseconds: number;
  timeZone?: string;
  source: "manual";
}

export interface TravelTrackAssignmentV1 {
  trackId: string;
  assetIds: string[];
}

export interface TravelContextV1 {
  version: 1;
  algorithmVersion: "travel-v1";
  tracks: TravelTrackV1[];
  clockMappings: DeviceClockMappingV1[];
  assignments: TravelTrackAssignmentV1[];
}

export interface AnalysisEvidenceResult<T = unknown> {
  id: string;
  runId: string;
  kind: "event" | "duplicate" | "observation";
  reviewStatus: "pending" | "accepted" | "rejected" | "superseded";
  evidence: T;
  bindingIds: string[];
}

export interface JobAttempt {
  id: string;
  operationId: string;
  operationKind: "import-batch" | "analysis-run";
  generation: number;
  ownerToken: string;
  status: JobAttemptStatus;
  stage: string;
  cancelRequested: boolean;
  /** Local idempotency key fingerprint; the request itself is never persisted. */
  requestFingerprint?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface SourceTimeRange {
  assetId: string;
  start: number;
  end: number;
}

export type ReviewDecisionOperation =
  | { kind: "merge-results"; resultIds: string[] }
  | { kind: "split-result"; resultId: string; ranges: SourceTimeRange[] }
  | {
      kind: "set-observation";
      resultId: string;
      axis: "label" | "capture-time" | "location" | "narrative-note";
      value: string;
    }
  | { kind: "reject-results"; resultIds: string[] }
  | { kind: "adopt-story"; storyId: string; resultIds: string[] };

export interface ReviewDecision {
  schemaVersion: 1;
  id: string;
  projectId: string;
  baseRunId: string;
  baseResultIds: string[];
  targetIds: string[];
  operation: ReviewDecisionOperation;
  operationFingerprint: string;
  beforeFingerprint: string;
  manifestId: string;
  storyRevision?: string;
  supersedesDecisionId?: string;
  outcome: "applied" | "conflicted" | "superseded";
  createdAt: string;
}

const importBatchTransitions: Readonly<
  Record<ImportBatchStatus, readonly ImportBatchStatus[]>
> = Object.freeze({
  sealing: ["sealed", "partial", "failed", "cancelled"],
  sealed: [],
  partial: ["sealing"],
  failed: ["sealing"],
  cancelled: ["sealing"],
});

const analysisRunTransitions: Readonly<
  Record<AnalysisRunStatus, readonly AnalysisRunStatus[]>
> = Object.freeze({
  queued: ["running", "cancelled"],
  running: ["completed", "partial", "failed", "cancelled"],
  completed: [],
  partial: ["queued"],
  failed: ["queued"],
  cancelled: ["queued"],
});

const attemptTransitions: Readonly<
  Record<JobAttemptStatus, readonly JobAttemptStatus[]>
> = Object.freeze({
  queued: ["running", "cancelled", "abandoned"],
  running: ["succeeded", "failed", "cancelled", "abandoned"],
  succeeded: [],
  failed: [],
  cancelled: [],
  abandoned: [],
});

function allowed<S extends string>(
  transitions: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  return from === to || transitions[from].includes(to);
}

export function canTransitionImportBatch(
  from: ImportBatchStatus,
  to: ImportBatchStatus,
): boolean {
  return allowed(importBatchTransitions, from, to);
}

export function canTransitionAnalysisRun(
  from: AnalysisRunStatus,
  to: AnalysisRunStatus,
): boolean {
  return allowed(analysisRunTransitions, from, to);
}

export function canTransitionJobAttempt(
  from: JobAttemptStatus,
  to: JobAttemptStatus,
): boolean {
  return allowed(attemptTransitions, from, to);
}
