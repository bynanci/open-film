# Native benchmark fixture preparation — issue 145

**Source-bound synthetic preparation only. Native startup, interaction, memory,
GUI, cold/warm trials and one-hour soak have not been measured.**

The observed preparation used owned source
`9f4abb8de6f8f20b080c59dd50f1cd64af9dc2d5`, tree
`e7376c8b4796622041ce87fd01695d569a10ff5e`, on 2026-11-11. It reuses the existing
`create-fixture.ts` generator and `validateNativeBenchmarkFixture` without changing
counts, assertions, source files or media algorithms. No second benchmark engine
or provider upload was introduced.

## Observed source and fixture

| Evidence                | Observed result                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Owned install           | `pnpm install --frozen-lockfile`, exit 0; 202 cached packages, no borrowed `node_modules`                                     |
| Actual tools            | Node 24.19.0, pnpm 11.19.0, FFmpeg 7.1.5; candidate declares pnpm 11.11.0, so this is not an exact GHA toolchain reproduction |
| Lockfile SHA-256        | `173e22be4859fb74c702aec6fca31e3006b4b9eaeae632fee39f3d87606dc5ba`                                                            |
| Source checks           | 1,828 tracked files match candidate blobs and SHA-256 before/after                                                            |
| Dependency checks       | 72 workspace links / 20 owned targets; 6,181 installed regular files unchanged                                                |
| Source reads            | Contemporaneous process/file-open trace binds 200 tracked paths; no borrowed checkout or old primary paths                    |
| Generator and validator | Original CLI and existing read-only validator both exit 0; generator ran once                                                 |
| Dataset                 | 2,000 video assets, 500 clips, 10 beats, 1,500-second timeline; 2,000 hardlinks, zero fallback copies                         |
| Generated at            | `2026-11-11T14:29:38.066Z`, distinct from candidate date or any native run                                                    |
| Manifest SHA-256        | `d2693da1e4c15693c215c9e8e00a17e6c49930d69b15d9075be8d3ff0d296e11`                                                            |
| Output budget           | 239,308,246 logical bytes / 228.222 MiB, below 256 MiB; tooling clone/install accounted separately                            |
| Receipt SHA-256         | `1cf98a6a6ce76ca2561a672ae99de48828a9dbdc24d44f3320ea4755497b5b30`                                                            |
| Inventory SHA-256       | `d58e9a7f8f275e7385d979d4c920bb3a20c66cfbb4f60d0e2ede03bfde9e57e4`                                                            |

The assets all reference copies/links of the same procedural three-second
320×180 H.264/AAC source. This is a catalog/timeline fixture, not 2,000 distinct
camera recordings or evidence for a real 100K-media library. Original hashes and
template contents remained unchanged after the read-only validation.

Observed commands from the owned checkout were:

```sh
pnpm install --frozen-lockfile
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=/absolute/owned-source/tsconfig.json NODE_PATH= NODE_OPTIONS= pnpm exec tsx scripts/native-benchmark/create-fixture.ts /absolute/fresh-fixture
```

The generator itself has no byte-cap option. Its unchanged exact-recipe sample
and conservative metadata allowance were checked before execution; an external
monitor enforced output/time/per-file limits. All original argv, cwd, exit,
stdout/stderr, source/dependency/tool hashes, link topology, file-open traces,
capacity records and complete per-file inventory remain in the private execution
packet. Only safe hashes and counts are committed here; no recordings, projects,
raw traces, dependency trees or fixture media are public release assets.

## Limits and correction history

An earlier preparation borrowed a mutable dependency install from a different
checkout. Its first-party files were source-equivalent, but that packet was
retained as **preparation only**, not accepted as strict candidate instrumentation.
This owned-install execution is separate; original raw records were not edited or
relabelled. Independent read-only consistency review passed for both the
correction and this new packet.

A file-open trace establishes access, not execution of every statement. Cached
package-store hardlinks and namespace storage totals do not measure exclusive
physical disk usage. Frozen-lock installation is not a new vulnerability audit or
a hermetic OS/toolchain claim. Preparation duration is not app startup latency.

Next, provision a real native executable, WebKit runtime, display and UI/normal
close access, then use the [existing warm benchmark protocol](../native-performance.md)
in a controlled measurement window. Windows/macOS target trials, signed installed
cold startup, the prescribed interactive one-hour soak, real 4K/HDR/GPU, storage,
input and multichannel observations remain open. This preparation supplies none
of those passes.
