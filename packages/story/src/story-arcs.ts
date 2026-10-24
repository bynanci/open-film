import {
  ApplicationError,
  type MediaAsset,
  type ProjectContentLocale,
  type Story,
  type StoryBeat,
} from "@openfilm/core";
import type { TemplateBeatText } from "@openfilm/plugin-sdk";
import { genericStoryTitle } from "./content.js";

export const STORY_ARC_IDS = [
  "journey",
  "event-recap",
  "then-now",
  "portrait",
  "day-in-life",
  "letters",
  "collection",
  "custom-outline",
] as const;

export type StoryArcId = (typeof STORY_ARC_IDS)[number];

export interface StoryArcOptions {
  arc: StoryArcId;
  targetDuration?: number;
  maxDuration?: number;
  contentLocale?: ProjectContentLocale;
  /** One authored beat title per item, in the exact order supplied by the user. */
  customOutline?: string[];
}

interface PromptBeat {
  key: string;
  title: string;
  intent: string;
}

type ArcPrompts = Record<Exclude<StoryArcId, "custom-outline">, PromptBeat[]>;

const prompts: Record<ProjectContentLocale, ArcPrompts> = {
  "en-US": {
    journey: [
      {
        key: "departure",
        title: "Set out",
        intent: "Give the journey a beginning and a reason to move.",
      },
      {
        key: "along-the-way",
        title: "Along the way",
        intent: "Let details, changes, and pauses shape the passage.",
      },
      {
        key: "arrival",
        title: "Arrive",
        intent: "End at a place, thought, or feeling the journey has earned.",
      },
    ],
    "event-recap": [
      {
        key: "preparation",
        title: "Before it begins",
        intent: "Set the scene with observable preparation and anticipation.",
      },
      {
        key: "gathering",
        title: "Coming together",
        intent:
          "Show who or what is present, without assuming what anyone feels.",
      },
      {
        key: "highlight",
        title: "The defining moment",
        intent: "Give the event's central moment room to register.",
      },
      {
        key: "afterglow",
        title: "Afterglow",
        intent: "Close with what remains after the event.",
      },
    ],
    "then-now": [
      {
        key: "then",
        title: "Then",
        intent: "Establish the earlier point of reference.",
      },
      {
        key: "change",
        title: "What changed",
        intent:
          "Connect the two moments through details the author can verify.",
      },
      {
        key: "now",
        title: "Now",
        intent: "Return to the present and leave room for what comes next.",
      },
    ],
    portrait: [
      {
        key: "roots",
        title: "Where it begins",
        intent: "Introduce a person, place, or subject through chosen context.",
      },
      {
        key: "details",
        title: "The details",
        intent: "Build the portrait from specific moments and contrasts.",
      },
      {
        key: "reflection",
        title: "A closer reflection",
        intent: "End with the detail that best expresses the author's view.",
      },
    ],
    "day-in-life": [
      {
        key: "morning",
        title: "A beginning",
        intent: "Establish the time and setting when the source supports it.",
      },
      {
        key: "rhythm",
        title: "The everyday rhythm",
        intent: "Use repeated or contrasting moments to set a pace.",
      },
      {
        key: "turn",
        title: "A change of pace",
        intent: "Make a chosen interruption or change easy to notice.",
      },
      {
        key: "evening",
        title: "At day's end",
        intent: "Let the final moment settle without forcing a conclusion.",
      },
    ],
    letters: [
      {
        key: "opening-note",
        title: "An opening note",
        intent: "Name who or what this story is addressed to.",
      },
      {
        key: "what-to-say",
        title: "What I want to say",
        intent: "Develop the message in the author's own words.",
      },
      {
        key: "keep-this",
        title: "Keep this moment",
        intent: "Choose a memory that gives the message a concrete anchor.",
      },
      {
        key: "until-next-time",
        title: "Until next time",
        intent: "Close with an invitation, a wish, or an open ending.",
      },
    ],
    collection: [
      {
        key: "moments",
        title: "Moments",
        intent: "Open with a clear point of entry into the collection.",
      },
      {
        key: "connections",
        title: "What connects them",
        intent: "Arrange chosen memories around an authored connection.",
      },
      {
        key: "what-remains",
        title: "What remains",
        intent: "Close on the idea or image the author wants to keep.",
      },
    ],
  },
  "zh-TW": {
    journey: [
      {
        key: "departure",
        title: "出發",
        intent: "建立旅程的起點，以及繼續前行的理由。",
      },
      {
        key: "along-the-way",
        title: "沿途",
        intent: "用細節、變化與停留，慢慢帶出路上的過程。",
      },
      {
        key: "arrival",
        title: "抵達",
        intent: "以旅程累積出的地點、想法或感受作結。",
      },
    ],
    "event-recap": [
      {
        key: "preparation",
        title: "準備",
        intent: "以可核對的準備過程與期待交代場景。",
      },
      {
        key: "gathering",
        title: "相聚",
        intent: "呈現到場的人事物，不替任何人推定感受。",
      },
      {
        key: "highlight",
        title: "高潮",
        intent: "為活動中的核心時刻留出被看見的空間。",
      },
      {
        key: "afterglow",
        title: "餘韻",
        intent: "以活動結束後留下的片刻收尾。",
      },
    ],
    "then-now": [
      { key: "then", title: "當時", intent: "建立較早時刻的參照。" },
      {
        key: "change",
        title: "轉變",
        intent: "用作者能確認的細節連起前後兩個時刻。",
      },
      { key: "now", title: "現在", intent: "回到當下，為接下來留一點空間。" },
    ],
    portrait: [
      {
        key: "roots",
        title: "背景",
        intent: "從選定的脈絡介紹人物、地點或主題。",
      },
      {
        key: "details",
        title: "細節",
        intent: "以具體片刻與對照，逐步描繪這個故事。",
      },
      {
        key: "reflection",
        title: "回望",
        intent: "以最能表達作者觀點的細節作結。",
      },
    ],
    "day-in-life": [
      {
        key: "morning",
        title: "清晨",
        intent: "素材有明確依據時，再交代時間與場景。",
      },
      { key: "rhythm", title: "日常", intent: "用重複或對照的片刻建立節奏。" },
      {
        key: "turn",
        title: "轉折",
        intent: "讓作者選定的變化或插曲清楚可見。",
      },
      {
        key: "evening",
        title: "夜晚",
        intent: "讓最後一刻慢慢停留，不強迫得出結論。",
      },
    ],
    letters: [
      {
        key: "opening-note",
        title: "開場",
        intent: "說明這段故事想對誰或什麼說。",
      },
      {
        key: "what-to-say",
        title: "想說的話",
        intent: "用作者自己的文字逐步展開訊息。",
      },
      {
        key: "keep-this",
        title: "記得這一刻",
        intent: "選一段回憶，讓想說的話有具體依據。",
      },
      {
        key: "until-next-time",
        title: "留給以後",
        intent: "以邀請、祝願或開放式結尾收束。",
      },
    ],
    collection: [
      {
        key: "moments",
        title: "片刻",
        intent: "用明確的入口帶觀眾走進這組回憶。",
      },
      {
        key: "connections",
        title: "彼此呼應",
        intent: "圍繞作者寫下的連結排列不同片段。",
      },
      {
        key: "what-remains",
        title: "留下的事",
        intent: "以作者想留下的想法或畫面收尾。",
      },
    ],
  },
  "ja-JP": {
    journey: [
      {
        key: "departure",
        title: "出発",
        intent: "旅の始まりと、進み続ける理由を示します。",
      },
      {
        key: "along-the-way",
        title: "道の途中",
        intent: "細部や変化、立ち止まる時間で道のりを描きます。",
      },
      {
        key: "arrival",
        title: "到着",
        intent: "旅を経てたどり着いた場所や考えで結びます。",
      },
    ],
    "event-recap": [
      {
        key: "preparation",
        title: "始まる前",
        intent: "確認できる準備や期待から場面を作ります。",
      },
      {
        key: "gathering",
        title: "集まる時間",
        intent: "誰が何があったかを示し、感情を決めつけません。",
      },
      {
        key: "highlight",
        title: "大切な瞬間",
        intent: "イベントの中心となる瞬間を見届ける余白を作ります。",
      },
      {
        key: "afterglow",
        title: "余韻",
        intent: "終わった後に残るものを描いて結びます。",
      },
    ],
    "then-now": [
      {
        key: "then",
        title: "あの頃",
        intent: "以前の時点を参照できる形で示します。",
      },
      {
        key: "change",
        title: "変化",
        intent: "作者が確かめられる細部で二つの時点をつなぎます。",
      },
      {
        key: "now",
        title: "今",
        intent: "現在に戻り、この先の余白を残します。",
      },
    ],
    portrait: [
      {
        key: "roots",
        title: "背景",
        intent: "選んだ背景から人物や場所、題材を紹介します。",
      },
      {
        key: "details",
        title: "細部",
        intent: "具体的な瞬間や対比から肖像を描きます。",
      },
      {
        key: "reflection",
        title: "振り返り",
        intent: "作者の視点を最もよく表す細部で結びます。",
      },
    ],
    "day-in-life": [
      {
        key: "morning",
        title: "朝",
        intent: "素材に根拠があるときに時間や場所を示します。",
      },
      {
        key: "rhythm",
        title: "日々のリズム",
        intent: "繰り返しや対比で流れを作ります。",
      },
      {
        key: "turn",
        title: "変化",
        intent: "作者が選んだ変化を見つけやすくします。",
      },
      {
        key: "evening",
        title: "一日の終わり",
        intent: "結論を押しつけず、最後の瞬間を残します。",
      },
    ],
    letters: [
      {
        key: "opening-note",
        title: "はじめに",
        intent: "誰に、または何に向けた物語かを示します。",
      },
      {
        key: "what-to-say",
        title: "伝えたいこと",
        intent: "作者自身の言葉でメッセージを展開します。",
      },
      {
        key: "keep-this",
        title: "覚えておきたい瞬間",
        intent: "言葉を支える具体的な思い出を選びます。",
      },
      {
        key: "until-next-time",
        title: "またいつか",
        intent: "誘い、願い、または開かれた結びで終えます。",
      },
    ],
    collection: [
      {
        key: "moments",
        title: "瞬間",
        intent: "コレクションへのわかりやすい入口を作ります。",
      },
      {
        key: "connections",
        title: "つながり",
        intent: "作者が記したつながりに沿って思い出を並べます。",
      },
      {
        key: "what-remains",
        title: "残るもの",
        intent: "残しておきたい考えや画で結びます。",
      },
    ],
  },
};

