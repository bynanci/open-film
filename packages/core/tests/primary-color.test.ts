// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import type { Clip, Composition } from "../src/models.js";

const neutral = {
  version: 1 as const,
  temperature: 0,
  exposureEv: 0,
  contrast: 1,
};
const clip: Clip = {
  id: "c",
  assetId: "a",
  beatId: "b",
  timelineStart: 0,
  timelineDuration: 1,
};
const composition: Composition = {
  id: "f",
  storyId: "s",
  duration: 1,
  tracks: [{ id: "v", type: "video", clips: [clip] }],
};

describe("primary color v1", () => {
  it("treats parameters that round to identity coefficients as an inactive operation", () => {
    expect(
      core.isPrimaryColorActive({
        ...neutral,
        exposureEv: 1e-15,
        temperature: 1e-15,
      }),
    ).toBe(false);
  });
  it("exports bounded identity and preserves legacy fields on validation", () => {
    expect(core.PRIMARY_COLOR_VERSION).toBe(1);
    expect(core.PRIMARY_COLOR_DOMAIN).toBe("encoded-sdr-rgb");
    expect(core.validateComposition(composition)).toEqual(composition);
    expect(core.isPrimaryColorActive()).toBe(false);
    expect(core.isPrimaryColorActive(neutral)).toBe(false);
    expect(core.primaryColorCoefficients().matrix).toEqual([
      1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    ]);
  });
  it("validates strict detached recipes and rejects unknown versions even at identity", () => {
    const parsed = core.validatePrimaryColorCorrection(neutral);
    expect(parsed).toEqual(neutral);
    expect(parsed).not.toBe(neutral);
    for (const bad of [
      null,
      [],
      { ...neutral, version: 2 },
      { ...neutral, temperature: -1.01 },
      { ...neutral, exposureEv: 2.01 },
      { ...neutral, contrast: 0.49 },
      { ...neutral, contrast: 1.51 },
      { ...neutral, contrast: "1" },
      { ...neutral, temperature: NaN },
      { ...neutral, exposureEv: Infinity },
      { ...neutral, script: "x" },
      { version: 1 },
    ]) {
      expect(() => core.validatePrimaryColorCorrection(bad)).toThrow();
    }
  });
  it("pins gain extrema, offsets and 12-decimal representative coefficients", () => {
    expect(
      core.primaryColorCoefficients({
        ...neutral,
        temperature: 1,
        exposureEv: 2,
        contrast: 1.5,
      }).slopes,
    ).toEqual([6.6, 6, 5.4]);
    expect(
      core.primaryColorCoefficients({
        ...neutral,
        temperature: 1,
        exposureEv: -2,
        contrast: 0.5,
      }).slopes,
    ).toEqual([0.1375, 0.125, 0.1125]);
    const c = core.primaryColorCoefficients({
      ...neutral,
      temperature: 0.2,
      exposureEv: 0.5,
      contrast: 1.2,
    });
    expect(c.slopes).toEqual([1.730997400345, 1.697056274848, 1.663115149351]);
    expect(c.offset).toBe(-0.1);
    expect(c.matrix).toEqual([
      c.slopes[0],
      0,
      0,
      0,
      -0.1,
      0,
      c.slopes[1],
      0,
      0,
      -0.1,
      0,
      0,
      c.slopes[2],
      0,
      -0.1,
      0,
      0,
      0,
      1,
      0,
    ]);
  });
  it("clamps once, keeps alpha and uses constant RGB lift", () => {
    const c = core.primaryColorCoefficients({
      ...neutral,
      exposureEv: 1,
      contrast: 0.5,
    });
    for (const a of [0, 128, 255])
      expect(core.applyPrimaryColorPixel([64, 128, 255, a], c)).toEqual([
        128,
        192,
        255,
        a,
      ]);
    expect(
      core.applyPrimaryColorPixel(
        [128, 128, 128, 255],
        core.primaryColorCoefficients({ ...neutral, contrast: 1.5 }),
      ),
    ).toEqual([128, 128, 128, 255]);
  });
  it("resolves film then beat then clip, with explicit identity stopping inheritance", () => {
    const film = { ...neutral, exposureEv: 0.2 };
    const beat = { ...neutral, temperature: 0.3 };
    const comp = {
      ...composition,
      defaultPrimaryColor: film,
      beatPrimaryColors: [{ beatId: "b", correction: beat }],
    };
    expect(core.resolvePrimaryColor(composition, clip).source).toBe("original");
    expect(
      core.resolvePrimaryColor({ ...comp, beatPrimaryColors: [] }, clip),
    ).toEqual({ correction: film, source: "film" });
    expect(core.resolvePrimaryColor(comp, clip)).toEqual({
      correction: beat,
      source: "beat",
    });
    expect(
      core.resolvePrimaryColor(comp, { ...clip, primaryColor: neutral }),
    ).toEqual({ correction: neutral, source: "clip" });
  });
  it("rejects invalid hidden and duplicate scene recipes on project validation", () => {
    expect(() =>
      core.validateComposition({
        ...composition,
        defaultPrimaryColor: { ...neutral, version: 99 },
        tracks: [
          {
            ...composition.tracks[0]!,
            clips: [{ ...clip, primaryColor: neutral }],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      core.validateComposition({
        ...composition,
        beatPrimaryColors: [
          { beatId: "b", correction: neutral },
          { beatId: "b", correction: neutral },
        ],
      }),
    ).toThrow();
    expect(() =>
      core.validateComposition({
        ...composition,
        tracks: [
          {
            ...composition.tracks[0]!,
            clips: [{ ...clip, primaryColor: { ...neutral, contrast: null } }],
          },
        ],
      }),
    ).toThrow();
  });
});
