// SPDX-License-Identifier: Apache-2.0
export default {
  proxyStorage: {
    heading: "Preview storage",
    usage: "{used} of {quota}",
    loading: "Reading storage…",
    description:
      "Prepare lightweight previews for smoother editing. Exports use original media. These files stay on this device.",
    capacity: "Preview cache capacity",
    otherUsage: "Older previews: {legacy} · Work in progress: {temporary}",
    incomplete:
      "Some cache entries could not be inspected. Cleanup is paused until storage can be verified.",
    working: "Updating preview storage…",
    running: "Preparing previews in the background…",
    prepare: "Prepare missing previews",
    runQueued: "Run queued ({count})",
    resume: "Retry stopped previews",
    cancel: "Cancel preparation",
    verify: "Verify this page",
    previewCleanup: "Review cleanup",
    refresh: "Refresh",
    protected: "Protected from cleanup",
    checked: "Hash verified",
    prepareSource: "Prepare preview for {name}",
    prepareOne: "Prepare",
    empty: "No video or audio sources to prepare.",
    pages: "Preview source pages",
    previous: "Previous",
    next: "Next",
    pageCount: "{first}–{last} of {total}",
    cleanupReview: "Review files to remove",
    cleanupSummary:
      "{count} previews · {bytes} recoverable · {protected} protected entries examined",
    moreCleanup:
      "More files may be available. Review another batch after this cleanup.",
    confirmCleanup:
      "Remove only the previews listed above. Originals and the saved edit are preserved.",
    acceptCleanup: "Remove reviewed previews",
    settings: "Storage settings",
    quota: "Maximum managed storage (MiB)",
    savePolicy: "Save limit",
    quotaHint:
      "1 MiB–1 TiB. Lowering this limit does not remove files. Review cleanup explicitly.",
    recovery: "Interrupted preview work",
    recoveryHint:
      "The previous execution owner cannot be verified. Confirm that other OpenFilm workers have stopped before recovery. Running owners cannot be reclaimed.",
    confirmStopped:
      "I have confirmed that previous workers and preview readers have stopped.",
    recover: "Recover stopped work",
    cancelRequested:
      "Cancellation requested. Waiting for the worker to stop safely.",
    verificationResult:
      "{checked} of {total} previews verified. Review source status for remaining entries.",
    cleanupResult: "Released {bytes}. Files needing another review: {failed}.",
    jobTitle: "Preview preparation",
    status: {
      queued: "Queued",
      running: "Preparing",
      cancelling: "Stopping…",
      ready: "Ready",
      missing: "Not prepared",
      stale: "Needs rebuilding",
      failed: "Preparation failed",
      cancelled: "Cancelled",
      legacy: "Older preview",
      unavailable: "Needs review",
    },
  },
};
