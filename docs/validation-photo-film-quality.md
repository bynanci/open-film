# Photo-film quality validation

This record covers the generated 20-second A/B calibration workflow, using
[the public fixture generator](https://github.com/bynanci/open-film/tree/main/fixtures/photo-film-quality).
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

Both variants use the candidate renderer. A is a minimal contain/fixed-gain
recipe for comparison, not a render from an older binary or the supplied private
film. B changes only the documented composition decisions over the same sources.

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

Re-executed on 2026-10-18 at 00:31 UTC using FFmpeg 7.1.5 on Linux, with the
corrected implementation frozen at `8baa2740eea22bcb2f33a29647839c12a7585b31` on
`codex/photo-film-quality`. The run explicitly records `workingTreeDirty: false`.
The local `implementation-sources.json` lists hashes of the actual core,
renderer, fixture and runner source files. Its SHA-256 is
`6a10222797e296f6f28792bd41667f05a64045c96c20501a76b7f1f6fed2aadf`.
This is local execution evidence for that committed implementation, rather than
CI, human listening or workstation evidence. Later validation/CI-configuration
commits do not change that implementation identity.

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

Both hashes and all listed audio measurements match the earlier clean
`025bead76ce4303382a1bb785798776ccf24eb14` and
`ae61376ee8e9413e0982c00075053a2fe297b7c1` runs. Their MP4s, manifests,
source identities, summaries and Python-environment failure trace were archived
locally before each rerun. The 2026-10-18 00:05 UTC `025bead` run used the same
fingerprinted core/renderer/fixture source digest as this run; the newer fixes
affect other application/editor paths. The initial `ae61376` run's
2026-10-17 23:30 UTC source digest was
`9ea26157c2343b9a01ecf93468628f11809e99c2bcde282f3ed1972f7cec5bcc`.
Both regenerated 24-frame contact sheets were inspected after the corrected run;
the requested framing, motion, title and transition samples remain present.

The fixture scenario regression tests pass (3 tests): unchanged 20-second
timing and source library, rejection of an incomplete library, and safe active
motion with intentional crop fallback. Scoped ESLint and Prettier checks pass.
Actual aesthetic judgment, listening and projection are still manual gates.

## Corrected implementation regression ledger

The frozen `8baa2740eea22bcb2f33a29647839c12a7585b31` implementation has these
complete local non-browser results. Its browser/CI outcomes are recorded
separately on [PR #18 checks](https://github.com/bynanci/open-film/pull/18/checks);
earlier implementations' browser history below is not substituted for them.

| Gate                         | Result                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `pnpm format:check`          | Passed                                                                         |
| `pnpm test:i18n`             | Passed: 1,275 keys                                                             |
| `pnpm lint`                  | Passed                                                                         |
| `pnpm typecheck`             | Passed                                                                         |
| `pnpm test`                  | Passed: 158 files, 2,273 tests in 110.40 seconds                               |
| `pnpm build`                 | Passed                                                                         |
| `pnpm test:interchange`      | Passed: official OTIO 0.18.1 parser and compatibility harness                  |
| Built CLI smoke              | Passed: real CJK/render/reopen workflow                                        |
| Focused photo browser suite  | Passed: 11/11 in 1.1 minutes                                                   |
| Corrected-head browser suite | Recorded separately on PR #18 checks; earlier-head browser counts do not apply |
| `pnpm test:native`           | Not runnable locally: `cargo` is unavailable                                   |
| Published-head CI            | Recorded separately on PR #18 checks; local results do not substitute          |

## Historical `025bead` implementation checks

The preceding `025bead76ce4303382a1bb785798776ccf24eb14` implementation passed
157 files / 2,251 Vitest tests in 109.42 seconds and a complete 119/119 browser
run in 16.4 minutes. The later validation-only head
`df22ae18e5642a63b6fcf7a8db5e12f2af3ae1f8` also had successful CI. These results
precede four additional correctness fixes and do not validate the newer
`8baa274` implementation or its expanded 121-case full browser suite. Current
browser/CI evidence remains linked to PR #18 checks.

## Historical initial implementation checks

The following results belong to
`ae61376ee8e9413e0982c00075053a2fe297b7c1`, before the follow-up review fixes.
They do not describe the corrected implementation's larger test suite.

| Gate                    | Result                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Passed                                                                                                   |
| `pnpm test:i18n`        | Passed                                                                                                   |
| `pnpm lint`             | Passed                                                                                                   |
| `pnpm typecheck`        | Passed                                                                                                   |
| `pnpm test`             | Passed: 153 files, 2,213 tests                                                                           |
| `pnpm build`            | Passed                                                                                                   |
| `pnpm test:interchange` | Passed: official OTIO 0.18.1 parser and compatibility harness                                            |
| Built CLI smoke         | Passed                                                                                                   |
| Complete browser suite  | 116 passed / 1 environment failure in 16.5 minutes; separate configured retry 1/1 passed in 32.7 seconds |
| `pnpm test:native`      | Not runnable locally: `cargo` is unavailable                                                             |
| Published-h