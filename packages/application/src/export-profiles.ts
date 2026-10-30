// Modified by OpenFilm contributors on 2026-10-20. See LICENSE/NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { constants, statSync } from "node:fs";
import {
  copyFile,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { acquireExportRequestLock } from "./export-request-lock.js";
import {
  DirectoryPublicationRecoveryError,
  directoryPublicationUnavailable,
  publishDirectory,
} from "./directory-publication.js";
import type {
  AudioAutomation,
  Composition,
  ExportProfile,
  FilmLook,
  MediaAsset,
  OpenFilmProject,
} from "@openfilm/core";
import {
  ApplicationError,
  frameAlignedDuration,
  validateExportProfile,
} from "@openfilm/core";
import {
  hashFile,
  checkAbort,
  localPath,
  runProcess,
  safeProjectCachePath,
} from "@openfilm/media";
import {
  publishRenderPair,
  RenderPublicationRecoveryError,
  canonicalRenderFonts,
  canonicalRenderFontBindings,
  audioSourceAssetIds,
  visualSourceAssetIds,
  type RenderFontEvidence,
  type RenderFontBinding,
  type RenderOptions,
  type RenderSnapshot,
} from "@openfilm/render";

export interface ProfileFramePreview {
  token: string;
  url: string;
  time: number;
  frameIndex: number;
  width: number;
  height: number;
  profile: ExportProfile;
  warnings: string[];
}

export interface ProfileExportArtifact {
  path: string;
  filename: string;
  profile: ExportProfile;
  warnings: string[];
  requestId: string;
  time?: number;
  frameIndex?: number;
}

export interface AudioExportFile {
  role: AudioAutomation["role"] | "mix";
  path: string;
  filename: string;
  sha256: string;
  sampleRate: number;
  channels: number;
  sampleCount: number;
  duration: number;
}

export interface AudioProfileExport {
  requestId: string;
  profile: ExportProfile;
  files: AudioExportFile[];
  manifestPath?: string;
  warnings: string[];
}

export interface ExportProfileServiceOptions {
  directory: string;
  getProject: () => OpenFilmProject;
  getComposition: (id?: string) => Composition;
  getAssets: (composition: Composition) => MediaAsset[];
  render: (
    compositionId: string,
    outputPath: string,
    options: RenderOptions,
  ) => Promise<string>;
}

interface PreviewEntry {
  path: string;
  projectId: string;
  revision: string;
  compositionId: string;
  profile: ExportProfile;
  frameIndex: number;
  renderSelection: ReturnType<typeof renderSelection>;
  outputSha256: string;
  sources: NonNullable<RenderReceipt["sources"]>;
  fonts: RenderFontEvidence[];
  fontBindings: RenderFontBinding[];
  expiresAt: number;
}

interface RenderReceipt {
  warnings?: string[];
  fonts?: RenderFontEvidence[];
  fontBindings?: RenderFontBinding[];
  sources?: Array<{
    assetId: string;
    name: string;
    sha256: string;
    size: number;
  }>;
}

const STEM_ROLES: readonly AudioAutomation["role"][] = [
  "narration",
  "music",
  "ambience",
  "dialogue",
];
const PREVIEW_LIFETIME_MS = 10 * 60 * 1000;
const PREVIEW_TOKEN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;

function renderSelection(input: {
  lookOverride?: FilmLook | null;
  captionTrackId?: string | null;
}) {
  return {
    lookOverride:
      input.lookOverride == null
        ? { mode: "saved" as const }
        : { mode: "override" as const, value: input.lookOverride },
    captionTrackId:
      input.captionTrackId === undefined
        ? { mode: "automatic" as const }
        : input.captionTrackId === null
          ? { mode: "none" as const }
          : { mode: "track" as const, id: input.captionTrackId },
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeRequestId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,95}$/u.test(value))
    throw new Error("Export requestId must be 8–96 safe ASCII characters.");
  return value;
}

function profileMode(
  profile: ExportProfile,
  formats: readonly ExportProfile["format"][],
): ExportProfile {
  const validated = validateExportProfile(profile);
  if (!formats.includes(validated.format))
    throw new Error(
      `This export operation does not support ${validated.format}.`,
    );
  return validated;
}

function readSources(receipt: unknown): NonNullable<RenderReceipt["sources"]> {
  if (!receipt || typeof receipt !== "object") return [];
  const sources = (receipt as RenderReceipt).sources;
  return Array.isArray(sources) ? sources : [];
}

function readFonts(receipt: { fonts?: unknown }): RenderFontEvidence[] {
  if (!Array.isArray(receipt.fonts))
    throw new Error(
      "Render receipt has no font identities; render a new preview.",
    );
  const fonts = receipt.fonts.map((value: unknown) => {
    if (!value || typeof value !== "object")
      throw new Error("Render receipt has an invalid font identity.");
    const font = value as Record<string, unknown>;
    if (
      typeof font.family !== "string" ||
      typeof font.postscriptName !== "string" ||
      typeof font.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(font.sha256)
    )
      throw new Error("Render receipt has an invalid font identity.");
    return {
      family: font.family,
      postscriptName: font.postscriptName,
      sha256: font.sha256,
    };
  });
  return canonicalRenderFonts(fonts);
}

function readFontBindings(receipt: {
  fontBindings?: unknown;
}): RenderFontBinding[] {
  if (!Array.isArray(receipt.fontBindings))
    throw new Error(
      "Render receipt has no font usage bindings; render a new preview.",
    );
  return canonicalRenderFontBindings(receipt.fontBindings);
}

function checkCrop(profile: ExportProfile, confirmed: boolean): void {
  if (profile.framing === "crop" && !confirmed)
    throw new Error(
      "Confirm the visible center crop after reviewing Preview Export Frame.",
    );
}

