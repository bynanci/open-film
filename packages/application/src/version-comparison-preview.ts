// Modified by OpenFilm contributors on 2026-11-13. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  open,
  readdir,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  ApplicationError,
  frameAlignedDuration,
  projectFrameRate,
  resolveProjectTimebase,
  resolveCompositionCoverageBindings,
  type ReviewExecutionOwner,
  type TitleStyle,
  type OpenFilmProject,
} from "@openfilm/core";
import { checkAbort, runProcess, safeProjectCachePath } from "@openfilm/media";
import {
  FFmpegRenderer,
  audioSourceAssetIds,
  renderSourceAssetIds,
  type RenderOptions,
} from "@openfilm/render";
import type { OpenFilmApplication } from "./index.js";
import type { ProjectVersionPreviewSnapshot } from "./project-versions.js";
import { acquireExportRequestLock } from "./export-request-lock.js";
import { createReviewOwner, reviewOwnerState } from "./review-owner.js";

export interface VersionComparisonPreviewInput {
  projectId: string;
  requestId: string;
  a: { versionId: string; compositionId?: string };
  b: { versionId: string; compositionId?: string };
}
export interface VersionComparisonPreviewSide {
  versionId: string;
  versionName: string;
  projectHash: string;
  catalogHash: string;
  snapshotIdentity: string;
  compositionId: string;
  compositionSha256: string;
  settingsSha256: string;
  sourceKeyDigest: string;
  compositionDuration: number;
  duration: number;
  frameRate: number;
  hasAudio: boolean;
  sha256: string;
  bytes: number;
  warnings: string[];
}
export interface VersionComparisonPreviewDescriptor {
  version: 1;
  id: string;
  projectId: string;
  expiresAt: string;
  a: VersionComparisonPreviewSide;
  b: VersionComparisonPreviewSide;
}
const FILE_LIMIT = 1024 ** 3,
  CACHE_LIMIT = 2 * FILE_LIMIT,
  TTL = 15 * 60 * 1000;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu;