export function storyArcBeatText(
  templateId: string | undefined,
  templateBeatKey: string,
  locale: ProjectContentLocale,
): TemplateBeatText | undefined {
  if (
    !templateId ||
    !isStoryArcId(templateId) ||
    templateId === "custom-outline"
  )
    return undefined;
  const prefix = `arc.${templateId}.`;
  if (!templateBeatKey.startsWith(prefix)) return undefined;
  const prompt = prompts[locale][templateId].find(
    (entry) => entry.key === templateBeatKey.slice(prefix.length),
  );
  return prompt ? { title: prompt.title, intent: prompt.intent } : undefined;
}

function invalid(message: string): never {
  throw new ApplicationError("story.invalid", message);
}

function isStoryArcId(value: unknown): value is StoryArcId {
  return STORY_ARC_IDS.includes(value as StoryArcId);
}

function captureDate(asset: MediaAsset): number {
  const capturedAt = asset.capturedAt ? Date.parse(asset.capturedAt) : NaN;
  return Number.isFinite(capturedAt) ? capturedAt : Infinity;
}

function orderedCandidates(assets: MediaAsset[]): MediaAsset[] {
  if (!Array.isArray(assets) || assets.length > 2000)
    invalid("A story can use at most 2000 media candidates.");
  const seen = new Set<string>();
  for (const asset of assets) {
    if (
      !asset ||
      typeof asset.id !== "string" ||
      !asset.id.trim() ||
      !asset.state ||
      typeof asset.state !== "object"
    )
      invalid("Story candidates need valid IDs and selection state.");
    if (seen.has(asset.id)) invalid(`Duplicate media ID ${asset.id}.`);
    seen.add(asset.id);
  }
  return assets
    .filter((asset) => !asset.state.rejected)
    .sort((left, right) => {
      const a = captureDate(left);
      const b = captureDate(right);
      return a !== b
        ? a < b
          ? -1
          : 1
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0;
    });
}

