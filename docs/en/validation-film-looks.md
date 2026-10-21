# Film looks validation

Date: 2026-10-18. Base main:
`90921dc4546ad58efc612b1c79f40ffa66ffb043`.
Branch: `codex/film-look-presets`. Published exact-head CI and review outcomes are
recorded with the candidate PR; local evidence below does not replace them.

## Executed focused checks

- Core/Solver: 631 tests across 21 files, including validation, inheritance,
  explicit original versus inherit, strength, protected sources, undo-safe pure
  commands, immutable registry metadata and a version-1 coefficient golden hash.
- Exporters: 70 tests across four files, including 21 new look cases. Saved and
  effective metadata, active versus no-op looks, audio/title exclusion and
  unsupported-format failures are covered. These tests do not verify NLE rendering.
- Application/HTTP/CLI: nine new tests across two files. Actual FFmpeg output
  manifests verify immutable override snapshots, preserve/null behavior,
  non-MP4 rejection, invalid requests before job creation, ordinary saving,
  idempotent retry, Undo/Redo, reopen and unchanged source/timing/Story data.
- Renderer: existing and new generated renders were exercised with FFmpeg 7.1.5;
  the initial look/photo-quality group also passed 19 tests with FFmpeg 6.1.3.
  Focused provenance plus look tests passed 11 tests after the manifest follow-up.
  Actual channel fixtures include opacity/partial alpha and tagged PQ ordering.
- Browser: nine new cases passed, including actual rendered output,
  saved three-scope edits, Undo/Redo/reopen, protected edit rejection,
  render-only override snapshots and editable-export isolation. The dedicated
  native-video-controls regression also covers keyboard seek/input focus,
  play/pause/Space, volume, trim and unfiltered title/transport rendering.

Tests were observed failing before their implementations. Follow-up regressions
also observed missing provenance metadata and lost protected-error identity
before their fixes. The latter now preserves `timeline.lookLocked`, HTTP 409 and
`{count}` through the application instead of replacing them with a generic 400.
Independent Desktop review identified filtering of native video controls; the
correction disables those controls only for an active look and retains labeled,
unfiltered keyboard-accessible transport. Original/zero strength restores them.

## Actual pixels and visual coverage

Raw RGBA channel tests compare against an 8-bit rounded reference with maximum
absolute error 1; encoded generated SDR color fixtures use error 3 per channel.
Browser screenshots for all six actual SVG looks were compared with encoded
FFmpeg PNG samples at the same error-3 bound. These are measured fixture limits,
not a promise of matching arbitrary source decode, HDR transfer or display color.
Thresholds were not loosened to make the tests pass.

Edit and Export layout cases cover en-US, zh-TW, ja-JP and en-XA at 1280×720,
1440×900 and 1920×1080, including long pseudo strings. The initial run retained
24 layout screenshots and six parity screenshots outside the repository. The
zh-TW small-desktop Edit and pseudo-locale Export images were visually inspected;
source-control correctness is checked separately from layout/pixel assertions.

## Full regression and published evidence

