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
