import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("named project versions", () => {
  it("exports a validator for the versioned snapshot record", () => {
    expect(core.validateProjectVersionRecord).toBeTypeOf("function");
  });

  it("validates immutable snapshot hashes and path-free source references", () => {
    const record: core.ProjectVersionRecord = {
      version: 1,
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "project-one",
      name: "First cut",
      createdAt: "2026-10-20T12:00:00.000Z",
      requestId: "00000000-0000-4000-8000-000000000002",
      projectRevision: "a".repeat(64),
      projectHash: "b".repeat(64),
      catalogHash: "c".repeat(64),
      catalogSchemaVersion: 5,
      softwareVersion: "0.1.0",
      sourceReferences: [
        {
          assetId: "asset-one",
          sha256: "d".repeat(64),
          sizeBytes: 1024,
          mediaType: "image",
          kind: "external",
        },
      ],
    };
    expect(core.validateProjectVersionRecord(record)).toEqual(record);
    expect(() =>
      core.validateProjectVersionRecord({
        ...record,
        localPath: "/private/photo.jpg",
      }),
    ).toThrow("unknown field");
    expect(() =>
      core.validateProjectVersionRecord({
        ...record,
        sourceReferences: [
          ...record.sourceReferences,
          { ...record.sourceReferences[0]!, assetId: "asset-one" },
        ],
      }),
    ).toThrow("unique");
  });

  it("diffs saved story, caption, scene, template, audio and source identities deterministically", () => {
    const project = core.createProject("First cut");
    project.stories.push({
      id: "story-one",
      title: "A day",
      beats: [{ id: "beat-one", title: "Morning" }],
    });
    project.timelines.push({
      id: "composition-one",
      storyId: "story-one",
      duration: 8,
      tracks: [
        {
          id: "video-track",
          type: "video",
          clips: [
            {
              id: "photo-clip",
              assetId: "asset-one",
              beatId: "beat-one",
              timelineStart: 0,
              timelineDuration: 8,
            },
          ],
        },
        {
          id: "music-track",
          type: "music",
          clips: [
            {
              id: "music-clip",
              assetId: "asset-two",
              timelineStart: 0,
              timelineDuration: 8,
              audioAutomation: {
                version: 1,
                role: "music",
                points: [{ time: 0, gain: 1 }],
              },
            },
          ],
        },
      ],
      captionTracks: [
        {
          version: 1,
          id: "caption-track",
          name: "繁體中文",
          style: { version: 1, role: "subtitle" },
          cues: [
            {
              version: 1,
              id: "cue-one",
              startMs: 100,
              endMs: 900,
              text: "早安",
              source: { kind: "manual" },
              manualRevision: 0,
            },
          ],
        },
      ],
      graphicScenes: [
        {
          version: 1,
          id: "scene-one",
          name: "Opening",
          start: 0,
          duration: 8,
          zIndex: 0,
          nodes: [
            {
              id: "title-one",
              type: "text",
              text: "Morning",
              x: 0,
              y: 0,
              width: 800,
              height: 100,
              opacity: 1,
              zIndex: 0,
              start: 0,
              end: 8,
              fontSize: 48,
            },
          ],
        },
      ],
      graphicSceneTemplates: [
        {
          version: 1,
          sceneId: "scene-one",
          templateId: "conversation-card",
          data: { locale: "zh-TW", messages: [] },
        },
      ],
    });
    const after = structuredClone(project);
    after.title = "Second cut";
    after.stories[0]!.beats[0]!.title = "Sunrise";
    after.timelines[0]!.tracks[0]!.clips[0]!.timelineStart = 0.5;
    after.timelines[0]!.captionTracks![0]!.cues[0]!.text = "早安，世界";
    after.timelines[0]!.graphicScenes![0]!.nodes[0]!.x = 36;
    const afterTemplate = after.timelines[0]!.graphicSceneTemplates![0]!;
    if (afterTemplate.templateId === "conversation-card")
      afterTemplate.data.locale = "en-US";
    after.timelines[0]!.tracks[1]!.clips[0]!.audioAutomation!.points![0]!.gain = 0.6;
    const source = {
      assetId: "asset-one",
      sha256: "d".repeat(64),
      sizeBytes: 1024,
      mediaType: "image" as const,
      kind: "external" as const,
    };
    const changedSource = { ...source, sha256: "e".repeat(64) };
    const before = {
      versionId: "version-one",
      project,
      sourceReferences: [source],
    };
    const next = {
      versionId: "version-two",
      project: after,
      sourceReferences: [changedSource],
    };

    const diff = core.diffProjectVersions(before, next);
    expect(diff.entries.map((entry) => entry.category)).toEqual([
      "project",
      "story",
      "composition",
      "captions",
      "graphicScenes",
      "templates",
      "audio",
      "sources",
    ]);
    expect(core.diffProjectVersions(before, next)).toEqual(diff);
    expect(JSON.stringify(diff)).not.toContain("/private/");
  });
});
