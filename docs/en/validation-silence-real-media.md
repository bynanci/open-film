# Real recorded audio validation packet

Issue [#144](https://github.com/bynanci/open-film/issues/144) remains open until
human listening and the Windows/macOS workstation checks below have evidence.
This packet exercises the existing application services; it adds no detector,
renderer, crossfade, or playback engine. Detection means measured low energy,
not speech VAD. All media and project files stay outside the repository.

## Sources and permission

Retrieved 2026-11-11 from Wikimedia Commons. Both description pages explicitly
identify own work and CC0 1.0. No license was inferred from an adjacent project.
CC0: <https://creativecommons.org/publicdomain/zero/1.0/>.

| Local filename     | Recording / attribution                                                                                                                                                                  | Description revision | SHA-256                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `paddy-neary.opus` | [Paddy Neary about holy wells in Kilkenny](https://commons.wikimedia.org/wiki/File:Paddy_Neary_about_holy_wells_in_Kilkenny.opus), recorded by A.-K. D., 2024-10-07; speaker Paddy Neary | `976876871`          | `42973f944af32809fe9f7446a7a745d64fe9fc3e51db521902563f7fa2946053` |
| `guitar.ogg`       | [Wikipedia guitar solo](https://commons.wikimedia.org/wiki/File:Wikipedia_guitar_solo.ogg), Leechfoot, 2025-08-12, guitar solo in F-sharp minor                                          | `1293865599`         | `d6ff6cafd3025db2e2215b32e3e7e6411fa08a8d2e0fca7c3353b5a4a82523a5` |

The interview description documents a chilly recording location and jacket
noise. It is a human interview, not synthesized speech. The guitar is described
as an own-work performance. The original interview is 21,506,264 bytes and the
guitar is 558,882 bytes. Neither binary is committed. The runner verifies both
hashes before using them. Keep the attribution and license with any shared
local packet; modification consists of excerpting, resampling, mixing, gain,
fades, ducking, speed, and the accepted ripple cuts.

Explicit download commands (the runner itself never downloads or uploads):

```sh
mkdir -p /tmp/openfilm-real-media
curl --fail --location --output /tmp/openfilm-real-media/paddy-neary.opus 'https://upload.wikimedia.org/wikipedia/commons/1/11/Paddy_Neary_about_holy_wells_in_Kilkenny.opus'
curl --fail --location --output /tmp/openfilm-real-media/guitar.ogg 'https://upload.wikimedia.org/wikipedia/commons/b/b6/Wikipedia_guitar_solo.ogg'
pnpm exec tsx tests/manual/silence-real-media.ts /tmp/openfilm-real-media /tmp/openfilm-real-evidence
```

The evidence directory must not exist. It is created outside the checkout. Run
on a clean committed candidate; the runner records the exact Git commit and
tool identities. Preserve failures and use a fresh evidence directory on retry.
`results.json`, saved projects, original/proposed WAV, accepted MP4, actual AAC
decode WAV, and source/derived hashes form the local listening packet.
Each `*-listening-observations.json` starts with unreviewed human fields,
candidate-bound source/timeline intervals and seam sample windows. Fill these
only from actual independent reference annotation and listening observations.

## Predeclared cases and objective criteria

These choices precede the first application analysis. They are not adjusted to
make a result pass. Each saved review records its full selected candidate IDs,
source intervals, timeline intervals, padding, revision, and review/job identity.

| Case                | Declared source and timeline                                                                                                                    | Analysis / treatment                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `natural`           | Interview original seconds 30–54 → 24-second 48 kHz stereo WAV → timeline 0–24                                                                  | −35 dBFS, minimum 0.3 s, padding 0.08 s; natural recorded noise/pauses remain                                              |
| `mixed-reuse-speed` | Same excerpt; source 2–14 (original 32–44), reused twice at speed 1.25 → timeline 0–9.6 and 9.6–19.2; guitar original 0–19.2 at 44.1 kHz stereo | Same detection settings; dialogue/music gain, fades and ducking; generated color video identifies the visual coverage only |

Require at least one selected low-energy cut per case; no invented silent gaps.
Before and proposed audition must leave the saved project unchanged. Accepted
Record PCM must equal proposed PCM. Independently rendered WAV must match at
the existing `2 / 2^23` normalized PCM tolerance. Actual MP4 must contain AAC at
48 kHz stereo with zero stream start PTS and audio stream duration within one
sample of the accepted mix. Record decoded AAC sample count, packet PTS,
container/video duration, loudness, peak and PCM error separately: AAC is lossy
and may have trailing codec padding. Do not assert AAC byte equality with WAV.
Sample jumps and codec error are diagnostics, not click/intelligibility passes.

Each `*-review.openfilm` is copied with storage closed before acceptance and
reopened to verify the saved review identity. Open this copy in the current UI
to replay the still-unaccepted Review. The other project contains the accepted
edit. Project media URIs refer to the local packet: rerun the runner on each
workstation to generate native paths and record that workstation's new review
identity. Do not silently relink media and reuse an earlier review receipt.

The runner checks explicit Accept → Undo → Redo → Save → cold Reopen, render
equivalence after reopen, old audition descriptor revocation, real-source
clip/track/source locks, User Pin, unsupported J/L timing, cancelled analysis,
and wrong-project request fencing. This is Linux application-service evidence;
browser project switching, in-flight audition cancellation, native devices,
and actual platform persistence remain separate manual gates.

## Human/device record — leave blank until observed

For each candidate-bound case record listener and UTC date, candidate SHA,
job/review ID, selected candidate IDs, source/output hashes, OS/build/installer
identity, hardware, output API and device, routing, channel layout, device and
browser sample rates, and volume. Record actual observations independently on
Windows and macOS. Linux headless execution supplies no device observation.

Before listening, compare source 30–54 and every removed source interval with
the natural recording. Mark speech, consonant/word tail, breath, intended pause,
room/clothing noise, or uncertain; record false removals and false retentions.
All speech and intended breaths must be retained or explicitly rejected by the
human reviewer. Do not use detector output as its own reference annotation.

At every seam, use the saved before/after sample windows to listen to original
mix, proposed mix, and **decoded accepted MP4** at matched output level. Assess
clicks, clipped consonants, breath truncation, music continuity, stereo routing,
gain/fade/ducking preservation and A/V synchronization against a human-annotated
reference. Record pass/fail/uncertain and original/timeline/accepted timecodes.
The generated static video cannot establish real lip synchronization. Add a
permissioned recorded A/V source with independent synchronization markers for
that gate; also add an independently captured multichannel source beyond stereo.

On each native workstation exercise locks/pins, J/L rejection, cancellation
during rendering, stale source/review callbacks, actual project switch during
audition, Accept/Undo/Redo/Save/Reopen and device disconnect/change. Preserve
failures. A checked objective assertion never fills a listening field.

See [existing synthetic validation](./validation-silence-rendered-audition.md)
for complementary deterministic coverage. Do not replace its synthetic-only CI
artifact policy with a real-media upload.

## Observed objective outcome — 2026-11-11

Measured implementation candidate:
`6ea8de24085fc25dc58d9b263dd743158dad9b5a`, Linux x64,
Node `24.19.0`, FFmpeg/ffprobe `7.1.5-0+deb13u1`.
The real-media runner **exits 1**: the mixed case fails the predeclared MP4
duration criterion. [Shareable measurements](https://github.com/bynanci/open-film/blob/main/docs/evidence/silence-real-media/2026-11-11.json)
contain hashes, review identities, selected IDs, cut intervals and sample windows;
media, project files, raw packet logs and human forms remain local.

| Measurement                                 |                  Natural |          Mixed reuse/speed |
| ------------------------------------------- | -----------------------: | -------------------------: |
| Original / accepted PCM frames at 48 kHz    |      1,152,000 / 904,320 |          921,600 / 732,672 |
| Selected source candidates / timeline seams |                  12 / 12 |                    12 / 12 |
| Before / after WAV maximum PCM error        |                    0 / 0 |                      0 / 0 |
| Accepted PCM duration                       |                 18.840 s |                   15.264 s |
| Actual AAC stream duration                  |                 18.840 s |                   15.240 s |
| AAC stream duration minus accepted PCM      |                 0 frames | **−1,152 frames (−24 ms)** |
| Actual AAC decoded frames                   |                  905,216 |                    732,160 |
| Decoded frames minus AAC stream duration    |                     +896 |                       +640 |
| Decoded frames minus accepted PCM           |                     +896 |                   **−512** |
| Before / proposed WAV / actual MP4 LUFS     | −26.50 / −26.26 / −26.32 |   −28.81 / −28.58 / −28.64 |
| Actual MP4 true peak                        |               −8.79 dBTP |                 −9.63 dBTP |

Both actual MP4s have AAC, zero audio start PTS, 48 kHz stereo and equal
video/container/audio stream duration. Both cases passed unchanged saved-project
checks during audition, exact proposed/accepted Record PCM comparison,
independent WAV comparison, locks/pins/J/L rejection, cancelled queued analysis,
wrong-project request rejection, descriptor revocation, shared-editor
Accept/Undo/Redo/Save/cold Reopen, and equal accepted/reopened AAC decode.
The still-unaccepted review project copies also reopened with the exact review.
These objective checks do not establish natural pause/breath classification.

The duration discrepancy follows the existing renderer policy:
`packages/render/src/index.ts` uses `composition.duration` for WAV and
`frameAlignedDuration(composition.duration, outputFrameRate)` for MP4, then
applies that duration to AAC as well. At 25 fps, complete output frames end at
15.240 s for a 15.264 s Composition. Thus codec padding and actual timeline
truncation are different observations. The runner preserves its one-sample
assertion, collects the remaining evidence, and reports failure. The policy
discrepancy needs a product decision or a coordinated renderer fix and rerun;
this validation-only change does not alter it.

AAC comparison over the common decoded duration measured maximum normalized
sample error 0.1128155 / 0.1355691 and RMS error 0.00278185 / 0.00342933.
These are lossy-codec diagnostics with no perceptual pass threshold. Maximum
PCM seam steps were 0.00362110 / 0.00286806. No click, intelligibility,
speech-retention or acceptable-music-join conclusion is drawn from them.

Related existing media regression selection passed **3 files / 22 tests** on
the same implementation tree. Full typecheck, focused ESLint, documentation
mirror and licensing checks passed. This is not a full-suite or CI claim.
Human listening, real recorded A/V synchronization, more than two captured
channels, live browser cancellation/project-switch behavior and both native
workstation/device acceptance gates remain open. `/dev/snd` was absent on the
Linux host; no output routing or playback sample rate was observed.
