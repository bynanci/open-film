import { describe, expect, it } from "vitest";
import { applyTimelineCommand, type EditorDocument } from "../src/index.js";

function document(): EditorDocument {
  return {
    story: {
      id: "story",
      title: "User story",
      beats: [
        {
          id: "beat",
          title: "Opening",
          intent: "A generated introduction",
          templateBeatKey: "story.opening",
          titleSource: "template",
          intentSource: "template",
          targetDuration: 4,
        },
      ],
    },
    composition: { id: "cut", storyId: "story", duration: 0, tracks: [] },
  };
}

describe("beat editing text ownership", () => {
  it("preserves generated ownership when the inspector resubmits unchanged text with a duration edit", () => {
    const before = document();
    const next = applyTimelineCommand(before, [], {
      type: "beat",
      beatId: "beat",
      patch: {
        title: "Opening",
        intent: "A generated introduction",
        targetDuration: 6,
      },
    });
    expect(next.story.beats[0]).toMatchObject({
      titleSource: "template",
      intentSource: "template",
      targetDuration: 6,
    });
    expect(before.story.beats[0]!.targetDuration).toBe(4);
  });

  it("marks only the changed text as authored and preserves stable identity", () => {
    const before = document();
    const next = applyTimelineCommand(before, [], {
      type: "beat",
      beatId: "beat",
      patch: { title: "東京の思い出" },
    });
    expect(next.story.beats[0]).toMatchObject({
      title: "東京の思い出",
      titleSource: "user",
      intentSource: "template",
      templateBeatKey: "story.opening",
    });
    expect(before.story.beats[0]!.titleSource).toBe("template");
  });

  it("remembers that deleting an intent was a user edit", () => {
    const next = applyTimelineCommand(document(), [], {
      type: "beat",
      beatId: "beat",
      patch: { intent: "" },
    });
    expect(next.story.beats[0]).toMatchObject({
      titleSource: "template",
      intentSource: "user",
    });
    expect(next.story.beats[0]).not.toHaveProperty("intent");
  });
});
