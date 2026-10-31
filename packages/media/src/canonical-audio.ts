// SPDX-License-Identifier: Apache-2.0
import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import type { MediaAsset } from "@openfilm/core";
import { hashFile, localPath, runProcess } from "./index.js";
import { localMediaInputOptions } from "./input-policy.js";
/** Keep source-local initial PTS and fill even sub-100ms internal packet gaps. */
export const CANONICAL_AUDIO_FILTER =
  "aresample=48000:async=1:min_hard_comp=0:first_pts=0";
export interface CanonicalAudioFacts {
  assetId: string;
  sourcePath: string;
  sha256: string;
  lengthSamples: number;
  probe: {
    streams: { codec_type?: string; start_time?: string; duration?: string }[];
    format?: {
      start_time?: string;
      format_name?: string;
      duration?: string;
    };
  };
}
function sourceHashSync(path: string): string {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error("Audio source changed or is not a regular file.");
  const handle = openSync(path, "r"),
    buffer = Buffer.alloc(1024 * 1024),
    hash = createHash("sha256");
  try {
    let bytes: number;
    do {
      bytes = readSync(handle, buffer, 0, buffer.length, null);
      hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    closeSync(handle);
  }
  const after = lstatSync(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  )
    throw new Error("Audio source changed while checking its bytes.");
  return hash.digest("hex");
}
/** Exact first-stream decoded end after the same timestamp normalization used by render. */
export async function inspectCanonicalAudio(
  asset: MediaAsset,
  signal?: AbortSignal,
): Promise<CanonicalAudioFacts> {
  const path = localPath(asset.uri),
    sha256 = await hashFile(path, signal);
  if (asset.contentHash && asset.contentHash !== sha256)
    throw new Error(
      "Audio source bytes changed; inspect or relink before editing.",
    );
  const input = await localMediaInputOptions(path, signal);
  const output = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      ...input,
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ],
    { signal, maxOutputBytes: 1024 * 1024 },
  );
  const probe = JSON.parse(
    output.stdout.toString("utf8"),
  ) as CanonicalAudioFacts["probe"];
  const stream = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!stream) throw new Error("Source has no decodable first audio stream.");
  for (const origin of [probe.format?.start_time, stream.start_time])
    if (origin !== undefined && !Number.isFinite(Number(origin)))
      throw new Error("Audio timestamp origin cannot be reconciled.");
  if (
    probe.format?.start_time === undefined &&
    stream.start_time === undefined &&
    !/^(wav|flac|mp3|aiff|ogg)/.test(probe.format?.format_name ?? "")
  )
    throw new Error(
      "Audio timestamp origin is unknown; inspect or relink the source.",
    );
  const decoded = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-threads",
      "1",
      ...input,
      "-i",
      path,
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      CANONICAL_AUDIO_FILTER,
      "-c:a",
      "pcm_s24le",
      "-progress",
      "pipe:1",
      "-nostats",
      "-f",
      "null",
      "-",
    ],
    { signal, timeoutMs: 900000, maxOutputBytes: 1024 * 1024 },
  );
  const ends = [
    ...decoded.stdout.toString("utf8").matchAll(/^out_time_us=(\d+)$/gm),
  ];
  const microseconds = Number(ends.at(-1)?.[1]);
  let lengthSamples = Math.round((microseconds * 48000) / 1000000);
  const rawDeclared =
    stream.duration !== undefined && stream.duration !== "N/A"
      ? stream.duration
      : probe.format?.duration !== undefined &&
          probe.format.duration !== "N/A"
        ? probe.format.duration
        : asset.duration;
  const declaredSamples = Number.isFinite(Number(rawDeclared))
    ? Math.round(Number(rawDeclared) * 48000)
    : undefined;
  if (
    declaredSamples !== undefined &&
    Math.abs(declaredSamples - lengthSamples) <= 2
  ) {
    lengthSamples = declaredSamples;
  }
  if (
    !Number.isSafeInteger(lengthSamples) ||
    lengthSamples <= 0 ||
    !decoded.stdout.includes("progress=end")
  )
    throw new Error("Decoded audio source duration could not be verified.");
  const facts = {
    assetId: asset.id,
    sourcePath: path,
    sha256,
    lengthSamples,
    probe,
  };
  assertCanonicalAudioCurrent([facts]);
  return facts;
}
/** Runs inside the existing synchronous project publication lock, with bounded memory. */
export function assertCanonicalAudioCurrent(
  facts: readonly CanonicalAudioFacts[],
): void {
  for (const source of facts)
    if (sourceHashSync(source.sourcePath) !== source.sha256)
      throw new Error(
        "Audio source bytes changed during preparation; retry after inspecting the source.",
      );
}
/** Ephemeral server facts; never written to the asset catalog. */
export function withCanonicalAudioFacts(
  asset: MediaAsset,
  facts: CanonicalAudioFacts,
): MediaAsset {
  return {
    ...structuredClone(asset),
    metadata: {
      ...structuredClone(asset.metadata),
      "openfilm.ffprobe": structuredClone(facts.probe),
      "openfilm.audio.canonical": {
        version: 1,
        lengthSamples: facts.lengthSamples,
      },
    },
  };
}
