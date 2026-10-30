// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import {
  PROJECT_SCHEMA_VERSION,
  PROJECT_CONTENT_LOCALES,
  MAX_SCENE_DIRECTION_RECEIPTS,
  FILM_LOOK_PRESET_IDS,
  type Composition,
  type Job,
  type MediaAsset,
  type OpenFilmProject,
  type Story,
  type PhotoLayout,
  type PhotoMotion,
  type TitleStyle,
  type AudioAutomation,
  type FilmLook,
  type CaptionCueSource,
  type CaptionTrack,
  type ProjectSettings,
} from "./models.js";
import { resolveProjectTimebase } from "./timebase.js";
import {
  isCaptionTextValid,
  MAX_CAPTION_CUE_COUNT,
  MAX_CAPTION_TEXT_CHARACTERS,
  MAX_CAPTION_TIME_MS,
} from "./caption-text.js";
import {
  validateGraphicScenes,
  graphicSceneAssetIds,
} from "./graphic-scenes.js";
import { validateGraphicSceneTemplates } from "./graphic-scene-templates.js";
import { validateStoryGraph } from "./story-graph.js";
import {
  validatePresetSnapshot,
  validatePresetPlanSource,
  validatePresetReceipts,
  projectPresetSnapshots,
  assertPresetJsonData,
} from "./presets.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

/** The failing field is included so callers can display an actionable error. */
export class ProjectValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ProjectValidationError";
    this.issues = [{ path, message }];
  }
}

export interface ProjectValidationOptions {
  /** Optional catalog IDs: project manifests deliberately do not embed assets. */
  assetIds?: Iterable<string>;
}

type ObjectValue = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ProjectValidationError(path, message);
}

function object(value: unknown, path: string): ObjectValue {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    fail(path, "expected a plain object");
  }
  return value as ObjectValue;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i))
      fail(`${path}[${i}]`, "sparse arrays cannot be persisted");
  }
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim())
    fail(path, "expected a non-empty string");
  return value;
}

/** Match the bounded knowledge identifiers without importing its cyclic domain. */
function receiptIdentifier(value: unknown, path: string): void {
  const text = string(value, path);
  if (text.length > 256) fail(path, "expected at most 256 UTF-16 code units");
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff))
      fail(path, "expected well-formed Unicode without control characters");
  }
}

function number(
  value: unknown,
  path: string,
  min = -Infinity,
  max = Infinity,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    fail(path, `expected a finite number between ${min} and ${max}`);
  }
  return value;
}

function positive(value: unknown, path: string): number {
  const result = number(value, path, 0);
  if (result === 0) fail(path, "expected a number greater than zero");
  return result;
}

function dimension(value: unknown, path: string): void {
  if (!Number.isInteger(positive(value, path)))
    fail(path, "expected a positive integer");
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
}

function optional(
  value: ObjectValue,
  key: string,
  path: string,
  check: (v: unknown, p: string) => unknown,
): void {
  if (value[key] !== undefined) check(value[key], `${path}.${key}`);
}

function choice(
  value: unknown,
  path: string,
  values: readonly string[],
): string {
  const result = string(value, path);
  if (!values.includes(result))
    fail(path, `expected one of ${values.join(", ")}`);
  return result;
}

function presentationObject(
  value: unknown,
  path: string,
  keys: string[],
): ObjectValue {
  const data = object(value, path);
  for (const key of Object.keys(data))
    if (!keys.includes(key))
      fail(`${path}.${key}`, "unsupported presentation field");
  return data;
}

function filmLook(value: unknown, path: string): FilmLook {
  assertPresetJsonData(value);
  if (
    value &&
    typeof value === "object" &&
    Object.getOwnPropertyDescriptor(value, "version")?.value === 2
  ) {
    const data = presentationObject(value, path, [
      "version",
      "preset",
      "strength",
      "snapshot",
    ]);
    if (data.preset !== "local")
      fail(`${path}.preset`, "expected local preset discriminator");
    number(data.strength, `${path}.strength`, 0, 1);
    validatePresetSnapshot(data.snapshot, "film-look");
    return data as unknown as FilmLook;
  }
  const data = presentationObject(value, path, [
    "version",
    "preset",
    "strength",
  ]);
  if (data.version !== 1)
    fail(`${path}.version`, "expected supported look version 1");
  choice(data.preset, `${path}.preset`, FILM_LOOK_PRESET_IDS);
  const strength = number(data.strength, `${path}.strength`, 0);
  if (strength > 1)
    fail(`${path}.strength`, "expected a strength between 0 and 1");
  return data as unknown as FilmLook;
}

export function validateFilmLook(value: unknown): FilmLook {
  filmLook(value, "look");
  return copyJson(value, "look") as FilmLook;
}

function versionOne(value: ObjectValue, path: string): void {
  if (value.version !== 1)
    fail(`${path}.version`, "expected supported presentation version 1");
}

function focalPoint(value: unknown, path: string): void {
  const data = presentationObject(value, path, ["x", "y"]);
  number(data.x, `${path}.x`, 0, 1);
  number(data.y, `${path}.y`, 0, 1);
}

function protectedRegion(value: unknown, path: string): void {
  const data = presentationObject(value, path, ["x", "y", "width", "height"]);
  const x = number(data.x, `${path}.x`, 0, 1);
  const y = number(data.y, `${path}.y`, 0, 1);
  const width = positive(data.width, `${path}.width`);
  const height = positive(data.height, `${path}.height`);
  if (x + width > 1 + 1e-9 || y + height > 1 + 1e-9)
    fail(path, "protected region must fit inside the normalized source");
}

