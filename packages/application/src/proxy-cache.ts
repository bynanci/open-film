// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  opendir,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ApplicationError,
  PROXY_CACHE_LIMITS,
  errorInfo,
  graphicSceneAssetIds,
  validateProxyCacheTask,
  type Job,
  type MediaAsset,
  type OpenFilmProject,
  type ProxyCacheHealth,
  type ProxyCacheReceipt,
  type ProxyCacheTask,
} from "@openfilm/core";
import type { ProjectCatalog } from "@openfilm/catalog";
import {
  checkAbort,
  createProxy,
  hashFile,
  localPath,
  previewIssue,
  runProcess,
  withVerifiedSourceFile,
} from "@openfilm/media";
import { createReviewOwner, reviewOwnerState } from "./review-owner.js";
import {
  ProxyCacheStore,
  fileIdentity,
  proxyDigest,
  type ProxyWorkerLease,
} from "./proxy-cache-store.js";
import { portableCacheUri } from "./portable-cache.js";

export interface ProxyCacheHost {
  readonly directory: string;
  readonly project: OpenFilmProject;
  readonly catalog: ProjectCatalog;
  beginProxyWork(): void;
  endProxyWork(): void;
}
export interface ProxyQueueInput {
  projectId: string;
  requestId: string;
  assetIds: string[];
}
export interface ProxyRunResult {
  completed: number;
  failed: number;
  cancelled: number;
}
export interface ProxyCancelInput {
  projectId: string;
  jobIds?: string[];
}
export interface ProxyResumeInput {
  projectId: string;
  requestId: string;
  jobIds: string[];
}

function invalid(message: string): never {
  throw new ApplicationError("request.invalid", message);
}
function boundedId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > 512 ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid("A bounded proxy request identifier is required.");
}
function ids(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > PROXY_CACHE_LIMITS.activeTasks ||
    new Set(value).size !== value.length
  )
    invalid("Choose 1–128 distinct proxy sources.");
  for (const id of value) boundedId(id);
}
function strict(value: object, allowed: string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid("Unsupported proxy request field.");
}
export function proxyInputFingerprint(asset: MediaAsset): string {
  return proxyDigest({
    uri: asset.uri,
    hash: asset.contentHash,
    mediaType: asset.mediaType,
    duration: asset.duration,
    dimensions: asset.dimensions,
    frameRate: asset.frameRate,
    codec: asset.codec,
    hdr: asset.hdr,
    colorSpace: asset.colorSpace,
    decoding: Object.fromEntries(
      [
        "openfilm.ffprobe",
        "openfilm.color",
        "openfilm.preview",
        "openfilm.pixel",
        "openfilm.insta360",
      ].map((key) => [key, asset.metadata[key] ?? null]),
    ),
  });
}

export class ProxyCacheService {
  readonly store: ProxyCacheStore;
  private fifo: Promise<unknown> = Promise.resolve();
  private running?: Promise<ProxyRunResult>;
  private readonly controllers = new Map<string, AbortController>();
  private readonly imported = new Map<string, MediaAsset>();

  constructor(
    private readonly host: ProxyCacheHost,
    private readonly generator: typeof createProxy = createProxy,
  ) {
    this.store = new ProxyCacheStore(host.directory, host.project.id);
  }

  private project(projectId: string): void {
    boundedId(projectId);
    if (
      projectId !== this.host.project.id ||
      projectId !== this.store.projectId
    )
      throw new ApplicationError(
        "proxy.stale",
        "This proxy request belongs to another project.",
        409,
      );
  }

  private checkedAsset(
    assetId: string,
    overrides?: ReadonlyMap<string, MediaAsset>,
  ): MediaAsset {
    const asset =
      overrides?.get(assetId) ?? this.host.catalog.getAsset(assetId);
    if (!asset)
      throw new ApplicationError(
        "media.notFound",
        "Proxy source was not found.",
        404,
      );
    if (
      !["video", "audio"].includes(asset.mediaType) ||
      previewIssue(asset) ||
      !asset.uri.startsWith("file:")
    )
      throw new ApplicationError(
        "media.unsupported",
        "This source requires a supported local video or audio export before preview preparation.",
        422,
      );
    if (
      !asset.contentHash ||
      !/^[a-f0-9]{64}$/u.test(asset.contentHash) ||
      !Number.isFinite(asset.duration) ||
      asset.duration! <= 0
    )
      throw new ApplicationError(
        "media.previewUnavailable",
        "Import this source with a complete content identity and duration before preparing a preview.",
        409,
      );
    return asset;
  }

