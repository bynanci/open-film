import { createHash } from "node:crypto";
import type {
  DeviceClockMappingV1,
  GeoPoint,
  MediaAsset,
  TravelContextV1,
  TravelTrackPointV1,
  TravelTrackV1,
} from "@openfilm/core";
import { validateTravelContext } from "@openfilm/core";
export { validateTravelContext } from "@openfilm/core";
export type { TravelContextV1 } from "@openfilm/core";

export const TRAVEL_V1_LIMITS = Object.freeze({
  gpxBytes: 5 * 1024 * 1024,
  tracks: 32,
  segments: 1_000,
  points: 50_000,
  mappings: 10_000,
  assignments: 50_000,
  matchToleranceMilliseconds: 5 * 60 * 1000,
  locationConflictMeters: 100,
  speedMaximumGapMilliseconds: 5 * 60 * 1000,
});

export interface TravelObservationV1 {
  type: "travel-observation";
  algorithmVersion: "travel-v1";
  assetId: string;
  classification: "matched" | "conflicting" | "unknown";
  reason?:
    | "missing-capture-time"
    | "missing-track-assignment"
    | "multiple-track-assignments"
    | "multiple-clock-mappings"
    | "no-point-within-tolerance"
    | "camera-location-conflict";
  originalCapturedAt?: string;
  adjustedCapturedAt?: string;
  clockMappingId?: string;
  timeZone?: string;
  trackId?: string;
  trackContentHash?: string;
  matchedPoint?: {
    segmentIndex: number;
    pointIndex: number;
    time?: string;
    latitude: number;
    longitude: number;
    distanceMeters?: number;
  };
  cameraLocation?: GeoPoint;
  speedMetersPerSecond?: number;
  manualReview: boolean;
}

const identifier = (value: unknown, label: string): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    hasControlCharacters(value)
  )
    throw new Error(`${label} is invalid.`);
  return value;
};

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 32 || codePoint === 127) return true;
  }
  return false;
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

/**
 * Parse only the GPX track-point subset. DTDs, external entities and oversized
 * payloads are rejected before any structured data is retained.
 */
export function parseGpxTrack(
  id: string,
  xml: string | Uint8Array,
): TravelTrackV1 {
  const trackId = identifier(id, "Track ID");
  const bytes =
    typeof xml === "string" ? Buffer.from(xml, "utf8") : Buffer.from(xml);
  if (!bytes.length || bytes.length > TRAVEL_V1_LIMITS.gpxBytes)
    throw new Error("GPX source exceeds the 5 MiB travel-v1 limit.");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    /<!\s*(?:DOCTYPE|ENTITY)|<\s*(?:xi:include|include)\b|\b(?:SYSTEM|PUBLIC)\s+["']/iu.test(
      source,
    )
  )
    throw new Error("GPX external declarations are not allowed.");
  if (
    !/<(?:[A-Za-z_][\w.-]*:)?gpx\b[^>]*>/iu.test(source) ||
    !/<\/(?:[A-Za-z_][\w.-]*:)?gpx\s*>/iu.test(source)
  )
    throw new Error("A complete GPX document is required.");

  const segments: TravelTrackV1["segments"] = [];
  let totalPoints = 0;
  const segmentPattern =
    /<(?:[A-Za-z_][\w.-]*:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?trkseg\s*>/giu;
  let segmentMatch: RegExpExecArray | null;
  while ((segmentMatch = segmentPattern.exec(source))) {
    if (segments.length >= TRAVEL_V1_LIMITS.segments)
      throw new Error("GPX segment count exceeds the travel-v1 limit.");
    const body = segmentMatch[1]!;
    const points: TravelTrackV1["segments"][number]["points"] = [];
    const pointPattern =
      /<(?:[A-Za-z_][\w.-]*:)?trkpt\b([^>]*?)(?:\s*\/\s*>|\s*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?trkpt\s*>)/giu;
    let pointMatch: RegExpExecArray | null;
    while ((pointMatch = pointPattern.exec(body))) {
      totalPoints++;
      if (totalPoints > TRAVEL_V1_LIMITS.points)
        throw new Error("GPX point count exceeds the travel-v1 limit.");
      const attributes = pointMatch[1]!;
      const latitude = attributeNumber(attributes, "lat", -90, 90);
      const longitude = attributeNumber(attributes, "lon", -180, 180);
      const content = pointMatch[2] ?? "";
      const timeRaw = content
        .match(
          /<(?:[A-Za-z_][\w.-]*:)?time\b[^>]*>([^<]*)<\/(?:[A-Za-z_][\w.-]*:)?time\s*>/iu,
        )?.[1]
        ?.trim();
      const elevationRaw = content
        .match(
          /<(?:[A-Za-z_][\w.-]*:)?ele\b[^>]*>([^<]*)<\/(?:[A-Za-z_][\w.-]*:)?ele\s*>/iu,
        )?.[1]
        ?.trim();
      const point: TravelTrackPointV1 = { latitude, longitude };
      if (timeRaw && validTime(timeRaw))
        point.time = new Date(timeRaw).toISOString();
      if (elevationRaw !== undefined && elevationRaw !== "") {
        const elevation = Number(elevationRaw);
        if (!Number.isFinite(elevation) || Math.abs(elevation) > 20_000)
          throw new Error("GPX elevation is outside the supported range.");
        point.elevationMeters = elevation;
      }
      points.push(point);
    }
    if (/<(?:[A-Za-z_][\w.-]*:)?trkpt\b/iu.test(body) && !points.length)
      throw new Error("GPX track point markup is malformed.");
    if (points.length) segments.push({ index: segments.length, points });
  }
  if (!segments.length)
    throw new Error("GPX contains no usable track segments.");
  return {
    id: trackId,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    segments,
  };
}

