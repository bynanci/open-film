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
