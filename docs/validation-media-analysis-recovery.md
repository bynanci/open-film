# Media-analysis recovery validation

Latest merged main: `34b6ff093294f97061dfb0ecb270413a52b6b7ee` (PR #5/#6).
This isolated ownership slice builds on the verified, still-open PR #8 head
`8b466ae0854af7f7788d7dc83ac21287d661ff27`. Its PR is stacked against
`codex/media-intelligence-cancellation`; PR #8 is not silently merged or copied.

## Reproduction

Two independent, isolated exact-main probes reproduced the failure before source
changes. Actual held child processes showed all three regressions failing:
opening the film failed live queued/running work, resuming the owner revived that
Job, and a second already-open Application invoked duplicate transcription.
A separate probe also showed that `jobId` could overwrite an unrelated completed
Job. These are lifecycle/storage tests with explicitly predetermined provider
output, not a speech-recognition or hardware benchmark.

## Implementation boundary

The optional owner is stored in existing Job JSON. Atomic reservation, exact
queued consumption, active owner/status fencing and exact recovery CAS are shared
by application, API and bundled CLI. Completed analysis and completed Job status
commit together inside the existing transcript/cache transaction, preserving
transcript revision checks. Desktop uses the same runtime recovery map across
Activity, Precision and Transcript, with an explicit stopped-process confirmation.

## Candidate evidence

The implementation is in progress. Focused application/catalog/HTTP/CLI/browser
regressions, full gate results, exact source/head and independent review outcomes
will be recorded after they execute. No pending check is a success.

## Manual limits

Actual Linux child probes establish behavior in this environment, not automatic
Windows/macOS ownership proof. Foreign, legacy and unverifiable owners stay
unknown and need workstation confirmation. Real Whisper quality/performance,
GPU, Pixel/Insta360 media, sustained 4K sources, Windows/native installation and
real Resolve import are not performed here. Issue #7 remains the workstation gate.
