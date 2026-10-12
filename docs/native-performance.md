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
it does not exercise real 4K, transcription, GPU or camera quality. Move the
entire root only with the existing folder relink workflow. The generator refuses
an existing destination. Keep the fixture in place for comparable runs.

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
A project run without a matching fixture-sized Edit visit is `scenario-incomplete`,
not a completed Edit experiment. The supplied Git SHA and display/runtime/cache metadata
are declarations: review the actual build/checkout provenance before comparison.

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
The local service is prestarted: neither UI timing represents single-click
packaged startup including service creation.

No diagnostics run in browsers. Native diagnostics default to disabled; the
runner enables a local fixed-field checkpoint file for its unique run only. No
media, transcript text, project paths or remote telemetry enters checkpoints.

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

## Memory interpretation and evidence

`memory.jsonl` preserves each sampled process PID, parent PID, creation identity,
metrics, missing-data reasons, collection time and native/service roots. Metrics
are bytes. The two owned trees are deduplicated; totals with unknown membership
or missing metrics have no value. Check coverage before interpreting a peak.
Sampling begins after UI readiness, so **startup peak memory is not measured**.

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
are not native UI performance data. Real workstation first-open repetitions,
one-hour memory series, Windows/macOS collectors and native screen behavior
require workstation execution and review. Resolve remains an independent manual
gate; this tool does not run or certify Resolve.