export class ExportProfileService {
  private readonly previews = new Map<string, PreviewEntry>();
  private readonly requests = new Map<
    string,
    { fingerprint: string; promise: Promise<unknown> }
  >();

  constructor(private readonly options: ExportProfileServiceOptions) {}

  async previewFrame(input: {
    compositionId?: string;
    profile: ExportProfile;
    time: number;
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
    signal?: AbortSignal;
  }): Promise<ProfileFramePreview> {
    const profile = profileMode(input.profile, ["mp4", "png"]);
    const snapshot = this.snapshot(input.compositionId);
    const time = this.validateTime(input.time, snapshot.composition, profile);
    const frameIndex = Math.floor(time * profile.frameRate + 1e-9);
    const frameTime = frameIndex / profile.frameRate;
    const token = randomUUID();
    const work = await this.workDirectory(token);
    const videoPath = join(work, "preview.mp4");
    const framePath = await safeProjectCachePath(
      this.options.directory,
      "export-preview",
      `${token}.png`,
    );
    const receiptPath = await this.previewReceiptPath(token);
    await chmod(dirname(framePath), 0o700);
    let retainWork = false;
    try {
      const renderReceipt = await this.renderFrameSource(
        snapshot.composition.id,
        videoPath,
        profile,
        input.signal,
        {
          lookOverride: input.lookOverride,
          captionTrackId: input.captionTrackId,
        },
        this.renderSnapshot(snapshot),
      );
      const previewSources = readSources(renderReceipt);
      this.assertSourceCoverage(
        previewSources,
        this.visualAssets(snapshot.composition, snapshot.assets),
      );
      const sourceReceipts = await this.currentSourceReceipts(
        previewSources,
        snapshot.assets,
        input.signal,
      );
      await this.extractFrame(videoPath, framePath, frameIndex, input.signal);
      await chmod(framePath, 0o600);
      this.assertCurrent(snapshot);
      const warnings = [
        ...new Set([
          ...(renderReceipt.warnings ?? []),
          "PNG previews are opaque; transparent/alpha export is unsupported.",
        ]),
      ];
      const entry: PreviewEntry = {
        path: framePath,
        projectId: snapshot.project.id,
        revision: snapshot.revision,
        compositionId: snapshot.composition.id,
        profile,
        frameIndex,
        renderSelection: renderSelection(input),
        outputSha256: await hashFile(framePath, input.signal),
        sources: sourceReceipts,
        fonts: readFonts(renderReceipt),
        fontBindings: readFontBindings(renderReceipt),
        expiresAt: Date.now() + PREVIEW_LIFETIME_MS,
      };
      const { path: _path, ...receipt } = entry;
      await this.writeReceipt(receiptPath, { version: 1, ...receipt });
      this.previews.set(token, entry);
      await this.trimPreviews();
      return {
        token,
        url: `/api/export/frame-preview/${token}`,
        time: frameTime,
        frameIndex,
        width: profile.width,
        height: profile.height,
        profile,
        warnings,
      };
    } catch (error) {
      retainWork = error instanceof RenderPublicationRecoveryError;
      throw error;
    } finally {
      if (!retainWork) await rm(work, { recursive: true, force: true });
      if (!this.previews.has(token)) {
        await rm(framePath, { force: true });
        await rm(receiptPath, { force: true });
      }
    }
  }

  async previewPath(token: string): Promise<string> {
    const entry = await this.previewEntry(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.previews.delete(token);
      if (entry) await this.removePreview(token, entry.path);
      throw new Error("Export frame preview expired; render a new preview.");
    }
    const project = this.options.getProject();
    if (project.id !== entry.projectId || digest(project) !== entry.revision) {
      this.previews.delete(token);
      await this.removePreview(token, entry.path);
      throw new Error("Export frame preview is stale; render a new preview.");
    }
    try {
      const composition = this.options.getComposition(entry.compositionId);
      const assets = this.visualAssets(
        composition,
        this.options.getAssets(composition),
      );
      this.assertSourceCoverage(entry.sources, assets);
      await this.verifyManifestSources(
        { compositionId: entry.compositionId, sources: entry.sources },
        assets,
        entry.profile,
      );
    } catch (error) {
      this.previews.delete(token);
      await this.removePreview(token, entry.path);
      throw new Error(
        "Export frame preview source changed; render a new preview.",
        {
          cause: error,
        },
      );
    }
    const info = await lstat(entry.path);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error("Export preview cache entry is not a regular file.");
    await this.verifyOutputHash(entry.path, entry.outputSha256);
    const current = this.options.getProject();
    if (current.id !== entry.projectId || digest(current) !== entry.revision) {
      this.previews.delete(token);
      await this.removePreview(token, entry.path);
      throw new Error("Export frame preview is stale; render a new preview.");
    }
    return entry.path;
  }

  /** A crop approval is valid only for the output choices that were previewed. */
  async assertCropPreview(input: {
    compositionId?: string;
    profile: ExportProfile;
    time?: number;
    confirmCrop?: boolean;
    cropPreviewToken?: string;
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
  }): Promise<RenderSnapshot | undefined> {
    if (input.profile.framing !== "crop") return;
    checkCrop(input.profile, input.confirmCrop === true);
    const invalid = () =>
      new Error(
        "Confirm crop with a reviewed export frame matching the current output settings.",
      );
    if (!input.cropPreviewToken) throw invalid();
    const snapshot = this.snapshot(input.compositionId);
    await this.previewPath(input.cropPreviewToken);
    this.assertCurrent(snapshot);
    const entry = this.previews.get(input.cropPreviewToken);
    if (
      !entry ||
      entry.projectId !== snapshot.project.id ||
      entry.revision !== snapshot.revision
    )
      throw invalid();
    const composition = snapshot.composition;
    const expectedFrame =
      input.time === undefined
        ? undefined
        : Math.floor(
            this.validateTime(input.time, composition, input.profile) *
              input.profile.frameRate +
              1e-9,
          );
    if (
      entry.compositionId !== composition.id ||
      digest({ ...entry.profile, format: "mp4" }) !==
        digest({ ...input.profile, format: "mp4" }) ||
      digest(entry.renderSelection) !== digest(renderSelection(input)) ||
      (expectedFrame !== undefined && expectedFrame !== entry.frameIndex)
    )
      throw invalid();
    return this.renderSnapshot(
      snapshot,
      entry.sources,
      entry.fonts,
      entry.fontBindings,
    );
  }

