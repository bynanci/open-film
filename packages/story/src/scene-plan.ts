import {
  ApplicationError,
  createId,
  validateStory,
  type MediaAsset,
  type ProjectContentLocale,
  type Story,
} from "@openfilm/core";
import { resolveProjectContentLocale } from "./content.js";

export interface SceneStoryOptions {
  groupBy: "category" | "chronology";
  targetDuration: number;
  maxDuration: number;
  contentLocale?: ProjectContentLocale;
  /** Explicit user-authored context, preserved verbatim in the first scene. */
  brief?: string;
}

type Position = "opening" | "development" | "closing" | "sequence";
interface SceneContent {
  unclassified: string;
  titles: Record<Position, string>;
  narration: Record<Position, (title: string) => string>;
  intent: Record<Position, string>;
  direction: Record<Position, string>;
  photo: string;
  video: string;
}

const content: Record<ProjectContentLocale, SceneContent> = {
  "en-US": {
    unclassified: "Unclassified memories",
    titles: {
      opening: "Opening",
      development: "The story unfolds",
      closing: "Closing",
      sequence: "A collection of memories",
    },
    narration: {
      opening: (title) =>
        `Begin with “${title}”: a place for the moments we choose to remember.`,
      development: (title) =>
        `“${title}” becomes another chapter, one memory at a time.`,
      closing: (title) =>
        `Close with “${title}”, and leave space for what comes next.`,
      sequence: (title) =>
        `“${title}”: the moments we choose to keep, brought into one story.`,
    },
    intent: {
      opening:
        "Introduce the collection and give the audience a point of entry.",
      development:
        "Connect these memories to the previous scene and build the story.",
      closing: "Return to the main thought and let the last memory settle.",
      sequence:
        "Give the selected memories a clear beginning, progression and ending.",
    },
    direction: {
      opening:
        "Choose a clear opening image, then introduce a contrasting detail. Start calmly.",
      development:
        "Alternate an overview with details where available. Keep the chronological connection clear.",
      closing:
        "Choose a final image that supports your closing thought. Allow it more breathing room.",
      sequence:
        "Choose an opening image, develop the sequence with contrasting details, and finish on a deliberate final image.",
    },
    photo:
      "Give photos enough time to read; vary emphasis by adjusting individual holds in Edit.",
    video:
      "Choose source moments with clear starts and endings; trim in Precision and review the original sound.",
  },
  "zh-TW": {
    unclassified: "未分類回憶",
    titles: {
      opening: "序幕",
      development: "故事展開",
      closing: "尾聲",
      sequence: "回憶片段",
    },
    narration: {
      opening: (title) =>
        `從「${title}」開始，把想記住的片刻，慢慢說成一段故事。`,
      development: (title) =>
        `來到「${title}」，一段回憶接著一段回憶，成為故事的下一章。`,
      closing: (title) =>
        `把「${title}」留在故事的最後，也為接下來的篇章留一點空間。`,
      sequence: (title) => `「${title}」，是想留下的片刻，也是這段故事的起點。`,
    },
    intent: {
      opening: "介紹這組回憶，讓觀眾有一個進入故事的起點。",
      development: "延續上一個場景，以這組回憶推進故事。",
      closing: "回到想傳達的心意，讓最後一段回憶慢慢落定。",
      sequence: "讓選取的回憶形成清楚的開場、發展與收尾。",
    },
    direction: {
      opening:
        "選一張適合交代場景的畫面開場，再接一個有對比的細節，節奏先放慢。",
      development: "素材允許時，交替使用整體與細節畫面，維持時間上的連貫。",
      closing: "選一張能呼應結尾心意的畫面，留出較充裕的停留時間。",
      sequence: "選定開場畫面，用不同細節推進，再以一張有意義的畫面收尾。",
    },
    photo: "讓照片保有足夠的閱讀時間；可在剪輯中調整每張停留長度，建立重點。",
    video: "選擇有清楚起訖的影片片段，在精準剪輯中修剪，並聽取原音確認。",
  },
  "ja-JP": {
    unclassified: "未分類の思い出",
    titles: {
      opening: "はじまり",
      development: "物語の展開",
      closing: "結び",
      sequence: "思い出のシーン",
    },
    narration: {
      opening: (title) =>
        `「${title}」から、残しておきたい瞬間をひとつの物語に。`,
      development: (title) =>
        `「${title}」。ひとつひとつの思い出が、次の章へとつながっていく。`,
      closing: (title) =>
        `最後に「${title}」を残して、これからの物語にも余白を。`,
      sequence: (title) =>
        `「${title}」。残しておきたい瞬間を、ひとつの物語に。`,
    },
    intent: {
      opening: "この思い出を紹介し、観客が物語に入るきっかけを作る。",
      development: "前のシーンとつなぎ、この思い出で物語を進める。",
      closing: "伝えたいことに戻り、最後の思い出に余韻を残す。",
      sequence: "選んだ思い出に、はじまり、展開、結びを持たせる。",
    },
    direction: {
      opening:
        "場面を伝える画面から始め、対照的な細部へつなぐ。最初は落ち着いたテンポで。",
      development: "素材に応じて全体と細部を交互に見せ、時間のつながりを保つ。",
      closing: "結びの言葉を支える画面を選び、少し長めに余韻を残す。",
      sequence:
        "最初の画面を選び、異なる細部で展開し、意図した最後の画面で結ぶ。",
    },
    photo:
      "写真を見渡せる時間を確保し、編集で各写真の長さを調整して強弱を付ける。",
    video:
      "始まりと終わりが明確な部分を選び、精密編集でトリミングして元の音を確認する。",
  },
};

