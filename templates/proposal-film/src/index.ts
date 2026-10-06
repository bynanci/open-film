import { ApplicationError, type Story } from "@openfilm/core";
import type { StoryTemplate } from "@openfilm/plugin-sdk";
import {
  getProposalBeatText,
  getProposalContent,
  PROPOSAL_BEAT_KEYS,
} from "./content.js";

export * from "./content.js";

const arc = [12, 33, 45, 55, 50, 50, 35, 15, 5] as const;
export const proposalFilmDefaults = {
  targetDuration: 270,
  maxDuration: 300,
} as const;

/** A real external template; no romantic vocabulary enters the generic engine. */
export const proposalTemplate: StoryTemplate = {
  id: "proposal-film",
  name: "Proposal Film",
  description:
    "A chronological relationship film with a deliberate emotional arc and room for the final question.",
  defaults: proposalFilmDefaults,
  getBeatText: getProposalBeatText,
  create(config): Story {
    const content = getProposalContent(config.contentLocale);
    const maxDuration = config.maxDuration ?? proposalFilmDefaults.maxDuration;
    const targetDuration =
      config.targetDuration ??
      Math.min(proposalFilmDefaults.targetDuration, maxDuration);
    if (
      !Number.isFinite(targetDuration) ||
      !Number.isFinite(maxDuration) ||
      targetDuration <= 0 ||
      maxDuration <= 0 ||
      targetDuration > maxDuration
    )
      throw new ApplicationError(
        "story.invalid",
        "Proposal Film needs positive target/max durations with target no greater than maximum.",
      );
    const id = globalThis.crypto.randomUUID();
    const assets = config.assetIds ?? [];
    const arcDuration = arc.reduce((sum, seconds) => sum + seconds, 0);
    return {
      id,
      title: config.title?.trim() || content.defaultTitle,
      template: "proposal-film",
      targetDuration,
      maxDuration,
      beats: PROPOSAL_BEAT_KEYS.map((key, index) => ({
        id: `${id}:beat:${index + 1}`,
        ...content.beats[key],
        templateBeatKey: key,
        titleSource: "template",
        intentSource: "template",
        targetDuration: (arc[index]! / arcDuration) * targetDuration,
        minDuration: 0,
        candidateAssetIds: assets.slice(
          Math.floor((index * assets.length) / arc.length),
          Math.floor(((index + 1) * assets.length) / arc.length),
        ),
      })),
    };
  },
};
