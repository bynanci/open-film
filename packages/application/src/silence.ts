// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, type BigIntStats } from "node:fs";
import { link, lstat, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ApplicationError,
  canonicalPresetJson,
  createSilenceCutProposal,
  DEFAULT_SILENCE_PADDING_SECONDS,
  MAX_AUDIO_ACTIVITY_DURATION_SECONDS,
  validateAudioActivityEvidence,
  validateSilenceCutProposal,
  type AudioActivityEvidence,
  type MediaAsset,
  type SilenceCutProposal,
} from "@openfilm/core";
import {
  analyzeAudioActivity,
  hashFile,
  localPath,
  withVerifiedSourceFile,
  type AudioActivityOptions,
} from "@openfilm/media";
import { syncPrivateDirectory } from "./directory-sync.js";
import { TimelineEditor, type TimelineEditorState } from "./editor.js";
import type { OpenFilmApplication } from "./index.js";

export interface SilenceReviewOptions extends AudioActivityOptions {
  paddingSeconds?: number;
}
export interface SilenceReviewEnvelope {
  readonly reviewId: string;
  readonly proposal: SilenceCutProposal;
}
export interface SilenceApplyOptions {
  requestId?: string;
  /** Present only when accepting a persisted Silence Job. */
  jobId?: string;
  /** Share the caller's editor to keep its undo/redo and request history. */
  editor?: TimelineEditor;
}
interface StoredReview extends SilenceReviewEnvelope {
  version: 1;
  projectId: string;
}
interface ReadReview {
  record: StoredReview;
  assertCurrent: () => void;
}

const MAX_REVIEW_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 32 * 1024 ** 3;
const HASH = /^[a-f0-9]{64}$/u;
const ANALYSIS_KEYS = [
  "thresholdDb",
  "minimumSilenceSeconds",
  "signal",
  "onProgress",
  "onSkipped",
] as const;

function invalid(message: string): never {
  throw new ApplicationError("request.invalid", message);
}
function stale(
  message = "The silence review or its editing context changed. Review again.",
): never {
  throw new ApplicationError("analysis.resultStale", message, 409);
}
function object(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid(name + " must be a plain object.");
  const data = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(data)) {
    const descriptor = Object.getOwnPropertyDescriptor(data, key)!;
    if (
      typeof key !== "string" ||
      !keys.includes(key) ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      invalid(name + " contains an unsupported field.");
  }
  return data;
}
function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    invalid(name + " must be a nonblank identifier.");
  return value;
}
function bounded(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value === undefined ? fallback : value;
  if (
    typeof resolved !== "number" ||
    !Number.isFinite(resolved) ||
    resolved < minimum ||
    resolved > maximum
  )
    invalid(name + " is outside the supported range.");
  return resolved;
}
function analysisOptions(data: Record<string, unknown>): AudioActivityOptions {
  const thresholdDb = bounded(data.thresholdDb, -40, -80, -10, "thresholdDb");
  const minimumSilenceSeconds = bounded(
    data.minimumSilenceSeconds,
    0.5,
    0.1,
    30,
    "minimumSilenceSeconds",
  );
  if (data.signal !== undefined && !(data.signal instanceof AbortSignal))
    invalid("signal must be an AbortSignal.");
  if (data.onProgress !== undefined && typeof data.onProgress !== "function")
    invalid("onProgress must be a function.");
  if (data.onSkipped !== undefined && typeof data.onSkipped !== "function")
    invalid("onSkipped must be a function.");
  return {
    thresholdDb,
    minimumSilenceSeconds,
    ...(data.signal !== undefined
      ? { signal: data.signal as AbortSignal }
      : {}),
    ...(data.onProgress !== undefined
      ? { onProgress: data.onProgress as AudioActivityOptions["onProgress"] }
      : {}),
    ...(data.onSkipped !== undefined
      ? { onSkipped: data.onSkipped as AudioActivityOptions["onSkipped"] }
      : {}),
  };
}
function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function identity(info: BigIntStats): string {
  return [
    info.dev,
    info.ino,
    info.mode,
    info.nlink,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
  ].join(":");
}
function recordedHash(asset: MediaAsset): string | undefined {
  if (asset.contentHash === undefined) return undefined;
  if (
    typeof asset.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(asset.contentHash)
  )
    invalid(
      "The source has an invalid recorded SHA-256. Re-import or relink it.",
    );
  return asset.contentHash.toLowerCase();
}
function recordId(projectId: string, proposal: SilenceCutProposal): string {
  return createHash("sha256")
    .update(canonicalPresetJson({ version: 1, projectId, proposal }))
    .digest("hex");
}
function envelope(value: unknown): SilenceReviewEnvelope {
  const data = object(value, ["reviewId", "proposal"], "silence review");
  if (typeof data.reviewId !== "string" || !HASH.test(data.reviewId))
    invalid("A silence review requires its lowercase SHA-256 reviewId.");
  return {
    reviewId: data.reviewId,
    proposal: validateSilenceCutProposal(data.proposal),
  };
}

