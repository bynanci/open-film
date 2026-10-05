import { describe, expect, it } from "vitest";
import {
  createProject,
  migrateProject,
  PROJECT_SCHEMA_VERSION,
  ProjectValidationError,
  supportedProjectVersions,
  validateComposition,
  validateJob,
  validateMediaAsset,
  validateProject,
  validateStory,
  type MediaAsset,
  type OpenFilmProject,
} from "../src/index.js";

function project(): OpenFilmProject {
  const value = createProject("Archive");
  value.mediaLibraries.push({
    id: "library",
    name: "Camera",
    uri: "file:///media",
  });
  value.stories.push({
    id: "story",
    title: "A day",
    targetDuration: 10,
    maxDuration: 20,
    beats: [
      {
        id: "beat",
        title: "Opening",
        candidateAssetIds: ["asset"],
        selectedAssetIds: ["asset"],
        constraints: [{ type: "must-include", assetIds: ["asset"] }],
      },
    ],
  });
  value.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 10,
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "asset",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 10,
            sourceIn: 1,
            sourceOut: 11,
            transform: { scale: 1, speed: 1, volume: 0 },
          },
        ],
      },
    ],
  });
  return value;
}

function asset(): MediaAsset {
  return {
    id: "asset",
    uri: "file:///original.mp4",
    name: "Original",
    mediaType: "video",
    duration: 20,
    capturedAt: "2024-02-29T12:00:00+08:00",
    capturedAtConfidence: 0.9,
    capturedAtSource: "camera",
    dimensions: { width: 1920, height: 1080 },
    frameRate: 29.97,
    tags: ["outdoor"],
    rating: 4.5,
    state: { favorite: true },
    metadata: { "openfilm.camera.test": { original: true } },
    gps: { latitude: 25.03, longitude: 121.56 },
  };
}

describe("versioned projects", () => {
  it("creates independent valid projects with a shared initial timestamp", () => {
    const first = createProject("  Archive  ");
    const second = createProject("Archive");
    expect(first.title).toBe("Archive");
    expect(first.id).not.toBe(second.id);
    expect(first.createdAt).toBe(first.updatedAt);
    expect(validateProject(first)).toEqual(first);
    first.stories.push({ id: "s", title: "One", beats: [] });
    expect(second.stories).toEqual([]);
    expect(() => createProject("   ")).toThrow("title");
  });

  it("roundtrips stories and non-destructive composition operations", () => {
    const original = project();
    const parsed = validateProject(JSON.parse(JSON.stringify(original)), {
      assetIds: ["asset"],
    });
    expect(parsed).toEqual(original);
    parsed.stories[0]!.beats[0]!.title = "Changed";
    expect(original.stories[0]!.beats[0]!.title).toBe("Opening");
  });

  it.each([
    undefined,
    null,
    1,
    "1",
    "v1.0.0",
    "1.0",
    "2.0.0",
    "1.0.1",
    "0.9.0",
  ])(
    "rejects unsupported or malformed version %s without guessing",
    (version) => {
      const value = { ...project(), schemaVersion: version };
      expect(() => validateProject(value)).toThrow(ProjectValidationError);
      expect(() => migrateProject(value)).toThrow(ProjectValidationError);
      expect(value.schemaVersion).toBe(version);
    },
  );

  it("migrates the documented draft without modifying or aliasing the input", () => {
    const original = project();
    const { settings: _settings, ...draft } = original;
    const legacy = { ...draft, schemaVersion: "0.1.0" };
    const migrated = migrateProject(legacy);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.settings).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    expect(legacy).not.toHaveProperty("settings");
    expect(legacy.schemaVersion).toBe("0.1.0");
    migrated.stories[0]!.title = "New";
    expect(legacy.stories[0]!.title).toBe("A day");
    expect(supportedProjectVersions()).toEqual(["0.1.0", "1.0.0"]);
  });

  it("does not repair malformed existing settings during migration", () => {
    expect(() =>
      migrateProject({
        ...project(),
        schemaVersion: "0.1.0",
        settings: { width: 0, height: 1080, frameRate: 30 },
      }),
    ).toThrow("settings.width");
  });

  it("rejects missing stories and beat references scoped to another story", () => {
    const unknownStory = project();
    unknownStory.timelines[0]!.storyId = "missing";
    expect(() => validateProject(unknownStory)).toThrow(
      "unknown story ID missing",
    );
    const unknownBeat = project();
    unknownBeat.stories.push({
      id: "another",
      title: "Other",
      beats: [{ id: "other-beat", title: "Other beat" }],
    });
    unknownBeat.timelines[0]!.tracks[0]!.clips[0]!.beatId = "other-beat";
    expect(() => validateProject(unknownBeat)).toThrow(
      "unknown beat ID other-beat",
    );
  });

  it("optionally checks all catalog asset references", () => {
    expect(() => validateProject(project())).not.toThrow();
    expect(() => validateProject(project(), { assetIds: [] })).toThrow(
      "unknown asset ID asset",
    );
    const value = project();
    value.timelines[0]!.tracks[0]!.clips[0]!.assetId = "missing";
    expect(() => validateProject(value, { assetIds: ["asset"] })).toThrow(
      "unknown asset ID missing",
    );
  });

  it("rejects duplicate object IDs and duplicate selections", () => {
    const value = project();
    value.stories.push(value.stories[0]!);
    expect(() => validateProject(value)).toThrow("duplicate ID story");
    const duplicateSelection = project();
    duplicateSelection.stories[0]!.beats[0]!.selectedAssetIds = [
      "asset",
      "asset",
    ];
    expect(() => validateProject(duplicateSelection)).toThrow(
      "IDs must be unique",
    );
  });

  it("rejects invalid dates and backwards update timestamps", () => {
    expect(() =>
      validateProject({ ...project(), createdAt: "2024-02-30T10:00:00Z" }),
    ).toThrow("calendar date");
    expect(() =>
      validateProject({ ...project(), createdAt: "2024-01-01T10:00:00" }),
    ).toThrow("timezone");
    expect(() =>
      validateProject({ ...project(), updatedAt: "2000-01-01T10:00:00Z" }),
    ).toThrow("precedes");
  });
});

