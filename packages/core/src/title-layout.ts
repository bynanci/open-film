import type { FrameSize } from "./geometry.js";
import type { TitleStyle } from "./models.js";
import {
  resolveTitleRuns,
  validateTitleFinishing,
  type TitleRunId,
  type TitleTextRuns,
  type TitleFinishing,
} from "./title-runs.js";

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
export type TitleRunTextMeasure = (
  run: TitleRunId,
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
  fadeOut: number;
  bottomSafeMargin: number;
  safeArea: { left: number; right: number; top: number; bottom: number };
  finishing?: TitleFinishing;
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
  runLayouts?: { version: 1; runs: TitleRunLayout[] };
}
export interface TitleRunLayout {
  id: TitleRunId;
  style: ResolvedTitleStyle;
  lines: TitleLine[];
  bounds: TitleLayout["bounds"];
}

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Title ${field} must be positive and finite.`);
  return value;
}

function bounded(value: number, maximum: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum)
    throw new Error(
      `Title ${field} must be finite and between 0 and ${maximum}.`,
    );
  return value;
}

/**
 * Opacity of only the native text graphic (including its optional scrim).
 * Time is local timeline time, independent of a source trim, speed or clip start.
 */
export function evaluateTitleOpacity(
  style: TitleStyle | undefined,
  localTime: number,
  duration: number,
): number {
  if (!Number.isFinite(localTime))
    throw new Error("Title local time must be finite.");
  if (!Number.isFinite(duration) || duration < 0)
    throw new Error("Title duration must be nonnegative and finite.");
  const fadeOut = Math.min(
    bounded(style?.fadeOut ?? 0, 10, "fade duration"),
    duration,
  );
  if (localTime < 0 || localTime >= duration) return 0;
  if (fadeOut === 0) return 1;
  return Math.min(1, (duration - localTime) / fadeOut);
}

export function resolveTitleStyle(
  style: TitleStyle | undefined,
  frame: FrameSize,
): ResolvedTitleStyle {
  positive(frame.width, "frame width");
  positive(frame.height, "frame height");
  if (style && style.version !== 1)
    throw new Error("This title style version is unsupported.");
  const finishing =
    style?.finishing === undefined
      ? undefined
      : validateTitleFinishing(style.finishing);
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
  const safeArea = {
    left: bounded(style?.safeArea?.left ?? 0.08, 0.3, "left safe margin"),
    right: bounded(style?.safeArea?.right ?? 0.08, 0.3, "right safe margin"),
    top: bounded(style?.safeArea?.top ?? 0.08, 0.3, "top safe margin"),
    bottom: bounded(
      style?.safeArea?.bottom ??
        (position === "bottom" ? style?.bottomSafeMargin : undefined) ??
        0.08,
      0.3,
      "bottom safe margin",
    ),
  };
  if (
    safeArea.left + safeArea.right >= 0.95 ||
    safeArea.top + safeArea.bottom >= 0.95
  )
    throw new Error("Title safe-area margins leave no usable frame area.");
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
    fadeOut: bounded(style?.fadeOut ?? 0, 10, "fade duration"),
    bottomSafeMargin: safeArea.bottom,
    safeArea,
    ...(finishing && (finishing.shadow || finishing.stroke || finishing.pill)
      ? { finishing }
      : {}),
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
  if (style?.finishing) {
    const checked = validateTitleFinishing(style.finishing);
    if (checked.shadow || checked.stroke || checked.pill)
      return layoutTitleRuns(
        text,
        undefined,
        style,
        frame,
        (_id, value, size, tracking) => measure(value, size, tracking),
      );
  }
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
  const safeLeft = frame.width * resolved.safeArea.left + padding;
  const safeRight = frame.width * resolved.safeArea.right + padding;
  const safeTop = frame.height * resolved.safeArea.top + padding;
  const safeBottom = frame.height * resolved.safeArea.bottom + padding;
  const maxWidth = Math.min(
    resolved.maxWidth,
    frame.width - safeLeft - safeRight,
  );
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
  if (textHeight > frame.height - safeTop - safeBottom)
    throw new Error(
      "Title text overflows the frame. Reduce its size or split it into shorter cues.",
    );
  const bottomPosition = frame.height - safeBottom - textHeight;
  const top =
    resolved.position === "center"
      ? Math.max(
          safeTop,
          Math.min((frame.height - textHeight) / 2, bottomPosition),
        )
      : bottomPosition;
  const lines = rows.map((value, index): TitleLine => {
    const item = rowMetrics[index]!;
    const x =
      resolved.align === "left"
        ? safeLeft
        : resolved.align === "right"
          ? frame.width - safeRight - item.width
          : safeLeft + (frame.width - safeLeft - safeRight - item.width) / 2;
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

/** The same measured paragraph owner, stacked once with complete paint safety. */
export function layoutTitleRuns(
  text: string,
  runs: TitleTextRuns | undefined,
  style: TitleStyle | undefined,
  frame: FrameSize,
  measure: TitleRunTextMeasure,
): TitleLayout {
  const base = resolveTitleStyle(style, frame);
  if (!runs && !base.finishing)
    return layoutTitleText(text, style, frame, (value, size, tracking) =>
      measure("primary", value, size, tracking),
    );
  const resolved = resolveTitleRuns(text, runs, style, frame);
  const finishing = base.finishing;
  const stroke = (finishing?.stroke?.width ?? 0) / 2;
  const shadow = finishing?.shadow;
  const padding =
    base.background === "scrim" && !finishing?.pill ? base.fontSize * 0.35 : 0;
  const horizontal = Math.max(padding, finishing?.pill?.paddingX ?? 0, stroke);
  const vertical = Math.max(padding, finishing?.pill?.paddingY ?? 0, stroke);
  const left = Math.max(
    horizontal,
    stroke + (shadow ? shadow.blur * 3 - shadow.offsetX : 0),
  );
  const right = Math.max(
    horizontal,
    stroke + (shadow ? shadow.blur * 3 + shadow.offsetX : 0),
  );
  const top = Math.max(
    vertical,
    stroke + (shadow ? shadow.blur * 3 - shadow.offsetY : 0),
  );
  const bottom = Math.max(
    vertical,
    stroke + (shadow ? shadow.blur * 3 + shadow.offsetY : 0),
  );
  const innerWidth =
    frame.width * (1 - base.safeArea.left - base.safeArea.right) - left - right;
  if (innerWidth <= 0)
    throw new Error(
      "Title finishing cannot fit this frame. Reduce the font size or effects.",
    );
  const layouts = resolved.map((run) => ({
    id: run.id,
    style: run.style,
    layout: layoutTitleText(
      run.text,
      {
        ...run.style,
        finishing: undefined,
        background: "none",
        position: "center",
        safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      { width: innerWidth, height: frame.height },
      (value, size, tracking) => measure(run.id, value, size, tracking),
    ),
  }));
  if (layouts.reduce((count, run) => count + run.layout.lines.length, 0) > 32)
    throw new Error(
      "Title text overflows the frame. Split it into shorter cues.",
    );
  const gap = runs ? (runs.gap ?? base.fontSize * 0.35) : 0;
  const inkHeight =
    layouts.reduce((height, run) => height + run.layout.bounds.height, 0) +
    gap * (layouts.length - 1);
  const outerHeight = inkHeight + top + bottom;
  const safeTop = frame.height * base.safeArea.top;
  const maximumTop = frame.height * (1 - base.safeArea.bottom) - outerHeight;
  if (maximumTop < safeTop - 1e-7)
    throw new Error(
      "Title text overflows the frame. Reduce its size, gap or finishing.",
    );
  const outerTop =
    base.position === "bottom"
      ? maximumTop
      : Math.max(
          safeTop,
          Math.min((frame.height - outerHeight) / 2, maximumTop),
        );
  const offsetX = frame.width * base.safeArea.left + left;
  let nextTop = outerTop + top;
  const runLayouts: TitleRunLayout[] = layouts.map((run) => {
    const offsetY = nextTop - run.layout.bounds.y;
    const lines = run.layout.lines.map((line) => ({
      ...line,
      x: line.x + offsetX,
      originX: line.originX + offsetX,
      baseline: line.baseline + offsetY,
    }));
    const bounds = {
      ...run.layout.bounds,
      x: run.layout.bounds.x + offsetX,
      y: nextTop,
    };
    nextTop += run.layout.bounds.height + gap;
    return { id: run.id, style: run.style, lines, bounds };
  });
  const lines = runLayouts.flatMap((run) => run.lines);
  const minX = Math.min(...lines.map((line) => line.x));
  const maxX = Math.max(...lines.map((line) => line.x + line.width));
  return {
    version: TITLE_LAYOUT_VERSION,
    frame: { ...frame },
    style: base,
    lines,
    runLayouts: { version: 1, runs: runLayouts },
    bounds: {
      x: minX - left,
      y: outerTop,
      width: maxX - minX + left + right,
      height: outerHeight,
    },
  };
}
