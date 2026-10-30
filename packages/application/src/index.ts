import { MotionGenerationService } from "./motion-generation.js";
export * from "./motion-generation.js";
import { SourceDraftService } from "./source-draft.js";
export * from "./source-draft.js";
import { SourceDiscoveryService } from "./source-discovery.js";
export * from "./source-discovery.js";
import { SourceBatchService } from "./source-batches.js";
export * from "./source-batches.js";
import { SourceAnalysisService } from "./source-analysis.js";
export * from "./source-analysis.js";
import { SourceAnalysisReviewService } from "./source-analysis-review.js";
export * from "./source-analysis-review.js";
export * from "./travel-evidence.js";
import { ProxyCacheService } from "./proxy-cache.js";
export * from "./proxy-cache.js";

import { NleHandoffService, type HandoffRequest } from "./nle-handoff.js";
import type { HandoffOptions } from "@openfilm/exporters";
import { AudioGenerationService } from "./audio-generation.js";
import type {
  AudioGenerationProvider,
  MotionGenerationProvider,
  VisionSampleProvider,
} from "@openfilm/plugin-sdk";
export * from "./audio-generation.js";
import { AudioQualityService } from "./audio-quality.js";
export * from "./audio-quality.js";
import { StoryGraphService } from "./story-graph.js";
export * from "./story-graph.js";
import { StoryPlanService } from "./story-plan.js";
export * from "./story-plan.js";
import { PipelineService } from "./pipeline-orchestrator.js";
export * from "./pipeline-orchestrator.js";
import { CreativeVariantService } from "./creative-variants.js";
export * from "./creative-variants.js";
// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
  graphicSceneAssetIds,
  createProject,
  resolveProjectTimebase,
  projectSettingsWithTimebase,
  ApplicationError,
  errorInfo,
  migrateProject,
  validateProject,
  validateFilmLook,
  validateExportProfile,
  type Composition,
  type Event,
  type Job,
  type MediaAsset,
  type OpenFilmProject,
  type SimilarityGroup,
  type Story,
  type FilmSettings,
  type FilmLook,
  type ProjectContentLocale,
  type ProjectTimebaseV1,
  type TitleStyle,
  type ExportProfile,
  type AudioAutomation,
} from "@openfilm/core";
import { GraphicSceneService } from "./graphic-scenes.js";
import { TimelineEditor } from "./editor.js";
export {
  GraphicSceneService,
  type GraphicFrameInput,
} from "./graphic-scenes.js";
import { ProjectCatalog } from "@openfilm/catalog";
import { clusterEvents, findDuplicates } from "@openfilm/events";
import {
  createStory,
  createStoryArc,
  storyArcBeatText,
  STORY_ARC_IDS,
  resolveFilmSettings,
  localizeProjectContent,
  scoreAsset,
} from "@openfilm/story";
import { compose as solve } from "@openfilm/solver";
import { exportTimeline, otioCompatibilityReport } from "@openfilm/exporters";
import { proposalTemplate } from "@openfilm/template-proposal";
import {
  FFmpegRenderer,
  audioSourceAssetIds,
  visualSourceAssetIds,
  createTitleOverlay,
  resolveTitleFont,
  titleOverlayCacheKey,
  resolveRenderQuality,
  type RenderQuality,
  type RenderOptions,
} from "@openfilm/render";
export { resolveRenderQuality, type RenderQuality } from "@openfilm/render";
import { enrichPixelAsset, inspectPixelDng } from "@openfilm/source-pixel";
import {
  enrichInsta360Asset,
  Insta360ImportContext,
  inspectInsta360Raw,
  isInsta360Raw,
} from "@openfilm/source-insta360";
import {
  checkAbort,
  createThumbnail,
  FilesystemSource,
  hashFile,
  inspectMedia,
  isSupportedMediaFile,
  localPath,
  perceptualHash,
  safeProjectCachePath,
  referenceFor,
  sourceStatus,
  previewIssue,
  previewVideoFilters,
  type MediaCandidate,
} from "@openfilm/media";
import { portableCacheUri } from "./portable-cache.js";
import { ProjectVersionService } from "./project-versions.js";
import {
  CollectMediaService,
  collectFontPathForStyle,
  loadCollectedFontBindings,
} from "./collect-media.js";
export {
  CollectMediaService,
  CollectMediaError,
  type CollectMediaCreateInput,
  type CollectMediaCreateResult,
  type CollectMediaPlan,
  type CollectCoveragePlanInput,
  type CollectCoverageReview,
  type CollectPlanInput,
  type CollectMediaPlanItem,
  type CollectMediaScope,
  type CollectMediaVerifyResult,
  type CollectRightsDeclaration,
  type CollectRightsBasis,
} from "./collect-media.js";

import { ExportProfileService } from "./export-profiles.js";
export {
  ExportProfileService,
  type ProfileFramePreview,
  type ProfileExportArtifact,
  type AudioExportFile,
  type AudioProfileExport,
} from "./export-profiles.js";
import { isInside, managedSourceUri } from "./path-safety.js";
import {
  MediaIntelligence,
  type IntelligenceOptions,
  type AnalysisRecoveryInput,
} from "./intelligence.js";
import { TranscriptEditor } from "./transcript-editor.js";
import { CaptionService } from "./captions.js";
import {
  KnowledgeService,
  type KnowledgeOptions,
  type ReviewOptions,
} from "./knowledge.js";
import {
  SceneScriptReviewService,
  savedScriptProjectIdentity,
  type SceneScriptReviewOptions,
} from "./scene-script-review.js";
import {
  VisualQaService,
  type VisualQaOptions,
  type VisualQaReport,
} from "./visual-qa.js";
export {
  MediaIntelligence,
  type IntelligenceOptions,
  type AnalysisRecoveryState,
  type AnalysisRecoveryInput,
} from "./intelligence.js";
export { TranscriptEditor } from "./transcript-editor.js";
export { CaptionService } from "./captions.js";
export type {
  CaptionPrepareInput,
  CaptionSnapshotSource,
  CaptionPageOptions,
  CaptionSnapshotPage,
  CaptionPublication,
} from "./captions.js";
export {
  KnowledgeService,
  type KnowledgeOptions,
  type ReviewOptions,
} from "./knowledge.js";
export { GlobalGlossaryStore } from "./global-glossary.js";
export {
  SceneScriptReviewService,
  type SceneScriptReviewOptions,
} from "./scene-script-review.js";
export {
  type VisualQaIssue,
  type VisualQaIssueCode,
  type VisualQaIssueSeverity,
  type VisualQaOptions,
  type VisualQaReport,
  type VisualQaSample,
} from "./visual-qa.js";
export { resolveUserDataDirectory } from "./user-data.js";
export {
  ProjectVersionService,
  ProjectVersionError,
  type ProjectVersionCreateInput,
  type ProjectVersionRestoreInput,
  type ProjectVersionRestoreResult,
} from "./project-versions.js";
export {
  createReviewOwner,
  ownsReviewOwner,
  reviewOwnerState,
} from "./review-owner.js";
import {
  previewScenePlan,
  acceptScenePlan,
  type ScenePlan,
  type ScenePlanOptions,
  type ScenePlanAcceptance,
} from "./scene-plan.js";
export type {
  ScenePlan,
  ScenePlanOptions,
  ScenePlanAcceptance,
} from "./scene-plan.js";
export type OpenFilmRuntimeOptions = KnowledgeOptions & {
  /** Trusted host-only media boundary; project/HTTP data cannot supply code. */
  proxyGenerator?: typeof import("@openfilm/media").createProxy;
  audioGenerationProvider?: AudioGenerationProvider;
  motionGenerationProvider?: MotionGenerationProvider;
  motionGenerationTimeoutMs?: number;
  /** Optional sample-only providers. Remote use still requires per-project explicit consent. */
  visionSampleProviders?: VisionSampleProvider[];
};

