# Windows issue recovery — #66, #67, #68

Base: D6B candidate `c0983a4f53af145a35c1ff6be2b958a2915eaad0`.
This PR is stacked on #65 until that foundation merges; it will then target main.
User authorized continuing issue repair during roadmap validation.

## Contract and constraints

Preserve existing Composition, source locks, required selection, project/catalog
schema, rights, source hashes, autosave and Undo. No installer/release or hardware
claim. Use synthetic media, no private workstation files in public artifacts.
Existing Windows reports are on main9c392b7; report updated candidate evidence
separately. Do not suppress file sync failures or relax render/layout assertions.

## Task1 — FFmpeg9-compatible frame extraction (#66)

Replace retired global vsync0 with per-stream fps_mode passthrough in frame
extraction and independent low-fps decoding fixtures. First reproduce the removed
flag at the real process boundary, then decode PNG and MP4/rate output. A Linux
compatibility shim is a negative protocol fixture, not FFmpeg9 workstation proof.

## Task2 — Windows scan/stage persistence (#67)

Use one private directory-sync capability owner for source scan receipt creation,
removal, staged source publication and browser stage indexes. File bytes remain
flushed before atomic rename/link. Windows has no Node directory-fsync primitive;
skip that unsupported directory operation explicitly, while retaining directory
path/link guards. POSIX errors and file write/sync/rename errors still propagate.
Test actual files/scan readiness and exact error behavior; verify browser staging.

## Task3 — Benchmark fixture shutdown (#68)

Quiesce the instrumented page, require successful project-close acknowledgement
and no active project before removing the private fixture. Bound transient409
waiting and any Windows filesystem-release retries; preserve benchmark artifacts
and fail closed on unresolved closure. Do not alter benchmark measurements/budgets.

## Task4 — Verification/review/PR

Focused unit/integration/actual FFmpeg and browser regressions, full available
gates, one independent fresh-context whole-branch review, TASKS/ROADMAP and
validation updates. Add Windows CI runtime/version evidence where executable;
keep unavailable workstation/manual observations open. Publish one cohesive issue
recovery PR, then retarget main after #65 integration. No unrelated dependency
upgrade or arbitrary JS/HTML/project code execution.
