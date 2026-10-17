# Photo-film quality validation

This record covers the generated 20-second A/B calibration workflow, using
[the public fixture generator](../fixtures/photo-film-quality/README.md).
It contains no user photographs, original films or private audio.

## Automated evidence

Run:

```sh
pnpm exec tsx scripts/photo-film-quality.ts /tmp/openfilm-photo-quality-evidence
```

The script renders real MP4s using `FFmpegRenderer`, stores both compositions
and their structural diff, verifies source hashes against renderer-generated
manifests, checks duration and audio-stream presence with FFprobe, extracts
24 frames per variant, and measures integrated loudness, true peak and overall
RMS. A narrow-band music measurement can expose whether the synthetic music
is attenuated during the known narration-tone interval. It cannot measure
speech intelligibility or whether the mix is pleasant.

The fixed comparison checks these distinct design operations:

| Operation          | A                    | B                                         |
| ------------------ | -------------------- | ----------------------------------------- |
| Portrait           | Contain              | Protected hero framing and gentle push-in |
| Landscape pair     | Contain              | Hero framing with protected region        |
| Detail             | Static contain       | Focused framing and bounded pan           |
| Paired memories    | One primary source   | Two explicit diptych sources              |
| Wide edge subjects | Contain              | Protected hero request with safe fallback |
| Text               | Legacy default title | Film title / scene statement / subtitle   |
| Audio              | Fixed gain           | Fade-in/out and manual ducking            |
| Duration           | 20 seconds           | 20 seconds                                |

## Execution record

Executed on 2026-10-17 at 23:07 UTC using FFmpeg 7.1.5 on Linux. The run used
the `codex/photo-film-quality` working tree based on Git HEAD
`f9ad717d8c70db61fb4f9863a350e807f15643c0`; it explicitly records
`workingTreeDirty: true`. The local `implementation-sources.json` lists hashes
of the actual core, renderer, fixture and runner source files. Its SHA-256 is
`c9b6c728018d1906b8c40f3467d6cbaa69cc8149478347047bb4afca45b3163f`.
This is working-tree execution evidence rather than CI or workstation evidence.

| Measured output                          |           A |           B |
| ---------------------------------------- | ----------: | ----------: |
| Container duration                       |    20.000 s |    20.000 s |
| Video frames (FFprobe)                   |         600 |         600 |
| Integrated loudness                      |  −21.2 LUFS |  −22.9 LUFS |
| True peak                                |  −11.1 dBFS |  −14.2 dBFS |
| Overall RMS                              | −23.27 dBFS | −25.16 dBFS |
| 220 Hz music band, before narration tone | −26.08 dBFS | −26.07 dBFS |
| 220 Hz music band, during narration tone | −25.96 dBFS | −37.04 dBFS |

Both MP4s contain audio, every renderer manifest source hash matches its
generated source, and all ten original source files retain the same bytes
after rendering. B's music-band measurement decreases by approximately
10.96 dB during its ducking interval; A changes by approximately 0.11 dB. These
are measurements of this synthetic fixture, not a general loudness target or
an assessment of speech intelligibility.

The actual extracted frames show the hero portrait, two-source diptychs,
three Traditional Chinese text roles, a 0.2-second dissolve and the wide
protected-region contain fallback. The manifest records only the expected
`PHOTO_PROTECTED_REGION_CONTAIN_FALLBACK` advisory for B. The comparison
scenario tests verify that the push-in and pan remain active and safe instead
of silently falling back to holds. Frame labels occupy an added strip outside
the decoded image, so they do not cover the subtitles under review.

Output SHA-256:

- A: `3161b86cc6071f6b34249a7ddbc5cbe4d25a7289ffef9466e5772fab625e6ad4`
- B: `50efd58bb33accdf78d078c23d2918af02732921a6ad37760bfe3ba86f65a376`

The fixture scenario regression tests pass (3 tests): unchanged 20-second
timing and source library, rejection of an incomplete library, and safe active
motion with intentional crop fallback. Scoped ESLint and Prettier checks pass.
Actual aesthetic judgment, listening and projection are still manual gates.

## Manual gates

- Inspect actual start/middle/end frames and transition edges for crop loss,
  inappropriate overlap, drift, missing characters and unreadable text.
- Listen to real narration, original audio and licensed music; a synthetic
  gated tone cannot verify intelligibility or emotional continuity.
- Test real portrait/landscape originals, actual CJK project text and intended
  projection/playback hardware. No user image or attachment is a public fixture.
- Windows native operation, hardware/camera sources and real Resolve finishing
  remain separate workstation gates.
