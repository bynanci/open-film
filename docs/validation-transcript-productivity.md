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

Catalog v3 transactionally migrates v1/v2 projects and preserves earlier provider
results. No new timeline engine, LLM runtime, caption pipeline, face analysis,
derived film or geometry feature is included.

## Automated evidence

The remediated production/test tree at
`807bc90b4e869e40a3cc1219f6d3f0faf61459b2` passed all required local regression
gates. The complete browser run passed **49 tests** (34 existing, 15 new) with no
failures, skips or retries. The full unit/integration suite passed **729 tests in
69 files**. Documentation finalization follows these runs; current-head GitHub
checks remain the separate merge-readiness evidence.

| Gate                    | Result                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`     | Passed                                                                                                       |
| `pnpm test:i18n`        | Passed: 1,013 semantic keys, three locale catalogs and placeholders                                          |
| `pnpm lint`             | Passed                                                                                                       |
| `pnpm typecheck`        | Passed: TypeScript and Vue                                                                                   |
| `pnpm test`             | Passed: 729 tests / 69 files                                                                                 |
| `pnpm build`            | Passed                                                                                                       |
| Built CLI smoke         | Passed: actual import, analysis, Story, render, reopen and export                                            |
| `pnpm test:e2e`         | Passed: 49 tests, 9.2 minutes, one worker and zero retries                                                   |
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

## Generated text performance observations

Run `pnpm exec tsx scripts/benchmark-transcript-productivity.ts output.json` to
reproduce the generated workload. The script uses an isolated temporary project,
asserts match counts/page bounds, records source hashes and separates setup,
query-only and warm application-wrapper timings. It does not decode audio or
invoke a provider.

Observed on 2026-10-06 at repository head
`757fd74bc1d678fc8a17ab13857db854ffc71249`, Node 24.14.0, SQLite 3.51.2,
Linux x64, AMD EPYC 7763 on this shared development machine:

- 10,000 segments / 1,386,568 generated text characters; six literal queries,
  five samples each, at most 100 returned segments. Query-only medians ranged
  **7.22–31.92 ms**, with a recorded maximum **52.89 ms**. Case-sensitive,
  case-insensitive, CJK, symbols, absent terms and late pages were verified.
- Database seeding took **93.48 ms** and is outside the search interval.
- 1,000 exact glossary terms over 10,000 generated short lines: one run without
  warm-up, **16.90 ms** matcher compilation and **45.40 ms** scanning, including
  constructing the strings. All 10,000 matches were checked.

These observations are not latency guarantees, real ASR/LLM benchmarks, cold-cache
measurements, or large immutable-revision write/100,000-segment archive benchmarks.
No claim of real transcription quality or speed follows from them.

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
