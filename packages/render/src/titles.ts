import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { Font, FontCollection, GlyphRun } from "fontkit";
import {
  TITLE_LAYOUT_VERSION,
  layoutTitleRuns,
  resolveTitleRuns,
  resolveTitleStyle,
  type TitleLayout,
  type TitleTextMetrics,
  type FrameSize,
  type TitleStyle,
  type TitleRunId,
  type TitleTextRuns,
} from "@openfilm/core";

export interface TitleFontIdentity {
  family: string;
  postscriptName: string;
  sha256: string;
  path: string;
}

export interface TitleOverlay {
  path: string;
  layout: TitleLayout;
  font: TitleFontIdentity;
  warnings: string[];
  runFonts: TitleRunFontResult[];
}

export interface TitleFontDiagnostic {
  code: "family-fallback" | "weight-fallback";
  run: TitleRunId;
  requestedFamily: string;
  requestedWeight: number;
  actualFamily: string;
  actualWeight: number;
  postscriptName: string;
  sha256: string;
}
export interface TitleRunFontResult {
  id: TitleRunId;
  font: TitleFontIdentity;
  requestedFamily: string;
  requestedWeight: number;
  actualWeight: number;
  diagnostics: TitleFontDiagnostic[];
}
export interface TitleOverlayOptions {
  fontPath?: string;
  textRuns?: TitleTextRuns;
  fontPathForStyle?: (style: TitleStyle | undefined) => string | undefined;
}

export type TitleOverlayInspection =
  | {
      status: "measured";
      layout: TitleLayout;
      font: TitleFontIdentity;
      warnings: string[];
      runFonts: TitleRunFontResult[];
    }
  | {
      status: "failed";
      kind: "font.load-failed" | "title.overflow";
      detail: "unavailable" | "missing-glyph" | "overflow";
      message: string;
      run?: TitleRunId;
    };

interface LoadedFont {
  actualWeight: number;
  font: Font;
  identity: TitleFontIdentity;
  warnings: string[];
}

const fontCache = new Map<
  string,
  {
    signature: string;
    buffer: Buffer;
    sha256: string;
    collection: Font | FontCollection;
  }
>();
// Keep optional title engines out of the static bundle graph. Commands that
// never need a title do not resolve or initialize font shaping or rasterization.
const nativeRequire = createRequire(import.meta.url);
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const digest = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

