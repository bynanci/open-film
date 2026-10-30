// SPDX-License-Identifier: Apache-2.0
export default {
  collectDelivery: {
    heading: "Explore media consolidation",
    description:
      "Review the source ranges used by this film and the extra material to keep around each cut.",
    planningOnly:
      "Review first, then explicitly accept to create a package. Protected sources stay complete. Lossless range files can be larger than compressed originals.",
    format: "Package format",
    directory: "Folder",
    acceptLossless:
      "I reviewed these ranges and accept lossless delivery with output validation. File size may increase.",
    acceptOffline:
      "I accept lower-resolution, compressed review media. This package cannot produce original-quality masters.",
    acceptOriginals:
      "I reviewed and accept the complete original-media package.",
    create: "Accept and create package",
    validating: "Creating media and validating the delivered film…",
    rightsFirst:
      "Review and confirm all source and font rights in Collect before creating.",
    offlineOutput:
      "This project uses offline review media. Exports cannot restore the quality of the original sources.",
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
      userPinned:
        "A user pin requires the complete original source and its saved clock.",
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
