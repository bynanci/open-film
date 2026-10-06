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
