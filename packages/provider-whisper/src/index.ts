import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import {
  ApplicationError,
  type ApplicationErrorCode,
  type MediaAsset,
} from "@openfilm/core";
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionStage,
} from "@openfilm/plugin-sdk";
import {
  abortError,
  checkAbort,
  localPath,
  runProcess,
  SOURCE_CLOCK_AUDIO_FILTER,
} from "@openfilm/media";

export interface LocalWhisperOptions {
  pythonPath?: string;
  modelPath?: string;
  runnerPath?: string;
  temporaryDirectory?: string;
  timeoutMs?: number;
}
export interface WhisperAvailability {
  available: boolean;
  model?: string;
  detail?: string;
}
const stages = new Set<TranscriptionStage>([
  "loading-model",
  "transcribing",
  "post-processing",
]);
const providerCodes = new Set<ApplicationErrorCode>([
  "transcription.modelInvalid",
  "transcription.runtimeUnavailable",
  "transcription.failed",
]);
function failure(
  code: ApplicationErrorCode,
  detail: string,
  status = 500,
): ApplicationError {
  return new ApplicationError(code, detail, status, undefined, detail);
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function invalid(detail: string): never {
  throw failure("transcription.invalidOutput", detail, 502);
}
function finite(value: unknown, minimum = 0): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum
  );
}

/** Validate the process boundary before transcript data can enter a project. */
export function validateWhisperResult(
  value: unknown,
  duration?: number,
): TranscriptionResult {
  const input = object(value);
  if (
    !input ||
    typeof input.text !== "string" ||
    typeof input.language !== "string" ||
    !input.language ||
    (input.execution !== "cpu" && input.execution !== "gpu") ||
    typeof input.model !== "string" ||
    !input.model ||
    typeof input.version !== "string" ||
    !input.version ||
    !Array.isArray(input.segments)
  )
    return invalid("The local speech process returned an incomplete result.");
  let previous = 0;
  const identifiers = new Set<string>();
  const segments = input.segments.map((raw, index) => {
    const segment = object(raw);
    if (
      !segment ||
      !finite(segment.start) ||
      !finite(segment.end) ||
      segment.end < segment.start ||
      segment.start < previous ||
      (duration !== undefined && segment.end > duration) ||
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      !Array.isArray(segment.words) ||
      !segment.words.length
    )
      return invalid(
        `Invalid segment timing or missing word timestamps at segment ${index + 1}.`,
      );
    previous = segment.start;
    const start = segment.start;
    const end = segment.end;
    let priorWord = start;
    const words = segment.words.map((rawWord, wordIndex) => {
      const word = object(rawWord);
      if (
        !word ||
        !finite(word.start) ||
        !finite(word.end) ||
        word.start < start ||
        word.end > end ||
        word.end < word.start ||
        word.start < priorWord ||
        typeof word.text !== "string" ||
        !word.text.trim() ||
        (word.confidence !== undefined &&
          (!finite(word.confidence) || word.confidence > 1))
      )
        return invalid(
          `Invalid word timing at segment ${index + 1}, word ${wordIndex + 1}.`,
        );
      priorWord = word.start;
      return {
        start: word.start,
        end: word.end,
        text: word.text,
        ...(word.confidence === undefined
          ? {}
          : { confidence: word.confidence as number }),
      };
    });
    const id =
      typeof segment.id === "string" && segment.id.trim()
        ? segment.id
        : `segment-${index + 1}`;
    if (identifiers.has(id)) return invalid("Duplicate transcript segment ID.");
    identifiers.add(id);
    return {
      id,
      start,
      end,
      text: segment.text,
      words,
    };
  });
  if (!segments.length && input.text.trim())
    return invalid("Speech text was returned without timed segments.");
  return {
    text: input.text,
    language: input.language,
    segments,
    execution: input.execution,
    model: input.model,
    version: input.version,
    ...(typeof input.fallbackReason === "string"
      ? { fallbackReason: input.fallbackReason }
      : {}),
  };
}

