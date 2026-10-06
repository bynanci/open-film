import { transcriptTextMatches } from "../src/transcript-editing.js";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  compileGlossaryMatcher,
  effectiveGlossary,
  validateGlossaryEntry,
  validateReviewSuggestion,
  validateTranscriptReviewSuggestion,
  type GlossaryEntry,
} from "../src/knowledge.js";

function term(
  source: string,
  replacement: string,
  options: Partial<GlossaryEntry> = {},
): GlossaryEntry {
  return {
    id: source,
    source,
    replacement,
    scope: "project",
    enabled: true,
    caseSensitive: true,
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
    ...options,
  };
}

describe("portable terminology and correction evidence", () => {
  it.each([
    [
      "Latin long s",
      "source",
      "😀 ſource SOURCE",
      [
        [3, 9],
        [10, 16],
      ],
    ],
    [
      "Greek final sigma",
      "οσ",
      "😀 ΟΣ οσ ος",
      [
        [3, 5],
        [6, 8],
        [9, 11],
      ],
    ],
    [
      "Greek micro variants",
      "μ",
      "µ Μ μ",
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ],
    ],
    [
      "dotted and dotless I exclusions",
      "i",
      "I i İ ı",
      [
        [0, 1],
        [2, 3],
      ],
    ],
    ["dotted capital I", "İ", "İ i I ı", [[0, 1]]],
    ["dotless I", "ı", "ı i I İ", [[0, 1]]],
    [
      "sharp S without expansion",
      "ß",
      "😀 ß ẞ SS ss",
      [
        [3, 4],
        [5, 6],
      ],
    ],
    [
      "SS without sharp-S expansion",
      "ss",
      "ß ẞ SS ss",
      [
        [4, 6],
        [7, 9],
      ],
    ],
    [
      "astral Deseret",
      "\u{10400}",
      "😀 \u{10400} \u{10428}",
      [
        [3, 5],
        [6, 8],
      ],
    ],
    [
      "CJK and accented Latin",
      "ångström",
      "記憶😀 ÅNGSTRÖM ångström",
      [
        [5, 13],
        [14, 22],
      ],
    ],
  ] as const)(
    "shares Unicode literal search semantics and original UTF-16 ranges for %s",
    (_name, source, text, ranges) => {
      const expected = ranges.map(([start, end]) => ({ start, end }));
      expect(transcriptTextMatches(text, source, false)).toEqual(expected);
      const result = compileGlossaryMatcher([
        term(source, "替換", { caseSensitive: false }),
      ])(text);
      expect(result.matches.map(({ start, end }) => ({ start, end }))).toEqual(
        expected,
      );
      expect(
        result.matches.every(
          (match) => match.before === text.slice(match.start, match.end),
        ),
      ).toBe(true);
      let replaced: string = text;
      for (const { start, end } of [...expected].reverse())
        replaced = replaced.slice(0, start) + "替換" + replaced.slice(end);
      expect(result.text).toBe(replaced);
    },
  );
  it("keeps exact matching, literal normalization boundaries, longest matches and identical-source scope policy", () => {
    expect(
      compileGlossaryMatcher([term("source", "X")])("ſource SOURCE source")
        .text,
    ).toBe("ſource SOURCE X");
    expect(
      compileGlossaryMatcher([term("Å", "X", { caseSensitive: false })])(
        "A\u030a Å å",
      ).text,
    ).toBe("A\u030a X X");
    const global = term("σ", "global", {
      id: "global",
      scope: "global",
      caseSensitive: false,
    });
    expect(
      compileGlossaryMatcher([
        global,
        term("σ", "project", { id: "project", caseSensitive: false }),
      ])("Σςσ").text,
    ).toBe("projectprojectproject");
    expect(
      compileGlossaryMatcher([
        global,
        term("σ", "disabled", {
          id: "project",
          caseSensitive: false,
          enabled: false,
        }),
      ])("Σςσ").text,
    ).toBe("Σςσ");
    // Differently spelled source strings are not normalized into a shadowing key.
    expect(
      compileGlossaryMatcher([
        global,
        term("ς", "disabled", {
          id: "different-source",
          caseSensitive: false,
          enabled: false,
        }),
      ])("Σςσ").text,
    ).toBe("globalglobalglobal");
    expect(
      compileGlossaryMatcher([
        term("σ", "S", { caseSensitive: false }),
        term("σσ", "PAIR", { caseSensitive: false }),
      ])("😀 Σςσ").text,
    ).toBe("😀 PAIRS");
  });
  it("matches exact CJK text and case-insensitive brands without cascading replacements", () => {
    const match = compileGlossaryMatcher([
      term("十河田", "十和田"),
      term("youtube", "YouTube", { caseSensitive: false }),
      term("YouTube", "Streaming site"),
      term("十和田", "another place"),
    ]);
    expect(match("十河田湖 YOUTUBE YouTube")).toEqual({
      text: "十和田湖 YouTube Streaming site",
      matches: [
        {
          entryId: "十河田",
          start: 0,
          end: 3,
          before: "十河田",
          after: "十和田",
        },
        {
          entryId: "youtube",
          start: 5,
          end: 12,
          before: "YOUTUBE",
          after: "YouTube",
        },
        {
          entryId: "YouTube",
          start: 13,
          end: 20,
          before: "YouTube",
          after: "Streaming site",
        },
      ],
    });
  });
  it("prefers the longest exact term and project scope for identical sources", () => {
    const entries = [
      term("insta", "camera"),
      term("insta 360", "Insta360", { id: "global", scope: "global" }),
      term("insta 360", "INSTA360", { id: "project" }),
    ];
    expect(effectiveGlossary(entries).map((entry) => entry.id)).not.toContain(
      "global",
    );
    expect(compileGlossaryMatcher(entries)("insta 360 insta").text).toBe(
      "INSTA360 camera",
    );
  });
  it("lets a disabled project definition shadow an enabled global definition", () => {
    expect(
      compileGlossaryMatcher([
        term("brand", "global", { scope: "global", id: "global" }),
        term("brand", "project", { enabled: false }),
      ])("brand").text,
    ).toBe("brand");
  });
  it("retains UTF-16 offsets for supplementary Unicode and does not interpret regex syntax", () => {
    expect(compileGlossaryMatcher([term("😀#&", "☺")])("a😀#&b")).toEqual({
      text: "a☺b",
      matches: [
        { entryId: "😀#&", start: 1, end: 5, before: "😀#&", after: "☺" },
      ],
    });
    expect(
      compileGlossaryMatcher([term(".*", "literal")])(".* words").text,
    ).toBe("literal words");
  });
  it("bounds vocabulary and replacement expansion and rejects invalid Unicode", () => {
    expect(() =>
      compileGlossaryMatcher(
        Array.from({ length: 2001 }, (_, id) => term(String(id), "x")),
      ),
    ).toThrow();
    expect(() =>
      compileGlossaryMatcher([term("a", "b".repeat(4096))])("a".repeat(6)),
    ).toThrow();
    expect(() =>
      validateGlossaryEntry(term("\uD800", "replacement")),
    ).toThrow();
  });
  it("validates immutable evidence, original source revision and finite confidence", () => {
    const evidence = {
      id: "suggestion",
      kind: "terminology",
      target: { assetId: "asset", segmentId: "segment" },
      sourceRevisionId: "revision",
      before: "bad",
      after: "good",
      reason: "Matches a known term",
      source: { type: "glossary", id: "term" },
      status: "pending",
      createdAt: "2026-10-06T00:00:00Z",
    };
    expect(validateReviewSuggestion(evidence).sourceRevisionId).toBe(
      "revision",
    );
    expect(() =>
      validateReviewSuggestion({ ...evidence, confidence: NaN }),
    ).toThrow();
    expect(() =>
      validateReviewSuggestion({ ...evidence, after: "bad" }),
    ).toThrow();
    expect(() =>
      validateReviewSuggestion({ ...evidence, after: "\uDC00" }),
    ).toThrow();
    const framing = {
      ...evidence,
      target: { clipId: "clip" },
      kind: "framing",
    };
    expect(validateReviewSuggestion(framing).target).toEqual({
      clipId: "clip",
    });
    expect(() => validateTranscriptReviewSuggestion(framing)).toThrow();
    expect(() =>
      validateReviewSuggestion({ ...evidence, target: {} }),
    ).toThrow();
    expect(() =>
      validateReviewSuggestion({ ...evidence, status: ["pending"] }),
    ).toThrow();
    expect(() =>
      validateGlossaryEntry({ ...term("term", "Term"), scope: ["project"] }),
    ).toThrow();
  });
  it("scans 10,000 bounded lines against 1,000 compiled terms without rebuilding per line", () => {
    const entries = Array.from({ length: 1000 }, (_, id) =>
      term(`term-${id}`, `Term ${id}`),
    );
    const started = performance.now();
    const match = compileGlossaryMatcher(entries);
    let replacements = 0;
    for (let id = 0; id < 10000; id++)
      replacements += match(`We remember term-${id % 1000} together.`).matches
        .length;
    expect(replacements).toBe(10000);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