function validateDurations(options: StoryArcOptions, sourceCount: number) {
  const targetDuration =
    options.targetDuration ??
    Math.min(sourceCount * 4 || 4, options.maxDuration ?? Infinity);
  const maxDuration = options.maxDuration;
  if (!Number.isFinite(targetDuration) || targetDuration <= 0)
    invalid("targetDuration must be a finite positive number of seconds.");
  if (
    maxDuration !== undefined &&
    (!Number.isFinite(maxDuration) || maxDuration <= 0)
  )
    invalid("maxDuration must be a finite positive number of seconds.");
  if (maxDuration !== undefined && targetDuration > maxDuration)
    invalid("The target duration exceeds the maximum.");
  return { targetDuration, maxDuration };
}

function allocateCandidates(
  candidates: MediaAsset[],
  beatCount: number,
): string[][] {
  const allocation = Array.from({ length: beatCount }, () => [] as string[]);
  if (candidates.length >= beatCount) {
    for (let index = 0; index < beatCount; index++) {
      const start = Math.floor((index * candidates.length) / beatCount);
      const end = Math.floor(((index + 1) * candidates.length) / beatCount);
      allocation[index] = candidates.slice(start, end).map((asset) => asset.id);
    }
    return allocation;
  }
  candidates.forEach((asset, index) => {
    const beatIndex =
      candidates.length === 1
        ? 0
        : Math.round((index * (beatCount - 1)) / (candidates.length - 1));
    allocation[beatIndex]!.push(asset.id);
  });
  return allocation;
}

