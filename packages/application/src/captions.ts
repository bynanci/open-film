import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import {
  ApplicationError,
  CAPTION_LIMITS,
  captionAssetState,
  captionClipHasOutput,
  frameAlignedDuration,
  generateCompositionCaptions,
  migrateProject,
  type CaptionCue,
  type CaptionFormat,
  type CaptionIssue,
  type CaptionSource,
  type CaptionAssetState,
  type AnalysisProvenance,
  type Clip,
  type MediaAsset,
  type TranscriptDocument,
} from "@openfilm/core";
import { serializeCaptions } from "@openfilm/exporters";
import {
  checkAbort,
  hashFile,
  localPath,
  safeProjectCachePath,
} from "@openfilm/media";
import { TimelineEditor } from "./editor.js";
import type { OpenFilmApplication } from "./index.js";

const PAGE_LIMIT = 200;
const MAX_SEGMENTS = 100_000;
const MAX_TEXT = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CaptionPrepareInput {
  projectId: string;
  compositionId: string;
  trackId: string;
  baseRevision: string;
}

export interface CaptionSnapshotSource {
  assetId: string;
  assetState: CaptionAssetState;
  sourceHash: string | null;
  transcriptRevisionId: string | null;
  /** Unused transcript: bind latest stored revision metadata, not consumed text. */
  transcriptSkipped?: true;
  transcriptId?: string;
  provenance?: AnalysisProvenance;
  available: boolean;
}

interface CaptionSnapshot {
  id: string;
  version: 1;
  optionsVersion: 1;
  projectId: string;
  compositionId: string;
  compositionRevision: string;
  compositionDuration: number;
  frameRate: number;
  outputDuration: number;
  clipBindings: Array<
    Pick<
      Clip,
      | "id"
      | "assetId"
      | "sourceIn"
      | "sourceOut"
      | "timelineStart"
      | "timelineDuration"
      | "transform"
      | "transition"
    >
  >;
  trackId: string;
  createdAt: string;
  sources: CaptionSnapshotSource[];
  cues: CaptionCue[];
  issues: CaptionIssue[];
}

export interface CaptionPageOptions {
  projectId: string;
  offset?: number;
  limit?: number;
  issueOffset?: number;
  issueLimit?: number;
  sourceOffset?: number;
  sourceLimit?: number;
  clipOffset?: number;
  clipLimit?: number;
}

export interface CaptionSnapshotPage extends CaptionSnapshot {
  cueCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  sourceCount: number;
  clipCount: number;
  offset: number;
  limit: number;
  issueOffset: number;
  issueLimit: number;
  sourceOffset: number;
  sourceLimit: number;
  clipOffset: number;
  clipLimit: number;
  stale: boolean;
  staleReasons: Array<"composition" | "transcript" | "source" | "project">;
  exportable: boolean;
}

export interface CaptionPublication {
  id: string;
  snapshotId: string;
  projectId: string;
  format: CaptionFormat;
  fileName: string;
  mediaType: string;
  relativePath: string;
  cueCount: number;
  createdAt: string;
}

interface PublicationManifest {
  version: 2;
  publication: CaptionPublication;
  snapshot: CaptionSnapshot;
  output: { sha256: string; bytes: number };
  digest: string;
}

interface SourceCheck {
  hash: string | null;
  available: boolean;
  stamp?: string;
  uri: string;
}

function invalid(message: string): never {
  throw new ApplicationError("captions.invalid", message);
}
function identifier(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid(
      `${field} must be a nonempty identifier of at most 256 characters.`,
    );
}
function object(
  value: unknown,
  allowed: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    invalid("Caption input must be a plain JSON object.");
  for (const field of Object.keys(value))
    if (!allowed.includes(field)) invalid(`Unknown caption field: ${field}.`);
}
function uuid(value: string): void {
  if (typeof value !== "string" || !UUID.test(value))
    invalid("Invalid caption snapshot or publication ID.");
}
function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function stamp(asset: MediaAsset): string {
  const info = statSync(localPath(asset.uri));
  if (!info.isFile()) throw new Error("Caption source must be a regular file.");
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}
function regular(path: string, directory = false): void {
  const info = lstatSync(path);
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile())
  )
    throw new ApplicationError(
      "captions.failed",
      "Caption storage must not contain symlinks or non-regular files.",
      409,
    );
  if (!directory && info.size > MAX_FILE_BYTES)
    throw new ApplicationError(
      "request.tooLarge",
      "Caption file exceeds the supported size.",
      413,
    );
}
function checkedBounds(
  value: unknown,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < (maximum === PAGE_LIMIT ? 1 : 0) ||
    result > maximum
  )
    invalid("Caption pages require nonnegative offsets and limits of 1–200.");
  return result;
}

