# Contract and media CI separation

The approved roadmap asks for independent fast contract feedback and actual-media
QA. Current `Verify` serializes format/locales/lint/types, all Vitest tests, build,
interchange and all browser journeys into `typescript-and-media`; native Rust is
already independent. Keep every assertion, runtime floor, artifact and merge gate.

## Approach

Split into `fast-contract-check` (format/i18n/docs/lint/TS/Vue and explicitly
identified pure core/solver/story/metadata/events tests) and `heavy-media-qa`
(every other Vitest file, build, actual FFmpeg artifacts, official interchange,
built CLI and the full browser suite). Unknown/new tests default to heavy. A
machine-checked discovery partition must have no missing, duplicate or overlapping
files. Root `pnpm test` and `pnpm verify` keep their current complete local behavior.

Builder choice: retain `typescript-and-media` as an always-evaluated aggregate
which succeeds only if **both** jobs succeed. This preserves consumers of the
existing required check name without allowing failure/cancellation/skips through.
No path filter bypasses media QA, no continue-on-error, assertion retry or new
test skip. Native and the separate Windows issue workflow remain independent.

Alternatives: duplicating all Vitest tests in heavy is simple but obscures actual
coverage ownership; partitioning by all current `test:unit` files is inaccurate
because that selection includes actual source adapters and subprocess benchmarks.
An explicit small contract allowlist plus heavy-by-default is auditable and safe.

This changes CI organization only. It makes no promise about hardware, real NLE,
installer readiness, pixel tolerance changes or a stable release version. Actual
elapsed-time comparisons require complete hosted runs; do not infer speedup from
the job graph alone. Both new jobs still run for every push/PR.
