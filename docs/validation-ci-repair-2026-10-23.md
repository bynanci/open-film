# Graph/Pipeline CI repair — 2026-10-23

## Scope and evidence boundary

The inspected stack tip was PR #49 at
`05f71e2f8326889c383d2a2f4a29ac6772e1337f`.
Its Verify run `39852897760` stopped at the document mirror check, before
TypeScript/media verification and Playwright. Native-shell passed separately.
The document-only correction `f5076130fd98f88dabf6df11bdd180c741a1e50c`
reuses the exact canonical blobs for CONTRACTS and seven validation mirrors;
it does not disable, weaken, or skip any check.

## Reproduced production failure

The former pipeline renderer caught media/FFmpeg errors and wrote UTF-8 marker
text with an MP4 extension. Export did not call the MP4 application exporter;
it wrote another marker. QA exceptions were replaced by a fabricated passing
report. These are correctness failures, not valid synthetic media.

The repair removes these fallbacks, calls the existing `exportMp4` adapter,
requires a complete QA report with output evidence, propagates adapter failures,
checks cancellation before publishing results, and requires path-backed artifacts
to be non-empty regular files. The orchestrator never rewrites video bytes.

## Executed isolated red/green checks

A Node 22 isolated harness transpiled the exact original PipelineService blob
`ae90dfc0801591c386d157f16be440eff5cfc38d`, with dependency boundaries stubbed.
It generated a real one-second 64x64 H.264 fixture with FFmpeg. All nine assertions
failed on the original source and passed on the corrected source:

- Four render failures: FFmpeg error, ENOENT, Missing Media, unsupported media.
- QA exception and incomplete QA with no listed issues.
- Real exporter delegation with unchanged playable bytes and ten decoded frames.
- Export adapter failure without a fallback artifact.
- Cancellation during an uncooperative QA operation without a passing artifact.

This is isolated application-adapter evidence, not a full repository, UI, native,
provider, or end-to-end rendering pass. The checked-in integration regression
adds the stale-QA case and a full decode check; its exact-head CI result must be
reported separately. Local TypeScript transpilation is not a repository typecheck.

## Remaining merge gates

Do not treat the old story-graph/pipeline acceptance record as proof of actual
video output: its text-only image fixtures and artifact-label assertions must be
replaced with decodable sources and FFprobe/full-decode assertions. Existing tests
that relied on fallback success must be corrected, not skipped or relaxed.

The stack also has unresolved review findings, including graph save routing,
native PUT preflight, selection hydration and story media loading. Complete
repository checks, current-head review, and dependency integration are required
before merging the feature stack. No Resolve, GPU, camera, installer, private-film
quality, or paid-provider verification is established by this repair.