describe("media and duration validation", () => {
  it("preserves metadata and source URIs through JSON serialization", () => {
    const original = asset();
    const restored = validateMediaAsset(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
    restored.metadata["openfilm.camera.test"] = { original: false };
    expect(original.metadata["openfilm.camera.test"]).toEqual({
      original: true,
    });
    expect(restored.uri).toBe("file:///original.mp4");
  });

  it.each([-1, 0, NaN, Infinity, "20"])(
    "rejects invalid asset duration %s",
    (duration) => {
      expect(() => validateMediaAsset({ ...asset(), duration })).toThrow(
        "asset.duration",
      );
    },
  );

  it("rejects invalid media bounds and unsupported metadata values", () => {
    expect(() => validateMediaAsset({ ...asset(), rating: 6 })).toThrow(
      "rating",
    );
    expect(() =>
      validateMediaAsset({ ...asset(), capturedAtConfidence: 1.1 }),
    ).toThrow("capturedAtConfidence");
    expect(() =>
      validateMediaAsset({ ...asset(), gps: { latitude: 91, longitude: 0 } }),
    ).toThrow("latitude");
    expect(() =>
      validateMediaAsset({
        ...asset(),
        dimensions: { width: 1.5, height: 10 },
      }),
    ).toThrow("positive integer");
    expect(() =>
      validateMediaAsset({ ...asset(), metadata: { invalid: () => true } }),
    ).toThrow("JSON-compatible");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => validateMediaAsset({ ...asset(), metadata: cycle })).toThrow(
      "cyclic",
    );
    const sparse: unknown[] = [];
    sparse.length = 2;
    expect(() =>
      validateMediaAsset({ ...asset(), metadata: { sparse } }),
    ).toThrow("sparse arrays");
  });

  it("rejects inconsistent story duration bounds and unsupported constraints", () => {
    expect(() =>
      validateStory({
        id: "s",
        title: "S",
        targetDuration: 11,
        maxDuration: 10,
        beats: [],
      }),
    ).toThrow("exceeds maximum");
    expect(() =>
      validateStory({
        id: "s",
        title: "S",
        beats: [{ id: "b", title: "B", minDuration: 6, maxDuration: 5 }],
      }),
    ).toThrow("minimum duration");
    expect(() =>
      validateStory({
        id: "s",
        title: "S",
        beats: [{ id: "b", title: "B", minDuration: 6, targetDuration: 5 }],
      }),
    ).toThrow("duration bounds");
    expect(() =>
      validateStory({
        id: "s",
        title: "S",
        beats: [{ id: "b", title: "B", constraints: [{ type: "unknown" }] }],
      }),
    ).toThrow("constraints[0].type");
  });

  it("rejects invalid trims, overflowing clips, duplicate clip IDs, and speed zero", () => {
    const value = project().timelines[0]!;
    const clip = value.tracks[0]!.clips[0]!;
    clip.sourceOut = clip.sourceIn;
    expect(() => validateComposition(value)).toThrow("source out");
    clip.sourceOut = 11;
    clip.timelineStart = 1;
    expect(() => validateComposition(value)).toThrow("extends beyond");
    clip.timelineStart = 0;
    clip.transform = { speed: 0 };
    expect(() => validateComposition(value)).toThrow("speed");
    clip.transform = { speed: 1 };
    value.tracks.push({ id: "audio", type: "audio", clips: [{ ...clip }] });
    expect(() => validateComposition(value)).toThrow("duplicate clip ID");
  });

  it("accepts an empty composition and validates observable job progress", () => {
    expect(
      validateComposition({ id: "c", storyId: "s", duration: 0, tracks: [] })
        .duration,
    ).toBe(0);
    expect(
      validateJob({ id: "j", type: "import", status: "running", progress: 0.5 })
        .progress,
    ).toBe(0.5);
    expect(() =>
      validateJob({
        id: "j",
        type: "import",
        status: "running",
        progress: 1.1,
      }),
    ).toThrow("progress");
  });
});
