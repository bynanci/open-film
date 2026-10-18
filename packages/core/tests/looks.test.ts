// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FILM_LOOK_MATRIX_DOMAIN,
  FILM_LOOK_PRESETS,
  FILM_LOOK_RECIPE_LICENSE,
  FILM_LOOK_RECIPE_ORIGIN,
  FILM_LOOK_RECIPE_VERSION,
  filmLookMatrix,
  isFilmLookActive,
  resolveFilmLook,
  validateComposition,
  validateFilmLook,
  validateProject,
  type Clip,
  type Composition,
  type FilmLook,
} from "../src/index.js";

const look = (preset: FilmLook["preset"], strength = 1): FilmLook => ({
  version: 1,
  preset,
  strength,
});
const clip: Clip = {
  id: "clip",
  assetId: "photo",
  beatId: "beat",
  timelineStart: 0,
  timelineDuration: 4,
};
const composition = (): Composition => ({
  id: "composition",
  storyId: "story",
  duration: 4,
  tracks: [{ id: "video", type: "video", clips: [structuredClone(clip)] }],
});
const identity = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

describe("portable film look recipes", () => {
  it("publishes original recipe licensing and an encoded-SDR working-domain contract", () => {
    expect(FILM_LOOK_MATRIX_DOMAIN).toBe("encoded-sdr-rgb");
    expect(FILM_LOOK_RECIPE_ORIGIN).toBe("openfilm-original");
    expect(FILM_LOOK_RECIPE_LICENSE).toBe("Apache-2.0");
    for (const value of [
      FILM_LOOK_MATRIX_DOMAIN,
      FILM_LOOK_RECIPE_ORIGIN,
      FILM_LOOK_RECIPE_LICENSE,
    ])
      expect(typeof value).toBe("string");
    expect(Object.isFrozen(FILM_LOOK_PRESETS)).toBe(true);
    expect(
      FILM_LOOK_PRESETS.every(
        (preset) => Object.isFrozen(preset) && Object.isFrozen(preset.matrix),
      ),
    ).toBe(true);
  });

  it("keeps version 1 recipe coefficients immutable for reproducible historical renders", () => {
    // A new recipe needs a new version; never update this baseline to hide a
    // change to the already published version 1 IDs or matrix coefficients.
    expect(FILM_LOOK_RECIPE_VERSION).toBe(1);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          version: FILM_LOOK_RECIPE_VERSION,
          presets: FILM_LOOK_PRESETS,
        }),
      )
      .digest("hex");
    expect(fingerprint).toBe(
      "623b11d1224b5aeca569c61eec10e82f3ab03d2a3689f0db12ec01a9803b1ef6",
    );
  });

  it("validates the bounded versioned recipe and returns a detached value", () => {
    const original = look("natural", 0.65);
    const parsed = validateFilmLook(original);
    expect(parsed).toEqual(original);
    expect(parsed).not.toBe(original);
    for (const invalid of [
      null,
      [],
      { ...original, version: 2 },
      { ...original, preset: "unknown" },
      { ...original, strength: -0.01 },
      { ...original, strength: 1.01 },
      { ...original, strength: NaN },
      { ...original, strength: Infinity },
      { ...original, strength: "1" },
      { ...original, strength: undefined },
      { ...original, command: "remote-filter" },
    ])
      expect(() => validateFilmLook(invalid)).toThrow();
  });

  it("provides seven distinct finite matrices while preserving alpha", () => {
    expect(FILM_LOOK_PRESETS.map((preset) => preset.id)).toEqual([
      "none",
      "soft-film",
      "americana",
      "clean-camera",
      "retro",
      "natural",
      "sport",
    ]);
    const signatures = FILM_LOOK_PRESETS.map((preset) => {
      const matrix = filmLookMatrix(look(preset.id));
      expect(matrix).toHaveLength(20);
      expect(matrix.every(Number.isFinite)).toBe(true);
      expect(matrix.slice(15)).toEqual([0, 0, 0, 1, 0]);
      expect([matrix[4], matrix[9], matrix[14]]).toEqual([0, 0, 0]);
      return JSON.stringify(matrix);
    });
    expect(new Set(signatures).size).toBe(7);
    expect(filmLookMatrix(look("none"))).toEqual(identity);
    expect(filmLookMatrix()).toEqual(identity);
    expect(filmLookMatrix(null)).toEqual(identity);
  });

  it("interpolates strength with identity and disables zero strength", () => {
    const full = filmLookMatrix(look("retro"));
    const half = filmLookMatrix(look("retro", 0.5));
    expect(half).toEqual(
      full.map((value, index) => (value + identity[index]!) / 2),
    );
    expect(filmLookMatrix(look("sport", 0))).toEqual(identity);
    expect(isFilmLookActive(look("sport", 0))).toBe(false);
    expect(isFilmLookActive(look("none"))).toBe(false);
    expect(isFilmLookActive(undefined)).toBe(false);
    expect(isFilmLookActive(look("sport", 0.5))).toBe(true);
    expect(() => filmLookMatrix(look("sport", 2))).toThrow();
  });

  it("resolves export, clip, beat, film and original independently of strength", () => {
    const current = composition();
    expect(resolveFilmLook(current, clip)).toEqual({
      look: look("none"),
      source: "original",
    });
    current.defaultLook = look("natural");
    expect(resolveFilmLook(current, clip)).toEqual({
      look: look("natural"),
      source: "film",
    });
    current.beatLooks = [{ beatId: "beat", look: look("retro") }];
    expect(resolveFilmLook(current, clip)).toEqual({
      look: look("retro"),
      source: "beat",
    });
    const overridden = { ...clip, look: look("none") };
    expect(resolveFilmLook(current, overridden)).toEqual({
      look: look("none"),
      source: "clip",
    });
    expect(resolveFilmLook(current, overridden, look("sport", 0))).toEqual({
      look: look("sport", 0),
      source: "export",
    });
    expect(resolveFilmLook(current, overridden, null).source).toBe("clip");
    expect(resolveFilmLook(current, { ...clip, beatId: "other" }).source).toBe(
      "film",
    );
    const resolved = resolveFilmLook(current, clip);
    resolved.look.strength = 0;
    expect(current.beatLooks[0]!.look.strength).toBe(1);
  });

  it("preserves legacy compositions and validates all nested look fields", () => {
    expect(validateComposition(composition())).toEqual(composition());
    const current = composition();
    current.defaultLook = look("soft-film");
    current.beatLooks = [{ beatId: "beat", look: look("americana", 0.7) }];
    current.tracks[0]!.clips[0]!.look = look("none");
    expect(validateComposition(current)).toEqual(current);
    for (const invalid of [
      { ...current, defaultLook: { ...look("retro"), preset: "bad" } },
      { ...current, defaultLook: null },
      { ...current, beatLooks: [{ beatId: "beat", look: null }] },
      {
        ...current,
        beatLooks: [{ beatId: "b".repeat(257), look: look("retro") }],
      },
      {
        ...current,
        beatLooks: [{ beatId: "beat\u0000", look: look("retro") }],
      },
      { ...current, beatLooks: [{ beatId: "", look: look("retro") }] },
      {
        ...current,
        beatLooks: [{ beatId: "beat", look: look("retro"), extra: true }],
      },
      {
        ...current,
        beatLooks: [
          { beatId: "beat", look: look("retro") },
          { beatId: "beat", look: look("sport") },
        ],
      },
      {
        ...current,
        beatLooks: Array.from({ length: 1001 }, (_, i) => ({
          beatId: `beat-${i}`,
          look: look("retro"),
        })),
      },
    ])
      expect(() => validateComposition(invalid)).toThrow();
    const badClip = structuredClone(current);
    badClip.tracks[0]!.clips[0]!.look!.strength = -1;
    expect(() => validateComposition(badClip)).toThrow(/look/);
  });

  it("returns fresh matrices so caller edits cannot corrupt shared recipes", () => {
    const expected = filmLookMatrix(look("retro"));
    const modified = filmLookMatrix(look("retro"));
    modified[0] = 100;
    expect(filmLookMatrix(look("retro"))).toEqual(expected);
    expect(Object.isFrozen(FILM_LOOK_PRESETS)).toBe(true);
    expect(
      FILM_LOOK_PRESETS.every(
        (preset) => Object.isFrozen(preset) && Object.isFrozen(preset.matrix),
      ),
    ).toBe(true);
  });

  it("rejects a project look assigned to a beat outside its composition story", () => {
    const current = composition();
    current.beatLooks = [{ beatId: "foreign", look: look("retro") }];
    expect(() =>
      validateProject({
        schemaVersion: "1.0.0",
        id: "project",
        title: "Project",
        createdAt: "2026-10-18T00:00:00.000Z",
        updatedAt: "2026-10-18T00:00:00.000Z",
        mediaLibraries: [],
        settings: { width: 1280, height: 720, frameRate: 30 },
        stories: [
          {
            id: "story",
            title: "Story",
            beats: [{ id: "beat", title: "Beat" }],
          },
        ],
        timelines: [current],
      }),
    ).toThrow(/foreign/);
  });

  it.each(["audio", "music", "titles"] as const)(
    "rejects a clip look authored on a %s track",
    (type) => {
      const current = composition();
      current.tracks[0]!.type = type;
      current.tracks[0]!.clips[0]!.look = look("retro");
      expect(() => validateComposition(current)).toThrow(/look/);
    },
  );
});