export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (job: Job) => void;
  proxies?: boolean;
  jobId?: string;
}
/** MP4/preview policy is a render snapshot, never a saved composition edit. */
export interface FilmRenderOptions {
  signal?: AbortSignal;
  /** Internal bound for isolated Collect verification, not a project setting. */
  maximumOutputBytes?: number;
  jobId?: string;
  onProgress?: (progress: number) => void;
  lookOverride?: FilmLook | null;
  quality?: RenderQuality;
  /** Render one saved native caption language; omitted selects the first. */
  captionTrackId?: string | null;
  /** Render-only delivery geometry; never saved into the Composition. */
  exportProfile?: ExportProfile;
  /** Internal shared WAV/stem route; uses AudioAutomation and existing clips. */
  audioOnly?: boolean;
  /** Internal picture-only intermediate; standalone audio is not an input. */
  videoOnly?: boolean;
  audioRole?: AudioAutomation["role"];
  /** Required only when an explicit center crop is published as a video/still. */
  confirmCrop?: boolean;
  cropPreviewToken?: string;
  requestId?: string;
}
export interface ImportResult {
  job: Job;
  imported: number;
  skipped: number;
  failed: number;
}
export interface StoryOptions {
  title?: string;
  template?: string;
  targetDuration?: number;
  maxDuration?: number;
  /** Ordered user-authored beat titles; only valid with `custom-outline`. */
  customOutline?: string[];
  /** Explicit scope for large libraries; every locked asset is also included. */
  assetIds?: string[];
}

export interface CreateFilmOptions {
  projectContentLocale?: ProjectContentLocale;
  filmSettings?: Partial<FilmSettings>;
  timebase?: ProjectTimebaseV1;
}

export interface ProjectTimebaseUpdateInput {
  projectId: string;
  baseRevision: string;
  timebase: ProjectTimebaseV1;
}

export interface ExportReport {
  format: "json" | "otio" | "fcpxml" | "edl" | "mp4";
  warnings: string[];
  realNleVerified?: false;
  advancedEdits?: "metadata-only";
}

function safeDirectorySync(directory: string): void {
  const info = lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(
      `Project storage must be a directory without symlinks: ${directory}`,
    );
}