function photoLayout(value: unknown, path: string): PhotoLayout {
  const data = presentationObject(value, path, [
    "version",
    "preset",
    "focalPoint",
    "protectedRegion",
    "secondary",
    "gap",
  ]);
  versionOne(data, path);
  const preset = choice(data.preset, `${path}.preset`, [
    "contain",
    "hero",
    "diptych",
  ]);
  optional(data, "focalPoint", path, focalPoint);
  optional(data, "protectedRegion", path, protectedRegion);
  optional(data, "gap", path, (v, p) => number(v, p, 0));
  optional(data, "secondary", path, (v, p) => {
    const secondary = presentationObject(v, p, [
      "assetId",
      "focalPoint",
      "protectedRegion",
    ]);
    string(secondary.assetId, `${p}.assetId`);
    optional(secondary, "focalPoint", p, focalPoint);
    optional(secondary, "protectedRegion", p, protectedRegion);
  });
  if (preset === "diptych" && data.secondary === undefined)
    fail(`${path}.secondary`, "diptych requires a second image");
  if (
    preset !== "diptych" &&
    (data.secondary !== undefined || data.gap !== undefined)
  )
    fail(path, "secondary image and gap apply only to diptych");
  return data as unknown as PhotoLayout;
}

export function validatePhotoLayout(value: unknown): PhotoLayout {
  photoLayout(value, "layout");
  return copyJson(value, "layout") as PhotoLayout;
}

function photoMotion(value: unknown, path: string): PhotoMotion {
  const data = presentationObject(value, path, [
    "version",
    "preset",
    "easing",
    "from",
    "to",
  ]);
  versionOne(data, path);
  choice(data.preset, `${path}.preset`, ["hold", "push-in", "pull-out", "pan"]);
  choice(data.easing, `${path}.easing`, ["linear", "ease-in-out"]);
  for (const endpoint of ["from", "to"]) {
    const transform = presentationObject(
      data[endpoint],
      `${path}.${endpoint}`,
      ["scale", "x", "y"],
    );
    number(transform.scale, `${path}.${endpoint}.scale`, 1, 10);
    number(transform.x, `${path}.${endpoint}.x`);
    number(transform.y, `${path}.${endpoint}.y`);
  }
  return data as unknown as PhotoMotion;
}

export function validatePhotoMotion(value: unknown): PhotoMotion {
  photoMotion(value, "motion");
  return copyJson(value, "motion") as PhotoMotion;
}

function titleStyle(value: unknown, path: string): TitleStyle {
  const data = presentationObject(value, path, [
    "version",
    "role",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "tracking",
    "maxWidth",
    "align",
    "background",
    "position",
    "fadeOut",
    "bottomSafeMargin",
    "safeArea",
  ]);
  versionOne(data, path);
  choice(data.role, `${path}.role`, [
    "film-title",
    "scene-statement",
    "subtitle",
  ]);
  optional(data, "fontFamily", path, (v, p) => {
    const family = string(v, p);
    if (
      family.length > 256 ||
      [...family].some((character) => {
        const code = character.codePointAt(0)!;
        return code < 32 || code === 127;
      })
    )
      fail(p, "expected a font family without control characters");
  });
  optional(data, "fontSize", path, (v, p) => {
    positive(v, p);
    number(v, p, 0, 4096);
  });
  optional(data, "maxWidth", path, positive);
  optional(data, "fontWeight", path, (v, p) => {
    if (!Number.isInteger(number(v, p, 100, 900)))
      fail(p, "expected an integer font weight");
  });
  optional(data, "lineHeight", path, (v, p) => number(v, p, 1, 4));
  optional(data, "tracking", path, (v, p) =>
    number(v, p, 0, Math.min(100, Number(data.fontSize ?? 100))),
  );
  optional(data, "align", path, (v, p) =>
    choice(v, p, ["left", "center", "right"]),
  );
  optional(data, "background", path, (v, p) => choice(v, p, ["none", "scrim"]));
  optional(data, "position", path, (v, p) =>
    choice(v, p, ["center", "bottom"]),
  );
  optional(data, "fadeOut", path, (v, p) => number(v, p, 0, 10));
  optional(data, "bottomSafeMargin", path, (v, p) => number(v, p, 0, 0.3));
  optional(data, "safeArea", path, (v, p) => {
    const safe = presentationObject(v, p, ["left", "right", "top", "bottom"]);
    for (const edge of ["left", "right", "top", "bottom"])
      optional(safe, edge, p, (edgeValue, edgePath) =>
        number(edgeValue, edgePath, 0, 0.3),
      );
    if (
      Number(safe.left ?? 0.08) + Number(safe.right ?? 0.08) >= 0.95 ||
      Number(safe.top ?? 0.08) + Number(safe.bottom ?? 0.08) >= 0.95
    )
      fail(p, "safe-area margins leave no usable frame area");
  });
  return data as unknown as TitleStyle;
}

export function validateTitleStyle(value: unknown): TitleStyle {
  titleStyle(value, "titleStyle");
  return copyJson(value, "titleStyle") as TitleStyle;
}

