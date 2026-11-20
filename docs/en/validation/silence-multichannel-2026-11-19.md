# Silence analyzer multichannel regression — 2026-11-19

## Scope

This adds objective regression coverage around the existing FFmpeg-backed
`analyzeAudioActivity` implementation for synthetic six- and eight-channel WAV
sources. It does not add a mixer, decoder, job engine, new Silence workflow or
new production algorithm. The current analyzer already decodes the selected
audio stream without downmixing and computes each 20 ms window's peak across
all channels.

This work is a software regression check for Issue
[#144](https://github.com/bynanci/open-film/issues/144). It is not evidence of
captured multichannel material, speaker-layout interpretation, physical output
routing, human listening, or Windows/macOS workstation acceptance. Issue #144
remains open.

## Cases

The existing media test helper writes temporary signed 16-bit PCM WAV sources
at 48 kHz. FFmpeg decodes them through the production analyzer. Each source is
2.2 seconds long with activity during `[0.4, 0.8)` and `[1.2, 1.6)`, a `-40 dBFS`
threshold and a 0.3 second minimum quiet interval.

| Channel count | Case                  | Signal placement                                       |
| ------------: | --------------------- | ------------------------------------------------------ |
|             6 | Last channel only     | 0.5 full scale on channel 5; all other channels silent |
|             8 | Last channel only     | 0.5 full scale on channel 7; all other channels silent |
|             6 | Anti-phase outer pair | +0.5 on channel 0 and -0.5 on channel 5                |
|             8 | Anti-phase outer pair | +0.5 on channel 0 and -0.5 on channel 7                |

All four cases must report exactly these source-clock quiet intervals:

```json
[
  { "start": 0, "end": 0.4 },
  { "start": 0.8, "end": 1.2 },
  { "start": 1.6, "end": 2.2 }
]
```

The tests also verify that analysis leaves each generated source hash unchanged.
The anti-phase cases ensure that summing the active channels to mono cannot
erase the signal before silence classification. The last-channel cases cover
the upper channel boundary of both layouts.

## Verification

On Cloud, using Node `v24.19.0`, pnpm `11.11.0`, FFmpeg and FFprobe
`7.1.5-0+deb13u1`:

- `pnpm exec vitest run packages/media/tests/audio-activity.test.ts --reporter=verbose`
  — **14 tests passed**, including all four new decoded multichannel cases.
- A temporary mutation adding FFmpeg `-ac 1` while retaining the source channel
  count caused all four new cases to fail on the expected source intervals.
  The mutation was removed and the original source code passed the complete
  14-test file. No production file change is included.

The PR's exact-head CI is the authoritative verification for the merged test
and document changes. No local whole-project pass is inferred from this
focused run.

## Remaining acceptance

Still required for Issue #144: permissioned real multichannel recordings;
identified source and channel layout; human reference intervals; physical
device and output routing; listening for retained speech, seams, breaths and
music continuity; and Windows/macOS lifecycle evidence. The separate
1,152-sample / 24 ms frame-aligned MP4 tail still needs explicit review. This
synthetic test does not determine whether that tail is acceptable.
