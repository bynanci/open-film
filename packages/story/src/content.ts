import {
  PROJECT_CONTENT_LOCALES,
  ApplicationError,
  type FilmSettings,
  type OpenFilmProject,
  type ProjectContentLocale,
  type StoryBeat,
} from "@openfilm/core";
import type { StoryTemplate, TemplateBeatText } from "@openfilm/plugin-sdk";

export class StoryContentError extends ApplicationError {
  override name = "StoryContentError";

  constructor(
    code: "request.invalid" | "story.invalid",
    message: string,
    params?: Record<string, string | number>,
  ) {
    super(code, message, 400, params);
  }
}

/** Content locales are canonical persisted values; the UI resolver is separate. */
export function resolveProjectContentLocale(
  value?: unknown,
): ProjectContentLocale {
  if (value === undefined) return "en-US";
  if (PROJECT_CONTENT_LOCALES.includes(value as ProjectContentLocale))
    return value as ProjectContentLocale;
  throw new StoryContentError(
    "request.invalid",
    "Film content language must be en-US, zh-TW, or ja-JP.",
  );
}

const genericContent = {
  "en-US": {
    defaultTitle: "Untitled story",
    beats: {
      "story.opening": { title: "Opening" },
      "story.development": { title: "Development" },
      "story.resolution": { title: "Resolution" },
      "story.sequence": { title: "Sequence" },
    },
  },
  "zh-TW": {
    defaultTitle: "未命名故事",
    beats: {
      "story.opening": { title: "序幕" },
      "story.development": { title: "故事展開" },
      "story.resolution": { title: "尾聲" },
      "story.sequence": { title: "片段" },
    },
  },
  "ja-JP": {
    defaultTitle: "無題のストーリー",
    beats: {
      "story.opening": { title: "はじまり" },
      "story.development": { title: "展開" },
      "story.resolution": { title: "結び" },
      "story.sequence": { title: "シーン" },
    },
  },
} satisfies Record<
  ProjectContentLocale,
  {
    defaultTitle: string;
    beats: Record<string, TemplateBeatText>;
  }
>;

export function genericStoryTitle(locale?: ProjectContentLocale): string {
  return genericContent[resolveProjectContentLocale(locale)].defaultTitle;
}

export function genericBeatText(
  key: string,
  locale?: ProjectContentLocale,
): TemplateBeatText | undefined {
  const beats: Record<string, TemplateBeatText> =
    genericContent[resolveProjectContentLocale(locale)].beats;
  return Object.hasOwn(beats, key) ? { ...beats[key]! } : undefined;
}

/** Resolve creation defaults without creating a story or importing media. */
export function resolveFilmSettings(
  input: Partial<FilmSettings> = {},
  templates: readonly StoryTemplate[] = [],
): FilmSettings {
  const templateId = input.templateId ?? "blank";
  const template = templates.find((entry) => entry.id === templateId);
  if (templateId !== "blank" && !template)
    throw new StoryContentError(
      "story.invalid",
      `Unknown story template: ${String(templateId)}`,
      { templateId: String(templateId) },
    );
  const defaults = template?.defaults ?? {
    targetDuration: 120,
    maxDuration: 180,
  };
  const maxDuration = input.maxDuration ?? defaults.maxDuration;
  const targetDuration =
    input.targetDuration ?? Math.min(defaults.targetDuration, maxDuration);
  if (
    !Number.isFinite(targetDuration) ||
    !Number.isFinite(maxDuration) ||
    targetDuration <= 0 ||
    maxDuration <= 0 ||
    targetDuration > maxDuration
  )
    throw new StoryContentError(
      "story.invalid",
      "Film target and maximum durations must be positive, with target no greater than maximum.",
    );
  return { templateId, targetDuration, maxDuration };
}

/** User edit endpoints cannot claim template ownership or change template keys. */
export function preserveUserBeatText(
  previous: StoryBeat | undefined,
  next: StoryBeat,
): StoryBeat {
  const result = structuredClone(next);
  if (previous?.templateBeatKey !== undefined)
    result.templateBeatKey = previous.templateBeatKey;
  else delete result.templateBeatKey;
  for (const field of ["title", "intent"] as const) {
    const source = field === "title" ? "titleSource" : "intentSource";
    if (!previous || previous[field] !== next[field]) {
      if (
        field === "title" ||
        previous?.[field] !== undefined ||
        next[field] !== undefined
      )
        result[source] = "user";
      else delete result[source];
    } else if (previous[source] === undefined) delete result[source];
    else result[source] = previous[source];
  }
  return result;
}

/** Only text with explicit template ownership is translated; no legacy guesses. */
export function localizeProjectContent(
  project: OpenFilmProject,
  locale: ProjectContentLocale,
  templates: readonly StoryTemplate[] = [],
): OpenFilmProject {
  const contentLocale = resolveProjectContentLocale(locale);
  const next = structuredClone(project);
  next.projectContentLocale = contentLocale;
  for (const story of next.stories) {
    const template = templates.find((entry) => entry.id === story.template);
    for (const beat of story.beats) {
      if (!beat.templateBeatKey) continue;
      const text =
        !story.template || story.template === "blank"
          ? genericBeatText(beat.templateBeatKey, contentLocale)
          : template?.getBeatText?.(beat.templateBeatKey, contentLocale);
      if (!text) continue;
      if (beat.titleSource === "template") beat.title = text.title;
      if (beat.intentSource === "template") {
        if (text.intent === undefined) delete beat.intent;
        else beat.intent = text.intent;
      }
    }
  }
  return next;
}
