# M6 / PR 6A validation

Base: `2af86273e0c92aab40408e86f9e4c656f85f5eaf` (M3–M5 merged).

New render/application/API/component regressions exercise actual synthetic AAC
MP4 measurement, null silence, role targets, true-peak limits, source hashes,
unchanged automation, typed volume acceptance, Undo/Redo/reopen, stale/foreign
media refusal and aborting a late UI result. The browser regression measures a
real four-second synthetic mix, auditions the candidate and accepts/undoes it.

## Automated evidence

- `pnpm format:check`, `pnpm test:i18n` (1627 keys), `pnpm lint`,
  `pnpm typecheck`, `pnpm build`: passed.
- `pnpm test`: 201 files / 2891 tests passed. The first run overlapped browser
  startup on port 4310 and failed; the isolated final run passed.
- `pnpm test:interchange`: 18 official OpenTimelineIO checks passed.
- New targeted regressions: 4 files / 6 tests passed, including actual one-hour
  stereo 48 kHz meter output bounded below 16 MiB; editor requestId retry test passed.
- `pnpm test:e2e`: full 164-test run in progress at PR creation; merge requires its result.
- Independent review found and corrected acceptance evidence fencing, bounded
  meter metadata and mutation lifecycle reuse; no remaining review blocker.

Synthetic four-second AAC MP4 evidence (FFmpeg decoded audio): original −13.51
LUFS / −7.29 dBTP, candidate −23.01 LUFS / −16.60 dBTP. Music gain −9.49 dB;
volume 0.8 → 0.2682810435604485; existing envelope/ducking preserved.

- Original MP4 SHA-256: `56888c508783642c2749d58c3afd0accfd59b898e1be44501ced2e272dbfb34e`
- Candidate MP4 SHA-256: `61343cd8fdb5979968674f89fea7743d5955cebc92b66fceea3efed5c17e5919`
- Synthetic WAV SHA-256: `1b5a99b2fba32b5d44a3e6cf62708b7350745942be081aab2636052edbfc5d6a`
- Synthetic picture source SHA-256: `ad3c84972333e7001e6190b7c343b5e194306d1f23d5cc5bd7005402d4cefe46`

Only `manual-review` was reported for this safe synthetic mix; silence, peak and
headroom cases have separate assertions. Local evidence lives outside the repo
under `/tmp/openfilm-m6-6a-evidence`; no personal media is committed.
Local Cargo is unavailable; native execution is separate from the media checks.
Hardware, physical listening setup, real-media aesthetics, 4K throughput and
Resolve/NLE finishing remain manual gates. Synthetic tones are not speech QA.
