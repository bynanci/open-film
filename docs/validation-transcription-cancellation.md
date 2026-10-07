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

Full format, i18n, lint, typecheck, unit/integration, build, browser, official OTIO
interchange and native gates are pending on the frozen candidate. Exact source
SHA, counts and CI/review results will be recorded after execution; earlier PR
checks do not establish this candidate's success.

## Limits

This is cancellation/storage/UI evidence, not speech recognition or speed
measurement. Physical execution remains the provider's responsibility; the
bundled Whisper adapter retains its child-process cancellation. Arbitrary
third-party execution is not forcibly killed by this helper.

Real Resolve, speech/model quality, GPU, Pixel/Insta360 camera material, sustained
4K and Windows/native-window installation remain workstation gates. Native Rust
harnesses do not establish GUI behavior. Automatic ownership-aware recovery of
non-review media-analysis jobs is the next separate pain point.
