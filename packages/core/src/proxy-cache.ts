// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { ApplicationError } from "./errors.js";
import type { ReviewExecutionOwner } from "./models.js";

export const PROXY_CACHE_LIMITS = Object.freeze({
  activeTasks: 128,
  defaultQuotaBytes: 5 * 1024 ** 3,
  minimumQuotaBytes: 1024 ** 2,
  maximumQuotaBytes: 1024 ** 4,
  inventoryFiles: 10_000,
  pageSize: 100,
  receiptBytes: 8192,
});

export interface ProxyCachePolicy {
  version: 1;
  revision: number;
  quotaBytes: number;
}

export interface ProxyCacheOutput {
  uri: string;
  hash: string;
  byteLength: number;
  duration: number;
  width?: number;
  height?: number;
}

/** Private job metadata; it must not enter portable catalog projections. */
export interface ProxyCacheTask {
  version: 1;
  projectId: string;
  assetId: string;
  mediaType: "video" | "audio";
  sourceHash: string;
  inputFingerprint: string;
  recipe: "ffmpeg-preview-v2";
  requestId: string;
  requestFingerprint: string;
  generation: number;
  owner: ReviewExecutionOwner;
  output?: ProxyCacheOutput;
  retryOf?: string;
  /** A remote cancellation remains pending until its execution owner settles. */
  cancelRequestedAt?: string;
}

/** Private artifact provenance survives replacement of the catalog jobs table. */
export interface ProxyCacheReceipt {
  version: 1;
  projectId: string;
  artifactId: string;
  jobId: string;
  generation: number;
  assetId: string;
  mediaType: "video" | "audio";
  sourceHash: string;
  derivationFingerprint: string;
  recipe: "ffmpeg-preview-v2";
  createdAt: string;
  output: ProxyCacheOutput;
}

export type ProxyCacheEntryStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "ready"
  | "missing"
  | "stale"
  | "failed"
  | "cancelled"
  | "legacy"
  | "unavailable";

export interface ProxyCacheHealth {
  version: 1;
  projectId: string;
  policy: ProxyCachePolicy;
  managedBytes: number;
  unmanagedBytes: number;
  temporaryBytes: number;
  inventoryComplete: boolean;
  running: boolean;
  queued: number;
  recovery?: { fingerprint: string; ownerState: "alive" | "dead" | "unknown" };
  entries: Array<{
    assetId: string;
    name: string;
    status: ProxyCacheEntryStatus;
    jobId?: string;
    bytes?: number;
    protected: boolean;
    verification: "recorded" | "checked" | "unchecked";
  }>;
  total: number;
  offset: number;
  hasNext: boolean;
}

export interface ProxyCleanupPreview {
  version: 1;
  projectId: string;
  previewId: string;
  expiresAt: string;
  fingerprint: string;
  bytes: number;
  entries: Array<{
    artifactId: string;
    assetId: string;
    name: string;
    byteLength: number;
  }>;
  protectedCount: number;
  hasMore: boolean;
}

export interface ProxyCleanupResult {
  removedBytes: number;
  removedArtifactIds: string[];
  failedArtifactIds: string[];
}

export interface ProxyVerificationResult {
  results: Array<{
    assetId: string;
    status: "verified" | "missing" | "stale" | "legacy" | "unavailable";
    sourceStatus: "verified" | "missing" | "changed" | "unavailable";
  }>;
}

function invalid(message: string): never {
  throw new ApplicationError("request.invalid", message);
}

function record(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Proxy cache data must be a record.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !allowed.includes(key)))
    invalid("Proxy cache data contains an unsupported field.");
  return data;
}

function text(value: unknown, maximum = 512): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > maximum ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid("Proxy cache identifiers must be bounded text.");
}

function integer(value: unknown, minimum: number, maximum: number): void {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    invalid("Proxy cache numeric value is outside its supported bounds.");
}

function hash(value: unknown): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    invalid("Proxy cache evidence requires a complete SHA-256.");
}

