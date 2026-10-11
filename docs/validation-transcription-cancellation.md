# Transcription cancellation validation

Base: merged main `34b6ff093294f97061dfb0ecb270413a52b6b7ee`, after PR #5 and
PR #6. This slice fixes logical cancellation of a transcription provider that
does not settle its Promise after receiving AbortSignal.

## Reproduction and implementation

Four new application regressions failed before the fix: cancellation remained
unsettled and `hasActiveJobs` stayed true until the test released the provider.
The HTTP reproduction also failed both resolve/reject cases because the Job
remained `running` after a successful cancellation response.

The existing review cancellation boundary is now an internal application helper
shared with transcription. Cancelling settles the application wait, closes
provider progress callbacks, persists the cancelled Job and releases the existing
application/HTTP guards. Both late resolution and rejection are consumed. No new
SDK contract, Core abstraction, database schema, or composition engine is added.

## Focused evidence

- Six application regressions pass: held-provider cancellation, immediate retry,
  manual revision preservation, close/reopen, late resolve/reject and retained
  callbacks, pre-aborted invocation and same-turn result/abort races.
- Two real HTTP regressions pass with generated WAV media, saved recognition,
  Story/composition, project close/open, successful retry, immutable cancelled
  Job, late provider results/failures and unchanged source bytes.
- Three real-browser cases pass with one worker and zero retries: en-US, zh-TW,
  ja-JP at 1280×720. A private local server injects an explicit held provider;
  page traffic uses real HTTP rather than fabricated responses. UI Cancel,
  retry, Close/Open, saved word-timed text and a trimmed locked composition are
  checked while the obsolete provider remains unresolved. Late callbacks/results
  cannot replace either terminal Job or successor text.
- Existing provider boundary, source/cache, review, batch race and ownership
  suites pass. An independent review exercises eight pure-helper abort/settlement
  probes with listener cleanup and finds no new correctness blocker.

Initial new-browser fixture runs failed because required provenance version was
missing or did not match the current analysis cache version; one import/setup
attempt ran zero tests. Those runs are failures or not run, respectively. The
fixture now uses analysis version `1`, a separate provider version, and asserts
the prior transcript actually exists. No production validation was weakened.

## Complete candidate gate

Source/test head: `eeb81abc17763dc16f8cf903cc7bb25c65e86b03`.
All nine required local gates passed: format, i18n, lint, TypeScript/Vue typecheck,
unit/integration, build, browser, official OTIO interchange and native checks.
The unit/integration run passed **1,029 tests in 92 files**. I18n validated
**1,028 semantic keys** across en-US, zh-TW and ja-JP. Built CLI import, intelligence,
render, export and reopen smoke also passed. The official OTIO 0.18.1 parser,
read/write/read, source bounds/hashes and 18 workstation-helper regressions pass;
advanced interchange edits still require manual recreation.

The complete real-browser suite passed **64 cases**, zero failures/skips/retries,
one worker, in 12.4 minutes. Both before/after heads were exactly the source SHA
above, both checkouts were clean, and all 11 captured source/test hashes matched.
The three new cancellation cases passed inside this full run. Existing layout,
accessibility and keyboard tests covered 1280×720, 1440×900 and 1920×1080;
en-US, zh-TW, ja-JP and pseudo-localized screens produced 174 screenshots.
Native format/Clippy/test harnesses pass but execute zero behavioral Rust tests;
actual native-window behavior remains unverified.

Independent scoped review found no actionable P1/P2 defect; eight private helper
race/listener probes passed. GitHub Codex completed the source-head review at
2026-10-07T16:19:07Z without findings or review threads. The final evidence update
changes documentation only. Latest published-head CI and review are tracked in
[PR #8](https://github.com/bynanci/open-film/pull/8); source-head checks must not be
substituted for the final published head.

Merged base main `34b6ff093294f97061dfb0ecb270413a52b6b7ee` passed
[Verify 37648282755](https://github.com/bynanci/open-film/actions/runs/37648282755),
including both jobs and 61 browser cases after PR #5/#6 convergence.

## Limits

This is cancellation/storage/UI evidence, not speech recognition or speed
measurement. Physical execution remains the provider's responsibility; the
bundled Whisper adapter retains its child-process cancellation. Arbitrary
third-party execution is not forcibly killed by this helper.

Real Resolve, speech/model quality, GPU, Pixel/Insta360 camera material, sustained
4K and Windows/native-window installation remain workstation gates. Native Rust
harnesses do not establish GUI behavior. Automatic ownership-aware recovery of
non-review media-analysis jobs is the next separate pain point.