  private previewReceiptPath(token: string): Promise<string> {
    if (!PREVIEW_TOKEN.test(token))
      throw new Error("Export frame preview expired; render a new preview.");
    return safeProjectCachePath(
      this.options.directory,
      "export-preview",
      `${token}.json`,
    );
  }

  private async previewEntry(token: string): Promise<PreviewEntry | undefined> {
    const cached = this.previews.get(token);
    if (cached) return cached;
    const receiptPath = await this.previewReceiptPath(token);
    try {
      const info = await lstat(receiptPath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 4 * 1024 * 1024
      )
        throw new Error(
          "Export preview receipt must be a bounded regular file.",
        );
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Omit<
        PreviewEntry,
        "path"
      > & { version: number };
      if (
        receipt.version !== 1 ||
        typeof receipt.projectId !== "string" ||
        typeof receipt.revision !== "string" ||
        typeof receipt.compositionId !== "string" ||
        !Number.isSafeInteger(receipt.frameIndex) ||
        receipt.frameIndex < 0 ||
        !Number.isFinite(receipt.expiresAt) ||
        !receipt.renderSelection ||
        typeof receipt.outputSha256 !== "string"
      )
        throw new Error(
          "Export preview receipt is invalid; render a new preview.",
        );
      const entry: PreviewEntry = {
        ...receipt,
        fonts: readFonts(receipt),
        fontBindings: readFontBindings(receipt),
        profile: profileMode(receipt.profile, ["mp4", "png"]),
        path: await safeProjectCachePath(
          this.options.directory,
          "export-preview",
          `${token}.png`,
        ),
      };
      this.previews.set(token, entry);
      return entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async removePreview(token: string, path: string): Promise<void> {
    await rm(path, { force: true });
    await rm(await this.previewReceiptPath(token), { force: true });
  }

  async exportStill(input: {
    compositionId?: string;
    profile: ExportProfile;
    time: number;
    requestId: string;
    confirmCrop?: boolean;
    cropPreviewToken?: string;
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
    signal?: AbortSignal;
  }): Promise<ProfileExportArtifact> {
    const profile = profileMode(input.profile, ["png"]);
    const requestId = safeRequestId(input.requestId);
    const snapshot = this.snapshot(input.compositionId);
    const approved = await this.assertCropPreview(input);
    approved?.assertCurrent();
    this.assertCurrent(snapshot);
    const time = this.validateTime(input.time, snapshot.composition, profile);
    const frameIndex = Math.floor(time * profile.frameRate + 1e-9);
    const frameTime = frameIndex / profile.frameRate;
    const fingerprint = digest({
      projectRevision: snapshot.revision,
      compositionId: snapshot.composition.id,
      profile,
      frameIndex,
      renderSelection: renderSelection(input),
      ...(approved
        ? { fonts: approved.fonts, fontBindings: approved.fontBindings }
        : {}),
    });
    return this.runRequest(
      `png:${requestId}`,
      fingerprint,
      () =>
        this.exportStillOnce(
          snapshot,
          profile,
          requestId,
          frameIndex,
          frameTime,
          fingerprint,
          {
            lookOverride: input.lookOverride,
            captionTrackId: input.captionTrackId,
          },
          renderSelection(input),
          approved,
          input.signal,
        ),
      input.signal,
    );
  }

  private async exportStillOnce(
    snapshot: ReturnType<ExportProfileService["snapshot"]>,
    profile: ExportProfile,
    requestId: string,
    frameIndex: number,
    frameTime: number,
    fingerprint: string,
    selection: {
      lookOverride?: FilmLook | null;
      captionTrackId?: string | null;
    },
    receiptSelection: Record<string, unknown>,
    approved?: RenderSnapshot,
    signal?: AbortSignal,
  ): Promise<ProfileExportArtifact> {
    const directory = await this.exportDirectory();
    const path = join(directory, `still-${requestId}.png`);
    const manifestPath = `${path}.manifest.json`;
    const existing = await this.existing(
      path,
      manifestPath,
      requestId,
      fingerprint,
      snapshot.assets,
      profile,
      signal,
    );
    if (existing) return existing as ProfileExportArtifact;
    const work = await this.workDirectory(randomUUID());
    const videoPath = join(work, "render.mp4");
    const stagedPng = join(work, "still.png");
    const stagedManifest = join(work, "manifest.json");
    let retainWork = false;
    try {
      const renderReceipt = await this.renderFrameSource(
        snapshot.composition.id,
        videoPath,
        profile,
        signal,
        selection,
        approved,
      );
      await this.extractFrame(videoPath, stagedPng, frameIndex, signal);
      await this.assertPngDimensions(
        stagedPng,
        profile.width,
        profile.height,
        signal,
      );
      this.assertCurrent(snapshot);
      const warnings = [
        ...new Set([
          ...(renderReceipt.warnings ?? []),
          "PNG stills are opaque; transparent/alpha export is unsupported.",
        ]),
      ];
      const outputSha256 = await hashFile(stagedPng, signal);
      const renderSources = readSources(renderReceipt);
      this.assertSourceCoverage(
        renderSources,
        this.visualAssets(snapshot.composition, snapshot.assets),
      );
      const sourceGuards: Array<() => void> = [];
      const sourceReceipts = await this.currentSourceReceipts(
        renderSources,
        snapshot.assets,
        signal,
        sourceGuards,
      );
      await this.writeReceipt(stagedManifest, {
        version: 1,
        createdAt: new Date().toISOString(),
        requestId,
        fingerprint,
        project: {
          id: snapshot.project.id,
          schemaVersion: snapshot.project.schemaVersion,
          revision: snapshot.revision,
        },
        compositionId: snapshot.composition.id,
        compositionSha256: digest(snapshot.composition),
        profile,
        renderSelection: receiptSelection,
        frame: { time: frameTime, index: frameIndex },
        output: {
          format: "png",
          width: profile.width,
          height: profile.height,
          alpha: false,
          sha256: outputSha256,
        },
        sources: sourceReceipts,
        fonts: readFonts(renderReceipt),
        fontBindings: readFontBindings(renderReceipt),
        warnings,
      });
      this.assertCurrent(snapshot);
      await chmod(stagedPng, 0o600);
      const winner = await this.existing(
        path,
        manifestPath,
        requestId,
        fingerprint,
        snapshot.assets,
        profile,
        signal,
      );
      if (winner) return winner as ProfileExportArtifact;
      await publishRenderPair(stagedPng, stagedManifest, path, work, {
        assertCurrent: () =>
          this.assertPublicationCurrent(snapshot, sourceGuards, signal),
      });
      return {
        path,
        filename: basename(path),
        profile,
        warnings,
        requestId,
        time: frameTime,
        frameIndex,
      };
    } catch (error) {
      retainWork = error instanceof RenderPublicationRecoveryError;
      throw error;
    } finally {
      if (!retainWork) await rm(work, { recursive: true, force: true });
    }
  }

  async exportAudio(input: {
    compositionId?: string;
    profile: ExportProfile;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<AudioProfileExport> {
    const profile = profileMode(input.profile, ["wav", "audio-stems"]);
    const requestId = safeRequestId(input.requestId);
    const snapshot = this.snapshot(input.compositionId);
    const fingerprint = digest({
      projectRevision: snapshot.revision,
      compositionId: snapshot.composition.id,
      profile,
    });
    return this.runRequest(
      `${profile.format}:${requestId}`,
      fingerprint,
      () =>
        profile.format === "wav"
          ? this.exportMix(
              snapshot,
              profile,
              requestId,
              fingerprint,
              input.signal,
            )
          : this.exportStems(
              snapshot,
              profile,
              requestId,
              fingerprint,
              input.signal,
            ),
      input.signal,
    );
  }

  private runRequest<T>(
    key: string,
    fingerprint: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const pending = this.requests.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint)
        throw new Error(
          "Export requestId is already running for different project content or settings.",
        );
      return pending.promise as Promise<T>;
    }
    const promise = Promise.resolve().then(() =>
      this.withRequestLock(key, fingerprint, action, signal),
    );
    const entry = { fingerprint, promise };
    this.requests.set(key, entry);
    void promise
      .finally(() => {
        if (this.requests.get(key) === entry) this.requests.delete(key);
      })
      .catch(() => {});
    return promise;
  }

  private async withRequestLock<T>(
    key: string,
    fingerprint: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    checkAbort(signal);
    const path = await safeProjectCachePath(
      this.options.directory,
      "export-requests",
      `${key.replace(":", "-")}.lock`,
    );
    await chmod(dirname(path), 0o700);
    const release = acquireExportRequestLock(path, fingerprint);
    try {
      checkAbort(signal);
      return await action();
    } finally {
      release();
    }
  }

  private snapshot(compositionId?: string) {
    const project = structuredClone(this.options.getProject());
    const composition = structuredClone(
      this.options.getComposition(compositionId),
    );
    const assets = structuredClone(this.options.getAssets(composition));
    return { project, composition, assets, revision: digest(project) };
  }

  private assertCurrent(
    snapshot: ReturnType<ExportProfileService["snapshot"]>,
  ): void {
    const current = this.options.getProject();
    if (
      current.id !== snapshot.project.id ||
      digest(current) !== snapshot.revision
    )
      throw new Error(
        "Project or Composition changed during profile export; retry from the current revision.",
      );
    const assets = this.options.getAssets(
      this.options.getComposition(snapshot.composition.id),
    );
    if (digest(assets) !== digest(snapshot.assets))
      throw new Error(
        "Render source metadata changed during profile export; review a new export frame.",
      );
  }

  private renderSnapshot(
    snapshot: ReturnType<ExportProfileService["snapshot"]>,
    sources?: RenderSnapshot["sources"],
    fonts?: RenderSnapshot["fonts"],
    fontBindings?: RenderSnapshot["fontBindings"],
  ): RenderSnapshot {
    return {
      compositionSha256: digest(snapshot.composition),
      settingsSha256: digest(snapshot.project.settings),
      assetsSha256: digest(snapshot.assets),
      sources: sources && structuredClone(sources),
      fonts: fonts && structuredClone(fonts),
      fontBindings: fontBindings && structuredClone(fontBindings),
      sourceScope: "visual",
      assertCurrent: () => this.assertCurrent(snapshot),
    };
  }

  private assertPublicationCurrent(
    snapshot: ReturnType<ExportProfileService["snapshot"]>,
    sourceGuards: ReadonlyArray<() => void>,
    signal?: AbortSignal,
  ): void {
    checkAbort(signal);
    this.assertCurrent(snapshot);
    for (const guard of sourceGuards) guard();
    checkAbort(signal);
  }

  private validateTime(
    time: number,
    composition: Composition,
    profile: ExportProfile,
  ): number {
    if (!Number.isFinite(time) || time < 0 || time >= composition.duration)
      throw new Error(
        "Export frame time must be within the saved Composition.",
      );
    const frameIndex = Math.floor(time * profile.frameRate + 1e-9);
    const frameCount = Math.round(
      frameAlignedDuration(composition.duration, profile.frameRate) *
        profile.frameRate,
    );
    if (frameIndex >= frameCount)
      throw new Error(
        "Export frame time resolves beyond the final output frame.",
      );
    return time;
  }

  private async renderFrameSource(
    compositionId: string,
    outputPath: string,
    profile: ExportProfile,
    signal?: AbortSignal,
    selection: {
      lookOverride?: FilmLook | null;
      captionTrackId?: string | null;
    } = {},
    snapshot?: RenderSnapshot,
  ): Promise<RenderReceipt> {
    const renderProfile: ExportProfile = {
      ...profile,
      format: "mp4",
      quality: profile.quality,
    };
    await this.options.render(compositionId, outputPath, {
      signal,
      videoOnly: true,
      quality: profile.quality,
      exportProfile: renderProfile,
      snapshot,
      ...(selection.lookOverride === undefined
        ? {}
        : { lookOverride: selection.lookOverride }),
      ...(selection.captionTrackId === undefined
        ? {}
        : { captionTrackId: selection.captionTrackId }),
    });
    return JSON.parse(
      await readFile(`${outputPath}.manifest.json`, "utf8"),
    ) as RenderReceipt;
  }

  private async extractFrame(
    videoPath: string,
    outputPath: string,
    frameIndex: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        videoPath,
        "-vf",
        `select=eq(n\\,${frameIndex})`,
        "-fps_mode",
        "passthrough",
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-y",
        outputPath,
      ],
      { signal, timeoutMs: 1800000 },
    );
    const info = await lstat(outputPath);
    if (info.isSymbolicLink() || !info.isFile() || info.size < 32)
      throw new Error("FFmpeg did not produce a valid PNG export frame.");
  }

