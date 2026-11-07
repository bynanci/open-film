// SPDX-License-Identifier: Apache-2.0
import {
  createClipAnimationPropertyEvaluator,
  validateClipAnimation,
  type ClipAnimationV1,
  type ProjectTimebaseV1,
} from "@openfilm/core";

/** Bound output-frame evaluations for opacity animation in one render. */
export const MAX_CLIP_OPACITY_SAMPLES_PER_RENDER = 300_000;
/** Bound serialized opacity commands before they are retained in a filter graph. */
export const MAX_CLIP_OPACITY_COMMAND_BYTES_PER_RENDER = 8 * 1024 * 1024;

export interface ClipOpacityFilterPlan {
  filters: string[];
  commandCount: number;
  sampleCount: number;
  byteCount: number;
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Opacity must be finite.");
  if (Object.is(value, -0)) return "0";
  return String(Number(value.toPrecision(15)));
}

function timeAtFrame(frame: number, timebase: ProjectTimebaseV1): string {
  return decimal((frame * timebase.rateDenominator) / timebase.rateNumerator);
}

/**
 * Compile the shared frame evaluator into frame-boundary FFmpeg commands.
 * colorchannelmixer applies one scalar alpha gain with its native pixel loop;
 * it avoids evaluating a cubic-bezier expression separately for every pixel.
 */
export function compileClipOpacityFilters(
  input: ClipAnimationV1 | undefined,
  timebase: ProjectTimebaseV1,
  filterName: string,
  maximumSamples = MAX_CLIP_OPACITY_SAMPLES_PER_RENDER,
  maximumBytes = MAX_CLIP_OPACITY_COMMAND_BYTES_PER_RENDER,
): ClipOpacityFilterPlan {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(filterName))
    throw new Error("Opacity filter name must be an internal identifier.");
  if (!Number.isSafeInteger(maximumSamples) || maximumSamples < 0)
    throw new Error(
      "Opacity frame-sample budget must be a nonnegative integer.",
    );
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
    throw new Error("Opacity byte budget must be a nonnegative integer.");
  if (
    !Number.isSafeInteger(timebase.rateNumerator) ||
    timebase.rateNumerator <= 0 ||
    !Number.isSafeInteger(timebase.rateDenominator) ||
    timebase.rateDenominator <= 0
  )
    throw new Error("Opacity timebase must use positive integer rates.");
  if (!input)
    return { filters: [], commandCount: 0, sampleCount: 0, byteCount: 0 };

  const animation = validateClipAnimation(input);
  const track = animation.visualTracks?.find(
    (candidate) => candidate.property === "opacity",
  );
  if (!track)
    return { filters: [], commandCount: 0, sampleCount: 0, byteCount: 0 };
  const evaluate = createClipAnimationPropertyEvaluator(animation, "opacity");
  if (!evaluate)
    return { filters: [], commandCount: 0, sampleCount: 0, byteCount: 0 };

  const keys = track.keys;
  const initialOpacity = evaluate(0);
  const mixer = `colorchannelmixer@${filterName}=aa=${decimal(initialOpacity)}`;
  const commands: string[] = [];
  let currentOpacity = initialOpacity;
  let sampleCount = 0;
  let commandBytes = 0;

  const append = (frame: number, opacity: number): void => {
    if (opacity === currentOpacity) return;
    const command = `${timeAtFrame(frame, timebase)}-${timeAtFrame(frame + 1, timebase)} [enter] colorchannelmixer@${filterName} aa ${decimal(opacity)}`;
    const nextCommandBytes =
      commandBytes + (commands.length ? 1 : 0) + command.length;
    const wrappersBytes = "sendcmd=c=''".length + mixer.length;
    if (nextCommandBytes + wrappersBytes > maximumBytes)
      throw new Error(
        `Animated opacity exceeds the ${MAX_CLIP_OPACITY_COMMAND_BYTES_PER_RENDER}-byte FFmpeg graph budget. Reduce the animated frame range.`,
      );
    commands.push(command);
    commandBytes = nextCommandBytes;
    currentOpacity = opacity;
  };

  for (let index = 0; index + 1 < keys.length; index++) {
    const from = keys[index]!;
    const to = keys[index + 1]!;
    const interpolation = from.interpolation ?? "linear";
    if (from.value === to.value) continue;
    if (interpolation === "hold") {
      if (sampleCount >= maximumSamples)
        throw new Error(
          `Animated opacity exceeds the ${MAX_CLIP_OPACITY_SAMPLES_PER_RENDER}-frame-sample render limit. Reduce the animated frame range.`,
        );
      sampleCount++;
      append(to.frame, to.value);
      continue;
    }

    const span = to.frame - from.frame;
    if (span > maximumSamples - sampleCount)
      throw new Error(
        `Animated opacity exceeds the ${MAX_CLIP_OPACITY_SAMPLES_PER_RENDER}-frame-sample render limit. Reduce the animated frame range.`,
      );
    sampleCount += span;
    for (let frame = from.frame + 1; frame <= to.frame; frame++)
      append(frame, evaluate(frame));
  }

  if (!commands.length && initialOpacity === 1)
    return { filters: [], commandCount: 0, sampleCount, byteCount: 0 };
  const byteCount =
    commandBytes + (commands.length ? "sendcmd=c=''".length : 0) + mixer.length;
  if (byteCount > maximumBytes)
    throw new Error(
      `Animated opacity exceeds the ${MAX_CLIP_OPACITY_COMMAND_BYTES_PER_RENDER}-byte FFmpeg graph budget. Reduce the animated frame range.`,
    );
  return {
    filters: [
      ...(commands.length ? [`sendcmd=c='${commands.join(";")}'`] : []),
      mixer,
    ],
    commandCount: commands.length,
    sampleCount,
    byteCount,
  };
}
