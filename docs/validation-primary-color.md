# D5C primary color validation

Date: 2026-10-30. Branch: `codex/v1-d5c-color`.
Inspection/integration base: `e1255b1a8a83260149211d909cca8c1a50948c6b`.
Approved design/plan: `544a0b2d31fdb6959a06b461180b94623fe28f2a`.
Core/editor checkpoints: `6139be1`, `35dfe42`.
Render/review checkpoint: `acabbbb`.
Browser-verified product head: `53a23a784b948c5b595cad47a88a84a3eb5a6958`.
API-only acceptance follow-up: `6258d3bb23732a3eafbc6342088ac54d9bb9153b`.

This record covers focused implementation evidence. The coordinator owns fresh
whole-branch review, complete serial regressions and exact-head CI before merge;
none is inferred from the focused results below. Project schema `1.0.0`, catalog
v6 and existing Compose/Composition/history owners are unchanged.

## Executed local evidence

| Check                                       | Observed outcome                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final focused selection at `53a23a7`        | 19 files, 220 passing tests; combined core/editor/render/export/review, UI/Monitor and HTTP/CLI regressions.                                                  |
| Core/editor/render/export/review checkpoint | 13 focused files, 114 passing tests; missing behavior was observed failing before implementation.                                                             |
| Named Versions and reopen follow-up         | 1 passing focused test; accepted numbers restore/reopen, private proposal ID cannot resume.                                                                   |
| Monitor/source/editor UI checkpoint         | 4 focused files, 96 passing tests, including existing transport/Film Look regressions.                                                                        |
| New HTTP/CLI and UI adapter checks          | 2 focused files, 3 passing tests; HTTP binds project/revision and CLI uses the ordinary editor.                                                               |
| Collect/handoff                             | 3 passing focused cases: actual trimmed-original parity, disclosed offline package retention and primary/Film Look precomp identity.                          |
| TypeScript/Vue/i18n                         | TypeScript and Vue checks pass; 2692 semantic locale keys match, including placeholders and typed errors.                                                     |
| Browser                                     | Seven Chromium cases pass in 22.4s at the exact product head above; locale screenshots, WCAG checks, primary-only video controls and shuffled seeks included. |

Safety tests cover invalid/unknown/hidden recipes; field/scope validation;
inherited identity; effective locked paired-photo changes; one-step history,
exact request retries, conflicts and failed-batch rollback; same-size/same-mtime
source change; private artifact tampering; forged suggestion, stale revision,
cancellation, expiry, source byte bounds, symlink rejection and direct-run
concurrency. Measurement alone leaves project/catalog/history/originals unchanged.

Auto Match after statistics come from actual FFmpeg-generated candidate PNGs.
The CPU search predicts candidates from neutral post-tone-map target samples;
predictions are never reported as measured output. Apply requires actual improved
score and explicit review of loaded image samples. Proposals are local/private,
bounded and expire; accepted values become authored settings.

## Actual synthetic media

Executed tools: FFmpeg `7.1.5-0+deb13u1` (GCC 14), Node `v24.19.0`, pnpm
`11.19.0`; frozen/offline dependency installation changed no dependency versions.

FFmpeg-generated 160×90, 12 fps, 0.5-second chart MP4s contain six frames and a
synthetic 440 Hz audio track. SDR uses H.264; PQ/HLG use 10-bit HEVC with tagged
BT.2020 primaries/transfer/matrix. Existing Hable conversion runs before primary.
Each decoded RGB output is 259,200 bytes. For all three charts:

- Omitted versus explicit identity output is byte-identical after decode.
- Shuffled seeks at frames 5, 0, 3 and 1 exactly equal sequential decoded frames.
- Decoded PCM is identical between original-setting and corrected renders.
- The original SHA-256 is unchanged, and manifests bind that exact source.
- Missing/unsupported HDR color metadata fails before producing usable output.

Hashes from the recorded checkpoint run:

| Transfer | Source SHA-256                                                     | Corrected MP4 SHA-256                                              |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| SDR      | `27a6b6e182fe66b585615194b57a724a5bcaf738069e5ba964c5e8c030346f0e` | `46c3da5747a68b08079919e48eb99acff8190c81c46f4ffb310ec9eafde1d0a0` |
| PQ       | `96890706960c47aa4fdd5d38fda5ee22831d9a0ef00208dc04f7fac30d6be647` | `de43fc079774a273c6d552b1953b51c756beac88df34bb76d97e32ac6e2bae0b` |
| HLG      | `fc3cd56277e0fe91d45d17ef374cd2cc9ee43911752ebf15c2895be3a5c0c411` | `1ec13472ef1cfb77ef5deee2b4b507cec848188856d3a5f592dfc5741ebe787e` |

