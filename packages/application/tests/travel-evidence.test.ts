import { describe, expect, it } from "vitest";
import {
  buildTravelObservations,
  parseGpxTrack,
  validateTravelContext,
  type TravelContextV1,
} from "../src/travel-evidence.js";

const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="OpenFilm synthetic fixture">
 <trk><name>synthetic-loop</name><trkseg>
  <trkpt lat="25.0330" lon="121.5654"><ele>10</ele><time>2026-01-01T09:00:00Z</time></trkpt>
  <trkpt lat="25.0340" lon="121.5654"><ele>14</ele><time>2026-01-01T09:00:10Z</time></trkpt>
 </trkseg><trkseg>
  <trkpt lat="25.0500" lon="121.5654"><time>2026-01-01T10:00:00Z</time></trkpt>
 </trkseg></trk>
</gpx>`;

describe("travel-v1 evidence", () => {
  it.each([
    [
      "context",
      (value: TravelContextV1) =>
        Object.assign(value, { providerToken: "PRIVATE_SYNTHETIC_TOKEN" }),
    ],
    [
      "track",
      (value: TravelContextV1) =>
        Object.assign(value.tracks[0]!, {
          sourceUri: "/private/synthetic.gpx",
        }),
    ],
    [
      "segment",
      (value: TravelContextV1) =>
        Object.assign(value.tracks[0]!.segments[0]!, {
          cachePath: "/private/cache",
        }),
    ],
    [
      "point",
      (value: TravelContextV1) =>
        Object.assign(value.tracks[0]!.segments[0]!.points[0]!, {
          token: "PRIVATE_SYNTHETIC_TOKEN",
        }),
    ],
    [
      "mapping",
      (value: TravelContextV1) =>
        Object.assign(value.clockMappings[0]!, {
          devicePath: "/private/device",
        }),
    ],
    [
      "assignment",
      (value: TravelContextV1) =>
        Object.assign(value.assignments[0]!, {
          credential: "PRIVATE_SYNTHETIC_TOKEN",
        }),
    ],
  ] as const)(
    "rejects uncontracted private fields on the %s before run persistence",
    (_level, mutate) => {
      const track = parseGpxTrack("route-one", gpx);
      const context: TravelContextV1 = {
        version: 1,
        algorithmVersion: "travel-v1",
        tracks: [track],
        assignments: [{ trackId: track.id, assetIds: ["asset-one"] }],
        clockMappings: [
          {
            id: "clock",
            assetIds: ["asset-one"],
            offsetMilliseconds: 0,
            source: "manual",
          },
        ],
      };
      mutate(context);
      expect(() => validateTravelContext(context)).toThrow(
        /unsupported|unexpected/u,
      );
    },
  );

  it("parses and hashes GPX as bounded, explicit track segments", () => {
    const track = parseGpxTrack("route-one", gpx);
    expect(track.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(track.segments).toHaveLength(2);
    expect(track.segments[0]?.points).toHaveLength(2);
    expect(track.segments[1]?.points[0]?.latitude).toBe(25.05);
  });

  it("keeps original time, applies only an explicit clock mapping, and never interpolates a gap", () => {
    const track = parseGpxTrack("route-one", gpx);
    const context: TravelContextV1 = {
      version: 1,
      algorithmVersion: "travel-v1",
      tracks: [track],
      assignments: [
        {
          trackId: track.id,
          assetIds: ["asset-near", "asset-gap", "asset-unknown"],
        },
      ],
      clockMappings: [
        {
          id: "manual-clock-plus-one-hour",
          assetIds: ["asset-near", "asset-gap"],
          offsetMilliseconds: 3_600_000,
          timeZone: "Asia/Taipei",
          source: "manual",
        },
      ],
    };
    const observations = buildTravelObservations(context, [
      {
        id: "asset-near",
        capturedAt: "2026-01-01T08:00:10Z",
        gps: { latitude: 25.034, longitude: 121.5654 },
      },
      { id: "asset-gap", capturedAt: "2026-01-01T09:30:00Z" },
      { id: "asset-unknown" },
    ]);
    const near = observations.find(({ assetId }) => assetId === "asset-near");
    const gap = observations.find(({ assetId }) => assetId === "asset-gap");
    const unknown = observations.find(
      ({ assetId }) => assetId === "asset-unknown",
    );
    expect(near).toMatchObject({
      classification: "matched",
      originalCapturedAt: "2026-01-01T08:00:10Z",
      adjustedCapturedAt: "2026-01-01T09:00:10.000Z",
      clockMappingId: "manual-clock-plus-one-hour",
      speedMetersPerSecond: expect.any(Number),
    });
    expect(gap).toMatchObject({
      classification: "unknown",
      reason: "no-point-within-tolerance",
    });
    expect(unknown).toMatchObject({
      classification: "unknown",
      reason: "missing-capture-time",
    });
    expect(near?.matchedPoint?.segmentIndex).toBe(0);
    expect(gap?.matchedPoint).toBeUndefined();
  });

  it("preserves conflicting camera and GPX locations instead of silently choosing one", () => {
    const track = parseGpxTrack("route-one", gpx);
    const context: TravelContextV1 = {
      version: 1,
      algorithmVersion: "travel-v1",
      tracks: [track],
      assignments: [{ trackId: track.id, assetIds: ["asset-conflict"] }],
      clockMappings: [],
    };
    const [observation] = buildTravelObservations(context, [
      {
        id: "asset-conflict",
        capturedAt: "2026-01-01T09:00:00Z",
        gps: { latitude: 35.6762, longitude: 139.6503 },
      },
    ]);
    expect(observation).toMatchObject({
      classification: "conflicting",
      reason: "camera-location-conflict",
      cameraLocation: { latitude: 35.6762, longitude: 139.6503 },
    });
    expect(observation?.matchedPoint).toBeDefined();
  });

  it("rejects DTDs, unsafe bounds, ambiguous mappings and malformed timezones", () => {
    expect(() =>
      parseGpxTrack(
        "route",
        `<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]>${gpx}`,
      ),
    ).toThrow();
    expect(() => parseGpxTrack("route", gpx.repeat(200_000))).toThrow();
    const track = parseGpxTrack("route-one", gpx);
    expect(() =>
      validateTravelContext({
        version: 1,
        algorithmVersion: "travel-v1",
        tracks: [track],
        assignments: [{ trackId: track.id, assetIds: ["asset-one"] }],
        clockMappings: [
          {
            id: "clock",
            assetIds: ["asset-one"],
            offsetMilliseconds: 0,
            timeZone: "Nope/Nowhere",
            source: "manual",
          },
        ],
      }),
    ).toThrow();
    const ambiguous = buildTravelObservations(
      {
        version: 1,
        algorithmVersion: "travel-v1",
        tracks: [track],
        assignments: [{ trackId: track.id, assetIds: ["asset-one"] }],
        clockMappings: [
          {
            id: "clock-a",
            assetIds: ["asset-one"],
            offsetMilliseconds: 0,
            source: "manual",
          },
          {
            id: "clock-b",
            assetIds: ["asset-one"],
            offsetMilliseconds: 1,
            source: "manual",
          },
        ],
      },
      [{ id: "asset-one", capturedAt: "2026-01-01T09:00:00Z" }],
    );
    expect(ambiguous[0]).toMatchObject({
      classification: "conflicting",
      reason: "multiple-clock-mappings",
    });
    expect(() =>
      validateTravelContext({
        version: 1,
        algorithmVersion: "travel-v1",
        tracks: [track],
        assignments: [],
        clockMappings: [
          {
            id: "clock-a",
            assetIds: ["asset-one"],
            offsetMilliseconds: 0,
            source: "manual",
          },
          {
            id: "clock-b",
            assetIds: ["asset-one"],
            offsetMilliseconds: 1,
            source: "manual",
          },
        ],
      }),
    ).not.toThrow();
  });
});
