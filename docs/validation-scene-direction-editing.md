# Scene-direction editing validation

## Candidate identity

- Inspected main: `c1b198f3a8a413a5500453f34127c1b6a5850be9`.
- Integration base: PR #19 head
  `298077fdfe4937b0c9d9e11f272d409b18fb3960` on
  `codex/windows-owner-recovery-cinematic`, itself stacked on photo-film PR #18.
- Working branch: `codex/scene-direction-review`.
- Feature implementation: `ab6caac05c5112a4d97e87faddd63f6b6c43b1d0`;
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

Local frozen implementation `ab6caac` results (2026-10-18, Asia/Taipei):

| Command                                                                  | Result                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm format:check`                                                      | Passed                                                                       |
| `pnpm test:i18n`                                                         | Passed; 1,318 matching semantic keys and placeholders                        |
| `pnpm lint`                                                              | Passed                                                                       |
| `pnpm typecheck`                                                         | Passed, including Vue                                                        |
| `pnpm test`                                                              | Passed; 163 files, 2,500 tests                                               |
| `pnpm build`                                                             | Passed; existing bundle-size advisory remains                                |
| `pnpm test:interchange`                                                  | Passed; official OTIO 0.18.1, 18 tests, real source/hash/bounds checks       |
| `node scripts/smoke-built-cli.mjs`                                       | Passed; real FFmpeg, CJK title raster, export/reopen                         |
| `pnpm test:e2e`                                                          | 132-case full-run outcome tracked with candidate PR; 11 focused tests passed |
| `pnpm test:native`                                                       | Passed; Rustfmt, Clippy and 7 tests                                          |
| `cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | Passed; Linux Tauri binary build                                             |

The final adapter rerun additionally tightened unknown-action rejection to
HTTP 409 and passed all three adapter tests. Independent final application,
compiler, renderer and Desktop/adapter source review found no further P1/P2
correctness blocker. Published-head CI is tracked separately; these local
observations do not validate an untested future source change.

The environment uses Node 24.14.0, pnpm 11.11.0, local Chromium and official
OpenTimelineIO 0.18.1. Its retained onboarding activation provides Rust 1.99.0
and Linux GTK/WebKit dependencies. Loopback traffic must bypass the environment
proxy; the official parser path is explicitly supplied to browser QA.

## Remaining manual gates

- Judge the actual chosen photo framing/movement and subject protection on the
  private film, with intended display/projection hardware.
- Real Windows/macOS startup, installer and one-hour memory evidence remain
  workstation work. No timing or performance claim is added by these tests.
- Real Pixel/Insta360 media and Resolve import/finishing remain the independent
  gates in issue #7 and the existing workstation guides.
- No arbitrary prose understanding, subject recognition, automatic narration,
  grading or duration/rhythm compilation is certified by this finite vocabulary.
