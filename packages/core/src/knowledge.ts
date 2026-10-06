import { validateTranscriptSegmentId } from "./intelligence.js";

/** Portable, user-owned terminology and immutable correction evidence. */
export interface GlossaryEntry {
  id: string;
  source: string;
  replacement: string;
  scope: "global" | "project";
  enabled: boolean;
  caseSensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type GlossaryInput = Pick<
  GlossaryEntry,
  "source" | "replacement" | "scope"
> &
  Partial<Pick<GlossaryEntry, "id" | "enabled" | "caseSensitive">>;

export const GLOSSARY_ENTRY_LIMIT = 1000;
/** Text limits count UTF-16 code units, matching browser maxlength. */
export const GLOSSARY_SOURCE_LIMIT = 512;
export const GLOSSARY_REPLACEMENT_LIMIT = 4096;
export const REVIEW_PAGE_LIMIT = 100;
export const TRANSCRIPT_TEXT_LIMIT = 20000;

export interface ReviewSuggestion {
  id: string;
  kind: string;
  target: {
    assetId?: string;
    segmentId?: string;
    clipId?: string;
    beatId?: string;
  };
  sourceRevisionId: string;
  before: string;
  after: string;
  reason: string;
  confidence?: number;
  source: {
    type: "rule" | "glossary" | "provider";
    id: string;
    model?: string;
  };
  status: "pending" | "accepted" | "skipped" | "stale";
  createdAt: string;
  acceptedAt?: string;
  acceptedRevisionId?: string;
  requestId?: string;
}

/** Current correction workflow narrows the generic evidence target. */
export type TranscriptReviewSuggestion = ReviewSuggestion & {
  target: {
    assetId: string;
    segmentId: string;
    clipId?: string;
    beatId?: string;
  };
};

export interface ReviewBatch {
  jobId: string;
  index: number;
  assetId: string;
  sourceRevisionId: string;
  providerId: string;
  segmentIds: string[];
  status:
    "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";
  attempts: number;
  error?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Knowledge data must be an object.");
  return value as Record<string, unknown>;
}

export function validKnowledgeText(
  value: unknown,
  maximum = TRANSCRIPT_TEXT_LIMIT,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    }) &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  );
}

function string(
  value: unknown,
  name: string,
  maximum: number,
  empty = false,
): string {
  if (!validKnowledgeText(value, maximum) || (!empty && !value.trim()))
    throw new Error(`${name} is invalid or exceeds ${maximum} characters.`);
  return value;
}

function identifier(value: unknown, name = "ID"): string {
  const result = string(value, name, 256);
  if (
    [...result].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error(`${name} cannot contain control characters.`);
  return result;
}

function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Knowledge timestamps require ISO dates with a timezone.");
  return value;
}

export function validateGlossaryEntry(value: unknown): GlossaryEntry {
  const data = object(value);
  if (
    (data.scope !== "global" && data.scope !== "project") ||
    typeof data.enabled !== "boolean" ||
    typeof data.caseSensitive !== "boolean"
  )
    throw new Error("Invalid glossary scope or matching flags.");
  return {
    id: identifier(data.id),
    source: string(data.source, "Glossary source", GLOSSARY_SOURCE_LIMIT),
    replacement: string(
      data.replacement,
      "Glossary replacement",
      GLOSSARY_REPLACEMENT_LIMIT,
      true,
    ),
    scope: data.scope as GlossaryEntry["scope"],
    enabled: data.enabled,
    caseSensitive: data.caseSensitive,
    createdAt: date(data.createdAt),
    updatedAt: date(data.updatedAt),
  };
}

