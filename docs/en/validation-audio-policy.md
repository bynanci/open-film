# D3B1 independent sound — validation

Date: 2026-10-30. Approved design `8c9ad31`; implementation checkpoints
`e360f38` (private PCM), `f012000` (Record/Inspector), `9d4802b` (packet gaps),
`03ce867` (monotonic capability floor), `a4522f7` (retention), `5f83e69`
(canonical identity tempo), `7bd38e1` (actual browser capture and generation
fences). Reviewed Pin dependency `c260deaa` is integrated; its separate review
and gate record remain in [User Pin validation](validation-user-pins.md). The
final audio-specific parent joins and browser results are recorded below.

Toolchain used here: Node 24.19.0, pnpm 11.19.0, FFmpeg/FFprobe 7.1.5 Debian,
Playwright 1.63.0 with Chromium 151.0.7922.173 (`/usr/bin/chromium`). All sources are local synthetic files. No
provider, private-media upload or original-source overwrite is involved.

## Measured gates

| Area                  | Evidence and result                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts/versions    | Closed own-data validators, 1.0/1.1 rejection, frozen old-reader schema rejection, 1.2 floor and future-header no-downgrade; unknown future JSON remains rejected.                                                                                                                                                                                                                              |
| Source clock          | Independent analytic pulses across repeated 20/50/80/150 ms packet gaps, 125 ms delayed audio, negative first PTS and nonzero container start. Every pulse is within one sample at 48 kHz and restored 16 kHz; decoded counts and source hashes match. This proves these fixtures, not every future transcript mapping.                                                                         |
| Canonical phase       | Seven impulse positions use one common baseline; `atempo=1` originally produced nine events. Only canonical 1× omits that processor. Legacy/absent-policy graph and legacy-clock processing remain unchanged. Remaining common limiter delay is 239 samples.                                                                                                                                    |
| J/L and speed         | Off-frame start 252001 samples; picture cut remains frame 180 at 30 and 30000/1001. One-sample PCM edge gate; 44.1 kHz mono AAC, priming and delayed-stream cases at .5/1/2 use independent matching tempo references at error ≤2/2²³.                                                                                                                                                          |
| Actual output         | Actual H264/AAC MP4, PCM WAV and role stems exercise all three policies, unrelated music, repeated assets, boundary-spanning fades/points/ducking and above-unity legacy gain with the existing limiter. Included spectral ratio ±0.5 dB; excluded tone at least45 dB down. AAC burst edge errors are [1,1,1] samples after the single239-sample PCM baseline, within the1024-sample AAC bound. |
| Actual Record capture | Production scheduler + actual OfflineAudioContext + bounded real HTTP PCM. Start0 and arbitrary seek53129 each use six contiguous nodes. Max absolute error0 and block-seam error0 against an independently rendered WAV; allowed bound2/2²³. Controlled offline suspension produces one measured18016-sample scheduling start; it is not hardware latency.                                     |
| Record workflow       | Two focused Chromium cases pass once, no skips/retries/flaky cases (14.96 s). Production Record play/pause/seek, interrupted preparation, Undo and reopen retain one sound owner; legacy audio-element play calls0. Previous PCM descriptor after Undo returns409 even when content revision becomes identical.                                                                                 |
| Persistence           | New retention/exporter/Collect UI gate41/41; existing Named Version (including authentic catalogv5), variants, Collect and exporter regressions71/71. Exact sample objects, mixed same-source uses, pins, ambient photo, Bezier motion, bilingual title, primary color and local preset survive tested workflows.                                                                               |

The canonical filter is
`aresample=48000:async=1:min_hard_comp=0:first_pts=0`. It retains initial
source-local PTS. An initial `asetpts=PTS-STARTPTS` would erase a delayed stream
offset and is deliberately absent. The existing waveform/Whisper path retains
its own first-PTS reset plus explicit stream-minus-container restoration.
Automatic conversion of an old processing domain is not permitted by these
tests. Explicit Sound Apply is the adoption boundary; D4/rhythm must prove their
own saved mapping or return a typed conflict.

## Negative controls

The same timing/spectral/service gates reject these deliberately wrong inputs.
Thresholds were retained; no event-specific correlation or alignment was used.

