import { ProjectValidationError } from "./validation.js";

/** Analysis is source-bound and portable; times are seconds in the original media. */
export interface AnalysisProvenance {
  providerId: string;
  model?: string;
  /** Derived analysis format/algorithm revision used for cache compatibility. */
  version: string;
  /** Installed provider engine version, independent of the analysis format. */
  providerVersion?: string;
  sourceHash: string;
  createdAt: string;
}

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}

export interface TranscriptDocument {
  id: string;
  assetId: string;
  language?: string;
  provenance: AnalysisProvenance;
  segments: TranscriptSegment[];
}

/** Each peak is a normalized absolute amplitude in a uniform duration bin. */
export interface WaveformData {
  assetId: string;
  duration: number;
  /** Peak bins per second; independent of the decoded PCM sampling frequency. */
  sampleRate: number;
  peaks: number[];
  provenance: AnalysisProvenance;
}

export const TIMELINE_MARKER_TYPES = [
  "manual",
  "scene-cut",
  "speech",
  "word",
  "beat",
  "chapter",
] as const;

export interface TimelineMarker {
  id: string;
  assetId: string;
  time: number;
  type: (typeof TIMELINE_MARKER_TYPES)[number];
  label?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface SceneAnalysis {
  assetId: string;
  markers: TimelineMarker[];
  provenance: AnalysisProvenance;
}

export interface IntelligenceValidationOptions {
  /** Supplying source duration also rejects analysis beyond the source end. */
  duration?: number;
}

type JsonRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ProjectValidationError(path, message);
}

function record(value: unknown, path: string): JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length
  )
    fail(path, "expected a plain JSON object");
  return value as JsonRecord;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  for (let index = 0; index < value.length; index++)
    if (!Object.hasOwn(value, index))
      fail(`${path}[${index}]`, "sparse arrays cannot be persisted");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim())
    fail(path, "expected a non-empty string");
  return value;
}

function number(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Infinity,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    fail(path, `expected a finite number between ${minimum} and ${maximum}`);
  return value;
}

function sourceEnd(options: IntelligenceValidationOptions): number {
  return options.duration === undefined
    ? Infinity
    : number(options.duration, "source.duration");
}

function json(
  value: unknown,
  path: string,
  ancestors = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") return number(value, path, -Infinity);
  if (typeof value !== "object") fail(path, "expected JSON-compatible data");
  if (ancestors.has(value)) fail(path, "cyclic values cannot be persisted");
  ancestors.add(value);
  const result = Array.isArray(value)
    ? list(value, path).map((entry, index) =>
        json(entry, `${path}[${index}]`, ancestors),
      )
    : Object.fromEntries(
        Object.entries(record(value, path)).map(([key, entry]) => [
          key,
          json(entry, `${path}.${key}`, ancestors),
        ]),
      );
  ancestors.delete(value);
  return result;
}

function provenance(value: unknown, path: string): AnalysisProvenance {
  const data = record(value, path);
  const createdAt = text(data.createdAt, `${path}.createdAt`);
  const date =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      createdAt,
    );
  if (!date || !Number.isFinite(Date.parse(createdAt)))
    fail(`${path}.createdAt`, "expected an ISO timestamp with a timezone");
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (monthDays[month - 1] ?? 0) ||
    Number(date[4]) > 23 ||
    Number(date[5]) > 59 ||
    Number(date[6]) > 59 ||
    Number(date[7] ?? 0) > 23 ||
    Number(date[8] ?? 0) > 59
  )
    fail(`${path}.createdAt`, "timestamp contains an invalid date or time");
  return {
    providerId: text(data.providerId, `${path}.providerId`),
    version: text(data.version, `${path}.version`),
    sourceHash: text(data.sourceHash, `${path}.sourceHash`),
    createdAt,
    ...(data.model === undefined
      ? {}
      : { model: text(data.model, `${path}.model`) }),
    ...(data.providerVersion === undefined
      ? {}
      : {
          providerVersion: text(
            data.providerVersion,
            `${path}.providerVersion`,
          ),
        }),
  };
}

export function validateAnalysisProvenance(value: unknown): AnalysisProvenance {
  return provenance(value, "provenance");
}

