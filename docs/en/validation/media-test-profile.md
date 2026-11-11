# Media test cost profiling

This opt-in Linux harness measures existing media acceptance cases. It does not change the normal media lane, test inventory, assertions, timeouts, retries, renderer, or application behavior. Historical PR137 timings at `591468e5c72e531ddfcb728bd47127223b463832` are context, not this baseline.

Run from a clean committed checkout with dependencies installed:

```sh
node --test scripts/ci/tests/media-profile.node.mjs
node scripts/ci/run-media-profile.mjs "$(git rev-parse HEAD)" /tmp/openfilm-profile-run 2 'completes an initial base run|executes Journey 3 & 4'
```

The output directory must not exist. Linux, Python 3, FFmpeg and ffprobe on PATH are required. Every repetition uses the original tests, independent temporary project/database/cache/edit state, one Vitest worker and no file parallelism. The optional last argument selects cases for profiling only: unselected cases are reported by Vitest as skipped and this is explicitly **not a full gate**. Omit it to measure both complete suites. The complete two-suite inventory is retained independently of selection. Run unchanged complete media/browser gates separately for integration acceptance.

The requested SHA must equal HEAD, and tracked modifications are rejected. `tracked-source.txt` binds every tracked file to its Git object; metadata records the Node/pnpm/Python versions, FFmpeg/ffprobe binary hashes and complete build versions, CPU, memory, load, worker settings, exact invocation and start/end times. FFmpeg arguments retain the actual product thread settings. Source colors, dimensions, source byte hashes, sizes and multiplicities must match between repetitions before comparison.

Raw `repeat-*.stages.jsonl` contains monotonic wall duration, Node process CPU deltas and sampled Node RSS for application creation, each actual pipeline step, SHA update/digest calls, and each case including setup. CPU is process-wide, not per-thread. RSS is an absolute sampled process peak, not allocated bytes or an additive stage cost; short peaks can be missed. Synchronous hash stages record entry/exit RSS. Hash observations include source, artifact and manifest hashing; FFmpeg synthetic source identities are retained separately.

Raw `repeat-*.commands.jsonl` retains actual command arguments, exit codes, wall time, user/system CPU and peak RSS from Linux `wait4`, including actual fixture generation, render, visual-QA decode and export subprocesses. These child metrics exclude the Python observer's CPU/RSS. The observer adds process startup, JSON and source-identity hashing overhead outside measured command time; the containing pipeline wall time includes it. No observer-overhead correction or speedup claim is made. Render includes input decode and output encode; use separate visual-QA decode command observations when discussing decode alone. The Python observer forwards TERM/INT to the child.

Stage envelopes and child calls overlap: do not sum their wall durations or RSS. The driver reports repeated stage distributions rather than inventing an aggregate wall metric. Compare whole invocation wall time separately from setup and step costs, and retain the full raw observations. Sampled load provides context, not proof of host exclusivity. Measurements on this host do not explain all historical hosted-CI variance.

The measured result and optimization decision are recorded in the execution report; an optimization is justified only after equivalent workloads identify a material cost. Fixture reuse or sharding requires a separate safety proof preserving the entire suite and its source-corruption, consent, stale/review, locks/pins, output, cancellation and recovery assertions. No optimization is selected in advance.

## Measured 2026-11-11 observation

Fixed measurement SHA: `14c81a540974c0c943fd69b76a849e05d4aadaaa`; product source remains `08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224`. The command above selected the original impact initial-base case and original Story Graph Journey 3 & 4. Both repetitions passed those two cases; the remaining fifteen cases were unselected for profiling. Original and profiling inventories matched all seventeen cases exactly. This is representative attribution within both historically slow suites, not a full-suite pass or a complete explanation of their historical durations.

The shared Linux cloud host reported AMD EPYC 9V45, five logical CPUs/four available CPUs, Node v24.19.0, pnpm 11.19.0, Python 3.12.14 and FFmpeg 7.1.5-0+deb13u1. FFmpeg binary SHA256 was `e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a`. Full FFmpeg/ffprobe versions, library builds, binary hashes, arguments and tracked Git object identities are in the raw metadata. Other issue lanes paused heavy tests during this coordinated window; host one-minute load moved from 0.56 to 1.78 to 1.86. This remains a shared-host measurement with no causal speedup claim.

| Observation                                          | Repeat 1 wall seconds | Repeat 2 wall seconds |
| ---------------------------------------------------- | --------------------: | --------------------: |
| Whole invocation, including Vitest startup           |                91.914 |                92.501 |
| Two case envelopes, including setup                  |                90.335 |                90.846 |
| Setup and test work before first pipeline stage      |                 0.607 |                 0.613 |
| Eight photo fixture subprocesses                     |                 0.382 |                 0.383 |
| SHA256 update + digest calls                         |                0.0262 |                0.0268 |
| Pipeline render, three calls                         |                40.881 |                41.331 |
| Pipeline visual QA, two calls                        |                25.195 |                25.467 |
| Pipeline export, two calls                           |                23.584 |                23.375 |
| Seven render/encode subprocesses across those stages |                86.434 |                86.867 |
| Two isolated visual-QA decode subprocesses           |                 0.616 |                 0.623 |

Rows overlap and must not be added. The pre-pipeline interval includes application creation, JPEG generation, JavaScript tone synthesis, hashing and pre-run test work; tone synthesis was not separately timed. Actual application creation took 0.0138/0.0143 seconds. The seven render subprocesses used 174.168/174.501 CPU seconds and maximum child RSS 805,908/778,728 KiB. The two isolated decode subprocesses used 1.686/1.787 CPU seconds and maximum RSS 105,944/105,768 KiB. Eight fixture subprocesses used 0.365/0.376 CPU seconds and maximum RSS 37,760/37,888 KiB. Maximum sampled Node RSS was 221,932/210,880 KiB. Full per-stage CPU/RSS and individual repeated observations remain in raw JSONL and `analysis.csv`.

All fifty-six actual media commands exited successfully. The source-equivalence guard matched JPEG generation parameters, source SHA256, bytes and multiplicity across repetitions. The 30-second synthetic WAV was independently reconstructed from the fixed source function and its exact digest confirmed in both raw hash traces: `68ed7fb036b6cabbfe411d13708704246fba1f553dafa89983c03ecc31b9f0e5` (2,646,044 bytes). `source-pins.json` retains every JPEG identity and this WAV identity.

The measured bottleneck is actual repeated render/encode work, including renders inside QA and export. Fixture generation and hashing are small in this workload. The decision is to retain current suite behavior: fixture reuse adds isolation risk for little measured benefit, and this experiment does not establish a sharding benefit. Investigating safe reuse of immutable rendered artifacts would require a separately scoped product/cache safety proof; no such reuse or product performance optimization is claimed here. Complete unchanged media/browser gates remain integration prerequisites.

Raw bundle: `issue-139-measured-14c81a5` in the issue-execution evidence directory, with `metadata.json`, exact `inventory.json`, `tracked-source.txt`, both Vitest reports, logs, stage/command/hash JSONL, `source-pins.json`, analysis JSON/CSV and `SHA256SUMS`. The handoff execution report records the analysis command, raw provenance, RED/GREEN checks and limitations.