| Control                              | Observed failed metric or guard                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Admit secondary twice                | +6.020599913 dB; fails ±0.5 dB included-tone gate.                                         |
| Quantize J onset to a frame          | +799 samples; fails ≤1-sample PCM edge gate.                                               |
| Mute the entire primary              | Fails included-primary level outside replacement windows.                                  |
| Restart automation at4 s             | −4.242897225 dB; fails the unchanged-envelope level gate.                                  |
| Bypass suppression for a role stem   | Primary remains in a replaced window; fails ≥45 dB exclusion.                              |
| Change original bytes after capture  | Actual preview service rejects changed source identity/hash.                               |
| Truncate/corrupt PCM                 | Actual WAV/header/hash/read guards reject; no usable ready descriptor.                     |
| Feed the previous preview after Undo | Browser initially received200 (RED); saved-manifest identity fence now returns409 (GREEN). |

Actual browser testing also reproduced two transport defects: a cold picture
caused a second preparation, and integer-frame picture resync caused repeated
seeks. Focused RED→GREEN regressions preserve one in-flight preparation and use
continuous sound phase for picture media. The existing half-source-frame drift
tolerance is unchanged.

## Reproduction and provenance

Run focused gates with one worker:

```sh
pnpm exec vitest run packages/media/tests/canonical-audio.test.ts packages/render/tests/audio-policy.test.ts packages/application/tests/record-audio-preview.test.ts packages/application/tests/audio-policy-persistence.test.ts packages/exporters/tests/audio-policy.test.ts tests/unit/record-audio-playback.test.ts tests/unit/record-monitor.test.ts --maxWorkers=1
pnpm exec playwright test tests/e2e/audio-policy.spec.ts --workers=1 --reporter=json
```

`OPENFILM_AUDIO_EVIDENCE_DIR` optionally saves synthetic source hashes, encoded
and decoded PCM hashes, exact Composition/settings/render options, renderer
manifests/toolchain and measurements. `OPENFILM_QA_CANDIDATE_SHA` binds that
evidence to the tested source candidate. The browser JSON report contains actual
capture/read schedules and the generation-guard result. Media helper arguments
are in `tests/fixtures/audio-policy.ts`; all hand-rendered FFmpeg controls and
assertion windows are executable in `packages/render/tests/audio-policy.test.ts`.

Representative actual AAC burst artifact from the recorded gate:

| Item                       | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| Synthetic48k stereo source | `bad538b6ac06b06de980511a274adcf73e25317ead51769711e1c96b68a692b5` |
| Encoded H264/AAC MP4       | `38a4d70883da24cb7ace73516e6167c8c6cb7ca8aa431b197a24a9b964b5926f` |
| Decoded48k stereo f32 PCM  | `5cb1fbbcb34192b8b7d64f1ad5d3d2ad790314adc0c44f963066023a504cfc54` |

Encoded hashes establish provenance rather than cross-platform codec equality.
The source hash is checked again after rendering. Full-candidate gates and the
independent whole-branch review are appended below when actually executed.

## Remaining external gates

No native GTK toolchain, physical Windows/macOS device, hardware audio latency,
human listening session or real NLE application QA was available in this run.
Those remain open. D3B2 coverage persistence remains unchecked. See the
[guide](audio-policy.md) for preview budgets, silent shuttle and split/relink
limits.

## First full-candidate gate — 804d480

The first complete `pnpm test` run at clean
`804d4806a47ee6cb95738425fcb03c460ef512e9` finished in538.23s:
**5340 passed,26 failed,5366 total;397 passed files,9 failed files**. This is a
failed gate, not completion evidence. The complete failing groups were:

- Motion adoption/recovery:13 cases in application motion-faults,
  application motion-generation and HTTP/CLI motion-generation. Automatic
  preview validation and direct acceptance publication produced different pin
  metadata. The coordinator owns the trusted automatic commit correction;
  expected-document hashes remain strict.
- Pipeline media adapter:8 cases. The synthetic adapter still supplied
  `compose` rather than current `prepareComposition`, omitted catalog summary
  iteration, and expected the retired provisional ID. The fixture now follows
  the actual publication boundary and checks the exact saved ID while retaining
  all media-error/cancellation/decoded-byte assertions.
- Locked Look HTTP:1 case returned generic400 before the existing typed409
  lock/count validator. Shared Pin/field-owner correction is coordinator-owned.
- NLE handoff:1 case lacked `opentimelineio` on default Python PATH. The pinned
  installed OTIO 0.18.1 environment runs that same case successfully unchanged.