function atomicJsonSync(path: string, value: unknown): void {
  safeDirectorySync(dirname(path));
  if (
    existsSync(path) &&
    (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())
  )
    throw new Error(`Project file must be regular: ${path}`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

/** Application boundary shared by CLI and desktop; media runtime stays outside core. */
export class OpenFilmApplication {
  readonly graphics: GraphicSceneService;
  readonly catalog: ProjectCatalog;
  readonly intelligence: MediaIntelligence;
  readonly transcriptEditor: TranscriptEditor;
  readonly captions: CaptionService;
  readonly knowledge: KnowledgeService;
  readonly sceneScriptReview: SceneScriptReviewService;
  readonly visualQa: VisualQaService;
  readonly handoff: NleHandoffService;
  readonly audioQuality: AudioQualityService;
  readonly audioGeneration: AudioGenerationService;
  readonly motionGeneration: MotionGenerationService;
  readonly versions: ProjectVersionService;
  readonly collectMedia: CollectMediaService;
  readonly storyGraph: StoryGraphService;
  readonly storyPlan: StoryPlanService;
  readonly pipeline: PipelineService;
  readonly creativeVariants: CreativeVariantService;
  readonly sourceDraft: SourceDraftService;
  readonly sourceDiscovery: SourceDiscoveryService;
  readonly sourceBatches: SourceBatchService;
  readonly sourceAnalysis: SourceAnalysisService;
  readonly sourceAnalysisReview: SourceAnalysisReviewService;
  readonly proxyCache: ProxyCacheService;

  readonly exportProfiles: ExportProfileService;
  private activeJobs = 0;
  private persistedProject: string;
  private persistenceConflict = false;
  private generation = 0;

  private constructor(
    readonly directory: string,
    public project: OpenFilmProject,
    runtime: OpenFilmRuntimeOptions = {},
    private readonly intent: "workspace" | "export" = "workspace",
    private readonly packageFontBindings: ReadonlyMap<
      string,
      string
    > = new Map(),
  ) {
    // Bind the baseline to the loaded state, never a second disk read that
    // could have advanced while open() was awaiting filesystem work.
    this.persistedProject = savedScriptProjectIdentity(project);
    this.catalog = new ProjectCatalog(directory);
    try {
      const proxyProject = () => this.project;
      this.proxyCache = new ProxyCacheService(
        {
          directory,
          catalog: this.catalog,
          get project() {
            return proxyProject();
          },
          beginProxyWork: () => {
            this.activeJobs++;
          },
          endProxyWork: () => {
            this.activeJobs--;
          },
        },
        runtime.proxyGenerator,
      );
      this.sourceDraft = new SourceDraftService(directory, project.id);
      this.sourceDiscovery = new SourceDiscoveryService(
        this.sourceDraft,
        this.catalog,
      );
      this.sourceBatches = new SourceBatchService(
        directory,
        project.id,
        this.sourceDraft,
        this.catalog,
        (files, options) => this.importManagedSources(files, options),
        () => {
          this.activeJobs++;
        },
        () => {
          this.activeJobs--;
        },
      );
      this.sourceAnalysis = new SourceAnalysisService(
        project.id,
        this.catalog,
        () => {
          this.activeJobs++;
        },
        () => {
          this.activeJobs--;
        },
        runtime.visionSampleProviders,
      );
      this.sourceAnalysisReview = new SourceAnalysisReviewService(this);
      this.versions = new ProjectVersionService(this);
      this.collectMedia = new CollectMediaService(this);

      this.exportProfiles = new ExportProfileService({
        directory,
        getProject: () => this.project,
        getComposition: (id) => this.composition(id),
        getAssets: (composition) => this.compositionAssets(composition),
        render: (compositionId, outputPath, options: RenderOptions) =>
          this.renderFilm(
            compositionId,
            {
              signal: options.signal,
              quality: options.quality,
              lookOverride: options.lookOverride,
              exportProfile: options.exportProfile,
              captionTrackId: options.captionTrackId,
              audioOnly: options.audioOnly,
              videoOnly: options.videoOnly,
              audioRole: options.audioRole,
            },
            false,
            {
              outputPath,
              recordJob: false,
              trackActiveJob: false,
              snapshot: options.snapshot,
            },
          ),
      });
      this.graphics = new GraphicSceneService(
        this,
        (id) => new TimelineEditor(this).get(id).revision,
      );
      this.intelligence = new MediaIntelligence(this.catalog);
      this.transcriptEditor = new TranscriptEditor(this);
      this.captions = new CaptionService(this);
      this.storyGraph = new StoryGraphService(this, this.directory);
      this.storyPlan = new StoryPlanService(this, (next) =>
        this.publishProject(next),
      );
      this.pipeline = new PipelineService(this);
      this.creativeVariants = new CreativeVariantService(this, (next) =>
        this.publishProject(next),
      );
      this.knowledge = new KnowledgeService(
        this.catalog,
        this.transcriptEditor,
        runtime,
      );
      this.sceneScriptReview = new SceneScriptReviewService(
        this,
        (next) => this.publishProject(next),
        (disk) => {
          if (savedScriptProjectIdentity(disk) !== this.persistedProject)
            this.persistenceConflict = true;
        },
      );
      this.audioGeneration = new AudioGenerationService(
        this,
        runtime.audioGenerationProvider,
      );
      this.motionGeneration = new MotionGenerationService(
        this,
        runtime.motionGenerationProvider,
        runtime.motionGenerationTimeoutMs,
      );
      this.audioQuality = new AudioQualityService(
        this,
        (composition, outputPath, signal) =>
          this.renderFilm(composition.id, { signal }, false, {
            outputPath,
            recordJob: false,
            trackActiveJob: false,
            compositionOverride: composition,
          }),
      );
      const readProject = () => this.project;
      this.handoff = new NleHandoffService({
        directory: this.directory,
        get project() {
          return readProject();
        },
        getSourceAsset: (id) => this.getSourceAsset(id),
        render: (composition, outputPath, signal, captionTrackId) =>
          this.renderFilm(composition.id, { signal, captionTrackId }, false, {
            outputPath,
            recordJob: false,
            trackActiveJob: false,
            compositionOverride: composition,
          }),
      });
      this.visualQa = new VisualQaService({
        directory: this.directory,
        catalog: this.catalog,
        get project() {
          return readProject();
        },
        getSourceAsset: (assetId) => this.getSourceAsset(assetId),
        renderForVisualQa: (compositionId, outputPath, options) =>
          this.renderFilm(compositionId, options, false, {
            outputPath,
            recordJob: false,
            trackActiveJob: false,
          }),
      });
    } catch (error) {
      this.catalog.close();
      throw error;
    }
  }

  static async create(
    directory: string,
    title: string,
    options: CreateFilmOptions = {},
    runtime: OpenFilmRuntimeOptions = {},
  ): Promise<OpenFilmApplication> {
    const path = resolve(directory);
    const project = createProject(title);
    if (options.timebase !== undefined)
      project.settings = projectSettingsWithTimebase(
        project.settings,
        options.timebase,
      );
    if (options.projectContentLocale !== undefined)
      project.projectContentLocale = options.projectContentLocale;
    if (options.filmSettings !== undefined)
      project.filmSettings = resolveFilmSettings(options.filmSettings, [
        proposalTemplate,
      ]);
    validateProject(project);
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Project destination must be a regular directory");
      if ((await readdir(path)).length)
        throw new Error(
          "Project destination is not empty; open an existing OpenFilm project or choose an empty directory",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(path, { recursive: true });
    const canonical = await realpath(path);
    for (const name of ["story", "timeline", "analysis", "cache", "exports"])
      await mkdir(join(canonical, name));
    atomicJsonSync(join(canonical, "project.json"), project);
    return new OpenFilmApplication(canonical, project, runtime);
  }

  static async open(
    directory: string,
    runtime: OpenFilmRuntimeOptions = {},
    options: { intent?: "workspace" | "export" } = {},
  ): Promise<OpenFilmApplication> {
    const path = resolve(directory);
    safeDirectorySync(path);
    for (const name of ["project.json", "database.sqlite"]) {
      const info = await lstat(join(path, name));
      if (info.isSymbolicLink() || !info.isFile())
        throw new Error(`Invalid project storage file: ${name}`);
    }
    const project = migrateProject(
      JSON.parse(await readFile(join(path, "project.json"), "utf8")),
    );
    const canonical = await realpath(path);
    const packageFontBindings = await loadCollectedFontBindings(
      canonical,
      project,
    );
    for (const name of ["story", "timeline", "analysis", "cache", "exports"]) {
      try {
        safeDirectorySync(join(canonical, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        mkdirSync(join(canonical, name));
      }
    }
    const application = new OpenFilmApplication(
      canonical,
      project,
      runtime,
      options.intent,
      packageFontBindings,
    );
    try {
      application.versions.recoverInterruptedRestore();
    } catch (error) {
      application.catalog.close();
      throw error;
    }
    if (options.intent === "export") {
      // Deriving text must not recover other processes' jobs, rewrite media
      // references, or save this possibly obsolete project on CLI shutdown.
      return application;
    }
    try {
      application.repairMediaReferences();
      application.sourceAnalysis.recoverInterruptedAttempts();
      application.proxyCache.recoverInterrupted();
      for (const job of application.catalog.listJobs()) {
        if (
          [
            "language-review",
            "glossary-review",
            "scene-script-review",
            "transcribe",
            "waveform",
            "scenes",
            "analysis-run",
            "proxy",
          ].includes(job.type)
        )
          continue;
        if (job.status === "running" || job.status === "queued")
          application.catalog.saveJob({
            ...job,
            status: "failed",
            updatedAt: new Date().toISOString(),
            errors: [
              ...(job.errors ?? []),
              {
                uri: "",
                stage: "interrupted",
                message:
                  job.type === "import"
                    ? "The previous process stopped. Import again to resume completed files."
                    : "The previous process stopped. Retry this task; previously saved analysis remains available.",
              },
            ],
          });
      }
      application.knowledge.recoverInterruptedReviews();
      application.intelligence.recoverInterruptedJobs();
      await application.motionGeneration.expirePreviews();
      await application.pipeline.init();
      return application;
    } catch (error) {
      application.catalog.close();
      if (
        error &&
        typeof error === "object" &&
        "errcode" in error &&
        error.errcode === 5
      )
        throw new ApplicationError(
          "jobs.busy",
          "Another process is updating this project. Wait for it to finish before reopening.",
          409,
        );
      throw error;
    }
  }

  static async openForExport(
    directory: string,
    runtime: OpenFilmRuntimeOptions = {},
  ): Promise<OpenFilmApplication> {
    return this.open(directory, runtime, { intent: "export" });
  }

  /** Resolve moved managed media for passive reads without changing durable identity. */
  getSourceAsset(assetId: string): MediaAsset | undefined {
    const asset = this.catalog.getAsset(assetId);
    if (!asset || this.intent !== "export") return asset;
    const uri = managedSourceUri(this.directory, asset);
    return uri && uri !== asset.uri ? { ...asset, uri } : asset;
  }

  /** Package-owned fonts are hash-checked and resolved by requested family/weight. */
  titleFontPath(style: TitleStyle | undefined): string | undefined {
    return collectFontPathForStyle(
      this.packageFontBindings,
      style,
      this.project.settings,
    );
  }

  private repairMediaReferences(): void {
    this.catalog.withProjectWrite(() => {
      let next: OpenFilmProject | undefined;
      // Keep moved catalog locations and their manifest library roots together.
      for (const summary of this.catalog.iterateAssetSummaries()) {
        let asset = this.catalog.getAsset(summary.id)!;
        const managed = asset.metadata["openfilm.managedSource"] as
          { relativePath?: unknown; uri?: unknown } | undefined;
        const uri = managedSourceUri(this.directory, asset);
        if (uri) {
          const managedRoot = join(this.directory, "sources");
          const rootUri = pathToFileURL(managedRoot).href;
          const packageReference = asset.metadata["openfilm.reference"] as
            Record<string, unknown> | undefined;
          const reference = asset.uri.startsWith("openfilm-package://")
            ? {
                originalUri:
                  typeof packageReference?.originalUri === "string"
                    ? packageReference.originalUri
                    : asset.uri,
                filename:
                  typeof packageReference?.filename === "string"
                    ? packageReference.filename
                    : asset.name,
                mediaLibraryId:
                  typeof packageReference?.mediaLibraryId === "string"
                    ? packageReference.mediaLibraryId
                    : `legacy:${asset.id}`,
                relativePath:
                  typeof packageReference?.relativePath === "string"
                    ? packageReference.relativePath
                    : typeof managed?.relativePath === "string"
                      ? managed.relativePath
                      : `sources/${asset.id}`,
                volumeId:
                  typeof packageReference?.volumeId === "string"
                    ? packageReference.volumeId
                    : "collected-package",
                rootUri,
                ...(typeof packageReference?.contentHash === "string"
                  ? { contentHash: packageReference.contentHash }
                  : {}),
                ...(typeof packageReference?.fileSize === "number"
                  ? { fileSize: packageReference.fileSize }
                  : {}),
              }
            : referenceFor(asset, this.project.mediaLibraries);
          const relativePath = relative(managedRoot, localPath(uri))
            .split(sep)
            .join("/");
          if (
            asset.uri !== uri ||
            reference.rootUri !== rootUri ||
            reference.relativePath !== relativePath
          ) {
            asset = {
              ...asset,
              uri,
              metadata: {
                ...asset.metadata,
                "openfilm.managedSource": { ...managed, uri },
                "openfilm.reference": {
                  ...reference,
                  ...(typeof packageReference?.originalUriDigest === "string" &&
                  /^[a-f0-9]{64}$/u.test(packageReference.originalUriDigest)
                    ? { originalUriDigest: packageReference.originalUriDigest }
                    : {}),
                  rootUri,
                  relativePath,
                },
              },
            };
            this.catalog.upsertAsset(asset);
          }
          const library = (next ?? this.project).mediaLibraries.find(
            (item) => item.id === reference.mediaLibraryId,
          );
          if (library && library.uri !== rootUri) {
            next ??= {
              ...this.project,
              mediaLibraries: this.project.mediaLibraries.map((item) => ({
                ...item,
              })),
            };
            next.mediaLibraries.find((item) => item.id === library.id)!.uri =
              rootUri;
          }
        }
        const thumbnailUri =
          asset.thumbnailUri &&
          portableCacheUri(asset, asset.thumbnailUri, "thumbnails");
        const proxyUri =
          asset.proxyUri && portableCacheUri(asset, asset.proxyUri, "proxies");
        if (thumbnailUri !== asset.thumbnailUri || proxyUri !== asset.proxyUri)
          this.catalog.upsertAsset({
            ...asset,
            ...(thumbnailUri ? { thumbnailUri } : {}),
            ...(proxyUri ? { proxyUri } : {}),
          });
      }
      if (next) this.publishProject(next);
    });
  }

  private publishProject(
    next: OpenFilmProject,
    assertCurrent?: () => void,
  ): void {
    const previous = this.project;
    try {
      this.project = next;
      this.saveSync(assertCurrent);
    } catch (error) {
      this.project = previous;
      throw error;
    }
  }

  private saveSync(assertCurrent?: () => void): void {
    if (this.persistenceConflict)
      throw new ApplicationError(
        "story.planConflict",
        "Another process changed the saved project. Reopen it before saving further changes.",
        409,
      );
    try {
      const project = this.catalog.withProjectWrite(() => {
        assertCurrent?.();
        let disk: unknown;
        try {
          disk = JSON.parse(
            readFileSync(join(this.directory, "project.json"), "utf8"),
          );
        } catch {
          this.persistenceConflict = true;
          throw new ApplicationError(
            "story.planConflict",
            "The saved project could not be verified. Reopen it before saving further changes.",
            409,
          );
        }
        if (savedScriptProjectIdentity(disk) !== this.persistedProject) {
          this.persistenceConflict = true;
          throw new ApplicationError(
            "story.planConflict",
            "Another process changed the saved project. Reopen it before saving further changes.",
            409,
          );
        }
        const project = validateProject({
          ...this.project,
          updatedAt: new Date().toISOString(),
        });
        atomicJsonSync(join(this.directory, "project.json"), project);
        return project;
      });
      // An owned lock can fail to commit after publication. Retaining the old
      // baseline until it returns keeps later cleanup from undoing that file.
      this.project = project;
      this.persistedProject = savedScriptProjectIdentity(project);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "errcode" in error &&
        error.errcode === 5
      )
        throw new ApplicationError(
          "jobs.busy",
          "Another process is saving this project. Wait for it to finish before retrying.",
          409,
        );
      throw error;
    }
  }

  async save(): Promise<void> {
    this.saveSync();
  }

  async runMotionGeneration(
    input: Parameters<MotionGenerationService["preview"]>[0],
    signal?: AbortSignal,
  ) {
    if (this.activeJobs && !this.motionGeneration.hasRequest(input.requestId))
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active project job.",
        409,
      );
    this.activeJobs++;
    try {
      return await this.motionGeneration.preview(input, signal);
    } finally {
      this.activeJobs--;
    }
  }

  async runAudioGeneration(
    input: Parameters<AudioGenerationService["preview"]>[0],
    signal?: AbortSignal,
  ) {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active project job.",
        409,
      );
    this.activeJobs++;
    try {
      return await this.audioGeneration.preview(input, signal);
    } finally {
      this.activeJobs--;
    }
  }

  async runAudioQuality(
    compositionId: string,
    clipId: string,
    revision: string,
    signal?: AbortSignal,
  ) {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active project job.",
        409,
      );
    this.activeJobs++;
    try {
      return await this.audioQuality.run(
        compositionId,
        clipId,
        revision,
        signal,
      );
    } finally {
      this.activeJobs--;
    }
  }

  reviewHandoff(compositionId: string, options: HandoffOptions = {}) {
    return this.handoff.review(compositionId, options);
  }
  async exportHandoff(input: HandoffRequest, signal?: AbortSignal) {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for active project jobs",
        409,
      );
    this.activeJobs++;
    try {
      return await this.handoff.publish(input, signal);
    } finally {
      this.activeJobs--;
    }
  }

  async runVisualQa(
    compositionId?: string,
    options: VisualQaOptions = {},
  ): Promise<VisualQaReport> {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active project job before starting Visual QA.",
        409,
      );
    this.activeJobs++;
    try {
      return await this.visualQa.run(compositionId, options);
    } finally {
      this.activeJobs--;
    }
  }

  readVisualQaReport(reportId: string): Promise<VisualQaReport | undefined> {
    return this.visualQa.readReport(reportId);
  }

  visualQaFramePath(
    reportId: string,
    sampleIndex: number,
  ): Promise<string | undefined> {
    return this.visualQa.framePath(reportId, sampleIndex);
  }

  get hasActiveJobs(): boolean {
    return this.activeJobs > 0;
  }

  /** Successful project-level restore invalidates all cached editor snapshots. */
  get projectGeneration(): number {
    return this.generation;
  }

  acceptRestoredProject(project: OpenFilmProject): void {
    this.project = validateProject(project);
    this.persistedProject = savedScriptProjectIdentity(this.project);
    this.persistenceConflict = false;
    this.generation += 1;
  }

  reserveIntelligenceJob(
    assetId: string,
    operation: IntelligenceOptions["operation"],
    jobId?: string,
  ): Job {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active job before starting another analysis.",
        409,
      );
    return this.intelligence.reserve(assetId, operation, jobId);
  }

  analysisRecoveryStatus(jobId: string) {
    return this.intelligence.analysisRecoveryStatus(jobId);
  }

  analysisRecoveryStatuses(jobs?: readonly Job[]) {
    return this.intelligence.analysisRecoveryStatuses(jobs);
  }

  manualRecoverAnalysis(jobId: string, input: AnalysisRecoveryInput): Job {
    return this.intelligence.manualRecoverAnalysis(jobId, input);
  }

  async analyzeIntelligence(
    assetId: string,
    options: IntelligenceOptions,
  ): Promise<Job> {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active job before starting another analysis.",
        409,
      );
    this.activeJobs++;
    try {
      const promptHints: string[] = [];
      let hintLength = 0;
      if (
        options.operation === "transcribe" &&
        this.intelligence.supportsTranscriptionPromptHints
      ) {
        for (const entry of this.knowledge.glossaryList("effective")) {
          const term = entry.replacement;
          if (
            !term.trim() ||
            term.length > 200 ||
            promptHints.includes(term) ||
            // Multiline glossary text stays valid content. Compact provider
            // hints must not turn that text into an invalid transcription request.
            [...term].some(
              (character) =>
                character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            )
          )
            continue;
          if (promptHints.length >= 50 || hintLength + term.length > 2000)
            continue;
          promptHints.push(term);
          hintLength += term.length;
        }
      }
      return await this.intelligence.run(assetId, {
        ...options,
        ...(promptHints?.length ? { promptHints } : {}),
      });
    } finally {
      this.activeJobs--;
    }
  }

  /** Review jobs share the project's lifecycle guard with import, analysis and rendering. */
  async runKnowledgeReview(
    assetId: string,
    options: ReviewOptions & { source: "glossary" | "language" },
  ): Promise<Job> {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active job before starting another review.",
        409,
      );
    if (!["glossary", "language"].includes(options.source))
      throw new ApplicationError(
        "request.invalid",
        "Choose glossary or language review.",
      );
    this.activeJobs++;
    try {
      return options.source === "glossary"
        ? await this.knowledge.glossaryReview(assetId, options)
        : await this.knowledge.languageReview(assetId, options);
    } finally {
      this.activeJobs--;
    }
  }

  async retryKnowledgeReview(
    jobId: string,
    index: number,
    options: ReviewOptions = {},
  ): Promise<Job> {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active job before retrying a review batch.",
        409,
      );
    this.activeJobs++;
    try {
      return await this.knowledge.retryBatch(jobId, index, options);
    } finally {
      this.activeJobs--;
    }
  }

  async runSceneScriptReview(
    storyId: string,
    options: SceneScriptReviewOptions,
  ): Promise<Job> {
    if (this.activeJobs)
      throw new ApplicationError(
        "jobs.busy",
        "Wait for the active job before starting another review.",
        409,
      );
    this.activeJobs++;
    try {
      return await this.sceneScriptReview.run(storyId, options);
    } finally {
      this.activeJobs--;
    }
  }

  /** Lifecycle owners may require a successful workspace save before closing. */
  close(options: { requireSave?: boolean } = {}): void {
    if (this.activeJobs)
      throw new Error(
        "Cancel or wait for active jobs before closing this project",
      );
    try {
      if (
        this.intent !== "export" &&
        (options.requireSave || !this.persistenceConflict)
      )
        this.saveSync();
    } catch (error) {
      if (options.requireSave || !this.persistenceConflict) throw error;
    }
    void this.motionGeneration.dispose().catch(() => undefined);
    this.graphics.close();
    this.catalog.close();
  }

  async importFolder(
    folder: string,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    return this.importSources({ folder }, options);
  }

  async importFiles(
    files: string[],
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    return this.importSources({ files }, options);
  }

  /** The server calls this only for completed upload receipts owned by this project. */
  async importManagedSources(
    files: string[],
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    return this.importSources({ files, managed: true }, options);
  }

  private async importSources(
    input: { folder?: string; files?: string[]; managed?: boolean },
    options: ImportOptions,
  ): Promise<ImportResult> {
    const sourceFolder =
      input.folder === undefined
        ? undefined
        : resolve(
            input.folder.startsWith("file:")
              ? localPath(input.folder)
              : input.folder,
          );
    const sourceLabel = sourceFolder ?? "Selected files";
    const job: Job = {
      id: options.jobId ?? randomUUID(),
      type: "import",
      status: "queued",
      progress: 0,
      errors: [],
      createdAt: new Date().toISOString(),
    };
    const result: ImportResult = { job, imported: 0, skipped: 0, failed: 0 };
    let completed = 0;
    let discovered = 0;
    const publish = () => {
      job.updatedAt = new Date().toISOString();
      this.catalog.saveJob(job);
      // Progress observers receive copies and cannot corrupt durable job state.
      try {
        options.onProgress?.(structuredClone(job));
      } catch {
        /* An observer is not a pipeline stage. */
      }
    };
    publish();
    this.activeJobs++;
    const pending = new Set<Promise<void>>();
    const insta360Context = new Insta360ImportContext();
    const managedRoot = join(this.directory, "sources");
    let folderRoot: string | undefined;
    const process = async (candidate: MediaCandidate): Promise<void> => {
      let stage = "fingerprint";
      const partials: string[] = [];
      try {
        checkAbort(options.signal);
        const locationMatch = this.catalog.getAssetByUri(candidate.uri);
        const managed = locationMatch?.metadata["openfilm.managedSource"] as
          { uri?: unknown; relativePath?: unknown } | undefined;
        const knownManaged =
          !!input.files &&
          managed?.uri === candidate.uri &&
          managed.relativePath ===
            relative(this.directory, candidate.path).split(sep).join("/") &&
          isInside(managedRoot, candidate.path);
        const managedSource = input.managed || knownManaged;
        if (isInside(this.directory, candidate.path) && !managedSource) {
          result.skipped++;
          return;
        }
        const library = libraryFor(
          managedSource ? managedRoot : (folderRoot ?? dirname(candidate.path)),
        );
        const locationId = createHash("sha256")
          .update(candidate.uri)
          .digest("hex")
          .slice(0, 32);
        const previousLocationOwner = this.catalog.getAsset(locationId);
        const assetId =
          locationMatch?.id ??
          (previousLocationOwner && previousLocationOwner.uri !== candidate.uri
            ? randomUUID()
            : locationId);
        const originalHash = await hashFile(candidate.path, options.signal);
        const previous = this.catalog.getAsset(assetId);
        const stem = `${assetId}-${originalHash.slice(0, 16)}-v2`;
        const thumbnail = await safeProjectCachePath(
          this.directory,
          "thumbnails",
          `${stem}.jpg`,
        );
        const derivedComplete =
          previous &&
          previous.metadata["openfilm.importPipeline"] === 2 &&
          (previous.mediaType === "audio" || existsSync(thumbnail)) &&
          (options.proxies === false ||
            !["video", "360-video", "audio"].includes(previous.mediaType) ||
            (!!previous.proxyUri &&
              (await this.proxyCache.isAvailable(previous))));
        if (previous?.contentHash === originalHash && derivedComplete) {
          result.skipped++;
          return;
        }
        stage = "inspect";
        const inspected = isInsta360Raw(candidate.uri)
          ? await inspectInsta360Raw(candidate, options.signal, insta360Context)
          : extname(candidate.path).toLowerCase() === ".dng"
            ? await inspectPixelDng(candidate, options.signal)
            : await inspectMedia(candidate, options.signal);
        const asset = await enrichInsta360Asset(
          await enrichPixelAsset(inspected),
          { signal: options.signal, context: insta360Context },
        );
        asset.id = assetId;
        asset.contentHash = originalHash;
        if (previous) {
          asset.state = structuredClone(previous.state);
          asset.tags = [...previous.tags];
          if (previous.rating !== undefined) asset.rating = previous.rating;
          const previousMetadata = { ...previous.metadata };
          for (const key of [
            "openfilm.preview",
            "openfilm.pixel",
            "openfilm.insta360",
            "openfilm.color",
            "openfilm.ffprobe",
            "openfilm.exif",
            "openfilm.timestamp",
            "openfilm.filesystem",
            "openfilm.metadata.exiftoolAvailable",
            "openfilm.importPipeline",
          ])
            delete previousMetadata[key];
          asset.metadata = { ...previousMetadata, ...asset.metadata };
        }
        const reference = referenceFor(
          previous ?? asset,
          library ? [library] : this.project.mediaLibraries,
        );
        asset.metadata["openfilm.reference"] = {
          ...reference,
          contentHash: originalHash,
          fileSize: (asset.metadata["openfilm.filesystem"] as { size?: number })
            .size,
        };
        asset.metadata["openfilm.importPipeline"] = 2;
        if (managedSource)
          asset.metadata["openfilm.managedSource"] = {
            uri: candidate.uri,
            relativePath: relative(this.directory, candidate.path)
              .split(sep)
              .join("/"),
          };
        if (!previewIssue(asset)) {
          try {
            await previewVideoFilters(asset, options.signal);
          } catch (error) {
            checkAbort(options.signal);
            asset.metadata["openfilm.preview"] = {
              supported: false,
              reason: String(error instanceof Error ? error.message : error),
            };
          }
        }
        if (asset.mediaType !== "audio" && !previewIssue(asset)) {
          stage = "perceptual-fingerprint";
          asset.perceptualHash = await perceptualHash(
            candidate.path,
            options.signal,
          );
          stage = "thumbnail";
          if (!existsSync(thumbnail)) {
            const temporary = await safeProjectCachePath(
              this.directory,
              "thumbnails",
              `${stem}-${job.id}.partial.jpg`,
            );
            partials.push(temporary);
            await createThumbnail(asset, temporary, options.signal);
            await rename(temporary, thumbnail);
          }
          asset.thumbnailUri = relative(this.directory, thumbnail)
            .split(sep)
            .join("/");
        }
        if (
          options.proxies !== false &&
          !previewIssue(asset) &&
          ["video", "360-video", "audio"].includes(asset.mediaType)
        ) {
          stage = "proxy";
          try {
            asset.proxyUri = await this.proxyCache.prepareImportedAsset(
              asset,
              options.signal,
            );
          } catch (error) {
            checkAbort(options.signal);
            if (
              !(error instanceof ApplicationError) ||
              error.code !== "proxy.quotaExceeded"
            )
              throw error;
            // Preview capacity never discards an otherwise verified source.
            // Its failed proxy task remains explicitly resumable after cleanup.
            job.errors!.push({
              uri: "",
              stage: "proxy-pending",
              code: error.code,
              message:
                "Original media imported; preview preparation is waiting for storage capacity.",
            });
          }
        }
        stage = "index";
        checkAbort(options.signal);
        // A source edited by another application during decoding must be retried.
        if ((await hashFile(candidate.path, options.signal)) !== originalHash)
          throw new Error(
            "Source changed during import; import again after editing finishes",
          );
        this.catalog.upsertAsset(asset);
        result.imported++;
      } catch (error) {
        if (
          (error as Error).name !== "AbortError" &&
          !options.signal?.aborted
        ) {
          result.failed++;
          job.errors!.push({
            uri: candidate.uri,
            stage,
            message: error instanceof Error ? error.message : String(error),
            ...errorInfo(error, "import.failed"),
          });
        }
      } finally {
        await Promise.all(partials.map((path) => rm(path, { force: true })));
        completed++;
        job.progress = Math.max(
          job.progress ?? 0,
          Math.min(0.95, completed / Math.max(discovered + 1, 1)),
        );
        publish();
      }
    };
    const libraries = new Map(
      this.project.mediaLibraries.map((library) => [library.uri, library]),
    );
    let indexedReferences = false;
    const libraryFor = (root: string) => {
      const uri = pathToFileURL(root).href;
      if (!libraries.has(uri) && !indexedReferences) {
        for (const summary of this.catalog.iterateAssetSummaries({
          includeReference: true,
        })) {
          const reference = referenceFor(summary, this.project.mediaLibraries);
          const original = this.project.mediaLibraries.find(
            (library) => library.id === reference.mediaLibraryId,
          );
          if (original)
            libraries.set(reference.rootUri, {
              ...original,
              uri: reference.rootUri,
            });
        }
        indexedReferences = true;
      }
      let library = libraries.get(uri);
      if (!library) {
        library = { id: randomUUID(), uri, name: basename(root) };
        this.publishProject({
          ...this.project,
          mediaLibraries: [...this.project.mediaLibraries, library],
        });
        libraries.set(uri, library);
      }
      return library;
    };
    const candidates = async function* () {
      if (sourceFolder !== undefined) {
        yield* new FilesystemSource().discover(sourceFolder, options.signal);
      } else {
        if (!input.files?.length)
          throw new ApplicationError(
            "request.invalid",
            "Choose at least one media file.",
          );
        for (const file of [...new Set(input.files)]) {
          checkAbort(options.signal);
          const path = resolve(
            file.startsWith("file:") ? localPath(file) : file,
          );
          const info = await lstat(path);
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            (await realpath(path)) !== resolve(path)
          )
            throw new ApplicationError(
              "request.invalid",
              "Selected media must be regular files without symlinks.",
            );
          if (!isSupportedMediaFile(path))
            throw new ApplicationError(
              "media.unsupported",
              `Unsupported media file: ${basename(path)}`,
              400,
              { name: basename(path) },
            );
          yield { path, uri: pathToFileURL(path).href, name: basename(path) };
        }
      }
    };
    try {
      checkAbort(options.signal);
      folderRoot =
        sourceFolder === undefined ? undefined : await realpath(sourceFolder);
      job.status = "running";
      publish();
      for await (const candidate of candidates()) {
        checkAbort(options.signal);
        if (input.managed && !isInside(managedRoot, candidate.path))
          throw new ApplicationError(
            "request.forbidden",
            "Managed import source must belong to this project.",
            403,
          );
        discovered++;
        const task = process(candidate);
        pending.add(task);
        void task.then(
          () => pending.delete(task),
          () => pending.delete(task),
        );
        if (pending.size >= 3) await Promise.race(pending);
      }
      await Promise.all(pending);
      job.status = options.signal?.aborted ? "cancelled" : "completed";
      if (!options.signal?.aborted) job.progress = 1;
      this.saveSync();
    } catch (error) {
      await Promise.all(pending);
      job.status =
        options.signal?.aborted || (error as Error).name === "AbortError"
          ? "cancelled"
          : "failed";
      if (job.status === "failed") {
        result.failed++;
        job.errors!.push({
          uri: sourceLabel,
          stage: "discover",
          message: String(error),
          ...errorInfo(error, "import.failed"),
        });
      }
    } finally {
      publish();
      this.activeJobs--;
    }
    return structuredClone(result);
  }

  analyze(): { events: Event[]; duplicates: SimilarityGroup[] } {
    // Algorithms see only compact descriptors; extension blobs remain paged in SQL.
    const summaries = [...this.catalog.iterateAssetSummaries()];
    const result = {
      events: clusterEvents(summaries),
      duplicates: findDuplicates(summaries),
    };
    atomicJsonSync(
      join(this.directory, "analysis", "events.json"),
      result.events,
    );
    atomicJsonSync(
      join(this.directory, "analysis", "duplicates.json"),
      result.duplicates,
    );
    return result;
  }

  updateProjectTimebase(input: ProjectTimebaseUpdateInput): OpenFilmProject {
    const conflict = () =>
      new ApplicationError(
        "project.timebaseConflict",
        "The project changed or its timed content requires rate conform. Reopen the film and review its timebase.",
        409,
      );
    if (input.projectId !== this.project.id) throw conflict();
    if (
      typeof input.baseRevision !== "string" ||
      !/^[a-f0-9]{64}$/u.test(input.baseRevision)
    )
      throw new ApplicationError(
        "request.invalid",
        "baseRevision must be a SHA-256 revision.",
      );
    // Capture outside the publication transaction: version snapshots own their
    // SQLite transaction. Fence catalog writers again under the publication lock.
    const catalogRevision = this.catalog.logicalRevision();
    let revision: string;
    try {
      revision = this.versions.currentRevision();
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        error.code === "story.planConflict"
      )
        throw conflict();
      throw error;
    }
    if (revision !== input.baseRevision) throw conflict();
    const current = resolveProjectTimebase(this.project.settings);
    const settings = projectSettingsWithTimebase(
      this.project.settings,
      input.timebase,
    );
    const rateChanged =
      BigInt(current.rateNumerator) * BigInt(input.timebase.rateDenominator) !==
      BigInt(input.timebase.rateNumerator) * BigInt(current.rateDenominator);
    if (
      rateChanged &&
      this.project.timelines.some(
        (composition) =>
          composition.duration > 0 ||
          composition.tracks.some((track) => track.clips.length > 0) ||
          composition.captionTracks?.some((track) => track.cues.length > 0) ||
          (composition.graphicScenes?.length ?? 0) > 0,
      )
    )
      throw conflict();
    const next = { ...this.project, settings };
    validateProject(next);
    try {
      this.publishProject(next, () => {
        if (this.catalog.logicalRevision() !== catalogRevision)
          throw conflict();
      });
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        error.code === "story.planConflict"
      )
        throw conflict();
      throw error;
    }
    return structuredClone(this.project);
  }

  updateFilm(
    options: Pick<CreateFilmOptions, "projectContentLocale" | "filmSettings">,
  ): OpenFilmProject {
    const previous = this.project;
    let next =
      options.projectContentLocale === undefined
        ? structuredClone(previous)
        : localizeProjectContent(
            previous,
            options.projectContentLocale,
            [proposalTemplate],
            [storyArcBeatText],
          );
    if (options.filmSettings !== undefined)
      next = {
        ...next,
        filmSettings: resolveFilmSettings(
          { ...previous.filmSettings, ...options.filmSettings },
          [proposalTemplate],
        ),
      };
    validateProject(next);
    this.publishProject(next);
    return structuredClone(this.project);
  }

  previewScenePlan(options: ScenePlanOptions): ScenePlan {
    return previewScenePlan(this, options);
  }

  acceptScenePlan(plan: ScenePlanAcceptance): {
    story: Story;
    composition: Composition;
  } {
    return acceptScenePlan(this, plan, () => this.saveSync());
  }

  generateStory(options: StoryOptions = {}): Story {
    options = {
      ...(this.project.filmSettings
        ? {
            template: this.project.filmSettings.templateId,
            targetDuration: this.project.filmSettings.targetDuration,
            maxDuration: this.project.filmSettings.maxDuration,
          }
        : {}),
      ...Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ),
    };
    if (
      options.template &&
      !["proposal-film", "blank", ...STORY_ARC_IDS].includes(options.template)
    )
      throw new ApplicationError(
        "story.invalid",
        `Unknown story template: ${options.template}`,
      );
    if (
      options.customOutline !== undefined &&
      options.template !== "custom-outline"
    )
      throw new ApplicationError(
        "story.invalid",
        "A custom outline can only be used with the custom story structure.",
      );
    const assets: MediaAsset[] = [];
    if (options.assetIds) {
      const ids = new Set(options.assetIds);
      for (const asset of this.catalog.iterateAssetSummaries())
        if (asset.state.locked) ids.add(asset.id);
      if (ids.size > 2000)
        throw new ApplicationError(
          "story.scopeTooLarge",
          "A story can use at most 2000 candidates; reduce the scope or unlock assets",
        );
      for (const id of ids) {
        const asset = this.catalog.getAsset(id);
        if (!asset) throw new Error(`Story candidate not found: ${id}`);
        assets.push(asset);
      }
    } else {
      if (this.catalog.countAssets() > 2000)
        throw new ApplicationError(
          "story.scopeTooLarge",
          "Choose an explicit assetIds story scope for libraries above 2000 assets; locked assets will be included",
        );
      for (let offset = 0; ; offset += 500) {
        const page = this.catalog.listAssets({ offset, limit: 500 });
        assets.push(...page);
        if (page.length < 500) break;
      }
    }
    if (!assets.length)
      throw new ApplicationError(
        "story.mediaRequired",
        "Import media before creating a story",
      );
    for (const asset of assets)
      if (
        previewIssue(asset) &&
        (asset.state.locked || options.assetIds?.includes(asset.id))
      )
        throw new ApplicationError(
          "media.unsupported",
          `${asset.name}: ${previewIssue(asset)}`,
          422,
          { name: asset.name },
        );
    const usable = assets.filter((asset) => !previewIssue(asset));
    if (!usable.length)
      throw new ApplicationError(
        "story.mediaRequired",
        "No renderable media is available. Import flat exported photos/videos before creating a story.",
      );
    const storyTitle = options.title ?? this.project.title;
    const story = STORY_ARC_IDS.includes(
      options.template as (typeof STORY_ARC_IDS)[number],
    )
      ? createStoryArc(storyTitle, usable, {
          arc: options.template as (typeof STORY_ARC_IDS)[number],
          contentLocale: this.project.projectContentLocale,
          ...(options.customOutline !== undefined
            ? { customOutline: options.customOutline }
            : {}),
          ...(options.targetDuration !== undefined
            ? { targetDuration: options.targetDuration }
            : {}),
          ...(options.maxDuration !== undefined
            ? { maxDuration: options.maxDuration }
            : {}),
        })
      : createStory(storyTitle, usable, {
          contentLocale: this.project.projectContentLocale,
          ...(options.template === "proposal-film"
            ? { template: proposalTemplate }
            : {}),
          ...(options.targetDuration !== undefined
            ? { targetDuration: options.targetDuration }
            : {}),
          ...(options.maxDuration !== undefined
            ? { maxDuration: options.maxDuration }
            : {}),
        });
    this.publishProject({
      ...this.project,
      stories: [...this.project.stories, story],
    });
    return structuredClone(story);
  }

  refreshSuggestions(storyId: string, beatId: string): Story {
    const previous = this.project;
    const story = previous.stories.find((item) => item.id === storyId);
    const beat = story?.beats.find((item) => item.id === beatId);
    if (!story || !beat)
      throw new ApplicationError(
        "story.invalid",
        "Story beat was not found.",
        404,
      );
    const ids = [...new Set(beat.candidateAssetIds ?? [])];
    if (ids.length > 2000)
      throw new ApplicationError(
        "story.scopeTooLarge",
        "A beat can rank at most 2000 candidates.",
      );
    const assets = ids.flatMap((id) => {
      const asset = this.catalog.getAsset(id);
      return asset ? [asset] : [];
    });
    const protectedIds = new Set([
      ...(beat.selectedAssetIds ?? []),
      ...(beat.constraints ?? []).flatMap((constraint) =>
        constraint.type === "must-include" || constraint.type === "asset-order"
          ? constraint.assetIds
          : [],
      ),
      ...assets.filter((asset) => asset.state.locked).map((asset) => asset.id),
    ]);
    const ranked = assets
      .filter(
        (asset) =>
          protectedIds.has(asset.id) ||
          (!asset.state.rejected && !previewIssue(asset)),
      )
      .map((asset) => ({
        id: asset.id,
        score: scoreAsset(asset, { assets }).score,
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.id.localeCompare(right.id),
      )
      .map((item) => item.id);
    const next = structuredClone(previous);
    const updated = next.stories.find((item) => item.id === storyId)!;
    updated.beats.find((item) => item.id === beatId)!.candidateAssetIds =
      ranked;
    validateProject(next);
    this.publishProject(next);
    return structuredClone(updated);
  }

  prepareComposition(storyId?: string): Composition {
    const story = storyId
      ? this.project.stories.find((item) => item.id === storyId)
      : this.project.stories.at(-1);
    if (!story) throw new Error("Create a story before composing a timeline");
    const ids = new Set(
      story.beats.flatMap((beat) => [
        ...(beat.candidateAssetIds ?? []),
        ...(beat.selectedAssetIds ?? []),
        ...(beat.constraints ?? []).flatMap((constraint) =>
          "assetIds" in constraint ? constraint.assetIds : [],
        ),
      ]),
    );
    const assets: MediaAsset[] = [];
    for (const asset of this.catalog.iterateAssetSummaries())
      if (asset.state.locked) ids.add(asset.id);
    for (const id of ids) {
      const asset = this.catalog.getAsset(id);
      if (!asset) throw new Error(`Story asset not found: ${id}`);
      assets.push(asset);
    }
    const required = new Set(
      story.beats.flatMap((beat) => [
        ...(beat.selectedAssetIds ?? []),
        ...(beat.constraints ?? []).flatMap((constraint) =>
          constraint.type === "must-include" ||
          constraint.type === "asset-order"
            ? constraint.assetIds
            : [],
        ),
      ]),
    );
    for (const asset of assets)
      if (previewIssue(asset) && (asset.state.locked || required.has(asset.id)))
        throw new ApplicationError(
          "media.unsupported",
          `${asset.name}: ${previewIssue(asset)}`,
          422,
          { name: asset.name },
        );
    const composition = solve(
      story,
      assets.filter((asset) => !previewIssue(asset)),
    );
    return structuredClone(composition);
  }

  compose(storyId?: string): Composition {
    const composition = this.prepareComposition(storyId);
    this.publishProject({
      ...this.project,
      timelines: [...this.project.timelines, composition],
    });
    return structuredClone(composition);
  }

  private composition(id?: string): Composition {
    const composition = id
      ? this.project.timelines.find((item) => item.id === id)
      : this.project.timelines.at(-1);
    if (!composition)
      throw new ApplicationError(
        "timeline.notFound",
        "Compose a timeline first",
        404,
      );
    return composition;
  }

  private compositionAssets(
    composition: Composition,
    includeTitleAssets = false,
  ): MediaAsset[] {
    return [
      ...new Set([
        ...graphicSceneAssetIds(composition.graphicScenes ?? []),
        ...composition.tracks
          .filter((track) => includeTitleAssets || track.type !== "titles")
          .flatMap((track) =>
            track.clips.flatMap((clip) => [
              clip.assetId,
              ...(clip.layout?.secondary
                ? [clip.layout.secondary.assetId]
                : []),
            ]),
          ),
      ]),
    ].map((id) => {
      const asset = this.catalog.getAsset(id);
      if (!asset)
        throw new ApplicationError(
          "media.notFound",
          `Timeline asset not found: ${id}`,
          404,
        );
      return asset;
    });
  }

  async render(
    compositionId?: string,
    options: FilmRenderOptions = {},
  ): Promise<string> {
    return this.renderFilm(compositionId, options, false);
  }

  /** A shared, locally measured title raster; no project/content mutation. */
  async titleOverlay(compositionId: string, clipId: string): Promise<string> {
    const clip = structuredClone(
      this.composition(compositionId)
        .tracks.flatMap((track) => track.clips)
        .find((item) => item.id === clipId),
    );
    if (!clip?.title)
      throw new ApplicationError(
        "timeline.notFound",
        "This clip has no title to preview.",
        404,
      );
    const settings = { ...this.project.settings };
    const fontPath = this.titleFontPath(clip.titleStyle);
    const { font } = await resolveTitleFont(
      clip.titleStyle,
      fontPath ? { fontPath } : undefined,
    );
    const key = titleOverlayCacheKey({
      text: clip.title,
      style: clip.titleStyle,
      frame: settings,
      fontSha256: font.sha256,
      postscriptName: font.postscriptName,
    });
    const path = await safeProjectCachePath(
      this.directory,
      "titles",
      `${key}.png`,
    );
    try {
      if ((await lstat(path)).isFile()) return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = await safeProjectCachePath(
      this.directory,
      "titles",
      `${key}-${randomUUID()}.tmp.png`,
    );
    try {
      await createTitleOverlay(
        clip.title,
        clip.titleStyle,
        settings,
        temporary,
        fontPath ? { fontPath } : undefined,
      );
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    // A typing session must not leave an unbounded number of full-frame PNGs.
    const directory = dirname(path);
    const files = await readdir(directory);
    const entries = await Promise.all(
      files
        .filter(
          (name) =>
            /^[a-f0-9]{64}\.png$/u.test(name) && name !== basename(path),
        )
        .map(async (name) => {
          const target = join(directory, name);
          try {
            return { target, modified: (await lstat(target)).mtimeMs };
          } catch {
            return undefined;
          }
        }),
    );
    const stale = entries
      .filter((entry): entry is { target: string; modified: number } => !!entry)
      .sort((a, b) => b.modified - a.modified)
      .slice(63);
    await Promise.all(stale.map((entry) => rm(entry.target, { force: true })));
    return path;
  }

  async exportMp4(
    compositionId?: string,
    options: FilmRenderOptions = {},
  ): Promise<{ path: string; report: ExportReport }> {
    const path = await this.renderFilm(compositionId, options, true);
    const manifest = JSON.parse(
      await readFile(`${path}.manifest.json`, "utf8"),
    ) as { warnings: string[] };
    return { path, report: { format: "mp4", warnings: manifest.warnings } };
  }

  previewExportFrame(input: {
    compositionId?: string;
    profile: ExportProfile;
    time: number;
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
    signal?: AbortSignal;
  }) {
    return this.exportProfiles.previewFrame(input);
  }

  exportStill(input: {
    compositionId?: string;
    profile: ExportProfile;
    time: number;
    requestId: string;
    confirmCrop?: boolean;
    cropPreviewToken?: string;
    lookOverride?: FilmLook | null;
    captionTrackId?: string | null;
    signal?: AbortSignal;
  }) {
    return this.exportProfiles.exportStill(input);
  }

  exportProfileAudio(input: {
    compositionId?: string;
    profile: ExportProfile;
    requestId: string;
    signal?: AbortSignal;
  }) {
    return this.exportProfiles.exportAudio(input);
  }

  private async renderFilm(
    compositionId: string | undefined,
    options: FilmRenderOptions,
    exportFile: boolean,
    context: {
      outputPath?: string;
      recordJob?: boolean;
      trackActiveJob?: boolean;
      compositionOverride?: Composition;
      snapshot?: RenderOptions["snapshot"];
    } = {},
  ): Promise<string> {
    let exportProfile: ExportProfile | undefined;
    try {
      if (options.exportProfile) {
        exportProfile = validateExportProfile(options.exportProfile);
        if (
          options.audioOnly
            ? exportProfile.format !== "wav" &&
              exportProfile.format !== "audio-stems"
            : exportProfile.format !== "mp4"
        )
          throw new Error(
            "Renderer format does not match the selected Export Profile.",
          );
        if (options.audioRole && exportProfile.format !== "audio-stems")
          throw new Error(
            "Audio role filtering requires an audio-stems Export Profile.",
          );
      }
    } catch (error) {
      throw new ApplicationError(
        "request.invalid",
        "Choose a valid render-only Export Profile and confirm any explicit crop.",
        400,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
    const quality = resolveRenderQuality(
      exportProfile?.quality ?? options.quality,
    ).quality;
    let lookOverride: FilmLook | null | undefined;
    try {
      lookOverride =
        options.lookOverride == null
          ? options.lookOverride
          : validateFilmLook(options.lookOverride);
    } catch (error) {
      throw new ApplicationError(
        "request.invalid",
        "Choose a supported film look with strength between zero and one.",
        400,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
    const composition = structuredClone(
      context.compositionOverride ?? this.composition(compositionId),
    );
    const renderSettings = { ...this.project.settings };
    const projectEvidence = {
      id: this.project.id,
      schemaVersion: this.project.schemaVersion,
      revision: createHash("sha256")
        .update(JSON.stringify(this.project))
        .digest("hex"),
    };
    const approved =
      exportFile && exportProfile
        ? await this.exportProfiles.assertCropPreview({
            compositionId,
            ...options,
            profile: exportProfile,
          })
        : context.snapshot;
    approved?.assertCurrent();
    const story = this.project.stories.find(
      (item) => item.id === composition.storyId,
    );
    if (
      story?.maxDuration !== undefined &&
      composition.duration > story.maxDuration + 0.00001
    )
      throw new ApplicationError(
        "render.overMaximum",
        "Timeline exceeds the story maximum duration; use Fit to Duration or shorten clips before rendering",
      );
    if (exportFile) safeDirectorySync(join(this.directory, "exports"));
    const output =
      context.outputPath ??
      (exportFile
        ? join(this.directory, "exports", `film-${randomUUID()}.mp4`)
        : await safeProjectCachePath(this.directory, "preview.mp4"));
    const job: Job | undefined =
      context.recordJob === false
        ? undefined
        : {
            id: options.jobId ?? randomUUID(),
            type: "render",
            status: "running",
            progress: 0,
            createdAt: new Date().toISOString(),
          };
    if (job) this.catalog.saveJob(job);
    const trackActiveJob = context.trackActiveJob !== false;
    if (trackActiveJob) this.activeJobs++;
    try {
      const assets = this.compositionAssets(composition);
      const sourceIds = options.audioOnly
        ? audioSourceAssetIds(composition, assets, options.audioRole)
        : options.videoOnly
          ? visualSourceAssetIds(composition, assets)
          : undefined;
      for (const asset of assets.filter(
        (asset) => !sourceIds || sourceIds.has(asset.id),
      )) {
        checkAbort(options.signal);
        const status = await sourceStatus(asset);
        if (status.status !== "available")
          throw new ApplicationError(
            "media.missing",
            `${status.status === "missing" ? "Missing Media" : "Source inaccessible"}: ${asset.name}. Reconnect the disk or relink this source before rendering.`,
            400,
            { name: asset.name },
          );
        const unsupported = previewIssue(asset);
        if (unsupported)
          throw new ApplicationError(
            "media.unsupported",
            `${asset.name}: ${unsupported}`,
            422,
            { name: asset.name },
          );
        const recorded = asset.metadata["openfilm.filesystem"] as
          { size?: number; modifiedAt?: string } | undefined;
        if (asset.contentHash && recorded) {
          const info = await lstat(localPath(asset.uri));
          if (
            (recorded.size !== undefined && recorded.size !== info.size) ||
            (recorded.modifiedAt !== undefined &&
              recorded.modifiedAt !== info.mtime.toISOString())
          ) {
            if (
              (await hashFile(localPath(asset.uri), options.signal)) !==
              asset.contentHash
            )
              throw new ApplicationError(
                "source.changed",
                `Source changed after import: ${asset.name}. Import it again to refresh its duration before rendering; existing trims may exceed the new source.`,
                400,
                { name: asset.name },
              );
          }
        }
      }
      const path = await new FFmpegRenderer().render(
        composition,
        assets,
        output,
        renderSettings,
        {
          signal: options.signal,
          maximumOutputBytes: options.maximumOutputBytes,
          project: projectEvidence,
          lookOverride,
          quality,
          captionTrackId: options.captionTrackId,
          fontPathForStyle: (style) => this.titleFontPath(style),

          exportProfile,
          audioOnly: options.audioOnly,
          videoOnly: options.videoOnly,
          audioRole: options.audioRole,
          snapshot: approved,
          onProgress: (progress) => {
            const previous = job?.progress ?? 0;
            const next = Math.min(0.99, Math.max(previous, progress));
            if (next - previous < 0.01) return;
            if (job) {
              job.progress = next;
              job.updatedAt = new Date().toISOString();
              this.catalog.saveJob(job);
            }
            try {
              options.onProgress?.(next);
            } catch {
              /* A progress observer is not a render stage. */
            }
          },
        },
      );
      if (job) {
        job.status = "completed";
        job.progress = 1;
      }
      return path;
    } catch (error) {
      if (job) {
        job.status =
          options.signal?.aborted || (error as Error).name === "AbortError"
            ? "cancelled"
            : "failed";
        job.errors = [
          {
            uri: output,
            stage: "render",
            message: String(error),
            ...errorInfo(error, "render.failed"),
          },
        ];
      }
      throw error;
    } finally {
      if (job) {
        job.updatedAt = new Date().toISOString();
        this.catalog.saveJob(job);
      }
      if (trackActiveJob) this.activeJobs--;
    }
  }

  async export(
    format: "json" | "otio" | "fcpxml" | "edl",
    compositionId?: string,
  ): Promise<string> {
    return (await this.exportWithReport(format, compositionId)).path;
  }

  async exportWithReport(
    format: "json" | "otio" | "fcpxml" | "edl",
    compositionId?: string,
  ): Promise<{ path: string; report: ExportReport }> {
    const composition = this.composition(compositionId);
    const assets = this.compositionAssets(composition, true);
    const exported = exportTimeline(
      format,
      composition,
      assets,
      this.project.settings,
    );
    const compatibility =
      format === "otio" ? otioCompatibilityReport(composition) : {};
    const warnings = [...(exported.warnings ?? [])];
    for (const asset of assets) {
      const status = await sourceStatus(asset);
      if (status.status !== "available")
        warnings.push(
          `Missing or inaccessible source: ${asset.name}. Relink ${asset.id} before importing this timeline into an editor.`,
        );
      const issue = previewIssue(asset);
      if (issue) warnings.push(`${asset.name}: ${issue}`);
    }
    const report: ExportReport = {
      ...compatibility,
      format,
      warnings: [...new Set(warnings)],
    };
    if (!/^[a-z0-9]+$/u.test(exported.extension))
      throw new Error("Exporter returned an unsafe extension");
    const directory = join(this.directory, "exports");
    safeDirectorySync(directory);
    const path = join(directory, `timeline.${exported.extension}`);
    if (
      existsSync(path) &&
      (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())
    )
      throw new Error("Export target must be a regular file");
    const temporary = join(directory, `.export-${randomUUID()}`);
    writeFileSync(temporary, exported.content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, path);
    atomicJsonSync(`${path}.report.json`, report);
    return { path, report };
  }
}

export {
  TimelineEditor,
  TimelineEditorError,
  type TimelineEditorState,
  type TimelineEditInput,
  type DirectionReviewPlan,
  type DirectionAcceptanceInput,
  type DirectionReviewAcceptance,
  type SceneDirectionOptions,
  type GraphicSceneAgentAcceptance,
  type GraphicSceneAgentPlan,
  type GraphicSceneAgentRequest,
} from "./editor.js";

export {
  MediaRelinker,
  MediaRelinkError,
  type MediaSourceStatus,
  type RelinkPlan,
  type RelinkPlanInput,
  type RelinkApplyInput,
} from "./relink.js";

export type {
  HandoffRequest,
  HandoffPublication,
  HandoffReview,
} from "./nle-handoff.js";

export * from "./user-overrides.js";