  enqueue(input: ProxyQueueInput): Job[] {
    return this.enqueueAssets(input);
  }

  private enqueueAssets(
    input: ProxyQueueInput,
    overrides?: ReadonlyMap<string, MediaAsset>,
    retryOf?: ReadonlyMap<string, string>,
  ): Job[] {
    strict(input, ["projectId", "requestId", "assetIds"]);
    this.project(input.projectId);
    boundedId(input.requestId);
    ids(input.assetIds);
    const requestFingerprint = proxyDigest(input);
    return this.host.catalog.withProjectWrite(() => {
      const [prior] = this.host.catalog.listJobs({
        type: "proxy",
        proxyRequestId: input.requestId,
        limit: 1,
      });
      if (
        prior?.proxyCache?.requestFingerprint !== undefined &&
        prior.proxyCache.requestFingerprint !== requestFingerprint
      )
        throw new ApplicationError(
          "proxy.stale",
          "The proxy request ID was already used with another body.",
          409,
        );
      const active = this.host.catalog.listJobs({
        type: "proxy",
        statuses: ["queued", "running"],
        limit: 129,
      });
      const planned: Job[] = [];
      for (const assetId of input.assetIds) {
        const jobId = `proxy-${proxyDigest([input.projectId, input.requestId, assetId])}`;
        const existing = this.host.catalog.getJob(jobId);
        if (existing) {
          if (
            !existing.proxyCache ||
            validateProxyCacheTask(existing.proxyCache).requestFingerprint !==
              requestFingerprint
          )
            throw new ApplicationError(
              "proxy.stale",
              "The proxy request ID was already used with another body.",
              409,
            );
          planned.push(existing);
          continue;
        }
        const asset = this.checkedAsset(assetId, overrides);
        const fingerprint = proxyInputFingerprint(asset);
        const duplicate = active.find(
          (job) =>
            job.assetId === assetId &&
            job.proxyCache?.inputFingerprint === fingerprint &&
            job.proxyCache?.sourceHash === asset.contentHash,
        );
        if (duplicate) {
          if (overrides) {
            planned.push(duplicate);
            continue;
          }
          throw new ApplicationError(
            "jobs.busy",
            "This source already has a matching queued proxy task.",
            409,
          );
        }
        if (active.length >= PROXY_CACHE_LIMITS.activeTasks)
          throw new ApplicationError(
            "jobs.busy",
            "The proxy queue already contains 128 active tasks.",
            409,
          );
        const job: Job = {
          id: jobId,
          type: "proxy",
          assetId,
          status: "queued",
          progress: 0,
          stage: "queued",
          createdAt: new Date().toISOString(),
          proxyCache: {
            version: 1,
            projectId: input.projectId,
            assetId,
            mediaType: asset.mediaType as "video" | "audio",
            sourceHash: asset.contentHash!,
            inputFingerprint: fingerprint,
            recipe: "ffmpeg-preview-v2",
            requestId: input.requestId,
            requestFingerprint,
            generation: 1,
            owner: createReviewOwner(),
            ...(retryOf?.get(assetId) ? { retryOf: retryOf.get(assetId) } : {}),
          },
        };
        this.host.catalog.saveJob(job);
        active.push(job);
        planned.push(job);
      }
      return structuredClone(planned);
    });
  }

