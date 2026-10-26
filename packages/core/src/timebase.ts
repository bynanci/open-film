// Modified by OpenFilm contributors on 2026-10-26. See LICENSE/NOTICE.
import type { ProjectSettings, ProjectTimebaseV1 } from "./models.js";

const MAX_DENOMINATOR = 1_000_000;

function checkedTimebase(value: ProjectTimebaseV1): ProjectTimebaseV1 {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("timebase must be a plain object.");
  if (value.version !== 1) throw new Error("timebase.version must be 1.");
  for (const key of ["rateNumerator", "rateDenominator"] as const) {
    if (!Number.isInteger(value[key]) || value[key] <= 0)
      throw new Error(`timebase.${key} must be a positive integer.`);
  }
  if (typeof value.dropFrame !== "boolean")
    throw new Error("timebase.dropFrame must be a boolean.");
  if (
    value.dropFrame &&
    !(
      value.rateDenominator === 1001 &&
      (value.rateNumerator === 30000 || value.rateNumerator === 60000)
    )
  )
    throw new Error("timebase.dropFrame requires 30000/1001 or 60000/1001.");
  return value;
}

export function timebaseRate(timebase: ProjectTimebaseV1): number {
  const value = checkedTimebase(timebase);
  return value.rateNumerator / value.rateDenominator;
}

/** Timecode counts nominal labels; elapsed seconds use the rational rate. */
export function nominalFrameRate(timebase: ProjectTimebaseV1): number {
  return Math.max(1, Math.round(timebaseRate(timebase)));
}

