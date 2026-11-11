// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { exportTimeline } from "@openfilm/exporters";
import { compatibilityFixture } from "../helpers/storytelling-compat-fixtures.js";

describe("read-only Storytelling compatibility capsule", () => {
  it("pins the inspected producer and consumer contracts without granting authority", async () => {
    const module = await import("../../scripts/storytelling-compat.js").catch(
      () => ({ compatibility: undefined }),
    );
    expect(module.compatibility).toMatchObject({
      openfilm: "08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224",
      sdk: "b7fcf869d01727dcf408c457fdd42929dca80c7a",
      sdkVersion: "0.1.0-dev.0",
      exportSchema: "1.0.0",
      catalogSchema: 7,
      profile: "openfilm-finite-v1",
      executable: false,
    });
  });

  it("feeds the existing exporter without normalizing IDs, edits, ranges or clocks", () => {
    const fixture = compatibilityFixture();
    const before = structuredClone(fixture);
    fixture.composition.tracks[0]!.clips[0]!.transform = { scale: 1 };
    const output = JSON.parse(
      exportTimeline(
        "json",
        fixture.composition,
        fixture.assets,
        fixture.settings,
      ).content,
    );
    expect(output.composition).toEqual(fixture.composition);
    expect(output.assets).toEqual(fixture.assets);
    expect(output.settings).toEqual(fixture.settings);
    expect(
      output.composition.tracks[0].clips.map((c: { id: string }) => c.id),
    ).toEqual(["occurrence-z", "occurrence-a", "occurrence-m"]);
    delete fixture.composition.tracks[0]!.clips[0]!.transform;
    expect(fixture).toEqual(before);
  });
});
