import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createProject,
  validateProject,
  migrateProject,
  supportedProjectVersions,
  validateAudioTiming,
  validateEmbeddedAudioPolicy,
  validateCoverageAudioBindings,
  promoteAudioProject,
} from "../src/index.js";
import { promotePinnedProject } from "../../application/src/user-overrides.js";

const timing = {
  version: 1,
  sampleRate: 48000,
  timelineStartSample: 1,
  sourceInSample: 48,
  sourceOutSample: 48048,
};
function project(version = "1.2.0") {
  return {
    ...createProject("Audio"),
    schemaVersion: version,
    stories: [{ id: "s", title: "Story", beats: [] }],
    timelines: [
      {
        id: "cut",
        storyId: "s",
        duration: 2,
        tracks: [
          {
            id: "v",
            type: "video",
            clips: [
              {
                id: "c",
                assetId: "a",
                timelineStart: 0,
                timelineDuration: 1,
                audioTiming: timing,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("independent sound capability", () => {
  it("legacy_absence_is_not_materialized", () => {
    const input = createProject("Legacy"),
      json = JSON.stringify(input);
    expect(JSON.stringify(validateProject(JSON.parse(json)))).toBe(json);
    expect(createProject("New").schemaVersion).toBe("1.0.0");
    expect(
      migrateProject({ ...input, schemaVersion: "0.1.0" }).schemaVersion,
    ).toBe("1.0.0");
  });
  it("rejects_audio_in_1_0_and_1_1", () => {
    for (const version of ["1.0.0", "1.1.0"])
      expect(() => validateProject(project(version))).toThrow(
        /requires project schema 1.2.0/,
      );
    const input = project();
    expect(validateProject(input)).toEqual(input);
    expect(supportedProjectVersions()).toContain("1.2.0");
  });
  it("old_readers_reject_1_2", () => {
    const requireTooling = createRequire(
      createRequire(import.meta.url).resolve("eslint"),
    );
    const Ajv = requireTooling("ajv");
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
      const schema = JSON.parse(
        readFileSync(
          new URL(
            `../../../schemas/openfilm-project-${version}.schema.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      delete schema.$schema;
      expect(new Ajv({ allErrors: true }).compile(schema)(project())).toBe(
        version === "1.2.0",
      );
    }
  });
  it("pin_promotion_retains_1_2", () => {
    const candidate = validateProject(project());
    candidate.timelines[0]!.tracks[0]!.clips[0]!.userOverrides = {
      version: 1,
      isUserPinned: true,
      lockedAttributes: ["timing"],
    };
    expect(promotePinnedProject(candidate).schemaVersion).toBe("1.2.0");
    const legacy = { ...candidate, schemaVersion: "1.0.0" as const };
    const promoted = promoteAudioProject(legacy);
    expect(promoted.schemaVersion).toBe("1.2.0");
    expect(legacy.schemaVersion).toBe("1.0.0");
    delete promoted.timelines[0]!.tracks[0]!.clips[0]!.audioTiming;
    expect(promoteAudioProject(promoted).schemaVersion).toBe("1.2.0");
  });
  it("audio_promotion_is_a_floor_and_never_a_future_schema_import", () => {
    for (const version of ["1.0.0", "1.1.0", "1.2.0"] as const) {
      const input = { ...validateProject(project()), schemaVersion: version };
      expect(promoteAudioProject(input).schemaVersion).toBe("1.2.0");
      expect(input.schemaVersion).toBe(version);
    }
    // The promoter receives application-validated projects. This future-header
    // stand-in tests its floor independently of the intentionally closed importer.
    const future = { ...validateProject(project()), schemaVersion: "1.3.0" };
    expect(() => validateProject(future)).toThrow(/schemaVersion/);
    const promoted = promoteAudioProject(
      future as ReturnType<typeof validateProject>,
    );
    expect(promoted.schemaVersion).toBe("1.3.0");
    expect(promoted.timelines).toEqual(future.timelines);
    expect(promoted).not.toBe(future);
  });
  it("closed_audio_values", () => {
    expect(validateAudioTiming(timing)).toEqual(timing);
    expect(validateAudioTiming(timing)).not.toBe(timing);
    for (const value of [
      null,
      [],
      Object.create(timing),
      { ...timing, extra: 1 },
      { ...timing, version: 2 },
      { ...timing, sampleRate: 44100 },
      ...[NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"].map(
        (sourceInSample) => ({ ...timing, sourceInSample }),
      ),
      { ...timing, sourceOutSample: 48 },
      Object.defineProperty({ ...timing }, "sourceInSample", {
        enumerable: true,
        get() {
          throw new Error("accessor executed");
        },
      }),
      { ...timing, [Symbol("x")]: 1 },
      JSON.parse('{"__proto__":{},"version":1}'),
    ])
      expect(() => validateAudioTiming(value)).toThrow(/audioTiming/);
    expect(
      validateEmbeddedAudioPolicy({ version: 1, mode: "keep-primary" }),
    ).toEqual({ version: 1, mode: "keep-primary" });
    expect(
      validateEmbeddedAudioPolicy({
        version: 1,
        mode: "replace-primary",
        role: "dialogue",
        gain: 0.5,
      }),
    ).toEqual({
      version: 1,
      mode: "replace-primary",
      role: "dialogue",
      gain: 0.5,
    });
    for (const value of [
      { version: 1, mode: "keep-primary", gain: 0 },
      { version: 1, mode: "mix-secondary", role: "other", gain: 1 },
      { version: 1, mode: "mix-secondary", role: "music", gain: 2 },
      { version: 1, mode: "mix-secondary", role: "music", gain: NaN },
    ])
      expect(() => validateEmbeddedAudioPolicy(value)).toThrow(/audioPolicy/);
    const binding = {
      version: 1,
      bindingId: "b",
      compositionId: "cut",
      primaryClipId: "p",
      secondaryClipId: "s",
      startSample: 1,
      endSample: 2,
      policy: { version: 1, mode: "keep-primary" },
    };
    expect(validateCoverageAudioBindings([binding])).toEqual([binding]);
    for (const value of [
      new Array(1),
      new Array(1001),
      [binding, binding],
      [{ ...binding, primaryClipId: "s" }],
      [{ ...binding, endSample: 1 }],
      [{ ...binding, bindingId: "x".repeat(257) }],
      Object.defineProperty([binding], "0", {
        enumerable: true,
        get() {
          throw new Error("accessor executed");
        },
      }),
    ])
      expect(() => validateCoverageAudioBindings(value)).toThrow(/coverage/);
  });
});
