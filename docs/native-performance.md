# Native first-open and long-session memory measurement

This runner measures a checkout-built **native Tauri app**, not Chromium/Vite.
It does not certify an installer, actual screen presentation, real-media decode,
or leak freedom. Actual workstation execution remains a manual gate. This cloud
environment has no display or workstation connection; no workstation timings or
memory results have been recorded here.

## Prepare on the workstation

Use the same OS account, power mode, display size/scale, WebView version, storage,
locale, project and background activity for baseline and candidate. Record those
conditions before judging results. Do not clear real user preferences/caches or
delete projects to create a benchmark. Use a separate QA account and generated
fixture. An existing application profile and warm filesystem cache are different
from first install and cold OS startup. This runner hashes artifacts before
launch, which can warm filesystem caches: use it for declared warm-cache process
starts. A cold OS-startup experiment needs a separate external tracer and hashes
collected afterward; reboot alone does not make this runner a cold-cache test.

Build the release binary with the same Rust/Node/tool versions on both revisions:

```sh
pnpm install --frozen-lockfile
pnpm build
cargo build --release --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm exec tsx scripts/native-benchmark/create-fixture.ts /absolute/new-fixture
```

The executable is `apps/desktop/src-tauri/target/release/openfilm-desktop` on
Linux/macOS, or `openfilm-desktop.exe` on Windows. Launch the actual executable,
not `open`, an installer, `cargo run`, or a development server. A packaged macOS
app, if used later, needs its `Contents/MacOS` executable. Bundling is currently
disabled; this test does not certify a Windows installer.

The fixture has 2,000 generated 320×180, three-second H.264/AAC assets, 500 clips,
10 beats and cached thumbnails. It uses hard links where supported, with a copy
fallback, and records initial project/database/source hashes. It is synthetic;
it does not exercise real 4K, transcription, GPU or camera quality. The generator
refuses an existing destination. Keep the fixture root in place for comparable
runs: its saved source URIs are absolute, and relocation/relinking changes the
declared project/database identities.
Per-source hard-link capacity errors (`EMLINK`, including filesystem link ceilings)
also use exclusive copies. The manifest records linked and copied counts; an
unexpected I/O error still fails fixture creation instead of publishing a manifest.

## Configure a run

Create a local JSON file, using absolute workstation paths (Windows JSON paths
use `/` or escaped `\\`). Do not commit this file or personal paths.

```json
{
  "candidateSha": "FULL_40_CHARACTER_GIT_SHA",
  "label": "candidate-retained-1",
  "environmentKind": "workstation",
  "executable": "/absolute/open-film/apps/desktop/src-tauri/target/release/openfilm-desktop",
  "serverScript": "/absolute/open-film/dist/server/index.mjs",
  "fixtureManifest": "/absolute/new-fixture/fixture-manifest.json",
  "project": "/absolute/new-fixture/benchmark.openfilm",
  "outputDirectory": "/absolute/evidence/candidate-retained-1",
  "durationSeconds": 3600,
  "intervalSeconds": 5,
  "startupTimeoutSeconds": 60,
  "cacheCondition": "warm OS cache; separate QA account; existing app profile",
  "webviewVersion": "record actual WebView2/WebKitGTK/macOS WebKit version",
  "display": { "width": 1440, "height": 900, "scale": 1 }
}
```

Close previous native apps/services first. Port 4310 must be free. The runner
starts its own built Node service, waits for that process's readiness event and
health response, then starts the native binary. The Node executable defaults to
the current pinned Node; `nodeExecutable` can explicitly name another absolute
executable. This avoids crediting an unrelated or previously warmed service.

```sh
pnpm exec tsx scripts/native-benchmark/run.ts /absolute/native-run.json
```

Remove `project` for a Welcome launch. Keep it for a loaded Library/500-clip Edit
run. Each output directory must be new. Binary/server/fixture hashes and actual
process IDs and actual project/SQLite/WAL hashes before startup are captured.
Final project hashes are recorded after shutdown; expected edits may change them.
A project configuration names the **immutable generated template**. Before any
owned process starts, the runner validates the complete versioned manifest,
canonical project path, every declared file/media size and SHA256, and any SQLite
WAL payload. A matching clip count alone is insufficient. Missing/modified inputs,
ambiguous paths and an undeclared nonempty WAL reject the run before service launch.

