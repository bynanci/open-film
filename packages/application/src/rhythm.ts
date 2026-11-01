// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ApplicationError,
  validateRhythmAnalysisEvidence,
  validateRhythmSnapProposal,
  type RhythmAnalysisEvidence,
  type RhythmSnapProposal,
  type RhythmSnapTargetEdge,
  type TimelineRhythmLandmark,
} from "@openfilm/core";
import {
  extractRhythmEvidence,
  localPath,
  withVerifiedSourceFile,
  type RhythmAnalysisOptions,
} from "@openfilm/media";
import {
  buildRhythmSnapProposal,
  projectClipRhythmLandmarks,
} from "@openfilm/solver";
import { TimelineEditor } from "./editor.js";
import type { OpenFilmApplication } from "./index.js";

export interface RhythmSnapOptions {
  targetEdge?: RhythmSnapTargetEdge;
  tolerance?: number;
  bypass?: boolean;
  compositionId?: string;
}

export interface RhythmApplyOptions {
  compositionId?: string;
  editor?: TimelineEditor;
}

export class RhythmService {
  private readonly evidenceCache = new Map<string, RhythmAnalysisEvidence>();
  private readonly proposalCache = new Map<string, RhythmSnapProposal>();
  private saveQueue: Promise<void> = Promise.resolve();
  /** Bumped on every cache mutation; compared with what is known to be on disk. */
  private cacheVersion = 0;
  private persistedVersion = 0;

  constructor(private readonly app: OpenFilmApplication) {}

  private cacheKey(assetId: string, sourceHash: string): string {
    return `${assetId}:${sourceHash.toLowerCase()}`;
  }

  private get evidenceFilePath(): string {
    return join(this.app.directory, "analysis", "rhythm-evidence.json");
  }

  /**
   * Loads persisted rhythm evidence from project disk.
   */
  public async loadPersistedEvidence(): Promise<void> {
    const path = this.evidenceFilePath;
    if (!existsSync(path)) return;
    try {
      const content = await readFile(path, "utf8");
      const raw = JSON.parse(content);
      if (Array.isArray(raw)) {
        for (const item of raw) {
          try {
            const validated = validateRhythmAnalysisEvidence(item);
            const key = this.cacheKey(validated.assetId, validated.sourceHash);
            this.evidenceCache.set(key, validated);
          } catch {
            // ignore corrupted individual cache entry
          }
        }
      }
    } catch {
      // ignore read error
    }
  }

  /**
   * Saves cached rhythm evidence to project disk atomically. Writes run one at
   * a time; a failed write rejects its own caller but never poisons the queue,
   * and the unsaved entries stay pending so any later call flushes them again.
   */
  public savePersistedEvidence(): Promise<void> {
    const run = this.saveQueue.then(() => this.writeEvidenceFile());
    this.saveQueue = run.catch(() => undefined);
    return run;
  }