These are generated synthetic fixtures, with no private/uploaded media. Hashes
describe this tool/build run and are not universal cross-build encoder hashes.

The raw RGBA fixture pins allowed gain 6.6 and alpha 0/128/255 exactly. A primary
gain/contrast photo agrees with expected decoded RGB within 3 LSB. The separate
clamp/order and diptych tests allow 4 LSB after H.264, keep separator pixels ≤1,
and retain white title pixels. Shared source math uses 12-decimal coefficients;
the valid gain range exceeds a single colorchannelmixer's coefficient range, so
primary uses a generated LUT.

## Browser follow-up and UI safety

The initial `498ab41` browser run passed five cases and failed two. Reviewed
Apply exposed a context watcher that allocated an array on every optimistic
Composition replacement: it closed the panel and discarded evidence before the
queued autosave request. Watching individual primitive identities and retaining
explicitly applied evidence through acknowledgement fixes this race; a new
component regression was observed RED then GREEN. Expanded pseudo-locale button
text also exceeded the inspector at 1280px; local button wrapping fixes it without
relaxing the viewport assertions. The full seven-case rerun passes at `53a23a7`.

A final HTTP/API follow-up compares validated suggestion parameter values rather
than serialized object key order. Reordered but identical JSON now accepts;
changed values still reject. Its regression was observed RED then GREEN, with
seven review/HTTP tests passing after the fix. UI/render code did not change after
the browser-verified head; full final-head CI remains coordinator-owned.

That run uses `/usr/bin/chromium` and the repository Playwright configuration.
It measures actual SVG-source/MP4 channel differences within 5 LSB, verifies
explicit image review before Apply and one-step history, checks primary-only
video controls/shuffled seeks, and exercises English, Traditional Chinese,
Japanese and pseudo-locale at 768/1280/1920px with WCAG checks. No unrelated
browser server was reused. Both owned ports were confirmed closed before release.

The shared CSS filter adapter accepts only local generated SVG IDs; Record IDs
use instance and track/clip indices rather than project clip text. A punctuation/
CJK project-ID regression and rejected external-URL-shaped filter IDs cover this
boundary. Rounded identity coefficients skip filtering, including sub-precision
parameter values, so an effective identity cannot add a format conversion.

## Integration distinctions and remaining gates

Committed edits retain the existing saved-revision transport fence: Apply pauses
and rebuilds ownership safely. Diagnostic look comparison preserves resources and
keeps primary active. There is no unsaved live grading state in the Monitor and
no separate timeline. The inspector labels gain as encoded SDR gain/EV and Auto
Match as a statistical suggestion.

D5A raw photographic ambient/foreground preparation belongs before primary and
Film Look. A diptych separator mask remains outside that color group while
staying inside camera/static transforms. D5C's current per-source path already
proves the black gap is not lifted; the coordinator must retest the combined D5A
grouping after integration. D8 Film Look versions remain behind shared resolvers;
D5C does not change immutable v1 creative recipes or registry hashes.

JSON/OTIO preserve correction metadata. OTIO primary parser and real-NLE
verification remain explicitly false; editable reconstruction is manual.
FCPXML/EDL reject active correction. Fidelity precomps explicitly stop primary and
Film Look inheritance. Trimmed-original/offline Collect retains the saved recipe.

Physical calibrated display appearance, real camera/face aesthetics, actual
Resolve import/relink/playback/color, native platform presentation and sustained
4K performance remain manual workstation gates. Synthetic chart/browser evidence
cannot close them. Full regressions, final review, exact-head CI and merge are
coordinator-owned and pending at this checkpoint.

## Integrated photo, title and local-preset checkpoint

C merges the finishing stack through `83a7169`, with the updated focal-fence
parent chain through `035f115`. The current parent is D8 `d45a1de`, following
A `a4dcf50` and B `f63c8e6`. This is a focused integration checkpoint; D8's
subsequent review corrections and a fresh complete C review remain pending.

Verified raw ambient and foreground are combined first, receive primary
correction with its clamp, then the shared Film Look adapter with its separate
clamp exactly once. The v1/no-fill branch retains its per-source processing.
The diptych black separator is restored outside photographic color and inside
camera/static transforms. Titles, captions and GraphicScenes remain later
independent overlays. Film Look v2 uses the shared typed resolver/matrix rather
than a copied v1 recipe implementation. Existing source hashes, protections,
review-Apply receipts, read-only waveforms and history remain with their owners.