function captionCueSource(value: unknown, path: string): CaptionCueSource {
  const record = object(value, path);
  const kind = choice(record.kind, `${path}.kind`, ["manual", "transcript"]);
  if (kind === "manual") {
    presentationObject(value, path, ["kind"]);
    return { kind };
  }
  const source = presentationObject(value, path, [
    "kind",
    "assetId",
    "transcriptId",
    "transcriptRevisionId",
    "segmentId",
    "clipId",
    "alignment",
    "sourceIn",
    "sourceOut",
  ]);
  for (const field of [
    "assetId",
    "transcriptId",
    "transcriptRevisionId",
    "segmentId",
    "clipId",
  ])
    receiptIdentifier(source[field], `${path}.${field}`);
  choice(source.alignment, `${path}.alignment`, ["segment"]);
  const sourceIn = number(source.sourceIn, `${path}.sourceIn`, 0);
  const sourceOut = positive(source.sourceOut, `${path}.sourceOut`);
  if (sourceOut <= sourceIn)
    fail(`${path}.sourceOut`, "must be greater than sourceIn");
  return source as unknown as CaptionCueSource;
}

function captionTrack(
  value: unknown,
  path: string,
  compositionDuration: number,
): CaptionTrack {
  const data = presentationObject(value, path, [
    "version",
    "id",
    "name",
    "language",
    "style",
    "cues",
  ]);
  versionOne(data, path);
  receiptIdentifier(data.id, `${path}.id`);
  const name = string(data.name, `${path}.name`);
  if (name.length > 256)
    fail(`${path}.name`, "expected at most 256 characters");
  optional(data, "language", path, (v, p) => {
    const language = string(v, p);
    if (
      language.length > 35 ||
      !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(language)
    )
      fail(p, "expected a bounded BCP-47 language tag");
  });
  titleStyle(data.style, `${path}.style`);
  if ((data.style as Record<string, unknown>).role !== "subtitle")
    fail(`${path}.style.role`, "caption tracks require the subtitle role");
  const cues = array(data.cues, `${path}.cues`);
  if (cues.length > MAX_CAPTION_CUE_COUNT)
    fail(`${path}.cues`, `expected at most ${MAX_CAPTION_CUE_COUNT} cues`);
  const cueIds = new Set<string>();
  let textCharacters = 0;
  const maximumEnd = Math.min(
    MAX_CAPTION_TIME_MS,
    Math.floor(compositionDuration * 1000 + 1e-7),
  );
  cues.forEach((entry, index) => {
    const cuePath = `${path}.cues[${index}]`;
    const cue = presentationObject(entry, cuePath, [
      "version",
      "id",
      "startMs",
      "endMs",
      "text",
      "source",
      "warnings",
      "manualRevision",
    ]);
    versionOne(cue, cuePath);
    receiptIdentifier(cue.id, `${cuePath}.id`);
    const id = cue.id as string;
    if (cueIds.has(id)) fail(`${cuePath}.id`, `duplicate caption cue ID ${id}`);
    cueIds.add(id);
    const start = number(
      cue.startMs,
      `${cuePath}.startMs`,
      0,
      MAX_CAPTION_TIME_MS,
    );
    const end = number(cue.endMs, `${cuePath}.endMs`, 0, MAX_CAPTION_TIME_MS);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      fail(cuePath, "caption times must be integer milliseconds");
    if (end <= start) fail(`${cuePath}.endMs`, "must follow startMs");
    if (end > maximumEnd)
      fail(`${cuePath}.endMs`, "caption cue extends beyond the composition");
    const text = string(cue.text, `${cuePath}.text`);
    if (!text.trim() || !isCaptionTextValid(text))
      fail(`${cuePath}.text`, "expected non-empty safe Unicode caption text");
    textCharacters += text.length;
    if (textCharacters > MAX_CAPTION_TEXT_CHARACTERS)
      fail(`${path}.cues`, "caption text exceeds the composition limit");
    const revision = number(cue.manualRevision, `${cuePath}.manualRevision`, 0);
    if (!Number.isSafeInteger(revision))
      fail(`${cuePath}.manualRevision`, "expected a nonnegative safe integer");
    captionCueSource(cue.source, `${cuePath}.source`);
    optional(cue, "warnings", cuePath, (warnings, warningsPath) => {
      const entries = array(warnings, warningsPath);
      if (entries.length > 2)
        fail(warningsPath, "expected at most two caption review warnings");
      const supported = new Set<string>();
      entries.forEach((warning, warningIndex) => {
        const value = choice(warning, `${warningsPath}[${warningIndex}]`, [
          "timing-estimated",
          "alignment-stale",
        ]);
        if (supported.has(value))
          fail(`${warningsPath}[${warningIndex}]`, "duplicate caption warning");
        supported.add(value);
      });
    });
  });
  return data as unknown as CaptionTrack;
}