- Soundtrack controls, compatibility locale and synthetic docs fixture:1 case
  each. Restored ordinary-audio exclusion and the always-visible Add start field,
  placed selected role/start controls with their actual selected owner, added
  localized independent-audio labels and the newly required guide fixture.

The full run retained the candidate-bound media manifests and measurements;
canonical phase errors were `[0,0,0,0,0,0,0]` from the single239-sample baseline.
No threshold, skip or retry policy changed. A second complete gate requires the
new integrated producer correction and the configured pinned parser environment.

## Existing master/stem limiter measurement

A separate actual canonical fixture applies saved gain20 to two low-level
440/880 Hz sources, then renders the master and dialogue/music roles through the
existing limiter. `measureAudioOutput` measures the decoded files; each WAV hash
is identical before and after measurement. The intentionally overloaded result
is recorded as existing behavior, without additional normalization:

| Output        | Integrated LUFS | Sample peak dBFS | True peak dBTP |
| ------------- | --------------: | ---------------: | -------------: |
| Master        |           −3.80 |        −0.000001 |          +1.08 |
| Dialogue stem |           −1.09 |                0 |          +1.09 |
| Music stem    |           −0.60 |                0 |          +1.08 |

The maximum difference between summed stems and the limited master is
0.9999998807907104. Limiting runs independently per output, so nonlinear
stem/master summation equality is not an acceptance promise. All files retain
exact12-second duration and finite decoded measurements. The source-overwrite
guard caught an initial fixture filename collision; changing only the output
filename allowed the unchanged measurement assertions to execute and pass.

## Repeated rational-frame movement — 2026-10-30

A public `audio.move` regression exposed cumulative sample rounding: ten
successive one-frame moves at30000/1001 produced start64037, while the same
final move once produced64033. Both paths began with an explicitly saved
17-sample sound offset. The new timing translator subtracts separately rounded
absolute picture endpoints, so successive deltas telescope and retain the saved
offset. Source endpoints, effect origin, picture values, Pin checks and the
single48k clock remain unchanged.

The regression first failed with the exact four-sample difference, then the
complete five-file solver/application/core/Pin gate passed70/70. A separate
three-file actual render/canonical-source/private-PCM gate passed30/30 in106.84s
before this pure translation correction; the final combined full candidate gate
is still required. No timing tolerance or existing assertion was relaxed.

## Preparation cleanup and retry — 2026-10-30

A controlled filesystem `EBUSY` during private work-cache cleanup exposed a
stuck preparation owner: the next attempt returned `jobs.busy` without reaching
the renderer. Preparation now releases its existing filesystem request lock and
active owner in nested `finally` blocks even when cleanup throws. The original
cleanup failure remains an error; no ready preview or partial project save is
reported. The regression reaches a second renderer attempt after the failure.
The complete five-file private PCM/HTTP/scheduler/Record/transport gate passes
102/102; HTTP tests bind port0. No lock bypass, retry loop or test skip is added.

## Trusted producer origin integration — 2026-10-30

Integrated Pin producer checkpoint`938da2bc35fd94137820d32d0605d24da39542ec`.
A real internal-producer regression then showed the preexisting audio final
validator still assumed every commit was direct: an automatic delete could
remove imported, unpinned independent sound. The final audio validator now uses
the server-owned commit origin from the existing internal capability. The exact
case rejects with`timeline.audioTimingConflict`409 before publication, retaining
saved bytes, revision and history; explicit public deletion and Undo remain a
paired positive case. The complete six-file producer/audio gate passes72/72.
The symbol remains package internal; no client origin field or alternate writer
is introduced. Pin's subsequent lock-compatibility correction and final combined
full gate remain coordinator-owned dependencies.

## Complete candidate verification — d5d7510

At clean `d5d75107ea9f556ff2237b899d9d885b5ffd920c`, unchanged `pnpm test`
passes **5436/5436 tests in 408/408 files**, with zero failures or skips, in 611.06s.
The environment prepends the installed pinned OTIO 0.18.1 interpreter. Source
files remained frozen throughout the run; all 118 review-receipt hashes matched
afterward, and the normal 4310/1420 ports were closed before releasing the lease.
The complete log SHA-256 is
`4811e50dd9773de5f008294b442c127d45c12c421110e5e8ffd7d6a99dd6c32d`.
Synthetic native-benchmark failure-injection events in that log are exercised
negative controls, not failed test conclusions. This is the exact pre-review-fix
candidate; later corrected-source verification is recorded separately below.

