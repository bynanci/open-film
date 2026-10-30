import type { TravelContextV1 } from "./multi-source.js";

export const TRAVEL_CONTEXT_LIMITS = Object.freeze({
  tracks: 32,
  segments: 1_000,
  points: 50_000,
  mappings: 10_000,
  assignments: 50_000,
  maximumOffsetMilliseconds: 86_400_000,
});

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    hasControlCharacters(value)
  )
    throw new Error(`${label} is invalid.`);
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
}

function closedRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new Error(`${label} contains unsupported fields.`);
}

function validTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Closed, size-bounded semantic contract shared by run persistence and import. */
export function validateTravelContext(value: unknown): TravelContextV1 {
  closedRecord(
    value,
    ["version", "algorithmVersion", "tracks", "clockMappings", "assignments"],
    "Travel context",
  );
  const context = value as Partial<TravelContextV1>;
  if (
    context.version !== 1 ||
    context.algorithmVersion !== "travel-v1" ||
    !Array.isArray(context.tracks) ||
    context.tracks.length > TRAVEL_CONTEXT_LIMITS.tracks ||
    !Array.isArray(context.clockMappings) ||
    context.clockMappings.length > TRAVEL_CONTEXT_LIMITS.mappings ||
    !Array.isArray(context.assignments) ||
    context.assignments.length > TRAVEL_CONTEXT_LIMITS.assignments
  )
    throw new Error("Travel context version or collection bounds are invalid.");
  const trackIds = new Set<string>();
  let totalPoints = 0;
  for (const track of context.tracks) {
    closedRecord(track, ["id", "contentHash", "segments"], "Travel track");
    identifier(track.id, "Track ID");
    if (
      trackIds.has(track.id) ||
      !/^[a-f0-9]{64}$/u.test(track.contentHash) ||
      !Array.isArray(track.segments) ||
      track.segments.length > TRAVEL_CONTEXT_LIMITS.segments
    )
      throw new Error("Travel track identity is invalid.");
    trackIds.add(track.id);
    for (const [index, segment] of track.segments.entries()) {
      closedRecord(segment, ["index", "points"], "Travel segment");
      if (
        segment.index !== index ||
        !Array.isArray(segment.points) ||
        !segment.points.length
      )
        throw new Error("Travel track segments are invalid.");
      totalPoints += segment.points.length;
      if (totalPoints > TRAVEL_CONTEXT_LIMITS.points)
        throw new Error("Travel context has too many points.");
      for (const point of segment.points) {
        closedRecord(
          point,
          ["latitude", "longitude", "time", "elevationMeters"],
          "Travel point",
        );
        if (
          !Number.isFinite(point.latitude) ||
          point.latitude < -90 ||
          point.latitude > 90 ||
          !Number.isFinite(point.longitude) ||
          point.longitude < -180 ||
          point.longitude > 180 ||
          (point.time !== undefined &&
            (!validTime(point.time) ||
              new Date(point.time).toISOString() !== point.time)) ||
          (point.elevationMeters !== undefined &&
            (!Number.isFinite(point.elevationMeters) ||
              Math.abs(point.elevationMeters) > 20_000))
        )
          throw new Error("Travel track point is invalid.");
      }
    }
  }
  if (totalPoints > TRAVEL_CONTEXT_LIMITS.points)
    throw new Error("Travel context has too many points.");
  const mappingIds = new Set<string>();
  for (const mapping of context.clockMappings) {
    closedRecord(
      mapping,
      ["id", "assetIds", "offsetMilliseconds", "timeZone", "source"],
      "Clock mapping",
    );
    identifier(mapping.id, "Clock mapping ID");
    if (
      mappingIds.has(mapping.id) ||
      mapping.source !== "manual" ||
      !Array.isArray(mapping.assetIds) ||
      !mapping.assetIds.length ||
      mapping.assetIds.length > 10_000 ||
      !Number.isSafeInteger(mapping.offsetMilliseconds) ||
      Math.abs(mapping.offsetMilliseconds) >
        TRAVEL_CONTEXT_LIMITS.maximumOffsetMilliseconds ||
      (mapping.timeZone !== undefined &&
        (mapping.timeZone.length > 128 || !validTimezone(mapping.timeZone))) ||
      new Set(mapping.assetIds).size !== mapping.assetIds.length
    )
      throw new Error("Device clock mapping is invalid.");
    mappingIds.add(mapping.id);
    mapping.assetIds.forEach((assetId) =>
      identifier(assetId, "Clock-mapped asset ID"),
    );
  }
  for (const assignment of context.assignments) {
    closedRecord(assignment, ["trackId", "assetIds"], "Track assignment");
    identifier(assignment.trackId, "Assigned track ID");
    if (
      !trackIds.has(assignment.trackId) ||
      !Array.isArray(assignment.assetIds) ||
      !assignment.assetIds.length ||
      assignment.assetIds.length > 50_000 ||
      new Set(assignment.assetIds).size !== assignment.assetIds.length
    )
      throw new Error("GPX track assignment is invalid.");
    assignment.assetIds.forEach((assetId) =>
      identifier(assetId, "Assigned asset ID"),
    );
  }
  return structuredClone(context as TravelContextV1);
}
