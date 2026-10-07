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

At clean source head `c6cc487238f42242f35a139e3b1afcf95a4750a7`, all eight
non-browser required gates passed: format, i18n, lint, TypeScript/Vue typecheck,
unit/integration, build, interchange and native checks. The built CLI workflow
also passed. Unit/integration executed **1,116 tests in 96 files**; i18n validated
**1,039 semantic keys** across en-US, zh-TW and ja-JP. Official OTIO 0.18.1
read/write/read and source hashes/bounds pass, including 18 workstation-helper
regressions. Native format/Clippy/harnesses pass but run zero behavioral Rust
tests; they do not certify native windows or installers.

The new coverage includes 41 catalog, 23 application, 17 actual-SFC UI-state and
6 HTTP/bundled-CLI regressions. Actual child processes verify live queued/running
preservation, death after an observer already opened, duplicate prevention and
revoked queued execution. Real SQLite transactions test stale writes and complete
rollback of transcript/cache plus completed Job. Same-millisecond progress is
bound by the whole Job digest. Manual transcript history, markers, locks, Story,
composition and source bytes remain unchanged by recovery.

The focused real-browser suite passed **5/5**, zero failures/skips/retries, one
worker, at clean head `9c0ed5be5be223740c4d59d14bd575fc3537e3ae`. Before/after
heads, clean status and all ten recorded source hashes match. The three core
locale flows verify stale confirmation, a held real-HTTP draft save, recovery,
explicit re-transcription warning, retained historical correction and reopen.
An actual live child is shown consistently in Activity/Precision/Transcript with
no false local Cancel or takeover; the pseudo locale retains keyboard access.
The recovery screens pass layout assertions and produce **12 screenshots** across
en-US, zh-TW, ja-JP, en-XA and 1280×720, 1440×900, 1920×1080. The final candidate
also clarifies six existing localized busy messages to point to Activity status
and available recovery actions.

The first focused run failed 4/5: the fixture had not selected its advertised
English language and one locator scoped outside the actual job actions. The next
run failed 3/5 because exact label matching included the select's option text.
Both failed runs and traces are retained. Only fixture/control locators changed;
production validation and assertions were preserved. The successful final run
uses actual UI language selection and actual HTTP, not fabricated API responses.

Independent review identified two P2s: a malformed historical token blocked
confirmed recovery, and an owner dying after Open had no recovery affordance.
Both are fixed and regression-tested; private HTTP probes confirm successful
recovery and stale replay rejection. Frozen-head review found no remaining
actionable P1/P2 issue. This is a review conclusion, not a formal approval object.

The complete final-candidate browser gate contains 69 cases. Its clean run
manifest and required exact-head CI are recorded in
[PR #9](https://github.com/bynanci/open-film/pull/9); earlier heads and focused
success do not substitute for those checks before merge. The final evidence and
copy update retains the verified application/catalog/command boundaries.

## Manual limits

Actual Linux child probes establish behavior in this environment, not automatic
Windows/macOS ownership proof. Foreign, legacy and unverifiable owners stay
unknown and need workstation confirmation. Real Whisper quality/performance,
GPU, Pixel/Insta360 media, sustained 4K sources, Windows/native installation and
real Resolve import are not performed here. Issue #7 remains the workstation gate.