  cancel(input: ProxyCancelInput): Job[] {
    strict(input, ["projectId", "jobIds"]);
    this.project(input.projectId);
    if (input.jobIds !== undefined) ids(input.jobIds);
    return this.host.catalog.withProjectWrite(() => {
      const jobs = input.jobIds
        ? input.jobIds.map((id) => this.host.catalog.getJob(id))
        : this.host.catalog.listJobs({
            type: "proxy",
            statuses: ["queued", "running"],
            limit: 128,
          });
      for (const job of jobs) {
        if (
          !job ||
          job.type !== "proxy" ||
          !job.proxyCache ||
          job.proxyCache.projectId !== input.projectId
        )
          throw new ApplicationError(
            "request.notFound",
            "Proxy task was not found in this project.",
            404,
          );
        if (job.status === "running" && !this.controllers.has(job.id))
          throw new ApplicationError(
            "jobs.busy",
            "This process does not own cancellation of that worker.",
            409,
          );
      }
      return jobs.map((value) => {
        const job = value!;
        if (!["queued", "running"].includes(job.status)) return job;
        this.controllers.get(job.id)?.abort();
        const cancelled = {
          ...job,
          status: "cancelled" as const,
          stage: "cancelled",
          updatedAt: new Date().toISOString(),
        };
        this.host.catalog.saveJob(cancelled);
        return cancelled;
      });
    });
  }

  resume(input: ProxyResumeInput): Job[] {
    strict(input, ["projectId", "requestId", "jobIds"]);
    this.project(input.projectId);
    ids(input.jobIds);
    boundedId(input.requestId);
    const jobs = input.jobIds.map((id) => this.host.catalog.getJob(id));
    const retry = new Map<string, string>();
    for (const job of jobs) {
      if (
        !job ||
        job.type !== "proxy" ||
        !job.proxyCache ||
        !["failed", "cancelled"].includes(job.status) ||
        job.proxyCache.projectId !== input.projectId
      )
        invalid("Only a failed or cancelled proxy task can be resumed.");
      if (retry.has(job.assetId!))
        invalid("Choose only one prior task for each source.");
      retry.set(job.assetId!, job.id);
    }
    return this.enqueueAssets(
      {
        projectId: input.projectId,
        requestId: input.requestId,
        assetIds: [...retry.keys()],
      },
      undefined,
      retry,
    );
  }

  recoverInterrupted(): void {
    for (const job of this.host.catalog.listJobs({
      type: "proxy",
      statuses: ["running"],
      limit: 129,
    })) {
      if (job.proxyCache && reviewOwnerState(job.proxyCache.owner) === "dead")
        this.host.catalog.saveJob({
          ...job,
          status: "failed",
          stage: "interrupted",
          updatedAt: new Date().toISOString(),
          errors: [
            {
              uri: "",
              stage: "interrupted",
              code: "media.previewUnavailable",
              message:
                "The previous proxy worker stopped. Resume explicitly to retry.",
            },
          ],
        });
    }
  }