/** Local, optional provider: model installation is always an explicit workstation task. */
export class LocalWhisperProvider implements TranscriptionProvider {
  readonly id = "local-whisper";
  readonly name = "Whisper (local)";
  readonly kind = "transcription" as const;
  readonly execution = "local" as const;
  readonly dataKinds = ["audio", "video"] as ("audio" | "video")[];
  readonly capabilities = {
    wordTimestamps: true,
    languages: ["auto", "zh", "en", "ja"],
    cpuFallback: true,
    supportsPromptHints: true,
  };
  private readonly settings: LocalWhisperOptions;
  constructor(settings: LocalWhisperOptions = {}) {
    this.settings = settings;
  }
  private model(value?: string): string {
    const path =
      value ?? this.settings.modelPath ?? process.env.OPENFILM_WHISPER_MODEL;
    if (!path?.trim())
      throw failure(
        "transcription.modelRequired",
        "Choose an installed local Whisper model directory before transcribing.",
        400,
      );
    return resolve(path);
  }
  private async validateModel(path: string): Promise<void> {
    try {
      if (!(await stat(path)).isDirectory())
        throw new Error("The model location is not a directory.");
      for (const file of ["model.bin", "config.json", "tokenizer.json"]) {
        const info = await stat(join(path, file));
        if (!info.isFile() || !info.size)
          throw new Error(`Missing or empty local model file: ${file}`);
      }
    } catch (error) {
      throw failure(
        "transcription.modelInvalid",
        `Local model ${basename(path)} is incomplete: ${error instanceof Error ? error.message : String(error)}`,
        400,
      );
    }
  }
  private process(
    args: string[],
    options: TranscriptionOptions = {},
  ): Promise<Record<string, unknown>> {
    checkAbort(options.signal);
    const python =
      this.settings.pythonPath ??
      process.env.OPENFILM_WHISPER_PYTHON ??
      (process.platform === "win32" ? "python" : "python3");
    const runner =
      this.settings.runnerPath ??
      process.env.OPENFILM_WHISPER_RUNNER ??
      fileURLToPath(new URL("./whisper_runner.py", import.meta.url));
    return new Promise((resolvePromise, reject) => {
      const child = spawn(python, ["-u", runner, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
          PYTHONIOENCODING: "utf-8",
        },
      });
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      let bytes = 0;
      let diagnostics = "";
      let result: Record<string, unknown> | undefined;
      let error: Error | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = (reason: Error) => {
        error ??= reason;
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1500);
        killTimer.unref();
      };
      const abort = () => stop(abortError());
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const timer = setTimeout(
        () =>
          stop(
            failure(
              "transcription.failed",
              "The local speech process exceeded its time limit.",
            ),
          ),
        args.includes("--probe")
          ? Math.min(this.settings.timeoutMs ?? 15_000, 15_000)
          : (this.settings.timeoutMs ?? 2 * 60 * 60 * 1000),
      );
      timer.unref();
      const line = (value: string) => {
        if (!value.trim() || error) return;
        try {
          const message = object(JSON.parse(value));
          if (!message)
            return invalid(
              "The speech process returned a malformed protocol message.",
            );
          if (
            message.event === "stage" &&
            stages.has(message.stage as TranscriptionStage)
          )
            options.onStage?.(message.stage as TranscriptionStage);
          else if (
            message.event === "progress" &&
            finite(message.value) &&
            message.value <= 1
          )
            options.onProgress?.(message.value);
          else if (message.event === "error") {
            const code = providerCodes.has(message.code as ApplicationErrorCode)
              ? (message.code as ApplicationErrorCode)
              : "transcription.failed";
            stop(
              failure(
                code,
                String(
                  message.detail ?? "The local speech process failed.",
                ).slice(0, 4000),
                code === "transcription.runtimeUnavailable" ? 503 : 500,
              ),
            );
          } else if (
            message.event === "result" ||
            message.event === "available"
          ) {
            if (result)
              return invalid(
                "The speech process returned more than one final result.",
              );
            result = message;
          } else if (message.event !== "fallback")
            return invalid(
              "The speech process returned an unknown protocol message.",
            );
        } catch (cause) {
          stop(
            cause instanceof ApplicationError
              ? cause
              : failure(
                  "transcription.invalidOutput",
                  `Invalid local speech protocol: ${cause instanceof Error ? cause.message : String(cause)}`,
                  502,
                ),
          );
        }
      };
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024)
          return stop(
            failure(
              "transcription.invalidOutput",
              "The speech result exceeds the 32 MiB limit.",
              502,
            ),
          );
        buffer += decoder.write(chunk);
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString("utf8")).slice(-4000);
      });
      child.on("error", (cause) => {
        error ??= failure(
          "transcription.runtimeUnavailable",
          `Could not start the local Python speech engine: ${cause.message}`,
          503,
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", abort);
        line(buffer + decoder.end());
        if (error) reject(error);
        else if (code !== 0)
          reject(
            failure(
              "transcription.failed",
              `Local speech process exited ${code}: ${diagnostics}`,
            ),
          );
        else if (!result)
          reject(
            failure(
              "transcription.invalidOutput",
              "The local speech process exited without a result.",
              502,
            ),
          );
        else resolvePromise(result);
      });
    });
  }
  async available(): Promise<WhisperAvailability> {
    try {
      const model = this.model();
      await this.validateModel(model);
      const result = await this.process(["--model", model, "--probe"]);
      if (result.event !== "available" || result.available !== true)
        return invalid(
          "Invalid availability response from local speech process.",
        );
      return {
        available: true,
        model: String(result.model ?? basename(model)),
      };
    } catch (error) {
      return {
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  async transcribe(
    asset: MediaAsset,
    options: TranscriptionOptions = {},
  ): Promise<TranscriptionResult> {
    checkAbort(options.signal);
    const hints = options.promptHints ?? [];
    if (
      !Array.isArray(hints) ||
      hints.length > 50 ||
      hints.some(
        (hint) =>
          typeof hint !== "string" ||
          !hint.trim() ||
          Array.from(hint).length > 200 ||
          Array.from(hint).some(
            (character) =>
              character.codePointAt(0)! < 32 ||
              character.codePointAt(0) === 127,
          ),
      ) ||
      hints.reduce((size, hint) => size + Array.from(hint).length, 0) > 2000
    )
      throw failure(
        "request.invalid",
        "Terminology context must contain at most 50 nonempty hints, 200 characters each and 2000 characters total.",
        400,
      );
    if (asset.mediaType !== "video" && asset.mediaType !== "audio")
      throw failure(
        "transcription.noAudio",
        "Only local video or audio with an audio stream can be transcribed.",
        400,
      );
    const model = this.model(options.modelPath);
    await this.validateModel(model);
    let source: string;
    let before: Awaited<ReturnType<typeof stat>>;
    try {
      source = localPath(asset.uri);
      before = await stat(source);
      if (!before.isFile()) throw new Error("Not a regular media file");
    } catch {
      throw new ApplicationError(
        "media.missing",
        `Source media is unavailable: ${asset.name}`,
        404,
        { name: asset.name },
      );
    }
    const temporary = await mkdtemp(
      join(this.settings.temporaryDirectory ?? tmpdir(), "openfilm-whisper-"),
    );
    let progress = 0;
    const reportProgress = (value: number) => {
      progress = Math.max(progress, Math.min(1, value));
      options.onProgress?.(progress);
    };
    try {
      options.onStage?.("extracting-audio");
      reportProgress(0);
      const probe = await runProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=codec_type,start_time:format=start_time,duration",
          "-of",
          "json",
          source,
        ],
        { signal: options.signal },
      );
      const sourceInfo = JSON.parse(probe.stdout.toString("utf8")) as {
        streams?: { start_time?: string }[];
        format?: { start_time?: string; duration?: string };
      };
      if (!sourceInfo.streams?.length)
        throw failure(
          "transcription.noAudio",
          `No audio stream was found in ${asset.name}.`,
          400,
        );
      const formatStart = Number(sourceInfo.format?.start_time ?? 0);
      const offset = Math.max(
        0,
        Number(sourceInfo.streams[0]?.start_time ?? formatStart) - formatStart,
      );
      const sourceOffset = Number.isFinite(offset) ? offset : 0;
      const audio = join(temporary, "audio.wav");
      await runProcess(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-i",
          source,
          "-map",
          "0:a:0",
          "-vn",
          // Normalize only the first audio timestamp; fill internal PTS gaps.
          // The separate sourceOffset restores its position in the source video.
          "-af",
          SOURCE_CLOCK_AUDIO_FILTER,
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          "-threads",
          "1",
          "-y",
          audio,
        ],
        {
          signal: options.signal,
          timeoutMs: this.settings.timeoutMs ?? 15 * 60 * 1000,
        },
      );
      reportProgress(0.1);
      const message = await this.process(
        [
          "--model",
          model,
          "--audio",
          audio,
          "--language",
          options.language ?? "auto",
          "--execution",
          options.execution ?? "auto",
          ...(hints.length ? ["--prompt-hints", JSON.stringify(hints)] : []),
        ],
        {
          ...options,
          onProgress: (value) => reportProgress(0.1 + value * 0.85),
        },
      );
      checkAbort(options.signal);
      if (message.event !== "result")
        return invalid(
          "The local speech process returned an availability response instead of a transcript.",
        );
      const result = validateWhisperResult(message.result);
      for (const segment of result.segments ?? []) {
        segment.start += sourceOffset;
        segment.end += sourceOffset;
        for (const word of segment.words ?? []) {
          word.start += sourceOffset;
          word.end += sourceOffset;
        }
      }
      const sourceDuration = Number(sourceInfo.format?.duration);
      validateWhisperResult(
        result,
        Number.isFinite(sourceDuration) && sourceDuration > 0
          ? sourceDuration
          : asset.duration,
      );
      const after = await stat(source);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ino !== after.ino
      )
        throw failure(
          "source.changed",
          "The source file changed while it was being transcribed.",
          409,
        );
      checkAbort(options.signal);
      reportProgress(1);
      checkAbort(options.signal);
      return result;
    } catch (error) {
      if (
        error instanceof ApplicationError ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw error;
      throw failure(
        "transcription.failed",
        `Local transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
