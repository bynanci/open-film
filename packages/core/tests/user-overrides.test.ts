import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  createProject,
  validateProject,
  validateUserOverrideState,
  hasUserOverrideState,
  migrateProject,
  supportedProjectVersions,
} from "../src/index.js";

const pinned = { version: 1, isUserPinned: true, lockedAttributes: ["timing"] };
function project(version = "1.1.0") {
  return {
    ...createProject("Pins"),
    schemaVersion: version,
    timelines: [
      {
        id: "cut",
        storyId: "story",
        duration: 2,
        tracks: [
          {
            id: "video",
            type: "video",
            clips: [
              {
                id: "clip",
                assetId: "asset",
                timelineStart: 0,
                timelineDuration: 2,
                userOverrides: pinned,
              },
            ],
          },
        ],
      },
    ],
    stories: [{ id: "story", title: "Story", beats: [] }],
  };
}
describe("portable user overrides", () => {
  it("accepts_legacy_without_materializing_defaults", () => {
    const value = createProject("Legacy");
    expect(validateProject(value)).toEqual(value);
    expect(hasUserOverrideState(value)).toBe(false);
    expect(supportedProjectVersions()).toContain("1.1.0");
  });
  it("rejects_pins_in_1_0", () => {
    expect(() => validateProject(project("1.0.0"))).toThrow(
      "project.timelines[0].tracks[0].clips[0].userOverrides",
    );
  });
  it("accepts_closed_1_1_pin_objects", () => {
    const input = {
      ...pinned,
      lockedAttributes: ["timing", "inOutRange"],
      manualOffset: -3,
    };
    expect(validateUserOverrideState(input, "clip")).toEqual({
      ...input,
      lockedAttributes: ["inOutRange", "timing"],
    });
    expect(input.lockedAttributes).toEqual(["timing", "inOutRange"]);
    const value = project();
    expect(validateProject(value)).toEqual(value);
    expect(migrateProject(value)).toEqual(value);
  });
  it.each([
    null,
    { ...pinned, version: 2 },
    { ...pinned, extra: true },
    { ...pinned, lockedAttributes: ["timing", "timing"] },
    { ...pinned, lockedAttributes: new Array(1) },
    { ...pinned, manualOffset: 0.5 },
    { ...pinned, manualOffset: Infinity },
    { ...pinned, isUserPinned: false },
    { version: 1, isUserPinned: false, lockedAttributes: [], manualOffset: 0 },
    { ...pinned, lockedAttributes: [] },
    Object.create({ version: 1 }),
    Object.defineProperty({ ...pinned }, "manualOffset", {
      get() {
        throw new Error("getter called");
      },
      enumerable: true,
    }),
    { ...pinned, [Symbol("x")]: 1 },
  ])(
    "rejects_unknown_version_keys_duplicates_accessors_and_sparse_arrays %#",
    (value) => {
      expect(() => validateUserOverrideState(value, "clip")).toThrow(
        /userOverrides/,
      );
    },
  );
  it("validates_owner_categories_and_removed_effect_pins", () => {
    expect(() =>
      validateUserOverrideState(
        { ...pinned, lockedAttributes: ["photoDepth", "timing"] },
        "clip",
      ),
    ).toThrow("lockedAttributes[0]");
    expect(() =>
      validateUserOverrideState(
        { ...pinned, lockedAttributes: ["motionPreset", "timing"] },
        "graphic-scene",
      ),
    ).toThrow("lockedAttributes[0]");
    expect(
      validateUserOverrideState(
        { ...pinned, lockedAttributes: ["motionPreset", "timing"] },
        "clip",
      ),
    ).toEqual({ ...pinned, lockedAttributes: ["motionPreset", "timing"] });
  });
  it("old_validator_rejects_1_1_before_clip_processing", () => {
    // Frozen pre-feature version equality gate, independent from the new parser.
    const oldReader = (value: { schemaVersion: string }) => {
      if (value.schemaVersion !== "1.0.0")
        throw new Error("unsupported schema version");
    };
    expect(() => oldReader(project())).toThrow("unsupported schema version");
    const oldSchema = JSON.parse(
      readFileSync(
        new URL(
          "../../../schemas/openfilm-project-1.0.0.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(oldSchema.properties.schemaVersion.const).toBe("1.0.0");
    const toolingRequire = createRequire(
      createRequire(import.meta.url).resolve("eslint"),
    );
    const Ajv = toolingRequire("ajv");
    delete oldSchema.$schema;
    expect(new Ajv({ allErrors: true }).compile(oldSchema)(project())).toBe(
      false,
    );
    const schema = JSON.parse(
      readFileSync(
        new URL(
          "../../../schemas/openfilm-project-1.1.0.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    delete schema.$schema;
    expect(new Ajv({ allErrors: true }).compile(schema)(project())).toBe(true);
  });
});