  private exclusive<T>(
    work: (lease: ProxyWorkerLease) => Promise<T>,
  ): Promise<T> {
    this.host.beginProxyWork();
    const result = this.fifo.then(async () => {
      const lease = this.store.lease();
      try {
        return await work(lease);
      } finally {
        lease.release();
      }
    });
    this.fifo = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => this.host.endProxyWork());
  }

  runPending(input: {
    projectId: string;
    signal?: AbortSignal;
  }): Promise<ProxyRunResult> {
    strict(input, ["projectId", "signal"]);
    this.project(input.projectId);
    if (this.running) return this.running;
    const work = this.exclusive(async (lease) => {
      const result: ProxyRunResult = { completed: 0, failed: 0, cancelled: 0 };
      const jobs = this.host.catalog.listJobs({
        type: "proxy",
        statuses: ["queued"],
        limit: 128,
        oldestFirst: true,
      });
      for (const job of jobs) {
        if (input.signal?.aborted) {
          this.cancel({ projectId: input.projectId, jobIds: [job.id] });
          result.cancelled++;
          continue;
        }
        const status = await this.runOne(job.id, lease, input.signal);
        if (status === "completed") result.completed++;
        else if (status === "cancelled") result.cancelled++;
        else result.failed++;
      }
      return result;
    });
    this.running = work.finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Trusted importer preserves its synchronous completion while sharing the FIFO. */
  async prepareImportedAsset(
    asset: MediaAsset,
    signal?: AbortSignal,
  ): Promise<string> {
    const [job] = this.enqueueAssets(
      {
        projectId: this.host.project.id,
        requestId: `import-${randomUUID()}`,
        assetIds: [asset.id],
      },
      new Map([[asset.id, asset]]),
    );
    this.imported.set(job!.id, structuredClone(asset));
    try {
      await this.exclusive((lease) => this.runOne(job!.id, lease, signal));
      const completed = this.host.catalog.getJob(job!.id);
      if (completed?.status !== "completed" || !completed.proxyCache?.output)
        throw new ApplicationError(
          errorInfo(completed?.errors?.[0], "media.previewUnavailable").code,
          "Preview preparation did not complete.",
          409,
        );
      return completed.proxyCache.output.uri;
    } finally {
      this.imported.delete(job!.id);
    }
  }

  private currentTask(
    id: string,
    task: ProxyCacheTask,
    lease: ProxyWorkerLease,
    signal: AbortSignal,
  ): Job {
    checkAbort(signal);
    lease.assertOwned();
    const current = this.host.catalog.getJob(id);
    if (
      !current?.proxyCache ||
      current.status !== "running" ||
      current.proxyCache.generation !== task.generation ||
      current.proxyCache.owner.token !== task.owner.token ||
      current.proxyCache.inputFingerprint !== task.inputFingerprint
    )
      throw new ApplicationError(
        "proxy.stale",
        "This proxy attempt is no longer current.",
        409,
      );
    return current;
  }

  private async runOne(
    jobId: string,
    lease: ProxyWorkerLease,
    parent?: AbortSignal,
  ): Promise<Job["status"]> {
    let job = this.host.catalog.getJob(jobId)!;
    if (job.status !== "queued") return job.status;
    const initial = validateProxyCacheTask(job.proxyCache);
    this.project(initial.projectId);
    const task: ProxyCacheTask = {
      ...initial,
      generation: initial.generation + 1,
      owner: lease.owner,
    };
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    const signal = parent
      ? AbortSignal.any([parent, controller.signal])
      : controller.signal;
    job = {
      ...job,
      proxyCache: task,
      status: "running",
      stage: "verifying",
      updatedAt: new Date().toISOString(),
    };
    this.host.catalog.saveJob(job);
    let work: string | undefined;
    try {
      const asset = this.checkedAsset(
        task.assetId,
        this.imported.has(jobId)
          ? new Map([[task.assetId, this.imported.get(jobId)!]])
          : undefined,
      );
      if (
        asset.contentHash !== task.sourceHash ||
        proxyInputFingerprint(asset) !== task.inputFingerprint
      )
        throw new ApplicationError(
          "source.changed",
          "The queued source changed before proxy preparation.",
          409,
        );
      lease.assertOwned();
      this.store.ensure();
      work = await mkdtemp(join(this.store.work, `${jobId}-`));
      await writeFile(
        join(work, "owner.json"),
        JSON.stringify({
          version: 1,
          projectId: task.projectId,
          jobId,
          generation: task.generation,
          owner: lease.owner,
        }),
        { flag: "wx", mode: 0o600 },
      );
      const capacity = await statfs(work);
      const maximumBytes = Math.max(
        0,
        Math.min(
          Number.MAX_SAFE_INTEGER,
          capacity.bavail * capacity.bsize - 64 * 1024 ** 2,
        ),
      );
      const artifactId = proxyDigest([jobId, task.generation, randomUUID()]);
      const extension = task.mediaType === "audio" ? "mp3" : "mp4";
      const output = join(work, `preview.${extension}`);
      const inventory = await this.inventory();
      if (!inventory.complete)
        throw new ApplicationError(
          "proxy.storageUnavailable",
          "Proxy inventory is incomplete; review storage before generating more files.",
          409,
        );
      const remaining =
        this.store.policy().quotaBytes -
        inventory.managedBytes -
        PROXY_CACHE_LIMITS.receiptBytes;
      if (remaining <= 0)
        throw new ApplicationError(
          "proxy.quotaExceeded",
          "Managed preview storage is full; review cleanup or increase its quota.",
          409,
        );
      await withVerifiedSourceFile(
        localPath(asset.uri),
        task.sourceHash,
        async (snapshot) => {
          this.currentTask(jobId, task, lease, signal);
          await this.generator(
            { ...asset, uri: pathToFileURL(snapshot).href },
            output,
            signal,
            { maximumBytes: remaining },
          );
        },
        { signal, temporaryRoot: work, maximumBytes },
      );
      const outputInfo = await lstat(output);
      if (
        !outputInfo.isFile() ||
        outputInfo.isSymbolicLink() ||
        outputInfo.size > remaining
      )
        throw new ApplicationError(
          "proxy.quotaExceeded",
          "The preview does not fit its storage bound.",
          409,
        );
      const probe = JSON.parse(
        (
          await runProcess(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_streams",
              "-show_format",
              "-of",
              "json",
              output,
            ],
            { signal, maxOutputBytes: 1024 ** 2 },
          )
        ).stdout.toString("utf8"),
      ) as {
        format: { duration?: string };
        streams: Array<{
          codec_type?: string;
          width?: number;
          height?: number;
        }>;
      };
      const duration = Number(probe.format?.duration);
      const video = probe.streams.find(
        (stream) => stream.codec_type === "video",
      );
      const tolerance = Math.max(0.1, 2 / (asset.frameRate ?? 30));
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        Math.abs(duration - asset.duration!) > tolerance ||
        (task.mediaType === "video"
          ? !video ||
            !video.width ||
            !video.height ||
            video.width > 640 ||
            video.height > 360
          : !probe.streams.some((stream) => stream.codec_type === "audio"))
      )
        throw new ApplicationError(
          "media.previewUnavailable",
          "The decoded preview does not preserve its expected streams, dimensions or duration.",
          409,
        );
      const outputHash = await hashFile(output, signal);
      const source = localPath(asset.uri);
      const sourceInfo = await lstat(source);
      if (
        !sourceInfo.isFile() ||
        sourceInfo.isSymbolicLink() ||
        (await hashFile(source, signal)) !== task.sourceHash
      )
        throw new ApplicationError(
          "source.changed",
          "The original source changed during preview preparation.",
          409,
        );
      const sourceIdentity = fileIdentity(lstatSync(source));
      if (fileIdentity(sourceInfo) !== sourceIdentity)
        throw new ApplicationError(
          "source.changed",
          "The original changed while its final hash was read.",
          409,
        );
      const receipt: ProxyCacheReceipt = {
        version: 1,
        projectId: task.projectId,
        artifactId,
        jobId,
        generation: task.generation,
        assetId: task.assetId,
        mediaType: task.mediaType,
        sourceHash: task.sourceHash,
        inputFingerprint: task.inputFingerprint,
        recipe: task.recipe,
        createdAt: new Date().toISOString(),
        output: {
          uri: `cache/proxies/managed/${artifactId}.${extension}`,
          hash: outputHash,
          byteLength: outputInfo.size,
          duration,
          ...(video ? { width: video.width!, height: video.height! } : {}),
        },
      };
      const readyPath = this.store.outputPath(receipt);
      this.currentTask(jobId, task, lease, signal);
      await link(output, readyPath);
      const published = lstatSync(readyPath);
      if (
        published.dev !== outputInfo.dev ||
        published.ino !== outputInfo.ino ||
        published.size !== outputInfo.size ||
        published.mtimeMs !== outputInfo.mtimeMs
      )
        throw new ApplicationError(
          "proxy.stale",
          "The linked proxy identity changed.",
          409,
        );
      const publishedIdentity = fileIdentity(published);
      this.store.saveReceipt(receipt);
      this.host.catalog.withProjectWrite(() => {
        const current = this.currentTask(jobId, task, lease, signal);
        const fresh = this.host.catalog.getAsset(task.assetId);
        if (
          (!fresh && !this.imported.has(jobId)) ||
          (fresh &&
            !this.imported.has(jobId) &&
            proxyInputFingerprint(fresh) !== task.inputFingerprint) ||
          fileIdentity(lstatSync(source)) !== sourceIdentity ||
          fileIdentity(lstatSync(readyPath)) !== publishedIdentity
        )
          throw new ApplicationError(
            "source.changed",
            "Source or preview identity changed before publication.",
            409,
          );
        // Preferences are private cache state. Rebuild must not alter a locked
        // source's canonical Named Version identity or any editor history.
        this.store.setPreferred(task.assetId, receipt.artifactId);
        this.host.catalog.saveJob({
          ...current,
          status: "completed",
          stage: "ready",
          progress: 100,
          updatedAt: new Date().toISOString(),
          proxyCache: { ...task, output: receipt.output },
        });
      });
      return "completed";
    } catch (error) {
      const current = this.host.catalog.getJob(jobId);
      const status =
        signal.aborted || current?.status === "cancelled"
          ? "cancelled"
          : "failed";
      if (
        current?.proxyCache?.generation === task.generation &&
        current.proxyCache.owner.token === task.owner.token &&
        ["running", "cancelled"].includes(current.status)
      )
        this.host.catalog.saveJob({
          ...current,
          status,
          stage: status,
          updatedAt: new Date().toISOString(),
          errors:
            status === "cancelled"
              ? []
              : [
                  {
                    uri: "",
                    stage: "proxy",
                    message:
                      "Preview preparation failed; inspect the typed reason and retry.",
                    code: errorInfo(error, "media.previewUnavailable").code,
                  },
                ],
        });
      return status;
    } finally {
      this.controllers.delete(jobId);
      if (work) await rm(work, { recursive: true, force: true });
    }
  }

  protectedAssets(): Set<string> {
    const protectedIds = new Set<string>();
    for (const asset of this.host.catalog.iterateAssetSummaries())
      if (asset.state.locked) protectedIds.add(asset.id);
    for (const composition of this.host.project.timelines) {
      for (const track of composition.tracks)
        for (const clip of track.clips) protectedIds.add(clip.assetId);
      for (const id of graphicSceneAssetIds(composition.graphicScenes ?? []))
        protectedIds.add(id);
    }
    return protectedIds;
  }

  async isAvailable(asset: MediaAsset): Promise<boolean> {
    if (this.readyReceipt(asset)) return true;
    if (!asset.proxyUri) return false;
    const uri = portableCacheUri(asset, asset.proxyUri, "proxies");
    const root = join(this.host.directory, "cache/proxies");
    const path = resolve(this.host.directory, uri);
    const rel = relative(root, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      return false;
    try {
      this.store.ensure();
      const artifactId = this.store.artifactId(uri);
      if (artifactId) {
        const receipt = this.store.receipt(artifactId)?.receipt;
        if (
          !receipt ||
          receipt.assetId !== asset.id ||
          receipt.sourceHash !== asset.contentHash ||
          receipt.inputFingerprint !== proxyInputFingerprint(asset)
        )
          return false;
        const info = await lstat(path);
        return (
          info.isFile() &&
          !info.isSymbolicLink() &&
          info.size === receipt.output.byteLength
        );
      }
      if (rel.includes(sep)) return false;
      const info = await lstat(path);
      return info.isFile() && !info.isSymbolicLink();
    } catch {
      return false;
    }
  }

  readyReceipt(asset: MediaAsset): ProxyCacheReceipt | undefined {
    const candidates = [
      this.store.preferred(asset.id),
      this.store.artifactId(asset.proxyUri),
    ];
    for (const id of new Set(candidates)) {
      if (!id) continue;
      const receipt = this.store.receipt(id)?.receipt;
      if (
        !receipt ||
        receipt.assetId !== asset.id ||
        receipt.sourceHash !== asset.contentHash ||
        receipt.inputFingerprint !== proxyInputFingerprint(asset)
      )
        continue;
      try {
        const info = lstatSync(this.store.outputPath(receipt));
        if (
          info.isFile() &&
          !info.isSymbolicLink() &&
          info.size === receipt.output.byteLength
        )
          return receipt;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return undefined;
  }

  async inventory(): Promise<{
    managedBytes: number;
    unmanagedBytes: number;
    temporaryBytes: number;
    complete: boolean;
  }> {
    this.store.ensure();
    let visited = 0;
    let complete = true;
    const scan = async (directory: string, depth: number): Promise<number> => {
      let bytes = 0;
      for await (const entry of await opendir(directory)) {
        if (++visited > PROXY_CACHE_LIMITS.inventoryFiles) {
          complete = false;
          break;
        }
        const path = join(directory, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
          complete = false;
          continue;
        }
        if (info.isFile()) bytes += info.size;
        else if (info.isDirectory() && depth > 0)
          bytes += await scan(path, depth - 1);
        else complete = false;
      }
      return bytes;
    };
    const managedBytes = await scan(this.store.managed, 0);
    let unmanagedBytes = 0;
    for await (const entry of await opendir(
      join(this.host.directory, "cache/proxies"),
    )) {
      if (entry.name === "managed") continue;
      if (++visited > PROXY_CACHE_LIMITS.inventoryFiles) {
        complete = false;
        break;
      }
      const info = await lstat(
        join(this.host.directory, "cache/proxies", entry.name),
      );
      if (info.isSymbolicLink() || !info.isFile()) {
        complete = false;
        continue;
      }
      unmanagedBytes += info.size;
    }
    const temporaryBytes = await scan(this.store.work, 3);
    return { managedBytes, unmanagedBytes, temporaryBytes, complete };
  }

  async health(input: {
    projectId: string;
    offset?: number;
    limit?: number;
  }): Promise<ProxyCacheHealth> {
    strict(input, ["projectId", "offset", "limit"]);
    this.project(input.projectId);
    const offset = input.offset ?? 0;
    const limit = input.limit ?? PROXY_CACHE_LIMITS.pageSize;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      invalid("Invalid proxy health page.");
    const inventory = await this.inventory();
    const protectedIds = this.protectedAssets();
    const videoCount = this.host.catalog.countAssets({ mediaType: "video" });
    const audioCount = this.host.catalog.countAssets({ mediaType: "audio" });
    const assets =
      offset < videoCount
        ? this.host.catalog.listAssets({
            mediaType: "video",
            offset,
            limit: Math.min(limit, videoCount - offset),
            order: "name",
          })
        : [];
    if (
      assets.length < limit &&
      offset + assets.length >= videoCount &&
      audioCount > Math.max(0, offset - videoCount)
    )
      assets.push(
        ...this.host.catalog.listAssets({
          mediaType: "audio",
          offset: Math.max(0, offset - videoCount),
          limit: limit - assets.length,
          order: "name",
        }),
      );
    const entries: ProxyCacheHealth["entries"] = [];
    for (const asset of assets) {
      if (!["video", "audio"].includes(asset.mediaType)) continue;
      const [job] = this.host.catalog.listJobs({
        type: "proxy",
        assetId: asset.id,
        limit: 1,
      });
      let status: ProxyCacheHealth["entries"][number]["status"] =
        job?.status === "completed" ? "missing" : (job?.status ?? "missing");
      let bytes: number | undefined;
      let verification: "recorded" | "unchecked" = "unchecked";
      if (
        !this.readyReceipt(asset) &&
        asset.proxyUri &&
        !["queued", "running"].includes(job?.status ?? "")
      ) {
        const artifactId = this.store.artifactId(asset.proxyUri);
        if (!artifactId) status = "legacy";
        else {
          try {
            const receipt = this.store.receipt(artifactId)?.receipt;
            if (!receipt) status = "unavailable";
            else if (
              receipt.assetId !== asset.id ||
              receipt.sourceHash !== asset.contentHash ||
              receipt.inputFingerprint !== proxyInputFingerprint(asset)
            )
              status = "stale";
            else {
              const info = await lstat(this.store.outputPath(receipt));
              status =
                info.isFile() &&
                !info.isSymbolicLink() &&
                info.size === receipt.output.byteLength
                  ? "ready"
                  : "stale";
              bytes = info.size;
              verification = "recorded";
            }
          } catch (error) {
            status =
              (error as NodeJS.ErrnoException).code === "ENOENT"
                ? "missing"
                : "unavailable";
          }
        }
      }
      const ready = this.readyReceipt(asset);
      if (ready && !["queued", "running"].includes(job?.status ?? "")) {
        status = "ready";
        bytes = ready.output.byteLength;
        verification = "recorded";
      }
      entries.push({
        assetId: asset.id,
        name: asset.name,
        status,
        bytes,
        jobId: job?.id,
        protected: protectedIds.has(asset.id),
        verification,
      });
    }
    const queued = this.host.catalog.listJobs({
      type: "proxy",
      statuses: ["queued"],
      limit: 129,
    }).length;
    const total = videoCount + audioCount;
    return {
      version: 1,
      projectId: input.projectId,
      policy: this.store.policy(),
      managedBytes: inventory.managedBytes,
      unmanagedBytes: inventory.unmanagedBytes,
      temporaryBytes: inventory.temporaryBytes,
      inventoryComplete: inventory.complete,
      running: !!this.running || this.controllers.size > 0,
      queued,
      recovery: this.store.recovery(),
      entries,
      total,
      offset,
      hasNext: offset + assets.length < total,
    };
  }
}
