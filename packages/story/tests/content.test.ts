import { describe, expect, it } from "vitest";
import {
  createProject,
  PROJECT_CONTENT_LOCALES,
  type MediaAsset,
  type StoryBeat,
} from "@openfilm/core";
import {
  proposalTemplate,
  getProposalContent,
  PROPOSAL_BEAT_KEYS,
} from "@openfilm/template-proposal";
import {
  createStory,
  genericBeatText,
  localizeProjectContent,
  preserveUserBeatText,
  resolveFilmSettings,
  resolveProjectContentLocale,
} from "../src/index.js";

describe("film setup defaults", () => {
  it("resolves external template defaults before importing or creating a story", () => {
    expect(resolveFilmSettings()).toEqual({
      templateId: "blank",
      targetDuration: 120,
      maxDuration: 180,
    });
    expect(
      resolveFilmSettings({ templateId: "proposal-film" }, [proposalTemplate]),
    ).toEqual({
      templateId: "proposal-film",
      targetDuration: 270,
      maxDuration: 300,
    });
    expect(
      resolveFilmSettings({ templateId: "proposal-film", maxDuration: 60 }, [
        proposalTemplate,
      ]),
    ).toEqual({
      templateId: "proposal-film",
      targetDuration: 60,
      maxDuration: 60,
    });
    expect(
      resolveFilmSettings(
        { templateId: "proposal-film", targetDuration: 20, maxDuration: 35 },
        [proposalTemplate],
      ),
    ).toEqual({
      templateId: "proposal-film",
      targetDuration: 20,
      maxDuration: 35,
    });
  });

  it("rejects unknown templates and inconsistent duration bounds with semantic errors", () => {
    expect(() => resolveFilmSettings({ templateId: "not-installed" })).toThrow(
      expect.objectContaining({ code: "story.invalid" }),
    );
    expect(() =>
      resolveFilmSettings({ targetDuration: 20, maxDuration: 10 }),
    ).toThrow(expect.objectContaining({ code: "story.invalid" }));
    expect(() => resolveProjectContentLocale("en-XA")).toThrow(
      expect.objectContaining({ code: "request.invalid" }),
    );
    expect(resolveProjectContentLocale()).toBe("en-US");
  });
});

describe("localized default content", () => {
  it("publishes distinct English, Traditional Chinese and Japanese Proposal defaults", () => {
    expect(
      PROJECT_CONTENT_LOCALES.map(
        (locale) => getProposalContent(locale).beats["proposal.coldOpen"].title,
      ),
    ).toEqual(["Cold Open", "序幕", "プロローグ"]);
    expect(
      PROJECT_CONTENT_LOCALES.map(
        (locale) => getProposalContent(locale).defaultTitle,
      ),
    ).toEqual(["Our Story", "我們的故事", "二人の物語"]);
  });

  const assets: MediaAsset[] = Array.from({ length: 3 }, (_, index) => ({
    id: `a${index}`,
    uri: `file:///photo-${index}.jpg`,
    name: `Photo ${index}`,
    mediaType: "image",
    tags: [],
    state: {},
    metadata: {},
  }));

  it.each(PROJECT_CONTENT_LOCALES)(
    "creates generic and external template content in %s with stable keys",
    (locale) => {
      const story = createStory("我的片名 / 私の映画", assets, {
        contentLocale: locale,
        targetDuration: 12,
        maxDuration: 15,
      });
      expect(story.title).toBe("我的片名 / 私の映画");
      expect(story.beats.map((beat) => beat.templateBeatKey)).toEqual([
        "story.opening",
        "story.development",
        "story.resolution",
      ]);
      expect(story.beats[0]).toMatchObject({
        title: genericBeatText("story.opening", locale)!.title,
        titleSource: "template",
      });
      expect(story.beats.flatMap((beat) => beat.candidateAssetIds)).toEqual(
        assets.map((asset) => asset.id),
      );
      const proposal = createStory("", assets, {
        template: proposalTemplate,
        contentLocale: locale,
      });
      expect(proposal.title).toBe(getProposalContent(locale).defaultTitle);
      expect(proposal.beats.map((beat) => beat.templateBeatKey)).toEqual(
        PROPOSAL_BEAT_KEYS,
      );
      expect(
        proposal.beats.map((beat) => ({
          title: beat.title,
          intent: beat.intent,
        })),
      ).toEqual(
        PROPOSAL_BEAT_KEYS.map((key) => getProposalContent(locale).beats[key]),
      );
      expect(
        proposal.beats.every(
          (beat) =>
            beat.titleSource === "template" && beat.intentSource === "template",
        ),
      ).toBe(true);
      expect(proposal.targetDuration).toBe(270);
      expect(proposal.maxDuration).toBe(300);
      expect(
        proposal.beats.reduce((sum, beat) => sum + beat.targetDuration!, 0),
      ).toBeCloseTo(270);
    },
  );

  it("keeps one- and two-beat generic identities meaningful", () => {
    expect(
      createStory("", assets.slice(0, 1), { contentLocale: "ja-JP" }).beats[0],
    ).toMatchObject({ templateBeatKey: "story.sequence", title: "シーン" });
    expect(
      createStory("", assets.slice(0, 2), { contentLocale: "zh-TW" }).beats.map(
        (beat) => beat.templateBeatKey,
      ),
    ).toEqual(["story.opening", "story.resolution"]);
  });
});

