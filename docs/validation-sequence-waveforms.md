# D3A1 Sequence waveforms — validation

Date: 2026-10-30. Base: `e1255b1a8a83260149211d909cca8c1a50948c6b`.
This increment extends the existing Source peak cache, shared source-range
resolver and rational Record clock. No second timeline, extractor, catalog
migration, provider call or changed output policy is introduced.

## Safety and test-first evidence

- Literal projection cases cover source trim, speed, rational frame windows,
  the renderer's existing millisecond audio start, shortened final source bins,
  repeated sources and silence after the actual source ends.
- Waveform-only reads return current source hashes and no transcript, scene or
  marker payload. Batches admit one to eight unique source IDs; at most two
  reads hash sources concurrently. Typed missing/changed evidence is separate
  from unexpected storage errors.
- A real HTTP race regression exposed a read-only POST behind the server's
  mutation queue. The failing request blocked project switching. The fix admits
  only this waveform read outside that queue and registers it with the existing
  project-owned media-read cancellation barrier.
- Real port-zero HTTP tests now cover project switch with a delayed hash,
  client disconnect, old-project preparation rejection and successful fresh
  retries. Abort and error paths release read capacity before project closure.
- Desktop caches at most 32 sources, pages eight visible sources, fences owner
  and source generations and shares repeated-source work. Playback ticks make
  no evidence requests. Preparation uses existing analysis jobs serially;
  stopping its queue does not cancel active, shared or foreign jobs.
- The view consumes the latest acknowledged saved Composition and seeks through
  existing flush/history/ownership guards. Locks, source bytes, saved edits,
  autosave and reopen remain under their existing owners.

Initial focused integrated execution passed **72 tests in seven files**, plus
TypeScript/Vue and i18n checks (2,692 semantic keys). All **seven new Chromium
cases** pass, including native keyboard seeks, no per-frame reads, preparation,
stop/retry, project races, reopen and 390px Traditional Chinese/Japanese coarse
pointer layouts with 44px controls. Their original pulse/lock/history/queue
assertions remain intact.

First browser execution exposed fixture errors: duplicate imported source URIs
and double-close of the default page. Fixtures now use distinct local copies and
one teardown owner. A later strict status check exposed an accessibility issue:
the frame timecode used an implicit live `output` status. It is now ordinary text
with native slider value text, avoiding per-frame live announcements; a failing
then passing component regression covers this behavior.

Format, locales/docs mirrors, ESLint, types, production build, 18 official OTIO
parser cases and actual VitePress build pass locally. Fresh browser partition
verification discovers **298** cases, partitioned 78/81/69/70; CI validates the
actual candidate-bound report union rather than assuming the old count. Complete
candidate gates, independent review and main outcomes must be recorded before
delivery is marked verified. Local Cargo is unavailable; equipped hosted native
checks remain required.

## Final review correction

The final review reproduced a delayed five-page read sequence that evicted the
returned first page and left Refresh permanently disabled. Five new deterministic
regressions first failed: three cache cases and two real Vue-host cases. They
cover successful and failed first-page reads, all five batches settling, explicit
refresh recovery, unchanged protected source/Composition data and no frame-driven
requests. The cache now protects only the current eight sources while keeping
32 retained entries and two concurrent reads. Other entries retain deterministic
FIFO eviction. Loading requires a pending task; an absent entry without one has
a recoverable failed state. Generation and ignored-abort fencing remain intact.

Hosted Verify `41065126742` also exposed a Compare request spy treating the
waveform-only POST as a mutation. The spy now classifies only POST
`/api/intelligence/waveforms` as that read and explicitly checks its current
project, exact payload keys, one-to-eight unique Composition source IDs. All
other writes still fail the original no-mutation assertion. Original image-node
identity, controls, saved Composition and source-hash assertions are retained.

Fresh correction checks pass:

- Cache and Vue-host RED→GREEN: **5 intended failures**, then **29/29** passing.
- Cache, Vue-host and preparation files together: **40/40** passing.
- Whole `film-looks.spec.ts` and `sequence-waveforms.spec.ts` with Chromium:
  **17/17** passing (10 film-look cases and seven waveform cases).
- TypeScript/Vue, ESLint on all five changed source/test files, and formatting.
- Owned browser servers exited; ports 4310/1420 were confirmed released.

This correction does not certify full candidate CI or workstation gates. A fresh
scoped review and completed exact-candidate CI remain required. Full Vitest and
native benchmarks were not rerun in this bounded correction pass. Stable remains
0.4.0.

## Actual synthetic MP4

`packages/render/tests/sequence-waveform.test.ts` generates a synthetic
picture/pulse-audio source and a real six-second, 160×90, 20 fps MP4 containing
120 independently decoded frames. Four protected clips reuse that source with
trim, double speed, a held picture and half speed. The test extracts source
peaks and decodes output PCM at 48 kHz instead of asserting only filter strings.

| Clip | Expected pulse centre | Projected interval | Decoded PCM interval |
| ---- | --------------------- | ------------------ | -------------------- |
| Trim | 0.69 s                | 0.65–0.73 s        | 0.63–0.74 s          |
| 2×   | 2.27 s                | 2.25–2.29 s        | 2.24–2.30 s          |
| Hold | 3.54 s                | 3.50–3.58 s        | 3.48–3.59 s          |
| ½×   | 5.58 s                | 5.50–5.66 s        | 5.47–5.66 s          |

The output comparison uses **50 ms**, the maximum of one picture frame,
one source peak bin and one AAC packet, rather than summing the tolerances.
The held-picture tail has no projected coverage and decoded RMS below 0.003.
Source and Composition hashes are unchanged.

Observed local FFmpeg 7.1.5 evidence:

```text
source SHA256: 3a1cd8a2291625b8ecd44df538d5db6c951b5d251b02bedbbc2dc5d5bc9edde5
output SHA256: 2b55af51b1ce150fb8d0ca6937c3d05893fd1349a62cd4d787db3d8f544507f9
frames SHA256: 11560f3f9061d3f37f4811896214c8c6aa0a8d267cc1059d5cd21b94004e0c99
PCM SHA256:    5bba7a7fb2084c1f8b36f83d2d0a1d9de94afc3b844ba5e88cf558746a435a2b
```

These are observed synthetic receipts, not universal encoded-byte hashes across
FFmpeg versions. To retain a fresh local MP4 and JSON receipt, set
`OPENFILM_SEQUENCE_WAVEFORM_QA_OUTPUT` to a private local directory when
running the regression. No private media is used or published.

## Manual and deferred gates

Physical Windows/macOS audio latency, listening, trackpad/keyboard repeat,
high-DPI/color-managed displays, large real projects and 4K/GPU/Resolve remain
unverified workstation observations. These raw peaks do not measure the
rendered mix, promise sub-bin sample editing or infer musical beats. D3A2 rhythm
evidence and D3B1 J/L mixing remain separate roadmap owners.
