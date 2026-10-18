# Scene-direction editing validation

## Candidate identity

- Inspected main: `c1b198f3a8a413a5500453f34127c1b6a5850be9`.
- Source base: PR #19 head
  `298077fdfe4937b0c9d9e11f272d409b18fb3960` on
  `codex/windows-owner-recovery-cinematic`, itself stacked on photo-film PR #18.
- Working branch: `codex/scene-direction-review`.
- Integration target: `main`, through [PR #20](https://github.com/bynanci/open-film/pull/20),
  retaining the audited #17 → #18 → #19 ancestor heads through a merge commit.
- Corrected implementation: `ecedb64718f921f74e6c44e42e87a0a325573335`.
- Initial feature: `ab6caac05c5112a4d97e87faddd63f6b6c43b1d0`;
  opaque CLI identity fix: `adeb996`;
  preceding FFmpeg compatibility fix:
  `7df7d890596aa0ee31a6a8fdfe817e546fb9415d`.
- Published head, PR, full browser outcome and exact-head CI are recorded in
  the candidate PR checks and validation comment. Branch runs are available in
  [GitHub Actions](https://github.com/bynanci/open-film/actions?query=branch%3Acodex%2Fscene-direction-review).
  Local results below do not certify an untested head or the unchanged base's failed checks.

The base's media verification failed its actual fractional-frame render tests
under FFmpeg 6. Overlay enable was evaluated against both inputs' differing frame
counters. The candidate uses rounded shared output timestamps instead. The same
26 render/photo tests pass under static FFmpeg 6.1.3 and system FFmpeg 7.1.5,
without loosening pixel assertions. This is a compatibility repair, not a native
performance measurement.

## Focused implementation evidence

- Pure compiler: 84 tests; 126 compiler/photo-quality tests together passed.
- Application/core: 158 focused tests passed, covering ordinary editor isolation,
  source relocation, acceptance/retry and validated receipts.
- HTTP/CLI: 3 integration tests passed after first observing missing-route/command
  failures. They exercise passive preview, actual project persistence, Undo/Redo,
  selected subsets, stale rejection, reopen and Unicode/CJK/space/`#`/`&` paths.
- Desktop: 11 focused browser tests passed, including temporary monitor preview,
  selected-subset geometry, stale review, current server context, lost response
  and reload, storage-write prevention and publication-conflict reopening.
- Layout coverage: English, Traditional Chinese, Japanese and pseudo locale at
  1280×720, 1440×900 and 1920×1080, with upper controls and acceptance footer
  captured. These are bounded generated-fixture checks, not private-film QA.
- Independent compiler/render review found no blocker. Application review found
  three real issues: plan-level dedupe after Undo, moved managed source preview,
  and stale external-writer receipt acknowledgment. All were fixed and independently
  rechecked with five targeted tests; no remaining blocker in that scoped review.

## Full regression gate

Local corrected implementation `ecedb64718f921f74e6c44e42e87a0a325573335` results (2026-10-18, Asia/Taipei):

| Command                                                                  | Result                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm format:check`                                                      | Passed                                                                       |
| `pnpm test:i18n`                                                         | Passed; 1,319 matching semantic keys and placeholders                        |
| `pnpm lint`                                                              | Passed                                                                       |
| `pnpm typecheck`                                                         | Passed, including Vue                                                        |
| `pnpm test`                                                              | Passed; 163 files, 2,505 tests                                               |
| `pnpm build`                                                             | Passed; existing bundle-size advisory remains                                |
| `pnpm test:interchange`                                                  | Passed; official OTIO 0.18.1, 18 tests, real source/hash/bounds checks       |
| `node scripts/smoke-built-cli.mjs`                                       | Passed; real FFmpeg, CJK title raster, export/reopen                         |
| `pnpm test:e2e`                                                          | 133-case full-run outcome tracked with candidate PR; 14 focused tests passed |
| `pnpm test:native`                                                       | Passed; Rustfmt, Clippy and 7 tests                                          |
| `cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Passed; Linux Tauri binary build                                             |

The corrected adapter run passed eight tests, including exact opaque comma-bearing
IDs for both targets and action subsets, malformed identity arrays, and explicit
HTTP 409 unknown-action rejection. Independent final application,
compiler, renderer and Desktop/adapter source review found no further P1/P2
correctness blocker. Published-head CI is tracked separately; these local
observations do not validate an untested future source change.

The environment uses Node 24.14.0, pnpm 11.11.0, local Chromium and official
OpenTimelineIO 0.18.1. Its retained onboarding activation provides Rust 1.99.0
and Linux GTK/WebKit dependencies. Loopback traffic must bypass the environment
proxy; the official parser path is explicitly supplied to browser QA.

## Follow-up correctness review

GitHub Codex review of `185b97f` found three P2 issues:

1. A safe selected motion could not preview its prerequisite selected layout.
2. Comma-delimited CLI flags could not represent valid opaque clip/action IDs.
3. Source locks incorrectly disabled otherwise permitted clip-local Story edits.

The complete local browser attempt at that source produced **130 passed / 2
failed**, not a success. The existing Proposal and relink flows both failed on
disabled source-locked controls, confirming item 3. The failed traces were retained
for diagnosis. Final corrected-source tests and exact-head review/CI are recorded
in the candidate PR validation comment; this older attempt remains historical
evidence and is not relabeled as passing. Its [exact-head CI run](https://github.com/bynanci/open-film/actions/runs/39109619750)
likewise recorded the same two failures with 130 successes.

The corrected source passes **14/14** focused scene-direction, Proposal and relink
browser cases. Preview includes selected prerequisites, clears on subset changes,
rejects unsafe skipped prerequisites and works again after reselection. A new
locked-source case saves photo duration/rotation/transition and video trim/speed/
volume while retaining presentation/delete/replace, overlay and clip-lock safety.
The first focused retry reached interchange but lacked its parser environment;
a fresh run with the existing pinned OTIO 0.18.1 path passed all 14 cases.

Independent re-review of both UI corrections passed, including bounded compiled
SFC/solver checks of six permitted source-locked edits and rejected protected
operations. The opaque-identity correction independently passed review and eight
adapter tests. Runtime language examples are visible, and pseudo syntax examples
use executable English phrases. No unresolved correctness finding is knowingly
carried forward; the final published review/CI remain explicit merge gates.

## Remaining manual gates

- Judge the actual chosen photo framing/movement and subject protection on the
  private film, with intended display/projection hardware.
- Real Windows/macOS startup, installer and one-hour memory evidence remain
  workstation work. No timing or performance claim is added by these tests.
- Real Pixel/Insta360 media and Resolve import/finishing remain the independent
  gates in issue #7 and the existing workstation guides.
- No arbitrary prose understanding, subject recognition, automatic narration,
  grading or duration/rhythm compilation is certified by this finite vocabulary.
