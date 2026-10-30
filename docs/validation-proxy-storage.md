# D6A managed preview storage validation

Date: 2026-10-30. Candidate branch: `codex/d6a-proxy-storage`.
Integration base: `b8befab33144da8c0f2b1a1c10e0c6de602eae6b` (merged PR #63).
This is an unreleased candidate; full-gate and GitHub results are recorded below
when actually completed. Project schema 1.0.0 and Catalog v6 are unchanged.

## Implemented boundary

The existing `createProxy` generator is now managed by one application service.
It owns a bounded queue (128 active tasks), one worker, a configurable 5 GiB
managed quota (1 MiB–1 TiB), private receipts, health/verification and reviewed
cleanup. Desktop Library, HTTP and CLI call this service. Export continues to
read originals. Rebuilding a preview preserves the entire canonical MediaAsset,
locks, Composition, history and Named Version identity.

Ready-artifact provenance survives Named Version restore independently of the
operational jobs table. Derivation identity binds full source hash and decoder
metadata; a queued publication additionally fences the source locator. Thus a
relocated, identical original remains usable without allowing an in-flight task
to publish against a changed source. Managed source streaming checks receipt and
output hash, keeps a reader lease, and falls back to a compatible original after
corruption. HDR/HEVC still requires a valid compatible preview.

Background preparation returns a bounded HTTP worker ticket and keeps durable
per-source jobs. Transport-level failures are visible in status. Cancellation
bypasses the HTTP mutation queue; cross-process cancellation remains pending
until the actual owner settles. Project switching/close waits for owned work;
ordinary editing remains available. No process is killed using a supplied PID.

## Regression evidence

- Six focused suites: **62/62 passed** (contracts, application, HTTP, CLI,
  component and acknowledged-refresh handling).
- Four real Chromium tests passed: actual preparation/corruption/rebuild/cleanup;
  English, Traditional Chinese and Japanese at **375/720/1280 px**; native
  keyboard details/checkbox controls; scoped WCAG 2/2.1 AA axe checks.
- Full TypeScript/Vue typecheck and ESLint passed; i18n **2614 keys** match.
- Each new feature first reproduced a missing behavior or invariant violation.
  The normalized cache-path regression fails on the old legacy fallback and
  passes after canonical namespace classification.

Application regressions generate two-second 320×180/12 fps synthetic H.264/AAC
MP4 and MP3 audio previews with FFmpeg, decode them, check duration/dimensions,
full original/output SHA-256 and representative picture/audio. A real original
Composition render has identical decoded frames, audio and timing before and
after managed-preview removal. Sources remain unchanged. The CLI subprocess
reopens its durable queue and cleans only an explicitly reviewed unchanged list;
it leaves `project.json` byte-identical.

Other checks cover stale sources, unknown/live owners, late worker claims,
resume after cancellation, quota failure with usable original import, unchanged
locked assets and Named Version restore, project/source relocation, same-size
corruption, cross-workspace readers/Composition protection, symlinks, unsafe or
unknown receipts, original references inside work trees and partial I/O released
byte counts. Cleanup acceptance revalidates exact receipt/file/source identity,
policy and current protection; CLI reviews expire after ten minutes.

## Independent review and compatibility repair

A fresh read-only review found two filesystem-alias failures. Real directory
symlinks could hide original references from cleanup/stopped-work recovery;
legacy-looking symlinks and hard links could bypass managed streaming checks.
Both were reproduced, then fixed in one regression-backed pass. Source guards
use canonical targets/file identities and retain uncertain originals. Legacy
aliases cannot bypass receipt verification or managed reader ownership.

The existing missing/empty-preview404 diagnostic and explicit reimport repair
contract remain intact. Only invalid managed bytes/ineligible aliases may fall
back to compatible original playback. Relocation recognizes strict managed
filenames. Seven shared/legacy suites now pass **135/135**, including actual NLE
handoff. No assertion was removed or weakened. The initial full run exposed
these boundaries and an unselected Python environment; it is not reported as a
pass. The final run uses the existing isolated OpenTimelineIO0.18.1 environment.

## Full-workflow repair and retained FFmpeg proof

Full browser validation additionally found completed background proxy children
masking the foreground import completion. The Activity selector now preserves
the latest foreground completion, with a standalone proxy fallback. Two unit
regressions and **10/10** real Desktop/global-language/proxy browser workflows
pass; no existing assertion was weakened.

A retained two-second synthetic moving-pattern/tone proof has **24 decoded video
frames** and **96256 decoded 48 kHz mono audio samples**. Before and after preview
removal, the actual original-render MP4 SHA-256 is identical:
`fcb4d013aac58932e72a4cb4141beb530e1ac61e11ca86f83429ef1766ed93d3`.
Decoded RGB and PCM hashes, source hash, canonical asset and Composition also
match. Source SHA-256:
`e824fc09c9861620cc48ec08b17e7d0324fd445c4c23ecb11f90cbd0f20c4f9f`.

Local `pnpm test` and `pnpm test:e2e` must run sequentially: the existing native
benchmark fixtures and the browser fixture both own port4310. A concurrent run
failed that native fixture; the unchanged isolated protocol test passes. The
failed/aborted broad runs are retained and are not claimed as passing evidence.

## Full-gate results

Pending final review and full available local/GitHub gates. No full-gate,
workstation, performance or native installer result is implied by focused tests.

## Manual gates and limits

- Physical Windows/macOS close/cancel/reopen, trackpad, high-DPI and sustained
  large-drive/4K performance are unverified. This Linux environment cannot
  operate the user's `popo-pc` Windows workstation.
- FFmpeg generation uses one bounded source snapshot on disk. Temporary disk
  space and source hashing are intentional integrity costs, not a zero-I/O claim.
- Health polling reports recorded/verified state without hashing every source.
  Explicit verification may perform full reads. Legacy/unmanaged files are
  disclosed separately and never silently deleted.
- Unknown workers require explicit confirmation that previous workers/readers
  stopped. Alive owners remain protected. An unknown receipt never authorizes
  streaming, deletion or publication.
- No native installer, signing, automatic update, Resolve or hardware QA is
  certified here. Issue #7 remains open. No stable release is published.

## Next scope

D6B remains separate: inspect Collect Media owners, then design trimmed-original
packages with handles and explicitly offline preview packages. Do not claim a
proxy is a master or silently change original Composition/source ranges.