export function validateReviewSuggestion(value: unknown): ReviewSuggestion {
  const data = object(value);
  const target = object(data.target);
  const source = object(data.source);
  if (
    ![target.assetId, target.segmentId, target.clipId, target.beatId].some(
      (value) => value !== undefined,
    )
  )
    throw new Error("Review evidence must identify a target.");
  if (
    (source.type !== "rule" &&
      source.type !== "glossary" &&
      source.type !== "provider") ||
    (data.status !== "pending" &&
      data.status !== "accepted" &&
      data.status !== "skipped" &&
      data.status !== "stale")
  )
    throw new Error("Invalid review source or lifecycle state.");
  const before = string(
    data.before,
    "Original text",
    TRANSCRIPT_TEXT_LIMIT,
    true,
  );
  const after = string(
    data.after,
    "Suggested text",
    TRANSCRIPT_TEXT_LIMIT,
    true,
  );
  if (before === after)
    throw new Error("A review suggestion must change the text.");
  const confidence = data.confidence;
  if (
    confidence !== undefined &&
    (typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1)
  )
    throw new Error("Review confidence must be between zero and one.");
  return {
    id: identifier(data.id),
    kind: string(data.kind, "Suggestion kind", 128),
    target: {
      ...(target.assetId === undefined
        ? {}
        : { assetId: identifier(target.assetId) }),
      ...(target.segmentId === undefined
        ? {}
        : { segmentId: validateTranscriptSegmentId(target.segmentId) }),
      ...(target.clipId === undefined
        ? {}
        : { clipId: identifier(target.clipId) }),
      ...(target.beatId === undefined
        ? {}
        : { beatId: identifier(target.beatId) }),
    },
    sourceRevisionId: identifier(data.sourceRevisionId),
    before,
    after,
    reason: string(data.reason, "Suggestion reason", 4096),
    ...(confidence === undefined ? {} : { confidence: confidence as number }),
    source: {
      type: source.type as ReviewSuggestion["source"]["type"],
      id: identifier(source.id),
      ...(source.model === undefined
        ? {}
        : { model: string(source.model, "Provider model", 256) }),
    },
    status: data.status as ReviewSuggestion["status"],
    createdAt: date(data.createdAt),
    ...(data.acceptedAt === undefined
      ? {}
      : { acceptedAt: date(data.acceptedAt) }),
    ...(data.acceptedRevisionId === undefined
      ? {}
      : { acceptedRevisionId: identifier(data.acceptedRevisionId) }),
    ...(data.requestId === undefined
      ? {}
      : { requestId: identifier(data.requestId) }),
  };
}

export function validateTranscriptReviewSuggestion(
  value: unknown,
): TranscriptReviewSuggestion {
  const evidence = validateReviewSuggestion(value);
  if (!evidence.target.assetId || !evidence.target.segmentId)
    throw new Error(
      "Transcript corrections require both a media asset and a segment target.",
    );
  return evidence as TranscriptReviewSuggestion;
}

/** Project entries shadow global definitions. Localized UI never changes content data. */
export function effectiveGlossary(
  entries: readonly GlossaryEntry[],
): GlossaryEntry[] {
  if (entries.length > GLOSSARY_ENTRY_LIMIT * 2)
    throw new Error("Glossary size exceeds the supported limit.");
  const validated = entries.map(validateGlossaryEntry);
  const projectSources = new Set(
    validated
      .filter((entry) => entry.scope === "project")
      .map((entry) => entry.source),
  );
  return validated
    .filter(
      (entry) =>
        entry.enabled &&
        (entry.scope === "project" || !projectSources.has(entry.source)),
    )
    .sort(
      (a, b) =>
        b.source.length - a.source.length ||
        (a.scope === b.scope
          ? a.id.localeCompare(b.id)
          : a.scope === "project"
            ? -1
            : 1),
    );
}

interface Trie {
  children: Map<string, Trie>;
  entries: GlossaryEntry[];
}
export interface GlossaryMatch {
  entryId: string;
  start: number;
  end: number;
  before: string;
  after: string;
}

/** Match the transcript searcher's Unicode /iu equivalence without expanding
 * characters or changing the original string's offsets. JS case conversion is
 * only a candidate: /iu excludes dotless I and multi-character folds such as ß→ss. */
