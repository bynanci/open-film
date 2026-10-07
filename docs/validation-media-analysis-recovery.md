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

## Post-Ready navigation correction

The Ready-triggered Codex review of `eab34a4b0229bfc29e43ddc5de3e5d2c810d6be4`
found P2 [observer navigation](https://github.com/bynanci/open-film/pull/9#discussion_r4212695135).
Both preceding exact-head CI workflows passed on attempt 2 and their official
Playwright annotations report 69 passed; attempt 1 exceeded the 20-minute job
limit and remains retained. Those successful checks do not clear the later finding.

The correction exempts only matching, explicitly non-local transcription,
waveform and scene jobs from the navigation guard. Missing evidence and local or
other jobs remain blocked. Draft flush is followed by a fresh job snapshot and
project-session check. Precision mutation submissions use a generation-independent
pending barrier through Timeline; source changes cannot discard an unresolved
request. The server's local-execution and serialized-mutation checks still apply.

Thirty actual App SFC regressions and nine Precision/Timeline regressions pass.
Their initial RED runs failed eight and seven cases respectively. Independent
review of the corrected code found no additional actionable P1/P2.
At clean source head `c1218b905c96c1ed127a4d26ed5c394941f8aa1a`, the focused
browser suite passed 5/5 in 31 seconds with all tracked source hashes unchanged.
An actual held child continues while its observer closes the project, opens a
second film and returns; the owner Job, manual transcript, Story, composition,
trim, lock and original source hash are preserved before the child completes.

Full gates and CI for the corrected published candidate remain distinct from
`eab34a4` evidence and must be verified before merging PR #9. Real workstation
gates are unchanged.

## Subsequent history correction

Exact-head Codex review of `da55af0223db8c011a3a60f1546912ed598c1fc5`
found P2 [history during pending Precision mutations](https://github.com/bynanci/open-film/pull/9#discussion_r4212953205).
The combined pending state had accidentally enabled the existing Undo exception,
and button/keyboard history could reset a source before its request settled.
The correction guards the shared history entry and both button states. The
inverse interleave also guards marker/analysis methods and controls while history
is busy. Existing unsaved-composition Undo still delegates once without an extra
flush or a new undo unit.

The actual-SFC Precision/Timeline suite has 23 passing cases, including 14 new
regressions. Before the production fix, 12 cases failed and 11 passed. Independent
review found no further actionable P1/P2 in that correction. A separate isolated
six-case draft-dialog probe did not reproduce releasing an unsettled mutation
barrier and was not promoted to a correctness claim.

The first full local browser attempt at `da55af0` passed 68 cases and failed the
Proposal official-parser step because its runner omitted the installed OTIO
Python environment. That failure and trace are retained. The environment-corrected
rerun was explicitly cancelled before source changes after the history finding;
its unchanged-source manifest is retained, and it is not a passed full gate.
Complete local gates, exact-head CI and review of the corrected candidate remain
required in PR #9; earlier success does not substitute for them.

## Selection acknowledgement correction

The historical push run [37699608932](https://github.com/bynanci/open-film/actions/runs/37699608932)
at `da55af0` failed the Proposal assertion that composition excludes unsupported
or rejected assets (68 passed, one failed). The parallel PR run
[37699651007](https://github.com/bynanci/open-film/actions/runs/37699651007) passed
69 cases. This is distinct from the local OTIO environment failure. The failed
run's artifact archive returned Forbidden, so its exact offending asset is not
known from a downloaded trace.

An isolated actual-App probe proves a real path to that assertion: holding a
successful lock PATCH acknowledgement leaves `run()` busy, while still-enabled
Reject controls submit a second action that is silently ignored. The relevant
functions are identical at main `34b6ff0`, base `8b466ae` and `da55af0`; this
preexisting race was exposed during verification. Card and inspector mutation
controls now use the same busy state, while inspecting media remains available.

Six actual compiled-template/App regressions pass; five failed before the fix
and the idle case passed. The focused real Proposal browser test passes with a
held successful lock response, disabled controls, an acknowledged Reject request
and the unchanged final composition assertion. It also validates the official
OTIO parser using the installed Python environment. Restore is shown as an
affordance; this test does not execute a Restore mutation. Independent review
found no further actionable P1/P2. The original remote failure remains retained;
its trace absence does not establish this as the sole historical cause. Complete
corrected-head gates and CI are still required before merge.

## Manual limits

Actual Linux child probes establish behavior in this environment, not automatic
Windows/macOS ownership proof. Foreign, legacy and unverifiable owners stay
unknown and need workstation confirmation. Real Whisper quality/performance,
GPU, Pixel/Insta360 media, sustained 4K sources, Windows/native installation and
real Resolve import are not performed here. Issue #7 remains the workstation gate.
