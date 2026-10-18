import type { FrameSize } from "./geometry.js";
import type { TitleStyle } from "./models.js";

export const TITLE_LAYOUT_VERSION = 1 as const;
/** New graphic-title edits and raster input share this UTF-16 storage bound. */
export const MAX_TITLE_LENGTH = 8_000;

export interface TitleTextMetrics {
  /** Includes advance width and ink overhang, measured in composition pixels. */
  width: number;
  ascent: number;
  descent: number;
  /** Leftmost ink coordinate relative to the text origin; normally zero. */
  left?: number;
}

export type TitleTextMeasure = (
  text: string,
  fontSize: number,
  tracking: number,
) => TitleTextMetrics;

export interface ResolvedTitleStyle {
  version: 1;
  role: TitleStyle["role"];
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Baseline distance as a font-size multiplier. */
  lineHeight: number;
  tracking: number;
  maxWidth: number;
  align: "left" | "center" | "right";
  background: "none" | "scrim";
  position: "center" | "bottom";
}

export interface TitleLine {
  text: string;
  x: number;
  /** Font origin compensates for a negative ink bearing. */
  originX: number;
  baseline: number;
  width: number;
  ascent: number;
  descent: number;
}

export interface TitleLayout {
  version: typeof TITLE_LAYOUT_VERSION;
  frame: FrameSize;
  style: ResolvedTitleStyle;
  lines: TitleLine[];
  /** Complete visible bounds, including an optional scrim. */
  bounds: { x: number; y: number; width: number; height: number };
}

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Title ${field} must be positive and finite.`);
  return value;
}

export function resolveTitleStyle(
  style: TitleStyle | undefined,
  frame: FrameSize,
): ResolvedTitleStyle {
  positive(frame.width, "frame width");
  positive(frame.height, "frame height");
  if (style && style.version !== 1)
    throw new Error("This title style version is unsupported.");
  const role = style?.role ?? "subtitle";
  if (!["film-title", "scene-statement", "subtitle"].includes(role))
    throw new Error("Choose a film title, scene statement or subtitle role.");
  const size = {
    "film-title": 0.075,
    "scene-statement": 0.048,
    subtitle: 0.036,
  };
  const fontSize = positive(
    style?.fontSize ?? frame.height * size[role],
    "font size",
  );
  const tracking = style?.tracking ?? 0;
  if (!Number.isFinite(tracking) || tracking < 0 || tracking > fontSize)
    throw new Error("Title tracking must be between zero and the font size.");
  const lineHeight = positive(style?.lineHeight ?? 1.35, "line height");
  if (lineHeight < 1 || lineHeight > 4)
    throw new Error("Title line height must be between 1 and 4.");
  const fontWeight = style?.fontWeight ?? (role === "film-title" ? 700 : 400);
  if (!Number.isFinite(fontWeight) || fontWeight < 100 || fontWeight > 900)
    throw new Error("Title font weight must be between 100 and 900.");
  const align = style?.align ?? "center";
  const background =
    style?.background ?? (role === "film-title" ? "none" : "scrim");
  const position =
    style?.position ?? (role === "film-title" ? "center" : "bottom");
  if (
    !["left", "center", "right"].includes(align) ||
    !["none", "scrim"].includes(background) ||
    !["center", "bottom"].includes(position)
  )
    throw new Error(
      "Choose a supported title alignment, background and position.",
    );
  return {
    version: 1,
    role,
    fontFamily: style?.fontFamily?.trim() || "Noto Sans CJK TC",
    fontSize,
    fontWeight,
    lineHeight,
    tracking,
    maxWidth: positive(style?.maxWidth ?? frame.width * 0.84, "maximum width"),
    align,
    background,
    position,
  };
}

const noLineStart =
  /^[、。，．！？：；％‰…）］｝〕〉》」』】〗〙〛’”!?.,:;%)\]}]/u;
const noLineEnd = /[（［｛〔〈《「『【〖〘〚‘“([{]$/u;
const latin = /^[\p{Script=Latin}\p{Number}]$/u;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

/**
 * Layout is renderer-independent, but every width must come from the selected
 * font's shaped glyphs. It never estimates widths from character counts.
 */
export function layoutTitleText(
  text: string,
  style: TitleStyle | undefined,
  frame: FrameSize,
  measure: TitleTextMeasure,
): TitleLayout {
  if (typeof text !== "string" || !text.trim())
    throw new Error("Enter title text before rendering.");
  if (text.length > MAX_TITLE_LENGTH)
    throw new Error(
      "Title text is too long. Split it into shorter title cues.",
    );
  if (
    [...text].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    }) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      text,
    )
  )
    throw new Error(
      "Title text contains an unsupported control or invalid Unicode character.",
    );
  const resolved = resolveTitleStyle(style, frame);
  const padding =
    resolved.background === "scrim" ? resolved.fontSize * 0.35 : 0;
  const safeX = frame.width * 0.08 + padding;
  const safeY = frame.height * 0.08 + padding;
  const maxWidth = Math.min(resolved.maxWidth, frame.width - safeX * 2);
  if (maxWidth <= 0)
    throw new Error("The title cannot fit this frame. Reduce the font size.");
  const measured = new Map<string, TitleTextMetrics>();
  const metrics = (value: string): TitleTextMetrics => {
    const cached = measured.get(value);
    if (cached) return cached;
    const result = measure(value, resolved.fontSize, resolved.tracking);
    if (
      ![result.width, result.ascent, result.descent, result.left ?? 0].every(
        Number.isFinite,
      ) ||
      result.width < 0 ||
      result.ascent < 0 ||
      result.descent < 0
    )
      throw new Error("The title font returned invalid glyph measurements.");
    measured.set(value, result);
    return result;
  };
  const rows: string[] = [];
  const paragraphs = text
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, "    ")
    .split(/[\n\u2028\u2029]/u);
  for (const paragraph of paragraphs) {
    const characters = [...segmenter.segment(paragraph)].map(
      (part) => part.segment,
    );
    if (!characters.length) rows.push("");
    for (let start = 0; start < characters.length;) {
      while (start < characters.length && /^\s+$/u.test(characters[start]!))
        start++;
      if (start >= characters.length) break;
      let end = start;
      while (
        end < characters.length &&
        metrics(
          characters
            .slice(start, end + 1)
            .join("")
            .trimEnd(),
        ).width <= maxWidth
      )
        end++;
      if (end === start)
        throw new Error(
          "A title glyph cannot fit the text area. Increase the width or reduce the font size.",
        );
      if (end < characters.length) {
        const legal = (candidate: number, keepWords: boolean): boolean => {
          const previous = characters[candidate - 1]!;
          const next = characters[candidate]!;
          let previousVisible = candidate - 1;
          let nextVisible = candidate;
          while (
            previousVisible > start &&
            /^\s+$/u.test(characters[previousVisible]!)
          )
            previousVisible--;
          while (
            nextVisible < characters.length - 1 &&
            /^\s+$/u.test(characters[nextVisible]!)
          )
            nextVisible++;
          if (
            noLineEnd.test(characters[previousVisible]!) ||
            noLineStart.test(characters[nextVisible]!)
          )
            return false;
          return !keepWords || !(latin.test(previous) && latin.test(next));
        };
        let candidate = end;
        while (candidate > start && !legal(candidate, true)) candidate--;
        if (candidate === start) {
          candidate = end;
          while (candidate > start && !legal(candidate, false)) candidate--;
        }
        if (candidate === start)
          throw new Error(
            "Title punctuation cannot fit safely. Increase the width or reduce the font size.",
          );
        end = candidate;
      }
      rows.push(characters.slice(start, end).join("").trimEnd());
      start = end;
      if (rows.length > 32)
        throw new Error(
          "Title text overflows the frame. Split it into shorter cues.",
        );
    }
  }
  const rowMetrics = rows.map(metrics);
  const ascent = Math.max(...rowMetrics.map((item) => item.ascent));
  const descent = Math.max(...rowMetrics.map((item) => item.descent));
  const pitch = Math.max(
    resolved.fontSize * resolved.lineHeight,
    ascent + descent,
  );
  const textHeight = ascent + descent + pitch * Math.max(0, rows.length - 1);
  if (textHeight > frame.height - safeY * 2)
    throw new Error(
      "Title text overflows the frame. Reduce its size or split it into shorter cues.",
    );
  const top =
    resolved.position === "center"
      ? (frame.height - textHeight) / 2
      : frame.height - safeY - textHeight;
  const lines = rows.map((value, index): TitleLine => {
    const item = rowMetrics[index]!;
    const x =
      resolved.align === "left"
        ? safeX
        : resolved.align === "right"
          ? frame.width - safeX - item.width
          : (frame.width - item.width) / 2;
    return {
      text: value,
      x,
      originX: x - (item.left ?? 0),
      baseline: top + ascent + index * pitch,
      width: item.width,
      ascent: item.ascent,
      descent: item.descent,
    };
  });
  const left = Math.min(...lines.map((line) => line.x));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  return {
    version: TITLE_LAYOUT_VERSION,
    frame: { ...frame },
    style: resolved,
    lines,
    bounds: {
      x: left - padding,
      y: top - padding,
      width: right - left + padding * 2,
      height: textHeight + padding * 2,
    },
  };
}
