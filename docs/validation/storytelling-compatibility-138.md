# Issue 138: read-only OpenFilm → Storytelling compatibility capsule

Status: bounded consumer proof. No production authority change, executor, host
write, second Timeline, or M4 feature flag is introduced. Existing OpenFilm
Composition, Catalog, locks, User Pins, Review/Accept and history remain authoritative.

## Pinned compatibility matrix

| Surface                            | Exact contract / scope                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenFilm producer                  | `bynanci/open-film@08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224`; unchanged `packages/exporters/src/index.ts`, `exportTimeline("json", composition, assets, settings)`                                                                                                                                                                                                                                                                                |
| Project schema                     | Core base `1.0.0`; supported extensions `1.1.0` pins, `1.2.0` audio timing, `1.3.0` automation, `1.4.0` animation are **not** finite import grants                                                                                                                                                                                                                                                                                                |
| Export envelope                    | `schemaVersion:"1.0.0"`, `composition`, referenced `assets`, `settings`; not an OpenFilmProject or Catalog dump; exporter may emit extra creative metadata, which the finite importer rejects                                                                                                                                                                                                                                                     |
| Catalog                            | `CATALOG_SCHEMA_VERSION = 7`; not an SDK input or write target                                                                                                                                                                                                                                                                                                                                                                                    |
| Storytelling source/version        | `bynanci/storytelling@b7fcf869d01727dcf408c457fdd42929dca80c7a`, workspace/CLI `0.1.0-dev.0`; clean tracked checkout required                                                                                                                                                                                                                                                                                                                     |
| Import profile                     | `openfilm-finite-v1`; `declared-visual-mapping-only`, `executable:false`; exact allowlist in [FINITE_V1.md](https://github.com/bynanci/storytelling/blob/b7fcf869d01727dcf408c457fdd42929dca80c7a/docs/migration/FINITE_V1.md)                                                                                                                                                                                                                    |
| Planner                            | Existing SDK `plan-story`; `storytelling.fixed-window-planner.v1`; never reconstructed from importer output                                                                                                                                                                                                                                                                                                                                       |
| Review compiler                    | `storytelling-engine-0.1.0-dev.0`; `storytelling.planner-otio-visual-ticks.v1`; complete successful planner stdout + original finite snapshot + strict context, as [specified upstream](https://github.com/bynanci/storytelling/blob/b7fcf869d01727dcf408c457fdd42929dca80c7a/docs/migration/PLANNER_OTIO_REVIEW_V1.md)                                                                                                                           |
| Local compiler/toolchain           | Rust/Cargo `1.89.0`, edition 2024, locked debug CLI; Node `24.19.0`, pnpm `11.19.0`, TypeScript `5.9.3`, tsx `4.23.15`, Vitest `5.0.3`; Linux x86_64                                                                                                                                                                                                                                                                                              |
| Local CLI SHA-256                  | `98729a3646a9e8883fe99b8f61bbf196db4fbbd154239be55ef072819d8c7374`; identifies this local build only, not a reproducible-build or signed provenance claim                                                                                                                                                                                                                                                                                         |
| FilmCraft proof inherited from SDK | Official Linux CLI `0.18.0`, binary SHA-256 `064a1f55cde5f6e1ac04bcd3a5b72e5d7366905f3d7333793e78dda0c109d33f`; upstream isolated synthetic native readback: one online 25-frame cut, 25/1 fps, source `1/25..26/25`, lost acknowledgment resolved by readback, one attempt, zero retry/Undo; [pinned record](https://github.com/bynanci/storytelling/blob/b7fcf869d01727dcf408c457fdd42929dca80c7a/docs/validation/m3-03-filmcraft-execution.md) |
| FilmCraft in this capsule          | **Not invoked or independently verified.** Context host digest is a synthetic declaration (`a` × 64), not the upstream verified FilmCraft digest                                                                                                                                                                                                                                                                                                  |

The exporter source SHA-256 at this baseline is
`3fda43d27aac484f262022b0af8e718792256c2a1e2d0539b93892f74c5745c3`.
The producer is frozen by source identity, not by interpreting the project's
schema version as a compatibility promise.

## Run the local proof

Use an isolated checkout of the trusted public SDK at the exact SHA above.
Build there with `cargo build --locked -p storytelling-cli`; do not modify the
SDK or execute user project scripts. The harness only accepts its standard
`target/debug/storytelling` executable (or `.exe` on Windows). Compute that
binary's SHA-256 yourself and explicitly supply it; a different build can have
a different digest. Checkout SHA, tracked cleanliness, digest and `--version`
are checked before every command. These local checks are not signed provenance.

Install OpenFilm dependencies in this worktree with
`pnpm install --frozen-lockfile --ignore-scripts`. Do not link `node_modules`
to a different worktree: workspace packages can otherwise resolve old source.

```sh
STORYTELLING_COMPAT_SDK=/absolute/pinned-sdk \
STORYTELLING_COMPAT_BINARY_SHA256=<your-local-binary-sha256> \
pnpm exec vitest run --config scripts/storytelling-compat.vitest.ts

pnpm exec tsx scripts/storytelling-compat-probe.ts \
  /absolute/pinned-sdk <your-local-binary-sha256> snapshot.json

# Optional complete SDK planner + review + freshness roundtrip:
pnpm exec tsx scripts/storytelling-compat-probe.ts \
  /absolute/pinned-sdk <your-local-binary-sha256> \
  snapshot.json planner-request.json strict-context.json
```

The dedicated fixtures in `tests/helpers/storytelling-compat-fixtures.ts` are
independently authored producer declarations. They use nonlexical occurrence
order, repeated source IDs, video trim `1.25..2.5`, a 1.5-second still hold,
locks, declared fractional frame rate and separate explicit `30000/1001`
drop-frame timebase. The optional request/context helpers declare the SDK's
actual input DTOs. Context capability IDs and loss choices are canonical sorted
lists; explicit `metadata_only_locks` and `picture_only` are required here.
They grant no audio, effects or editing capability.

The command prints a JSON evidence envelope containing the complete SDK stdout
strings and their exit codes. It writes no project or Catalog files. Review
commands use private temporary copies of the supplied snapshot/context/bundle
and remove them afterward. Every SDK process runs with empty `PATH`; there is no
media dereference, upload, shell, host invocation or fallback planner. Import
rejections remain available as full structured SDK errors/losses. If optional
planning/preparation fails, the command exits 3 without issuing a review grant.
The low-level check probe preserves the SDK's stale response: `ok:true`,
`freshness.current:false`, exit 1. CLI argument errors exit 2.

The default `pnpm test` inventory collects the two `tests/unit/storytelling-compat.test.ts`
contract tests. The eleven actual SDK/application/command tests live in
`tests/integration/storytelling-compat.sdk.ts`, outside the default `*.test.ts`
inventory, and are collected only by the explicit config above. This dedicated
gate **fails** with a prerequisite message if either SDK environment variable is
missing; it uses no conditional skips or retries. A default suite pass therefore
does not claim SDK compatibility. No central package script or production
dependency is added. A future package-script proposal is
`test:storytelling-compat = vitest run --config scripts/storytelling-compat.vitest.ts`.

## Observed assertions and limits

The 2026-11-11 focused run exercised the actual pinned SDK and application export:

- Admitted input retained source snapshot, clip/asset IDs, array order, repeated
  sources, locks, exact source fractions, original declared frame-rate spelling
  and explicit timebase separately. No clock inference/rewrite was applied.
- Every success retained `media.not_verified`, video `audio.not_mapped` with
  `blocks-host-handoff`, and still `image.hold_window` as an intentional delta.
  A still duration is a synthetic presentation bound, not recording duration.
- Audio tracks (including empty), embedded audio declarations, identity
  transforms, effects, pins/user overrides and animation rejected with structured
  unsupported losses and no plan. Fields were never stripped to obtain admission.
- Review used complete real `plan-story` success JSON, not `import-openfilm`
  output. OTIO selected occurrence ID and exact 5/4-second source start/duration
  were checked. Approval/execution/source-verification/host-verification flags
  remained false. Import output supplied as a proposal rejected.
- A changed proposal byte, snapshot declaration or context revision invalidated
  review. The SDK binds proposal and snapshot bytes; strict context declarations
  are parsed/canonicalized, so context whitespace alone is not a new declaration.
  Portable review JSON remains untrusted and forgeable, with no approval grant.
- A saved synthetic application project, Catalog database/WAL/shared-memory
  files, logical Catalog revision, in-memory project, and synthetic source bytes
  were compared across application export + SDK import. Only the application's
  normal JSON export and export report were created. Fixture cleanup/normal app
  close occurs after the observation boundary.

The application source files are **declaration sentinels, not playable media**.
These tests establish JSON compatibility and immutability only. No decoder,
image/audio quality, media-byte verification by the SDK, official OTIO parser,
FilmCraft execution, production approval, independently reviewed security gate,
quiescence or NotApplied retry is claimed. Freshness can only observe supplied
current declarations; out-of-band media changes are not discovered by this SDK.

Production M3-03 and an M4 integration remain blocked on accepted production
approval/executor/quiescence/readback/NotApplied retry gates. Preserve original
media, source/revision/owner fences, locks/User Pins, Review/Accept, Undo/Redo,
autosave and reopen semantics; this script adds no production authority.

## Verification and provenance

The local final results and exact command evidence are recorded in the execution
report for issue 138. Focused unit/application/real-CLI tests, exporter regression
tests, full TypeScript/Vue typecheck, focused lint/format and docs mirror checks
are separate from the full media/browser/native suites. Do not infer a full-suite
pass from this capsule's evidence.

All new OpenFilm code/tests use Apache-2.0 SPDX identifiers and retain the
repository's LICENSE/NOTICE policy. No SDK implementation, tests, fixture media
or binaries are copied into OpenFilm. The SDK retains original MIT
`LICENSE` (copyright 2026 bynanci), Apache-2.0 component files, its
`LICENSES/Apache-2.0.txt`, `LICENSES/third-party/NOTICE.txt`, `PROVENANCE.md`,
per-file source inventories and locked dependency licenses. Invoking a separately
built SDK does not replace these obligations. Any later redistribution must
retain applicable MIT copyright/license and Apache license/NOTICE/attribution,
review component/dependency licenses, and mark modifications. This delivery
redistributes no SDK binary, changes no SDK source, and grants no extra rights.
