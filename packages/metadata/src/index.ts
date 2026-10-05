export interface TimestampResolution {
  timestamp?: string;
  source: string;
  confidence: number;
  /** The original metadata value is retained for audit and later correction. */
  originalValue?: string;
  timezone?: string;
  /** Unzoned camera dates are interpreted as wall-clock UTC, not known UTC. */
  timezoneUncertain?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function first(records: Record<string, unknown>[], keys: string[]): unknown {
  for (const input of records) {
    for (const key of keys) if (input[key] !== undefined) return input[key];
  }
  return undefined;
}

function parse(
  value: unknown,
  offset: unknown,
): Omit<TimestampResolution, "source" | "confidence"> | undefined {
  if (typeof value !== "string") return undefined;
  const originalValue = value;
  const normalized = value
    .trim()
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
    .replace(" ", "T");
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      normalized,
    );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, fraction, explicitZone] =
    match;
  const wall = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ?? ""}`;
  const wallDate = new Date(`${wall}Z`);
  if (
    !Number.isFinite(wallDate.valueOf()) ||
    wallDate.getUTCFullYear() !== Number(year) ||
    wallDate.getUTCMonth() + 1 !== Number(month) ||
    wallDate.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    return undefined;
  const suppliedOffset =
    typeof offset === "string" && /^(Z|[+-]\d{2}:?\d{2})$/i.test(offset.trim())
      ? offset.trim()
      : undefined;
  const zone = explicitZone ?? suppliedOffset;
  if (zone && zone !== "Z" && zone !== "z") {
    const numbers = zone.replace(":", "").slice(1);
    if (
      Number(numbers.slice(0, 2)) > 14 ||
      Number(numbers.slice(2)) > 59 ||
      (Number(numbers.slice(0, 2)) === 14 && Number(numbers.slice(2)) !== 0)
    )
      return undefined;
  }
  const timestamp = new Date(`${wall}${zone ?? "Z"}`);
  if (!Number.isFinite(timestamp.valueOf())) return undefined;
  return {
    timestamp: timestamp.toISOString(),
    originalValue,
    timezone: zone ?? (typeof offset === "string" ? offset : undefined),
    timezoneUncertain: !zone,
  };
}

/** Resolve by provenance, never by which timestamp happens to be earliest. */
export function resolveTimestamp(
  input: Record<string, unknown>,
  fallbackMtime?: string,
): TimestampResolution {
  const exif = record(input.exif ?? input.EXIF);
  const quicktime = record(input.quicktime ?? input.QuickTime);
  const camera = record(input.camera);
  const sidecar = record(input.sidecar);
  const candidates = [
    {
      value: first(
        [exif, input],
        ["DateTimeOriginal", "EXIF:DateTimeOriginal", "exif.DateTimeOriginal"],
      ),
      source: "exif:DateTimeOriginal",
      confidence: 0.98,
      offset: first(
        [exif, input],
        ["OffsetTimeOriginal", "EXIF:OffsetTimeOriginal", "timezone"],
      ),
    },
    {
      value: first(
        [quicktime, input],
        [
          "creation_time",
          "QuickTime:CreateDate",
          "CreateDate",
          "quicktime.creation_time",
        ],
      ),
      source: "quicktime:creation_time",
      confidence: 0.92,
      offset: first([quicktime, input], ["timezone", "offset"]),
    },
    {
      value: first(
        [camera, input],
        ["capturedAt", "CaptureDate", "cameraTimestamp", "camera.capturedAt"],
      ),
      source: "camera",
      confidence: 0.85,
      offset: first([camera, input], ["timezone", "offset"]),
    },
    {
      value: first(
        [sidecar, input],
        ["capturedAt", "timestamp", "sidecarTimestamp", "sidecar.capturedAt"],
      ),
      source: "sidecar",
      confidence: 0.75,
      offset: first([sidecar, input], ["timezone", "offset"]),
    },
    {
      value: fallbackMtime ?? input.mtime,
      source: "filesystem:mtime",
      confidence: 0.25,
      offset: undefined,
    },
  ];
  for (const candidate of candidates) {
    const resolved = parse(candidate.value, candidate.offset);
    if (resolved)
      return {
        ...resolved,
        source: candidate.source,
        confidence:
          candidate.confidence - (resolved.timezoneUncertain ? 0.15 : 0),
      };
  }
  return { source: "unknown", confidence: 0 };
}
