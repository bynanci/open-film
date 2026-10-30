// SPDX-License-Identifier: Apache-2.0
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createProject,
  validatePresetPackage,
  validateProject,
} from "@openfilm/core";
import { createPresetSnapshot } from "@openfilm/application";
import { presetPackage } from "../fixtures/local-presets/package.js";
const toolingRequire = createRequire(
  createRequire(import.meta.url).resolve("eslint"),
);
const Ajv = toolingRequire("ajv");
const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../schemas/openfilm-project-1.1.0.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
// The existing ESLint tooling supplies Ajv6. Translate only 2020-12 fixed tuple
// syntax to its equivalent draft7 tuple syntax; all values/constraints remain.
function legacyTupleSyntax(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyTupleSyntax);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema")
      .map(([key, child]) => [key, legacyTupleSyntax(child)]),
  );
  if ("prefixItems" in result) {
    result.additionalItems = result.items;
    result.items = result.prefixItems;
    delete result.prefixItems;
  }
  return result;
}
const validate = new Ajv({ allErrors: true, strictNumbers: true }).compile(
  legacyTupleSyntax(schema),
);
function project() {
  const pkg = validatePresetPackage(presetPackage());
  const look = {
    version: 2 as const,
    preset: "local" as const,
    strength: 0.8,
    snapshot: createPresetSnapshot<"film-look">(
      pkg,
      pkg.entries.find((entry) => entry.kind === "film-look")!,
    ),
  };
  const title = createPresetSnapshot<"title">(
    pkg,
    pkg.entries.find((entry) => entry.kind === "title")!,
  );
  const story = createPresetSnapshot<"story">(
    pkg,
    pkg.entries.find((entry) => entry.kind === "story")!,
  );
  const p = createProject("Integrated pin schema");
  return {
    ...p,
    schemaVersion: "1.1.0",
    presetApplicationReceipts: [
      {
        version: 1,
        projectId: p.id,
        requestId: "schema-review",
        requestSha256: "a".repeat(64),
        reviewSha256: "b".repeat(64),
        kind: "film-look",
        canonicalId: look.snapshot.canonicalId,
        packageSha256: look.snapshot.packageSha256,
        snapshotSha256: look.snapshot.snapshotSha256,
        result: { storyId: "story", compositionId: "cut" },
        acceptedRevision: "c".repeat(64),
        acceptedAt: p.createdAt,
      },
    ],
    stories: [
      {
        id: "story",
        title: "Story",
        beats: [{ id: "beat", title: "Beat" }],
        presetSnapshot: story,
        presetPlanSource: {
          version: 1,
          storyId: "source-story",
          planId: "source-plan",
          sourceGuardSha256: "d".repeat(64),
          bindings: [
            {
              recipeBeatKey: "begin",
              sourceBeatId: "source-beat",
              beatId: "beat",
            },
          ],
        },
      },
    ],
    timelines: [
      {
        id: "cut",
        storyId: "story",
        duration: 2,
        defaultLook: look,
        beatLooks: [{ beatId: "beat", look }],
        defaultPrimaryColor: {
          version: 1,
          temperature: 0.4,
          exposureEv: 0.5,
          contrast: 1,
        },
        beatPrimaryColors: [
          {
            beatId: "beat",
            correction: {
              version: 1,
              temperature: 0,
              exposureEv: 0.2,
              contrast: 1,
            },
          },
        ],
        storyPresetSnapshot: story,
        tracks: [
          {
            id: "v",
            type: "video",
            clips: [
              {
                id: "photo",
                assetId: "photo",
                beatId: "beat",
                timelineStart: 0,
                timelineDuration: 2,
                layout: {
                  version: 2,
                  preset: "diptych",
                  gap: 10,
                  secondary: {
                    assetId: "other",
                    focalPoint: { x: 0.4, y: 0.6 },
                  },
                  fill: {
                    version: 1,
                    kind: "ambient",
                    blurSigma: 0.03,
                    dim: 0.4,
                  },
                },
                motion: {
                  version: 2,
                  preset: "pull-out",
                  easing: {
                    version: 1,
                    kind: "cubic-bezier",
                    x1: 0.2,
                    y1: 0.1,
                    x2: 0.8,
                    y2: 0.9,
                  },
                  from: { scale: 1.1, x: 0, y: 0 },
                  to: { scale: 1, x: 0, y: 0 },
                },
                title: "記憶\nMemories",
                titleRuns: {
                  version: 1,
                  splitAt: 2,
                  gap: 8,
                  secondary: { fontSize: 20, tracking: 2 },
                },
                titlePresetSnapshot: title,
                titleStyle: {
                  version: 1,
                  role: "film-title",
                  safeArea: { bottom: 0.1 },
                  fadeOut: 0.2,
                  bottomSafeMargin: 0.1,
                  finishing: {
                    version: 1,
                    shadow: {
                      color: "#000000",
                      opacity: 0.4,
                      offsetX: 2,
                      offsetY: 2,
                      blur: 3,
                    },
                    stroke: { color: "#FFFFFF", width: 1 },
                    pill: {
                      color: "#202020",
                      opacity: 0.4,
                      paddingX: 8,
                      paddingY: 4,
                      radius: 4,
                    },
                  },
                },
                look,
                primaryColor: {
                  version: 1,
                  temperature: 0,
                  exposureEv: 0,
                  contrast: 1,
                },
                userOverrides: {
                  version: 1,
                  isUserPinned: true,
                  lockedAttributes: ["motionPreset", "timing"],
                },
              },
            ],
          },
        ],
        captionTracks: [
          {
            version: 1,
            id: "captions",
            name: "Captions",
            language: "zh-TW",
            style: {
              version: 1,
              role: "subtitle",
              finishing: { version: 1, stroke: { color: "#000000", width: 1 } },
            },
            cues: [
              {
                version: 1,
                id: "cue",
                startMs: 0,
                endMs: 1500,
                text: "記憶\nMemories",
                textRuns: { version: 1, splitAt: 2 },
                source: { kind: "manual" },
                manualRevision: 0,
              },
            ],
          },
        ],
      },
    ],
  };
}
function alter(path: string, value: unknown) {
  const p = project();
  let cursor: Record<string, unknown> = p as unknown as Record<string, unknown>;
  const keys = path.split(".");
  for (const key of keys.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  cursor[keys.at(-1)!] = value;
  return p;
}
const exportedCases: { name: string; valid: boolean; project: unknown }[] = [];
afterAll(() => {
  const evidence = process.env.OPENFILM_PIN_SCHEMA_QA_OUTPUT;
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      join(evidence, "cases.json"),
      JSON.stringify(exportedCases, null, 2),
    );
  }
});
const clip = "timelines.0.tracks.0.clips.0";
describe("schema1.1 actual finishing owners", () => {
  it("accepts the actual A/B/C/D8 portable shapes together without dropping pin or provenance payload", () => {
    const p = project();
    expect(validateProject(p)).toEqual(p);
    exportedCases.push({
      name: "actual finishing owners",
      valid: true,
      project: p,
    });
    expect(validate(p), JSON.stringify(validate.errors)).toBe(true);
  });
  it.each([
    [`${clip}.layout.version`, 3],
    [`${clip}.layout.fill.blurSigma`, 0.051],
    [`${clip}.layout.fill.unknown`, true],
    [`${clip}.motion.easing.x1`, -0.1],
    [`${clip}.motion.easing.x2`, 1.1],
    [`${clip}.motion.easing.kind`, "expression"],
    [`${clip}.titleRuns.primary`, { fontSize: 0 }],
    [`${clip}.titleRuns.gap`, 129],
    [`${clip}.titleStyle.finishing.stroke.width`, 17],
    [`${clip}.titleStyle.finishing.pill.opacity`, 1.1],
    [`${clip}.titleStyle.finishing.shadow.url`, "file:///private"],
    [`${clip}.titleStyle.safeArea.bottom`, 0.31],
    [`${clip}.primaryColor.version`, 2],
    [`${clip}.primaryColor.exposureEv`, 2.01],
    ["timelines.0.beatPrimaryColors.0.correction.temperature", -1.01],
    [`${clip}.look.version`, 3],
    [`${clip}.look.snapshot.packageSha256`, "not-a-hash"],
    [`${clip}.look.snapshot.recipe.matrix.18`, 0],
    [`${clip}.look.snapshot.recipe.matrix.3`, 0.6],
    [`${clip}.look.snapshot.recipe.matrix`, [1, 0]],
    [`${clip}.look.snapshot.provenance.url`, "https://invalid"],
    [`${clip}.look.snapshot.provenance.source`, "file:///private"],
    [`${clip}.look.snapshot.license.notice`, "<script>bad</script>"],
    [`${clip}.titlePresetSnapshot.recipe.fontFamily`, "private/path"],
    [`${clip}.titlePresetSnapshot.recipe.finishing`, { version: 2 }],
    ["timelines.0.captionTracks.0.cues.0.textRuns.version", 2],
    ["timelines.0.captionTracks.0.cues.0.manualRevision", -1],
    ["timelines.0.storyPresetSnapshot.recipe.beats.0.weight", 0],
    ["presetApplicationReceipts.0.requestSha256", "not-a-hash"],
    ["presetApplicationReceipts.0.kind", "script"],
    ["presetApplicationReceipts.0.result.url", "file:///private"],
    ["stories.0.presetPlanSource.version", 2],
  ])("rejects unsupported nested finishing data at %s", (path, value) => {
    expect(validate(project()), JSON.stringify(validate.errors)).toBe(true);
    const p = alter(String(path), value);
    expect(() => validateProject(p)).toThrow();
    exportedCases.push({ name: String(path), valid: false, project: p });
    expect(validate(p), JSON.stringify(validate.errors)).toBe(false);
  });
  it("continues to accept legacy photo and builtin Look recipes inside a pinned1.1 project", () => {
    const p = alter(`${clip}.layout`, { version: 1, preset: "contain" });
    p.timelines[0]!.tracks[0]!.clips[0]!.motion = {
      version: 1,
      preset: "hold",
      easing: "linear",
      from: { scale: 1, x: 0, y: 0 },
      to: { scale: 1, x: 0, y: 0 },
    } as unknown as (typeof p.timelines)[0]["tracks"][0]["clips"][0]["motion"];
    p.timelines[0]!.tracks[0]!.clips[0]!.look = {
      version: 1,
      preset: "none",
      strength: 1,
    } as unknown as (typeof p.timelines)[0]["tracks"][0]["clips"][0]["look"];
    expect(validateProject(p)).toEqual(p);
    expect(validate(p), JSON.stringify(validate.errors)).toBe(true);
    exportedCases.push({
      name: "legacy recipes in1.1",
      valid: true,
      project: p,
    });
  });
  it("requires concrete typed fields for actual finishing properties", () => {
    const properties = schema.$defs.clip.properties;
    for (const field of [
      "layout",
      "motion",
      "titleRuns",
      "titleStyle",
      "titlePresetSnapshot",
      "primaryColor",
      "look",
      "userOverrides",
    ])
      expect(properties[field]).toBeDefined();
    for (const field of [
      "defaultPrimaryColor",
      "beatPrimaryColors",
      "defaultLook",
      "beatLooks",
      "captionTracks",
      "storyPresetSnapshot",
    ])
      expect(schema.$defs.composition.properties[field]).toBeDefined();
  });
});