describe("authorship preservation", () => {
  function beat(): StoryBeat {
    return {
      id: "b",
      title: "Cold Open",
      intent: "Generated intent",
      templateBeatKey: "proposal.coldOpen",
      titleSource: "template",
      intentSource: "template",
      targetDuration: 4,
    };
  }

  it("marks only changed text and retains ownership on duration-only form submission", () => {
    const previous = beat();
    expect(
      preserveUserBeatText(previous, { ...previous, targetDuration: 7 }),
    ).toMatchObject({ titleSource: "template", intentSource: "template" });
    expect(
      preserveUserBeatText(previous, {
        ...previous,
        title: "台北での思い出 #1 & 2",
      }),
    ).toMatchObject({ titleSource: "user", intentSource: "template" });
    expect(
      preserveUserBeatText(previous, { ...previous, intent: undefined }),
    ).toMatchObject({ titleSource: "template", intentSource: "user" });
    expect(previous).toEqual(beat());
  });

  it("does not accept client attempts to relabel legacy/user text or invent template keys", () => {
    const previous: StoryBeat = {
      id: "legacy",
      title: "Cold Open",
      intent: "My intent",
    };
    const result = preserveUserBeatText(previous, {
      ...previous,
      templateBeatKey: "proposal.coldOpen",
      titleSource: "template",
      intentSource: "template",
    });
    expect(result).toEqual(previous);
    const authored = { ...beat(), titleSource: "user" as const };
    expect(
      preserveUserBeatText(authored, {
        ...authored,
        titleSource: "template",
        templateBeatKey: "proposal.ending",
      }),
    ).toMatchObject({
      titleSource: "user",
      templateBeatKey: "proposal.coldOpen",
    });
    expect(preserveUserBeatText(undefined, beat())).toMatchObject({
      titleSource: "user",
      intentSource: "user",
    });
    expect(
      preserveUserBeatText(undefined, beat()).templateBeatKey,
    ).toBeUndefined();
  });

  it("changes only known template-owned fields through three content languages", () => {
    const project = createProject("電影 & 映画 #1");
    const story = proposalTemplate.create({
      title: "Our authored story",
      assetIds: ["a", "b", "c"],
      targetDuration: 18,
      maxDuration: 30,
    });
    story.beats[0] = preserveUserBeatText(story.beats[0], {
      ...story.beats[0]!,
      title: "My first hello / 初めて",
    });
    story.beats[1] = preserveUserBeatText(story.beats[1], {
      ...story.beats[1]!,
      intent: "我們自己的句子",
    });
    story.beats[2] = preserveUserBeatText(story.beats[2], {
      ...story.beats[2]!,
      intent: undefined,
    });
    story.beats.push({
      id: "legacy",
      title: "Cold Open",
      intent: "Where the relationship began.",
    });
    story.beats.push({
      id: "unknown-key",
      title: "Future version text",
      intent: "Keep",
      templateBeatKey: "proposal.future-version",
      titleSource: "template",
      intentSource: "template",
    });
    project.stories = [
      story,
      {
        id: "unknown-template",
        title: "Plugin story",
        template: "not-installed",
        beats: [beat()],
      },
    ];
    project.timelines = [
      {
        id: "cut",
        storyId: story.id,
        duration: 4,
        tracks: [
          {
            id: "visual",
            type: "video",
            clips: [
              {
                id: "clip",
                assetId: "a",
                beatId: story.beats[0]!.id,
                timelineStart: 0,
                timelineDuration: 4,
                locked: true,
                transform: { scale: 1.2, volume: 0 },
              },
            ],
          },
        ],
      },
    ];
    const original = structuredClone(project);
    let translated = project;
    for (const locale of ["zh-TW", "ja-JP", "en-US"] as const) {
      translated = localizeProjectContent(translated, locale, [
        proposalTemplate,
      ]);
      const beats = translated.stories[0]!.beats;
      expect(translated.projectContentLocale).toBe(locale);
      expect(translated.title).toBe(project.title);
      expect(translated.stories[0]!.title).toBe(story.title);
      expect(beats[0]!.title).toBe("My first hello / 初めて");
      expect(beats[0]!.intent).toBe(
        getProposalContent(locale).beats["proposal.coldOpen"].intent,
      );
      expect(beats[1]!.intent).toBe("我們自己的句子");
      expect(beats[1]!.title).toBe(
        getProposalContent(locale).beats["proposal.beginning"].title,
      );
      expect(beats[2]!.intent).toBeUndefined();
      expect(beats[3]!.title).toBe(
        getProposalContent(locale).beats["proposal.adventures"].title,
      );
      expect(beats.slice(9)).toEqual(story.beats.slice(9));
      expect(translated.stories[1]).toEqual(project.stories[1]);
      expect(translated.timelines).toEqual(project.timelines);
      expect(
        beats.map(({ title: _title, intent: _intent, ...rest }) => rest),
      ).toEqual(
        story.beats.map(({ title: _title, intent: _intent, ...rest }) => rest),
      );
    }
    expect(project).toEqual(original);
  });
});