/** Immutable derived text exports. No transcript, timeline, history or media mutation. */
export class CaptionService {
  constructor(private readonly application: OpenFilmApplication) {}

  private project(projectId: string): void {
    identifier(projectId, "projectId");
    if (projectId !== this.application.project.id)
      throw new ApplicationError(
        "captions.stale",
        "The caption request belongs to a different project.",
        409,
      );
  }

  /** Reuse the editor revision contract against both the live and durable project. */
  private compositionCurrent(
    snapshot: Pick<
      CaptionSnapshot,
      "projectId" | "compositionId" | "compositionRevision" | "frameRate"
    >,
  ): boolean {
    try {
      const path = join(this.application.directory, "project.json");
      regular(path);
      const project = migrateProject(JSON.parse(readFileSync(path, "utf8")));
      if (
        project.id !== snapshot.projectId ||
        this.application.project.id !== snapshot.projectId ||
        project.settings.frameRate !== snapshot.frameRate ||
        this.application.project.settings.frameRate !== snapshot.frameRate
      )
        return false;
      const durable = new TimelineEditor({
        project,
        catalog: this.application.catalog,
      } as OpenFilmApplication);
      return (
        new TimelineEditor(this.application).get(snapshot.compositionId)
          .revision === snapshot.compositionRevision &&
        durable.get(snapshot.compositionId).revision ===
          snapshot.compositionRevision
      );
    } catch {
      return false;
    }
  }

  private transcriptRevision(
    source: Pick<
      CaptionSnapshotSource,
      "assetId" | "sourceHash" | "transcriptSkipped"
    >,
  ): string | null {
    if (!source.sourceHash) return null;
    // Skipped sources bind metadata across stored versions without loading or
    // validating segment contents. Audible sources retain the reader's version
    // contract; older snapshots without this marker continue using that path.
    if (source.transcriptSkipped)
      return (
        this.application.catalog.transcripts.revisions(
          source.assetId,
          source.sourceHash,
          { limit: 1 },
        ).revisions[0]?.id ?? null
      );
    return (
      this.application.catalog.transcripts.get(
        source.assetId,
        source.sourceHash,
        { limit: 1 },
      ).revision ?? null
    );
  }

  private async sourceCheck(
    asset: MediaAsset,
    signal?: AbortSignal,
  ): Promise<SourceCheck> {
    checkAbort(signal);
    try {
      const before = stamp(asset);
      const actual = await hashFile(localPath(asset.uri), signal);
      const after = stamp(asset);
      checkAbort(signal);
      if (before !== after)
        return {
          hash: asset.contentHash ?? null,
          available: false,
          uri: asset.uri,
        };
      return {
        hash: actual,
        available: !asset.contentHash || actual === asset.contentHash,
        stamp: after,
        uri: asset.uri,
      };
    } catch (error) {
      checkAbort(signal);
      if (error instanceof Error && error.name === "AbortError") throw error;
      let currentStamp: string | undefined;
      try {
        currentStamp = stamp(asset);
      } catch {
        /* Missing and offline sources remain reportable. */
      }
      return {
        hash: asset.contentHash ?? null,
        available: false,
        uri: asset.uri,
        ...(currentStamp ? { stamp: currentStamp } : {}),
      };
    }
  }