export function validateTranscriptDocument(
  value: unknown,
  options: IntelligenceValidationOptions = {},
): TranscriptDocument {
  const path = "transcript";
  const data = record(value, path);
  const maximum = sourceEnd(options);
  const ids = new Set<string>();
  let previousStart = 0;
  const segments = list(data.segments, `${path}.segments`).map(
    (entry, index) => {
      const p = `${path}.segments[${index}]`;
      const segment = record(entry, p);
      const id = text(segment.id, `${p}.id`);
      if (ids.has(id)) fail(`${p}.id`, "segment IDs must be unique");
      ids.add(id);
      const start = number(segment.start, `${p}.start`, previousStart, maximum);
      const end = number(segment.end, `${p}.end`, start, maximum);
      previousStart = start;
      let wordStart = start;
      const words =
        segment.words === undefined
          ? undefined
          : list(segment.words, `${p}.words`).map((wordEntry, wordIndex) => {
              const w = `${p}.words[${wordIndex}]`;
              const word = record(wordEntry, w);
              const start = number(word.start, `${w}.start`, wordStart, end);
              const finish = number(word.end, `${w}.end`, start, end);
              wordStart = start;
              return {
                start,
                end: finish,
                text: text(word.text, `${w}.text`),
                ...(word.confidence === undefined
                  ? {}
                  : {
                      confidence: number(
                        word.confidence,
                        `${w}.confidence`,
                        0,
                        1,
                      ),
                    }),
              };
            });
      return {
        id,
        start,
        end,
        text: text(segment.text, `${p}.text`),
        ...(words === undefined ? {} : { words }),
      };
    },
  );
  return {
    id: text(data.id, `${path}.id`),
    assetId: text(data.assetId, `${path}.assetId`),
    ...(data.language === undefined
      ? {}
      : { language: text(data.language, `${path}.language`) }),
    provenance: provenance(data.provenance, `${path}.provenance`),
    segments,
  };
}

export function validateWaveformData(value: unknown): WaveformData {
  const path = "waveform";
  const data = record(value, path);
  const duration = number(data.duration, `${path}.duration`);
  const sampleRate = number(data.sampleRate, `${path}.sampleRate`);
  if (duration === 0 || sampleRate === 0)
    fail(path, "duration and sample rate must be greater than zero");
  const peaks = list(data.peaks, `${path}.peaks`).map((entry, index) =>
    number(entry, `${path}.peaks[${index}]`, 0, 1),
  );
  if (!peaks.length)
    fail(`${path}.peaks`, "expected at least one amplitude bin");
  return {
    assetId: text(data.assetId, `${path}.assetId`),
    duration,
    sampleRate,
    peaks,
    provenance: provenance(data.provenance, `${path}.provenance`),
  };
}

function marker(
  value: unknown,
  path: string,
  maximum: number,
  assetId?: string,
): TimelineMarker {
  const data = record(value, path);
  const source = text(data.assetId, `${path}.assetId`);
  if (assetId !== undefined && source !== assetId)
    fail(`${path}.assetId`, "marker must refer to the analyzed asset");
  const type = text(data.type, `${path}.type`);
  if (!TIMELINE_MARKER_TYPES.includes(type as TimelineMarker["type"]))
    fail(`${path}.type`, `expected one of ${TIMELINE_MARKER_TYPES.join(", ")}`);
  return {
    id: text(data.id, `${path}.id`),
    assetId: source,
    time: number(data.time, `${path}.time`, 0, maximum),
    type: type as TimelineMarker["type"],
    ...(data.label === undefined
      ? {}
      : { label: text(data.label, `${path}.label`) }),
    ...(data.confidence === undefined
      ? {}
      : { confidence: number(data.confidence, `${path}.confidence`, 0, 1) }),
    ...(data.metadata === undefined
      ? {}
      : {
          metadata: json(
            record(data.metadata, `${path}.metadata`),
            `${path}.metadata`,
          ) as JsonRecord,
        }),
  };
}

export function validateTimelineMarker(
  value: unknown,
  options: IntelligenceValidationOptions & { assetId?: string } = {},
): TimelineMarker {
  return marker(value, "marker", sourceEnd(options), options.assetId);
}

export function validateSceneAnalysis(
  value: unknown,
  options: IntelligenceValidationOptions = {},
): SceneAnalysis {
  const path = "scenes";
  const data = record(value, path);
  const assetId = text(data.assetId, `${path}.assetId`);
  const maximum = sourceEnd(options);
  const ids = new Set<string>();
  const markers = list(data.markers, `${path}.markers`).map((entry, index) => {
    const item = marker(entry, `${path}.markers[${index}]`, maximum, assetId);
    if (item.type !== "scene-cut")
      fail(
        `${path}.markers[${index}].type`,
        "scene analysis requires scene-cut markers",
      );
    if (ids.has(item.id))
      fail(`${path}.markers[${index}].id`, "marker IDs must be unique");
    ids.add(item.id);
    return item;
  });
  return {
    assetId,
    markers,
    provenance: provenance(data.provenance, `${path}.provenance`),
  };
}
