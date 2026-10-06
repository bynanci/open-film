# Transcript Productivity validation

Base: `c05427355a568087ee4402e8f1a2dc6b922e6a35`, the PR #3 squash merge.
Its main CI [37430046851](https://github.com/bynanci/open-film/actions/runs/37430046851)
passed. This round uses `codex/transcript-productivity`; new candidate checks,
not baseline CI, establish the new implementation's status.

## Implemented scope

Edit's Transcript mode exposes validated shared text commands, separate undo/redo,
literal search/replace, immutable revisions, conservative alignment state and
durable receipt-based autosave. Project/global glossary and deterministic review
work offline. Optional LanguageProvider review uses declared text context,
explicit remote consent, bounded batches and durable partial results. Accept is
an atomic transcript command plus immutable suggestion audit; stale evidence is
rejected for application but can be dismissed. Story, composition, trims, locks
and media bytes stay outside this text mutation boundary.

Catalog v4 transactionally migrates v1/v2/v3 projects and preserves earlier provider
results. No new timeline engine, LLM runtime, caption pipeline, face analysis,
derived film or geometry feature is included.

## Automated evidence

The remediated production/test tree at
`acc89583c90e6e58f847023cc5a271e699e38616` passed all required local regression
gates. The complete browser run passed **56 tests** (34 existing, 22 new) with no
failures, skips or retries. The full unit/integration suite passed **851 tests in
74 files**. Documentation finalization follows these runs; current-head GitHub
checks remain the separate merge-readiness evidence.

| Gate                    | Result                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`     | Passed                                                                                                       |
| `pnpm test:i18n`        | Passed: 1,013 semantic keys, three locale catalogs and placeholders                                          |
| `pnpm lint`             | Passed                                                                                                       |
| `pnpm typecheck`        | Passed: TypeScript and Vue                                                                                   |
| `pnpm test`             | Passed: 851 tests / 74 files                                                                                 |
| `pnpm build`            | Passed                                                                                                       |
| Built CLI smoke         | Passed: actual import, analysis, Story, render, reopen and export                                            |
| `pnpm test:e2e`         | Passed: 56 tests, 10.4 minutes, one worker and zero retries                                                  |
| `pnpm test:interchange` | Passed: official OpenTimelineIO 0.18.1 parser, source validation, round-trip and 18 workstation-helper tests |
| `pnpm test:native`      | Passed: Rust format, Clippy and test-harness compilation; zero native behavior tests                         |

GitHub exact-head CI and post-PR review are separate merge-readiness checks; local
success does not certify workstation-only behavior. Targeted
tests also verify HTTP/CLI commands, 10,000-segment bounded search/lookup, 1,000-term
matching, source changes, revision conflicts, receipt retries and migration rollback.
These are regression workloads, not an archive-scale or AI-performance benchmark.

The explicit browser server injects a deterministic local LanguageProvider; its
production equivalent has no language provider configured. The transcription
sidecar similarly identifies its predetermined protocol result as
`fixture-protocol-not-asr`. Generated speech/video uses local FFmpeg. No remote
inference call or real recognition-quality claim is hidden in these fixtures.

## Correctness review and regression record

Independent read-only reviews traced application, catalog, provider and Desktop
boundaries. Reproductions and focused regressions covered:

- HTTP pre-reserved queued review jobs being rejected as duplicate IDs; only a
  matching unclaimed queued reservation may be consumed.
- Nonempty glossary hints reaching remote transcription with audio-only consent;
  hints now require additional `text` disclosure and consent before invocation.
- Valid blank correction suggestions being impossible to accept; they apply an
  undoable delete-segment command and preserve review evidence.
- A LanguageProvider ignoring AbortSignal keeping cancellation/project close
  blocked; cancellation releases application ownership and safely discards late
  resolve/reject results while preserving completed suggestions.
- Invalid runtime provider initialization leaking catalog handles; failed
  create/open closes its catalog and permits recovery.
- Invalid batch retries rewriting completed job history; preflight validates
  the actual review batch before changing any stored status.
- A delayed Accept refresh silently rebasing pending manual text onto its new
  revision; mutation guards and pending/revision-aware reads preserve the draft.
- Out-of-order Project/Global glossary reads displaying or deleting the wrong
  scope; captured scope and request generations discard old responses.
- Old paged search responses overwriting a new query and replacing the wrong
  occurrence; query/case/revision/request guards reject stale search results.
- Inline text cursor refs and Undo transport fields failing in real browser
  editing; actual split/merge and one-step Replace All history test the adapters.
- A committed Accept with a lost response removing its card while stranding the
  old editor revision; a durable uncertain-acceptance receipt offers Retry even
  after filtering/reload, reuses the original request and reconciles without
  overwriting a pending manual draft.
- Source playback being clipped out of the viewport when selecting text; a
  compact sticky source player and scroll clearance retain usable controls.
- A delayed glossary write reaching the server after project switching and being
  applied to the wrong project; glossary/remember mutations now participate in
  parent flush and navigation guards. The final delayed-request regression
  verifies project ownership rather than just a disabled form.

The first broad unit run exposed two CJK punctuation join cases (632 passed,
2 failed); script-aware joining was corrected and the complete rerun passed all
661 tests. Early browser runs similarly found real adapter/cursor issues; they
were fixed rather than skipped. An initial full browser attempt was deliberately
cancelled after 13 legacy passes so the source-player viewport layout could be
corrected. Partial/cancelled runs are not full-suite success evidence.

## First PR review and CI evidence

PR #4's initial head was `66a810c676691f08d498df9b0a54d4d94a5d1648`.
Its [push CI](https://github.com/bynanci/open-film/actions/runs/37438183106)
passed, while the [PR CI](https://github.com/bynanci/open-film/actions/runs/37438205975)
passed 41 browser tests and failed two: an acceptance-test handshake timed out,
and pseudo-locale pagination remained on the previous 50-row page. Native jobs
passed in both runs. This is not an all-green exact-head gate. Signed log/artifact
URLs returned Forbidden in the cloud; check annotations supplied the failure
locations and results.

Codex's exact-head review raised five findings: shared interrupted-job recovery,
cancelled-batch retry controls, concurrent global glossary writes, nonterminal
failed glossary batches and inconsistent CLI case flags. Normal application open
already terminalized abandoned jobs; shared recovery also needs to handle raw
queued/running review state independently. The implementation and complete
regression evidence below address these findings; current-head CI and resolved
review-thread state remain separate GitHub merge gates.

Remediation adds focused regressions for all five findings:

| Finding                     | Correction and regression                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interrupted review recovery | Shared recovery terminalizes raw persisted queued/running jobs and unfinished batches; completed evidence survives catalog reopen.                                                                                                           |
| Cancelled batch controls    | Both failed and cancelled batches expose Retry/Skip; browser actions retry one cancelled batch and skip another while retaining earlier suggestions.                                                                                         |
| Concurrent global writes    | Atomic owner publication and ownership-checked recovery serialize read–modify–write; actual competing child processes receive a busy conflict, and retry preserves both terms. Crash/reclaimer and backup-repair regressions cover recovery. |
| Failed glossary batches     | Processing errors leave failed/cancelled batches rather than running forever; offline retry succeeds with corrected terms and skip/reopen retain completed results.                                                                          |
| CLI case settings           | Omitted flags preserve defaults/current settings; explicit case-sensitive/insensitive flags update both directions. Real project/global CLI calls reject contradictory flags before writing.                                                 |

The pagination failure exposed a real requested-page/polling race. The panel now
retains navigation intent and disables paging until acknowledgement. Its browser
regression holds the page response through a real background poll and verifies
disjoint suggestion IDs on the requested page.

The acceptance timeout had separate test causes: a dynamic first-card locator
could retain stale evidence while regeneration was pending, and removing network
interception during active reads could strand the request awaited by the panel.
The test now proves regeneration acknowledgement, pins a durable pending ID and
keeps interception enabled until fixture teardown. Five controlled repetitions
passed without timeout increases or retries. No production acceptance-hang claim
follows from that interception failure.

A subsequent whole-PR independent review found another P2: valid glossary
replacements containing a line feed, carriage return or tab were passed as
unsupported Whisper prompt hints. The application now omits those terms only
from the compact hint list. Three before/after regressions use the real local
adapter's validation and audio extraction with the declared protocol fixture;
they verify successful transcription, exact glossary preservation, word timing,
reviewable suggestions and reopen. No original content is normalized or silently
replaced.

The same review also reproduced a pre-dispatch transcription ownership race:
the editor's exposed flush did not track its analysis POST, so project switching
could precede that request reaching the server. Transcription now reserves
ownership synchronously before preflight and participates in the parent flush
barrier without awaiting itself. An actual compiled SFC with two SQLite projects
sharing an asset ID verified that the held request updates only its original
project. Rejection blocks the waiting switch, preserves the error and permits
retry. A dedicated copied-project browser regression covers the same boundary,
including transport failure, explicit retry and original/copy close/reopen state.

## Second Codex review

The production/test tree `02db0ee9e51461f5c4cb1aa674b9f3dad3a91d17` passed
both [push CI](https://github.com/bynanci/open-film/actions/runs/37443235437) and
[PR CI](https://github.com/bynanci/open-film/actions/runs/37443242452).
Codex still identified four P2 issues. CI success alone did not close the review
gate:

- Starting a newer review could hide older unfinished batch recovery. Recovery
  now pages unfinished jobs independently, with at most five batch reads per
  refresh and actions bound to their original job IDs.
- Desktop disallowed valid empty glossary replacements. Add/edit/resave now keep
  empty values and explicitly describe removal; deterministic deletion
  suggestions remain reviewable and undoable.
- A single oversized provider/legacy segment could bypass batching limits.
  Source text now remains intact in a failed durable batch before provider
  invocation; actual prompt-byte grouping accounts for CJK, escaping and context.
- Existing provider segment IDs accepted at ingestion could be rejected by
  editing/review. References now share the opaque nonblank ID contract across
  Core, catalog and HTTP. Original IDs/evidence remain unchanged; generated IDs
  retain strict validation. Exact dataset lookup also preserves keyboard focus
  for NUL-bearing IDs instead of relying on CSS escaping.

The opaque-ID browser regression additionally exposed an old row's null textarea
ref clearing the newly selected editor, and Node SQLite returning a truncated
NUL-bearing ID from raw TEXT search results. The editor now binds its ref to its
own segment; search retrieves each returned ID from canonical escaped segment
JSON using the existing revision/position index, with at most 200 indexed
lookups per page. Core, legacy v2 migration, HTTP and browser tests preserve the
same original ID through search, seeking, keyboard selection, Enter editing,
Undo/Redo and reopen. The focused browser rerun passed all three remediation
cases; the complete local unit/integration rerun passed 702 tests in 66 files.

Before/after tests reproduce these cases through actual provider-call recording,
SQLite migration/HTTP calls and browser interactions. An older failed review is
created by taking its source offline, not injecting a fake job. Full reruns and
current-head GitHub checks establish the final remediation result.

All nine Codex findings from the first two review rounds have implementation and
regression replies, and their threads are resolved. Review and GitHub CI of the
current candidate are separate final checks; their result must be read from
PR #4 rather than inferred from the earlier green candidate.

## Third Codex review

The documentation-only head `36736bb0e052d21ca9ecf49730a992cdd03a99fe` passed
both [push CI](https://github.com/bynanci/open-film/actions/runs/37448263400) and
[PR CI](https://github.com/bynanci/open-film/actions/runs/37448268543).
Its review nevertheless found four additional P2 issues: editing a disabled
glossary term re-enabled it; paged suggestion polling materialized the full
transcript; a definitive missing-suggestion acceptance receipt blocked navigation;
and a transcription completing before its first poll did not refresh the editor.
These findings were addressed in commits `49f3f70`, `50fd95f` and `807bc90`.
The earlier green CI does not close their review gate; the remediated tree needs
its own complete rerun, review and GitHub checks.

Focused reproductions use the actual SFC scripts, their durable editor queue,
real browser actions and an actual 10,000-segment SQLite catalog. The bounded
page guard failed before its change, then all 41 knowledge tests passed, including
source-change/missing-source and reopen checks. Ordinary glossary Save reproduced
the disabled term becoming enabled. Fast-completion tests failed before the
completion observer and preserve pending drafts as conflicts after the fix.
Definitive missing-suggestion responses release their exact acceptance receipt;
network, server and offline-source uncertainty still retain it. Captured scope
guards prevent late responses from clearing newer recovery state.

Independent review of that remediation also reproduced startup completion
refresh superseding a recovered-draft load, and a delayed reconciliation read
marking a false conflict after autosave had already succeeded. Focused tests
execute the actual component and durable queue, including preserved provider
conflicts and uncertain request receipts. Completion refresh now waits for
initial recovery. Reconciliation binds reads to their draft base and waits for
unresolved saves/receipts, including the server-committed/lost-acknowledgment case.
The 25 focused component/queue tests passed, with real SQLite proving identical
request retry produces one committed manual revision. All three final focused
browser cases also passed before the complete 49-case rerun.

The final full rerun at `807bc90` passed all nine local gates, 729 unit/integration
tests and 49 browser cases with zero skips/retries. Independent read-only review
reran the original race reproduction: the late read now leaves `saved`, the
acknowledged manual revision and `nextFlush=true`. Its five focused real SQLite
regressions passed again; no further P1/P2 was reproduced. Final candidate GitHub
review/thread state and exact-head CI remain the publication readiness checks.

## Fourth PR review remediation

The documentation head `30586d402d460b6905a3e6130881af1d455466f4` passed
[PR CI](https://github.com/bynanci/open-film/actions/runs/37452568255), while
[push CI](https://github.com/bynanci/open-film/actions/runs/37452562638) failed its
browser step. Native checks passed in both. This earlier candidate is not an
all-green publication gate.

Annotations name two browser failures (47 passed). Signed logs/artifacts were
unavailable, so their exact timing is not asserted. A controlled reproduction
using the actual App functions and editor queue proved an enabled project switch
could reject a clean in-flight provider refresh as a failed save. A separate
reproduction proved the test's late jobs interception failed on the ordinary
no-project response during cleanup. A real browser before/after test then held a
successful provider read: the original Switch intent failed before the change
and completed after it, within the same five-second assertion bound. Both focused
CI cases passed after explicit interception cleanup and the read/flush barrier.
No timeout increase or retry was used. Complete reruns remain separate evidence.

Codex identified four more P2 cases: removing the only row on the last transcript
page left the editor beyond its end; undo/history changes retained an obsolete
Remember correction; valid opaque IDs failed URL encoding or exceeded request-line
limits; and asset IDs matching CLI action names could not be read unambiguously.
Actual SQLite/component/browser and bundled CLI reproductions failed before the
changes. Focused actual-client/HTTP tests passed 14 cases, all catalog suites
passed 52 cases (including nine new identity/migration regressions), and ten
bundled CLI grammar tests passed. The two new browser regressions passed; the
fresh complete run is recorded separately.

The ID transport reproduction also exposed a catalog correctness issue: SQLite's
native UTF-8 binding made an isolated UTF-16 surrogate collide with literal
U+FFFD. Catalog v4 uses injective JSON-string index keys and transactionally
rebuilds only segment indexing from original canonical JSON. Original IDs and
non-key evidence are retained; quoted IDs cannot collide during the rebuild.
Malformed legacy data rolls back rather than partially relabeling the database.
Desktop exact lookup uses bounded JSON POST; the legacy GET remains supported.

Independent lifecycle review also reproduced forced startup disposal deleting an
unhydrated recovery draft. Normal guarded UI navigation was not shown to trigger
that disposal. A minimal retention guard now preserves exact bytes before read or
ACK recovery can publish state. Actual SQLite tests cover both unsent commands
and a server-committed/lost-ACK receipt across the next reopen, with one manual
revision and exact request replay. All 48 focused queue/component cases passed.
Independent proofs cover late responses, unsent suffixes, provider conflicts and
repeated failed GET/ACK attempts; no new correctness blocker was reproduced.

The clean-read error policy is explicit: the transition waiting on a failed read
is refused and retains its feedback. A fresh explicit navigation may leave only
when there is no pending draft or receipt, so offline media cannot trap a clean
project. Failed saves and uncertain receipts still require safe recovery.

The resulting tree `02b4337b807fd669835251a3a0352855675bb543` passed all nine
local gates: 774 unit/integration tests in 71 files and 51 browser cases in
9.8 minutes, without failures, skips or retries. A final independent text review
nevertheless reproduced case-insensitive glossary matching missing long-s and
Greek final-sigma forms that literal transcript search/replace already recognized.
That Unicode-folding discrepancy requires its own correction and new-head
verification; earlier green tests alone do not close that review boundary.

The glossary trie now uses bounded Unicode simple-fold keys validated by the same
`/iu` equivalence as literal search. Exact source shadowing and case-sensitive
matching are unchanged. Five focused tests failed before the change; all 60
Core/application cases passed afterward, including actual offline suggestions,
Accept, Undo, reopen and provider/source evidence preservation. An independent
temporary conformance script scanned 1,112,064 valid scalars and checked 2,990
engine-equivalent transforms plus 1,426 single-codepoint Unicode 15 fold pairs,
with no mismatch in those checked pairs. This is a developer conformance record,
not a proof of every possible string or a production latency guarantee.

A separate pairwise review still found three missing Unicode simple-fold classes:
`ΐ`/`ΐ`, `ΰ`/`ΰ` and `ﬅ`/`ﬆ`. Their full uppercase conversions expand into
multiple codepoints, so upper/lower conversion alone is insufficient. The
exported matcher reproduced all six directional omissions. Twelve new directional Core/application regressions failed before the correction.
Explicit single-scalar candidates, still validated by the runtime `/iu` engine,
now pass all 72 focused cases without accent normalization or multi-character
expansion. Actual SQLite suggestions, acceptance, Undo, reopen, original timing
evidence and film isolation are covered in both directions.

The unchanged independent oracle then passed 9,223,369 pairwise comparisons among
all 3,037 engine case-changing scalars, plus 1,112,064 scalar key-stability and
false-positive checks and 179 exported-matcher range checks. This is evidence for
the inspected Node 24 / Unicode 17 runtime, not all possible strings, future
Unicode versions or locale-specific normalization.

## Fifth Codex review

The documentation head `93abf055a8fa38cc3a92e61e63ed54bb722617c5` passed both
[push CI](https://github.com/bynanci/open-film/actions/runs/37461542422) and
[PR CI](https://github.com/bynanci/open-film/actions/runs/37461549911).
Its completed Codex review nevertheless identified four more P2 cases: rapid
Accept clicks sharing a pending flush could replace the first recovery receipt;
maximum-size selection validation made a nested segment scan; batch Retry could
send old text before autosave; and both child editors repeatedly polled the same
unpaged job history already read by their parent. That earlier green CI does not
close these correctness findings; remediation and current-head verification are
required separately.

A maximum-selection regression instruments only the first actual SQLite-loaded
transcript snapshot and captures its ID-read count at job reservation. It failed
before the change with 50,015,000 reads for 10,000 selected IDs; indexed membership
passes its 30,000-read linear bound. All 50 application knowledge tests passed,
including selection order, invalid inputs, opaque IDs and selected-text privacy.

Review actions now reserve their operation before publishing busy state or
awaiting a save. Navigation awaits preparation and transport together; a second
Accept cannot replace the first exact receipt. Retry confirms uncertain
acceptance independently, while batch Retry first saves and then validates its
original revision before provider invocation. Nine new operation tests failed
before this correction; the actual Vue/SQLite and existing receipt suites pass
23 cases with no unhandled errors.

App remains the sole project/generation-guarded job-history reader. Both child
editors consume its snapshot; a 10,000-job component regression records zero
child jobs reads. Fast completion, progress/cancel, initial recovery and manual
conflicts remain covered by 20 component tests. The combined focused regression
run passes 112 tests; independent overlap and snapshot reviews reproduce no
further P1/P2 in those boundaries. Complete browser and current-head CI/review
remain separate checks.

Three additional actual-browser regressions pass before the complete rerun:
rapid native Accept clicks while a real manual save is held; cancelled-batch
Retry waiting for that save and retaining its original batch evidence; and real
review progress/cancellation with job requests originating only from App. The
first focused attempt passed two cases and failed an incorrect synchronous HTTP
expectation in the Retry test. That endpoint acknowledges a queued job with 202;
its worker then records `review.suggestionStale` before another provider attempt.
The corrected test asserts that asynchronous sequence, the unchanged batch and
the saved manual revision. All three passed in 38.4 seconds without timeout
increases, skips or retries; the first failure remains part of the evidence.

The final production/test tree `0dcbcab` then passed all nine local gates: 814
unit/integration tests in 72 files and 54 browser cases in 10.3 minutes, with zero
failures, skips or retries. All 21 Codex findings across five review rounds have
implementation and regression evidence. Published replies, resolved threads and
fresh exact-head GitHub CI/review remain separate final PR readiness checks.

## Sixth Codex review

The documentation head `e54b5e522f8116cfb2e69b37244fb3abdf5e5a4a` passed both
[push CI](https://github.com/bynanci/open-film/actions/runs/37468470250) and
[PR CI](https://github.com/bynanci/open-film/actions/runs/37468477418).
Its completed review nevertheless found five additional P2 cases: SQLite TEXT
truncation hiding search matches after NUL; Desktop restricting valid glossary
replacements to 512 characters and a single line; Remember hiding valid long
corrections; CLI transcript reads omitting the editable revision token; and rapid
Undo/Redo overwriting the receipt while awaiting a pending save. Green CI did
not close these findings.

Canonical escaped text is now projected before matching rows containing NUL or
U+FFFD. Independent reproduction also confirmed isolated-surrogate legacy text
was normalized into U+FFFD by native SQLite TEXT conversion. Both boundaries
preserve exact source text and offsets without false replacement-character hits.
Nine real catalog/application/migration regressions failed before; all 40 focused
tests passed afterward, including paging, legacy-v2 reopen and bounded full-row
reads. Core text validation is unchanged: invalid legacy text can be searched,
but replacements that retain invalid controls are rejected without a revision or
receipt. An explicit valid whole-segment correction then permits normal edits.

The shared glossary limits remain 512 UTF-16 units for source and 4,096 for
replacement. Both Desktop fields now support multiline terms and preserve empty
replacements, scope and enabled state; Remember uses the replacement bound.
Fourteen actual SFC/SQLite regressions cover valid boundaries, invalid over-limit
values and project/global persistence. Five original contract tests failed before;
the final 58 focused cases passed. Literal line endings remain stored evidence;
the browser uses its native textarea input behavior.

Both CLI transcript read forms return an editor revision and document while
retaining earlier intelligence fields and aliases from the same editor page.
Four bundled CLI tests failed before, then all 28 read/grammar/adapter cases
passed. They use the emitted revision to edit, Undo, Redo and reopen real SQLite
projects, including reserved asset names and opaque segment IDs.

Undo/Redo now reserve their operation before waiting for manual-save preparation.
Navigation waits for preparation and acknowledgement together; the operation's
internal save path avoids awaiting its own barrier. Two actual SQLite regressions
failed before, then 66 focused queue/component cases passed. Lost history ACK
recovery replays the original receipt and records one history change. Independent
review additionally identified revision Restore needing the same ownership
boundary. Two actual SQLite reproductions showed the requested Restore being
replaced by keyboard history before dispatch. Restore now shares the same
reservation helper; six new tests cover both ordering directions, failed
preparation, disposal and lost-ACK reopen. All 72 focused queue/component cases
passed. This related Restore finding and the surrogate-text search finding came
from independent review, rather than the five Codex threads.

Both new browser regressions passed on `acc8958` in 34.0 seconds without skips or
retries. Genuine rapid buttons and keyboard shortcuts exercise held manual saves,
history/Restore lost acknowledgements, exact replay, reload and explicit Retry;
actual SQLite revisions and Story/source isolation are checked. The other case
creates, edits and accepts a 4,096-unit multiline replacement, remembers a long
manual correction and verifies exact text after reopening.

The frozen production/test tree `acc8958` then passed all nine complete local
gates, 851 unit/integration cases in 74 files and 56 browser cases in 10.4 minutes,
with no browser failures, skips or retries. Built CLI smoke also passed. All 26
Codex findings across six rounds now have implementation and regression evidence;
published replies, resolved threads and fresh exact-head GitHub CI/review remain
separate final readiness checks. The native gate compiles a test harness with zero
native behavior tests; actual hardware and NLE gates remain manual.

## Desktop QA

New focused browser cases cover the offline edit/split/merge/search/replace/history
flow, glossary Accept/Skip, provider streaming/cancellation, save/reopen, lost
responses, concurrent revision conflicts, input-focus history, delayed Accept,
out-of-order glossary/search reads, stale-word snap exclusion and delayed
glossary Save/Remember/toggle/remove requests across project switching. They compare
actual Story/composition state and original source hashes, and keep a rendered
film preview current after text-only editing.

Visual cases exercise en-US, zh-TW, ja-JP and the expanded en-XA pseudo locale at
1280×720, 1440×900 and 1920×1080. Assertions bound rendered rows/cards, check
horizontal overflow and clipped controls, and run axe against core WCAG AA rules
at 1280×720. Screenshots cover Transcript, Glossary and Suggestions. Automated
axe coverage is not a complete human accessibility certification.

Manual screenshot inspection found that scrolling to text could hide the source
player despite a visible DOM element. Final English, Traditional Chinese,
Japanese and pseudo-locale screenshot inspection confirmed readable controls and
a visible player at small desktop size. Regression checks now require actual
viewport/scroll-container intersection and a decoded frame, including after row,
search and suggestion seeking; DOM visibility alone is insufficient.

The final rerun retained 36 named Transcript, Glossary and Suggestions captures.
Manual inspection covered all four 1280×720 Suggestions screens and additional
Transcript/Glossary captures. Controls and wrapped text remained readable with
vertical scrolling and no new horizontal clipping. One small English Transcript
capture still contains Chromium's native buffering indicator despite successful
decoded-frame, seeking and player-geometry assertions. This snapshot limitation
is retained in the evidence; it is not continuous-playback or hardware QA.

## Generated text performance observations

Run `pnpm exec tsx scripts/benchmark-transcript-productivity.ts output.json` to
reproduce the generated workload. The script uses an isolated temporary project,
asserts match counts/page bounds, records source hashes and separates setup,
query-only and warm application-wrapper timings. It does not decode audio or
invoke a provider.

Observed on 2026-10-06 at repository head
`acc89583c90e6e58f847023cc5a271e699e38616`, Node 24.14.0, SQLite 3.51.2,
Linux x64, AMD EPYC 7763 on this shared development machine:

- 10,000 segments / 1,386,568 generated text characters; six literal queries,
  five samples each, at most 100 returned segments. Query-only medians ranged
  **9.23–43.83 ms**, with a recorded maximum **46.79 ms**. Case-sensitive,
  case-insensitive, CJK, symbols, absent terms and late pages were verified.
- Database seeding took **91.25 ms** and is outside the search interval.
- 1,000 exact glossary terms over 10,000 generated short lines: one run without
  warm-up, **13.06 ms** matcher compilation and **51.62 ms** scanning, including
  constructing the strings. All 10,000 matches were checked.

These observations are not latency guarantees, real ASR/LLM benchmarks, cold-cache
measurements, or large immutable-revision write/100,000-segment archive benchmarks.
No claim of real transcription quality or speed follows from them.

For maximum-size review selection, run
`pnpm exec tsx scripts/benchmark-review-selection.ts output.json`. This generated
SQLite fixture selects 10,000 IDs in reverse order and verifies 100 cancelled
batches retain transcript order. On the same shared host, at
`acc89583c90e6e58f847023cc5a271e699e38616`, five preparation samples had a
**20.81 ms** median and **19.74–30.56 ms** range. Setup took **58.56 ms**, including
**46.45 ms** seeding, outside the interval. Preparation includes source
verification, transcript loading, selection validation, partitioning and initial
queued-job persistence; later batch writes, cancellation and full review are
excluded. The output records exact source/runtime/fixture hashes. This is not
ASR, model latency, full-review throughput or a performance guarantee.

## Limits and manual gates

Real model CPU quality, GPU performance, camera audio, large 4K media, Windows
installation and actual DaVinci Resolve import remain manual workstation/hardware
gates. Deterministic transcription/language fixtures establish protocol, revision,
privacy and user-workflow behavior; they do not certify model accuracy or real NLE
compatibility.

Text commits store validated immutable snapshots; Undo history is bounded to 100
references, but revisions and durable request receipts are retained. Large
repeated-edit storage compaction is deferred. The optional review test fixture
does not establish any commercial/local language model's correction accuracy.
