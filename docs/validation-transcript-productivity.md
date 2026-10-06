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

All required local regression gates passed on the final production changes.
The complete browser run passed **43 tests** (34 existing, 9 new) with no failures,
skips or retries. The full unit/integration suite passed **661 tests in 65 files**.

| Gate                    | Result                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`     | Passed                                                                                                       |
| `pnpm test:i18n`        | Passed: 1,007 semantic keys, three locale catalogs and placeholders                                          |
| `pnpm lint`             | Passed                                                                                                       |
| `pnpm typecheck`        | Passed: TypeScript and Vue                                                                                   |
| `pnpm test`             | Passed: 661 tests / 65 files                                                                                 |
| `pnpm build`            | Passed                                                                                                       |
| Built CLI smoke         | Passed: actual import, analysis, Story, render, reopen and export                                            |
| `pnpm test:e2e`         | Passed: 43 tests, 7.7 minutes                                                                                |
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
`f18b28270b979840973b74ba439615654729192c`, Node 24.14.0, SQLite 3.51.2,
Linux x64, AMD EPYC 7763 on this shared development machine:

- 10,000 segments / 1,386,568 generated text characters; six literal queries,
  five samples each, at most 100 returned segments. Query-only medians ranged
  **6.73–33.08 ms**, with a recorded maximum **33.21 ms**. Case-sensitive,
  case-insensitive, CJK, symbols, absent terms and late pages were verified.
- Database seeding took **76.51 ms** and is outside the search interval.
- 1,000 exact glossary terms over 10,000 generated short lines: one run without
  warm-up, **12.57 ms** matcher compilation and **47.93 ms** scanning, including
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