function attributeNumber(
  attributes: string,
  name: string,
  min: number,
  max: number,
): number {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "iu",
  ).exec(attributes);
  const raw = match?.[1] ?? match?.[2];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`GPX ${name} coordinate is invalid.`);
  return value;
}

function haversineMeters(left: GeoPoint, right: GeoPoint): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(left.latitude * radians) *
      Math.cos(right.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Deterministic timestamp-nearest matching; never interpolates across a gap or segment. */
export function buildTravelObservations(
  rawContext: TravelContextV1,
  assets: readonly Pick<MediaAsset, "id" | "capturedAt" | "gps">[],
): TravelObservationV1[] {
  const context = validateTravelContext(rawContext);
  const tracks = new Map(context.tracks.map((track) => [track.id, track]));
  return [...assets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((asset) => {
      const mappingMatches = context.clockMappings.filter(({ assetIds }) =>
        assetIds.includes(asset.id),
      );
      const assignmentMatches = context.assignments.filter(({ assetIds }) =>
        assetIds.includes(asset.id),
      );
      const base: TravelObservationV1 = {
        type: "travel-observation",
        algorithmVersion: "travel-v1",
        assetId: asset.id,
        classification: "unknown",
        manualReview: true,
        ...(asset.capturedAt ? { originalCapturedAt: asset.capturedAt } : {}),
        ...(asset.gps ? { cameraLocation: structuredClone(asset.gps) } : {}),
      };
      if (!asset.capturedAt || !Number.isFinite(Date.parse(asset.capturedAt)))
        return { ...base, reason: "missing-capture-time" };
      if (mappingMatches.length > 1)
        return {
          ...base,
          classification: "conflicting",
          reason: "multiple-clock-mappings",
        };
      if (!assignmentMatches.length)
        return { ...base, reason: "missing-track-assignment" };
      if (assignmentMatches.length > 1)
        return {
          ...base,
          classification: "conflicting",
          reason: "multiple-track-assignments",
        };
      const assignment = assignmentMatches[0]!;
      const track = tracks.get(assignment.trackId)!;
      const mapping: DeviceClockMappingV1 | undefined = mappingMatches[0];
      const adjustedMilliseconds =
        Date.parse(asset.capturedAt) + (mapping?.offsetMilliseconds ?? 0);
      const adjustedCapturedAt = new Date(adjustedMilliseconds).toISOString();
      let closest:
        | {
            timeDelta: number;
            segmentIndex: number;
            pointIndex: number;
            point: TravelTrackPointV1;
          }
        | undefined;
      track.segments.forEach((segment, segmentIndex) =>
        segment.points.forEach((point, pointIndex) => {
          if (!point.time) return;
          const timeDelta = Math.abs(
            Date.parse(point.time) - adjustedMilliseconds,
          );
          if (!closest || timeDelta < closest.timeDelta)
            closest = { timeDelta, segmentIndex, pointIndex, point };
        }),
      );
      const applied = {
        ...base,
        trackId: track.id,
        trackContentHash: track.contentHash,
        adjustedCapturedAt,
        ...(mapping
          ? {
              clockMappingId: mapping.id,
              ...(mapping.timeZone ? { timeZone: mapping.timeZone } : {}),
            }
          : {}),
      };
      if (
        !closest ||
        closest.timeDelta > TRAVEL_V1_LIMITS.matchToleranceMilliseconds
      )
        return { ...applied, reason: "no-point-within-tolerance" };
      const point = closest.point;
      const distanceMeters = asset.gps
        ? haversineMeters(asset.gps, point)
        : undefined;
      const matchedPoint = {
        segmentIndex: closest.segmentIndex,
        pointIndex: closest.pointIndex,
        ...(point.time ? { time: point.time } : {}),
        latitude: point.latitude,
        longitude: point.longitude,
        ...(distanceMeters === undefined ? {} : { distanceMeters }),
      };
      const segment = track.segments[closest.segmentIndex]!;
      const neighbor =
        closest.pointIndex > 0
          ? segment.points[closest.pointIndex - 1]
          : undefined;
      let speedMetersPerSecond: number | undefined;
      if (neighbor?.time && point.time) {
        const elapsed = Date.parse(point.time) - Date.parse(neighbor.time);
        if (
          elapsed > 0 &&
          elapsed <= TRAVEL_V1_LIMITS.speedMaximumGapMilliseconds
        )
          speedMetersPerSecond =
            haversineMeters(neighbor, point) / (elapsed / 1000);
      }
      if (
        distanceMeters !== undefined &&
        distanceMeters > TRAVEL_V1_LIMITS.locationConflictMeters
      )
        return {
          ...applied,
          classification: "conflicting",
          reason: "camera-location-conflict",
          matchedPoint,
          ...(speedMetersPerSecond === undefined
            ? {}
            : { speedMetersPerSecond }),
        };
      return {
        ...applied,
        classification: "matched",
        matchedPoint,
        ...(speedMetersPerSecond === undefined ? {} : { speedMetersPerSecond }),
        manualReview: false,
      };
    });
}
