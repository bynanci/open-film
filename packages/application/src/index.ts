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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createProject,
  migrateProject,
  validateProject,
  type Composition,
  type Event,
  type Job,
  type MediaAsset,
  type OpenFilmProject,
  type SimilarityGroup,
  type Story,
} from "@openfilm/core";
import { ProjectCatalog } from "@openfilm/catalog";
import { clusterEvents, findDuplicates } from "@openfilm/events";
import { createStory } from "@openfilm/story";
import { compose as solve } from "@openfilm/solver";
import { exportTimeline } from "@openfilm/exporters";
import { proposalTemplate } from "@openfilm/template-proposal";
import { FFmpegRenderer } from "@openfilm/render";
import {
  checkAbort,
  createProxy,
  createThumbnail,
  FilesystemSource,
  hashFile,
  inspectMedia,
  localPath,
  perceptualHash,
  safeProjectCachePath,
  type MediaCandidate,
} from "@openfilm/media";

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

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep))
  );
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
  ): Promise<OpenFilmApplication> {
    const path = resolve(directory);
    const project = createProject(title);
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
    const sourceFolder = folder.startsWith("file:")
      ? localPath(folder)
      : folder;
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
    const process = async (candidate: MediaCandidate): Promise<void> => {
      let stage = "fingerprint";
      const partials: string[] = [];
      try {
        checkAbort(options.signal);
        if (isInside(this.directory, candidate.path)) {
          result.skipped++;
          return;
        }
        const assetId = createHash("sha256")
          .update(candidate.uri)
          .digest("hex")
          .slice(0, 32);
        const originalHash = await hashFile(candidate.path, options.signal);
        const previous = this.catalog.getAsset(assetId);
        const stem = `${assetId}-${originalHash.slice(0, 16)}`;
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
        const derivedComplete =
          previous &&
          (previous.mediaType === "audio" || existsSync(thumbnail)) &&
          (options.proxies === false ||
            !["video", "360-video"].includes(previous.mediaType) ||
            existsSync(proxy));
        if (previous?.contentHash === originalHash && derivedComplete) {
          result.skipped++;
          return;
        }
        stage = "inspect";
        const asset = await inspectMedia(candidate, options.signal);
        asset.contentHash = originalHash;
        if (previous) {
          asset.state = structuredClone(previous.state);
          asset.tags = [...previous.tags];
          if (previous.rating !== undefined) asset.rating = previous.rating;
          asset.metadata = { ...previous.metadata, ...asset.metadata };
        }
        if (asset.mediaType !== "audio") {
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
          asset.thumbnailUri = pathToFileURL(thumbnail).href;
        }
        if (
          options.proxies !== false &&
          ["video", "360-video"].includes(asset.mediaType)
        ) {
          stage = "proxy";
          if (!existsSync(proxy)) {
            const temporary = await safeProjectCachePath(
              this.directory,
              "proxies",
              `${stem}-${job.id}.partial.mp4`,
            );
            partials.push(temporary);
            await createProxy(asset, temporary, options.signal);
            await rename(temporary, proxy);
          }
          asset.proxyUri = pathToFileURL(proxy).href;
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
    try {
      checkAbort(options.signal);
      job.status = "running";
      publish();
      for await (const candidate of new FilesystemSource().discover(
        sourceFolder,
        options.signal,
      )) {
        checkAbort(options.signal);
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
      const uri = pathToFileURL(await realpath(sourceFolder)).href;
      if (!this.project.mediaLibraries.some((library) => library.uri === uri))
        this.project.mediaLibraries.push({
          id: randomUUID(),
          uri,
          name: basename(sourceFolder),
        });
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
          uri: folder,
          stage: "discover",
          message: String(error),
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

  generateStory(options: StoryOptions = {}): Story {
    if (
      options.template &&
      !["proposal-film", "blank"].includes(options.template)
    )
      throw new Error(`Unknown story template: ${options.template}`);
    const assets: MediaAsset[] = [];
    if (options.assetIds) {
      const ids = new Set(options.assetIds);
      for (const asset of this.catalog.iterateAssetSummaries())
        if (asset.state.locked) ids.add(asset.id);
      if (ids.size > 2000)
        throw new Error(
          "A story can use at most 2000 candidates; reduce the scope or unlock assets",
        );
      for (const id of ids) {
        const asset = this.catalog.getAsset(id);
        if (!asset) throw new Error(`Story candidate not found: ${id}`);
        assets.push(asset);
      }
    } else {
      if (this.catalog.countAssets() > 2000)
        throw new Error(
          "Choose an explicit assetIds story scope for libraries above 2000 assets; locked assets will be included",
        );
      for (let offset = 0; ; offset += 500) {
        const page = this.catalog.listAssets({ offset, limit: 500 });
        assets.push(...page);
        if (page.length < 500) break;
      }
    }
    if (!assets.length) throw new Error("Import media before creating a story");
    const story = createStory(options.title ?? this.project.title, assets, {
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
    const composition = solve(story, assets);
    this.project.timelines.push(composition);
    this.saveSync();
    return structuredClone(composition);
  }

  private composition(id?: string): Composition {
    const composition = id
      ? this.project.timelines.find((item) => item.id === id)
      : this.project.timelines.at(-1);
    if (!composition) throw new Error("Compose a timeline first");
    return composition;
  }

  private compositionAssets(composition: Composition): MediaAsset[] {
    return [
      ...new Set(
        composition.tracks
          .filter((track) => track.type !== "titles")
          .flatMap((track) => track.clips.map((clip) => clip.assetId)),
      ),
    ].map((id) => {
      const asset = this.catalog.getAsset(id);
      if (!asset) throw new Error(`Timeline asset not found: ${id}`);
      return asset;
    });
  }

  async render(
    compositionId?: string,
    options: { signal?: AbortSignal; jobId?: string } = {},
  ): Promise<string> {
    const composition = this.composition(compositionId);
    const story = this.project.stories.find(
      (item) => item.id === composition.storyId,
    );
    if (
      story?.maxDuration !== undefined &&
      composition.duration > story.maxDuration + 0.00001
    )
      throw new Error(
        "Timeline exceeds the story maximum duration; compose again before rendering",
      );
    const output = await safeProjectCachePath(this.directory, "preview.mp4");
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
      const path = await new FFmpegRenderer().render(
        composition,
        this.compositionAssets(composition),
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
      job.errors = [{ uri: output, stage: "render", message: String(error) }];
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
    const composition = this.composition(compositionId);
    const exported = exportTimeline(
      format,
      composition,
      this.compositionAssets(composition),
      this.project.settings,
    );
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
    return path;
  }
}

export {
  TimelineEditor,
  TimelineEditorError,
  type TimelineEditorState,
  type TimelineEditInput,
} from "./editor.js";