function output(value: unknown, mediaType: "video" | "audio"): void {
  const data = record(value, [
    "uri",
    "hash",
    "byteLength",
    "duration",
    "width",
    "height",
  ]);
  if (
    typeof data.uri !== "string" ||
    !/^cache\/proxies\/managed\/[a-f0-9]{64}\.(?:mp4|mp3)$/u.test(data.uri) ||
    !data.uri.endsWith(mediaType === "audio" ? ".mp3" : ".mp4")
  )
    invalid("Proxy output must be a relative managed cache file.");
  hash(data.hash);
  integer(data.byteLength, 1, PROXY_CACHE_LIMITS.maximumQuotaBytes);
  if (
    typeof data.duration !== "number" ||
    !Number.isFinite(data.duration) ||
    data.duration <= 0
  )
    invalid("Proxy duration must be positive and finite.");
  if (data.width !== undefined) integer(data.width, 1, 640);
  if (data.height !== undefined) integer(data.height, 1, 360);
  if (
    mediaType === "audio" &&
    (data.width !== undefined || data.height !== undefined)
  )
    invalid("Audio proxies cannot declare a picture size.");
}

function source(
  data: Record<string, unknown>,
  fingerprint:
    "inputFingerprint" | "derivationFingerprint" = "inputFingerprint",
): asserts data is Record<string, unknown> & { mediaType: "video" | "audio" } {
  if (data.version !== 1) invalid("Unsupported proxy cache version.");
  for (const field of ["projectId", "assetId"]) text(data[field]);
  if (data.mediaType !== "video" && data.mediaType !== "audio")
    invalid("This source does not support managed preview generation.");
  hash(data.sourceHash);
  hash(data[fingerprint]);
  if (data.recipe !== "ffmpeg-preview-v2") invalid("Unsupported proxy recipe.");
  integer(data.generation, 1, Number.MAX_SAFE_INTEGER);
}

export function validateProxyCachePolicy(value: unknown): ProxyCachePolicy {
  const data = record(value, ["version", "revision", "quotaBytes"]);
  if (data.version !== 1) invalid("Unsupported proxy cache policy version.");
  integer(data.revision, 0, Number.MAX_SAFE_INTEGER);
  integer(
    data.quotaBytes,
    PROXY_CACHE_LIMITS.minimumQuotaBytes,
    PROXY_CACHE_LIMITS.maximumQuotaBytes,
  );
  return structuredClone(data) as unknown as ProxyCachePolicy;
}

export function validateProxyCacheTask(value: unknown): ProxyCacheTask {
  const data = record(value, [
    "version",
    "projectId",
    "assetId",
    "mediaType",
    "sourceHash",
    "inputFingerprint",
    "recipe",
    "requestId",
    "requestFingerprint",
    "generation",
    "owner",
    "output",
    "retryOf",
    "cancelRequestedAt",
  ]);
  source(data);
  text(data.requestId);
  hash(data.requestFingerprint);
  const owner = record(data.owner, ["host", "pid", "token"]);
  text(owner.host);
  text(owner.token);
  integer(owner.pid, 1, 2147483647);
  if (data.output !== undefined) output(data.output, data.mediaType);
  if (data.retryOf !== undefined) text(data.retryOf);
  if (data.cancelRequestedAt !== undefined) {
    text(data.cancelRequestedAt, 32);
    if (
      !Number.isFinite(Date.parse(data.cancelRequestedAt)) ||
      new Date(data.cancelRequestedAt).toISOString() !== data.cancelRequestedAt
    )
      invalid("Proxy cancellation time must be an exact UTC timestamp.");
  }
  return structuredClone(data) as unknown as ProxyCacheTask;
}

export function validateProxyCacheReceipt(value: unknown): ProxyCacheReceipt {
  const data = record(value, [
    "version",
    "projectId",
    "artifactId",
    "jobId",
    "generation",
    "assetId",
    "mediaType",
    "sourceHash",
    "derivationFingerprint",
    "recipe",
    "createdAt",
    "output",
  ]);
  source(data, "derivationFingerprint");
  hash(data.artifactId);
  text(data.jobId);
  text(data.createdAt, 32);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(data.createdAt) ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    new Date(data.createdAt).toISOString() !== data.createdAt
  )
    invalid("Proxy receipt time must be an exact UTC timestamp.");
  output(data.output, data.mediaType);
  if (
    (data.output as ProxyCacheOutput).uri !==
    `cache/proxies/managed/${data.artifactId}.${data.mediaType === "audio" ? "mp3" : "mp4"}`
  )
    invalid("Proxy receipt identity does not match its relative file.");
  return structuredClone(data) as unknown as ProxyCacheReceipt;
}
