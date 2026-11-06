import { describe, expect, it } from "vitest";
import {
  createProject,
  migrateProject,
  validateJob,
  validateProject,
  validateStory,
  PROJECT_CONTENT_LOCALES,
} from "../src/index.js";

describe("additive film content fields", () => {
  it.each(PROJECT_CONTENT_LOCALES)(
    "round-trips %s and film setup without changing the schema",
    (locale) => {
      const project = {
        ...createProject("我們 & 私たち #1"),
        projectContentLocale: locale,
        filmSettings: {
          templateId: "external-template",
          targetDuration: 270,
          maxDuration: 300,
        },
      };
      expect(validateProject(project)).toEqual(project);
      expect(validateProject(project).schemaVersion).toBe("1.0.0");
      expect(validateProject(project)).not.toBe(project);
    },
  );

  it("keeps existing and migrated legacy text without invented provenance", () => {
    const legacy = createProject("Existing title");
    legacy.stories = [
      {
        id: "story",
        title: "Our Story",
        template: "proposal-film",
        beats: [{ id: "story:beat:1", title: "Cold Open", intent: "My words" }],
      },
    ];
    expect(migrateProject(legacy)).toEqual(legacy);
    const migrated = migrateProject({ ...legacy, schemaVersion: "0.1.0" });
    expect(migrated.projectContentLocale).toBeUndefined();
    expect(migrated.filmSettings).toBeUndefined();
    expect(migrated.stories).toEqual(legacy.stories);
  });

  it.each(["en-XA", "en", "zh-CN", "ja", "", null, 4])(
    "rejects unsupported persisted locale %j",
    (locale) => {
      expect(() =>
        validateProject({
          ...createProject("Film"),
          projectContentLocale: locale,
        }),
      ).toThrow("projectContentLocale");
    },
  );

  it.each([
    { templateId: "blank", targetDuration: 0, maxDuration: 10 },
    { templateId: "blank", targetDuration: 11, maxDuration: 10 },
    { templateId: "blank", targetDuration: 10 },
    { templateId: "", targetDuration: 10, maxDuration: 20 },
  ])("rejects invalid film defaults %j", (settings) => {
    expect(() =>
      validateProject({ ...createProject("Film"), filmSettings: settings }),
    ).toThrow("filmSettings");
  });

  it("requires a stable key only for explicitly template-owned text", () => {
    const story = {
      id: "story",
      title: "Story",
      beats: [{ id: "beat", title: "Opening" }],
    };
    expect(validateStory(story)).toEqual(story);
    expect(() =>
      validateStory({
        ...story,
        beats: [{ ...story.beats[0], titleSource: "template" }],
      }),
    ).toThrow("templateBeatKey");
    expect(() =>
      validateStory({
        ...story,
        beats: [{ ...story.beats[0], titleSource: "custom" }],
      }),
    ).toThrow("titleSource");
    const owned = {
      ...story,
      beats: [
        {
          ...story.beats[0],
          templateBeatKey: "third-party.opening",
          titleSource: "template",
          intentSource: "user",
        },
      ],
    };
    expect(validateStory(owned)).toEqual(owned);
  });

  it("round-trips explicit event/person groups and bounded per-beat media balance", () => {
    const story = {
      id: "story",
      title: "Anniversary",
      beats: [
        {
          id: "beat",
          title: "Gathering",
          constraints: [
            {
              type: "coverage-group",
              version: 1,
              kind: "event",
              groupId: "event:ceremony",
              label: "Ceremony",
              assetIds: ["asset-1", "asset-2"],
              minimumCount: 1,
            },
            {
              type: "coverage-group",
              version: 1,
              kind: "person",
              groupId: "person:host",
              label: "Host",
              assetIds: ["asset-3"],
              minimumCount: 1,
            },
            {
              type: "media-balance",
              version: 1,
              minImages: 1,
              maxImages: 3,
              minVideos: 1,
              maxVideos: 2,
            },
          ],
        },
      ],
    };

    expect(
      validateStory(story, { assetIds: ["asset-1", "asset-2", "asset-3"] }),
    ).toEqual(story);
  });

  it.each([
    {
      type: "coverage-group",
      version: 1,
      kind: "person",
      groupId: "person:host",
      label: "Host",
      assetIds: ["asset-1"],
      minimumCount: 2,
    },
    {
      type: "coverage-group",
      version: 1,
      kind: "event",
      groupId: "event:ceremony",
      label: "Ceremony",
      assetIds: ["asset-1", "asset-1"],
      minimumCount: 1,
    },
    {
      type: "coverage-group",
      version: 1,
      kind: "event",
      groupId: "event:ceremony",
      label: "   ",
      assetIds: ["asset-1"],
      minimumCount: 1,
    },
    {
      type: "media-balance",
      version: 1,
      minImages: 2,
      maxImages: 1,
    },
    {
      type: "media-balance",
      version: 1,
      minVideos: 1.5,
    },
  ])("rejects invalid coverage constraint $type", (constraint) => {
    expect(() =>
      validateStory({
        id: "story",
        title: "Story",
        beats: [{ id: "beat", title: "Scene", constraints: [constraint] }],
      }),
    ).toThrow("constraints");
  });

  it("rejects a coverage group that references an asset outside the catalog", () => {
    expect(() =>
      validateStory(
        {
          id: "story",
          title: "Story",
          beats: [
            {
              id: "beat",
              title: "Scene",
              constraints: [
                {
                  type: "coverage-group",
                  version: 1,
                  kind: "event",
                  groupId: "event:ceremony",
                  label: "Ceremony",
                  assetIds: ["missing"],
                  minimumCount: 1,
                },
              ],
            },
          ],
        },
        { assetIds: ["present"] },
      ),
    ).toThrow("unknown asset ID");
  });
});

describe("semantic job errors", () => {
  const legacy = {
    id: "job",
    type: "import",
    status: "failed",
    errors: [
      {
        uri: "file:///回憶 & photo.jpg",
        stage: "inspect",
        message: "Could not read file",
      },
    ],
  };

  it("accepts legacy errors and typed details without rewriting original paths", () => {
    expect(validateJob(legacy)).toEqual(legacy);
    const job = {
      ...legacy,
      errors: [
        {
          ...legacy.errors[0],
          code: "media.unavailable",
          params: { name: "回憶 & photo.jpg", count: 0, detail: "" },
          detail: "ENOENT",
        },
      ],
    };
    expect(validateJob(job)).toEqual(job);
  });

  it.each([true, {}, [], null, Infinity])(
    "rejects a non-string/non-finite diagnostic parameter %j",
    (value) => {
      expect(() =>
        validateJob({
          ...legacy,
          errors: [{ ...legacy.errors[0], params: { value } }],
        }),
      ).toThrow("params.value");
    },
  );
});
