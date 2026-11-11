// SPDX-License-Identifier: Apache-2.0
// Independently authored OpenFilm producer declarations; no SDK fixture is copied.
import type { Composition, MediaAsset, ProjectSettings } from "@openfilm/core";

export function compatibilityFixture() {
  const assets: MediaAsset[] = [
    {
      id: "capsule-video",
      uri: "file:///synthetic-never-opened.mp4",
      mediaType: "video",
      name: "Synthetic visual declaration",
      duration: 12,
      contentHash: "b".repeat(64),
      tags: ["synthetic"],
      state: { locked: true },
      metadata: { "capsule.provenance": "independent-openfilm-fixture" },
    },
    {
      id: "capsule-still",
      uri: "file:///synthetic-never-opened.png",
      mediaType: "image",
      name: "Synthetic still declaration",
      contentHash: "c".repeat(64),
      tags: [],
      state: {},
      metadata: {},
    },
  ];
  const composition: Composition = {
    id: "capsule-timeline",
    storyId: "capsule-story",
    duration: 3.75,
    tracks: [
      {
        id: "capsule-track",
        type: "video",
        locked: true,
        clips: [
          {
            id: "occurrence-z",
            assetId: assets[0]!.id,
            sourceIn: 1.25,
            sourceOut: 2.5,
            timelineStart: 0,
            timelineDuration: 1.25,
            locked: true,
          },
          {
            id: "occurrence-a",
            assetId: assets[1]!.id,
            timelineStart: 1.25,
            timelineDuration: 1.5,
          },
          {
            id: "occurrence-m",
            assetId: assets[0]!.id,
            sourceIn: 4,
            sourceOut: 5,
            timelineStart: 2.75,
            timelineDuration: 1,
          },
        ],
      },
    ],
  };
  const settings: ProjectSettings = {
    width: 320,
    height: 180,
    frameRate: 30000 / 1001,
    timebase: {
      version: 1,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: true,
    },
  };
  return { assets, composition, settings };
}

export function plannerRequest() {
  return JSON.stringify({
    schema_version: 1,
    brief: {
      schema_version: 1,
      brief_id: "capsule-proposal",
      intent: "Read-only independent visual proof",
      assets: [{ id: "capsule-video" }],
      manual_selected_asset_ids: ["capsule-video"],
      hard_constraints: [],
      preferences: { preferred_asset_ids: [] },
    },
    candidates: [
      {
        asset_id: "capsule-video",
        content_hash: "b".repeat(64),
        duration: { numerator: "12", denominator: "1" },
        source_range: {
          start: { numerator: "5", denominator: "4" },
          end: { numerator: "5", denominator: "2" },
        },
        score: 7,
      },
    ],
    max_duration: { numerator: "5", denominator: "1" },
    max_shots: 1,
  });
}

export function reviewContext() {
  return JSON.stringify({
    schema_version: 1,
    project_id: "capsule-project",
    target_revision: "synthetic-revision-1",
    host: {
      id: "filmcraft",
      version: "0.18.0",
      profile_id: "declarations-only",
      binary_sha256: "a".repeat(64),
      declared_capabilities: [
        "arbitrary-content-tick-rate",
        "external-reference",
        "single-video-track",
        "still-hold",
      ],
    },
    loss_choices: ["metadata_only_locks", "picture_only"],
  });
}