Each project run copies the declared project files into
`<outputDirectory>/benchmark.openfilm`, verifies their original identities, and
opens that isolated copy. Preflight also compares BigInt device/inode identities:
source-linked paths must match the declared link count, and copied media must
have independent identities. A byte-identical backup/copy that changes this
topology is rejected. Filesystems without usable inode evidence fail explicitly
instead of being credited as verified; real Windows behavior remains manual. Media references continue to use the validated original
fixture. `manifest.json` records both template and runtime paths; its initial
project hashes and `lifecycle.json` final hashes describe the runtime copy.
Normal server shutdown updates `project.updatedAt`, and manual edits remain in
the run copy. Neither operation alters the template or silently refreshes its
manifest. This permits warm-up and retained runs to share the same initial film.
The initial run manifest is created exclusively. Later PID/runtime updates write
an exclusive sibling temporary file, close it and rename it over the manifest.
Partial writes or denied replacement retain the previous valid manifest and fail
the run; temporary cleanup does not delete the published destination. This is
atomic replacement tooling, not a power-loss durability or real Windows claim.
Keep the copy with the raw evidence; it is not a portable project without the
original media root. Prepare a new fixture if the template itself changes.

A project run without a matching fixture-sized Edit visit is `scenario-incomplete`,
not a completed Edit experiment. The supplied Git SHA and display/runtime/cache metadata
are declarations: review the actual build/checkout provenance before comparison.

Compose-to-Edit enters through the same guarded navigation path after the compose
job finishes. Its entry intent captures the new composition size before initial
Edit rendering. Replacing a composition while already in Edit remounts the editor
without creating a duplicate navigation intent.
Once the create API acknowledges the composition, its returned film is kept in
the current project cache. Later project-refresh or asset-preload errors remain
visible through existing localized feedback but do not turn that creation into
a failed action or suppress guarded Edit entry. Other compositions are retained.

## What each clock means