  private async assertPngDimensions(
    path: string,
    width: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height",
        "-of",
        "json",
        path,
      ],
      { signal, timeoutMs: 15000 },
    );
    const stream = (
      JSON.parse(result.stdout.toString("utf8")) as {
        streams?: Array<{
          codec_name?: string;
          width?: number;
          height?: number;
        }>;
      }
    ).streams?.[0];
    if (
      stream?.codec_name !== "png" ||
      stream.width !== width ||
      stream.height !== height
    )
      throw new Error(
        "Still export dimensions do not match the selected profile.",
      );
  }

  private async exportMix(
    snapshot: ReturnType<ExportProfileService["snapshot"]>,
    profile: ExportProfile,
    requestId: string,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<AudioProfileExport> {
    const directory = await this.exportDirectory();
    const path = join(directory, `mix-${requestId}.wav`);
    const manifestPath = `${path}.manifest.json`;
    const existing = await this.existing(
      path,
      manifestPath,
      requestId,
      fingerprint,
      snapshot.assets,
      profile,
      signal,
    );
    if (existing) return existing as AudioProfileExport;
    const work = await this.workDirectory(randomUUID());
    const stagedWav = join(work, "mix.wav");
    const stagedRenderManifest = `${stagedWav}.manifest.json`;
    const stagedManifest = join(work, "manifest.json");
    let retainWork = false;
    try {
      await this.options.render(snapshot.composition.id, stagedWav, {
        signal,
        audioOnly: true,
        exportProfile: profile,
      });
      this.assertCurrent(snapshot);
      const renderReceipt = JSON.parse(
        await readFile(stagedRenderManifest, "utf8"),
      ) as RenderReceipt;
      const audio = await this.inspectWav(stagedWav, signal);
      const fileHash = await hashFile(stagedWav, signal);
      const renderSources = readSources(renderReceipt);
      this.assertSourceCoverage(
        renderSources,
        this.audioAssets(snapshot.composition, snapshot.assets),
      );
      const sourceGuards: Array<() => void> = [];
      const sources = await this.currentSourceReceipts(
        renderSources,
        snapshot.assets,
        signal,
        sourceGuards,
      );
      const warnings = [...new Set(renderReceipt.warnings ?? [])];
      await this.writeReceipt(stagedManifest, {
        version: 1,
        createdAt: new Date().toISOString(),
        requestId,
        fingerprint,
        project: {
          id: snapshot.project.id,
          schemaVersion: snapshot.project.schemaVersion,
          revision: snapshot.revision,
        },
        compositionId: snapshot.composition.id,
        compositionSha256: digest(snapshot.composition),
        profile,
        output: {
          format: "wav",
          codec: "pcm_s24le",
          ...audio,
          sha256: fileHash,
        },
        sources,
        warnings,
      });
      this.assertCurrent(snapshot);
      await chmod(stagedWav, 0o600);
      const winner = await this.existing(
        path,
        manifestPath,
        requestId,
        fingerprint,
        snapshot.assets,
        profile,
        signal,
      );
      if (winner) return winner as AudioProfileExport;
      await publishRenderPair(stagedWav, stagedManifest, path, work, {
        assertCurrent: () =>
          this.assertPublicationCurrent(snapshot, sourceGuards, signal),
      });
      return {
        requestId,
        profile,
        files: [
          {
            role: "mix",
            path,
            filename: basename(path),
            sha256: fileHash,
            ...audio,
          },
        ],
        manifestPath,
        warnings,
      };
    } catch (error) {
      retainWork = error instanceof RenderPublicationRecoveryError;
      throw error;
    } finally {
      if (!retainWork) await rm(work, { recursive: true, force: true });
    }
  }

  private async exportStems(
    snapshot: ReturnType<ExportProfileService["snapshot"]>,
    profile: ExportProfile,
    requestId: string,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<AudioProfileExport> {
    const roles = this.availableRoles(snapshot.composition, snapshot.assets);
    const warnings: string[] = [];
    if (!roles.length)
      warnings.push(
        "No dialogue, narration, music or ambience audio roles apply to this Composition; no stem files were created.",
      );
    const directory = await this.exportDirectory();
    const target = join(directory, `stems-${requestId}`);
    const existing = await this.existingDirectory(
      target,
      requestId,
      fingerprint,
      snapshot.assets,
      profile,
      signal,
    );
    if (existing) return existing as AudioProfileExport;
    const work = await this.workDirectory(randomUUID());
    const staging = join(directory, `.stems-${requestId}-${randomUUID()}.tmp`);
    await mkdir(staging, { mode: 0o700 });
    let retainWork = false;
    try {
      const files: AudioExportFile[] = [];
      const sourceSets: RenderReceipt["sources"] = [];
      for (const role of roles) {
        const stagedWav = join(work, `${role}.wav`);
        const renderProfile = { ...profile, format: "audio-stems" as const };
        await this.options.render(snapshot.composition.id, stagedWav, {
          signal,
          audioOnly: true,
          audioRole: role,
          exportProfile: renderProfile,
        });
        await chmod(stagedWav, 0o600);
        await chmod(`${stagedWav}.manifest.json`, 0o600);
        this.assertCurrent(snapshot);
        const receipt = JSON.parse(
          await readFile(`${stagedWav}.manifest.json`, "utf8"),
        ) as RenderReceipt;
        warnings.push(...(receipt.warnings ?? []));
        sourceSets.push(...readSources(receipt));
        const audio = await this.inspectWav(stagedWav, signal);
        const sha256 = await hashFile(stagedWav, signal);
        const name = `${role}.wav`;
        await copyFile(stagedWav, join(staging, name));
        await chmod(join(staging, name), 0o600);
        files.push({
          role,
          path: join(target, name),
          filename: name,
          sha256,
          ...audio,
        });
      }
      const audioReference = files[0]!;
      if (
        files.some(
          (file) =>
            file.sampleRate !== audioReference.sampleRate ||
            file.channels !== audioReference.channels ||
            file.sampleCount !== audioReference.sampleCount,
        )
      )
        throw new Error(
          "Audio stems must have identical sample rates, channels and sample counts.",
        );
      const sourcesById = new Map<
        string,
        NonNullable<RenderReceipt["sources"]>[number]
      >();
      for (const source of sourceSets) {
        const previous = sourcesById.get(source.assetId);
        if (
          previous &&
          (previous.sha256 !== source.sha256 || previous.size !== source.size)
        )
          throw new Error(
            `Source changed between audio stem renders: ${source.name}`,
          );
        sourcesById.set(source.assetId, source);
      }
      const uniqueSources = [...sourcesById.values()];
      this.assertSourceCoverage(
        uniqueSources,
        this.audioAssets(snapshot.composition, snapshot.assets),
      );
      const sourceGuards: Array<() => void> = [];
      const sourceReceipts = await this.currentSourceReceipts(
        uniqueSources,
        snapshot.assets,
        signal,
        sourceGuards,
      );
      const manifestPath = join(staging, "manifest.json");
      await this.writeReceipt(manifestPath, {
        version: 1,
        createdAt: new Date().toISOString(),
        requestId,
        fingerprint,
        project: {
          id: snapshot.project.id,
          schemaVersion: snapshot.project.schemaVersion,
          revision: snapshot.revision,
        },
        compositionId: snapshot.composition.id,
        compositionSha256: digest(snapshot.composition),
        profile,
        outputs: files.map(
          ({
            role,
            filename,
            sha256,
            sampleRate,
            channels,
            sampleCount,
            duration,
          }) => ({
            role,
            filename,
            sha256,
            sampleRate,
            channels,
            sampleCount,
            duration,
          }),
        ),
        sources: sourceReceipts,
        warnings: [...new Set(warnings)],
      });
      await copyFile(
        manifestPath,
        join(work, "manifest.json"),
        constants.COPYFILE_EXCL,
      );
      try {
        await publishDirectory({
          staging,
          destination: target,
          signal,
          assertCurrent: () =>
            this.assertPublicationCurrent(snapshot, sourceGuards, signal),
        });
      } catch (error) {
        if (error instanceof DirectoryPublicationRecoveryError)
          throw new RenderPublicationRecoveryError(
            work,
            [staging, target],
            error,
          );
        if (directoryPublicationUnavailable(error))
          throw new ApplicationError(
            "export.stemsUnavailable",
            "Stem directory publication is unavailable here. Choose a WAV mix or another disk.",
            422,
          );
        if (
          ["EEXIST", "ENOTEMPTY"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        ) {
          const prior = await this.existingDirectory(
            target,
            requestId,
            fingerprint,
            snapshot.assets,
            profile,
            signal,
          );
          if (prior) return prior as AudioProfileExport;
        }
        throw error;
      }
      const published = files.map((file) => ({
        ...file,
        path: join(target, file.filename),
      }));
      return {
        requestId,
        profile,
        files: published,
        manifestPath: join(target, "manifest.json"),
        warnings: [...new Set(warnings)],
      };
    } catch (error) {
      retainWork = error instanceof RenderPublicationRecoveryError;
      throw error;
    } finally {
      if (!retainWork) {
        await rm(work, { recursive: true, force: true });
        await rm(staging, { recursive: true, force: true });
      }
    }
  }

  private availableRoles(
    composition: Composition,
    assets: MediaAsset[],
  ): AudioAutomation["role"][] {
    return STEM_ROLES.filter(
      (role) => audioSourceAssetIds(composition, assets, role).size > 0,
    );
  }

  private async inspectWav(path: string, signal?: AbortSignal) {
    const result = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,duration_ts,time_base,duration",
        "-of",
        "json",
        path,
      ],
      { signal },
    );
    const payload = JSON.parse(result.stdout.toString("utf8")) as {
      streams?: Array<{
        codec_name?: string;
        sample_rate?: string;
        channels?: number;
        duration_ts?: string;
        time_base?: string;
        duration?: string;
      }>;
    };
    const audio = payload.streams?.[0];
    const sampleRate = Number(audio?.sample_rate);
    const channels = Number(audio?.channels);
    const durationTs = Number(audio?.duration_ts);
    const timeBase = audio?.time_base?.split("/").map(Number);
    if (
      audio?.codec_name !== "pcm_s24le" ||
      sampleRate !== 48000 ||
      !Number.isInteger(channels) ||
      !Number.isFinite(durationTs) ||
      !timeBase?.[0] ||
      !timeBase[1]
    )
      throw new Error(
        "WAV export must contain decodable 48 kHz 24-bit PCM audio.",
      );
    const duration = (durationTs * timeBase[0]!) / timeBase[1]!;
    const sampleCount = Math.round(duration * sampleRate);
    return { sampleRate, channels, sampleCount, duration };
  }

  private async currentSourceReceipts(
    sources: NonNullable<RenderReceipt["sources"]>,
    assets: MediaAsset[],
    signal?: AbortSignal,
    guards?: Array<() => void>,
  ) {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const result: Array<{
      assetId: string;
      name: string;
      sha256: string;
      size: number;
    }> = [];
    for (const source of sources) {
      const asset = byId.get(source.assetId);
      if (!asset)
        throw new Error(
          "An exported source is no longer in the current Composition.",
        );
      const before = await stat(localPath(asset.uri));
      const sha256 = await hashFile(localPath(asset.uri), signal);
      const after = await stat(localPath(asset.uri));
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        sha256 !== source.sha256
      )
        throw new Error(`Source changed during export: ${source.name}`);
      guards?.push(() => {
        const current = statSync(localPath(asset.uri));
        if (current.size !== after.size || current.mtimeMs !== after.mtimeMs)
          throw new Error(`Source changed during export: ${source.name}`);
      });
      result.push({
        assetId: source.assetId,
        name: source.name,
        sha256,
        size: after.size,
      });
    }
    return result;
  }

  private assertSourceCoverage(
    sources: NonNullable<RenderReceipt["sources"]>,
    assets: MediaAsset[],
  ): void {
    const captured = new Set(sources.map((source) => source.assetId));
    if (
      captured.size !== sources.length ||
      captured.size !== assets.length ||
      assets.some((asset) => !captured.has(asset.id))
    )
      throw new Error(
        "Render source receipts do not cover the saved Composition assets.",
      );
  }

  private async exportDirectory(): Promise<string> {
    const root = await realpath(this.options.directory);
    const directory = join(root, "exports");
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(
        "Project exports must be a real directory without symlinks.",
      );
    if ((await realpath(directory)) !== directory)
      throw new Error(
        "Project exports cannot resolve outside the project directory.",
      );
    await chmod(directory, 0o700);
    return directory;
  }

  private async workDirectory(id: string): Promise<string> {
    const marker = await safeProjectCachePath(
      this.options.directory,
      "export-work",
      id,
      "marker.tmp",
    );
    const directory = dirname(marker);
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(
        "Private export staging must remain inside the project cache.",
      );
    await chmod(directory, 0o700);
    return directory;
  }

  private async verifyManifestSources(
    manifest: Record<string, unknown>,
    assets: MediaAsset[],
    profile: ExportProfile,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!Array.isArray(manifest.sources))
      throw new Error("Export manifest has no source identity receipt.");
    const sources = manifest.sources.map((value) => {
      if (!value || typeof value !== "object")
        throw new Error("Export manifest contains an invalid source receipt.");
      const source = value as Record<string, unknown>;
      if (
        typeof source.assetId !== "string" ||
        typeof source.name !== "string" ||
        typeof source.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(source.sha256) ||
        !Number.isSafeInteger(source.size) ||
        Number(source.size) < 0
      )
        throw new Error("Export manifest contains an invalid source identity.");
      return {
        assetId: source.assetId,
        name: source.name,
        sha256: source.sha256,
        size: Number(source.size),
      };
    });
    const expectedAssets =
      profile.format === "wav" || profile.format === "audio-stems"
        ? this.audioAssets(
            this.options.getComposition(manifest.compositionId as string),
            assets,
          )
        : profile.format === "png"
          ? this.visualAssets(
              this.options.getComposition(manifest.compositionId as string),
              assets,
            )
          : assets;
    this.assertSourceCoverage(sources, expectedAssets);
    const current = await this.currentSourceReceipts(
      sources,
      expectedAssets,
      signal,
    );
    if (current.some((source, index) => source.size !== sources[index]!.size))
      throw new Error(
        "A source size no longer matches the saved export receipt.",
      );
  }

  private audioAssets(
    composition: Composition,
    assets: MediaAsset[],
  ): MediaAsset[] {
    const ids = audioSourceAssetIds(composition, assets);
    return assets.filter((asset) => ids.has(asset.id));
  }

  private visualAssets(
    composition: Composition,
    assets: MediaAsset[],
  ): MediaAsset[] {
    const ids = visualSourceAssetIds(composition, assets);
    return assets.filter((asset) => ids.has(asset.id));
  }

  private async verifyOutputHash(
    path: string,
    expected: unknown,
    signal?: AbortSignal,
  ): Promise<string> {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected))
      throw new Error("Export manifest has an invalid output hash.");
    const actual = await hashFile(path, signal);
    if (actual !== expected)
      throw new Error(
        "Existing export output no longer matches its saved hash.",
      );
    return actual;
  }

  private async existing(
    path: string,
    manifestPath: string,
    requestId: string,
    fingerprint: string,
    assets: MediaAsset[],
    expectedProfile: ExportProfile,
    signal?: AbortSignal,
  ): Promise<ProfileExportArtifact | AudioProfileExport | undefined> {
    const outputExists = await this.existsRegular(path);
    const manifestExists = await this.existsRegular(manifestPath);
    if (!outputExists && !manifestExists) return undefined;
    if (!outputExists || !manifestExists)
      throw new Error(
        "An incomplete export already uses this requestId; preserve its recovery files and choose a new requestId.",
      );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      manifest.requestId !== requestId ||
      manifest.fingerprint !== fingerprint
    )
      throw new Error(
        "Export requestId was already used for different project content or settings.",
      );
    const profile = validateExportProfile(manifest.profile);
    if (digest(profile) !== digest(expectedProfile))
      throw new Error(
        "Existing export profile no longer matches its request receipt.",
      );
    await this.verifyManifestSources(manifest, assets, profile, signal);
    const output = manifest.output as Record<string, unknown> | undefined;
    if (!output)
      throw new Error("Export request manifest has no output receipt.");
    const outputSha256 = await this.verifyOutputHash(
      path,
      output.sha256,
      signal,
    );
    if (
      "frame" in manifest &&
      typeof manifest.frame === "object" &&
      manifest.frame
    ) {
      const frame = manifest.frame as { time: number; index: number };
      return {
        path,
        filename: basename(path),
        profile,
        warnings: Array.isArray(manifest.warnings)
          ? (manifest.warnings as string[])
          : [],
        requestId,
        time: frame.time,
        frameIndex: frame.index,
      };
    }
    const audio = await this.inspectWav(path, signal);
    return {
      requestId,
      profile,
      files: [
        {
          role: "mix",
          path,
          filename: basename(path),
          sha256: outputSha256,
          ...audio,
        },
      ],
      manifestPath,
      warnings: Array.isArray(manifest.warnings)
        ? (manifest.warnings as string[])
        : [],
    };
  }

  private async existingDirectory(
    directory: string,
    requestId: string,
    fingerprint: string,
    assets: MediaAsset[],
    expectedProfile: ExportProfile,
    signal?: AbortSignal,
  ): Promise<AudioProfileExport | undefined> {
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("Stem export target must be a regular directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const manifestPath = join(directory, "manifest.json");
    const info = await lstat(manifestPath);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error("Stem export manifest must be a regular file.");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      manifest.requestId !== requestId ||
      manifest.fingerprint !== fingerprint
    )
      throw new Error(
        "Export requestId was already used for different project content or settings.",
      );
    const profile = validateExportProfile(manifest.profile);
    if (digest(profile) !== digest(expectedProfile))
      throw new Error(
        "Existing stem profile no longer matches its request receipt.",
      );
    await this.verifyManifestSources(manifest, assets, profile, signal);
    const outputs = Array.isArray(manifest.outputs)
      ? (manifest.outputs as Array<Record<string, unknown>>)
      : [];
    if (
      !Array.isArray(manifest.outputs) ||
      (!outputs.length &&
        this.availableRoles(
          this.options.getComposition(manifest.compositionId as string),
          assets,
        ).length)
    )
      throw new Error("Stem export receipt contains no audio outputs.");
    const files: AudioExportFile[] = [];
    for (const output of outputs) {
      const name = String(output.filename ?? "");
      if (!/^(narration|music|ambience|dialogue)\.wav$/u.test(name))
        throw new Error(
          "Stem export manifest contains an unsafe output filename.",
        );
      if (output.role !== name.slice(0, -4))
        throw new Error("Stem export receipt does not match its output role.");
      const path = join(directory, name);
      const fileInfo = await lstat(path);
      if (fileInfo.isSymbolicLink() || !fileInfo.isFile())
        throw new Error("Stem output must be a regular file.");
      const sha256 = await this.verifyOutputHash(path, output.sha256, signal);
      const audio = await this.inspectWav(path, signal);
      files.push({
        role: output.role as AudioExportFile["role"],
        path,
        filename: name,
        sha256,
        ...audio,
      });
    }
    return {
      requestId,
      profile,
      files,
      manifestPath,
      warnings: Array.isArray(manifest.warnings)
        ? (manifest.warnings as string[])
        : [],
    };
  }

  private async existsRegular(path: string): Promise<boolean> {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile())
        throw new Error(
          "Export target must be a regular file, not a symlink or directory.",
        );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async writeReceipt(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  }

  private async trimPreviews(): Promise<void> {
    for (const [token, entry] of this.previews) {
      if (entry.expiresAt < Date.now()) {
        this.previews.delete(token);
        await this.removePreview(token, entry.path);
      }
    }
    while (this.previews.size > 12) {
      const token = this.previews.keys().next().value as string | undefined;
      if (!token) return;
      const entry = this.previews.get(token);
      this.previews.delete(token);
      if (entry) await this.removePreview(token, entry.path);
    }
    const probe = await safeProjectCachePath(
      this.options.directory,
      "export-preview",
      "cache-probe",
    );
    const directory = dirname(probe);
    const entries = [];
    const receipts = [];
    for (const name of await readdir(directory)) {
      const match =
        /^([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\.(png|json)$/u.exec(
          name,
        );
      if (!match) continue;
      const path = join(directory, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const entry = { path, modified: info.mtimeMs, token: match[1]! };
      if (match[2] === "png") entries.push(entry);
      else receipts.push(entry);
    }
    const frameTokens = new Set(entries.map((entry) => entry.token));
    for (const receipt of receipts)
      if (!frameTokens.has(receipt.token)) {
        this.previews.delete(receipt.token);
        await rm(receipt.path, { force: true });
      }
    entries.sort((a, b) => b.modified - a.modified);
    for (const [index, entry] of entries.entries()) {
      if (index < 12 && entry.modified >= Date.now() - PREVIEW_LIFETIME_MS)
        continue;
      this.previews.delete(entry.token);
      await this.removePreview(entry.token, entry.path);
    }
  }
}