/**
 * Creates a local writing starter. Arc text is editorial guidance, not a claim
 * about source media; graph order remains the user's canonical arrangement.
 */
export function createStoryArc(
  title: string,
  assets: MediaAsset[],
  options: StoryArcOptions,
): Story {
  if (typeof title !== "string") invalid("Story title must be text.");
  if (!options || !isStoryArcId(options.arc))
    invalid("Choose a supported story structure.");
  if (
    options.arc === "custom-outline" &&
    (!Array.isArray(options.customOutline) || options.customOutline.length < 1)
  )
    invalid("Enter at least one beat in the custom outline.");
  if (options.arc !== "custom-outline" && options.customOutline !== undefined)
    invalid("A custom outline can only be used with the custom structure.");

  const outline =
    options.arc === "custom-outline" ? options.customOutline! : undefined;
  if (
    outline &&
    (outline.length > 30 ||
      outline.some(
        (heading) =>
          typeof heading !== "string" ||
          !heading.trim() ||
          [...heading].length > 300,
      ))
  )
    invalid(
      "A custom outline needs 1–30 non-empty beat titles of at most 300 characters each.",
    );

  const candidates = orderedCandidates(assets);
  if (!candidates.length)
    throw new ApplicationError(
      "story.mediaRequired",
      "Import eligible media before creating a story.",
    );
  const { targetDuration, maxDuration } = validateDurations(
    options,
    candidates.length,
  );
  const locale = options.contentLocale ?? "en-US";
  const definitions =
    options.arc === "custom-outline"
      ? outline!.map((heading, index): PromptBeat => ({
          key: `custom-${index + 1}`,
          title: heading.trim(),
          intent: "",
        }))
      : prompts[locale][options.arc];
  const assetIds = allocateCandidates(candidates, definitions.length);
  const totalWeight = definitions.length;
  const id = globalThis.crypto.randomUUID();
  const beats: StoryBeat[] = definitions.map((prompt, index) => {
    const custom = options.arc === "custom-outline";
    const beat: StoryBeat = {
      id: `${id}:beat:${index + 1}`,
      title: prompt.title,
      ...(prompt.intent
        ? { intent: prompt.intent, intentSource: "template" as const }
        : {}),
      ...(custom
        ? { titleSource: "user" as const }
        : {
            templateBeatKey: `arc.${options.arc}.${prompt.key}`,
            titleSource: "template" as const,
          }),
      targetDuration: targetDuration / totalWeight,
      minDuration: 0,
      candidateAssetIds: assetIds[index],
    };
    return beat;
  });
  return {
    id,
    title: title.trim() || genericStoryTitle(locale),
    template: options.arc,
    targetDuration,
    ...(maxDuration !== undefined ? { maxDuration } : {}),
    beats,
  };
}
