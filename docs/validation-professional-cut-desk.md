# Professional Cut Desk Phase 1A — validation

Date: 2026-10-26. Repository program base:
`9f593eba5e067aa60c88579e6198425e5fcfa6a6`; Task 10 starts at
`66ecb6427a711f00ac114acd01bea5ddeafcd69f`.

This document records executed synthetic/local evidence. Exact committed-head
gate results are added only after execution; a commit cannot contain its own
SHA. Phase 1B–4 and physical workstation gates remain incomplete.

## Fixture and FFmpeg

`tests/fixtures/professional-cut-desk.ts` creates three local 160×90 MP4 sources
with red/green/blue fields, white shapes at distinct positions and 440/660/880 Hz
tones, plus a PCM 1100 Hz overlay. Temporary directories use `mkdtemp` below the
OS temporary root and are removed after assertions, including failure paths.
No source media, rendered MP4, manifest, cache or trace is tracked.

The saved Composition is exactly 180 frames at `30000/1001` (6.006 seconds), with
primary edits at frames 60 and 120. Each primary selects source 0.5005–2.5025;
green has a 15-frame incoming crossfade over the outgoing red tail. A yellow
GraphicScene square moves linearly from centre x=20 towards x=80. The 1100 Hz
overlay spans frames 75–135 with volume 0.5 × automation gain 0.5.

`pnpm exec vitest run packages/render/tests/professional-cut-desk.test.ts`
initially exited 1 before the test file existed. The first written test failed
on a tiny graphic's compression residual (blue 15, tolerance 12) with standard
CRF23. Selecting the existing high-detail CRF18 option passed without changing
the declared tolerance or expected pixel. No production renderer change was made.

The regression asserts `avg_frame_rate="30000/1001"`, exactly 180 decoded frames
and duration 6.006000. Hand-derived frame/PTS/RGB samples are:

| Frame | PTS seconds | Expected background RGB |
| ----- | ----------- | ----------------------- |
| 0     | 0           | 255,0,0                 |
| 59    | 1.968633    | 255,0,0                 |
| 60    | 2.002000    | 255,0,0                 |
| 67    | 2.235567    | 136,119,0               |
| 75    | 2.502500    | 0,255,0                 |
| 90    | 3.003000    | 0,255,0                 |
| 119   | 3.970633    | 0,255,0                 |
| 120   | 4.004000    | 0,0,255                 |
| 179   | 5.972633    | 0,0,255                 |

Pixel tolerance is 12 per channel; PTS is checked to six decimal places. Distinct
source shapes and graphic positions are checked at 0/90/179, with the vacated
graphic position checked for restored source identity. No production resolver or
graphic evaluator computes expected pixels, times or tone values.

White source-time chips change positions at source ticks 30 and 60. The saved
15-frame source trim places those changes at local ticks 15 and 45. Adjacent
decoded samples 14/15, 44/45, 134/135 and 164/165 independently catch a one-frame
source-position error; the old chip's background is also asserted. All use the
same unchanged pixel tolerance.

Decoded 48 kHz float PCM is measured with a 200 ms sinusoidal projection. Expected
primary peaks are 0.052632/0.078947/0.105263 (sine peak 1/8 × saved volume ×
existing limiter auto-level 1/0.95), within 0.006. Overlay peak is 0.032895 within
0.004 in its windows, and absent outside; absent primary tones remain below
0.003. Manifest source hashes, settings, Composition and empty warnings are
asserted, and every input is hashed again after rendering. The test prints exact
temporary paths, measured colors/tones, all four SHA-256 values and warnings.
DF is display semantics; no MP4 embedded DF metadata claim is made.

Additional 50 ms edit-edge windows use 25 ms guards and integer tone cycles.
The final AAC 660 Hz onset measured 0.093350 while the same renderer's lossless
PCM mix measured 0.079742 and the source 0.126533. This confirms codec onset
overshoot, not a changed saved gain or source identity. An initial steady-gain
assertion on that transient failed and was retained as diagnostic evidence.
Primary edge assertions therefore verify PCM gain within the original 0.006,
AAC expected-frequency presence above 90% of its theoretical peak and exclusion
of every other primary tone below 0.003. Overlay edge gain remains within 0.004.
These checks catch a one-frame edit shift without confusing onset amplitude with
steady gain; the original six steady windows and tolerances remain unchanged.

## Browser and accessibility

`tests/e2e/professional-cut-desk.spec.ts` opens actual application projects and
serves real local synthetic media through the normal source endpoint. It uses no
replacement resolver, transport, shortcut or edit implementation. The seek order
seed `0x1a2026` yields 120,75,60,119,179,0,15,150,90,59,67, followed by repeated
60,0,179. Source positions are calculated directly from saved timing, and fetched
GraphicScene pixels/frame attributes are checked at every stopped seek.

Browser evidence covers continuous crossings, selection independence, staged I/O,
atomic Apply/split Undo/Redo, source versus sequence bounds, Record M no-write,
valid/invalid DF labels, operation-specific lock rows, stale marks, project-switch
late-event fencing, General compatibility and inert/untrusted input. Accessibility
checks run on both targets at 1024×768, 1440×900 and 1920×1080 with no serious or
critical axe violations, no horizontal page overflow, visible keyboard focus and
reachable monitor/timeline/controls. Results are recorded after the run below.

Initial browser run: 6 passed, 3 failed. Two fixture trim attempts shortened a
Composition whose graphics still ended at 6.006; the existing command boundary
correctly rejected them. Accepted-trim evidence instead shifts both source bounds
equally, preserving duration and graphics. The accessibility test initially tried
to scroll the hidden Story rail while Source was active; it now checks the visible
Source waveform and the Record timeline in their respective targets. Assertions
and tolerances were not weakened to mask a production mismatch.