  private immediateReasons(
    snapshot: CaptionSnapshot,
    checks?: Map<string, SourceCheck>,
  ): CaptionSnapshotPage["staleReasons"] {
    const reasons = new Set<CaptionSnapshotPage["staleReasons"][number]>();
    if (snapshot.projectId !== this.application.project.id)
      reasons.add("project");
    if (!this.compositionCurrent(snapshot)) reasons.add("composition");
    for (const source of snapshot.sources) {
      const asset = this.application.catalog.getAsset(source.assetId);
      if (!asset) {
        reasons.add("source");
        continue;
      }
      // Metadata can change eligibility or timing without changing file bytes.
      // Older derived snapshots without this binding require regeneration.
      if (
        JSON.stringify(source.assetState) !==
        JSON.stringify(captionAssetState(asset))
      )
        reasons.add("source");
      try {
        if (this.transcriptRevision(source) !== source.transcriptRevisionId)
          reasons.add("transcript");
      } catch {
        reasons.add("source");
      }
      const check = checks?.get(source.assetId);
      if (check) {
        if (
          check.available !== source.available ||
          (source.available && check.hash !== source.sourceHash)
        )
          reasons.add("source");
        if (check.uri !== asset.uri) reasons.add("source");
        try {
          if (check.stamp ? stamp(asset) !== check.stamp : source.available)
            reasons.add("source");
        } catch {
          if (check.stamp || source.available) reasons.add("source");
        }
      }
    }
    return [...reasons];
  }

  private async status(snapshot: CaptionSnapshot, signal?: AbortSignal) {
    const checks = new Map<string, SourceCheck>();
    for (const source of snapshot.sources) {
      checkAbort(signal);
      const asset = this.application.catalog.getAsset(source.assetId);
      if (asset)
        checks.set(source.assetId, await this.sourceCheck(asset, signal));
    }
    checkAbort(signal);
    return { checks, reasons: this.immediateReasons(snapshot, checks) };
  }

  private page(
    snapshot: CaptionSnapshot,
    options: CaptionPageOptions,
    reasons: CaptionSnapshotPage["staleReasons"],
  ): CaptionSnapshotPage {
    object(options, [
      "projectId",
      "offset",
      "limit",
      "issueOffset",
      "issueLimit",
      "sourceOffset",
      "sourceLimit",
      "clipOffset",
      "clipLimit",
    ]);
    this.project(options.projectId);
    if (snapshot.projectId !== options.projectId)
      throw new ApplicationError(
        "captions.stale",
        "The caption snapshot belongs to another project.",
        409,
      );
    const offset = checkedBounds(options.offset, 0),
      limit = checkedBounds(options.limit, PAGE_LIMIT, PAGE_LIMIT),
      issueOffset = checkedBounds(options.issueOffset, 0),
      issueLimit = checkedBounds(options.issueLimit, PAGE_LIMIT, PAGE_LIMIT),
      sourceOffset = checkedBounds(options.sourceOffset, 0),
      sourceLimit = checkedBounds(options.sourceLimit, PAGE_LIMIT, PAGE_LIMIT),
      clipOffset = checkedBounds(options.clipOffset, 0),
      clipLimit = checkedBounds(options.clipLimit, PAGE_LIMIT, PAGE_LIMIT);
    const errorCount = snapshot.issues.filter(
      (issue) => issue.severity === "error",
    ).length;
    return {
      ...snapshot,
      cues: snapshot.cues.slice(offset, offset + limit),
      issues: snapshot.issues.slice(issueOffset, issueOffset + issueLimit),
      sources: snapshot.sources.slice(sourceOffset, sourceOffset + sourceLimit),
      clipBindings: snapshot.clipBindings.slice(
        clipOffset,
        clipOffset + clipLimit,
      ),
      sourceCount: snapshot.sources.length,
      clipCount: snapshot.clipBindings.length,
      cueCount: snapshot.cues.length,
      issueCount: snapshot.issues.length,
      errorCount,
      warningCount: snapshot.issues.length - errorCount,
      offset,
      limit,
      issueOffset,
      issueLimit,
      sourceOffset,
      sourceLimit,
      clipOffset,
      clipLimit,
      stale: reasons.length > 0,
      staleReasons: reasons,
      exportable: !reasons.length && !errorCount && snapshot.cues.length > 0,
    };
  }

