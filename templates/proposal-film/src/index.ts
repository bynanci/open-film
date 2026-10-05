import type { Story } from "@openfilm/core";
import type { StoryTemplate } from "@openfilm/plugin-sdk";

const arc = [
  ["Cold Open", "A glimpse of the meaningful moment ahead.", 12],
  ["Beginning", "Where the relationship began.", 33],
  ["Ordinary Days", "The small routines that made a shared life.", 45],
  ["Adventures", "Explore the world and remember discoveries together.", 55],
  ["Growing Together", "Show how challenges became shared growth.", 50],
  [
    "Why You",
    "The qualities and moments that make this person irreplaceable.",
    50,
  ],
  ["Future", "Imagine the life still to come.", 35],
  ["Build-up", "Let anticipation rise toward the proposal.", 15],
  ["Ending", "Leave space for the question and the answer.", 5],
] as const;

/** A real external template; no romantic vocabulary enters the generic engine. */
export const proposalTemplate: StoryTemplate = {
  id: "proposal-film",
  name: "Proposal Film",
  description:
    "A chronological relationship film with a deliberate emotional arc and room for the final question.",
  create(config): Story {
    const maxDuration = config.maxDuration ?? 300;
    const targetDuration = config.targetDuration ?? Math.min(270, maxDuration);
    if (
      !Number.isFinite(targetDuration) ||
      !Number.isFinite(maxDuration) ||
      targetDuration <= 0 ||
      maxDuration <= 0 ||
      targetDuration > maxDuration
    )
      throw new Error(
        "Proposal Film needs positive target/max durations with target no greater than maximum.",
      );
    const id = globalThis.crypto.randomUUID();
    const assets = config.assetIds ?? [];
    const arcDuration = arc.reduce((sum, beat) => sum + beat[2], 0);
    return {
      id,
      title: config.title?.trim() || "Our Story",
      template: "proposal-film",
      targetDuration,
      maxDuration,
      beats: arc.map(([title, intent, seconds], index) => ({
        id: `${id}:beat:${index + 1}`,
        title,
        intent,
        targetDuration: (seconds / arcDuration) * targetDuration,
        minDuration: 0,
        candidateAssetIds: assets.slice(
          Math.floor((index * assets.length) / arc.length),
          Math.floor(((index + 1) * assets.length) / arc.length),
        ),
      })),
    };
  },
};
