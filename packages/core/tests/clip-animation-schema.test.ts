import { describe, expect, it } from "vitest";
import {
  createProject,
  promoteClipAnimationProject,
  validateProject,
} from "../src/index.js";

function project(schemaVersion: string, animation: unknown) {
  const base = createProject("Animated");
  return {
    ...base,
    schemaVersion,
    stories: [{ id: "story", title: "Story", beats: [] }],
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
                timelineDuration: 1,
                animation,
              },
            ],
          },
        ],
      },
    ],
  };
}

const validAnimation = {
  version: 1,
  visualTracks: [
    {
      property: "x",
      keys: [
        { frame: 0, value: 0 },
        { frame: 29, value: 120 },
      ],
    },
  ],
};

describe("clip animation project contract", () => {
  it("requires schema 1.4 and preserves the validated declarative keys", () => {
    expect(() => validateProject(project("1.3.0", validAnimation))).toThrow(
      /requires project schema 1\.4\.0/,
    );
    const input = project("1.4.0", validAnimation);
    expect(validateProject(input)).toEqual(input);
  });

  it("bounds keys to the visible clip samples and composition geometry", () => {
    expect(() =>
      validateProject(
        project("1.4.0", {
          ...validAnimation,
          visualTracks: [{ property: "x", keys: [{ frame: 30, value: 0 }] }],
        }),
      ),
    ).toThrow(/visible clip frame range/);
    expect(() =>
      validateProject(
        project("1.4.0", {
          version: 1,
          visualTracks: [{ property: "x", keys: [{ frame: 0, value: 7681 }] }],
        }),
      ),
    ).toThrow(/outside the x range/);
  });

  it("promotes only projects that contain animation and never downgrades later schemas", () => {
    const plain = createProject("Plain");
    expect(promoteClipAnimationProject(plain)).toEqual(plain);
    const candidate = project("1.3.0", validAnimation) as ReturnType<
      typeof createProject
    >;
    const promoted = promoteClipAnimationProject(candidate);
    expect(promoted.schemaVersion).toBe("1.4.0");
    expect(candidate.schemaVersion).toBe("1.3.0");
    const later = { ...candidate, schemaVersion: "1.5.0" } as never;
    expect(promoteClipAnimationProject(later).schemaVersion).toBe("1.5.0");
  });
});
