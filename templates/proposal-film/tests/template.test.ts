import { describe, expect, it } from "vitest";
import { proposalTemplate } from "../src/index.js";

describe("external story template", () => {
  it("builds all nine beats with a bounded five-minute default and chronological candidate partition", () => {
    const assetIds = Array.from({ length: 18 }, (_, i) => `asset-${i}`);
    const story = proposalTemplate.create({ assetIds });
    expect(story.template).toBe("proposal-film");
    expect(story.beats).toHaveLength(9);
    expect(story.maxDuration).toBe(300);
    expect(story.targetDuration).toBe(270);
    expect(story.beats.flatMap((beat) => beat.candidateAssetIds)).toEqual(
      assetIds,
    );
    expect(
      story.beats.reduce((sum, beat) => sum + beat.targetDuration!, 0),
    ).toBeCloseTo(270);
  });
  it("scales the emotional arc to explicit shorter settings", () => {
    const story = proposalTemplate.create({
      title: "Our film",
      targetDuration: 60,
      maxDuration: 90,
    });
    expect(story.title).toBe("Our film");
    expect(
      story.beats.reduce((sum, beat) => sum + beat.targetDuration!, 0),
    ).toBeCloseTo(60);
    expect(() =>
      proposalTemplate.create({ targetDuration: 100, maxDuration: 90 }),
    ).toThrow("target no greater");
  });
});
