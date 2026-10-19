# M6 / PR 6B validation

Implementation source is based on PR #32 / Audio Quality, head
`51f945cdf81a9ca78a60572d7c1f1bb2c3472242`; final base/head and CI links are recorded
in the PR's verification report before merge. No merge is authorized by a queued
or unfinished test result.

## Verified locally before PR publication

- `pnpm format:check`, `pnpm test:i18n` (1643 semantic keys), `pnpm lint`,
  `pnpm typecheck`, `pnpm build`: passed.
- `pnpm test`: 206 files / 2898 tests passed. An earlier run exposed missing
  dependencies in the existing extracted unmount-hook fixture; the fixture was
  updated without weakening any assertion, and the full suite reran successfully.
- `pnpm test:interchange`: 18 official OpenTimelineIO tests passed, including
  source hash/bounds and relocation; actual Resolve import remains unverified.
- New focused application/provider/API/component regressions: 5 files / 7 tests.
- Focused browser regressions: normal, delayed and lost import acknowledgments
  all passed. Delayed import blocks Undo/navigation; retry creates one source and
  one timeline overlay. Full browser results are recorded in the PR report.
- Independent review corrected exact source identity, catalog revision/history
  handoff, pending import ownership/navigation and restart recovery. Final
  re-review found no remaining correctness blocker.

Coverage includes registry consent and revocation, unknown-cost acknowledgement,
redacted key/upstream errors, bounded bytes, malformed WAV refusal, cancellation
of an ignoring provider, consumed late output, stale revisions, source tampering,
unchanged locked sources, same-byte independent imports, idempotent import,
continuous Undo/Redo across an existing edit, reopen provenance and accepted
pending-draft recovery after restart.

## Actual FFmpeg evidence

FFmpeg 7.1.5 decoded a normal Renderer MP4 containing a two-second local synthetic
tone at the beginning of a four-second synthetic picture. Original music was
muted through its normal typed volume command. Meter assertions confirm signal
before 1.5 seconds and silence after 2.5 seconds; source manifests include the
accepted managed WAV's exact hash.

- Output duration: 4 seconds; integrated −24.74 LUFS; true peak −19.85 dBTP.
- Output MP4 SHA-256: `ebec04b793bd0461e40a83ee13def4d03d07f730d3ba006e6d6d6e7997e663b6`
- Accepted WAV SHA-256: `069de112a975f242f833fce8624f776136f4d75973ec20b0341764af4d78e923`
- Receipt model: `deterministic-tone-v1`, `mock: true`, cost $0.
- Local synthetic evidence: `/tmp/openfilm-m6-6b-evidence`; no private media,
  raw entered text or credentials are committed or uploaded.

The local mock is **not speech**. The BYOK adapter is tested with a network protocol
fixture, including exact text-only body and authorization handling. No paid live
TTS call or remote speech/pronunciation quality is claimed without a configured
key and provider account. Confirm current pricing and terms, listen to real TTS,
and review content before production use. Native gates run in CI; local Cargo is
unavailable. Hardware playback, target loudness delivery certification, 4K
throughput and external NLE finishing remain manual gates.