function invalid(message: string): never {
  throw new ApplicationError("story.invalid", message);
}

function position(index: number, length: number): Position {
  return length === 1
    ? "sequence"
    : index === 0
      ? "opening"
      : index === length - 1
        ? "closing"
        : "development";
}

function capture(asset: MediaAsset): number {
  const timestamp = asset.capturedAt ? Date.parse(asset.capturedAt) : NaN;
  return Number.isFinite(timestamp) ? timestamp : Infinity;
}

/** Local, reviewable writing starters from explicit categories; no image-content inference. */
export function createSceneStory(
  title: string,
  assets: MediaAsset[],
  options: SceneStoryOptions,
): Story {
  if (typeof title !== "string" || !title.trim())
    invalid("Give the scene story a non-empty title.");
  if (!options || !["category", "chronology"].includes(options.groupBy))
    invalid("Choose category or chronology for scene grouping.");
  for (const [key, value] of Object.entries({
    targetDuration: options.targetDuration,
    maxDuration: options.maxDuration,
  }))
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      invalid(`${key} must be a finite positive number of seconds.`);
  if (options.targetDuration > options.maxDuration)
    invalid(
      "The target duration exceeds the maximum. Lower the target or increase the maximum.",
    );
  if (
    options.brief !== undefined &&
    (typeof options.brief !== "string" || [...options.brief].length > 8000)
  )
    invalid("The story brief must be text of at most 8000 characters.");
  const text = content[resolveProjectContentLocale(options.contentLocale)];
  if (!Array.isArray(assets)) invalid("Provide a list of media candidates.");
  if (assets.length > 2000)
    throw new ApplicationError(
      "story.scopeTooLarge",
      "A scene plan can use at most 2000 candidates. Narrow the media scope.",
    );
  const ids = new Set<string>();
  for (const asset of assets) {
    if (
      !asset ||
      typeof asset.id !== "string" ||
      !asset.id.trim() ||
      !Array.isArray(asset.tags) ||
      asset.tags.some((tag) => typeof tag !== "string") ||
      !asset.state ||
      typeof asset.state !== "object"
    )
      invalid("Scene candidates need valid IDs, tags and selection state.");
    if (ids.has(asset.id))
      invalid(
        `Duplicate media ID ${asset.id}. Repair the candidate list before planning.`,
      );
    ids.add(asset.id);
    if (asset.state.locked && asset.state.rejected)
      invalid(
        `Media ${asset.name} is both locked and rejected. Unreject or explicitly unlock it before planning.`,
      );
  }
  const available = assets
    .filter(
      (asset) =>
        (asset.mediaType === "image" || asset.mediaType === "video") &&
        !asset.state.rejected,
    )
    .sort((left, right) => {
      const a = capture(left),
        b = capture(right);
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
  if (!available.length)
    throw new ApplicationError(
      "story.mediaRequired",
      "Add an eligible photo or flat video before planning scenes.",
    );
  const groups: { title: string; assets: MediaAsset[] }[] = [];
  if (options.groupBy === "category") {
    // undefined is a distinct key from a category whose authored text happens to
    // match the localized fallback label.
    const categories = new Map<string | undefined, MediaAsset[]>();
    for (const asset of available) {
      const category = asset.tags.find((tag) => tag.trim());
      const group = categories.get(category) ?? [];
      group.push(asset);
      categories.set(category, group);
    }
    for (const [category, members] of categories)
      groups.push({ title: category ?? text.unclassified, assets: members });
  } else {
    const count = Math.min(available.length, 3);
    for (let index = 0; index < count; index++)
      groups.push({
        title: text.titles[position(index, count)],
        assets: available.slice(
          Math.floor((index * available.length) / count),
          Math.floor(((index + 1) * available.length) / count),
        ),
      });
  }
  if (groups.length > 30)
    throw new ApplicationError(
      "story.sceneLimit",
      "A scene plan supports at most 30 categories. Combine categories, narrow the scope, or choose chronology.",
      400,
      { limit: 30 },
    );
  // Every scene must be represented by playable media. Reserve one second when
  // the scene has a still or a long enough video; an exclusively short-video
  // scene can use its longest source. This does not require every candidate.
  const minima = groups.map((group) => {
    const capacity = group.assets.reduce(
      (maximum, asset) =>
        Math.max(
          maximum,
          asset.mediaType === "image"
            ? 1
            : Number.isFinite(asset.duration) && (asset.duration ?? 0) > 0
              ? Math.min(1, asset.duration!)
              : 0,
        ),
      0,
    );
    if (!capacity)
      invalid(
        `Scene ${group.title} has no usable video duration. Inspect the source, add a photo, or remove this category before planning.`,
      );
    return capacity;
  });
  // Compensate addition error before comparing decimal source timings. The
  // remaining tolerance scales with these durations and their operation count,
  // rather than letting a fixed epsilon swallow genuinely short tiny sources.
  let minimumTotal = 0;
  let compensation = 0;
  for (const minimum of minima) {
    const adjusted = minimum - compensation;
    const next = minimumTotal + adjusted;
    compensation = next - minimumTotal - adjusted;
    minimumTotal = next;
  }
  const roundingTolerance =
    Number.EPSILON *
    Math.max(options.targetDuration, minimumTotal) *
    (groups.length + 2);
  if (minimumTotal - options.targetDuration > roundingTolerance)
    throw new ApplicationError(
      "story.sceneTooShort",
      `These scenes need at least ${minimumTotal} seconds of playable media. Increase the target and maximum or combine categories.`,
      400,
      {
        minimum: Math.ceil(minimumTotal * 1000) / 1000,
      },
    );
  const weights = groups.map((_, index) =>
    groups.length < 3 || index === 0 || index === groups.length - 1 ? 1 : 2,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const extraDuration = Math.max(0, options.targetDuration - minimumTotal);
  let allocated = 0;
  const id = createId("scene-story");
  const beats = groups.map((group, index) => {
    const role = position(index, groups.length);
    let targetDuration =
      extraDuration === 0
        ? minima[index]!
        : index === groups.length - 1
          ? options.targetDuration - allocated
          : minima[index]! + extraDuration * (weights[index]! / totalWeight);
    if (
      targetDuration < minima[index]! &&
      minima[index]! - targetDuration <= roundingTolerance
    )
      targetDuration = minima[index]!;
    if (!Number.isFinite(targetDuration) || targetDuration < minima[index]!)
      invalid(
        "The target is too small to allocate a positive duration to each scene. Increase the target or reduce the scene count.",
      );
    allocated += targetDuration;
    const narration =
      text.narration[role](group.title) +
      (index === 0 && options.brief !== undefined && options.brief !== ""
        ? `\n\n${options.brief}`
        : "");
    const visualDirection = [
      text.direction[role],
      ...(group.assets.some((asset) => asset.mediaType === "image")
        ? [text.photo]
        : []),
      ...(group.assets.some((asset) => asset.mediaType === "video")
        ? [text.video]
        : []),
    ].join(" ");
    if ([...narration].length > 8000 || [...visualDirection].length > 8000)
      invalid(
        "A generated scene script exceeds 8000 characters. Shorten its category or brief before planning.",
      );
    return {
      id: `${id}:beat:${index + 1}`,
      title: group.title,
      intent: text.intent[role],
      script: { narration, visualDirection },
      targetDuration,
      minDuration: minima[index]!,
      candidateAssetIds: group.assets.map((asset) => asset.id),
      constraints: [{ type: "chronological" as const, enabled: true }],
    };
  });
  return validateStory(
    {
      id,
      title,
      targetDuration: options.targetDuration,
      maxDuration: options.maxDuration,
      beats,
    },
    { assetIds: ids },
  );
}
