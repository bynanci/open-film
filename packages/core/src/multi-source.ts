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

export type FileOccurrenceAvailability =
  "available" | "needs-reselection" | "missing" | "unreadable" | "staged";

export interface FileOccurrence {
  id: string;
  logicalRootId: string;
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
  status: AnalysisRunStatus;
  createdAt: string;
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
      axis: string;
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