function audioAutomation(
  value: unknown,
  path: string,
  duration = Infinity,
): AudioAutomation {
  const data = presentationObject(value, path, [
    "version",
    "role",
    "fadeIn",
    "fadeOut",
    "points",
    "ducking",
  ]);
  versionOne(data, path);
  choice(data.role, `${path}.role`, [
    "music",
    "narration",
    "ambience",
    "dialogue",
  ]);
  for (const key of ["fadeIn", "fadeOut"])
    optional(data, key, path, (v, p) => number(v, p, 0, duration));
  optional(data, "points", path, (v, p) => {
    const points = array(v, p);
    if (points.length > 1000) fail(p, "at most 1000 gain points are supported");
    let previous = -1;
    points.forEach((entry, index) => {
      const pointPath = `${p}[${index}]`;
      const point = presentationObject(entry, pointPath, ["time", "gain"]);
      const time = number(point.time, `${pointPath}.time`, 0, duration);
      if (time <= previous)
        fail(
          `${pointPath}.time`,
          "gain points must have strictly increasing times",
        );
      previous = time;
      number(point.gain, `${pointPath}.gain`, 0, 1);
    });
  });
  optional(data, "ducking", path, (v, p) => {
    const regions = array(v, p);
    if (regions.length > 1000)
      fail(p, "at most 1000 ducking regions are supported");
    regions.forEach((entry, index) => {
      const regionPath = `${p}[${index}]`;
      const region = presentationObject(entry, regionPath, [
        "start",
        "end",
        "gain",
        "attack",
        "release",
      ]);
      const start = number(region.start, `${regionPath}.start`, 0, duration);
      const end = number(region.end, `${regionPath}.end`, 0, duration);
      if (end <= start)
        fail(`${regionPath}.end`, "ducking end must follow its start");
      number(region.gain, `${regionPath}.gain`, 0, 1);
      const attack = number(
        region.attack,
        `${regionPath}.attack`,
        0,
        end - start,
      );
      const release = number(
        region.release,
        `${regionPath}.release`,
        0,
        end - start,
      );
      if (attack + release > end - start + 1e-9)
        fail(
          regionPath,
          "ducking attack and release must fit within the region",
        );
    });
  });
  return data as unknown as AudioAutomation;
}

export function validateAudioAutomation(
  value: unknown,
  duration?: number,
): AudioAutomation {
  if (duration !== undefined) positive(duration, "audioAutomation.duration");
  audioAutomation(value, "audioAutomation", duration);
  return copyJson(value, "audioAutomation") as AudioAutomation;
}

/** Persist timestamps with a timezone; a date-only or ambiguous local time is invalid. */
function timestamp(value: unknown, path: string): string {
  const result = string(value, path);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      result,
    );
  if (!match || !Number.isFinite(Date.parse(result)))
    fail(path, "expected an ISO 8601 timestamp with a timezone");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    Number(match[8] ?? 0) > 23 ||
    Number(match[9] ?? 0) > 59
  )
    fail(path, "timestamp contains an invalid calendar date or time");
  return result;
}

function directionText(value: unknown, path: string): void {
  const text = string(value, path);
  if ([...text].length > 8000)
    fail(path, "expected at most 8000 Unicode code points");
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (
      (point < 32 && ![9, 10, 13].includes(point)) ||
      (point >= 127 && point <= 159) ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      fail(
        path,
        "expected well-formed Unicode text without control characters",
      );
  }
}

function directionDigest(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value))
    fail(path, "expected a 64-character hexadecimal digest");
}

/** Compare validated snapshots by fields so JSON property order has no meaning. */
function sameDirectionSnapshot(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return false;
  const leftObject = left as ObjectValue;
  const rightObject = right as ObjectValue;
  const leftKeys = Object.keys(leftObject).filter(
    (key) => leftObject[key] !== undefined,
  );
  const rightKeys = Object.keys(rightObject).filter(
    (key) => rightObject[key] !== undefined,
  );
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightObject, key) &&
        sameDirectionSnapshot(leftObject[key], rightObject[key]),
    )
  );
}

function sceneDirectionReceipts(value: unknown, path: string): void {
  const receipts = array(value, path);
  if (receipts.length > MAX_SCENE_DIRECTION_RECEIPTS)
    fail(
      path,
      `at most ${MAX_SCENE_DIRECTION_RECEIPTS} scene direction receipts are supported`,
    );
  const requests = new Set<string>();
  receipts.forEach((entry, index) => {
    const receiptPath = `${path}[${index}]`;
    const receipt = presentationObject(entry, receiptPath, [
      "version",
      "planId",
      "requestId",
      "fingerprint",
      "compositionId",
      "storyId",
      "beatId",
      "baseRevision",
      "contextSignature",
      "acceptedAt",
      "acceptedRevision",
      "sourceText",
      "actions",
    ]);
    versionOne(receipt, receiptPath);
    for (const key of [
      "planId",
      "fingerprint",
      "baseRevision",
      "contextSignature",
      "acceptedRevision",
    ])
      directionDigest(receipt[key], `${receiptPath}.${key}`);
    receiptIdentifier(receipt.requestId, `${receiptPath}.requestId`);
    if (/[\u0080-\u009f]/u.test(String(receipt.requestId)))
      fail(
        `${receiptPath}.requestId`,
        "expected an ID without control characters",
      );
    for (const key of ["compositionId", "storyId", "beatId"])
      string(receipt[key], `${receiptPath}.${key}`);
    const requestId = String(receipt.requestId);
    if (requests.has(requestId))
      fail(`${receiptPath}.requestId`, "duplicate acceptance request receipt");
    requests.add(requestId);
    timestamp(receipt.acceptedAt, `${receiptPath}.acceptedAt`);
    directionText(receipt.sourceText, `${receiptPath}.sourceText`);
    const actionPath = `${receiptPath}.actions`;
    const actions = array(receipt.actions, actionPath);
    if (actions.length < 1 || actions.length > 100)
      fail(actionPath, "expected between 1 and 100 scene direction actions");
    ids(actions, actionPath);
    actions.forEach((entry, index) => {
      const itemPath = `${actionPath}[${index}]`;
      const action = presentationObject(entry, itemPath, [
        "id",
        "clipId",
        "kind",
        "reason",
        "evidence",
        "before",
        "after",
        "command",
      ]);
      const clipId = string(action.clipId, `${itemPath}.clipId`);
      const kind = choice(action.kind, `${itemPath}.kind`, [
        "layout",
        "motion",
      ]);
      const reason = choice(
        action.reason,
        `${itemPath}.reason`,
        kind === "layout" ? ["contain", "hero"] : ["hold", "push-in", "pan"],
      );
      directionText(action.evidence, `${itemPath}.evidence`);
      const check = kind === "layout" ? photoLayout : photoMotion;
      if (action.before !== null) check(action.before, `${itemPath}.before`);
      const after = check(action.after, `${itemPath}.after`);
      if (after.preset !== reason)
        fail(`${itemPath}.reason`, "reason must match the accepted preset");
      const commandPath = `${itemPath}.command`;
      const command = presentationObject(action.command, commandPath, [
        "type",
        "clipId",
        kind,
      ]);
      choice(command.type, `${commandPath}.type`, ["presentation"]);
      if (string(command.clipId, `${commandPath}.clipId`) !== clipId)
        fail(`${commandPath}.clipId`, "command must target the action clip");
      check(command[kind], `${commandPath}.${kind}`);
      if (!sameDirectionSnapshot(action.after, command[kind]))
        fail(
          `${commandPath}.${kind}`,
          "command must match the accepted snapshot",
        );
    });
  });
}

