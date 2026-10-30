// SPDX-License-Identifier: Apache-2.0
import type { FrameSize } from "./geometry.js";
import type { TitleStyle } from "./models.js";
import { isCaptionTextValid } from "./caption-text.js";
import {
  MAX_TITLE_LENGTH,
  resolveTitleStyle,
  type ResolvedTitleStyle,
} from "./title-layout.js";

export type TitleRunId = "primary" | "secondary";
export interface TitleRunTypography {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  tracking?: number;
}
export interface TitleTextRuns {
  version: 1;
  splitAt: number;
  primary?: TitleRunTypography;
  secondary?: TitleRunTypography;
  gap?: number;
}
export interface TitleFinishing {
  version: 1;
  shadow?: {
    color: string;
    opacity: number;
    offsetX: number;
    offsetY: number;
    blur: number;
  };
  stroke?: { color: string; width: number };
  pill?: {
    color: string;
    opacity: number;
    paddingX: number;
    paddingY: number;
    radius: number;
  };
}
export interface ResolvedTitleRun {
  id: TitleRunId;
  text: string;
  style: ResolvedTitleStyle;
}

function object(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => d.get || d.set,
    )
  )
    throw new Error(`${path}: expected a plain JSON object.`);
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      throw new Error(`${path}.${key}: unsupported field.`);
  return value as Record<string, unknown>;
}
function number(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(
      `${path}: expected a finite number between ${min} and ${max}.`,
    );
  return value;
}
function typography(value: unknown, path: string): void {
  const data = object(
    value,
    ["fontFamily", "fontSize", "fontWeight", "lineHeight", "tracking"],
    path,
  );
  if (
    Object.hasOwn(data, "fontFamily") &&
    (typeof data.fontFamily !== "string" ||
      !data.fontFamily.trim() ||
      data.fontFamily.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(data.fontFamily))
  )
    throw new Error(
      `${path}.fontFamily: expected a bounded local font family without controls.`,
    );
  if (
    Object.hasOwn(data, "fontSize") &&
    number(data.fontSize, 0, 4096, `${path}.fontSize`) === 0
  )
    throw new Error(`${path}.fontSize: must be positive.`);
  if (
    Object.hasOwn(data, "fontWeight") &&
    !Number.isInteger(number(data.fontWeight, 100, 900, `${path}.fontWeight`))
  )
    throw new Error(`${path}.fontWeight: expected integer weight.`);
  if (Object.hasOwn(data, "lineHeight"))
    number(data.lineHeight, 1, 4, `${path}.lineHeight`);
  if (Object.hasOwn(data, "tracking"))
    number(
      data.tracking,
      0,
      Math.min(100, Number(data.fontSize ?? 100)),
      `${path}.tracking`,
    );
}

/** Admission before a command's saved/effective text is available. */
export function validateTitleTextRunsMetadata(value: unknown): TitleTextRuns {
  const data = object(
    value,
    ["version", "splitAt", "primary", "secondary", "gap"],
    "titleRuns",
  );
  if (data.version !== 1)
    throw new Error("titleRuns.version: unsupported version.");
  if (
    !Number.isSafeInteger(
      number(data.splitAt, 1, MAX_TITLE_LENGTH - 2, "titleRuns.splitAt"),
    )
  )
    throw new Error("titleRuns.splitAt: expected an integer boundary.");
  for (const id of ["primary", "secondary"] as const)
    if (Object.hasOwn(data, id)) typography(data[id], `titleRuns.${id}`);
  if (Object.hasOwn(data, "gap")) number(data.gap, 0, 128, "titleRuns.gap");
  return JSON.parse(JSON.stringify(data)) as TitleTextRuns;
}
export function validateTitleTextRuns(
  value: unknown,
  text: string,
): TitleTextRuns {
  const data = validateTitleTextRunsMetadata(value),
    split = data.splitAt;
  if (
    typeof text !== "string" ||
    text.length > MAX_TITLE_LENGTH ||
    !isCaptionTextValid(text) ||
    split >= text.length - 1 ||
    text[split] !== "\n" ||
    text[split - 1] === "\r" ||
    !text.slice(0, split).trim() ||
    !text.slice(split + 1).trim()
  )
    throw new Error(
      "titleRuns.splitAt: expected an LF boundary between two nonempty safe text runs (at most 8000 units).",
    );
  return data;
}

export function validateTitleFinishing(value: unknown): TitleFinishing {
  const data = object(
    value,
    ["version", "shadow", "stroke", "pill"],
    "finishing",
  );
  if (data.version !== 1)
    throw new Error("finishing.version: unsupported version.");
  for (const id of ["shadow", "stroke", "pill"] as const) {
    if (!Object.hasOwn(data, id)) continue;
    const keys =
      id === "shadow"
        ? ["color", "opacity", "offsetX", "offsetY", "blur"]
        : id === "stroke"
          ? ["color", "width"]
          : ["color", "opacity", "paddingX", "paddingY", "radius"];
    const effect = object(data[id], keys, `finishing.${id}`);
    if (
      typeof effect.color !== "string" ||
      !/^#[0-9a-f]{6}$/iu.test(effect.color)
    )
      throw new Error(`finishing.${id}.color: expected #RRGGBB.`);
    for (const key of keys.filter((key) => key !== "color")) {
      const offset = key === "offsetX" || key === "offsetY";
      number(
        effect[key],
        offset ? -64 : 0,
        key === "opacity" ? 1 : key === "width" || key === "blur" ? 16 : 64,
        `finishing.${id}.${key}`,
      );
    }
  }
  const result = JSON.parse(JSON.stringify(data)) as TitleFinishing;
  for (const effect of [result.shadow, result.stroke, result.pill])
    if (effect) effect.color = effect.color.toUpperCase();
  return result;
}

export function resolveTitleRuns(
  text: string,
  runs: TitleTextRuns | undefined,
  style: TitleStyle | undefined,
  frame: FrameSize,
): ResolvedTitleRun[] {
  const base = resolveTitleStyle(style, frame);
  if (!runs) return [{ id: "primary", text, style: base }];
  const checked = validateTitleTextRuns(runs, text);
  return (["primary", "secondary"] as const).map((id) => ({
    id,
    text:
      id === "primary"
        ? text.slice(0, checked.splitAt)
        : text.slice(checked.splitAt + 1),
    style: resolveTitleStyle(
      { ...style, version: 1, role: style?.role ?? "subtitle", ...checked[id] },
      frame,
    ),
  }));
}