Required candidate commands:
`pnpm format:check`, `pnpm test:i18n`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm test:e2e`, `pnpm test:interchange`, `pnpm test:native`, the
locked Linux Tauri build and built-CLI smoke. Exact-head results are recorded in
the candidate PR checks and verification comment, separately from these focused
results. Unexecuted checks are not successes.

The corrected local candidate passed format, 1,363-key i18n coverage, lint,
TypeScript/Vue checks, 174 files / 2,586 Vitest tests, build, 18 official-parser
tests, built-CLI smoke, seven Rust tests with Rustfmt/Clippy, and the locked Linux
Tauri build. Its nine focused browser cases passed again on Vue 3.5.42 with the
new input policy (48.3 seconds). Full browser results are recorded separately in
the published verification ledger so that focused results are not substituted
for full regression.

The first full browser run exposed an export-action layout regression in all
four locale cases: the new controls pushed the primary MP4 action below the
initial viewport. That run was stopped with 48 passes, four failures, one
interruption and 93 unrun cases; it is not a passing full result. Moving the same
action above the optional output-look controls preserves handlers and selectors.
All 17 focused Desktop/film-look/global-visual cases then passed, retaining the
original full-visibility assertion. New checks cover both preserve/unify modes
at 1024, 1280, 1440 and 1920 widths without loosening layout or accessibility gates.

The first full run exposed missing dependencies in three extracted-component
test hosts (36 failures); their 118 focused tests passed after updating the hosts
without removing assertions. Security input hardening then rejected PPM sources
used only by new application/adapter tests. Those fixtures now generate genuine
PNG files; all nine affected tests pass without expanding the public format
allowlist. Earlier failing full runs do not validate the corrected candidate.

The security follow-up and current Apache-2.0 policy, preserving the earlier
GPLv3 distribution grants superseded by [ADR 010](adr/010-apache-license-restoration.md), are described in
[the security review](security-review-2026-10-18.md) and [licensing](licensing.md).
The original Apache grants are retained. License metadata changed without changing
recipe coefficients or their numeric version.

## Post-merge import completion regression

PR #21 was merged as `7eb9aaa0407a521c635a24b7b08a2e2d173e8523`, with the
same tree as its reviewed candidate `c5eaba39559b8fff986a6aa2330251038a14f306`.
The candidate's exact-head Verify run `39125515398` passed all 146 browser cases.
The subsequent main run `39127501179` passed native and every non-browser gate,
but finished with 145 browser passes and one Proposal workflow failure: the
second import's raw Insta360 asset was absent from the Library despite completion.
These are separate results; the passing candidate run does not erase the failure.

The underlying race is now reproduced without relying on timing luck. A browser
test holds an existing jobs poll, runs a real second import to completion before
releasing its POST acknowledgement, then lets `refreshJobs()` see the terminal
snapshot first. Previously that consumed the only transition used by `pollJobs()`
to reload media. The test failed on the same missing asset, then passed after the
fix (9.8 seconds). Four new unit cases also failed before the fix; all eight new
cases and 23 existing cancellation/recovery cases passed afterward.

The correction refreshes assets, project and media availability when a fresh,
owned jobs snapshot first reports a terminal import, including partial failures
and cancellations. Superseded responses and other projects cannot publish it;
unchanged render progress still does not reload the catalog. Full follow-up CI
outcomes are recorded in the follow-up PR rather than inferred from focused tests.
Initial boot/reopen reads jobs before the existing initial asset/status load and
explicitly skips this supplementary refresh, avoiding duplicate catalog/source
scans for historical imports. The additional startup case plus cancellation and
native-readiness regression group passed 104 tests; the deterministic import and
complete Proposal browser workflows passed together (two tests, 43.8 seconds).

The first follow-up candidate's automated review then identified two P2 failure
paths: an initial jobs error could abort media loading, and a failed assets refresh
could consume the completion transition without retaining a retry. Eight added
unit cases reproduced premature publication, lost retries and stale ownership
after an awaited refresh. The corrected 18 import cases and 23 cancellation cases
passed together. That intermediate correction made initial Activity reads
best-effort and delayed jobs/signature publication until media reads succeeded;
the final contract below supersedes that publication behavior.
A separate browser case holds later polls and fails the initial jobs read: it
failed against the first candidate, then passed with the correction (5.7 seconds).
The new fast-import regression also waits for the first import's final status
before blocking polling, because partial media can correctly appear earlier.
No timeout or visibility threshold was relaxed.

The obsolete full local browser run was stopped with 81 passes, one interruption
and 65 unrun cases when those review blockers were found. Its matching remote
candidate runs were cancelled. Neither is treated as a passing full regression;
final exact-head results remain in the follow-up PR checks and verification record.
Both final browser failure-path regressions plus the complete Proposal workflow
passed (three tests, 43.2 seconds); the corresponding import/cancellation/native
readiness unit group passed 113 cases. One local full unit run overlapped the
browser server on port 4310 and failed 13 native benchmark runner cases while
2,591 others passed. Those suites must run sequentially; this failed run is not
treated as a source regression fix or as a passing gate.

Further review of `16c5ae0` identified three more failure paths: previous-project
Activity could survive initial jobs failure, source-status errors were swallowed
without retry, and delayed publication could keep a finished render looking busy
when an unrelated asset read failed. Its local browser run was stopped at 52
passes, one interruption and 95 unrun cases; matching remote runs were cancelled.

The final implementation publishes owned jobs/cancellation evidence immediately
and tracks required media refreshes separately with a project-owned token. Failed
assets/project/source-status reads retain that token, so even an unchanged jobs
snapshot retries. Only one media worker runs per project; an older completion
cannot clear a newer token. Running import progress reloads the Library without
scanning every source, and unchanged render progress does neither. Boot, close and
project reset clear scoped jobs and previous media. Initial loading waits for its
media read, uses one normal scan and retains failures without an infinite retry.
An optional ownership predicate is checked inside `refreshProject()` before
assigning a delayed result, preventing old-project responses from overwriting a
new view. The tests exercise these actual helpers and the real status-read result.
Final focused browser verification passed both failure-path regressions and the
complete rendered/exported Proposal workflow (three tests, 45.8 seconds).
Additional tests prove a synchronous read error releases the worker and persistent
source-status failure leaves a bounded startup attempt plus a later background
retry. Full regression results for this final implementation are recorded against
its exact commit in PR #22.
The first ledger full run found six failures in the extracted foreign-analysis
navigation host (2,617 passes): it did not provide the new reset helper or media
summary refs, so the real close function could not finish. The host now executes
the actual reset helper. Its immutability assertion still checks the captured
foreign job/recovery objects and original project, while additionally checking
that only the detached UI caches are cleared. All 35 navigation cases passed;
foreign runtime analysis is still neither cancelled nor manually recovered.

The next review caught a superseded-read acknowledgement: a pending worker's
assets request could be discarded by a newer Library search whose own request
then failed. Void return values incorrectly allowed the worker to clear its
retry. `reloadAssets()` and `refreshProject()` now explicitly return whether their
response was applied, including guarded/discarded and empty-Missing-view cases.
The worker requires actual success from both, and the Missing Media status path
propagates a discarded nested asset read. Seven failing-before-fix cases include
real overlapping requests and require a third read on an unchanged jobs poll.
The corresponding obsolete local browser run was interrupted after 47 passes,
one interruption and 100 unrun cases; matching candidate CI runs were cancelled.

## Manual boundaries

The source editing monitor is approximate. Existing Hable HDR conversion ends
in BT.709; SVG requests browser sRGB and this feature does not add transfer
conversion. Rendered preview/output is authoritative. Real skin tones,
camera/HDR clips, mixed color profiles, wide-gamut/display appearance, artistic
preference and projection require viewing actual output on intended hardware.

Windows/macOS installers, native first-open/one-hour memory, real Pixel/Insta360
material and actual Resolve import/finishing remain separate workstation gates
([issue #7](https://github.com/bynanci/open-film/issues/7)). No cloud fixture closes
them. No performance benchmark was conducted for this creative-color feature.