## Independent review correction — canonical handoff endpoint

The first whole-feature review found one bounded compatibility defect: at
speed 3, a source sample interval `[0,144001)` has a rounded canonical length 48000
and is valid at the end of a one-second film. Handoff instead compared an
unrounded floating duration and rejected both metadata/native and full-audio
bake paths. The two public handoff regression cases first failed unchanged;
neighboring 144000 was accepted and true overruns 144002 and speed 2.9999 remained
rejected.

`resolveAudioTimingRange` now owns the strict integer sample arithmetic used by
Composition validation, audio interval resolution and handoff. Actual decoded
source availability stays a separate required media check. No epsilon, clamp,
schema migration or saved-clock rewrite is introduced. The initial complete
core/schema/exporter gate passes 32/32.

Two real application handoffs also pass. The native path preserves the complete
synthetic MP4 source byte-for-byte and exact original timing metadata; it does
not claim to render a reference or recreate the effect in a foreign editor.
The explicit audio bake decodes 30 reference frames and exactly 48000 nonsilent
stereo 24-bit PCM samples. Both preserve the original project bytes and source
hashes. Optional synthetic evidence includes both published handoff directories
and hashes of the five executing code/test files. Fresh scoped review, final
browser and hosted candidate gates remain open until actually recorded.

The complete post-correction regression run passes **393/393 tests in 25 files**
in 102.90s, including all exporter suites and all 65 NLE handoff cases. The run
has no skips or deselections. TypeScript/Vue typecheck and the production build
pass; the existing build warning for chunks over 500 kB remains visible.
`pnpm test:interchange` passes all 18 official OpenTimelineIO 0.18.1 tests,
source hashes/bounds, missing-URL rejection and the synthetic relocation gate.
Actual Resolve import and physical workstation validation remain unverified.
The final corrected commit still requires fresh scoped review and hosted gates;
the earlier 5436-test full result is kept bound to its exact original SHA.

## Final Pin integration and Record startup correction — 2026-10-30

The reviewed Pin parent `c260deaa502ccb2a0f76e64bdb334f381ea45803`
merged without conflicts at clean `a0e1f34b0f4aa038d5bcb7aaa860b18da2d2b6af`.
This joins the reviewed PrimaryColor reactive-value detachment, existing Pin
browser fixture updates and reconciled main documentation; it changes no audio
DSP. On that candidate, six affected-join files pass **81/81** tests. Full
TypeScript/Vue, lint, i18n (2951 keys), documentation mirrors (136) and format
checks pass.

The first final browser gate at that exact clean merge is retained as **RED**:
**1 passed, 1 failed in 13.813s**. Actual OfflineAudioContext PCM already matches
at zero error, but production Record's first Play remains in preparing/buffering
instead of reaching playing within the existing 5-second assertion. The trace
shows 15 successful preparation calls with progressively advancing PCM starts.
A buffered picture correction seeks to the current sound position; native
`waiting` incorrectly retires the master PCM clock, causing a preparation and
lookahead cycle. A later instrumented diagnostic passes once and is retained
only as diagnostic evidence, not as a replacement green gate.

Three native-event regressions first reproduce that incorrect buffered hold
while preserving the existing unbuffered and stalled-source holds. The narrow
correction tracks the exact target of a PCM-driven picture seek. Only native
`waiting` while seeking that already-buffered target retains the master clock;
cold/unbuffered media, native `stalled`, decode errors and explicit operations
keep their existing hold path. The half-source-frame resync threshold, DSP,
sample clocks, scheduling lookahead, assertions, retries and timeouts are
unchanged. Complete monitor/scheduler/transport coverage passes **94/94 tests**
in three files, with zero skips. Full TypeScript/Vue, scoped ESLint, the
production build and all **18 official OTIO 0.18.1** interchange tests pass on
the corrected source. The existing build chunk-size warning remains visible.

The unchanged two-case browser gate then passes at clean
**`acd8410d56d1a7ee368ea0494354ea8fbc9b316c`**:

