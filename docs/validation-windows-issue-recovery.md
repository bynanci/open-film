# Windows media workflow recovery — issues66–68

Date:2026-10-30. Branch:`codex/windows-66-68`, stacked on D6B PR65.
Initial code base:`c0983a4f53af145a35c1ff6be2b958a2915eaad0`;
research-integrated base:`18f8c1f02b23a3bc015695eb8d6f47791e0364b2`.
Status: implementation and focused Linux regressions passed; independent review,
full gates and actual Windows/FFmpeg9 CI are pending. No release certification.

## Reports and root causes

| Issue                                                | Observed boundary                                                                                                                        | Change and regression                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [66](https://github.com/bynanci/open-film/issues/66) | User reports Windows10 build19045 / FFmpeg9.0.2 rejects retired `-vsync` during crop/frame preview.                                      | Use per-stream `-fps_mode passthrough` in frame extraction and independent low-fps decoding fixtures. A negative process-boundary fixture rejects the old option while executing actual FFmpeg for PNG/crop and24fps MP4; no assertions relaxed.                                                                       |
| [67](https://github.com/bynanci/open-film/issues/67) | Browser scan writes/flushed receipt successfully, then directory fsync returns EPERM on Windows, preventing staging.                     | One private directory-sync capability owner across scan receipt creation/removal and all three native/browser stage/index publication paths. Actual file data flushes and atomic rename/link remain; Node/Win32 directory fsync is explicitly unsupported. POSIX errors and Windows file-flush errors still propagate. |
| [68](https://github.com/bynanci/open-film/issues/68) | Benchmark ignores project-close response then removes SQLite fixture; a guarded/busy close can leave it open and cause EBUSY on Windows. | After all measurement/budget/artifact steps, quiesce the page, wait boundedly for HTTP200 close, verify no open project, then remove fixture with bounded OS handle-release retries. Persistent close/lock failures retain fixture and propagate; benchmark thresholds and samples remain unchanged.                   |

User-provided workstation log paths are not mounted here. Their reports are
external failure evidence, not a claim that these logs or the workstation were
retested by this cloud session. A Linux native SQLite probe confirms `close()`
releases the file descriptor even with a live statement/iterator; no SQLite
engine-close change is inferred from an unchecked client acknowledgement.

## Scope and safety

No original media, project/catalog schema, locks, required selections, editing
history, autosave or reopen contract is changed. No directory fsync error is
silently caught as a successful **file** flush. Windows lacks Node's directory
fsync operation; this is a documented capability boundary, not power-loss or
filesystem certification. Unsafe/symlink directories remain rejected. Private
staged bytes are still hashed and source/revision fenced.

Benchmark cleanup waits only for the API's transient409 idle guard, up to10s,
with bounded network calls. Other HTTP errors fail immediately. Its measurement
artifact is written/attached before cleanup; a separate cleanup acknowledgement
is attached afterward. File removal retries at most5 times/100ms backoff after
confirmed closure; no performance assertion or failed benchmark is retried.

## Actual local evidence

- RED:`/tmp/openfilm-windows-66-67-red.log`: retired-option process rejection and
  Win32 directory EPERM both reproduce. An extended staging test then exposed
  the third directory-flush path; that is covered by the same owner.
- GREEN:**92/92 across7 suites** in62.44s:
  `export-profiles`, `low-fps-export`, renderer low-fps, source discovery,
  source batch, Windows source-persistence capability and fixture-cleanup.
  `/tmp/openfilm-windows-focused.log`.
- Actual PNG/frame/crop and MP4 decode, delivery-rate frames, file flush/hash,
  browser scan→stage→reopen→seal, readiness, POSIX/file-error propagation and
  fixture retained on unresolved closure are asserted.
- The capability fixture uses real files, hashes, rename and reopen with an
  explicit mocked OS directory limitation. It is not Windows execution evidence.
- Local FFmpeg7.1.5; official OpenTimelineIO0.18.1 via the existing venv.
  Type/lint/build/full-suite/browser/CI results are recorded after source freeze.

## Actual Windows and FFmpeg9 gate

`Windows media recovery` runs on Windows2022 with Node24.14.0, pnpm11.11.0,
Python3.12 and official OTIO0.18.1. It records exact source/check-out SHA,
OS/runtime/version outputs and executes all focused regressions plus the four
reported browser suites (crop/profile/follow-up, multi-source review and the
original instrumented interaction benchmark). Logs and synthetic browser artifacts
are retained for7 days. No binary/font/private user media is uploaded as evidence.

Tools are hash-pinned before use, not pulled from an arbitrary latest URL:

| Input                                            | Identity / SHA-256                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| GyanD FFmpeg9.0.2 essentials ZIP                 | `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba` |
| Noto Sans CJK TC Regular, upstream Sans2.004 OTF | `dce08bd4fd91aa8aa76ed8fea4b694c2dfb8550f67871e326843212ddbeb88b4` |
| Upstream SIL Open Font License1.1                | `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2` |

Source URLs are fixed in the workflow. FFmpeg remains a separate test executable;
Apache-2.0/NOTICE and distribution contracts are unchanged. The font license is
preserved in evidence; the font is temporary CI input, not committed or bundled.
The existing D7A fixed-font/metric program remains broader than this narrow gate.

## Version/research and remaining gates

Main research checkpoint132cac1 is integrated; research proposals remain
non-authoritative until reconciled with existing TASKS/ROADMAP. Latest published
stable is stillv0.4.0; this repair creates no automatic version/release promise.
Retarget this stacked PR to main after PR65 merges and verify its exact head.

Actual Windows10/popopc rerun, native picker/installer/update/rollback, macOS,
physical external drives, real NLE/Resolve, GPU/4K/audio/display and power-loss
behavior remain separate manual gates. Issue7 stays open. Hosted Windows evidence
must be read before calling these three fixes ready to merge; Linux mocks and
protocol fixtures cannot substitute for that job.
