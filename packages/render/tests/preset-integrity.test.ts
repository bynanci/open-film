// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { createPresetSnapshot } from "@openfilm/application";
import { filmLookFilters } from "../src/look-filters.js";
import { FFmpegRenderer } from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
it("verifies source-specific snapshot bytes before generating any FFmpeg filter", () => {
  const p = presetPackage(),
    snapshot = createPresetSnapshot<"film-look">(
      p as never,
      p.entries[0] as never,
    ),
    look = {
      version: 2 as const,
      preset: "local" as const,
      strength: 0.5,
      snapshot,
    };
  expect(filmLookFilters(look).join(":")).toContain("colorchannelmixer");
  const corrupt = structuredClone(look);
  corrupt.snapshot.recipe.defaultStrength = 0.2;
  expect(() => filmLookFilters(corrupt)).toThrow(/hash|integrity/);
  corrupt.strength = 0;
  expect(() => filmLookFilters(corrupt)).toThrow(/hash|integrity/);
});
it("rejects forged title provenance before reading a render source or font", async () => {
  const p = presetPackage(),
    snapshot = createPresetSnapshot<"title">(p as never, p.entries[1] as never);
  snapshot.provenance.author = "Changed";
  await expect(
    new FFmpegRenderer().render(
      {
        id: "cut",
        storyId: "s",
        duration: 1,
        tracks: [
          {
            id: "v",
            type: "video",
            clips: [
              {
                id: "c",
                assetId: "missing",
                timelineStart: 0,
                timelineDuration: 1,
                title: "記憶",
                titleStyle: snapshot.recipe,
                titlePresetSnapshot: snapshot,
              },
            ],
          },
        ],
      },
      [],
      "/tmp/preset-must-not-render.mp4",
    ),
  ).rejects.toThrow(/hash|integrity/);
});