  private async writeEvidenceFile(): Promise<void> {
    const path = this.evidenceFilePath;
    const dir = join(this.app.directory, "analysis");
    const version = this.cacheVersion;
    const tempPath = join(
      dir,
      `rhythm-evidence.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      await mkdir(dir, { recursive: true });
      const items = Array.from(this.evidenceCache.values());
      await writeFile(tempPath, JSON.stringify(items, null, 2), "utf8");
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    this.persistedVersion = Math.max(this.persistedVersion, version);
  }

  /** Resolves only once every cached entry is durably on disk. */
  private async flushPending(): Promise<void> {
    if (this.persistedVersion < this.cacheVersion)
      await this.savePersistedEvidence();
  }

  /**
   * Stores validated rhythm analysis evidence bound to the asset ID and source hash.
   * The entry is pending until `savePersistedEvidence` succeeds.
   */
  public storeEvidence(evidence: RhythmAnalysisEvidence): void {
    const validated = validateRhythmAnalysisEvidence(evidence);
    const key = this.cacheKey(validated.assetId, validated.sourceHash);
    this.evidenceCache.set(key, validated);
    this.cacheVersion++;
  }

  /**
   * Analyzes an audio asset to extract real rhythm landmarks, BPM and meter,
   * caching and persisting the results. Hash verification and decoding share
   * one private snapshot, so the stored source hash always describes the bytes
   * that were analyzed even if the original file is replaced mid-analysis.
   */
  public async analyzeAsset(
    assetId: string,
    options?: RhythmAnalysisOptions & { force?: boolean },
  ): Promise<RhythmAnalysisEvidence> {
    const asset = this.app.catalog.getAsset(assetId);
    if (!asset) {
      throw new ApplicationError(
        "request.notFound",
        `Asset "${assetId}" was not found.`,
      );
    }

    let sourcePath: string;
    try {
      sourcePath = localPath(asset.uri);
    } catch {
      throw new ApplicationError(
        "media.missing",
        `Source file for asset "${asset.name}" could not be accessed.`,
        404,
        { fileName: asset.name },
      );
    }
    const recorded =
      asset.contentHash && /^[0-9a-f]{64}$/i.test(asset.contentHash)
        ? asset.contentHash.toLowerCase()
        : undefined;

    let evidence: RhythmAnalysisEvidence;
    try {
      evidence = await withVerifiedSourceFile(
        sourcePath,
        recorded,
        async (snapshot, verifiedHash) => {
          if (!options?.force) {
            const cached = this.getEvidence(assetId, verifiedHash);
            if (cached) return cached;
          }
          return extractRhythmEvidence(
            { ...asset, uri: pathToFileURL(snapshot).href },
            verifiedHash,
            options,
          );
        },
        { signal: options?.signal },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
        throw new ApplicationError(
          "media.missing",
          `Source file for asset "${asset.name}" could not be accessed.`,
          404,
          { fileName: asset.name },
        );
      throw error;
    }
    const key = this.cacheKey(evidence.assetId, evidence.sourceHash);
    if (this.evidenceCache.get(key) !== evidence) this.storeEvidence(evidence);
    // Cache hits flush too: an earlier failed write must not read as saved.
    await this.flushPending();
    return evidence;
  }

  /**
   * Retrieves rhythm evidence for an asset. If sourceHash is not provided,
   * checks against the asset's current contentHash.
   */
  public getEvidence(
    assetId: string,
    sourceHash?: string,
  ): RhythmAnalysisEvidence | undefined {
    if (sourceHash) {
      return this.evidenceCache.get(this.cacheKey(assetId, sourceHash));
    }
    const asset = this.app.catalog.getAsset(assetId);
    if (!asset?.contentHash) {
      return undefined;
    }
    return this.evidenceCache.get(this.cacheKey(assetId, asset.contentHash));
  }

  /**
   * Clears evidence cache.
   */
  public async clearEvidence(assetId?: string): Promise<void> {
    if (!assetId) {
      this.evidenceCache.clear();
    } else {
      for (const key of this.evidenceCache.keys()) {
        if (key.startsWith(`${assetId}:`)) {
          this.evidenceCache.delete(key);
        }
      }
    }
    this.cacheVersion++;
    await this.savePersistedEvidence();
  }

  private getComposition(compositionId?: string) {
    const composition = compositionId
      ? (this.app.project.timelines.find((t) => t.id === compositionId) ??
        this.app.project.timelines[0])
      : this.app.project.timelines[0];
    if (!composition) {
      throw new ApplicationError(
        "request.notFound",
        `Timeline '${compositionId ?? "default"}' was not found.`,
      );
    }
    return composition;
  }

  /**
   * Returns projected timeline landmarks for a clip, taking into account
   * trim, speed, and timeline position.
   */
  public getLandmarksForClip(
    clipId: string,
    options?: { compositionId?: string },
  ): readonly TimelineRhythmLandmark[] {
    const composition = this.getComposition(options?.compositionId);
    let targetClip:
      (typeof composition.tracks)[number]["clips"][number] | undefined;
    for (const track of composition.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) {
      throw new ApplicationError(
        "request.notFound",
        `Clip "${clipId}" was not found in composition "${composition.id}".`,
      );
    }

    const asset = this.app.catalog.getAsset(targetClip.assetId);
    if (!asset) {
      throw new ApplicationError(
        "request.notFound",
        `Asset "${targetClip.assetId}" for clip "${clipId}" was not found.`,
      );
    }

    const evidence = this.getEvidence(asset.id, asset.contentHash);
    if (!evidence) {
      return [];
    }

    return projectClipRhythmLandmarks(targetClip, asset, evidence);
  }

  /**
   * Generates an explicit bounded solver snap proposal.
   */
  public proposeSnap(
    clipId: string,
    requestedTime: number,
    options?: RhythmSnapOptions,
  ): RhythmSnapProposal {
    const composition = this.getComposition(options?.compositionId);
    let targetClip:
      (typeof composition.tracks)[number]["clips"][number] | undefined;
    for (const track of composition.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) {
      throw new ApplicationError(
        "request.notFound",
        `Clip "${clipId}" was not found in composition "${composition.id}".`,
      );
    }

    const asset = this.app.catalog.getAsset(targetClip.assetId);
    if (!asset) {
      throw new ApplicationError(
        "request.notFound",
        `Asset "${targetClip.assetId}" for clip "${clipId}" was not found.`,
      );
    }

    const evidence = this.getEvidence(asset.id, asset.contentHash);
    if (!evidence) {
      throw new ApplicationError(
        "rhythm.invalidEvidence",
        `No valid rhythm analysis evidence found for asset "${asset.id}".`,
      );
    }

    const proposal = buildRhythmSnapProposal({
      composition,
      clipId,
      asset,
      evidence,
      targetEdge: options?.targetEdge,
      requestedTime,
      tolerance: options?.tolerance,
      bypass: options?.bypass,
    });

    this.proposalCache.set(proposal.id, proposal);
    return proposal;
  }

  /**
   * Explicitly accepts and applies a rhythm snap proposal through TimelineEditor,
   * creating a single undoable history step.
   */
  public async applySnap(
    proposalOrId: RhythmSnapProposal | string,
    options?: RhythmApplyOptions,
  ): Promise<RhythmSnapProposal> {
    const proposal =
      typeof proposalOrId === "string"
        ? this.proposalCache.get(proposalOrId)
        : validateRhythmSnapProposal(proposalOrId);

    if (!proposal) {
      throw new ApplicationError(
        "rhythm.invalidProposal",
        `Proposal "${typeof proposalOrId === "string" ? proposalOrId : "unknown"}" was not found.`,
      );
    }

    const editor = options?.editor ?? new TimelineEditor(this.app);
    const targetCompId = options?.compositionId ?? proposal.compositionId;
    const state = editor.get(targetCompId);

    await editor.edit(targetCompId, {
      baseRevision: state.revision,
      commands: [
        {
          type: "rhythm.snap",
          proposal,
        },
      ],
    });

    this.proposalCache.delete(proposal.id);
    return proposal;
  }
}
