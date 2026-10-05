import { describe, expect, it } from "vitest";
import { resolveTimestamp } from "../src/index.js";

describe("capture timestamp resolution", () => {
  it("uses EXIF precedence and its offset while retaining provenance", () => {
    const resolved = resolveTimestamp({
      DateTimeOriginal: "2020:06:02 13:40:05",
      OffsetTimeOriginal: "+08:00",
      creation_time: "2021-01-01T00:00:00Z",
    });
    expect(resolved).toMatchObject({
      timestamp: "2020-06-02T05:40:05.000Z",
      source: "exif:DateTimeOriginal",
      confidence: 0.98,
      timezone: "+08:00",
      timezoneUncertain: false,
      originalValue: "2020:06:02 13:40:05",
    });
  });
  it("reports unzoned metadata as uncertain, independently of machine timezone", () => {
    expect(
      resolveTimestamp({ DateTimeOriginal: "2020:06:02 13:40:05" }),
    ).toMatchObject({
      timestamp: "2020-06-02T13:40:05.000Z",
      timezoneUncertain: true,
      confidence: 0.83,
    });
  });
  it("skips invalid calendar dates and picks the next valid source", () => {
    expect(
      resolveTimestamp({
        DateTimeOriginal: "2021:02:29 12:00:00",
        quicktime: { creation_time: "2020-01-01T00:00:00-05:00" },
      }),
    ).toMatchObject({
      timestamp: "2020-01-01T05:00:00.000Z",
      source: "quicktime:creation_time",
    });
  });
  it("does not guess timestamps from arbitrary text", () => {
    expect(
      resolveTimestamp(
        { DateTimeOriginal: "yesterday" },
        "2024-01-01T00:00:00Z",
      ),
    ).toMatchObject({ source: "filesystem:mtime", confidence: 0.25 });
    expect(resolveTimestamp({})).toEqual({ source: "unknown", confidence: 0 });
  });
  it("resolves nested camera and sidecar values without overriding stronger sources", () => {
    expect(
      resolveTimestamp({
        camera: { capturedAt: "2020-01-01T12:00:00", offset: "+03:00" },
        sidecar: { capturedAt: "2022-01-01T00:00:00Z" },
      }).timestamp,
    ).toBe("2020-01-01T09:00:00.000Z");
    expect(
      resolveTimestamp({
        DateTimeOriginal: "2020-01-01T12:00:00+99:00",
        sidecar: { timestamp: "2020-01-01T00:00:00Z" },
      }).source,
    ).toBe("sidecar");
  });
});