function strings(value: unknown, path: string, unique = false): string[] {
  const values = array(value, path).map((item, i) =>
    string(item, `${path}[${i}]`),
  );
  if (unique && new Set(values).size !== values.length)
    fail(path, "IDs must be unique");
  return values;
}

function ids(values: unknown[], path: string): Set<string> {
  const found = new Set<string>();
  values.forEach((item, i) => {
    const id = string(object(item, `${path}[${i}]`).id, `${path}[${i}].id`);
    if (found.has(id)) fail(`${path}[${i}].id`, `duplicate ID ${id}`);
    found.add(id);
  });
  return found;
}

function checkAssetIds(
  values: string[],
  path: string,
  known?: ReadonlySet<string>,
): void {
  if (!known) return;
  values.forEach((id, i) => {
    if (!known.has(id)) fail(`${path}[${i}]`, `unknown asset ID ${id}`);
  });
}

/** JSON-compatible copy avoids returning a mutable alias or accepting unserializable metadata. */
function copyJson(
  value: unknown,
  path: string,
  ancestors = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return number(value, path);
  if (typeof value !== "object") fail(path, "expected JSON-compatible data");
  if (ancestors.has(value)) fail(path, "cyclic values cannot be persisted");
  ancestors.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = array(value, path).map((entry, i) =>
      copyJson(entry, `${path}[${i}]`, ancestors),
    );
  } else {
    const record = object(value, path);
    result = Object.fromEntries(
      Object.entries(record)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [
          key,
          copyJson(entry, `${path}.${key}`, ancestors),
        ]),
    );
  }
  ancestors.delete(value);
  return result;
}

function geo(value: unknown, path: string): void {
  const data = object(value, path);
  number(data.latitude, `${path}.latitude`, -90, 90);
  number(data.longitude, `${path}.longitude`, -180, 180);
}

export function validateMediaAsset(value: unknown): MediaAsset {
  const path = "asset";
  const data = object(value, path);
  for (const key of ["id", "uri", "name"]) string(data[key], `${path}.${key}`);
  choice(data.mediaType, `${path}.mediaType`, [
    "image",
    "video",
    "audio",
    "360-video",
  ]);
  strings(data.tags, `${path}.tags`);
  const state = object(data.state, `${path}.state`);
  for (const key of ["favorite", "rejected", "locked"])
    optional(state, key, `${path}.state`, boolean);
  object(data.metadata, `${path}.metadata`);
  optional(data, "capturedAt", path, timestamp);
  optional(data, "capturedAtConfidence", path, (v, p) => number(v, p, 0, 1));
  optional(data, "rating", path, (v, p) => number(v, p, 0, 5));
  for (const key of ["duration", "frameRate"])
    optional(data, key, path, positive);
  for (const key of [
    "capturedAtSource",
    "timezone",
    "codec",
    "colorSpace",
    "contentHash",
    "perceptualHash",
    "thumbnailUri",
    "proxyUri",
  ])
    optional(data, key, path, string);
  optional(data, "hdr", path, boolean);
  optional(data, "gps", path, geo);
  optional(data, "source", path, (v, p) => {
    const source = object(v, p);
    for (const key of ["device", "manufacturer", "application"])
      optional(source, key, p, string);
  });
  optional(data, "dimensions", path, (v, p) => {
    const size = object(v, p);
    dimension(size.width, `${p}.width`);
    dimension(size.height, `${p}.height`);
  });
  return copyJson(value, path) as MediaAsset;
}

