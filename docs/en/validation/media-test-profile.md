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