/**
 * Foreground, local measured-silence review. Analysis never edits a timeline;
 * Apply accepts only the exact durable reviewed proposal through the editor.
 */
export class SilenceService {
  private readonly editor: TimelineEditor;
  constructor(private readonly app: OpenFilmApplication) {
    this.editor = new TimelineEditor(app);
  }

  private source(assetId: string): MediaAsset {
    identifier(assetId, "assetId");
    const asset = this.app.getSourceAsset(assetId);
    if (!asset)
      throw new ApplicationError(
        "request.notFound",
        "Silence source asset was not found.",
        404,
      );
    if (asset.mediaType !== "audio" && asset.mediaType !== "video")
      throw new ApplicationError(
        "media.unsupported",
        "Silence analysis requires audio or video with an audio stream.",
        422,
      );
    if (
      asset.duration !== undefined &&
      (!Number.isFinite(asset.duration) ||
        asset.duration <= 0 ||
        asset.duration > MAX_AUDIO_ACTIVITY_DURATION_SECONDS)
    )
      throw new ApplicationError(
        "media.unsupported",
        "Silence analysis supports at most 24 source hours.",
        422,
      );
    recordedHash(asset);
    return asset;
  }

  public validateSourceAsset(assetId: string): MediaAsset {
    return structuredClone(this.source(assetId));
  }