| Result     | Actual measurement                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run        | 2/2 passed, 9.795s, zero skipped, retried or flaky cases; JSON metadata identifies the exact clean candidate.                                                                      |
| Actual PCM | Starts 0 and 53129 each schedule six contiguous bounded nodes; maximum absolute and seam errors are both 0 against the independent rendered WAV, retaining the strict 2/2²³ bound. |
| Record     | First Play, pause, seek, interrupted preparation, Undo and reopen pass; old PCM after Undo returns 409 and native audio-element play calls remain 0.                               |
| Source     | Synthetic source hashes are checked unchanged after each case; no private media or provider is used.                                                                               |
| Teardown   | Both 4310 and 1420 are closed before releasing the exclusive browser lease.                                                                                                        |

The final PCM attachment SHA-256 is
`06476a5377d8cffbcb257853de1895bdc8aa550d67fa41656ddf0f0ed4ca6ca8`;
the Record generation-guard attachment SHA-256 is
`6238bd1b1ae4cc8ef1558aca9b991d700a4b31b70b4836f3dcc3576f6c237528`.
The 18016-sample controlled OfflineAudioContext start remains an offline schedule
measurement, not physical latency.

The first whole-feature review's sole canonical handoff finding is resolved;
the independent fresh scoped correction review passes at `dfd0ded1`. The newer
Record startup delta still requires its own narrow independent review and the
final exact-head hosted union gates. The earlier **5436/5436** complete local
result belongs only to `d5d75107`, before both corrections; it is not relabeled
as a complete run of this final source. D3B1 source implementation is complete,
but merge/CI remains open. D3B2 durable coverage records remain a separate task.
Physical Windows/macOS audio/keyboard/display, human listening, real Resolve/NLE
and native-installer workstation gates remain unverified; published stable
remains v0.4.0.

## Nested batch audio validation — 2026-11-04

A regression test reproduced a contract bug on the `c068b8f` base: changing an
existing independent-audio source range through an explicit `batch` was rejected
as an indirect source-coordinate change. `validateAudioEdit` inspected only the
outer command, so it missed the nested `audio.timing` clip ID. The validator now
flattens command leaves before identifying edited clips and explicit delete or
reset operations. Source and stream validation remains unchanged.

The new integration regression failed on the unmodified base with
`timeline.audioTimingConflict` and passed after the fix. Local checks on the
candidate derived from `c068b8fdf2a09832443db892770b22ad3e5a36e6`:

- Application audio transactions: 7/7; solver audio timing: 14/14.
- Cut Desk persistence: 21/21; transcript ripple: 4/4; rhythm integrity and
  pipeline: 3/3.
- Full Vitest: 434 files, 5713/5713 tests, 464.03 seconds. The run used
  `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv-v2026/bin/python` with
  OpenTimelineIO 0.18.1. An initial run without that configured parser had one
  environment-only NLE-handoff failure; its focused rerun and the full rerun
  with the parser configured passed.
- `pnpm format:check`, `pnpm test:i18n`, `pnpm lint`, `pnpm typecheck`,
  `pnpm build`, and all 18 official interchange checks passed. The existing
  Vite chunk-size advisory remains.
- Audio-policy browser gate: 2/2 Chromium cases passed in 10.8 seconds.

This is local evidence only; the patch has no hosted CI run yet. Full browser
shards were not rerun locally. Candidate-bound native workstation, Resolve,
hardware-audio and v1 release gates above remain open.

## PR #100 integrated batch and truncated-audio regression — 2026-11-04

The follow-up was integrated into PR #100 after confirming its changed paths do
not overlap the source-bound silence implementation. The tested code tree
`2219753882cebcd4b5b7ce1026bb26063c1352f7` contains current main `fcc0013`, the
reviewed-media PR, a nested-batch audio-timing validation fix, and rejection of
truncated audio whose container index advertises a longer duration. The new
truncated-MP4 test reproduced the unsafe `1.26–5.00 s` silence proposal before
the FFmpeg `-xerror` guard and now verifies typed `media.unsupported` rejection.

On that exact code tree, seven focused application, solver, media, core and CLI
test files passed **77/77 tests**. TypeScript/Vue typecheck, scoped ESLint,
Prettier, `pnpm test:i18n` (3,033 semantic keys), `pnpm test:docs-i18n` (152
English reference mirrors), and `git diff --check` passed. Full hosted checks
were restarted for the updated PR head; this focused local result does not
replace the hosted full-media, browser-shard, native-shell, render or Windows
recovery gates. DCO and physical workstation gates remain open.

## Reviewed ripple automation mapping — 2026-11-05