function simpleFoldKey(character: string, cache: Map<string, string>): string {
  const code = character.codePointAt(0)!;
  if (code <= 0x7f)
    return code >= 65 && code <= 90
      ? String.fromCharCode(code + 32)
      : character;
  const cached = cache.get(character);
  if (cached !== undefined) return cached;
  // These Unicode simple-fold aliases have expanding full case conversions.
  // Keep their one-scalar candidates subject to the same runtime /iu check.
  const simple =
    code === 0x1fd3
      ? "\u0390"
      : code === 0x1fe3
        ? "\u03b0"
        : code === 0xfb05
          ? "\ufb06"
          : character;
  const upperLower = character.toUpperCase().toLowerCase();
  const lower = character.toLowerCase();
  if (simple === character && upperLower === character && lower === character)
    return character;
  let key = character;
  let equivalent: RegExp | undefined;
  for (const candidate of [simple, upperLower, lower]) {
    if (candidate === character || [...candidate].length !== 1) continue;
    equivalent ??= new RegExp(`^\\u{${code.toString(16)}}$`, "iu");
    if (equivalent.test(candidate)) {
      key = candidate;
      break;
    }
  }
  // Cache only case-conversion candidates, not every CJK/emoji seen in a film.
  // Keep a hard bound even if a future engine adds more case mappings.
  if (cache.size < 4096) cache.set(character, key);
  return key;
}

/** Compile once per bounded review batch; no replacement cascades and no fuzzy matching. */
export function compileGlossaryMatcher(
  values: readonly GlossaryEntry[],
): (text: string) => { text: string; matches: GlossaryMatch[] } {
  const exact: Trie = { children: new Map(), entries: [] };
  const folded: Trie = { children: new Map(), entries: [] };
  const caseKeys = new Map<string, string>();
  for (const entry of effectiveGlossary(values)) {
    let node = entry.caseSensitive ? exact : folded;
    for (const character of entry.source) {
      const key = entry.caseSensitive
        ? character
        : simpleFoldKey(character, caseKeys);
      if (!node.children.has(key))
        node.children.set(key, { children: new Map(), entries: [] });
      node = node.children.get(key)!;
    }
    node.entries.push(entry);
  }
  return (text) => {
    if (!validKnowledgeText(text))
      throw new Error(
        "Transcript text exceeds the matching limit or has invalid Unicode.",
      );
    const characters = [...text];
    const offsets = [0];
    for (const character of characters)
      offsets.push(offsets.at(-1)! + character.length);
    const matches: GlossaryMatch[] = [];
    let result = "";
    let cursor = 0;
    for (let index = 0; index < characters.length;) {
      let best: { entry: GlossaryEntry; end: number } | undefined;
      for (const [root, caseSensitive] of [
        [exact, true],
        [folded, false],
      ] as const) {
        let node: Trie | undefined = root;
        for (
          let end = index;
          end < characters.length && end - index < 512;
          end++
        ) {
          const character = characters[end]!;
          node = node.children.get(
            caseSensitive ? character : simpleFoldKey(character, caseKeys),
          );
          if (!node) break;
          for (const entry of node.entries) {
            if (
              !best ||
              end + 1 > best.end ||
              (end + 1 === best.end &&
                entry.scope === "project" &&
                best.entry.scope !== "project")
            )
              best = { entry, end: end + 1 };
          }
        }
      }
      if (!best) {
        index++;
        continue;
      }
      const start = offsets[index]!;
      const end = offsets[best.end]!;
      const before = text.slice(start, end);
      if (before !== best.entry.replacement)
        matches.push({
          entryId: best.entry.id,
          start,
          end,
          before,
          after: best.entry.replacement,
        });
      result += text.slice(cursor, start) + best.entry.replacement;
      cursor = end;
      index = best.end;
    }
    result += text.slice(cursor);
    if (!validKnowledgeText(result))
      throw new Error(
        "Glossary replacement would exceed the transcript text limit.",
      );
    return { text: result, matches };
  };
}
