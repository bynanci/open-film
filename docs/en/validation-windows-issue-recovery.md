# Windows media workflow recovery — issues66–68

Date:2026-10-30. Branch:`codex/windows-66-68`, based on main after merged
D6B PR65(5160d8f) and CI PR70(8de63ae).
Initial code base:`c0983a4f53af145a35c1ff6be2b958a2915eaad0`;
research-integrated base:`18f8c1f02b23a3bc015695eb8d6f47791e0364b2`.
Status: independent source review and focused Linux regressions passed. First
actual Windows/FFmpeg9 run exposed17 failures (75passed), now under repair;
full final gates remain pending. Subsequent runs isolate the cold owner-query
timeout; see the evidence below. No release certification.

## Reports and root causes

| Issue                                                | Observed boundary                                                                                                                        | Change and regression                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [66](https://github.com/bynanci/open-film/issues/66) | User reports Windows10 build19045 / FFmpeg9.0.2 rejects retired `-vsync` during crop/frame preview.                                      | Use per-stream `-fps_mode passthrough` in frame extraction and independent low-fps decoding fixtures. A negative process-boundary fixture rejects the old option while executing actual FFmpeg for PNG/crop and24fps MP4; no assertions relaxed.                                                                                                                                           |
| [67](https://github.com/bynanci/open-film/issues/67) | Browser scan writes/flushed receipt successfully, then directory fsync returns EPERM on Windows, preventing staging.                     | One private directory-sync capability owner across scan receipt creation/removal and all three native/browser stage/index publication paths. Actual file data flushes and atomic rename/link remain; Node/Win32 directory fsync is explicitly unsupported. POSIX errors and Windows file-flush errors still propagate.                                                                     |
| [68](https://github.com/bynanci/open-film/issues/68) | Benchmark ignores project-close response then removes SQLite fixture; a guarded/busy close can leave it open and cause EBUSY on Windows. | After all measurement/budget/artifact steps, quiesce the page, wait boundedly for HTTP200 close, verify no open project, then remove fixture with bounded OS handle-release retries. Unresolved closure preserves the fixture. Removal failures propagate and may leave a partially removed fixture; benchmark artifacts are preserved separately and thresholds/samples remain unchanged. |

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
A close failure preserves the complete fixture. A later recursive-removal failure
can already have removed unlocked siblings, so complete retention is not promised
after deletion starts. The measurement artifact lives outside the fixture.

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
  Initialsource8b9c9f4 passes323files/4543tests in395.11s and291browser
  in22.5m. Pre-cold-fixcadf5bc passes4544tests in437.41s and291browser
  in22.7m. These are predecessor evidence for the platform
  fixture corrections, whose final gates are recorded separately.

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

## First actual Windows result and follow-up

Run [41029892847](https://github.com/bynanci/open-film/actions/runs/41029892847)
checked out exact source8b9c9f48aad1ca6cb2fd3ea0e6fe496bcb724a80 on
Windows Server2022 build20348, Node24.14.0, pnpm11.11.0 and hash-pinned
FFmpeg9.0.2. Scan/stage/source persistence passed. Overall75/92 passed;
the dependent browser step did not run. Preserve this failure, not a Windows pass.

The failures expose Linux font paths, raw URL pathname conversion, POSIX mode
expectations, slash-only containment and unverified cross-process owner recovery.
Follow-up keeps exact source hashes and all rendering/layout assertions, uses
independent fixed Sans/Serif/weight fixtures, checks actual Windows DACLs rather
than ignoring permissions, strengthens containment to the expected parent path,
and records boot-scope diagnostics. The second actual Windows run41032361736
passed85/92: the remaining7 expose inbox Windows PowerShell importing
incompatible Core modules. Its three independent boot-query hashes are identical;
there is no evidence to replace or round the boot identity. The correction
restricts `PSModulePath` to the trusted inbox system module directory and strips
case-variant inherited entries for both the owner query and the ACL inspection. Unknown
owners remain protected; no PID-only or guessed boot-time recovery is authorized.

Actual run41035002706 retains the two failures with a sanitized process-boundary
observation: parent query **ETIMEDOUT after5019ms**, whereas the later child has
verified scope. The temporary observer recorded no machine identifier or raw
command output and is removed after establishing the cause. The fix permits
one later query, retaining the same5s deadline and requiring real verified OS
proof; failed/foreign/malformed proof stays unknown. Each local token retains its
original host binding across an upgrade, preventing orphaned queues and token
retagging. Two new regressions fail before this change; all80 cases across
owner-platform, request-lock and actual export suites pass afterward. No timeout
assertion, dead-owner assertion or recovery-winner hash assertion is removed.

Single independent whole-branch review (base18f8c1f..3cab20d): no Critical or
Important source finding. One Minor factual retention claim is corrected above;
actual Windows/FFmpeg9 and full gates remain required. No repeated review loop.

## Actual browser blockers and fixture recovery

Run41036400792 at38dbcde passes107/107 focused tests on actual Windows and
FFmpeg9; browsers6/13 pass. Run41039192203 at75da28b identifies two fixture
problems: source seeding uses an8.3 alias rejected by the existing canonical-file
guard, and Restart Manager identifies the benchmark **test worker itself** as
WAL owner even though the server acknowledged closure. The retained benchmark
artifact has **zero samples**, so it is not a passed measurement report. The
cleanup exception concealed the earlier seeding failure.

Canonicalize only the newly created, owned synthetic temporary roots. Production
source/link/alias guards are unchanged. A real controlled aliased-parent fixture
fails before this change, then imports two canonical synthetic sources, rejects
an alias input, keeps exactly two assets and verifies all original bytes unchanged.
NTFS permits about1024 hardlinks per file; the old2000-link fixture stops at
index1023. Use SHA-verified identical source banks of at most500 links, retaining
all2000assets/500clips/10000segments/100000words. Six real-file tests preserve
all paths and bytes, enforce link caps and reject invalid sizes. Seed catalog
rows in one public synchronous transaction outside all measured samples. Artifact
records identify the bank topology; future timing comparisons require matching
fixtures, and no historical speedup is claimed.

A failed synthetic seed releases its own catalog without another save; normal
handoff still saves/closes before the server opens. Teardown retains primary and
secondary errors together. Three new failure-context cases RED→GREEN; original
four close/retention assertions, metrics, budgets and one-run policy remain.
Run41045709080 at3ab1296 passes **13/13 actual Windows browser journeys**
(including the unchanged measurement budgets and confirmed fixture cleanup),
but116/117 focused regressions pass. Source verification fails with
`ENAMETOOLONG`: the full job ID plus nested temporary prefix exceeds the Windows
path budget for an otherwise valid private parent. Compact only the random
verified-snapshot child prefix to `src-`; no byte/hash/ownership/source/alias guard
changes. A real225-character parent regression fails before the fix and then
verifies snapshot path<260, exact source hash/bytes and cleanup. Temporary
process-owner/source-generator diagnostics are removed after the cause is proven;
original assertions remain. Final Windows and full combined gates are refreshed.

## Version/research and remaining gates

Main research checkpoint132cac1 is integrated; research proposals remain
non-authoritative until reconciled with existing TASKS/ROADMAP. Latest published
stable is stillv0.4.0; this repair creates no automatic version/release promise.
PR65/70 are merged and this PR now targets main; verify the final combined head.

Actual Windows10/popopc rerun, native picker/installer/update/rollback, macOS,
physical external drives, real NLE/Resolve, GPU/4K/audio/display and power-loss
behavior remain separate manual gates. Issue7 stays open. Hosted Windows evidence
must be read before calling these three fixes ready to merge; Linux mocks and
protocol fixtures cannot substitute for that job.
