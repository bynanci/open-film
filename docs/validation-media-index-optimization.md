# Media indexing optimization

Baseline: d332fb3265077ca08f218f6ba9b6c65d2519eaa2.

Scope: replace repeated membership scans in Silence proposal validation and creation with local Set indexes; replace repeated photo clip lookup in render manifest generation with a render-local Map. Preserve duplicate/unknown ID rejection, candidate order, first-match semantics, source verification, locks/pins, cancellation, DSP clocks and every FFmpeg option. No persisted state, dependencies, schema or global cache changes.

## Measurement ledger

Node24.19.0; four warmups and20 alternating samples, including index construction. Run `node scripts/benchmark-media-index.mjs`. These are lookup microbenchmarks, not export latency or hardware claims.

| Finding                                          | Before median / p95 ms | After median / p95 ms | Decision                        |
| ------------------------------------------------ | ---------------------- | --------------------- | ------------------------------- |
| 2000 candidate membership, quadratic nested scan | 3.569 / 10.402         | 0.084 / 0.153         | Local Set, linear expected work |
| 1000 photo manifest lookups, quadratic scan      | 1.251 / 2.873          | 0.051 / 0.138         | Local Map, linear expected work |

Indexes are bounded by existing input collections and released with the operation. No source hash verification is bypassed; no review is automatically accepted. Filter graphs, audio resampling, tempo, limiter, video scaling, deterministic rounding and encoding settings remain unchanged.

## Validation

Core Silence31 tests and application/real HTTP Silence23 tests passed. Core plus actual FFmpeg ambient and primary-color/local-look regressions40 tests passed. Format, documentation mirrors (161), lint, TypeScript and production build passed. The existing large-chunk advisory remains. Full Vitest, browser and native suites were not rerun for this bounded iteration; no whole-platform or encoding-speed claim is made. No new performance assertion relies on wall-clock thresholds.

## Limits and next measurements

The follow-up [pipeline profile](validation-media-pipeline-performance.md) measures local synthetic proxy decode, encode, seek and peak RSS. Full export throughput, native Record seek behavior, concurrent workload memory, workstation variability, perceptual listening and4K/GPU acceptance remain unmeasured. Retain FFmpeg native DSP and deterministic rendering until measurements justify another bounded change.
