// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ApplicationError,
  resolveProjectTimebase,
  type Composition,
} from "@openfilm/core";
import {
  checkAbort,
  hashFile,
  localPath,
  safeProjectCachePath,
} from "@openfilm/media";
import { audioSourceAssetIds, type RenderOptions } from "@openfilm/render";
import type { OpenFilmApplication } from "./index.js";
import { TimelineEditor } from "./editor.js";
import { acquireExportRequestLock } from "./export-request-lock.js";
export interface RecordAudioPreviewDescriptor {
  version: 1;
  id: string;
  revision: string;
  sourceKeyDigest: string;
  sampleRate: 48000;
  channels: 2;
  format: "pcm_s24le";
  lengthSamples: number;
}
const FILE_LIMIT = 1024 ** 3,
  CACHE_LIMIT = 2 * FILE_LIMIT,
  READ_LIMIT = 192000;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function stale(
  message = "Record audio preview is stale. Prepare the current saved cut again.",
): never {
  throw new ApplicationError("timeline.conflict", message, 409);
}
function shape(message: string): never {
  throw new ApplicationError("media.previewUnavailable", message, 400);
}
function identity(a: Stats, b: Stats): boolean {
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
/** Bounded RIFF header parsing. No unbounded chunk allocation, RF64 or ambiguous data layouts. */
export async function inspectRecordAudioWav(
  path: string,
  expectedSamples: number,
): Promise<{
  dataOffset: number;
  dataBytes: number;
  lengthSamples: number;
  identity: Stats;
}> {
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > FILE_LIMIT)
      shape("PCM cache exceeds the 1 GiB private file bound.");
    const header = Buffer.alloc(Math.min(info.size, 65536)),
      read = await file.read(header, 0, header.length, 0);
    if (
      read.bytesRead < 44 ||
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE" ||
      header.readUInt32LE(4) + 8 !== info.size
    )
      shape("PCM cache is truncated or has an unsupported WAV header.");
    let fmt = false,
      offset = 12;
    for (
      let chunks = 0;
      chunks < 256 && offset + 8 <= read.bytesRead;
      chunks++
    ) {
      const name = header.toString("ascii", offset, offset + 4),
        size = header.readUInt32LE(offset + 4),
        start = offset + 8,
        end = start + size;
      if (!Number.isSafeInteger(end) || end > info.size)
        shape("PCM cache data is truncated.");
      if (name === "fmt ") {
        if (fmt || ![16, 40].includes(size) || end > read.bytesRead)
          shape("Unsupported PCM format layout.");
        const tag = header.readUInt16LE(start),
          channels = header.readUInt16LE(start + 2),
          rate = header.readUInt32LE(start + 4),
          bytes = header.readUInt32LE(start + 8),
          align = header.readUInt16LE(start + 12),
          bits = header.readUInt16LE(start + 14);
        if (
          channels !== 2 ||
          rate !== 48000 ||
          bytes !== 288000 ||
          align !== 6 ||
          bits !== 24 ||
          !(
            tag === 1 ||
            (tag === 65534 &&
              size === 40 &&
              header.readUInt16LE(start + 16) === 22 &&
              header.readUInt16LE(start + 18) === 24 &&
              header
                .subarray(start + 24, start + 40)
                .equals(Buffer.from("0100000000001000800000aa00389b71", "hex")))
          )
        )
          shape("PCM cache must be stereo 48000 Hz signed 24-bit PCM.");
        fmt = true;
      }
      if (name === "data") {
        if (
          !fmt ||
          size % 6 ||
          size / 6 !== expectedSamples ||
          end + (size % 2) !== info.size
        )
          shape("PCM cache has a truncated or unsupported data chunk.");
        return {
          dataOffset: start,
          dataBytes: size,
          lengthSamples: size / 6,
          identity: info,
        };
      }
      offset = end + (size % 2);
      if (offset > 65528)
        shape("WAV header exceeds its bounded metadata budget.");
    }
    return shape("PCM cache has no supported bounded WAV data chunk.");
  } finally {
    await file.close();
  }
}
interface Source {
  assetId: string;
  uri: string;
  sha256: string;
  identity: Stats;
}
interface Entry {
  descriptor: RecordAudioPreviewDescriptor;
  key: string;
  path: string;
  manifestPath: string;
  dataOffset: number;
  dataBytes: number;
  identity: Stats;
  sources: Source[];
  composition: string;
  settings: string;
  projectId: string;
  compositionId: string;
  generation: number;
  readers: number;
  used: number;
}
/** Private full-Composition DSP cache. Descriptors never expose a filesystem path. */
export class RecordAudioPreviewService {
  private entries = new Map<string, Entry>();
  private active = false;
  private closed = new AbortController();
  constructor(
    private readonly app: OpenFilmApplication,
    private readonly render: (
      composition: Composition,
      path: string,
      options: RenderOptions,
    ) => Promise<string>,
  ) {}
  private assertOpen() {
    if (this.closed.signal.aborted) stale("Record audio project is closed.");
  }
  private async assertCurrent(
    entry: Pick<
      Entry,
      | "descriptor"
      | "composition"
      | "settings"
      | "projectId"
      | "compositionId"
      | "generation"
    >,
  ) {
    this.assertOpen();
    const state = new TimelineEditor(this.app).get(entry.compositionId);
    const disk = JSON.parse(
      await readFile(join(this.app.directory, "project.json"), "utf8"),
    ) as { id: string; settings: unknown; timelines: Composition[] };
    if (
      state.revision !== entry.descriptor.revision ||
      this.app.project.id !== entry.projectId ||
      this.app.projectGeneration !== entry.generation ||
      disk.id !== entry.projectId ||
      JSON.stringify(state.composition) !== entry.composition ||
      JSON.stringify(
        disk.timelines.find((c) => c.id === state.composition.id),
      ) !== entry.composition ||
      JSON.stringify(this.app.project.settings) !== entry.settings ||
      JSON.stringify(disk.settings) !== entry.settings
    )
      stale();
  }
  private async verifySources(
    sources: Source[],
    rehash: boolean,
    signal?: AbortSignal,
  ) {
    for (const source of sources) {
      checkAbort(signal);
      const asset = this.app.getSourceAsset(source.assetId);
      if (
        !asset ||
        asset.uri !== source.uri ||
        !identity(source.identity, await lstat(localPath(source.uri)))
      )
        stale(
          "Record audio source changed; inspect or relink and prepare again.",
        );
      if (
        rehash &&
        (await hashFile(localPath(source.uri), signal)) !== source.sha256
      )
        stale(
          "Record audio source bytes changed; inspect or relink and prepare again.",
        );
    }
  }
  private async revoke(entry: Entry) {
    this.entries.delete(entry.descriptor.id);
    if (!entry.readers)
      await Promise.all([
        rm(entry.path, { force: true }),
        rm(entry.manifestPath, { force: true }),
      ]);
  }
  private async trimCache(ready: string) {
    const files = [] as {
      id: string;
      path: string;
      size: number;
      modified: number;
      entry?: Entry;
    }[];
    for (const name of await readdir(ready)) {
      if (!/^[a-f0-9-]{36}\.wav$/.test(name)) continue;
      const path = join(ready, name),
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        shape("PCM cache contains an unsupported file.");
      const id = name.slice(0, -4),
        entry = this.entries.get(id);
      let bytes = info.size;
      try {
        bytes += (await lstat(`${path}.manifest.json`)).size;
      } catch {
        /* Unpublished or orphaned files are still counted. */
      }
      files.push({
        id,
        path,
        size: bytes,
        modified: entry?.used ?? info.mtimeMs,
        entry,
      });
    }
    let bytes = files.reduce((sum, f) => sum + f.size, 0);
    files.sort((a, b) => a.modified - b.modified);
    for (const file of files) {
      if (bytes <= CACHE_LIMIT) break;
      if (file.entry?.readers) continue;
      this.entries.delete(file.id);
      await rm(file.path, { force: true });
      await rm(`${file.path}.manifest.json`, { force: true });
      bytes -= file.size;
    }
    if (bytes > CACHE_LIMIT)
      shape(
        "PCM cache is full while previews are being read; pause and retry preparation.",
      );
  }
  async prepare(
    compositionId: string,
    baseRevision: string,
    signal?: AbortSignal,
  ): Promise<RecordAudioPreviewDescriptor> {
    this.assertOpen();
    checkAbort(signal);
    if (this.active)
      throw new ApplicationError(
        "jobs.busy",
        "One Record audio preparation is already active.",
        409,
      );
    this.active = true;
    let release: (() => void) | undefined,
      work: string | undefined,
      published: string | undefined;
    const combined = AbortSignal.any([
      this.closed.signal,
      ...(signal ? [signal] : []),
    ]);
    try {
      const state = new TimelineEditor(this.app).get(compositionId);
      if (state.revision !== baseRevision) stale();
      const composition = structuredClone(state.composition),
        duration = composition.duration,
        lengthSamples = Math.round(duration * 48000);
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > 3600 ||
        !Number.isSafeInteger(lengthSamples) ||
        lengthSamples * 6 + 65536 > FILE_LIMIT
      )
        shape(
          "Record PCM preparation supports at most one hour (3600 seconds) and 1 GiB. Export WAV or MP4 for longer films.",
        );
      const projectId = this.app.project.id,
        generation = this.app.projectGeneration,
        settings = JSON.stringify(this.app.project.settings),
        ids = audioSourceAssetIds(composition, state.assets, undefined, {
          timebase: resolveProjectTimebase(this.app.project.settings),
          coverage: [],
        }),
        sources: Source[] = [];
      for (const asset of state.assets.filter((a) => ids.has(a.id))) {
        const path = localPath(asset.uri),
          before = await lstat(path);
        if (!before.isFile() || before.isSymbolicLink())
          stale("Record audio source is unavailable.");
        const sha256 = await hashFile(path, combined),
          after = await lstat(path);
        if (
          !identity(before, after) ||
          (asset.contentHash && asset.contentHash !== sha256)
        )
          stale("Record audio source bytes changed.");
        sources.push({
          assetId: asset.id,
          uri: asset.uri,
          sha256,
          identity: after,
        });
      }
      const sourceKeyDigest = digest(
          sources.map((s) => ({
            assetId: s.assetId,
            uri: s.uri,
            sha256: s.sha256,
          })),
        ),
        key = digest({
          projectId,
          generation,
          composition,
          settings,
          baseRevision,
          sourceKeyDigest,
        });
      const current = {
        descriptor: {
          id: compositionId,
          revision: baseRevision,
        } as RecordAudioPreviewDescriptor,
        composition: JSON.stringify(composition),
        settings,
        projectId,
        compositionId,
        generation,
      };
      await this.assertCurrent(current);
      checkAbort(combined);
      for (const entry of this.entries.values())
        if (entry.key === key) {
          try {
            await this.assertCurrent(entry);
            await this.verifySources(entry.sources, true, combined);
            if (!identity(entry.identity, await lstat(entry.path)))
              throw new Error("PCM cache changed.");
            checkAbort(combined);
            entry.used = Date.now();
            return structuredClone(entry.descriptor);
          } catch (error) {
            if (combined.aborted) throw error;
            await this.revoke(entry);
            checkAbort(combined);
            if (error instanceof ApplicationError) throw error;
          }
        }
      const lock = await safeProjectCachePath(
        this.app.directory,
        "record-audio",
        "prepare.lock",
      );
      try {
        release = acquireExportRequestLock(lock, key);
      } catch {
        throw new ApplicationError(
          "jobs.busy",
          "A Record audio preparation is already running for this project.",
          409,
        );
      }
      const id = randomUUID(),
        temporary = await safeProjectCachePath(
          this.app.directory,
          "record-audio",
          "work",
          id,
          "mix.wav",
        ),
        ready = await safeProjectCachePath(
          this.app.directory,
          "record-audio",
          "ready",
          `${id}.wav`,
        );
      work = dirname(temporary);
      await chmod(work, 0o700);
      await chmod(dirname(ready), 0o700);
      await this.render(composition, temporary, {
        signal: combined,
        audioOnly: true,
        maximumOutputBytes: FILE_LIMIT,
      });
      checkAbort(combined);
      const wav = await inspectRecordAudioWav(temporary, lengthSamples),
        manifest = JSON.parse(
          await readFile(`${temporary}.manifest.json`, "utf8"),
        ) as {
          sources?: { assetId: string; sha256: string }[];
          outputSha256?: string;
        };
      if (
        !Array.isArray(manifest.sources) ||
        manifest.sources.length !== sources.length ||
        sources.some(
          (source) =>
            !manifest.sources!.some(
              (c) => c.assetId === source.assetId && c.sha256 === source.sha256,
            ),
        )
      )
        stale(
          "Record audio source manifest does not match the captured source bytes.",
        );
      if (
        typeof manifest.outputSha256 !== "string" ||
        (await hashFile(temporary, combined)) !== manifest.outputSha256 ||
        !identity(wav.identity, await lstat(temporary))
      )
        shape(
          "Prepared PCM bytes do not match the renderer manifest hash; cache is corrupt.",
        );
      await this.assertCurrent(current);
      await this.verifySources(sources, true, combined);
      checkAbort(combined);
      await chmod(temporary, 0o600);
      await chmod(`${temporary}.manifest.json`, 0o600);
      await rename(temporary, ready);
      published = ready;
      await rename(`${temporary}.manifest.json`, `${ready}.manifest.json`);
      const descriptor: RecordAudioPreviewDescriptor = {
        version: 1,
        id,
        revision: baseRevision,
        sourceKeyDigest,
        sampleRate: 48000,
        channels: 2,
        format: "pcm_s24le",
        lengthSamples,
      };
      const entry: Entry = {
        ...current,
        descriptor,
        key,
        path: ready,
        manifestPath: `${ready}.manifest.json`,
        dataOffset: wav.dataOffset,
        dataBytes: wav.dataBytes,
        identity: await lstat(ready),
        sources,
        readers: 1,
        used: Date.now(),
      };
      this.entries.set(id, entry);
      try {
        await this.trimCache(dirname(ready));
        await this.assertCurrent(entry);
        await this.verifySources(sources, false, combined);
        checkAbort(combined);
      } catch (error) {
        entry.readers = 0;
        await this.revoke(entry);
        throw error;
      }
      entry.readers = 0;
      published = undefined;
      return structuredClone(descriptor);
    } finally {
      if (published) {
        await rm(published, { force: true });
        await rm(`${published}.manifest.json`, { force: true });
      }
      if (work) await rm(work, { recursive: true, force: true });
      try {
        release?.();
      } finally {
        this.active = false;
      }
    }
  }
  async read(
    id: string,
    startSample: number,
    count: number,
  ): Promise<Uint8Array> {
    this.assertOpen();
    if (
      !Number.isSafeInteger(startSample) ||
      startSample < 0 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > READ_LIMIT ||
      !Number.isSafeInteger(startSample + count)
    )
      throw new ApplicationError(
        "request.invalid",
        "Read integer PCM ranges of at most 192000 frames.",
        400,
      );
    const entry = this.entries.get(id);
    if (!entry)
      throw new ApplicationError(
        "request.notFound",
        "Record audio preview is unavailable; prepare the saved cut again.",
        404,
      );
    if (startSample + count > entry.descriptor.lengthSamples)
      throw new ApplicationError(
        "request.invalid",
        "PCM range exceeds the prepared sound length.",
        400,
      );
    entry.readers++;
    try {
      await this.assertCurrent(entry);
      await this.verifySources(entry.sources, false);
      if (
        (await safeProjectCachePath(
          this.app.directory,
          "record-audio",
          "ready",
          `${id}.wav`,
        )) !== entry.path ||
        !identity(entry.identity, await lstat(entry.path))
      )
        stale("Record PCM cache changed or is corrupt.");
      const file = await open(
        entry.path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        if (!identity(entry.identity, await file.stat()))
          stale("Record PCM cache changed.");
        const bytes = Buffer.alloc(count * 6);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await file.read(
            bytes,
            offset,
            bytes.length - offset,
            entry.dataOffset + startSample * 6 + offset,
          );
          if (!read.bytesRead) stale("Record PCM cache is truncated.");
          offset += read.bytesRead;
        }
        if (!identity(entry.identity, await file.stat()))
          stale("Record PCM cache changed during the read.");
        await this.assertCurrent(entry);
        await this.verifySources(entry.sources, false);
        entry.used = Date.now();
        return bytes;
      } finally {
        await file.close();
      }
    } catch (error) {
      this.entries.delete(id);
      throw error;
    } finally {
      entry.readers--;
      if (!this.entries.has(id) && !entry.readers) {
        await rm(entry.path, { force: true });
        await rm(entry.manifestPath, { force: true });
      }
    }
  }
  dispose(): void {
    this.closed.abort();
    this.entries.clear();
  }
}