Prompt 02 was implemented from latest main `92ccf361642f060466b269dc2fcf3ed4d77102b3`;
the code candidate is `e7ede9443d66416e5e8ef8efbdd1823cfb4ffb2a`. It adds a
versioned sample-clock map for clip-local gain/fade/ducking automation and
applies the Silence review's source windows to that clock before a single
compound edit is accepted. It does not add a mixer, change source media, or
auto-accept a review.

The map uses integer 48 kHz sample coordinates, retains the original source
range, speed, continuity ID and offset, and validates source/clock freshness on
save, reopen and render. Direct `clip.split` uses the same mapping. A mapped
clock cannot be silently reset by direct trim, speed or source replacement;
unknown ducking references, unsupported J/L timing and other non-equivalent
cases keep the typed conflict path. Silence review preflights the detached
ripple; locked clips/tracks and User Pins remain protected, and one compound
edit keeps Undo/Redo metadata atomic.

Verification on the exact code candidate:

- Full Vitest: **446 files, 5,853/5,853 tests passed** in 517.10 seconds,
  including real FFmpeg-generated 44.1 kHz and 48 kHz sources, 1.25x speed,
  automation envelopes, Silence ripple, source-clock mapping and final render.
- The source-clock and direct mix PCM comparisons meet the existing renderer
  bound of `2/2^23`; the final render meets that bound outside the existing
  global limiter's measured 5 ms lookahead plus two samples around the edit
  boundary. That limiter window is reported explicitly because the cut changes
  its local input context; the assertion and tolerance were not relaxed.
- Focused regressions before the final full run: 28/28 renderer-policy and
  presentation tests, 2/2 PCM/NLE handoff tests, and 7/7 muted-source, title
  and NLE compatibility tests. The final full run includes these tests.
- On the rebased candidate, `pnpm format:check`, `pnpm test:i18n` (3,141
  semantic keys), `pnpm test:docs-i18n` (158 English reference mirrors),
  `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test:contracts`
  (77 files, 1,498 tests) all passed. The production build reports the existing
  500 kB chunk-size advisory.

All media in these regressions is synthetic. This evidence does not establish
human listening quality, workstation audio latency, or physical Windows/macOS
behavior. The existing Vite chunk-size advisory remains. The candidate is not
merged or released; hosted CI is pending PR creation.

## PR #114 correction review — 2026-11-05

The integration baseline is `main@1bafb5cd4532ce9f9a171499abc8631e4863d1ee`.
The original PR candidate `4964cdf2261330adf5e2001f683c376392394d07` was reviewed
again before merge. Eight added regressions failed against that candidate:
repeated mapped splits, repeated ripple, and 1× transient PCM parity. Corrections
retain exact original trim seconds and the legacy playback origin in the new,
unpublished schema 1.3 contract. Offsets derive from one absolute source anchor;
the original DSP chain, including legacy `atempo=1`, runs before segmentation.

The final review also covers these explicit boundaries:

- Placed and original-clock sample spans must match. Non-equivalent fractional
  ripples fail with `timeline.audioAutomationConflict` during detached proposal
  preflight and render. The Review is not published or silently rounded.
- Mapped automation cannot acquire independent J/L timing. Both desktop sound
  inspectors offer an explicit reset to a new version-1 envelope; it clears
  points/fades/ducking, preserves source/role/base volume, and enters the existing
  Undo/Redo and autosave transaction.
- Collect retains complete originals for mapped clips even after explicit
  unpinning, and rejects supplied derivative source-clock rewrites.
- Record applies its existing 3600-second preparation limit to each preserved
  original DSP history before source I/O or rendering. A valid one-second film
  retaining a 24-hour clock is rejected without invoking FFmpeg.

Fresh local evidence: 10 focused files / 171 tests passed, plus the durable
fractional-failure regression (failed Job, no Review, source/Composition
unchanged). Seven browser tests passed across Silence Review and production
audio policy, including keyboard reset → Undo → Redo → saved project JSON →
reopen. Independent correction review passed seven focused guard/actual-PCM
tests and found no remaining technical blocker. Transient PCM checks cover
1× at 44.1/48 kHz, repeated 1.25× splits with fractional source trims and an
original sub-millisecond timeline start, and repeated accepted ripple windows.
The existing `2/2^23` PCM bound and disclosed limiter window are unchanged.

