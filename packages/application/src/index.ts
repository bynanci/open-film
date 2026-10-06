import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
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
  createProject,
  ApplicationError,
  errorInfo,
  migrateProject,
  validateProject,
  type Composition,
  type Event,
  type Job,
  type MediaAsset,
  type OpenFilmProject,
  type SimilarityGroup,
  type Story,
  type FilmSettings,
  type ProjectContentLocale,
} from "@openfilm/core";
import { ProjectCatalog } from "@openfilm/catalog";
import { clusterEvents, findDuplicates } from "@openfilm/events";
import {
  createStory,
  resolveFilmSettings,
  localizeProjectContent,
  scoreAsset,
} from "@openfilm/story";
import { compose as solve } from "@openfilm/solver";
import { exportTimeline, otioCompatibilityReport } from "@openfilm/exporters";
import { proposalTemplate } from "@openfilm/template-proposal";
import { FFmpegRenderer } from "@openfilm/render";
import { enrichPixelAsset, inspectPixelDng } from "@openfilm/source-pixel";
import {
  enrichInsta360Asset,
  Insta360ImportContext,
  inspectInsta360Raw,
  isInsta360Raw,
} from "@openfilm/source-insta360";
import {
  checkAbort,
  createProxy,
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
import { isInside } from "./path-safety.js";

export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (job: Job) => void;
  proxies?: boolean;
  jobId?: string;
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
  /** Explicit scope for large libraries; every locked asset is also included. */
  assetIds?: string[];
}

export interface CreateFilmOptions {
  projectContentLocale?: ProjectContentLocale;
  filmSettings?: Partial<FilmSettings>;
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
  readonly catalog: ProjectCatalog;
  private activeJobs = 0;

  private constructor(
    readonly directory: string,
    public project: OpenFilmProject,
  ) {
    this.catalog = new ProjectCatalog(directory);
  }

  static async create(
    directory: string,
    title: string,
    options: CreateFilmOptions = {},
  ): Promise<OpenFilmApplication> {
    const path = resolve(directory);
    const project = createProject(title);
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
    return new OpenFilmApplication(canonical, project);
  }