Three new actual MP4 regressions cover contain, diptych, and a diptych with
Bézier camera motion plus static translation and an imported local Look v2.
They first failed without ambient primary correction by more than 112 RGB units.
After the once-only group fix, all 24 independent raw-source/raw-fill witnesses
across shuffled/repeated frames pass the unchanged 3-unit channel bound; the
largest error is 2.9. Moving separator samples remain black at the transformed
position while the old position contains graded picture. Source and prepared-fill
hashes match the actual manifest; omitted/double primary and reversed ordering
are distinguishable by the same witnesses. A narrower procedural portrait gives
uniform interior sample patches; no threshold or existing assertion was widened.

The existing Monitor/MP4 parity case is retained, with an additional version
using nonidentity primary correction and an actual local Look v2 snapshot.
Both retain eight shuffled/repeated seeks, separate ambient/foreground metrics,
edge bounds and actual wrong-fill, double-dim, double-color and wrong-curve
negative controls. The combined case's maximum mean channel errors are 1.506
for ambient and 3.998 for foreground, below the existing 12-unit bound.

Current checks passed: 19 focused files / 203 tests; four selected Collect/NLE
cases; the bilingual nested-finishing preset interoperability case; and a final
15-case browser run in 54.3 seconds, including all seven primary-color journeys,
the original photo cases and the new combined parity case. It covers the three
real locales plus pseudo-locale, controls, explicit reviewed Apply and history.
The focal race found during earlier attempts is documented in the photo
validation: eight deterministic regressions failed before the isolated fix;
its current four-file / 59-test batch passes, and A/B/D8 receive the same fix.
An obsolete comparison-label locator and a test-only variable scope error were
corrected without removing assertions. Initial failures remain in private logs.

TypeScript/Vue, scoped lint/format, 2,852 localization keys and 133 documentation
mirrors pass. Actual synthetic media, raw PNGs, observations, Monitor frames,
negative controls and current source/test byte receipts are retained under
`/tmp/openfilm-finishing-integration/C-current/`. Historical receipts retain
their original candidate identities. Browser servers exited and both shared
ports were confirmed closed before returning the lease. No full suite, native
benchmark, hosted-CI result or stable-release completion is claimed here.

## 2026-10-30 — reviewed preset corrections and repaired base integrated

Merge `6093ca9` consumes clean fixed D8 `77c9ea0` on the latest A/B stack and
repaired documentation base `fab0a4c`. It preserves D8's reviewed in-lock catalog
fence, complete scene assignments, detached ordinary-compose provenance and
localized title disclosure, together with primary review-Apply validation and
source protections. The verified primary → local Film Look raw-photo group,
black separator placement and core color math are byte-identical to the earlier
C checkpoint. Current focal admission and B's Record caption minimum are carried
through their reviewed parent branches.

Current focused execution passes 18 files / 233 tests across color/core/solver,
application review/CAS, real TimelineClip host, source recovery, focal admission,
Story preset corrections, title disclosure and documentation links. A separate
actual five-file finishing run passes all 19 test cases with `--maxWorkers=1
--retry=0 --reporter=json`: photo-easing, photo-ambient, bilingual-title-finishing,
primary-color and photo-primary-local-look. Its JSON contains exactly those five
files, all passed, with zero failed/pending/todo cases. This exercises actual
Bézier expressions/raw ambient, bilingual font/caption MP4s, SDR/PQ/HLG correction
and combined local-Look diptych/static/camera pixels with unchanged limits.

TypeScript/Vue, scoped ESLint, repository formatting, 2,889 localization keys and
133 documentation mirrors pass. Fresh actual media, raw JSON report, logs and
current source/test byte hashes are under
`/tmp/openfilm-finishing-integration/C-final-stack/`. The preceding 15-case
browser receipt retains its original source identity; this checkpoint launched
no browser server. First fresh whole-branch C review and complete exact-head
hosted gates remain coordinator-owned. This entry does not declare merge or
release readiness.

## 2026-10-30 — reviewed Apply isolation and private evidence expiry