/** Stable identity includes the version and DF label convention. */
export function timebaseKey(timebase: ProjectTimebaseV1): string {
  checkedTimebase(timebase);
  return `v1:${timebase.rateNumerator}/${timebase.rateDenominator}:${timebase.dropFrame ? "df" : "ndf"}`;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function legacyTimebase(rate: number): ProjectTimebaseV1 {
  for (const numerator of [24000, 30000, 60000]) {
    if (Math.abs(rate - numerator / 1001) <= 0.001)
      return {
        version: 1,
        rateNumerator: numerator,
        rateDenominator: 1001,
        dropFrame: false,
      };
  }
  // Read the decimal spelling exactly, including scientific notation. BigInt
  // avoids overflowing intermediate products for large finite legacy rates.
  const [coefficient, power = "0"] = String(rate).split("e");
  const fractionalDigits = coefficient!.split(".")[1]?.length ?? 0;
  const exponent = Number(power) - fractionalDigits;
  let numerator = BigInt(coefficient!.replace(".", ""));
  let denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  const limit = BigInt(MAX_DENOMINATOR);
  if (denominator > limit) {
    numerator = (numerator * limit + denominator / 2n) / denominator;
    // The smallest positive representable bounded ratio is 1 / limit.
    if (numerator === 0n) numerator = 1n;
    denominator = limit;
  }
  const divisor = gcd(numerator, denominator);
  return checkedTimebase({
    version: 1,
    rateNumerator: Number(numerator / divisor),
    rateDenominator: Number(denominator / divisor),
    dropFrame: false,
  });
}

/** Derivation never writes optional metadata back to a legacy project. */
export function resolveProjectTimebase(
  settings: ProjectSettings,
): ProjectTimebaseV1 {
  if (!Number.isFinite(settings.frameRate) || settings.frameRate <= 0)
    throw new Error("frameRate must be finite and positive.");
  if (settings.timebase === undefined)
    return legacyTimebase(settings.frameRate);
  const timebase = checkedTimebase(settings.timebase);
  const rate = timebaseRate(timebase);
  if (Math.abs(settings.frameRate - rate) / rate > 1e-9)
    throw new Error("frameRate does not match timebase rate.");
  return { ...timebase };
}

export function projectFrameRate(settings: ProjectSettings): number {
  return timebaseRate(resolveProjectTimebase(settings));
}

function checkedFrame(frame: number): number {
  if (!Number.isSafeInteger(frame) || frame < 0)
    throw new Error("frame must be a nonnegative safe integer.");
  return frame;
}

export function sequenceFrameAt(
  seconds: number,
  timebase: ProjectTimebaseV1,
  rounding: "floor" | "nearest" = "floor",
): number {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("seconds must be finite and nonnegative.");
  if (rounding !== "floor" && rounding !== "nearest")
    throw new Error("rounding must be floor or nearest.");
  const frames = seconds * timebaseRate(timebase);
  const nearest = Math.round(frames);
  // Reversing seconds conversion can land a few ULPs below an integer frame.
  const snapped =
    Math.abs(frames - nearest) <= Number.EPSILON * Math.max(1, frames) * 4
      ? nearest
      : frames;
  return checkedFrame(
    rounding === "nearest" ? Math.round(snapped) : Math.floor(snapped),
  );
}

export function sequenceTimeAt(
  frame: number,
  timebase: ProjectTimebaseV1,
): number {
  return checkedFrame(frame) / timebaseRate(timebase);
}

/** Hours continue past 24 so long sequences preserve their integer frame identity. */
export function formatSequenceTimecode(
  frame: number,
  timebase: ProjectTimebaseV1,
): string {
  checkedFrame(frame);
  const nominal = BigInt(nominalFrameRate(timebase));
  let labels = BigInt(frame);
  if (timebase.dropFrame) {
    const drop = nominal / 15n;
    const minuteFrames = nominal * 60n - drop;
    const tenMinuteFrames = nominal * 600n - drop * 9n;
    const blocks = labels / tenMinuteFrames;
    const remainder = labels % tenMinuteFrames;
    labels += blocks * drop * 9n;
    if (remainder >= drop) labels += drop * ((remainder - drop) / minuteFrames);
  }
  const frameLabel = labels % nominal;
  const totalSeconds = labels / nominal;
  const pad = (value: bigint, width = 2) => String(value).padStart(width, "0");
  return `${pad(totalSeconds / 3600n)}:${pad((totalSeconds / 60n) % 60n)}:${pad(totalSeconds % 60n)}${timebase.dropFrame ? ";" : ":"}${pad(frameLabel, Math.max(2, String(nominal - 1n).length))}`;
}

export function parseSequenceTimecode(
  value: string,
  timebase: ProjectTimebaseV1,
): number {
  const nominal = BigInt(nominalFrameRate(timebase));
  const match =
    typeof value === "string"
      ? /^(\d{2,}):(\d{2}):(\d{2})([:;])(\d{2,})$/u.exec(value)
      : null;
  if (!match || match[0] !== value)
    throw new Error("Invalid sequence timecode.");
  const [, hours, minutes, seconds, separator, frames] = match;
  if (separator !== (timebase.dropFrame ? ";" : ":"))
    throw new Error("Timecode separator does not match timebase.dropFrame.");
  const minute = BigInt(minutes!);
  const second = BigInt(seconds!);
  const frame = BigInt(frames!);
  if (
    minute >= 60n ||
    second >= 60n ||
    frame >= nominal ||
    frames!.length !== Math.max(2, String(nominal - 1n).length)
  )
    throw new Error("Timecode field is out of range.");
  const totalMinutes = BigInt(hours!) * 60n + minute;
  let result = (totalMinutes * 60n + second) * nominal + frame;
  if (timebase.dropFrame) {
    const drop = nominal / 15n;
    if (minute % 10n !== 0n && second === 0n && frame < drop)
      throw new Error("Timecode contains a nonexistent drop-frame label.");
    result -= drop * (totalMinutes - totalMinutes / 10n);
  }
  return checkedFrame(Number(result));
}

export function projectSettingsWithTimebase(
  settings: ProjectSettings,
  timebase: ProjectTimebaseV1,
): ProjectSettings {
  return {
    ...settings,
    frameRate: timebaseRate(timebase),
    timebase: { ...timebase },
  };
}