  async prepare(
    input: CaptionPrepareInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<CaptionSnapshotPage> {
    object(input, ["projectId", "compositionId", "trackId", "baseRevision"]);
    for (const field of [
      "projectId",
      "compositionId",
      "trackId",
      "baseRevision",
    ] as const)
      identifier(input[field], field);
    this.project(input.projectId);
    checkAbort(options.signal);
    const selectedTrack = this.application.project.timelines
      .find((composition) => composition.id === input.compositionId)
      ?.tracks.find((track) => track.id === input.trackId);
    if (
      selectedTrack &&
      !["video", "audio", "music"].includes(selectedTrack.type)
    )
      invalid("Choose a video, audio, or music track for captions.");
    if (selectedTrack && selectedTrack.clips.length > CAPTION_LIMITS.clips)
      throw new ApplicationError(
        "request.tooLarge",
        "Caption generation supports up to 10,000 selected clips.",
        413,
      );
    const frameRate = this.application.project.settings.frameRate;
    if (!Number.isFinite(frameRate) || frameRate <= 0)
      invalid("Caption output requires a positive, finite project frame rate.");
    const state = new TimelineEditor(this.application).get(input.compositionId);
    const binding = {
      projectId: input.projectId,
      compositionId: input.compositionId,
      compositionRevision: input.baseRevision,
      frameRate,
    };
    if (!this.compositionCurrent(binding))
      throw new ApplicationError(
        "captions.stale",
        "The film changed. Save it and generate captions again.",
        409,
      );
    const track = state.composition.tracks.find(
      (item) => item.id === input.trackId,
    );
    if (!track) invalid("Select an existing caption source track.");
    const outputDuration =
      state.composition.duration > 0
        ? frameAlignedDuration(state.composition.duration, frameRate)
        : 0;
    const clipsByAsset = new Map<string, Clip[]>();
    for (const clip of track.clips) {
      const clips = clipsByAsset.get(clip.assetId);
      if (clips) clips.push(clip);
      else clipsByAsset.set(clip.assetId, [clip]);
    }
    const sources: CaptionSource[] = [],
      bindings: CaptionSnapshotSource[] = [];
    const checks = new Map<string, SourceCheck>();
    let segmentCount = 0,
      textSize = 0;
    for (const [assetId, clips] of clipsByAsset) {
      checkAbort(options.signal);
      const asset = this.application.catalog.getAsset(assetId);
      if (!asset)
        throw new ApplicationError(
          "media.notFound",
          "The selected caption source no longer exists.",
          404,
        );
      const check = await this.sourceCheck(asset, options.signal);
      checks.set(assetId, check);
      const sourceHash = asset.contentHash ?? check.hash;
      const assetState = captionAssetState(asset);
      const transcriptSkipped =
        !check.available ||
        !["video", "audio"].includes(assetState.mediaType) ||
        assetState.previewBlocked ||
        !assetState.hasAudio ||
        assetState.duration === "invalid" ||
        !clips.some(
          (clip) =>
            (clip.transform?.volume ?? 1) !== 0 &&
            captionClipHasOutput(
              clip,
              Math.min(state.composition.duration, outputDuration),
              typeof assetState.duration === "number"
                ? assetState.duration
                : undefined,
            ),
        );
      const first =
        sourceHash && !transcriptSkipped
          ? this.application.catalog.transcripts.get(assetId, sourceHash, {
              limit: PAGE_LIMIT,
            })
          : undefined;
      let transcript: TranscriptDocument | undefined;
      if (first?.document && first.revision) {
        segmentCount += first.total;
        if (segmentCount > MAX_SEGMENTS)
          throw new ApplicationError(
            "request.tooLarge",
            "Caption generation supports up to 100,000 transcript segments per snapshot.",
            413,
          );
        transcript = { ...first.document, segments: [] };
        const appendPage = (document: TranscriptDocument) => {
          for (const segment of document.segments) {
            checkAbort(options.signal);
            textSize += Buffer.byteLength(segment.text, "utf8");
            if (textSize > MAX_TEXT)
              throw new ApplicationError(
                "request.tooLarge",
                "Caption text exceeds the 32 MiB supported snapshot size.",
                413,
              );
            // Caption mapping uses segment timing, never historical word
            // alignment. Retain only its inputs; the catalog stays untouched.
            transcript!.segments.push({
              id: segment.id,
              start: segment.start,
              end: segment.end,
              text: segment.text,
              ...(segment.alignmentState !== undefined
                ? { alignmentState: segment.alignmentState }
                : {}),
              ...(segment.timingSource !== undefined
                ? { timingSource: segment.timingSource }
                : {}),
            });
          }
        };
        appendPage(first.document);
        for (
          let offset = PAGE_LIMIT;
          offset < first.total;
          offset += PAGE_LIMIT
        ) {
          await yieldEventLoop(undefined, { signal: options.signal });
          const page = this.application.catalog.transcripts.get(
            assetId,
            sourceHash!,
            { revisionId: first.revision, offset, limit: PAGE_LIMIT },
          );
          if (!page.document || page.revision !== first.revision)
            throw new ApplicationError(
              "captions.stale",
              "The transcript revision changed while reading caption text.",
              409,
            );
          appendPage(page.document);
        }
      }
      sources.push({
        asset,
        available: check.available,
        ...(transcript
          ? { transcript, transcriptRevisionId: first!.revision! }
          : {}),
      });
      bindings.push({
        assetId,
        assetState,
        sourceHash,
        transcriptRevisionId: transcriptSkipped
          ? this.transcriptRevision({
              assetId,
              sourceHash,
              transcriptSkipped: true,
            })
          : (first?.revision ?? null),
        ...(transcriptSkipped ? { transcriptSkipped: true as const } : {}),
        ...(transcript
          ? {
              transcriptId: transcript.id,
              provenance: structuredClone(transcript.provenance),
            }
          : {}),
        available: check.available,
      });
    }
    checkAbort(options.signal);
    const mapping = generateCompositionCaptions(state.composition, sources, {
      trackId: input.trackId,
      frameRate,
    });
    const snapshot: CaptionSnapshot = {
      id: randomUUID(),
      version: 1,
      optionsVersion: 1,
      ...binding,
      compositionDuration: state.composition.duration,
      outputDuration,
      clipBindings: track.clips.map(
        ({
          id,
          assetId,
          sourceIn,
          sourceOut,
          timelineStart,
          timelineDuration,
          transform,
          transition,
        }) => ({
          id,
          assetId,
          sourceIn,
          sourceOut,
          timelineStart,
          timelineDuration,
          transform,
          transition,
        }),
      ),
      trackId: input.trackId,
      createdAt: new Date().toISOString(),
      sources: bindings,
      cues: mapping.cues,
      issues: mapping.issues,
    };
    const target = await safeProjectCachePath(
      this.application.directory,
      "captions",
      `${snapshot.id}.json`,
    );
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const serialized = JSON.stringify(snapshot);
      const content = JSON.stringify({ snapshot, digest: hash(serialized) });
      if (Buffer.byteLength(content) > MAX_FILE_BYTES)
        throw new ApplicationError(
          "request.tooLarge",
          "Caption snapshot exceeds the supported size.",
          413,
        );
      await writeFile(temporary, content, {
        flag: "wx",
        mode: 0o600,
        signal: options.signal,
      });
      checkAbort(options.signal);
      const reasons = this.immediateReasons(snapshot, checks);
      if (reasons.length)
        throw new ApplicationError(
          "captions.stale",
          "The film, transcript or media changed during caption preparation. Generate a new preview.",
          409,
        );
      regular(join(this.application.directory, "cache"), true);
      regular(join(this.application.directory, "cache", "captions"), true);
      if (existsSync(target))
        throw new ApplicationError(
          "captions.failed",
          "The caption snapshot already exists.",
          409,
        );
      renameSync(temporary, target);
      return this.page(
        snapshot,
        { projectId: input.projectId, limit: 100, issueLimit: 20 },
        [],
      );
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async snapshot(
    id: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CaptionSnapshot> {
    uuid(id);
    this.project(projectId);
    checkAbort(signal);
    const path = await safeProjectCachePath(
      this.application.directory,
      "captions",
      `${id}.json`,
    );
    try {
      checkAbort(signal);
      regular(path);
      const content = await readFile(path, { encoding: "utf8", signal });
      checkAbort(signal);
      const stored = JSON.parse(content) as {
        snapshot?: CaptionSnapshot;
        digest?: string;
      };
      const snapshot = stored.snapshot;
      if (
        !snapshot ||
        snapshot.id !== id ||
        snapshot.projectId !== projectId ||
        snapshot.version !== 1 ||
        snapshot.optionsVersion !== 1 ||
        !Array.isArray(snapshot.cues) ||
        !Array.isArray(snapshot.issues) ||
        !Array.isArray(snapshot.sources) ||
        hash(JSON.stringify(snapshot)) !== stored.digest
      )
        throw new Error("Invalid caption snapshot integrity or identity.");
      return snapshot;
    } catch (error) {
      checkAbort(signal);
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "captions.unavailable",
        "The caption preview is unavailable. Generate it again.",
        404,
      );
    }
  }

  async get(
    id: string,
    options: CaptionPageOptions,
    runtime: { signal?: AbortSignal } = {},
  ): Promise<CaptionSnapshotPage> {
    const snapshot = await this.snapshot(id, options.projectId, runtime.signal);
    const status = await this.status(snapshot, runtime.signal);
    return this.page(snapshot, options, status.reasons);
  }

  async export(
    id: string,
    format: CaptionFormat,
    options: { projectId: string; signal?: AbortSignal },
  ): Promise<CaptionPublication> {
    if (format !== "srt" && format !== "vtt")
      invalid("Select SRT or WebVTT captions.");
    const snapshot = await this.snapshot(id, options.projectId, options.signal);
    if (
      !snapshot.cues.length ||
      snapshot.issues.some((issue) => issue.severity === "error")
    )
      throw new ApplicationError(
        "captions.unavailable",
        "Resolve caption errors and provide at least one usable cue before exporting.",
        409,
      );
    const status = await this.status(snapshot, options.signal);
    if (status.reasons.length)
      throw new ApplicationError(
        "captions.stale",
        "The caption preview is outdated. Generate it again before exporting.",
        409,
      );
    const serialized = serializeCaptions(format, snapshot.cues);
    const publicationId = randomUUID(),
      fileName = `captions.${serialized.extension}`;
    const publication: CaptionPublication = {
      id: publicationId,
      snapshotId: id,
      projectId: options.projectId,
      format,
      fileName,
      mediaType: serialized.mediaType,
      relativePath: `exports/captions-${publicationId}/${fileName}`,
      cueCount: snapshot.cues.length,
      createdAt: new Date().toISOString(),
    };
    const receipt: Omit<PublicationManifest, "digest"> = {
      version: 2,
      publication,
      snapshot,
      output: {
        sha256: hash(serialized.content),
        bytes: Buffer.byteLength(serialized.content),
      },
    };
    // Bind every receipt field without depending on the disposable preview cache.
    // This checksum detects changed content; it is not a publisher signature.
    const manifest: PublicationManifest = {
      ...receipt,
      digest: hash(JSON.stringify(receipt)),
    };
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    if (
      manifest.output.bytes > MAX_FILE_BYTES ||
      Buffer.byteLength(manifestContent) > MAX_FILE_BYTES
    )
      throw new ApplicationError(
        "request.tooLarge",
        "Caption publication exceeds the supported file size.",
        413,
      );
    const exports = join(this.application.directory, "exports");
    regular(exports, true);
    const temporary = join(exports, `.captions-${publicationId}.tmp`),
      target = join(exports, `captions-${publicationId}`);
    await mkdir(temporary, { mode: 0o700 });
    try {
      await writeFile(join(temporary, fileName), serialized.content, {
        flag: "wx",
        mode: 0o600,
        signal: options.signal,
      });
      await writeFile(join(temporary, "manifest.json"), manifestContent, {
        flag: "wx",
        mode: 0o600,
        signal: options.signal,
      });
      checkAbort(options.signal);
      if (this.immediateReasons(snapshot, status.checks).length)
        throw new ApplicationError(
          "captions.stale",
          "The caption inputs changed while exporting. Generate a fresh preview.",
          409,
        );
      regular(exports, true);
      regular(temporary, true);
      if (existsSync(target))
        throw new ApplicationError(
          "captions.failed",
          "The caption output already exists.",
          409,
        );
      renameSync(temporary, target);
      return publication;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async publication(
    id: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<PublicationManifest> {
    uuid(id);
    this.project(projectId);
    checkAbort(signal);
    const root = join(this.application.directory, "exports"),
      directory = join(root, `captions-${id}`),
      path = join(directory, "manifest.json");
    try {
      regular(root, true);
      regular(directory, true);
      regular(path);
      const content = await readFile(path, { encoding: "utf8", signal });
      checkAbort(signal);
      const manifest = JSON.parse(content) as PublicationManifest;
      const { digest, ...receipt } = manifest;
      const publication = manifest.publication;
      if (
        manifest.version !== 2 ||
        hash(JSON.stringify(receipt)) !== digest ||
        publication?.id !== id ||
        publication.projectId !== projectId ||
        !["srt", "vtt"].includes(publication.format) ||
        publication.fileName !== `captions.${publication.format}` ||
        publication.relativePath !==
          `exports/captions-${id}/${publication.fileName}` ||
        manifest.snapshot?.id !== publication.snapshotId ||
        manifest.snapshot.projectId !== projectId ||
        !Number.isSafeInteger(manifest.output?.bytes) ||
        manifest.output.bytes < 0 ||
        manifest.output.bytes > MAX_FILE_BYTES ||
        !/^[a-f0-9]{64}$/.test(manifest.output.sha256)
      )
        throw new Error("Invalid caption publication.");
      return manifest;
    } catch (error) {
      checkAbort(signal);
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "captions.unavailable",
        "The caption export is unavailable or incomplete. Export a new copy.",
        404,
      );
    }
  }

  async readPublication(
    id: string,
    options: { projectId: string; signal?: AbortSignal },
  ): Promise<CaptionPublication> {
    return (await this.publication(id, options.projectId, options.signal))
      .publication;
  }

  async readOutput(
    id: string,
    options: {
      projectId: string;
      kind?: "captions" | "manifest";
      signal?: AbortSignal;
    },
  ): Promise<{ publication: CaptionPublication; content: string }> {
    if (
      options.kind !== undefined &&
      options.kind !== "captions" &&
      options.kind !== "manifest"
    )
      invalid("Unknown caption publication file.");
    const manifest = await this.publication(
      id,
      options.projectId,
      options.signal,
    );
    checkAbort(options.signal);
    if (options.kind === "manifest")
      return {
        publication: manifest.publication,
        content: `${JSON.stringify(manifest, null, 2)}\n`,
      };
    const path = join(
      this.application.directory,
      "exports",
      `captions-${id}`,
      manifest.publication.fileName,
    );
    let content: string;
    try {
      regular(path);
      content = await readFile(path, {
        encoding: "utf8",
        signal: options.signal,
      });
      checkAbort(options.signal);
    } catch (error) {
      checkAbort(options.signal);
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "captions.unavailable",
        "The caption export is unavailable or incomplete. Export a new copy.",
        404,
      );
    }
    if (
      Buffer.byteLength(content) !== manifest.output.bytes ||
      hash(content) !== manifest.output.sha256
    )
      throw new ApplicationError(
        "captions.unavailable",
        "The caption export no longer matches its publication receipt.",
        409,
      );
    return { publication: manifest.publication, content };
  }

  async readManifest(
    id: string,
    options: { projectId: string; signal?: AbortSignal },
  ): Promise<string> {
    return `${JSON.stringify(await this.publication(id, options.projectId, options.signal), null, 2)}\n`;
  }
}