  public async analyzeAsset(
    assetId: string,
    options: AudioActivityOptions = {},
  ): Promise<AudioActivityEvidence> {
    const parsed = analysisOptions(
      object(options, ANALYSIS_KEYS, "silence analysis options"),
    );
    parsed.signal?.throwIfAborted();
    const asset = this.source(assetId);
    let path: string;
    try {
      path = localPath(asset.uri);
    } catch {
      throw new ApplicationError(
        "media.unsupported",
        "Silence analysis requires a local source file.",
        422,
      );
    }
    try {
      const sourceInfo = await lstat(path);
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink())
        throw new ApplicationError(
          "media.unsupported",
          "Silence analysis requires a regular local source file.",
          422,
        );
      if (sourceInfo.size > MAX_SOURCE_BYTES)
        throw new ApplicationError(
          "request.tooLarge",
          "Silence analysis supports source files up to 32 GiB.",
          413,
        );
      const evidence = await withVerifiedSourceFile(
        path,
        recordedHash(asset),
        (snapshot, verifiedHash) =>
          analyzeAudioActivity(
            { ...asset, uri: pathToFileURL(snapshot).href },
            verifiedHash,
            parsed,
          ),
        { signal: parsed.signal, maximumBytes: MAX_SOURCE_BYTES },
      );
      parsed.signal?.throwIfAborted();
      return immutable(validateAudioActivityEvidence(evidence));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
        throw new ApplicationError(
          "media.missing",
          "The silence source file is unavailable.",
          404,
        );
      throw error;
    }
  }

  private assertTimeline(compositionId: string, revision: string): void {
    if (this.editor.get(compositionId).revision !== revision)
      stale(
        "The timeline or its source facts changed while reviewing silence.",
      );
  }

  /**
   * Verify current bytes, then retain a synchronous identity/catalog guard for
   * the editor's final publication callback. No source path is trusted by hash
   * metadata alone, and no original source file is written.
   */
  private async verifySource(
    assetId: string,
    sourceHash: string,
    signal?: AbortSignal,
  ): Promise<() => void> {
    signal?.throwIfAborted();
    const asset = this.source(assetId);
    const catalogIdentity = canonicalPresetJson(asset);
    const recorded = recordedHash(asset);
    if (recorded !== undefined && recorded !== sourceHash)
      throw new ApplicationError(
        "source.changed",
        "The reviewed source no longer matches its catalog hash.",
        409,
      );
    const path = localPath(asset.uri);
    let before: BigIntStats, after: BigIntStats;
    try {
      before = await lstat(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink())
        throw new ApplicationError(
          "media.unsupported",
          "The reviewed source must remain a regular file.",
          422,
        );
      const actual = await hashFile(path, signal);
      after = await lstat(path, { bigint: true });
      if (identity(before) !== identity(after) || actual !== sourceHash)
        throw new ApplicationError(
          "source.changed",
          "Source bytes changed since the silence review.",
          409,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
        throw new ApplicationError(
          "media.missing",
          "The reviewed silence source is unavailable.",
          404,
        );
      throw error;
    }
    const expected = identity(after);
    const assertCurrent = () => {
      const current = this.app.getSourceAsset(assetId);
      if (!current || canonicalPresetJson(current) !== catalogIdentity)
        throw new ApplicationError(
          "source.changed",
          "Source catalog facts changed after silence review verification.",
          409,
        );
      try {
        if (identity(lstatSync(path, { bigint: true })) !== expected)
          throw new ApplicationError(
            "source.changed",
            "Source bytes changed before the silence edit was saved.",
            409,
          );
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(
          "source.changed",
          "The reviewed source changed or became unavailable.",
          409,
        );
      }
    };
    assertCurrent();
    return assertCurrent;
  }

  private async reviewDirectory(create: boolean): Promise<string> {
    let path = this.app.directory;
    for (const part of ["", "analysis", "silence-reviews"]) {
      if (part) path = join(path, part);
      if (create && part) {
        try {
          await mkdir(path, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ApplicationError(
          "workspace.unavailable",
          "Silence review storage must use real project directories.",
          409,
        );
    }
    return path;
  }

  private async readReview(reviewId: string): Promise<ReadReview> {
    if (!HASH.test(reviewId)) invalid("Invalid silence reviewId.");
    try {
      const directory = await this.reviewDirectory(false);
      const path = join(directory, reviewId + ".json");
      const before = await lstat(path, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size <= 0n ||
        before.size > BigInt(MAX_REVIEW_BYTES)
      )
        stale("The stored silence review is invalid or too large.");
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      let text: string;
      let after: BigIntStats;
      try {
        const opened = await handle.stat({ bigint: true });
        if (identity(before) !== identity(opened)) stale();
        text = await handle.readFile("utf8");
        after = await handle.stat({ bigint: true });
        if (
          identity(before) !== identity(after) ||
          Buffer.byteLength(text) > MAX_REVIEW_BYTES
        )
          stale();
      } finally {
        await handle.close();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        stale("The stored silence review is not valid JSON.");
      }
      const data = object(
        raw,
        ["version", "projectId", "reviewId", "proposal"],
        "stored silence review",
      );
      if (
        data.version !== 1 ||
        data.projectId !== this.app.project.id ||
        data.reviewId !== reviewId
      )
        stale(
          "The stored silence review belongs to a different project or version.",
        );
      const proposal = validateSilenceCutProposal(data.proposal);
      if (recordId(this.app.project.id, proposal) !== reviewId)
        stale("The stored silence review payload was changed.");
      const expected = identity(after);
      const projectId = this.app.project.id;
      return {
        record: { version: 1, projectId, reviewId, proposal },
        assertCurrent: () => {
          if (this.app.project.id !== projectId) stale();
          try {
            if (identity(lstatSync(path, { bigint: true })) !== expected)
              stale();
          } catch {
            stale(
              "The stored silence review changed before the edit was saved.",
            );
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
        throw new ApplicationError(
          "request.notFound",
          "The durable silence review was not found. Create a new review.",
          404,
        );
      throw error;
    }
  }

  private async persistReview(
    record: StoredReview,
    signal?: AbortSignal,
  ): Promise<void> {
    const text = JSON.stringify(record, null, 2) + "\n";
    if (Buffer.byteLength(text) > MAX_REVIEW_BYTES)
      throw new ApplicationError(
        "request.tooLarge",
        "The silence review exceeds its storage bound.",
        413,
      );
    const directory = await this.reviewDirectory(true);
    const temporary = join(directory, ".write-" + randomUUID() + ".tmp");
    const path = join(directory, record.reviewId + ".json");
    signal?.throwIfAborted();
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      signal?.throwIfAborted();
      try {
        // Atomic publication without replacing any previously reviewed payload.
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await this.readReview(record.reviewId);
        if (
          canonicalPresetJson(existing.record) !== canonicalPresetJson(record)
        )
          stale("A different silence review already owns this identity.");
      }
    } finally {
      await rm(temporary, { force: true });
    }
    await syncPrivateDirectory(directory);
  }

  public async createProposal(
    compositionId: string,
    assetId: string,
    options: SilenceReviewOptions = {},
  ): Promise<SilenceReviewEnvelope> {
    return this.createProposalInternal(compositionId, assetId, options);
  }

  /** Analysis Job entry point bound to the identities captured at reservation. */
  public async createBoundProposal(
    compositionId: string,
    assetId: string,
    identity: { baseRevision: string; sourceHash: string },
    options: SilenceReviewOptions = {},
  ): Promise<SilenceReviewEnvelope> {
    const expected = object(
      identity,
      ["baseRevision", "sourceHash"],
      "silence analysis identity",
    );
    if (
      typeof expected.baseRevision !== "string" ||
      !HASH.test(expected.baseRevision) ||
      typeof expected.sourceHash !== "string" ||
      !HASH.test(expected.sourceHash)
    )
      invalid("Silence analysis requires a captured revision and source hash.");
    return this.createProposalInternal(compositionId, assetId, options, {
      baseRevision: expected.baseRevision,
      sourceHash: expected.sourceHash,
    });
  }

  /** Create an immutable selection review from saved evidence, without re-decoding. */
  public async createDerivedProposal(
    sourceReviewId: string,
    identity: {
      compositionId: string;
      baseRevision: string;
      sourceHash: string;
    },
    selectedCandidateIds: readonly string[],
  ): Promise<SilenceReviewEnvelope> {
    if (!HASH.test(sourceReviewId)) invalid("Invalid source reviewId.");
    const expected = object(
      identity,
      ["compositionId", "baseRevision", "sourceHash"],
      "silence review identity",
    );
    const compositionId = identifier(expected.compositionId, "compositionId");
    const baseRevision = String(expected.baseRevision);
    const sourceHash = String(expected.sourceHash);
    if (!HASH.test(baseRevision) || !HASH.test(sourceHash))
      invalid(
        "A derived silence Review requires captured revision and source hash.",
      );
    if (
      !Array.isArray(selectedCandidateIds) ||
      selectedCandidateIds.length > 2000 ||
      selectedCandidateIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 128,
      ) ||
      new Set(selectedCandidateIds).size !== selectedCandidateIds.length
    )
      invalid("Choose unique measured silence candidate identifiers.");

    const source = await this.readProposal(sourceReviewId);
    const parent = source.proposal;
    if (
      parent.compositionId !== compositionId ||
      parent.baseRevision !== baseRevision ||
      parent.sourceHash !== sourceHash
    )
      stale("The source Review no longer matches the captured edit context.");
    this.assertTimeline(compositionId, baseRevision);
    const before = this.editor.get(compositionId);
    const proposal = validateSilenceCutProposal(
      createSilenceCutProposal(before.composition, parent.evidence, {
        baseRevision,
        paddingSeconds: parent.paddingSeconds,
        assets: before.assets,
        selectedCandidateIds,
      }),
    );
    const assertSource = await this.verifySource(parent.assetId, sourceHash);
    this.assertTimeline(compositionId, baseRevision);
    const projectId = this.app.project.id;
    const reviewId = recordId(projectId, proposal);
    await this.persistReview({ version: 1, projectId, reviewId, proposal });
    assertSource();
    this.assertTimeline(compositionId, baseRevision);
    return immutable({ reviewId, proposal });
  }

  private async createProposalInternal(
    compositionId: string,
    assetId: string,
    options: SilenceReviewOptions,
    expected?: { baseRevision: string; sourceHash: string },
  ): Promise<SilenceReviewEnvelope> {
    identifier(compositionId, "compositionId");
    const data = object(
      options,
      [...ANALYSIS_KEYS, "paddingSeconds"],
      "silence review options",
    );
    const parsed = analysisOptions(data);
    const paddingSeconds = bounded(
      data.paddingSeconds,
      DEFAULT_SILENCE_PADDING_SECONDS,
      0,
      2,
      "paddingSeconds",
    );
    parsed.signal?.throwIfAborted();
    const before = this.editor.get(compositionId);
    if (expected && before.revision !== expected.baseRevision)
      stale("The captured timeline revision changed before analysis started.");
    const evidence = await this.analyzeAsset(assetId, parsed);
    if (expected && evidence.sourceHash !== expected.sourceHash)
      throw new ApplicationError(
        "source.changed",
        "The source hash changed after the silence Job was reserved.",
        409,
      );
    this.assertTimeline(compositionId, before.revision);
    const proposal = validateSilenceCutProposal(
      createSilenceCutProposal(before.composition, evidence, {
        baseRevision: before.revision,
        paddingSeconds,
        assets: before.assets,
      }),
    );
    const assertSource = await this.verifySource(
      assetId,
      proposal.sourceHash,
      parsed.signal,
    );
    this.assertTimeline(compositionId, before.revision);
    const projectId = this.app.project.id;
    const reviewId = recordId(projectId, proposal);
    await this.persistReview(
      { version: 1, projectId, reviewId, proposal },
      parsed.signal,
    );
    parsed.signal?.throwIfAborted();
    assertSource();
    this.assertTimeline(compositionId, before.revision);
    return immutable({ reviewId, proposal });
  }

  /** Read only the exact, validated Review already persisted by this service. */
  public async readProposal(reviewId: string): Promise<SilenceReviewEnvelope> {
    const stored = await this.readReview(reviewId);
    return immutable({
      reviewId: stored.record.reviewId,
      proposal: validateSilenceCutProposal(stored.record.proposal),
    });
  }

  public async verifyReviewedProposal(
    reviewId: string,
    value: unknown,
    compositionId: string,
    baseRevision: string,
    signal?: AbortSignal,
  ): Promise<() => void> {
    signal?.throwIfAborted();
    const reviewed = envelope({ reviewId, proposal: value });
    const proposal = reviewed.proposal;
    if (proposal.timelineIntervals.length === 0)
      invalid(
        "This review contains no removable silence. The timeline was not changed.",
      );
    if (
      proposal.compositionId !== compositionId ||
      proposal.baseRevision !== baseRevision
    )
      stale("The silence review is bound to another timeline or revision.");
    this.assertTimeline(compositionId, baseRevision);
    const stored = await this.readReview(reviewed.reviewId);
    if (
      canonicalPresetJson(stored.record.proposal) !==
      canonicalPresetJson(proposal)
    )
      stale("Apply must use the exact proposal that was durably reviewed.");
    const assertSource = await this.verifySource(
      proposal.assetId,
      proposal.sourceHash,
      signal,
    );
    signal?.throwIfAborted();
    this.assertTimeline(compositionId, baseRevision);
    const assertCurrent = () => {
      stored.assertCurrent();
      assertSource();
    };
    assertCurrent();
    return assertCurrent;
  }

  public async apply(
    value: unknown,
    options: SilenceApplyOptions = {},
  ): Promise<TimelineEditorState> {
    const reviewed = envelope(value);
    const parsed = object(
      options,
      ["requestId", "editor", "jobId"],
      "silence apply options",
    );
    if (parsed.requestId !== undefined)
      identifier(parsed.requestId, "requestId");
    if (parsed.jobId !== undefined) identifier(parsed.jobId, "jobId");
    if (
      parsed.editor !== undefined &&
      !(parsed.editor instanceof TimelineEditor)
    )
      invalid("editor must be a TimelineEditor.");
    if (reviewed.proposal.timelineIntervals.length === 0)
      invalid(
        "This review contains no removable silence. The timeline was not changed.",
      );
    // The editor re-verifies durable review, sources, and every nested leaf.
    // Keep request receipts and undo/redo in the caller's editor or our own.
    if (parsed.jobId !== undefined) {
      if (parsed.requestId === undefined)
        invalid("A durable Silence Job Apply requires a requestId.");
      return (
        (parsed.editor as TimelineEditor | undefined) ?? this.editor
      ).applySilenceReview(
        parsed.jobId as string,
        parsed.requestId as string,
        reviewed.reviewId,
        reviewed.proposal,
      );
    }
    return ((parsed.editor as TimelineEditor | undefined) ?? this.editor).edit(
      reviewed.proposal.compositionId,
      {
        baseRevision: reviewed.proposal.baseRevision,
        ...(parsed.requestId !== undefined
          ? { requestId: parsed.requestId as string }
          : {}),
        commands: [
          {
            type: "silence.ripple",
            reviewId: reviewed.reviewId,
            proposal: reviewed.proposal,
          },
        ],
      },
    );
  }
}
