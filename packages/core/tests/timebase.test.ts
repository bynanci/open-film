import { describe, expect, it } from "vitest";
import {
  formatSequenceTimecode,
  nominalFrameRate,
  parseSequenceTimecode,
  projectFrameRate,
  projectSettingsWithTimebase,
  resolveProjectTimebase,
  sequenceFrameAt,
  sequenceTimeAt,
  timebaseKey,
  timebaseRate,
  type ProjectSettings,
  type ProjectTimebaseV1,
} from "../src/index.js";

const ndf: ProjectTimebaseV1 = {
  version: 1,
  rateNumerator: 30,
  rateDenominator: 1,
  dropFrame: false,
};
const df: ProjectTimebaseV1 = {
  ...ndf,
  rateNumerator: 30000,
  rateDenominator: 1001,
  dropFrame: true,
};
const df60: ProjectTimebaseV1 = { ...df, rateNumerator: 60000 };
const settings = (frameRate: number): ProjectSettings => ({
  width: 1920,
  height: 1080,
  frameRate,
});

describe("project timebase", () => {
  it("derives legacy rates without mutating settings", () => {
    for (const [rate, numerator, denominator] of [
      [30, 30, 1],
      [23.976, 24000, 1001],
      [29.97, 30000, 1001],
      [59.94, 60000, 1001],
      [24000 / 1001, 24000, 1001],
      [30000 / 1001, 30000, 1001],
      [60000 / 1001, 60000, 1001],
      [25.125, 201, 8],
      [12.345678, 6172839, 500000],
    ]) {
      const original = Object.freeze(settings(rate!));
      const resolved = resolveProjectTimebase(original);
      expect(resolved).toEqual({
        version: 1,
        rateNumerator: numerator,
        rateDenominator: denominator,
        dropFrame: false,
      });
      expect(projectFrameRate(original)).toBe(numerator! / denominator!);
      expect(original).not.toHaveProperty("timebase");
    }
    const third = resolveProjectTimebase(settings(1 / 3));
    expect(third.rateDenominator).toBeLessThanOrEqual(1_000_000);
    expect(timebaseRate(third)).toBeCloseTo(1 / 3, 6);
    expect(nominalFrameRate(df)).toBe(30);
    expect(nominalFrameRate(df60)).toBe(60);
    expect(timebaseKey(df)).not.toBe(timebaseKey({ ...df, dropFrame: false }));
    expect(timebaseKey(df)).not.toBe(timebaseKey(df60));
    expect(timebaseKey(df)).toBe(timebaseKey({ ...df }));
  });

  it.each([
    [1.00000125, 800001, 800000],
    [0.00000125, 1, 800000],
  ])(
    "preserves the exact reduced legacy ratio for %s",
    (rate, numerator, denominator) => {
      expect(resolveProjectTimebase(settings(rate))).toEqual({
        version: 1,
        rateNumerator: numerator,
        rateDenominator: denominator,
        dropFrame: false,
      });
    },
  );

  it("roundtrips 29.97 and 59.94 drop-frame boundaries", () => {
    const cases: [ProjectTimebaseV1, number, string][] = [
      [df, 0, "00:00:00;00"],
      [df, 1799, "00:00:59;29"],
      [df, 1800, "00:01:00;02"],
      [df, 17981, "00:09:59;29"],
      [df, 17982, "00:10:00;00"],
      [df, 107892, "01:00:00;00"],
      [df60, 3599, "00:00:59;59"],
      [df60, 3600, "00:01:00;04"],
      [df60, 35964, "00:10:00;00"],
      [ndf, 1800, "00:01:00:00"],
    ];
    for (const [timebase, frame, label] of cases) {
      expect(formatSequenceTimecode(frame, timebase)).toBe(label);
      expect(parseSequenceTimecode(label, timebase)).toBe(frame);
    }
    for (const timebase of [df, df60, ndf]) {
      for (let frame = 0; frame < 40000; frame += 1) {
        expect(
          parseSequenceTimecode(
            formatSequenceTimecode(frame, timebase),
            timebase,
          ),
        ).toBe(frame);
      }
    }
  });

  it("rejects nonexistent drop-frame labels and separators", () => {
    for (const value of [
      "00:01:00;00",
      "00:01:00;01",
      "00:11:00;00",
      "00:01:00:02",
      "0:01:00;02",
      "00:60:00;00",
      "00:00:60;00",
      "00:00:00;30",
      " 00:00:00;00",
      "00:00:00;00\n",
      "-01:00:00;00",
      "00:00:00.00",
    ])
      expect(() => parseSequenceTimecode(value, df)).toThrow();
    for (const value of [
      "00:01:00;00",
      "00:01:00;01",
      "00:01:00;02",
      "00:01:00;03",
    ])
      expect(() => parseSequenceTimecode(value, df60)).toThrow();
    expect(() => parseSequenceTimecode("00:00:00;00", ndf)).toThrow();
    expect(parseSequenceTimecode("00:10:00;00", df)).toBe(17982);
  });

  it("keeps integer frame conversion stable beyond one day", () => {
    for (const timebase of [ndf, df, df60, { ...df, dropFrame: false }]) {
      for (const frame of [
        0, 1, 1799, 1800, 17982, 2_589_408, 10_000_001, 100_000_003,
      ]) {
        const seconds = sequenceTimeAt(frame, timebase);
        expect(sequenceFrameAt(seconds, timebase)).toBe(frame);
        expect(sequenceFrameAt(seconds, timebase, "nearest")).toBe(frame);
        expect(
          parseSequenceTimecode(
            formatSequenceTimecode(frame, timebase),
            timebase,
          ),
        ).toBe(frame);
      }
    }
    expect(formatSequenceTimecode(2_700_000, ndf)).toBe("25:00:00:00");
    expect(formatSequenceTimecode(10_800_000, ndf)).toBe("100:00:00:00");
    expect(sequenceFrameAt(1.02, ndf, "floor")).toBe(30);
    expect(sequenceFrameAt(1.02, ndf, "nearest")).toBe(31);
    for (const frame of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => sequenceTimeAt(frame, df)).toThrow();
      expect(() => formatSequenceTimecode(frame, df)).toThrow();
    }
    for (const seconds of [-1, Infinity, NaN])
      expect(() => sequenceFrameAt(seconds, df)).toThrow();
  });

  it("rejects malformed or mismatched explicit timebases", () => {
    for (const timebase of [
      null,
      {},
      { ...df, version: 2 },
      { ...df, rateNumerator: 0 },
      { ...df, rateNumerator: 29.97 },
      { ...df, rateNumerator: Infinity },
      { ...df, rateDenominator: 0 },
      { ...df, rateDenominator: -1 },
      { ...df, rateDenominator: 1.5 },
      { ...df, dropFrame: "true" },
      { ...ndf, dropFrame: true },
      { ...df, rateNumerator: 24000 },
    ]) {
      expect(() =>
        resolveProjectTimebase({
          ...settings(30000 / 1001),
          timebase,
        } as ProjectSettings),
      ).toThrow();
    }
    expect(() =>
      resolveProjectTimebase({ ...settings(29.97), timebase: df }),
    ).toThrow("frameRate");
    expect(() =>
      resolveProjectTimebase({ ...settings(30), timebase: df }),
    ).toThrow("frameRate");
    expect(
      resolveProjectTimebase({
        ...settings((30000 / 1001) * (1 + 5e-10)),
        timebase: df,
      }),
    ).toEqual(df);
    for (const rate of [0, -1, Infinity, NaN])
      expect(() => resolveProjectTimebase(settings(rate))).toThrow();
  });

  it("updates the projected rate without aliasing either input", () => {
    const original = Object.freeze(settings(30));
    const timebase = Object.freeze({ ...df });
    const updated = projectSettingsWithTimebase(original, timebase);
    expect(updated).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 30000 / 1001,
      timebase: df,
    });
    expect(JSON.parse(JSON.stringify(updated))).toEqual(updated);
    updated.timebase!.dropFrame = false;
    expect(timebase.dropFrame).toBe(true);
    expect(original).not.toHaveProperty("timebase");
    const resolved = resolveProjectTimebase({
      ...settings(30000 / 1001),
      timebase,
    });
    resolved.dropFrame = false;
    expect(timebase.dropFrame).toBe(true);
  });

  it("derives bounded positive ratios for very small and large finite rates", () => {
    expect(resolveProjectTimebase(settings(1e20))).toEqual({
      version: 1,
      rateNumerator: 1e20,
      rateDenominator: 1,
      dropFrame: false,
    });
    for (const rate of [Number.MIN_VALUE, 1e-7, Number.MAX_VALUE]) {
      const resolved = resolveProjectTimebase(settings(rate));
      expect(resolved.rateNumerator).toBeGreaterThan(0);
      expect(Number.isFinite(resolved.rateNumerator)).toBe(true);
      expect(resolved.rateDenominator).toBeGreaterThan(0);
      expect(resolved.rateDenominator).toBeLessThanOrEqual(1_000_000);
    }
  });
});