| Field                                  | Definition                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serviceReadyMs`                       | Runner start through owned service readiness/health; includes preparation overhead.                                                                                                    |
| `nativeSpawnMs`                        | Runner offset immediately before spawning the native executable.                                                                                                                       |
| `spawnToFirstCheckpointObservedMs`     | Spawn through runner observation of the first usable UI checkpoint; a polling upper bound.                                                                                             |
| `firstUiReady.nativeElapsedMs`         | Rust `run()` entry through local checkpoint receipt after successful boot and two frame opportunities.                                                                                 |
| `editVisits[].nativeReceiptDurationMs` | Rust receipt-to-receipt interval; excludes any work before the first IPC arrives and must not substitute for Edit opening cost.                                                        |
| `editVisits[].durationMs`              | Same-document renderer clock, captured synchronously before Edit activation through two-frame readiness; includes initial mount/layout and excludes human navigation before the click. |

`welcome-ready` and `library-ready` require successful boot and visible UI.
`edit-ready` requires the active Story editor, a saved loaded snapshot, matching
rendered clip count and one selected clip after two frame opportunities. Hidden,
stale or unmounted views are not credited. These checkpoints do **not** establish
that video or all lazy thumbnails decoded, or that a compositor presented a frame.
Pending readiness resumes when a hidden document becomes visible, requiring two
fresh visible frame opportunities while retaining the original boot/Edit clock
origins. Obsolete snapshots, editor invalidation and unmount cancel the retry;
an already-sent IPC checkpoint is not automatically replayed.
The local service is prestarted: neither UI timing represents single-click
packaged startup including service creation.
Fixture preflight/copying precedes the runner clock and warms source caches;
it is not included in UI readiness or first-Edit duration.

No diagnostics run in browsers. Native diagnostics default to disabled; the
runner enables a local fixed-field checkpoint file for its unique run only. No
media, transcript text, project paths or remote telemetry enters checkpoints.

Transient busy/error/loading/connection states cancel the current frame attempt
but retain the original boot retry while its project and Library view remain
valid. Recovery rearms that attempt with the original clock; acknowledged
completion prevents replay. A project/view/generation change or unmount
permanently expires that boot retry.

## Startup repetitions and one-hour soak

First collect one excluded warm-up and three retained short runs per revision
(for example `durationSeconds: 30`). Close the app normally and wait for both
native/service processes to exit between runs. Open Edit once on each run and
verify 500 clips, selected clip/inspector, source preview, keyboard selection and
normal save state. Compare medians and the raw three observations; do not claim a
speedup from one run. Baseline and candidate must contain **the identical
checkpoint instrumentation**. An old binary without it fails readiness instead
of being treated as a fast launch. Preserve source/build hashes and document any
instrumentation-only patch on the baseline.

Then run one hour per revision with the same declared action schedule:

| Minutes | Activity                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------- |
| 0–10    | Open Edit once; idle with the same clip selected.                                                              |
| 10–20   | Perform 200 click/keyboard selections across beats; verify focus and source identity.                          |
| 20–40   | Repeat Library → Story → Edit 20 times; keep the same composition.                                             |
| 40–50   | Scroll both rail axes; preview the same source, stop playback; verify keyboard/undo/save/reopen as applicable. |
| 50–60   | Return to the original selected clip, stop playback and idle for recovery.                                     |

Record phase boundaries in another terminal:

```sh
pnpm exec tsx scripts/native-benchmark/run.ts mark /absolute/evidence/candidate-retained-1 idle
pnpm exec tsx scripts/native-benchmark/run.ts mark /absolute/evidence/candidate-retained-1 editing
pnpm exec tsx scripts/native-benchmark/run.ts mark /absolute/evidence/candidate-retained-1 revisit
pnpm exec tsx scripts/native-benchmark/run.ts mark /absolute/evidence/candidate-retained-1 idle-recovery
```

These are operator markers, not proof that the actions occurred. Keep action
counts/observations alongside raw evidence. The runner does not mutate the film,
force GC, automate arbitrary UI actions, kill the app on timeout or discard
edits. Ctrl+C stops monitoring and records interruption. Close a live app
normally afterward. The runner stays as a supervisor after collection, keeps
the service available, then stops its own service when the native process exits.
Repeated Ctrl+C during that wait still protects the app; do not kill the runner
or run a second collection until both native/service processes have closed.
`lifecycle.json` records actual exit and whether a service remained.
Machine-readable `native-benchmark.collection-stopped` has `terminal: false`
and a provisional `collectionStatus`; it requests normal window closure when
needed. Exactly one `native-benchmark.finished` with `terminal: true` is attempted
after native exit, service close acknowledgement/exit and final report/lifecycle
writes. Consumers must wait for that terminal event and a successful CLI exit;
collection-stop alone is not completion. Late shutdown or evidence-write failures
change the final status to failed without replacing frozen measurement clocks.
A broken terminal pipe fails the report/CLI and is not retried as another event.
The runner starts its service with a private Node IPC channel and an explicit
benchmark-only control flag. Cleanup requests wait for the control handshake,
then require a matching acknowledgement sent after project/database close and a
normal service exit. This applies on Windows as well as POSIX; the runner never
uses `ChildProcess.kill("SIGTERM")` for successful or startup-failure cleanup,
because that forcibly terminates a Windows child. Ordinary services expose no
HTTP shutdown endpoint. `serviceShutdown` and `serviceExit` preserve the actual
acknowledgement and exit evidence. Missing acknowledgement or abnormal exit fails
cleanup even if the process is no longer running.
Child liveness is checked again after asynchronous sampling and evidence writes.
A native exit during that work is `app-exited`; an owned service exit is `failed`.
Neither can become a completed collection merely because the time limit elapsed.
Service liveness is also checked after normal native shutdown, before requesting
service cleanup. An unexpected service exit while waiting for the operator to
close the window fails finalization and replaces the provisional completed
report with failure; the native window is never force-closed.
The native process must also exit normally after collection. A nonzero exit or
signal termination during that supervision fails the final report and CLI, while
the service still receives its private graceful-close request. The frozen
collection timings are unchanged; `lifecycle.json` retains the actual native exit.
The completed checkpoint lines are refreshed after the final asynchronous work,
before scenario classification and report freezing, so an Edit visit delivered
during the last sample is included.

An unwritable report does not bypass native-exit supervision or owned-service and
listener cleanup. Finalization errors remain visible and fail the CLI; if storage
permits, lifecycle evidence is still saved and the report records failure. A full
volume can prevent all evidence writes, so preserve the terminal error and partial
directory rather than treating missing files as a successful run.
Scoped stdout/stderr handlers also capture asynchronous write failures, such as a
broken pipe, without abandoning native-exit supervision or private service close.
Available report/lifecycle files retain failure; a surviving terminal stream can
still show normal-close instructions. Shutdown supervision retains native exit
before, during or after awaited terminal output, so an exit during a pending write
cannot strand the supervisor.
If the owned service survives the two-second shutdown grace period, finalization
fails and `lifecycle.json` records `ownedServiceRemaining: true`. The service may
still be finishing its graceful close; the runner does not force-kill an active
mutation. Preserve the error and owned PID from `manifest.json`, and wait for that
process to exit before another run. A surviving service is never credited as
successful cleanup.
An unsupported private-control handshake also fails cleanup. A remaining service
is not force-killed or disconnected while it may still be closing the project.

The manifest keeps the runner's version in `environment.node` and records the
service's actual private-handshake runtime in `environment.serviceNode`.
`identities.selectedNodeExecutable` / `selectedNodeSha256` identify the configured
Node launcher (or default runner binary); `serviceNodeSha256` identifies the
service-reported executable. Runtime binaries are hashed in bounded memory. These
separate identities expose runtime changes between campaigns rather than
attributing every service to the runner's Node version.

## Memory interpretation and evidence

`memory.jsonl` preserves each sampled process PID, parent PID, creation identity,
metrics, missing-data reasons, collection time and native/service roots. Metrics
are bytes. The two owned trees are deduplicated; totals with unknown membership
or missing metrics have no value. Check coverage before interpreting a peak.
Sampling begins after UI readiness, so **startup peak memory is not measured**.
Linux collection brackets its memory reads with two process enumerations.
Rooted membership, PID creation identity or parent changes make aggregates
partial/unavailable with no value. New unrelated processes do not invalidate a
known stable rooted tree. This is bounded topology validation, not an atomic
process snapshot; Windows/macOS runtime verification remains a manual gate.

| Platform | RSS                               | Private metric                                 | PSS                      |
| -------- | --------------------------------- | ---------------------------------------------- | ------------------------ |
| Linux    | `/proc/.../status` resident pages | Private resident pages from `smaps_rollup`     | Available where readable |
| Windows  | `WorkingSet64`                    | `PrivateMemorySize64`, private committed bytes | Unavailable              |
| macOS    | `ps` resident size                | Unavailable                                    | Unavailable              |

RSS sums can count shared pages more than once. Linux private resident and
Windows private committed bytes are different quantities; do not compare them
across OSes. macOS creation identity is only precise to one second. Detached,
reparented or shared WebView helpers may fall outside the current rooted tree;
this runner does not claim complete application-wide retained memory. Windows
enumeration can be costly: compare `collectionMs` and sampling cadence too.

Inspect complete-sample first/last/peak, per-process series and steady-state
windows in idle and idle recovery. A rising RSS series is an observation,
not proof of a leak. A short flat series does not prove leak freedom either.
No JS heap/GC metrics are synthesized from OS process memory.

Preserve `manifest.json`, `report.json`, `native-events.jsonl`,
`operator-markers.jsonl`, `memory.jsonl`, `native.log`, `service.log` and
`lifecycle.json`.
The report distinguishes completion, missing Edit scenario, interruption, app
exit and failure; none
is a workstation QA `passed` certificate. Keep evidence immutable once cited.
The strict [workstation QA 1.0.0 contract](workstation-qa.md) remains unchanged.

## Current validation state

Automated fixture, protocol, memory-parser and readiness guards are tested in CI.
The Linux process sampler can observe actual test processes; those observations
are not native UI performance data. A Linux filesystem-boundary fault-injection
regression creates all 2,000 assets using 1,023 actual links and 977 independent
copies, verifies their sizes/hashes, and preserves unexpected `EIO` failures.
That validates the `EMLINK` fallback, not actual NTFS execution or performance.
Real workstation first-open repetitions,
one-hour memory series, Windows/macOS collectors and native screen behavior
require workstation execution and review. Resolve remains an independent manual
gate; this tool does not run or certify Resolve.