function story(
  value: unknown,
  path: string,
  knownAssets?: ReadonlySet<string>,
): Story {
  const data = object(value, path);
  optional(data, "presetSnapshot", path, (value) =>
    validatePresetSnapshot(value, "story"),
  );
  optional(data, "presetPlanSource", path, (value) =>
    validatePresetPlanSource(value),
  );
  string(data.id, `${path}.id`);
  string(data.title, `${path}.title`);
  optional(data, "template", path, string);
  for (const key of ["targetDuration", "maxDuration"])
    optional(data, key, path, positive);
  if (
    data.targetDuration !== undefined &&
    data.maxDuration !== undefined &&
    Number(data.targetDuration) > Number(data.maxDuration)
  )
    fail(`${path}.targetDuration`, "target duration exceeds maximum duration");
  const beats = array(data.beats, `${path}.beats`);
  const beatIds = ids(beats, `${path}.beats`);
  beats.forEach((entry, i) => {
    const beatPath = `${path}.beats[${i}]`;
    const beat = object(entry, beatPath);
    string(beat.title, `${beatPath}.title`);
    optional(beat, "intent", beatPath, string);
    optional(beat, "script", beatPath, (value, path) => {
      const script = object(value, path);
      for (const field of ["narration", "visualDirection"]) {
        const text = script[field];
        if (typeof text !== "string" || [...text].length > 8000)
          fail(
            `${path}.${field}`,
            "expected a string of at most 8000 characters",
          );
      }
    });
    optional(beat, "templateBeatKey", beatPath, string);
    for (const key of ["titleSource", "intentSource"])
      optional(beat, key, beatPath, (v, p) =>
        choice(v, p, ["template", "user"]),
      );
    if (
      (beat.titleSource === "template" || beat.intentSource === "template") &&
      beat.templateBeatKey === undefined
    )
      fail(
        `${beatPath}.templateBeatKey`,
        "template text requires a stable beat key",
      );
    optional(beat, "minDuration", beatPath, (v, p) => number(v, p, 0));
    for (const key of ["targetDuration", "maxDuration"])
      optional(beat, key, beatPath, positive);
    const minimum = Number(beat.minDuration ?? 0);
    const maximum = Number(beat.maxDuration ?? Infinity);
    if (minimum > maximum)
      fail(
        `${beatPath}.minDuration`,
        "minimum duration exceeds maximum duration",
      );
    if (
      beat.targetDuration !== undefined &&
      (Number(beat.targetDuration) < minimum ||
        Number(beat.targetDuration) > maximum)
    )
      fail(
        `${beatPath}.targetDuration`,
        "target duration must lie within the beat duration bounds",
      );
    for (const key of ["candidateAssetIds", "selectedAssetIds"])
      optional(beat, key, beatPath, (v, p) =>
        checkAssetIds(strings(v, p, true), p, knownAssets),
      );
    optional(beat, "constraints", beatPath, (v, p) => {
      array(v, p).forEach((constraintEntry, j) => {
        const constraintPath = `${p}[${j}]`;
        const constraint = object(constraintEntry, constraintPath);
        const type = choice(constraint.type, `${constraintPath}.type`, [
          "must-include",
          "must-exclude",
          "chronological",
          "asset-order",
        ]);
        if (type === "chronological")
          optional(constraint, "enabled", constraintPath, boolean);
        else
          checkAssetIds(
            strings(constraint.assetIds, `${constraintPath}.assetIds`, true),
            `${constraintPath}.assetIds`,
            knownAssets,
          );
      });
    });
  });
  optional(data, "graph", path, (v, p) => {
    try {
      validateStoryGraph(v, beatIds, knownAssets);
    } catch (err) {
      fail(p, err instanceof Error ? err.message : String(err));
    }
  });
  return data as unknown as Story;
}

export function validateStory(
  value: unknown,
  options: ProjectValidationOptions = {},
): Story {
  story(
    value,
    "story",
    options.assetIds ? new Set(options.assetIds) : undefined,
  );
  return copyJson(value, "story") as Story;
}

