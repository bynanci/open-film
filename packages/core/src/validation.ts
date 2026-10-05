import {
  PROJECT_SCHEMA_VERSION,
  type Composition,
  type Job,
  type MediaAsset,
  type OpenFilmProject,
  type Story,
} from "./models.js";

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
  ids(beats, `${path}.beats`);
  beats.forEach((entry, i) => {
    const beatPath = `${path}.beats[${i}]`;
    const beat = object(entry, beatPath);
    string(beat.title, `${beatPath}.title`);
    optional(beat, "intent", beatPath, string);
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
  const duration = number(data.duration, `${path}.duration`, 0);
  const tracks = array(data.tracks, `${path}.tracks`);
  ids(tracks, `${path}.tracks`);
  const clipIds = new Set<string>();
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
  const knownAssets = options.assetIds ? new Set(options.assetIds) : undefined;
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
  for (const key of ["createdAt", "updatedAt"])
    optional(data, key, path, timestamp);
  optional(data, "errors", path, (v, p) => {
    array(v, p).forEach((entry, i) => {
      const error = object(entry, `${p}[${i}]`);
      for (const key of ["uri", "stage", "message"])
        string(error[key], `${p}[${i}].${key}`);
    });
  });
  return copyJson(value, path) as Job;
}