  static async open(directory: string): Promise<OpenFilmApplication> {
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
    for (const name of ["story", "timeline", "analysis", "cache", "exports"]) {
      try {
        safeDirectorySync(join(canonical, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        mkdirSync(join(canonical, name));
      }
    }
    const application = new OpenFilmApplication(canonical, project);
    // Cache references are relative to the project, so its complete directory can move.
    for (const summary of application.catalog.iterateAssetSummaries()) {
      let asset = application.catalog.getAsset(summary.id)!;
      const managed = asset.metadata["openfilm.managedSource"] as
        { relativePath?: unknown; uri?: unknown } | undefined;
      if (
        typeof managed?.relativePath === "string" &&
        managed.uri === asset.uri &&
        managed.relativePath.startsWith("sources/") &&
        !managed.relativePath.includes("\\")
      ) {
        const managedRoot = join(canonical, "sources");
        const path = resolve(canonical, managed.relativePath);
        if (isInside(managedRoot, path) && path !== managedRoot) {
          const uri = pathToFileURL(path).href;
          const reference = referenceFor(asset, project.mediaLibraries);
          if (asset.uri !== uri) {
            asset = {
              ...asset,
              uri,
              metadata: {
                ...asset.metadata,
                "openfilm.managedSource": { ...managed, uri },
                "openfilm.reference": {
                  ...reference,
                  rootUri: pathToFileURL(managedRoot).href,
                  relativePath: relative(managedRoot, path)
                    .split(sep)
                    .join("/"),
                },
              },
            };
            application.catalog.upsertAsset(asset);
            const library = project.mediaLibraries.find(
              (item) => item.id === reference.mediaLibraryId,
            );
            if (library) library.uri = pathToFileURL(managedRoot).href;
          }
        }
      }
      const thumbnailUri =
        asset.thumbnailUri &&
        portableCacheUri(asset, asset.thumbnailUri, "thumbnails");
      const proxyUri =
        asset.proxyUri && portableCacheUri(asset, asset.proxyUri, "proxies");
      if (thumbnailUri !== asset.thumbnailUri || proxyUri !== asset.proxyUri)
        application.catalog.upsertAsset({
          ...asset,
          ...(thumbnailUri ? { thumbnailUri } : {}),
          ...(proxyUri ? { proxyUri } : {}),
        });
    }
    for (const job of application.catalog.listJobs()) {
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
                "The previous process stopped. Import again to resume completed files.",
            },
          ],
        });
    }
    return application;
  }

  private saveSync(): void {
    const project = validateProject({
      ...this.project,
      updatedAt: new Date().toISOString(),
    });
    atomicJsonSync(join(this.directory, "project.json"), project);
    this.project = project;
  }

  async save(): Promise<void> {
    this.saveSync();
  }

  get hasActiveJobs(): boolean {
    return this.activeJobs > 0;
  }

  close(): void {
    if (this.activeJobs)
      throw new Error(
        "Cancel or wait for active jobs before closing this project",
      );
    this.saveSync();
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
        const proxy = await safeProjectCachePath(
          this.directory,
          "proxies",
          `${stem}.mp4`,
        );
        const audioProxy = await safeProjectCachePath(
          this.directory,
          "proxies",
          `${stem}.mp3`,
        );
        const derivedComplete =
          previous &&
          previous.metadata["openfilm.importPipeline"] === 2 &&
          (previous.mediaType === "audio" || existsSync(thumbnail)) &&
          (options.proxies === false ||
            !["video", "360-video", "audio"].includes(previous.mediaType) ||
            (!!previous.proxyUri &&
              existsSync(previous.mediaType === "audio" ? audioProxy : proxy)));
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
          const mediaProxy = asset.mediaType === "audio" ? audioProxy : proxy;
          const extension = asset.mediaType === "audio" ? "mp3" : "mp4";
          if (!existsSync(mediaProxy)) {
            const temporary = await safeProjectCachePath(
              this.directory,
              "proxies",
              `${stem}-${job.id}.partial.${extension}`,
            );
            partials.push(temporary);
            await createProxy(asset, temporary, options.signal);
            await rename(temporary, mediaProxy);
          }
          asset.proxyUri = relative(this.directory, mediaProxy)
            .split(sep)
            .join("/");
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
        this.project.mediaLibraries.push(library);
        libraries.set(uri, library);
        this.saveSync();
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

  updateFilm(options: CreateFilmOptions): OpenFilmProject {
    const previous = this.project;
    let next =
      options.projectContentLocale === undefined
        ? structuredClone(previous)
        : localizeProjectContent(previous, options.projectContentLocale, [
            proposalTemplate,
          ]);
    if (options.filmSettings !== undefined)
      next = {
        ...next,
        filmSettings: resolveFilmSettings(
          { ...previous.filmSettings, ...options.filmSettings },
          [proposalTemplate],
        ),
      };
    validateProject(next);
    try {
      this.project = next;
      this.saveSync();
    } catch (error) {
      this.project = previous;
      throw error;
    }
    return structuredClone(this.project);
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
      !["proposal-film", "blank"].includes(options.template)
    )
      throw new ApplicationError(
        "story.invalid",
        `Unknown story template: ${options.template}`,
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
    const story = createStory(options.title ?? this.project.title, usable, {
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
    this.project.stories.push(story);
    this.saveSync();
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
    try {
      this.project = next;
      this.saveSync();
    } catch (error) {
      this.project = previous;
      throw error;
    }
    return structuredClone(updated);
  }

  compose(storyId?: string): Composition {
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
    this.project.timelines.push(composition);
    this.saveSync();
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
      ...new Set(
        composition.tracks
          .filter((track) => includeTitleAssets || track.type !== "titles")
          .flatMap((track) => track.clips.map((clip) => clip.assetId)),
      ),
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
    options: { signal?: AbortSignal; jobId?: string } = {},
  ): Promise<string> {
    return this.renderFilm(compositionId, options, false);
  }

  async exportMp4(
    compositionId?: string,
    options: { signal?: AbortSignal; jobId?: string } = {},
  ): Promise<{ path: string; report: ExportReport }> {
    const path = await this.renderFilm(compositionId, options, true);
    return { path, report: { format: "mp4", warnings: [] } };
  }

  private async renderFilm(
    compositionId: string | undefined,
    options: { signal?: AbortSignal; jobId?: string },
    exportFile: boolean,
  ): Promise<string> {
    const composition = this.composition(compositionId);
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
    const output = exportFile
      ? join(this.directory, "exports", `film-${randomUUID()}.mp4`)
      : await safeProjectCachePath(this.directory, "preview.mp4");
    const job: Job = {
      id: options.jobId ?? randomUUID(),
      type: "render",
      status: "running",
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    this.catalog.saveJob(job);
    this.activeJobs++;
    try {
      const assets = this.compositionAssets(composition);
      for (const asset of assets) {
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
        this.project.settings,
        options,
      );
      job.status = "completed";
      job.progress = 1;
      return path;
    } catch (error) {
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
      throw error;
    } finally {
      job.updatedAt = new Date().toISOString();
      this.catalog.saveJob(job);
      this.activeJobs--;
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
} from "./editor.js";

export {
  MediaRelinker,
  MediaRelinkError,
  type MediaSourceStatus,
  type RelinkPlan,
  type RelinkPlanInput,
  type RelinkApplyInput,
} from "./relink.js";
