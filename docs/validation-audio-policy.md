# D3B1 independent sound — validation

Date: 2026-10-30. Approved design `8c9ad31`; implementation checkpoints
`e360f38` (private PCM), `f012000` (Record/Inspector), `9d4802b` (packet gaps),
`03ce867` (monotonic capability floor), `a4522f7` (retention), `5f83e69`
(canonical identity tempo), `7bd38e1` (actual browser capture and generation
fences). Pin dependency `094e4dc` is integrated separately; its fresh review is
coordinator-owned and must not be inferred from integration.

Toolchain used here: Node 24.19.0, pnpm 11.19.0, FFmpeg/FFprobe 7.1.5 Debian,
Playwright 1.63.0 and its Chromium. All sources are local synthetic files. No
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
  installed OTIO0.18.1 environment runs that same case successfully unchanged.
- Soundtrack controls, compatibility locale and synthetic docs fixture:1 case
  each. Restored ordinary-audio exclusion and the always-visible Add start field,
  placed selected role/start controls with their actual selected owner, added
  localized independent-audio labels and the newly required guide fixture.

The full run retained the candidate-bound media manifests and measurements;
canonical phase errors were `[0,0,0,0,0,0,0]` from the single239-sample baseline.
No threshold, skip or retry policy changed. A second complete gate requires the
new integrated producer correction and the configured pinned parser environment.