This correction follows the first complete C review of `dc3f7ae`. Its confirmed
batch counterexample used actual FFmpeg evidence: validation ran against the
saved document before a sibling command changed the measured context. Reviewed
Apply now requires a single-command editor transaction, before mutation/history
or persistence. Ordinary manual batches, later independent source replacement,
Undo/Redo and exact acknowledged request replay retain their existing behavior.
The separate inspector scope-initialization policy was not changed.

Ten real-service regressions first failed for target/reference replacement,
target/reference trim and reference correction, each in both command orders.
They now reject atomically and preserve document, persisted bytes, source hashes
and prior Undo/Redo history. Singleton reviewed Apply/retry after report discard,
later replacement and an ordinary manual batch remain positive controls.

Private reports now own an unreferenced expiry timer. At the original deadline,
cleanup removes both the cached report and its private directory without another
measurement. Expired access retries cleanup; discard and disposal clear timers.
Deletion uses bounded filesystem retries. A failed deletion is reported and
retains bounded cleanup ownership while permanently retiring the report, even
if the wall clock moves backward. Disposal attempts every owned cleanup, clears
all timers and reports failures; project close reports asynchronous failures.
Controlled-clock tests use the real service and FFmpeg, with only clock controls
and a narrow deletion-failure injection. They first exposed the missing expiry
cleanup and clock-rollback reactivation, then passed without changing deadlines.

Focused execution passes 13 files / 119 tests across primary core/solver,
application editor/review/history/locks, HTTP/CLI, UI and real render behavior.
The final service plus actual combined-photo selection passes 2 files / 25 tests,
with zero failed/pending/todo cases in the captured JSON report. Its three
synthetic MP4 cases retain the existing contain/diptych/moving-diptych checks:
verified raw ambient/foreground receive primary then local Film Look once,
with ungraded transformed separators and unchanged pixel limits/source hashes.
The service/media JSON report and synthetic artifacts are retained under
`/tmp/openfilm-finishing-integration/C-final-fix/`; historical receipts keep
their original identities.

TypeScript/Vue, scoped ESLint, formatting, 2,889 localization keys and 133 English
documentation mirrors pass. This correction launches no browser server; prior
browser evidence remains attached to its original source checkpoint. Fresh
scoped review and complete hosted gates remain coordinator-owned and pending.
No full suite, native benchmark, hosted success or merge readiness is claimed.

## 2026-10-30 — reviewed D8 CI recovery carried into C

The correction stack also consumes reviewed D8 `cb9baf9`. Its real Story browser
fixture checks read-only effective graph output, absent persisted graph and an
unchanged project on Cancel, then requires explicit Connect to persist an edge.
The TimelineClip host retains both real local-preset and source-color module
bindings. Automatic merging initially duplicated the preset import/dependency
key, which types and the host loader rejected; the redundant declarations were
removed without changing any assertion or product code. Failed logs remain in
the private integration record.

The corrected final focused selection passes all 14 files / 174 tests, including
all 55 existing TimelineClip host cases and the 22 real primary-review service
cases. The captured JSON requires every assertion passed with no skipped/todo
cases. Fresh combined contain/diptych/moving-diptych MP4 evidence and current
source/artifact hashes belong to the separate final checkpoint under
`/tmp/openfilm-finishing-integration/C-final-fix-stack-green/`; earlier failed
and successful observations retain their own directories. This local check does
not replace the pending scoped review or hosted gates.

## 2026-10-30 — sanitize private cleanup failures

The first scoped correction review resolved the original Important batch-context
and Minor retention findings, then identified a bounded Minor follow-up: a real
filesystem deletion failure could expose its absolute private path through HTTP
or background logging. The cleanup boundary now throws the stable localized
`review.cleanupFailed` ApplicationError with status503 and a path-free diagnostic.
The raw filesystem error is neither its message/detail nor a retained cause.
Sticky retirement, bounded retry, ownership, original deadlines and all timer
disposal rules remain unchanged.

The existing real-service fault case now injects an EBUSY error containing the
actual synthetic private directory, and checks the typed rejection plus path-free
background logging. A new actual port0 HTTP regression injects EACCES for only the
owned evidence directory; both media GET and reviewed edit return503 with the
localized code, no project/cache path or raw EACCES text, and unchanged saved
project bytes. Both cases failed before the correction; the full service and
HTTP/CLI selection now passes24tests in two files (43.21s), with no skips/retries.
TypeScript/Vue, scoped ESLint and all2,890 localization keys pass. Earlier
174-case and MP4 measurements retain their original checkpoint identity; this
service/error-only increment does not claim new rendering or hosted evidence.
Complete final-source CI and scoped source verification remain required.