The nine new browser tests subsequently passed, including both targets at all
three viewports (six axe checks, zero serious/critical violations, no horizontal
overflow, visible Tab focus). A later full focused suite found two pre-existing
native shortcut fixtures had omitted the shared production guard and newly
required isolation/Record refs from extracted Timeline handlers. Adding that
real guard and explicit fixture refs restored their original Delete/history and
default-activation assertions; no shortcut logic was duplicated.
The required combined four-file browser command subsequently passed all 49 tests
in 3.2 minutes, and passed all 49 again in 3.2 minutes after the final source-time
chip fixture improvement.

The approved lock matrix also exposed a production discrepancy: clip and overlay
source locks disabled transient marks along with accepted edits. A clean browser
RED expected enabled staging under those locks. Precision now distinguishes
stageability from accepted-edit eligibility. Buttons, keyboard, numeric fields
and handles can stage; Apply/split retain the existing lock checks. The regression
proves button Set In and keyboard O produce no edit request or saved change under
locked video/audio overlay sources and a locked primary clip; unlocking restores
accepted trims. Two follow-up test setup errors (stepping from the newly staged
End and one renamed helper reference) were corrected before GREEN.

## Complete gates

The first full ordered run used clean head `fea1743d5915152907ae0d8853766c5792081381`.
Every command below began and ended at that exact SHA with a clean worktree.
These are executed results, including the failed gates:

| Command                                                                                          | Exit | Seconds  |
| ------------------------------------------------------------------------------------------------ | ---- | -------- |
| `pnpm format:check`                                                                              | 0    | 15.062   |
| `pnpm test:i18n`                                                                                 | 0    | 0.444    |
| `pnpm lint`                                                                                      | 0    | 12.439   |
| `pnpm typecheck`                                                                                 | 0    | 13.822   |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-professional-cut-desk-otio/bin/python pnpm test`             | 0    | 375.296  |
| `pnpm build`                                                                                     | 0    | 1.335    |
| `pnpm test:e2e`                                                                                  | 1    | 1624.532 |
| `OPENFILM_OTIO_PYTHON=/tmp/openfilm-professional-cut-desk-otio/bin/python pnpm test:interchange` | 0    | 1.943    |
| `pnpm test:native`                                                                               | 1    | 0.37     |

Unit/application/render validation: 294 files and 4,224 tests passed. Full
Chromium: 256 passed, five failed. Four global-visual locale cases timed out at
the old ordinal template selector: the new timebase select is correctly first.
The compatibility correction targets the select containing
`option[value="proposal-film"]` and retains every visual/axe/tolerance assertion.
The Proposal Film case reached the official parser but system Python lacked
`opentimelineio`; the existing verified private interpreter is used explicitly
for final E2E: `OPENFILM_OTIO_PYTHON=/tmp/openfilm-professional-cut-desk-otio/bin/python pnpm test:e2e`.
No production change, assertion relaxation or system Python installation resolves
either harness/prerequisite failure.

After the selector correction, the focused command
`OPENFILM_OTIO_PYTHON=/tmp/openfilm-professional-cut-desk-otio/bin/python pnpm exec playwright test tests/e2e/global-visual.spec.ts tests/e2e/proposal.spec.ts`
passed all six tests in 57.7 seconds, including all four visual locales and the
official-parser Proposal workflow.

Interchange passed 18 parser tests and official OpenTimelineIO 0.18.1 read/write/read,
source hashes/bounds, gaps/still/audio/multiple-track and relocation checks.
Actual Resolve import remains manual. Native was actually invoked and exited 1:
`sh: 1: cargo: not found`. Cargo/desktop compilation is an unavailable prerequisite,
not a passing native gate. Build exited 0 with the existing >500 kB Vite chunk
warning; browser startup reported the existing NO_COLOR/FORCE_COLOR warning.

The evidence commit includes the small template-selector compatibility correction
and this first-run record. The complete nine-gate sequence must then repeat at
its clean head, with the same verified OTIO interpreter for test, E2E and
interchange. That successor cannot contain its own SHA or later results; the
delivery report records the final before/after pins and actual outcomes without
rewriting first-run failure evidence. Native and physical workstation gates remain
explicitly open.

## Scope, privacy and manual gates

Only synthetic colors/shapes/tones are used. Source hashes are checked after each
browser test and after render. Outputs, project catalog/cache and browser traces
stay outside tracked changes. LICENSE/NOTICE and local-first source access remain
unchanged. No production API, schema, second timeline or Phase 1B mock UI is added.

The approved plan is byte-identical to its main-checkout source (SHA-256
`fcf253d094c2e34e57bc42f3c91482629e5a4235a6fa978ccaf41b154cbb21c1`).
The approved spec retains its content and rendered line breaks; only the two
Status/Date Markdown hard breaks were normalized from trailing double spaces to
CommonMark backslashes to satisfy `git diff --check`. Original spec SHA-256:
`2acda2b9eeb9f248846485742f27403ee9f601c02fb9af39ffe628abfce1274e`;
normalized copy: `bd89dac8955725ce51526068fd2c387fa0f38974eb265d0f4a75dd8f87c80c71`.
The user-owned main-checkout originals were not changed.

Physical Windows/macOS workstation execution, keyboards/trackpads, hardware audio
latency/listening, color-managed/high-DPI displays and long-form performance are
not run. Browser evidence is Chromium-only. Reverse audio, above-unity browser
gain parity, synchronous GraphicScene playback and cross-session Undo/portable
durable edit receipts are not claimed. Existing Task 1/2/7/9 Minor review items
remain for whole-branch review; this validation does not silently close them.
