import type { api } from "./api";

export interface PendingSourceReviewAcceptance {
  version: 1;
  runId: string;
  payload: Parameters<typeof api.acceptSourceAnalysisReview>[1];
}

const MAX_RECEIPT_LENGTH = 128 * 1024;

function receiptKey(projectId: string): string {
  return `openfilm.source-review-acceptance:${JSON.stringify(projectId)}`;
}

function record(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value!).every((key) => keys.includes(key))
  );
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    ![...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}

function validOperation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  const ids = (value: unknown) =>
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 100 &&
    value.every((id) => text(id, 256)) &&
    new Set(value).size === value.length;
  if (op.kind === "merge-results" || op.kind === "reject-results")
    return record(op, ["kind", "resultIds"]) && ids(op.resultIds);
  if (op.kind === "adopt-story")
    return (
      record(op, ["kind", "resultIds", "storyId"]) &&
      ids(op.resultIds) &&
      text(op.storyId, 256)
    );
  if (op.kind === "set-observation")
    return (
      record(op, ["kind", "resultId", "axis", "value"]) &&
      text(op.resultId, 256) &&
      ["label", "capture-time", "location", "narrative-note"].includes(
        String(op.axis),
      ) &&
      text(op.value, 1024)
    );
  if (op.kind === "split-result")
    return (
      record(op, ["kind", "resultId", "ranges"]) &&
      text(op.resultId, 256) &&
      Array.isArray(op.ranges) &&
      op.ranges.length >= 2 &&
      op.ranges.length <= 100 &&
      op.ranges.every(
        (range) =>
          record(range, ["assetId", "start", "end"]) &&
          text(range.assetId, 256) &&
          typeof range.start === "number" &&
          Number.isFinite(range.start) &&
          range.start >= 0 &&
          typeof range.end === "number" &&
          Number.isFinite(range.end) &&
          range.end > range.start,
      )
    );
  return false;
}

function validate(
  value: unknown,
  projectId: string,
): PendingSourceReviewAcceptance {
  if (
    !record(value, ["version", "runId", "payload"]) ||
    value.version !== 1 ||
    !text(value.runId, 256)
  )
    throw new Error("Invalid source-review acceptance receipt.");
  const payload = value.payload;
  const fingerprint = (value: unknown) =>
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  if (
    !record(payload, [
      "projectId",
      "operation",
      "expectedManifestId",
      "expectedBeforeFingerprint",
      "expectedOperationFingerprint",
      "expectedStoryRevision",
      "requestId",
      "supersedesDecisionId",
    ]) ||
    payload.projectId !== projectId ||
    !text(payload.projectId, 512) ||
    !validOperation(payload.operation) ||
    !text(payload.expectedManifestId, 256) ||
    !text(payload.requestId, 512) ||
    !fingerprint(payload.expectedBeforeFingerprint) ||
    !fingerprint(payload.expectedOperationFingerprint) ||
    (payload.expectedStoryRevision !== undefined &&
      !fingerprint(payload.expectedStoryRevision)) ||
    (payload.supersedesDecisionId !== undefined &&
      !text(payload.supersedesDecisionId, 256))
  )
    throw new Error("Invalid source-review acceptance payload.");
  return value as unknown as PendingSourceReviewAcceptance;
}

/** Private local recovery state. Never sent until the user explicitly retries. */
export function readSourceReviewAcceptance(
  projectId: string,
): PendingSourceReviewAcceptance | undefined {
  const raw = localStorage.getItem(receiptKey(projectId));
  if (raw === null) return undefined;
  if (raw.length > MAX_RECEIPT_LENGTH)
    throw new Error("Source-review receipt exceeds its limit.");
  return validate(JSON.parse(raw), projectId);
}

export function retainSourceReviewAcceptance(
  receipt: PendingSourceReviewAcceptance,
): void {
  const safe = validate(receipt, receipt.payload.projectId);
  const key = receiptKey(safe.payload.projectId);
  const serialized = JSON.stringify(safe);
  if (serialized.length > MAX_RECEIPT_LENGTH)
    throw new Error("Source-review receipt exceeds its limit.");
  const existing = localStorage.getItem(key);
  if (existing !== null && existing !== serialized)
    throw new Error(
      "Another source-review acceptance requires recovery first.",
    );
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized)
    throw new Error("Source-review acceptance could not be retained.");
}

export function clearSourceReviewAcceptance(
  receipt: PendingSourceReviewAcceptance,
): void {
  const key = receiptKey(receipt.payload.projectId);
  const raw = localStorage.getItem(key);
  if (raw !== null && raw !== JSON.stringify(receipt))
    throw new Error(
      "Source-review recovery state changed before acknowledgment.",
    );
  localStorage.removeItem(key);
  if (localStorage.getItem(key) !== null)
    throw new Error("Source-review acknowledgment could not be retained.");
}