function candidates(style: {
  fontFamily?: string;
  fontWeight?: number;
}): string[] {
  const bold = (style.fontWeight ?? 400) >= 600;
  const serif = /serif|明體|宋體|songti/iu.test(style.fontFamily ?? "");
  const noto = `Noto${serif ? "Serif" : "Sans"}CJK-${bold ? "Bold" : "Regular"}.ttc`;
  const windows = process.env.WINDIR || "C:\\Windows";
  return [
    `/usr/share/fonts/opentype/noto/${noto}`,
    `/usr/share/fonts/noto-cjk/${noto}`,
    `/usr/share/fonts/truetype/noto/${noto}`,
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    join(
      windows,
      "Fonts",
      `Noto${serif ? "Serif" : "Sans"}CJKtc-${bold ? "Bold" : "Regular"}.otf`,
    ),
    join(windows, "Fonts", bold ? "msjhbd.ttc" : "msjh.ttc"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
}

const familyKey = (value: string): string =>
  value.toLowerCase().replace(/[\s_-]/gu, "");

export function clearFontCache(): void {
  fontCache.clear();
}

async function loadFont(
  style: { fontFamily?: string; fontWeight?: number },
  options: { fontPath?: string } = {},
): Promise<LoadedFont> {
  const override = options.fontPath ?? process.env.OPENFILM_TITLE_FONT;
  let path: string | undefined;
  for (const candidate of override ? [override] : candidates(style)) {
    try {
      if ((await stat(candidate)).isFile()) {
        path = resolve(candidate);
        break;
      }
    } catch {
      // The next explicitly listed local font is the documented fallback.
    }
  }
  if (!path)
    throw new Error(
      "Title font unavailable. Install Noto Sans CJK TC or set OPENFILM_TITLE_FONT to a local OTF, TTF or TTC file.",
    );
  const details = await stat(path);
  const signature = `${details.size}:${details.mtimeMs}:${details.ctimeMs}`;
  let cached = fontCache.get(path);
  if (!cached || cached.signature !== signature) {
    const buffer = await readFile(path);
    const sha256 = digest(buffer);
    if (!cached || cached.sha256 !== sha256) {
      try {
        const { create } = nativeRequire("fontkit") as typeof import("fontkit");
        cached = {
          signature,
          buffer,
          sha256,
          collection: create(buffer),
        };
      } catch {
        throw new Error(
          "The selected title font cannot be read. Choose a valid local OpenType or TrueType font.",
        );
      }
      fontCache.set(path, cached);
      // Full CJK collections are large; keep at most four recently selected files.
      if (fontCache.size > 4) fontCache.delete(fontCache.keys().next().value!);
    } else {
      cached.signature = signature;
    }
  }
  const available =
    "fonts" in cached.collection
      ? cached.collection.fonts
      : [cached.collection];
  if (!available.length)
    throw new Error("The selected title font contains no usable faces.");
  const requested = style.fontFamily ?? "Noto Sans CJK TC";
  const requestedKey = familyKey(requested);
  const familyMatches = available.filter((font) =>
    [font.familyName, font.fullName, font.postscriptName].some(
      (name) => familyKey(name) === requestedKey,
    ),
  );
  const localTc = available.filter((font) =>
    /CJKtc|(?:^|\s)TC(?:\s|$)|PingFangTC|JhengHei/iu.test(
      `${font.postscriptName} ${font.familyName}`,
    ),
  );
  const matching = familyMatches.length
    ? familyMatches
    : localTc.length
      ? localTc
      : available;
  const wantedWeight = style.fontWeight ?? 400;
  const selected = [...matching].sort(
    (first, second) =>
      Math.abs((first["OS/2"]?.usWeightClass ?? 400) - wantedWeight) -
      Math.abs((second["OS/2"]?.usWeightClass ?? 400) - wantedWeight),
  )[0]!;
  const font = selected.variationAxes.wght
    ? selected.getVariation({ wght: wantedWeight })
    : selected;
  const warnings: string[] = [];
  if (
    !familyMatches.length &&
    ![font.familyName, font.fullName, font.postscriptName].some(
      (name) => familyKey(name) === requestedKey,
    )
  )
    warnings.push(
      `Requested font "${requested}" is unavailable; using local "${font.fullName}".`,
    );
  const actualWeight = font["OS/2"]?.usWeightClass ?? 400;
  if (
    !selected.variationAxes.wght &&
    Math.abs(actualWeight - wantedWeight) > 100
  )
    warnings.push(
      `Requested font weight ${wantedWeight} is unavailable; using weight ${actualWeight}.`,
    );
  return {
    font,
    actualWeight: selected.variationAxes.wght ? wantedWeight : actualWeight,
    identity: {
      family: font.familyName,
      postscriptName: font.postscriptName,
      sha256: cached.sha256,
      path,
    },
    warnings,
  };
}

/** Resolve a named face, including a Traditional Chinese face inside a TTC. */
export async function resolveTitleFont(
  style: Pick<TitleStyle, "fontFamily" | "fontWeight"> &
    Partial<Pick<TitleStyle, "role">> = {},
  options: { fontPath?: string } = {},
): Promise<{ font: TitleFontIdentity; warnings: string[] }> {
  const loaded = await loadFont(
    {
      ...style,
      fontWeight: style.fontWeight ?? (style.role === "film-title" ? 700 : 400),
    },
    options,
  );
  return { font: loaded.identity, warnings: loaded.warnings };
}

/** Style defaults are normalized so equivalent persisted input shares a cache. */
export function titleOverlayCacheKey(input: {
  text: string;
  style?: TitleStyle;
  frame: FrameSize;
  fontSha256: string;
  postscriptName: string;
  textRuns?: TitleTextRuns;
  runFonts?: { id: TitleRunId; fontSha256: string; postscriptName: string }[];
}): string {
  const runs = resolveTitleRuns(
    input.text,
    input.textRuns,
    input.style,
    input.frame,
  );
  if (
    input.textRuns &&
    (!input.runFonts ||
      input.runFonts.length !== 2 ||
      input.runFonts.some(
        (font, index) =>
          font.id !== (["primary", "secondary"] as const)[index] ||
          !/^[a-f0-9]{64}$/u.test(font.fontSha256) ||
          !font.postscriptName,
      ))
  )
    throw new Error(
      "Bilingual title cache requires both actual run font identities.",
    );
  return digest(
    JSON.stringify({
      version: TITLE_LAYOUT_VERSION,
      text: input.text,
      style: resolveTitleStyle(input.style, input.frame),
      width: input.frame.width,
      height: input.frame.height,
      font: input.fontSha256,
      face: input.postscriptName,
      ...(input.textRuns
        ? {
            rasterVersion: 2,
            splitAt: input.textRuns.splitAt,
            runs: runs.map((run) => ({ id: run.id, style: run.style })),
            gap:
              input.textRuns.gap ??
              resolveTitleStyle(input.style, input.frame).fontSize * 0.35,
            runFonts: input.runFonts,
          }
        : {}),
    }),
  );
}

/** One immutable set of loaded outlines owns inspection, metrics and pixels. */
async function prepareTitleOverlay(
  text: string,
  style: TitleStyle | undefined,
  frame: FrameSize,
  options: TitleOverlayOptions,
): Promise<{
  inspection: TitleOverlayInspection;
  loaded: Map<TitleRunId, LoadedFont>;
}> {
  const loaded = new Map<TitleRunId, LoadedFont>();
  const fail = (
    failure: Extract<TitleOverlayInspection, { status: "failed" }>,
  ) => ({ inspection: failure, loaded });
  let runs: ReturnType<typeof resolveTitleRuns>;
  try {
    runs = resolveTitleRuns(text, options.textRuns, style, frame);
  } catch (error) {
    return fail({
      status: "failed",
      kind: "title.overflow",
      detail: "overflow",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const runFonts: TitleRunFontResult[] = [];
  for (const run of runs) {
    const identity = options.textRuns ? { run: run.id } : {};
    let face: LoadedFont;
    try {
      face = await loadFont(run.style, {
        fontPath: options.fontPathForStyle?.(run.style) ?? options.fontPath,
      });
    } catch (error) {
      return fail({
        status: "failed",
        kind: "font.load-failed",
        detail: "unavailable",
        ...identity,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    loaded.set(run.id, face);
    for (const character of run.text) {
      const cp = character.codePointAt(0)!;
      if (
        /\s/u.test(character) ||
        cp === 0x200c ||
        cp === 0x200d ||
        (cp >= 0xfe00 && cp <= 0xfe0f)
      )
        continue;
      if (!face.font.hasGlyphForCodePoint(cp))
        return fail({
          status: "failed",
          kind: "font.load-failed",
          detail: "missing-glyph",
          ...identity,
          message: `Title ${run.id} font "${face.font.fullName}" has no glyph for U+${cp.toString(16).toUpperCase()}. Choose a local font covering this text.`,
        });
    }
    const common = {
      run: run.id,
      requestedFamily: run.style.fontFamily,
      requestedWeight: run.style.fontWeight,
      actualFamily: face.identity.family,
      actualWeight: face.actualWeight,
      postscriptName: face.identity.postscriptName,
      sha256: face.identity.sha256,
    };
    const diagnostics: TitleFontDiagnostic[] = [];
    if (face.warnings.some((value) => value.includes("using local")))
      diagnostics.push({ ...common, code: "family-fallback" });
    if (face.warnings.some((value) => value.includes("using weight")))
      diagnostics.push({ ...common, code: "weight-fallback" });
    runFonts.push({
      id: run.id,
      font: face.identity,
      requestedFamily: run.style.fontFamily,
      requestedWeight: run.style.fontWeight,
      actualWeight: face.actualWeight,
      diagnostics,
    });
  }
  try {
    const layout = layoutTitleRuns(
      text,
      options.textRuns,
      style,
      frame,
      (id, value, size, tracking) =>
        measure(loaded.get(id)!.font, value, size, tracking),
    );
    return {
      inspection: {
        status: "measured",
        layout,
        font: runFonts[0]!.font,
        runFonts,
        warnings: runs.flatMap((run) =>
          loaded
            .get(run.id)!
            .warnings.map((warning) =>
              options.textRuns ? `${run.id}: ${warning}` : warning,
            ),
        ),
      },
      loaded,
    };
  } catch (error) {
    return fail({
      status: "failed",
      kind: "title.overflow",
      detail: "overflow",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Measure with actual local faces without creating a raster artifact. */
export async function inspectTitleOverlay(
  text: string,
  style: TitleStyle | undefined,
  frame: FrameSize,
  options: TitleOverlayOptions = {},
): Promise<TitleOverlayInspection> {
  return (await prepareTitleOverlay(text, style, frame, options)).inspection;
}

interface PositionedRun {
  run: GlyphRun;
  x: number;
}

function shape(
  font: Font,
  text: string,
  scale: number,
  tracking: number,
): PositionedRun[] {
  if (!text) return [];
  if (!tracking) return [{ run: font.layout(text), x: 0 }];
  let x = 0;
  return [...graphemes.segment(text)].map(({ segment }) => {
    const run = font.layout(segment);
    const result = { run, x };
    x += run.advanceWidth * scale + tracking;
    return result;
  });
}

function measure(
  font: Font,
  text: string,
  fontSize: number,
  tracking: number,
): TitleTextMetrics {
  const scale = fontSize / font.unitsPerEm;
  const runs = shape(font, text, scale, tracking);
  let minX = 0;
  let maxX = 0;
  let ascent = Math.max(0, font.capHeight * scale);
  let descent = 0;
  for (const { run, x } of runs) {
    if (Number.isFinite(run.bbox.minX))
      minX = Math.min(minX, x + run.bbox.minX * scale);
    if (Number.isFinite(run.bbox.maxX))
      maxX = Math.max(maxX, x + run.bbox.maxX * scale);
    maxX = Math.max(maxX, x + run.advanceWidth * scale);
    if (Number.isFinite(run.bbox.maxY))
      ascent = Math.max(ascent, run.bbox.maxY * scale);
    if (Number.isFinite(run.bbox.minY))
      descent = Math.max(descent, -run.bbox.minY * scale);
  }
  return { width: maxX - minX, ascent, descent, left: minX };
}

const numeric = (value: number): string => String(Number(value.toFixed(6)));

function paths(
  font: Font,
  layout: Pick<TitleLayout, "style" | "lines">,
  strokeWidth?: number,
): string {
  const scale = layout.style.fontSize / font.unitsPerEm;
  const elements: string[] = [];
  for (const line of layout.lines) {
    for (const shaped of shape(font, line.text, scale, layout.style.tracking)) {
      let x = line.originX + shaped.x;
      let y = line.baseline;
      shaped.run.glyphs.forEach((glyph, index) => {
        const position = shaped.run.positions[index]!;
        const path = glyph.path.toSVG();
        if (path)
          elements.push(
            `<path d="${path}"${strokeWidth === undefined ? "" : ` stroke-width="${numeric(strokeWidth / scale)}"`} transform="translate(${numeric(x + position.xOffset * scale)} ${numeric(y - position.yOffset * scale)}) scale(${numeric(scale)} ${numeric(-scale)})"/>`,
          );
        x += position.xAdvance * scale;
        y -= position.yAdvance * scale;
      });
    }
  }
  return elements.join("");
}

/** Shared admission for the title/caption raster and render-required review. */
export function validateTitleOutputDimensions(frame: FrameSize): void {
  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.width * frame.height > 33_177_600
  )
    throw new Error(
      "Title output dimensions must be positive integers no larger than an 8K frame.",
    );
}

/**
 * Rasterize once from actual local font outlines. The browser and FFmpeg reuse
 * this exact full-frame PNG instead of independently wrapping or shaping text.
 */
export async function createTitleOverlay(
  text: string,
  style: TitleStyle | undefined,
  frame: FrameSize,
  outputPath: string,
  options: TitleOverlayOptions = {},
): Promise<TitleOverlay> {
  validateTitleOutputDimensions(frame);
  const { inspection, loaded } = await prepareTitleOverlay(
    text,
    style,
    frame,
    options,
  );
  if (inspection.status === "failed") throw new Error(inspection.message);
  const resolved = resolveTitleStyle(style, frame);
  const layout = inspection.layout;
  const bounds = layout.bounds;
  const scrim =
    resolved.background === "scrim" && !resolved.finishing?.pill
      ? `<rect x="${numeric(bounds.x)}" y="${numeric(bounds.y)}" width="${numeric(bounds.width)}" height="${numeric(bounds.height)}" rx="${numeric(resolved.fontSize * 0.15)}" fill="#000" fill-opacity="0.65"/>`
      : "";
  const runPaths = layout.runLayouts
    ? layout.runLayouts.runs
        .map((run) =>
          paths(
            loaded.get(run.id)!.font,
            run,
            resolved.finishing?.stroke?.width,
          ),
        )
        .join("")
    : paths(
        loaded.get("primary")!.font,
        layout,
        resolved.finishing?.stroke?.width,
      );
  const effect = resolved.finishing;
  const pill = effect?.pill;
  const pills = pill
    ? layout.lines
        .filter((line) => line.text.trim())
        .map((line) => {
          const width = line.width + pill.paddingX * 2,
            height = line.ascent + line.descent + pill.paddingY * 2;
          return `<rect x="${numeric(line.x - pill.paddingX)}" y="${numeric(line.baseline - line.ascent - pill.paddingY)}" width="${numeric(width)}" height="${numeric(height)}" rx="${numeric(Math.min(pill.radius, width / 2, height / 2))}" fill="${pill.color}" fill-opacity="${numeric(pill.opacity)}"/>`;
        })
        .join("")
    : "";
  const stroke = effect?.stroke;
  const glyphs = `<g fill="#fff"${stroke ? ` stroke="${stroke.color}" stroke-width="${numeric(stroke.width)}" stroke-linejoin="round" paint-order="stroke"` : ""}>${runPaths}</g>`;
  const shadow = effect?.shadow;
  const shadowSvg = shadow
    ? `<defs><filter id="title-shadow" filterUnits="userSpaceOnUse" x="${numeric(bounds.x)}" y="${numeric(bounds.y)}" width="${numeric(bounds.width)}" height="${numeric(bounds.height)}"><feGaussianBlur in="SourceAlpha" stdDeviation="${numeric(shadow.blur)}" result="blur"/><feOffset in="blur" dx="${numeric(shadow.offsetX)}" dy="${numeric(shadow.offsetY)}" result="offset"/><feFlood flood-color="${shadow.color}" flood-opacity="${numeric(shadow.opacity)}" result="color"/><feComposite in="color" in2="offset" operator="in"/></filter></defs><g filter="url(#title-shadow)">${glyphs}</g>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">${scrim}${pills}${shadowSvg}${glyphs}</svg>`;
  // No font discovery, external image or network lookup can occur: SVG has
  // only local numerical paths and a rectangle, never user-supplied markup.
  const { Resvg } = nativeRequire(
    "@resvg/resvg-js",
  ) as typeof import("@resvg/resvg-js");
  const raster = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  await writeFile(outputPath, raster.asPng());
  return {
    path: outputPath,
    layout,
    font: inspection.font,
    warnings: inspection.warnings,
    runFonts: inspection.runFonts,
  };
}
