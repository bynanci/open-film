// SPDX-License-Identifier: Apache-2.0
export default {
  collectDelivery: {
    heading: "Explore media consolidation",
    description:
      "Review the source ranges used by this film and the extra material to keep around each cut.",
    planningOnly:
      "This is a planning review. Package creation currently includes full original media. Derived delivery becomes available after source timing and output validation.",
    mode: "Delivery option to review",
    originals: "Full originals",
    trimmed: "Original ranges with handles",
    offline: "Lightweight offline editing",
    handles: "Extra source before and after cuts (seconds)",
    review: "Review source ranges",
    cancel: "Cancel review",
    preparing: "Inspecting source ranges…",
    results: "Source coverage review",
    ranges: "Source windows:",
    window: "{start}–{end} s",
    duration: "Keep {retained} s · Omit {removed} s of source",
    pages: "Source coverage pages",
    previous: "Previous",
    next: "Next",
    pageCount: "{first}–{last} of {total}",
    quality: {
      originals:
        "The current original-media package preserves complete sources.",
      "requires-lossless-parity":
        "Trim candidates require decoded picture, audio and timing parity with the original film before delivery.",
      "offline-only":
        "Offline candidates are for lightweight editing and review. Original-quality finishing requires the original media.",
    },
    actions: {
      "copy-original": "Keep full original",
      "trim-candidate": "Candidate for range consolidation",
      "offline-candidate": "Candidate for offline preview",
    },
    reasons: {
      identityMissing:
        "Source bytes could not be verified against the saved identity.",
      timingUnavailable: "Reliable source duration is unavailable.",
      unsupported:
        "This media keeps its complete original in the current design.",
      locked: "Source or clip protection keeps the original unchanged.",
      opaqueReference: "A scene or layout dependency requires the full source.",
      evidenceBound:
        "Transcript, provenance or extension data needs the original source clock.",
      rangeInvalid: "The saved source range needs review before consolidation.",
      unused: "No bounded clip range was found for this referenced source.",
    },
  },
};
