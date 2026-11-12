// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import {
  assertSessionProjectState,
  type ProjectCloseObservation,
} from "../manual/silence-real-browser-state.js";

// Independent synthetic project JSON: no real-media fixture, app, browser or server.
const original = {
  schemaVersion: "1.2.0",
  id: "project-a",
  title: "Recorded review",
  createdAt: "2026-11-12T09:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  settings: { width: 160, height: 90, frameRate: 25 },
  mediaLibraries: [{ uri: "file:///voice.wav", contentHash: "source-sha" }],
  stories: [
    {
      id: "story",
      updatedAt: "nested-keep",
      beats: [{ selectedAssetIds: ["voice", "music"] }],
    },
  ],
  timelines: [
    {
      id: "timeline",
      tracks: [
        {
          clips: [
            { id: "a", sourceIn: 2 },
            { id: "b", sourceIn: 4 },
          ],
        },
      ],
    },
  ],
};
const originalText = JSON.stringify(original, null, 2) + "\n";
const savedAt = "2026-11-12T10:01:00.500Z";
const close: ProjectCloseObservation = {
  projectId: "project-a",
  kind: "http-project-close",
  status: 200,
  identityObservedAt: Date.parse("2026-11-12T10:00:59.900Z"),
  startedAt: Date.parse("2026-11-12T10:01:00.000Z"),
  finishedAt: Date.parse("2026-11-12T10:01:01.000Z"),
};
const changedText = (updatedAt: unknown = savedAt) =>
  JSON.stringify({ ...original, updatedAt });

it("accepts an unchanged project without a close and records its raw hashes", () => {
  const state = assertSessionProjectState(
    originalText,
    originalText,
    original.id,
    [],
  );
  expect(state.originalTextSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(state.currentTextSha256).toBe(state.originalTextSha256);
});

it.each([
  close,
  { ...close, kind: "owned-server-close", status: "closed" },
] satisfies ProjectCloseObservation[])(
  "allows only root updatedAt inside a successful $kind window",
  (observation) => {
    const state = assertSessionProjectState(
      originalText,
      changedText(),
      original.id,
      [observation],
    );
    expect(state.currentTextSha256).not.toBe(state.originalTextSha256);
  },
);

it.each([
  [
    "Composition clip value",
    (value: typeof original) => {
      value.timelines[0]!.tracks[0]!.clips[0]!.sourceIn = 3;
    },
  ],
  [
    "Composition clip order",
    (value: typeof original) => {
      value.timelines[0]!.tracks[0]!.clips.reverse();
    },
  ],
  [
    "Story",
    (value: typeof original) => {
      value.stories[0]!.id = "another-story";
    },
  ],
  [
    "settings",
    (value: typeof original) => {
      value.settings.frameRate = 30;
    },
  ],
  [
    "source URI",
    (value: typeof original) => {
      value.mediaLibraries[0]!.uri = "file:///another.wav";
    },
  ],
  [
    "source hash",
    (value: typeof original) => {
      value.mediaLibraries[0]!.contentHash = "changed";
    },
  ],
  [
    "selected IDs",
    (value: typeof original) => {
      value.stories[0]!.beats[0]!.selectedAssetIds[0] = "another";
    },
  ],
  [
    "selected ID order",
    (value: typeof original) => {
      value.stories[0]!.beats[0]!.selectedAssetIds.reverse();
    },
  ],
  [
    "nested updatedAt",
    (value: typeof original) => {
      value.stories[0]!.updatedAt = savedAt;
    },
  ],
  [
    "another root field",
    (value: typeof original) => {
      value.title = "Changed";
    },
  ],
  [
    "added root field",
    (value: typeof original) => {
      Object.assign(value, { unexpected: true });
    },
  ],
  [
    "removed root field",
    (value: typeof original) => {
      Reflect.deleteProperty(value, "settings");
    },
  ],
] as const)("rejects changed %s despite a valid close", (_name, mutate) => {
  const value = structuredClone(original);
  value.updatedAt = savedAt;
  mutate(value);
  expect(() =>
    assertSessionProjectState(
      originalText,
      JSON.stringify(value),
      original.id,
      [close],
    ),
  ).toThrow();
});

it.each([
  "not-a-time",
  "2026-11-12T10:01:00Z",
  "2026-11-12T11:01:00.500+01:00",
  "2026-02-30T10:01:00.500Z",
  "2026-11-12T10:01:00.500Z trailing",
  null,
  123,
])("rejects noncanonical root updatedAt %s", (value) => {
  expect(() =>
    assertSessionProjectState(originalText, changedText(value), original.id, [
      close,
    ]),
  ).toThrow();
});

it.each(["2026-11-12T10:00:59.999Z", "2026-11-12T10:01:01.001Z"])(
  "rejects root updatedAt outside the actual close window: %s",
  (value) => {
    expect(() =>
      assertSessionProjectState(originalText, changedText(value), original.id, [
        close,
      ]),
    ).toThrow();
  },
);

const invalidCloses = [
  [],
  [{ ...close, projectId: "project-b" }],
  [{ ...close, status: 409 }],
  [{ ...close, kind: "owned-server-close", status: 500 }],
  [{ ...close, finishedAt: close.startedAt - 1 }],
  [{ ...close, identityObservedAt: close.finishedAt + 1 }],
  [{ ...close, startedAt: Number.NaN }],
] satisfies ProjectCloseObservation[][];
it.each(invalidCloses.map((observations) => ({ observations })))(
  "rejects a timestamp change without a valid actual-project close: $observations",
  ({ observations }) => {
    expect(() =>
      assertSessionProjectState(
        originalText,
        changedText(),
        original.id,
        observations,
      ),
    ).toThrow();
  },
);

it("rejects a mismatched actual project identity even when bytes are unchanged", () => {
  expect(() =>
    assertSessionProjectState(originalText, originalText, "project-b", [close]),
  ).toThrow();
});

it("rejects an invalid original timestamp even when bytes are unchanged", () => {
  const text = changedText("invalid");
  expect(() =>
    assertSessionProjectState(text, text, original.id, [close]),
  ).toThrow();
});
