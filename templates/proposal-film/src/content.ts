import { ApplicationError, type ProjectContentLocale } from "@openfilm/core";

export const PROPOSAL_BEAT_KEYS = [
  "proposal.coldOpen",
  "proposal.beginning",
  "proposal.ordinaryDays",
  "proposal.adventures",
  "proposal.growingTogether",
  "proposal.whyYou",
  "proposal.future",
  "proposal.buildUp",
  "proposal.ending",
] as const;

export type ProposalBeatKey = (typeof PROPOSAL_BEAT_KEYS)[number];
interface ProposalContent {
  name: string;
  description: string;
  defaultTitle: string;
  beats: Record<ProposalBeatKey, { title: string; intent: string }>;
}

/** Template-authored content, independent of desktop UI message catalogs. */
const content: Record<ProjectContentLocale, ProposalContent> = {
  "en-US": {
    name: "Proposal Film",
    description:
      "A chronological relationship film with a deliberate emotional arc and room for the final question.",
    defaultTitle: "Our Story",
    beats: {
      "proposal.coldOpen": {
        title: "Cold Open",
        intent: "A glimpse of the meaningful moment ahead.",
      },
      "proposal.beginning": {
        title: "Beginning",
        intent: "Where the relationship began.",
      },
      "proposal.ordinaryDays": {
        title: "Ordinary Days",
        intent: "The small routines that made a shared life.",
      },
      "proposal.adventures": {
        title: "Adventures",
        intent: "Explore the world and remember discoveries together.",
      },
      "proposal.growingTogether": {
        title: "Growing Together",
        intent: "Show how challenges became shared growth.",
      },
      "proposal.whyYou": {
        title: "Why You",
        intent:
          "The qualities and moments that make this person irreplaceable.",
      },
      "proposal.future": {
        title: "Future",
        intent: "Imagine the life still to come.",
      },
      "proposal.buildUp": {
        title: "Build-up",
        intent: "Let anticipation rise toward the proposal.",
      },
      "proposal.ending": {
        title: "Ending",
        intent: "Leave space for the question and the answer.",
      },
    },
  },
  "zh-TW": {
    name: "求婚影片",
    description: "依時間串起兩人的故事，讓情感逐步累積，為最後的提問留出空間。",
    defaultTitle: "我們的故事",
    beats: {
      "proposal.coldOpen": {
        title: "序幕",
        intent: "先瞥見即將到來的重要時刻。",
      },
      "proposal.beginning": {
        title: "相遇之初",
        intent: "回到這段關係開始的地方。",
      },
      "proposal.ordinaryDays": {
        title: "平凡日常",
        intent: "那些讓生活有了彼此的小小習慣。",
      },
      "proposal.adventures": {
        title: "一起冒險",
        intent: "重溫一起探索世界、發現新事物的回憶。",
      },
      "proposal.growingTogether": {
        title: "共同成長",
        intent: "記錄彼此如何一起面對挑戰、一起成長。",
      },
      "proposal.whyYou": {
        title: "為什麼是你",
        intent: "那些讓對方無可取代的特質與時刻。",
      },
      "proposal.future": {
        title: "我們的未來",
        intent: "想像接下來要一起走過的生活。",
      },
      "proposal.buildUp": {
        title: "心意漸明",
        intent: "讓期待逐漸累積，走向求婚的那一刻。",
      },
      "proposal.ending": {
        title: "最後的提問",
        intent: "為那個問題，以及對方的回答，留出空間。",
      },
    },
  },
  "ja-JP": {
    name: "プロポーズムービー",
    description:
      "二人の歩みを時間に沿ってたどり、気持ちを重ねながら、最後の問いかけへつなぐ映像。",
    defaultTitle: "二人の物語",
    beats: {
      "proposal.coldOpen": {
        title: "プロローグ",
        intent: "これから訪れる大切な瞬間を、少しだけ見せる。",
      },
      "proposal.beginning": {
        title: "出会い",
        intent: "二人の関係が始まった場所へ。",
      },
      "proposal.ordinaryDays": {
        title: "何気ない日々",
        intent: "二人の暮らしをつくった、小さな日常を振り返る。",
      },
      "proposal.adventures": {
        title: "一緒に冒険",
        intent: "一緒に世界を広げ、新しい発見をした思い出をたどる。",
      },
      "proposal.growingTogether": {
        title: "共に成長",
        intent: "困難を乗り越えながら、共に成長した歩みを映す。",
      },
      "proposal.whyYou": {
        title: "あなたを選ぶ理由",
        intent: "かけがえのない存在だと感じる、その人らしさや瞬間を集める。",
      },
      "proposal.future": {
        title: "これからの二人",
        intent: "これから一緒に歩む暮らしを思い描く。",
      },
      "proposal.buildUp": {
        title: "高まる想い",
        intent: "プロポーズの瞬間に向けて、期待を少しずつ高める。",
      },
      "proposal.ending": {
        title: "最後の問いかけ",
        intent: "大切な問いかけと、その答えを待つ時間を残す。",
      },
    },
  },
};

export function getProposalContent(
  locale: ProjectContentLocale = "en-US",
): ProposalContent {
  if (!Object.hasOwn(content, locale))
    throw new ApplicationError(
      "request.invalid",
      "Unsupported film content language.",
    );
  return structuredClone(content[locale]);
}

export function getProposalBeatText(key: string, locale: ProjectContentLocale) {
  const beats = getProposalContent(locale).beats;
  return Object.hasOwn(beats, key) ? beats[key as ProposalBeatKey] : undefined;
}
