// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  readFile,
  rm,
  writeFile,
  mkdir,
  lstat,
  realpath,
  rename,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ProviderRegistry } from "@openfilm/analysis";
import type { AudioGenerationProvider } from "@openfilm/plugin-sdk";
import type { TimelineCommand } from "@openfilm/solver";
import {
  checkAbort,
  hashFile,
  localPath,
  runProcess,
  safeProjectCachePath,
} from "@openfilm/media";
import type { OpenFilmApplication } from "./index.js";
import { TimelineEditor, TimelineEditorError } from "./editor.js";
import { cancellableProviderResult } from "./cancellable-provider-result.js";
import {
  localAudioMock,
  openAiTtsProvider,
} from "./audio-generation-provider.js";
export interface AudioGenerationReceipt {
  version: 1;
  id: string;
  projectId: string;
  compositionId: string;
  baseRevision: string;
  providerId: string;
  model: string;
  mock: boolean;
  promptSha256: string;
  outputSha256: string;
  duration: number;
  createdAt: string;
  consentAt: string;
  estimatedCostUsd: number | null;
  costStatus: "free-mock" | "unknown-provider-billing";
  accepted: boolean;
}
interface AcceptedAudioRecord {
  version: 1;
  receipt: AudioGenerationReceipt;
  command: TimelineCommand;
  settings: string;
  importRevision: string;
}
export class AudioGenerationService {
  private registry = new ProviderRegistry();
  private previews = new Map<
    string,
    {
      receipt: AudioGenerationReceipt;
      path: string;
      settings: string;
      importRevision?: string;
      command?: TimelineCommand;
    }
  >();
  constructor(
    private readonly app: OpenFilmApplication,
    provider?: AudioGenerationProvider,
  ) {
    this.registry.register(localAudioMock);
    const configured =
      provider ??
      (process.env.OPENFILM_TTS_API_KEY
        ? openAiTtsProvider(process.env.OPENFILM_TTS_API_KEY)
        : undefined);
    if (configured) this.registry.register(configured);
  }
  list() {
    return this.registry.list().map((p) => ({
      ...p,
      estimatedCostUsd: p.execution === "local" ? 0 : null,
      costStatus:
        p.execution === "local" ? "free-mock" : "unknown-provider-billing",
    }));
  }
  private async current(id: string, revision: string, settings: string) {
    const disk = JSON.parse(
      await readFile(join(this.app.directory, "project.json"), "utf8"),
    );
    const state = new TimelineEditor(this.app).get(id);
    if (
      state.revision !== revision ||
      disk.id !== this.app.project.id ||
      JSON.stringify(
        disk.timelines.find((c: { id: string }) => c.id === id),
      ) !== JSON.stringify(state.composition) ||
      JSON.stringify(disk.settings) !== settings ||
      JSON.stringify(this.app.project.settings) !== settings
    )
      throw new TimelineEditorError(
        "Generated audio is stale. Save and preview again.",
        409,
      );
  }
  async preview(
    input: {
      compositionId: string;
      baseRevision: string;
      providerId: string;
      text: string;
      consent: boolean;
      acknowledgeUnknownCost: boolean;
    },
    signal?: AbortSignal,
  ): Promise<AudioGenerationReceipt> {
    signal = AbortSignal.any([
      signal ?? new AbortController().signal,
      AbortSignal.timeout(90000),
    ]);
    if (
      !input.consent ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > 1000
    )
      throw new TimelineEditorError(
        "Explicit consent and 1–1000 text characters are required.",
        400,
      );
    const provider = this.list().find((p) => p.id === input.providerId);
    if (!provider)
      throw new TimelineEditorError("Audio provider is not configured.", 400);
    if (provider.execution === "remote" && !input.acknowledgeUnknownCost)
      throw new TimelineEditorError(
        "Acknowledge unknown provider billing before generation.",
        400,
      );
    const settings = JSON.stringify(this.app.project.settings);
    await this.current(input.compositionId, input.baseRevision, settings);
    const consentAt = new Date().toISOString();
    if (provider.execution === "remote")
      this.registry.grantConsent({
        providerId: provider.id,
        dataKinds: ["text"],
        grantedAt: consentAt,
      });
    const id = randomUUID();
    const path = await safeProjectCachePath(
      this.app.directory,
      "audio-generation",
      id,
      "preview.wav",
    );
    await chmod(dirname(path), 0o700);
    try {
      let result;
      try {
        result = await cancellableProviderResult(
          this.registry.generateAudio(provider.id, input.text, { signal }),
          signal,
        );
      } catch {
        checkAbort(signal);
        throw new TimelineEditorError(
          "Audio provider failed. Check configuration and retry.",
          502,
        );
      }
      checkAbort(signal);
      if (
        !(result.bytes instanceof Uint8Array) ||
        result.bytes.byteLength < 44 ||
        result.bytes.byteLength > 8 * 1024 * 1024 ||
        Buffer.from(result.bytes.subarray(0, 4)).toString() !== "RIFF" ||
        Buffer.from(result.bytes.subarray(8, 12)).toString() !== "WAVE"
      )
        throw new TimelineEditorError(
          "Provider must return bounded WAV audio.",
          400,
        );
      const raw = join(dirname(path), "provider.wav");
      await writeFile(raw, result.bytes, { mode: 0o600 });
      // Force a single WAV demuxer; project/provider data cannot select protocols or playlists.
      await runProcess(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-protocol_whitelist",
          "file,pipe",
          "-f",
          "wav",
          "-i",
          raw,
          "-vn",
          "-map",
          "0:a:0",
          "-t",
          "31",
          "-ar",
          "24000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          path,
        ],
        { signal, timeoutMs: 30000 },
      );
      const probe = await runProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          path,
        ],
        { signal, timeoutMs: 10000 },
      );
      const duration = Number(
        JSON.parse(probe.stdout.toString()).format?.duration,
      );
      if (!Number.isFinite(duration) || duration <= 0 || duration > 30)
        throw new TimelineEditorError(
          "Generated audio must be 0–30 seconds; shorten the text.",
          400,
        );
      checkAbort(signal);
      await this.current(input.compositionId, input.baseRevision, settings);
      if (
        typeof result.model !== "string" ||
        result.model.length > 100 ||
        typeof result.mock !== "boolean"
      )
        throw new TimelineEditorError("Invalid provider receipt.", 400);
      const receipt: AudioGenerationReceipt = {
        version: 1,
        id,
        projectId: this.app.project.id,
        compositionId: input.compositionId,
        baseRevision: input.baseRevision,
        providerId: provider.id,
        model: result.model.slice(0, 100),
        mock: result.mock,
        promptSha256: createHash("sha256").update(input.text).digest("hex"),
        outputSha256: await hashFile(path, signal),
        duration,
        createdAt: new Date().toISOString(),
        consentAt,
        estimatedCostUsd: provider.execution === "local" ? 0 : null,
        costStatus:
          provider.execution === "local"
            ? "free-mock"
            : "unknown-provider-billing",
        accepted: false,
      };
      await rm(raw, { force: true });
      this.previews.set(id, { receipt, path, settings });
      while (this.previews.size > 5) {
        const first = this.previews.keys().next().value!;
        const old = this.previews.get(first)!;
        this.previews.delete(first);
        await rm(dirname(old.path), { recursive: true, force: true });
      }
      return structuredClone(receipt);
    } catch (error) {
      await rm(dirname(path), { recursive: true, force: true });
      throw error;
    } finally {
      if (provider.execution === "remote")
        this.registry.revokeConsent(provider.id);
    }
  }
  async media(id: string) {
    const value = this.previews.get(id);
    if (!value)
      throw new TimelineEditorError(
        "Audio preview expired. Generate again.",
        404,
      );
    await this.current(
      value.receipt.compositionId,
      value.importRevision ?? value.receipt.baseRevision,
      value.settings,
    );
    const path = await safeProjectCachePath(
      this.app.directory,
      "audio-generation",
      id,
      "preview.wav",
    );
    if ((await hashFile(path)) !== value.receipt.outputSha256)
      throw new TimelineEditorError("Generated audio changed.", 409);
    await this.current(
      value.receipt.compositionId,
      value.importRevision ?? value.receipt.baseRevision,
      value.settings,
    );
    return path;
  }
  async accept(id: string) {
    await this.media(id);
    const value = this.previews.get(id)!;
    value.receipt.accepted = true;
    return structuredClone(value.receipt);
  }
  async importTimeline(
    id: string,
    timelineStart: number,
    editor: TimelineEditor,
  ) {
    const path = await this.media(id);
    const value = this.previews.get(id)!;
    const receipt = value.receipt;
    if (!receipt.accepted)
      throw new TimelineEditorError(
        "Preview and explicitly accept audio before import.",
        409,
      );
    const before = editor.get(receipt.compositionId);
    const composition = before.composition;
    if (
      !Number.isFinite(timelineStart) ||
      timelineStart < 0 ||
      timelineStart + receipt.duration > composition.duration
    )
      throw new TimelineEditorError(
        "Generated audio must fit inside the existing film.",
        400,
      );
    if (value.command) {
      if (
        value.command.type !== "audio.add" ||
        value.command.timelineStart !== timelineStart
      )
        throw new TimelineEditorError(
          "Import position changed. Generate again.",
          409,
        );
      await this.persistAcceptance(id);
      return {
        baseRevision: value.importRevision!,
        command: structuredClone(value.command),
        assets: [this.app.getSourceAsset(value.command.assetId)!],
      };
    }
    const destination = await safeProjectCachePath(
      this.app.directory,
      "audio-generation",
      id,
      "accepted.wav",
    );
    await copyFile(path, destination);
    // The accepted asset becomes managed project media, never a transient cache URI.
    const managed = join(this.app.directory, "sources", `generated-${id}.wav`);
    await mkdir(dirname(managed), { recursive: true });
    if (
      (await lstat(dirname(managed))).isSymbolicLink() ||
      (await realpath(dirname(managed))) !==
        join(await realpath(this.app.directory), "sources")
    )
      throw new TimelineEditorError(
        "Managed sources cannot contain symlinks.",
        400,
      );
    try {
      await writeFile(managed, await readFile(destination), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        (await lstat(managed)).isSymbolicLink() ||
        (await hashFile(managed)) !== receipt.outputSha256
      )
        throw error;
    }
    await this.app.importManagedSources([managed]);
    const asset = this.app.catalog.getAssetByUri(pathToFileURL(managed).href);
    if (!asset)
      throw new TimelineEditorError(
        "Generated source could not be imported.",
        500,
      );
    const full = this.app.catalog.getAsset(asset.id)!;
    if (full.state.locked || full.state.rejected)
      throw new TimelineEditorError(
        "Generated source is locked or rejected.",
        409,
      );
    const previous = full.metadata["openfilm.audioGeneration"];
    full.metadata = {
      ...full.metadata,
      "openfilm.audioGeneration": [
        ...(Array.isArray(previous) ? previous : []),
        structuredClone(receipt),
      ],
    };
    this.app.catalog.upsertAsset(full);
    const imported = editor.adoptImportedAudioSource(before, full.id);
    await this.current(
      receipt.compositionId,
      imported.revision,
      value.settings,
    );
    value.importRevision = imported.revision;
    const command: TimelineCommand = {
      type: "audio.add",
      clipId: `generated-${id}`,
      assetId: asset.id,
      role: "narration",
      timelineStart,
      sourceIn: 0,
      sourceOut: receipt.duration,
      generationId: id,
    };
    value.command = command;
    await this.persistAcceptance(id);
    return { baseRevision: imported.revision, command, assets: [full] };
  }
  private async receiptPath(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new TimelineEditorError("Invalid generation receipt ID.", 400);
    const path = await safeProjectCachePath(
      this.app.directory,
      "audio-generation-receipts",
      `${id}.json`,
    );
    await chmod(dirname(path), 0o700);
    return path;
  }
  private async persistAcceptance(id: string) {
    const value = this.previews.get(id)!;
    const record: AcceptedAudioRecord = {
      version: 1,
      receipt: value.receipt,
      command: value.command!,
      settings: value.settings,
      importRevision: value.importRevision!,
    };
    const path = await this.receiptPath(id);
    const serialized = JSON.stringify(record);
    try {
      const existing = await readFile(path, "utf8");
      if (existing !== serialized)
        throw new TimelineEditorError("Accepted receipt changed.", 409);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = await safeProjectCachePath(
      this.app.directory,
      "audio-generation-receipts",
      `${id}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, serialized, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async validateImport(
    id: string,
    compositionId: string,
    revision: string,
    command: TimelineCommand,
  ) {
    // Imported/accepted receipts outlive preview eviction and a server restart.
    const path = await this.receiptPath(id);
    let record: AcceptedAudioRecord;
    try {
      if ((await lstat(path)).size > 65536) throw new Error("oversized");
      record = JSON.parse(await readFile(path, "utf8")) as AcceptedAudioRecord;
    } catch {
      throw new TimelineEditorError(
        "Accepted audio receipt is unavailable. Use the imported source for a new explicit edit.",
        409,
      );
    }
    if (
      record.version !== 1 ||
      record.receipt?.version !== 1 ||
      record.receipt.id !== id ||
      record.receipt.projectId !== this.app.project.id ||
      !record.receipt.accepted ||
      record.receipt.compositionId !== compositionId ||
      record.importRevision !== revision ||
      typeof record.settings !== "string" ||
      JSON.stringify(record.command) !== JSON.stringify(command) ||
      command.type !== "audio.add" ||
      command.generationId !== id ||
      command.clipId !== `generated-${id}` ||
      command.sourceIn !== 0 ||
      command.sourceOut !== record.receipt.duration ||
      !/^[a-f0-9]{64}$/.test(record.receipt.outputSha256)
    )
      throw new TimelineEditorError(
        "Generated audio import does not match acceptance.",
        409,
      );
    await this.current(compositionId, revision, record.settings);
    const source = this.app.getSourceAsset(command.assetId);
    const managed = source?.metadata["openfilm.managedSource"] as
      { relativePath?: string } | undefined;
    if (
      !source ||
      managed?.relativePath !== `sources/generated-${id}.wav` ||
      (await hashFile(localPath(source.uri))) !== record.receipt.outputSha256
    )
      throw new TimelineEditorError("Generated source changed.", 409);
    await this.current(compositionId, revision, record.settings);
  }
}