const requestKey = (input: VersionComparisonPreviewInput) =>
  digest({
    projectId: input.projectId,
    requestId: input.requestId,
    a: { versionId: input.a.versionId, compositionId: input.a.compositionId },
    b: { versionId: input.b.versionId, compositionId: input.b.compositionId },
  });
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function conflict(
  message = "Comparison is unavailable or changed. Prepare again with a new request ID.",
): never {
  throw new ApplicationError("timeline.conflict", message, 409);
}
function invalid(): never {
  throw new ApplicationError(
    "request.invalid",
    "Choose two saved versions and a valid comparison request ID.",
    400,
  );
}
function exact(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => keys.includes(k))
  );
}
export function validateVersionComparisonPreviewInput(
  input: VersionComparisonPreviewInput,
): void {
  if (
    !exact(input, ["projectId", "requestId", "a", "b"]) ||
    typeof input.projectId !== "string" ||
    !input.projectId.trim() ||
    input.projectId.length > 256 ||
    [...input.projectId].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ) ||
    !UUID.test(input.requestId)
  )
    invalid();
  for (const side of [input.a, input.b]) {
    if (
      !exact(side, ["versionId", "compositionId"]) ||
      typeof side.versionId !== "string" ||
      !UUID.test(side.versionId) ||
      (side.compositionId !== undefined &&
        (typeof side.compositionId !== "string" ||
          !side.compositionId.trim() ||
          side.compositionId.length > 256 ||
          [...side.compositionId].some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
          )))
    )
      invalid();
  }
}
function same(a: Stats, b: Stats): boolean {
  return (
    a.isFile() &&
    b.isFile() &&
    !a.isSymbolicLink() &&
    !b.isSymbolicLink() &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
async function hashHandle(
  file: FileHandle,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(1024 * 1024);
  for (let position = 0; ;) {
    checkAbort(signal);
    const read = await file.read(buffer, 0, buffer.length, position);
    if (!read.bytesRead) break;
    hash.update(buffer.subarray(0, read.bytesRead));
    position += read.bytesRead;
  }
  checkAbort(signal);
  return hash.digest("hex");
}
interface Output {
  path: string;
  identity: Stats;
  side: VersionComparisonPreviewSide;
}
interface Pair {
  descriptor: VersionComparisonPreviewDescriptor;
  input: VersionComparisonPreviewInput;
  directory: string;
  directoryIdentity: Stats;
  generation: number;
  /** Captured immutable snapshots keep repeated browser range reads cheap while
   * their synchronous guards still check payload identity and source stat state. */
  snapshots: {
    a: ProjectVersionPreviewSnapshot;
    b: ProjectVersionPreviewSnapshot;
  };
  outputs: { a: Output; b: Output };
  abort: AbortController;
  reads: Set<Promise<unknown>>;
  release: () => void;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: Promise<void>;
  ownership?: Ownership;
}
interface Ownership {
  owner: ReviewExecutionOwner;
  assertCurrent(ready?: boolean): void;
}
/** Ephemeral private MP4s. The export lock is held until all ready-pair reads and cleanup drain. */
export class VersionComparisonPreviewService {
  private pair?: Pair;
  private active = false;
  private preparing?: {
    requestId: string;
    abort: AbortController;
    done: Promise<void>;
    resolve: () => void;
  };
  private closed = new AbortController();
  private cleanup = new Set<Promise<void>>();
  constructor(
    private readonly app: OpenFilmApplication,
    private readonly fontPath: (
      style: TitleStyle | undefined,
      settings: OpenFilmProject["settings"],
    ) => string | undefined,
  ) {}
  get isPreparing(): boolean {
    return this.active;
  }
  private assertProject(projectId: string, generation?: number) {
    if (
      this.pair &&
      (this.pair.descriptor.projectId !== this.app.project.id ||
        this.pair.generation !== this.app.projectGeneration)
    )
      void this.revoke(this.pair).catch(() => undefined);
    if (
      this.closed.signal.aborted ||
      projectId !== this.app.project.id ||
      (generation !== undefined && generation !== this.app.projectGeneration)
    )
      conflict();
  }
  private combined(signal?: AbortSignal, pair?: Pair) {
    return AbortSignal.any([
      this.closed.signal,
      ...(pair ? [pair.abort.signal] : []),
      ...(signal ? [signal] : []),
    ]);
  }
  private async removeOwned(directory: string, identity: Stats): Promise<void> {
    const path = await safeProjectCachePath(
      this.app.directory,
      "version-comparison",
      basename(directory),
      ".cleanup-check",
    );
    if (dirname(path) !== directory) conflict();
    const current = await lstat(directory);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    )
      conflict();
    await rm(directory, { recursive: true, force: true });
  }
  private revoke(pair: Pair): Promise<void> {
    if (pair.cleanup) return pair.cleanup;
    if (this.pair === pair) this.pair = undefined;
    clearTimeout(pair.timer);
    pair.abort.abort();
    const cleanup = (async () => {
      await Promise.allSettled([...pair.reads]);
      // Lock release follows deletion, so another process cannot race active readers.
      await this.removeOwned(pair.directory, pair.directoryIdentity);
      pair.release();
    })().catch((error) => {
      throw this.safeError(error, this.combined());
    });
    pair.cleanup = cleanup;
    this.cleanup.add(cleanup);
    void cleanup.then(
      () => this.cleanup.delete(cleanup),
      () => this.cleanup.delete(cleanup),
    );
    return cleanup;
  }
  dispose(): void {
    this.closed.abort();
    if (this.pair) void this.revoke(this.pair).catch(() => undefined);
  }
  /** Awaitable filesystem-only cleanup for lifecycle owners after cancelling preparation. */
  async drain(): Promise<void> {
    await Promise.all([...this.cleanup]);
  }
  private entry(projectId: string, id: string): Pair {
    this.assertProject(projectId);
    if (!UUID.test(id) || !this.pair || this.pair.descriptor.id !== id)
      conflict();
    const pair = this.pair;
    if (Date.now() >= Date.parse(pair.descriptor.expiresAt)) {
      void this.revoke(pair).catch(() => undefined);
      conflict("Comparison expired. Prepare again with a new request ID.");
    }
    this.assertProject(projectId, pair.generation);
    return pair;
  }
  private track<T>(pair: Pair, fn: () => Promise<T>): Promise<T> {
    const task = Promise.resolve().then(fn);
    pair.reads.add(task);
    void task.then(
      () => pair.reads.delete(task),
      () => pair.reads.delete(task),
    );
    return task;
  }
  private checkPair(pair: Pair, signal: AbortSignal): void {
    this.assertProject(pair.descriptor.projectId, pair.generation);
    checkAbort(signal);
    pair.ownership?.assertCurrent(true);
    for (const side of ["a", "b"] as const) {
      const expected = pair.descriptor[side],
        captured = pair.snapshots[side];
      if (
        captured.identity !== expected.snapshotIdentity ||
        captured.versionId !== expected.versionId ||
        captured.composition.id !== expected.compositionId
      )
        conflict();
      captured.assertCurrent();
    }
    checkAbort(signal);
    this.assertProject(pair.descriptor.projectId, pair.generation);
  }
  private async openOutput(output: Output): Promise<FileHandle> {
    const before = await lstat(output.path);
    if (!same(before, output.identity)) conflict();
    const file = await open(
      output.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      if (
        !same(before, await file.stat()) ||
        !same(before, await lstat(output.path))
      )
        conflict();
      return file;
    } catch (error) {
      await file.close();
      throw error;
    }
  }
  async get(
    projectId: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<VersionComparisonPreviewDescriptor> {
    const pair = this.entry(projectId, id),
      combined = this.combined(signal, pair);
    return this.track(pair, async () => {
      try {
        await this.checkPair(pair, combined);
        for (const side of ["a", "b"] as const) {
          const file = await this.openOutput(pair.outputs[side]);
          await file.close();
        }
        checkAbort(combined);
        return structuredClone(pair.descriptor);
      } catch (error) {
        if (!signal?.aborted) void this.revoke(pair).catch(() => undefined);
        throw this.safeError(error, combined);
      }
    });
  }
  async withMedia<T>(
    projectId: string,
    id: string,
    side: "a" | "b",
    consume: (
      file: FileHandle,
      facts: { size: number; sha256: string },
      signal: AbortSignal,
    ) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (side !== "a" && side !== "b") invalid();
    const pair = this.entry(projectId, id),
      combined = this.combined(signal, pair);
    return this.track(pair, async () => {
      let file: FileHandle | undefined;
      let validated = false;
      try {
        await this.checkPair(pair, combined);
        file = await this.openOutput(pair.outputs[side]);
        checkAbort(combined);
        validated = true;
        return await consume(
          file,
          {
            size: pair.descriptor[side].bytes,
            sha256: pair.descriptor[side].sha256,
          },
          combined,
        );
      } catch (error) {
        if (validated) throw error;
        if (!signal?.aborted) void this.revoke(pair).catch(() => undefined);
        throw this.safeError(error, combined);
      } finally {
        await file?.close();
      }
    });
  }
  async discard(projectId: string, id: string): Promise<void> {
    this.assertProject(projectId);
    if (!UUID.test(id)) invalid();
    if (this.pair?.descriptor.id === id) await this.revoke(this.pair);
    await this.drain();
  }
  /** Revoke only this request; abort and await owned preparation before ready cleanup. */
  async discardRequest(projectId: string, requestId: string): Promise<void> {
    this.assertProject(projectId);
    if (!UUID.test(requestId)) invalid();
    const preparing = this.preparing;
    if (preparing?.requestId === requestId) {
      preparing.abort.abort();
      await preparing.done;
    }
    if (this.pair?.input.requestId === requestId) await this.revoke(this.pair);
    await this.drain();
  }
  /** Idempotent ready lookup. Inputs retain exact ordered selector spelling; omitted/explicit IDs differ. */
  async reuse(
    input: VersionComparisonPreviewInput,
    signal?: AbortSignal,
  ): Promise<VersionComparisonPreviewDescriptor | undefined> {
    validateVersionComparisonPreviewInput(input);
    this.assertProject(input.projectId);
    if (this.pair?.input.requestId !== input.requestId) return undefined;
    if (requestKey(this.pair.input) !== requestKey(input))
      conflict(
        "This request ID already belongs to different comparison targets.",
      );
    return this.get(input.projectId, this.pair.descriptor.id, signal);
  }
  private safeError(error: unknown, signal: AbortSignal): Error {
    if (
      signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      const e = new Error("Comparison preparation cancelled.");
      e.name = "AbortError";
      return e;
    }
    // Renderer, filesystem and saved-source diagnostics may contain private paths.
    return new ApplicationError(
      "media.previewUnavailable",
      "Saved-version comparison is unavailable. Verify the saved versions and source media, then retry with a new request ID.",
      409,
    );
  }
  private async inventory(root: string): Promise<number> {
    let count = 0;
    const walk = async (path: string, depth: number): Promise<number> => {
      if (depth > 4) conflict("Comparison cache requires inspection.");
      let total = 0;
      for (const name of await readdir(path)) {
        if (++count > 256)
          conflict("Comparison cache inventory exceeds its bound.");
        const child = join(path, name),
          info = await lstat(child);
        if (info.isSymbolicLink())
          conflict("Comparison cache requires inspection.");
        if (info.isFile()) total += info.size;
        else if (info.isDirectory()) total += await walk(child, depth + 1);
        else conflict("Comparison cache requires inspection.");
        if (total > CACHE_LIMIT)
          conflict("Comparison cache exceeds its 2 GiB bound.");
      }
      return total;
    };
    return walk(root, 0);
  }
  private async reclaim(root: string) {
    const names = await readdir(root);
    if (names.length > 64) conflict("Comparison cache requires inspection.");
    for (const name of names) {
      if (name === "prepare.lock") continue;
      if (!UUID.test(name))
        conflict("Comparison cache has unverified ownership.");
      const path = join(root, name),
        info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        conflict("Comparison cache has unverified ownership.");
      const file = await open(
        join(path, "owner.json"),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 4096) conflict();
        const marker = JSON.parse(await file.readFile("utf8")) as {
          id: string;
          projectId: string;
          owner: ReviewExecutionOwner;
        };
        if (
          marker.id !== name ||
          marker.projectId !== this.app.project.id ||
          reviewOwnerState(marker.owner) !== "dead"
        )
          conflict(
            "Another comparison cache owner is active or cannot be verified.",
          );
        if (!same(stat, await lstat(join(path, "owner.json")))) conflict();
      } finally {
        await file.close();
      }
      await this.inventory(path);
      const after = await lstat(path);
      if (info.dev !== after.dev || info.ino !== after.ino) conflict();
      await rm(path, { recursive: true, force: true });
    }
  }
  private async probe(
    path: string,
    captured: ProjectVersionPreviewSnapshot,
    signal: AbortSignal,
  ): Promise<{ duration: number; hasAudio: boolean }> {
    const { stdout } = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        path,
      ],
      { signal, maxOutputBytes: 256 * 1024, timeoutMs: 3600000 },
    );
    const probe = JSON.parse(stdout.toString()) as {
      streams: Array<{
        codec_type: string;
        codec_name: string;
        width: number;
        height: number;
        avg_frame_rate: string;
        nb_read_frames: string;
        duration: string;
      }>;
      format: { duration: string };
    };
    const videos = probe.streams.filter((s) => s.codec_type === "video"),
      audios = probe.streams.filter((s) => s.codec_type === "audio");
    const fps = projectFrameRate(captured.project.settings),
      duration = frameAlignedDuration(captured.composition.duration, fps),
      expectedFrames = Math.round(duration * fps);
    const video = videos[0],
      rate = video?.avg_frame_rate.split("/").map(Number);
    const timebase = resolveProjectTimebase(captured.project.settings),
      coverage = resolveCompositionCoverageBindings(
        captured.composition,
        timebase,
      );
    const expectedAudio =
      audioSourceAssetIds(captured.composition, captured.assets, undefined, {
        timebase,
        coverage,
      }).size > 0;
    if (
      videos.length !== 1 ||
      !video?.codec_name ||
      video.width !== captured.project.settings.width ||
      video.height !== captured.project.settings.height ||
      !rate ||
      Math.abs(rate[0]! / rate[1]! - fps) > 0.0001 ||
      Number(video.nb_read_frames) !== expectedFrames ||
      Math.abs(Number(video.duration) - duration) > 0.001 ||
      !Number.isFinite(Number(probe.format.duration)) ||
      Number(probe.format.duration) < duration - 0.001 ||
      Number(probe.format.duration) > duration + 0.15 ||
      audios.length > 1 ||
      (expectedAudio && audios.length !== 1) ||
      audios.some(
        (a) =>
          !a.codec_name ||
          !(Number(a.nb_read_frames) > 0) ||
          !Number.isFinite(Number(a.duration)) ||
          Math.abs(Number(a.duration) - duration) > 0.15,
      )
    )
      conflict("Prepared comparison is incomplete or its media shape changed.");
    return { duration: Number(video.duration), hasAudio: audios.length > 0 };
  }
  async prepare(
    input: VersionComparisonPreviewInput,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
    ownership?: Ownership,
  ): Promise<VersionComparisonPreviewDescriptor> {
    try {
      return await this.prepareInternal(input, signal, onProgress, ownership);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw this.safeError(error, this.combined(signal));
    }
  }
  private async prepareInternal(
    input: VersionComparisonPreviewInput,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
    ownership?: Ownership,
  ): Promise<VersionComparisonPreviewDescriptor> {
    validateVersionComparisonPreviewInput(input);
    input = structuredClone(input);
    this.assertProject(input.projectId);
    checkAbort(signal);
    const reused = await this.reuse(input, signal);
    if (reused) return reused;
    if (this.active) conflict("One comparison preparation is already active.");
    this.active = true;
    let resolvePreparation!: () => void;
    const preparing = {
      requestId: input.requestId,
      abort: new AbortController(),
      done: new Promise<void>((resolve) => {
        resolvePreparation = resolve;
      }),
      resolve: () => resolvePreparation(),
    };
    this.preparing = preparing;
    const combined = AbortSignal.any([
        this.combined(signal),
        preparing.abort.signal,
      ]),
      generation = this.app.projectGeneration,
      owner = ownership?.owner ?? createReviewOwner();
    let release: (() => void) | undefined,
      directory: string | undefined,
      directoryIdentity: Stats | undefined;
    try {
      if (this.pair) await this.revoke(this.pair);
      await this.drain();
      const lock = await safeProjectCachePath(
          this.app.directory,
          "version-comparison",
          "prepare.lock",
        ),
        root = dirname(lock);
      release = acquireExportRequestLock(lock, requestKey(input));
      await this.reclaim(root);
      await chmod(root, 0o700);
      const captured = {
        a: await this.app.versions.snapshotForPreview(
          input.a.versionId,
          input.a.compositionId,
          { signal: combined },
        ),
        b: await this.app.versions.snapshotForPreview(
          input.b.versionId,
          input.b.compositionId,
          { signal: combined },
        ),
      };
      if (
        captured.a.versionId === captured.b.versionId &&
        captured.a.composition.id === captured.b.composition.id
      )
        conflict("Choose two different saved Composition targets.");
      const id = randomUUID(),
        outputA = await safeProjectCachePath(
          this.app.directory,
          "version-comparison",
          id,
          "a.mp4",
        );
      directory = dirname(outputA);
      await chmod(directory, 0o700);
      directoryIdentity = await lstat(directory);
      await writeFile(
        join(directory, "owner.json"),
        JSON.stringify({ version: 1, id, projectId: input.projectId, owner }),
        { mode: 0o600, flag: "wx" },
      );
      const outputs = {} as Pair["outputs"];
      const guard = () => {
        checkAbort(combined);
        this.assertProject(input.projectId, generation);
        ownership?.assertCurrent();
        captured.a.assertCurrent();
        captured.b.assertCurrent();
      };
      for (const side of ["a", "b"] as const) {
        guard();
        const snapshot = captured[side],
          composition = snapshot.composition,
          settings = snapshot.project.settings;
        if (
          !Number.isFinite(composition.duration) ||
          composition.duration <= 0 ||
          composition.duration > 3600
        )
          conflict("Comparison supports up to one hour per saved Composition.");
        const story = snapshot.project.stories.find(
          (s) => s.id === composition.storyId,
        );
        if (
          story?.maxDuration !== undefined &&
          composition.duration > story.maxDuration + 0.00001
        )
          conflict("Saved Composition exceeds its story maximum duration.");
        const used = renderSourceAssetIds(composition),
          sources = [...used].map((assetId) => {
            const ref = snapshot.sourceReferences.find(
              (r) => r.assetId === assetId,
            );
            if (!ref || !snapshot.assets.some((a) => a.id === assetId))
              conflict("Saved Composition source evidence is incomplete.");
            return { assetId, sha256: ref.sha256, size: ref.sizeBytes };
          });
        const path = join(directory, `${side}.mp4`),
          remaining = CACHE_LIMIT - (await this.inventory(root)) - 1024 * 1024;
        if (remaining < 1024 * 1024)
          conflict("Comparison cache has insufficient capacity.");
        const options: RenderOptions = {
          signal: combined,
          maximumOutputBytes: Math.min(FILE_LIMIT, remaining),
          project: {
            id: snapshot.project.id,
            schemaVersion: snapshot.project.schemaVersion,
            revision: snapshot.record.projectHash,
          },
          snapshot: {
            compositionSha256: snapshot.compositionSha256,
            settingsSha256: snapshot.settingsSha256,
            assetsSha256: snapshot.assetsSha256,
            sources,
            assertCurrent: guard,
          },
          fontPathForStyle: (style) => this.fontPath(style, settings),
          onProgress: (progress) =>
            onProgress?.((side === "a" ? 0 : 0.5) + progress * 0.5),
        };
        await new FFmpegRenderer().render(
          composition,
          snapshot.assets,
          path,
          settings,
          options,
        );
        guard();
        const facts = await this.probe(path, snapshot, combined),
          info = await lstat(path);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size <= 0 ||
          info.size >= FILE_LIMIT
        )
          conflict();
        const manifestFile = await open(
          `${path}.manifest.json`,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        let manifest: {
          outputSha256: string;
          sources: Array<{ assetId: string; sha256: string; size: number }>;
        };
        try {
          const stat = await manifestFile.stat();
          if (!stat.isFile() || stat.size > 1024 * 1024) conflict();
          manifest = JSON.parse(await manifestFile.readFile("utf8"));
        } finally {
          await manifestFile.close();
        }
        if (
          !Array.isArray(manifest.sources) ||
          manifest.sources.length !== sources.length ||
          sources.some(
            (s) =>
              !manifest.sources.some(
                (m) =>
                  m.assetId === s.assetId &&
                  m.sha256 === s.sha256 &&
                  m.size === s.size,
              ),
          )
        )
          conflict();
        const file = await open(
          path,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        let sha256: string;
        try {
          if (!same(info, await file.stat())) conflict();
          sha256 = await hashHandle(file, combined);
          if (!same(info, await file.stat())) conflict();
        } finally {
          await file.close();
        }
        if (sha256 !== manifest.outputSha256 || !same(info, await lstat(path)))
          conflict();
        await chmod(path, 0o600);
        await chmod(`${path}.manifest.json`, 0o600);
        const warnings = [
          "Frame-aligned video may exclude the final partial-frame audio tail. Playback is not a listening-quality certification.",
        ];
        outputs[side] = {
          path,
          identity: await lstat(path),
          side: {
            versionId: snapshot.versionId,
            versionName: snapshot.record.name,
            projectHash: snapshot.record.projectHash,
            catalogHash: snapshot.record.catalogHash,
            snapshotIdentity: snapshot.identity,
            compositionId: composition.id,
            compositionSha256: snapshot.compositionSha256,
            settingsSha256: snapshot.settingsSha256,
            sourceKeyDigest: digest(sources),
            compositionDuration: composition.duration,
            duration: facts.duration,
            frameRate: projectFrameRate(settings),
            hasAudio: facts.hasAudio,
            sha256,
            bytes: info.size,
            warnings,
          },
        };
        if ((await this.inventory(root)) > CACHE_LIMIT) conflict();
      }
      // Re-hash all frozen sources and payloads at the pair publication boundary.
      for (const side of ["a", "b"] as const) {
        const fresh = await this.app.versions.snapshotForPreview(
          captured[side].versionId,
          captured[side].composition.id,
          { signal: combined },
        );
        if (fresh.identity !== captured[side].identity) conflict();
        fresh.assertCurrent();
      }
      for (const side of ["a", "b"] as const) {
        const file = await this.openOutput(outputs[side]);
        await file.close();
      }
      guard();
      for (const side of ["a", "b"] as const)
        if (!same(outputs[side].identity, lstatSync(outputs[side].path)))
          conflict();
      const descriptor: VersionComparisonPreviewDescriptor = {
        version: 1,
        id,
        projectId: input.projectId,
        expiresAt: new Date(Date.now() + TTL).toISOString(),
        a: outputs.a.side,
        b: outputs.b.side,
      };
      const pair: Pair = {
        descriptor,
        input: structuredClone(input),
        directory,
        directoryIdentity,
        generation,
        snapshots: captured,
        outputs,
        abort: new AbortController(),
        reads: new Set(),
        release,
        ownership,
      };
      this.pair = pair;
      pair.timer = setTimeout(() => {
        void this.revoke(pair).catch(() => undefined);
      }, TTL);
      pair.timer.unref();
      release = undefined;
      directory = undefined;
      return structuredClone(descriptor);
    } catch (error) {
      throw this.safeError(error, combined);
    } finally {
      try {
        if (directory && directoryIdentity)
          await this.removeOwned(directory, directoryIdentity);
      } finally {
        try {
          release?.();
        } finally {
          this.active = false;
          if (this.preparing === preparing) this.preparing = undefined;
          preparing.resolve();
        }
      }
    }
  }
}