function composition(
  value: unknown,
  path: string,
  knownAssets?: ReadonlySet<string>,
  beatIds?: ReadonlySet<string>,
): Composition {
  const data = object(value, path);
  string(data.id, `${path}.id`);
  string(data.storyId, `${path}.storyId`);
  optional(data, "storyPresetSnapshot", path, (value) =>
    validatePresetSnapshot(value, "story"),
  );
  const duration = number(data.duration, `${path}.duration`, 0);
  const tracks = array(data.tracks, `${path}.tracks`);
  ids(tracks, `${path}.tracks`);
  const clipIds = new Set<string>();
  optional(data, "graphicScenes", path, (value) => {
    const scenes = validateGraphicScenes(value, duration);
    if (knownAssets)
      for (const id of graphicSceneAssetIds(scenes))
        if (!knownAssets.has(id))
          fail(`${path}.graphicScenes`, `unknown graphic image asset ${id}`);
  });
  optional(data, "graphicSceneTemplates", path, (value) => {
    const scenes = validateGraphicScenes(data.graphicScenes ?? [], duration);
    validateGraphicSceneTemplates(
      value,
      scenes,
      knownAssets ? [...knownAssets] : undefined,
    );
  });
  optional(data, "defaultLook", path, filmLook);
  optional(data, "beatLooks", path, (value, beatPath) => {
    const entries = array(value, beatPath);
    if (entries.length > 1000)
      fail(beatPath, "expected at most 1000 scene look overrides");
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const entryPath = `${beatPath}[${index}]`;
      const item = presentationObject(entry, entryPath, ["beatId", "look"]);
      receiptIdentifier(item.beatId, `${entryPath}.beatId`);
      const id = item.beatId as string;
      if (seen.has(id))
        fail(`${entryPath}.beatId`, `duplicate scene look for ${id}`);
      if (beatIds && !beatIds.has(id))
        fail(
          `${entryPath}.beatId`,
          `unknown beat ID ${id} for this composition's story`,
        );
      seen.add(id);
      filmLook(item.look, `${entryPath}.look`);
    });
  });
  optional(data, "captionTracks", path, (value, captionPath) => {
    const tracks = array(value, captionPath);
    if (tracks.length > 100)
      fail(captionPath, "expected at most 100 native caption tracks");
    const trackIds = new Set<string>();
    tracks.forEach((entry, index) => {
      const validated = captionTrack(
        entry,
        `${captionPath}[${index}]`,
        duration,
      );
      if (trackIds.has(validated.id))
        fail(
          `${captionPath}[${index}].id`,
          `duplicate caption track ID ${validated.id}`,
        );
      trackIds.add(validated.id);
    });
  });
  tracks.forEach((entry, i) => {
    const trackPath = `${path}.tracks[${i}]`;
    const track = object(entry, trackPath);
    choice(track.type, `${trackPath}.type`, [
      "video",
      "audio",
      "music",
      "titles",
      "overlay",
    ]);
    optional(track, "timing", trackPath, (v, p) => choice(v, p, ["overlay"]));
    array(track.clips, `${trackPath}.clips`).forEach((clipEntry, j) => {
      const clipPath = `${trackPath}.clips[${j}]`;
      const clip = object(clipEntry, clipPath);
      const id = string(clip.id, `${clipPath}.id`);
      if (clipIds.has(id)) fail(`${clipPath}.id`, `duplicate clip ID ${id}`);
      clipIds.add(id);
      const assetId = string(clip.assetId, `${clipPath}.assetId`);
      if (knownAssets && !knownAssets.has(assetId))
        fail(`${clipPath}.assetId`, `unknown asset ID ${assetId}`);
      optional(clip, "beatId", clipPath, (v, p) => {
        const beatId = string(v, p);
        if (beatIds && !beatIds.has(beatId))
          fail(p, `unknown beat ID ${beatId} for this composition's story`);
      });
      const start = number(clip.timelineStart, `${clipPath}.timelineStart`, 0);
      const length = positive(
        clip.timelineDuration,
        `${clipPath}.timelineDuration`,
      );
      if (start + length > duration + 1e-7)
        fail(
          `${clipPath}.timelineDuration`,
          "clip extends beyond the composition duration",
        );
      optional(clip, "sourceIn", clipPath, (v, p) => number(v, p, 0));
      optional(clip, "sourceOut", clipPath, positive);
      if (
        clip.sourceOut !== undefined &&
        Number(clip.sourceOut) <= Number(clip.sourceIn ?? 0)
      )
        fail(
          `${clipPath}.sourceOut`,
          "source out must be greater than source in",
        );
      optional(clip, "title", clipPath, string);
      optional(clip, "layout", clipPath, (v, p) => {
        const layout = photoLayout(v, p);
        const secondary = layout.secondary?.assetId;
        if (secondary && knownAssets && !knownAssets.has(secondary))
          fail(`${p}.secondary.assetId`, `unknown asset ID ${secondary}`);
      });
      optional(clip, "motion", clipPath, photoMotion);
      optional(clip, "titleStyle", clipPath, titleStyle);
      optional(clip, "titlePresetSnapshot", clipPath, (value) =>
        validatePresetSnapshot(value, "title"),
      );
      optional(clip, "audioAutomation", clipPath, (v, p) =>
        audioAutomation(v, p, length),
      );
      optional(clip, "look", clipPath, filmLook);
      if (
        clip.look !== undefined &&
        (track.type === "audio" ||
          track.type === "music" ||
          track.type === "titles")
      )
        fail(
          `${clipPath}.look`,
          "creative looks require a visual media track, not audio or titles",
        );
      optional(clip, "locked", clipPath, boolean);
      optional(clip, "transform", clipPath, (v, p) => {
        const transform = object(v, p);
        for (const key of ["scale", "speed"])
          optional(transform, key, p, positive);
        optional(transform, "volume", p, (v, p) => number(v, p, 0));
        for (const key of ["x", "y", "rotation"])
          optional(transform, key, p, number);
      });
      optional(clip, "transition", clipPath, (v, p) => {
        const transition = object(v, p);
        choice(transition.type, `${p}.type`, ["crossfade"]);
        if (positive(transition.duration, `${p}.duration`) > length)
          fail(`${p}.duration`, "transition duration exceeds clip duration");
      });
    });
  });
  return data as unknown as Composition;
}

export function validateComposition(
  value: unknown,
  options: ProjectValidationOptions = {},
): Composition {
  composition(
    value,
    "composition",
    options.assetIds ? new Set(options.assetIds) : undefined,
  );
  return copyJson(value, "composition") as Composition;
}