Compiler grouping now serializes each clip's envelope once and validates each
distinct fragment once, while retaining every per-segment sample check. A local
diagnostic with 1000 segments sharing a 1000-point curve, two warmups and ten
alternating measured iterations produced the identical compiled graph hash
`f98e6008f4621ce70ce8b0514d9fa32641a06ed3c7c54bf9f5f8c17b5c12b6b5`.
Median compile time was 352.41 ms for `4964cdf` and 2.43 ms for the correction
(Linux x64, Node 24.19.0, concurrent test load). This measures graph compilation
only; it is not an FFmpeg, whole-export or workstation latency claim.

The exact signed head and final hosted results belong to
[PR #114](https://github.com/bynanci/open-film/pull/114). The older 5,853-test
result above remains evidence only for `e7ede94`. Physical workstation,
human listening, signing/notarization and release gates remain open.

Audio-correction local gates (`f681df7`): **447 files / 5,878 tests passed** in
552.62 seconds with `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-venv/bin/python`
(OpenTimelineIO 0.18.1; FFmpeg 7.1.5). An earlier foreground attempt ended
without a completion report; only this completed exit-0 rerun is counted.
`pnpm format:check`, locales (3159 keys), documentation mirrors (160), lint,
typecheck, build, contracts (77 files / 1504 tests), official interchange (18),
license and provenance checks (8), and browser partition (339 cases) passed.
The production and documentation builds retain their existing large-chunk
advisories. The two related browser specs passed all seven cases. No assertion
or PCM tolerance was relaxed and no test was disabled.

### Hosted tool provisioning

On signed source commit `f681df7aa26bccf53ef85d8689c843c587829b85`, DCO,
fast-contract, native-shell, docs, all four browser shards, three-platform
Render QA and Windows recovery passed. Verify's media bootstrap stalled on
`azure.archive.ubuntu.com` package downloads: a 160 MB / 107-package install
reached only package 32 after about eleven minutes. The previous successful
candidate's same step took 27 seconds. A controlled fresh-runner retry also
remained in bootstrap; neither interrupted attempt counts as media QA.

The CI-only follow-up shares one installer across heavy-media and browser jobs,
uses the official Ubuntu HTTPS archive while retaining the runner's suites,
components and signing keys, bounds network retries/lock waits, omits optional
recommended packages, and installs the existing OTIO 0.18.1 Python 3.12 wheel.
Only provisioning gets an eight-minute limit; test budgets, assertions, required
jobs and evidence uploads remain mandatory. Shell syntax, 50 existing CI-policy
tests, formatting and license policy passed; independent infrastructure review
found no blocker. The full 5878-test result applies to the unchanged application
source at `f681df7`; final hosted gates must pass on the follow-up head.

`pnpm test:native` was not run locally because Cargo and GTK/WebKit prerequisites
are unavailable in this workspace. The hosted native-shell job ran successfully
on `f681df7` and is required again for the final head. This is automated evidence,
not installer signing or physical workstation acceptance.

### Deterministic complex-graph conversion

Windows recovery on `0100dfad5dde7114fd906c81dbc718ff68159f26` exposed a
separate rendering defect: repeat 12 of an identical owned-PNG render differed
in six pixels / ten RGB channels. The original and repeated MP4 independently
decoded to the retained RGB files exactly; the captured title, caption and
GraphicScene PNG hashes were unchanged. This was not a font replacement or a
decoder mismatch. The failed run is retained as failed evidence:
[Windows 42129370648](https://github.com/bynanci/open-film/actions/runs/42129370648).

A real FFmpeg debug regression demonstrated that output-level `-sws_flags`
does not configure complex-graph scalers: before the fix their flags lacked
`0x40000` (accurate rounding) and `0x80000` (bitexact arithmetic). The renderer
now declares these defaults in the filter graph itself. The regression runs
both profiled explicit scaling and an unprofiled automatic pixel conversion;
it verifies the actual configured contexts and an encoded 12-frame MP4. It
failed before the production fix and passes afterward. An independent CLI
YUV-to-RGBA-to-YUV control justified the exact red fixture's 253-to-252 change;
the test still requires exact equality. Encoder settings, geometry contracts,
repeated-render pixel equality and PCM error bounds remain unchanged.

The runtime regression also runs in Windows recovery with the pinned FFmpeg9
runtime. A full local suite and fresh final-head hosted checks are required;
passing this flag regression alone does not prove the Windows drift resolved.
The PR records their final outcomes separately from earlier source candidates.
