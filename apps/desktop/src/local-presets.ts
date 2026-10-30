// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  PRESET_LIMITS,
  parsePresetPackage,
  type FilmLook,
} from "@openfilm/core";
export function createPresetTaskScope() {
  let generation = 0,
    controller: AbortController | undefined;
  return {
    begin() {
      controller?.abort();
      const owner = ++generation,
        active = new AbortController();
      controller = active;
      return {
        signal: active.signal,
        current: () => generation === owner && !active.signal.aborted,
      };
    },
    cancel() {
      generation++;
      controller?.abort();
    },
  };
}
export async function readPresetFileSelection(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (file.size > PRESET_LIMITS.packageBytes)
    throw new ApplicationError(
      "request.tooLarge",
      "Choose a preset JSON file no larger than 256 KiB.",
      413,
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  parsePresetPackage(bytes);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
export function presetLookLabel(
  look: FilmLook,
  translate: (key: string) => string,
): string {
  return look.version === 2
    ? `${look.snapshot.name} · ${look.snapshot.packageVersion}`
    : translate(`looks.presets.${look.preset}`);
}