export function validateProject(
  value: unknown,
  options: ProjectValidationOptions = {},
): OpenFilmProject {
  const path = "project";
  const data = object(value, path);
  if (data.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    string(data.schemaVersion, `${path}.schemaVersion`);
    if (!/^\d+\.\d+\.\d+$/.test(String(data.schemaVersion)))
      fail(
        `${path}.schemaVersion`,
        "expected a semantic schema version such as 1.0.0",
      );
    fail(
      `${path}.schemaVersion`,
      `unsupported schema version ${String(data.schemaVersion)}; this application supports ${PROJECT_SCHEMA_VERSION}. Use migrateProject for a documented older version.`,
    );
  }
  for (const key of ["id", "title"]) string(data[key], `${path}.${key}`);
  optional(data, "projectContentLocale", path, (v, p) =>
    choice(v, p, PROJECT_CONTENT_LOCALES),
  );
  optional(data, "filmSettings", path, (v, p) => {
    const settings = object(v, p);
    string(settings.templateId, `${p}.templateId`);
    positive(settings.targetDuration, `${p}.targetDuration`);
    positive(settings.maxDuration, `${p}.maxDuration`);
    if (Number(settings.targetDuration) > Number(settings.maxDuration))
      fail(`${p}.targetDuration`, "target duration exceeds maximum duration");
  });
  timestamp(data.createdAt, `${path}.createdAt`);
  timestamp(data.updatedAt, `${path}.updatedAt`);
  if (Date.parse(String(data.updatedAt)) < Date.parse(String(data.createdAt)))
    fail(`${path}.updatedAt`, "updatedAt precedes createdAt");
  const libraries = array(data.mediaLibraries, `${path}.mediaLibraries`);
  ids(libraries, `${path}.mediaLibraries`);
  libraries.forEach((entry, i) => {
    const libraryPath = `${path}.mediaLibraries[${i}]`;
    const library = object(entry, libraryPath);
    string(library.name, `${libraryPath}.name`);
    string(library.uri, `${libraryPath}.uri`);
  });
  const settings = object(data.settings, `${path}.settings`);
  for (const key of ["width", "height"])
    dimension(settings[key], `${path}.settings.${key}`);
  positive(settings.frameRate, `${path}.settings.frameRate`);
  if (settings.timebase !== undefined) {
    try {
      resolveProjectTimebase(settings as unknown as ProjectSettings);
    } catch (error) {
      fail(
        `${path}.settings`,
        error instanceof Error ? error.message : "invalid timebase",
      );
    }
  }
  const knownAssets = options.assetIds ? new Set(options.assetIds) : undefined;
  optional(data, "sceneScriptReviewReceipts", path, (value, receiptPath) => {
    const receipts = array(value, receiptPath);
    if (receipts.length > 10000)
      fail(receiptPath, "at most 10000 script review receipts are supported");
    const seen = new Set<string>();
    const requests = new Set<string>();
    receipts.forEach((value, index) => {
      const itemPath = `${receiptPath}[${index}]`;
      const receipt = object(value, itemPath);
      for (const key of [
        "suggestionId",
        "requestId",
        "evidenceHash",
        "acceptedRevisionId",
      ])
        receiptIdentifier(receipt[key], `${itemPath}.${key}`);
      const id = String(receipt.suggestionId);
      if (seen.has(id))
        fail(`${itemPath}.suggestionId`, "duplicate suggestion receipt");
      seen.add(id);
      const requestId = String(receipt.requestId);
      if (requests.has(requestId))
        fail(`${itemPath}.requestId`, "duplicate acceptance request receipt");
      requests.add(requestId);
      timestamp(receipt.acceptedAt, `${itemPath}.acceptedAt`);
    });
  });
  optional(data, "sceneDirectionReceipts", path, sceneDirectionReceipts);
  optional(data, "presetApplicationReceipts", path, (value) =>
    validatePresetReceipts(value, String(data.id)),
  );
  const stories = array(data.stories, `${path}.stories`);
  const storyIds = ids(stories, `${path}.stories`);
  const storiesById = new Map<string, Story>();
  stories.forEach((entry, i) => {
    const validated = story(entry, `${path}.stories[${i}]`, knownAssets);
    storiesById.set(validated.id, validated);
  });
  const timelines = array(data.timelines, `${path}.timelines`);
  ids(timelines, `${path}.timelines`);
  timelines.forEach((entry, i) => {
    const timelinePath = `${path}.timelines[${i}]`;
    const timeline = object(entry, timelinePath);
    const storyId = string(timeline.storyId, `${timelinePath}.storyId`);
    if (!storyIds.has(storyId))
      fail(`${timelinePath}.storyId`, `unknown story ID ${storyId}`);
    const beatIds = new Set(
      storiesById.get(storyId)?.beats.map((beat) => beat.id),
    );
    composition(entry, timelinePath, knownAssets, beatIds);
  });
  projectPresetSnapshots(data as unknown as OpenFilmProject);
  return copyJson(value, path) as OpenFilmProject;
}

export function validateJob(value: unknown): Job {
  const path = "job";
  const data = object(value, path);
  for (const key of ["id", "type"]) string(data[key], `${path}.${key}`);
  choice(data.status, `${path}.status`, [
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]);
  optional(data, "progress", path, (v, p) => number(v, p, 0, 1));
  for (const key of ["storyId", "beatId"]) optional(data, key, path, string);
  optional(data, "scriptField", path, (value, fieldPath) =>
    choice(value, fieldPath, ["narration", "visualDirection"]),
  );
  for (const key of ["createdAt", "updatedAt"])
    optional(data, key, path, timestamp);
  optional(data, "errors", path, (v, p) => {
    array(v, p).forEach((entry, i) => {
      const error = object(entry, `${p}[${i}]`);
      for (const key of ["uri", "stage", "message"])
        string(error[key], `${p}[${i}].${key}`);
      for (const key of ["code", "detail"])
        optional(error, key, `${p}[${i}]`, string);
      optional(error, "params", `${p}[${i}]`, (value, paramsPath) => {
        const params = object(value, paramsPath);
        for (const [key, parameter] of Object.entries(params)) {
          if (typeof parameter === "number")
            number(parameter, `${paramsPath}.${key}`);
          else if (typeof parameter !== "string")
            fail(`${paramsPath}.${key}`, "expected a string or finite number");
        }
      });
    });
  });
  return copyJson(value, path) as Job;
}
