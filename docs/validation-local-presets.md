# D8 local data-only preset validation

Date: 2026-10-30. Branch: `codex/v1-d8-presets`.
Inspection/integration base: `e1255b1a8a83260149211d909cca8c1a50948c6b`.
Approved design checkpoint: `f0404b3b93686362597d8963a96094b623d1aa7c`.
Product checkpoint: `9da8c3f7dba77a6c54f77cbc4b9bdc386e67ca07` (final tests/docs follow in branch history).
This is an unreleased implementation candidate. Independent review, integrated
full suites and exact-head hosted PR/merge evidence remain parent-owned gates.
Project schema 1.0.0 and Catalog v6 remain unchanged. No dependency was added or
upgraded; setup used `pnpm install --offline --frozen-lockfile`.

## Implemented owners and limits

The core defines closed single-JSON packages, recipes, canonical IDs, immutable
embedded snapshots, application inputs and durable retry receipts. The
application owns user-data storage, review/install/remove/recovery, snapshot
integrity and exact revision-bound acceptance. CLI, HTTP and Desktop call those
same services. Look/title application uses the existing TimelineEditor and one
history unit. Story application compiles an explicit bijection over authored
beats and uses the existing StoryPlan new-cut transaction.

| Boundary           | Limit / behavior                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Package            | 262,144 UTF-8 bytes; depth 12; 20,000 tokens; 131,072 text units; 1–32 entries                                  |
| Installed registry | 32 immutable ID/version packages; 256 entries; 8,388,608 bytes                                                  |
| Saved snapshots    | 98,304 bytes each; 256 project occurrences and 4,194,304 aggregate bytes                                        |
| Story              | 1–12 beats; integer weights 1–1,000; target ≤3,600 s; maximum ≤10,800 s                                         |
| Versioning         | Envelope/snapshot/recipe v1; local FilmLook v2; stable numeric package semver; unsupported versions fail closed |
| History / recovery | 200 durable exact-body application receipts; one reviewed bounded corrupt-registry copy                         |

Titles alias the existing `TitleStyle` and call `validateTitleStyle`; future
owner-supported nested versions compose there. Film Looks use existing shared
matrices and inheritance; primary correction remains independent. Accepted
Story text, media mapping, selections, constraints and duration bounds survive
reopen/localization without registry lookup. Composition carries the Story
snapshot as well as Story so standalone JSON/OTIO can retain provenance; both
occurrences count against the project budget.

## Regression evidence

The final focused run passed **155 tests in 22 files, 15.15 s**:

```sh
pnpm exec vitest run packages/core/tests/presets.test.ts packages/core/tests/preset-json.test.ts packages/core/tests/looks.test.ts packages/core/tests/title-layout.test.ts packages/solver/tests/looks.test.ts packages/story/tests/preset-story-plan.test.ts packages/application/tests/local-preset-registry.test.ts packages/application/tests/local-preset-storage.test.ts packages/application/tests/preset-application.test.ts packages/application/tests/preset-story-plan.test.ts packages/application/tests/film-looks.test.ts packages/application/tests/story-plan.test.ts packages/application/tests/story-graph.test.ts packages/render/tests/preset-integrity.test.ts packages/render/tests/preset-looks.test.ts packages/exporters/tests/film-look.test.ts tests/integration/local-presets-transports.test.ts tests/integration/preset-application-transports.test.ts tests/integration/local-presets-portability.test.ts tests/unit/local-presets-ui.test.ts tests/unit/local-presets-panel.test.ts tests/unit/preset-apply-review.test.ts --maxWorkers=2
```

Evidence log: `/tmp/d8-focused-final.log`. These are focused suites, not a claim
that the whole repository suite has run on this branch.

An additional 42 existing Monitor tests passed. The existing renderer owner
suite exposed one diagnostic compatibility regression: descriptor-first NaN
rejection omitted the invalid property path. A new strength/getter regression
failed, then passed after retaining bounded property paths in the same safe
admission walk. All **48 tests in five affected core/renderer suites passed**
after that fix, including the unchanged before-source-IO strength assertion,
diptych/title exclusion and crossfade output checks. Logs:
`/tmp/d8-strength-red.log`, `/tmp/d8-strength-green.log`.

Full TypeScript/Vue typecheck, ESLint on 67 changed source/test files, formatting,
i18n (2,719 semantic keys) and documentation mirror checks passed. Documentation
reports 10 README locale sets and 126 English reference mirrors. Full integrated
build/test gates remain separate below.

Tests reject duplicate keys, BOM, malformed UTF-8/Unicode, unknown fields and
versions, JS/HTML/URI/path payloads, dangerous keys, cycles, accessors, sparse
arrays, symbols, functions, NaN/infinity, oversized text/data, deep nesting,
invalid IDs/semver, absent license/provenance and unsupported coefficients.
Accessor rejection is checked before invocation. A detached descriptor copy
supports Vue reactive data after validation without invoking imported accessors.

Filesystem tests cover leaf/descendant symlinks, hard links, traversal, root
replacement and trusted ancestor aliases; live, unknown and proven-dead owners;
future-version lock records; concurrent install/CAS/collision; cancellation,
retry, interrupted publication, reviewed backup recovery and source/sentinel
preservation. Unknown owner/record versions are preserved, not reclaimed.
The boundary assumes the configured host user-data root; it is not an OS sandbox
against arbitrary same-user native code.

Application tests verify read-only previews, one-unit Undo/Redo, exact review
and registry CAS, changed-body conflicts, durable retries after Undo/uninstall/
reopen, protected media, explicit-none/zero/inheritance and legacy films. Story
tests protect selected/must-include/must-exclude/order/locked sources and
duration bounds, fence catalog hash/state/locator changes, reject forged plans
and generic-accept bypasses, and preserve the original film. A read-only graph
HTTP/view regression reproduced revision409, then passed200 with saved bytes
unchanged after routing those reads through `previewGraph`.

Source-specific integrity is actually recomputed at Node registry/application
and independently callable renderer boundaries. Tests alter a recipe/snapshot
with valid-looking hex hashes and fail before source/font IO. Package SHA is
verified against the selected installed package at acceptance; embedded recipe
and snapshot hashes are recomputed during open/save/restore/export/render. This
binds bytes, not author identity or license authenticity.

## Real browser acceptance

With the parent's exclusive 4310/1420 lease, all **3 Chromium journeys passed in
11.5 s** using `/usr/bin/chromium`:

```sh
OPENFILM_CHROMIUM=/usr/bin/chromium pnpm exec playwright test tests/e2e/local-presets.spec.ts --workers=1
```

The English journey imports and reviews all three kinds, explicitly acknowledges
the license, applies Film Look/title/Story, removes the package, reopens and
compares actual SVG/MP4 color within the existing three-channel-level tolerance.
It also asserts zero package-caused outbound requests. Traditional Chinese and
Japanese journeys exercise 360 px wrapping, malformed URL input, rights
acknowledgement, keyboard cancellation, Escape and focus restoration. The
original assertions were retained. The first browser run exposed Vue's
`DataCloneError`; a descriptor-copy regression reproduced it before the fix.
Log: `/tmp/d8-browser.log`; the initial failure is retained in
`/tmp/d8-browser-initial-reactivity.log`. Both shared ports were confirmed closed
and the lease released after completion.

## Actual render and seek evidence

`packages/render/tests/preset-looks.test.ts` generates its own RGB chart and
moving video, renders the installed recipe at strengths **0 / 0.5 / 1**, decodes
actual first/middle/last frames, and compares three color patches per frame
within ≤3 RGB levels. Strength zero exactly matches baseline decoded bytes.
A deliberately wrong valid matrix exceeds the tolerance. Shuffled actual
FFmpeg seeks **11, 0, 5, 3, 8** match full decoded frame bytes; shifted-frame
hashes differ. Structure remains **12 frames at 12/1 fps**. Originals are hashed
before/after and remain unchanged.

Tool: `ffmpeg version 7.1.5-0+deb13u1`.
Full runtime evidence: `/tmp/openfilm-d8-render-evidence.json`.

| Content              | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| Original chart       | `4e4944d6b966a99171b2816244b1eab2d7ec8ac40dffe7013a37e3571f5b9fb1` |
| Original video       | `3a6ebdf5718090e4816e096be120e366e369b031da38d5d2bb0847feb73b53fc` |
| Reviewed package     | `8fdea36fc0c7ce08ef7bdf32a7fa8b4474794ac2637c3511eeafbeecef128861` |
| Film Look snapshot   | `7a9182077cf71402fba3ec7ba7b981bb79d72ed846b336fa72d1f47572e3f6ee` |
| Encoded strength 0   | `e51724e3e48f7ac2171b36d352a94b8eaeb06402362b99c939f39cdb4a57dabb` |
| Encoded strength 0.5 | `8d6e27bbc8178c52906efc160ba2faa06f9ffa9234aad747b16f274259ddaf83` |
| Encoded strength 1   | `b68d093acc961bde3b6c7b6ec6143f34112632ea34580994e571997c64158af8` |

## Portability after registry and original deletion

`tests/integration/local-presets-portability.test.ts` applies all three entry
kinds to three original synthetic images, saves/undoes/restores a Named Version,
checks JSON/OTIO snapshot metadata, then renders actual CJK/Latin title glyphs.
It uses existing full-original Collect directory and ZIP owners with explicit
CC0 media and OFL-font declarations. After uninstalling the package, verifying
original hashes and deleting the fixture originals and user registry, it
relocates the directory and extracts the ZIP, opens each with empty user data,
and renders again. Both decoded results exactly equal baseline; the portable
package contains no registry. The focused run passed in **16.04 s**.

All three renders contain **36 frames at 12/1 fps**. The actual font is
Noto Sans CJK TC / NotoSansCJKtc-Bold, SHA-256
`faa5f3656a78b2e2d450d27fe8382c778bc2b6bb5ea29c986664a6a435056ceb`.
Baseline and both relocated decoded RGB SHA-256:
`880d355825a1c8f24c421da4e9ef695ca0c3883b7f4a69c53430d7c5873669e9`.
Encoded baseline SHA-256:
`7cfa57f80d89214f12aae62947774f079807cdef81ef3f7460fedb0c1682119c`.
Encoded equality is same-host evidence, not a cross-toolchain promise.
Per-source and saved snapshot hashes are retained in
`/tmp/openfilm-d8-portability-evidence.json`; run log:
`/tmp/d8-portability.log`. The initial failed fixture omitted its CC0 license
name; the declaration was corrected without weakening the Collect assertions.

## Remaining gates

Independent branch review and the parent-coordinated full suites, build,
official interchange, built CLI, native and exact-head hosted PR checks remain
open. Physical Windows/macOS font/raster/codec behavior, calibrated HDR/SDR
judgment, editable effects in third-party NLEs and rights authenticity have not
been established by these Linux synthetic tests. Existing editable-handoff
metadata disclosures and baked output remain the compatibility contract.
No push, PR or merge is performed by this implementation worker.

## D3 → D5A → D5B → D8 integration checkpoint

D8 `8033742` consumes clean title/photo stack `3d06ad3` through merge
`d0202d3`. Additive command/exporter fields retain title runs and preset origin;
application services retain their separate preview lifecycles. The actual title
owner validates nested finishing; D8 adds no copied title field whitelist or
font/metric policy. The shared helper and policy remain byte-identical to
`11595f33` and `3683b1c`. Roadmap conflict resolution retains each owner's
candidate status and evidence, without claiming complete integration gates.

Twenty current focused files / 136 tests and all three local-preset browser
journeys passed, including actual matrix/strength/shuffled-seek media, immutable
Named Version restore and directory/ZIP Collect relocation after removal of the
registry and synthetic original media. A new actual-media interoperability case
also passed: nested shadow/stroke/pill title preset on a bilingual photo with
ambient layout v2, Bézier motion v2 and local Film Look v2. It rejects an unknown
nested finishing version, preserves runs/layout/motion through Apply/Undo/Redo,
reopens after registry removal, retains both run-font bindings and provenance,
and decodes to exactly the same pixels as the direct title-owner recipe.
Initial errors in the new test's motion and API argument fixtures were corrected;
these were test construction failures, not product regressions or feature RED.

Final TypeScript/Vue, scoped lint/format, 2,816 localization keys and 131
English documentation mirrors passed. Fresh synthetic media and actual current
source/test SHA-256 receipt are under
`/tmp/openfilm-finishing-integration/D8-current/`; its isolated TMPDIR keeps old
candidate evidence intact. No complete suite or hosted-CI success is claimed.
Fresh whole-branch review and exact-head hosted gates remain coordinator-owned.

## Final review fixes — 2026-10-30

The final fix wave starts at clean `d45a1defc3bd961ca2dce0dc5c89dc9694da0c40`
(B parent `f63c8e6`, plus its independently checked focal-viewport backport).
The review's three Important findings and one Minor finding are addressed:

- Look/title publication rechecks the captured pre-edit document against fresh
  catalog editing facts inside the existing project write transaction, while
  retaining the registry selection lock. A catalog-only lock, content-hash or
  editing-metadata change rejects with `presets.stale` before manifest, receipt
  or history publication. Existing source/clip locks still reject application.
  The check is a logical catalog fence; it adds no source-file hashing or
  unbounded source-file I/O inside that transaction.
- Each reviewed Story scene supplies the complete selected occurrence list for
  its new beat. Source selection ordering, required/excluded media, chronology,
  locks and duration constraints remain in force. Preview and adoption verify
  solved occurrences through the explicit scene-to-new-beat mapping. Missing,
  ambiguous or repeated assignments that lack a representable occurrence fail
  closed instead of being reconstructed from asset identity.
- The shared solver composition boundary validates and detaches a preset
  Story's snapshot into every new Composition. Ordinary `compose(story.id)`
  retains provenance after registry removal/reopen and in real JSON/OTIO exports.
  Story and cut copies have separate object identities; every occurrence still
  counts toward the existing 256-snapshot/4 MiB project budget, and Node's
  cryptographic integrity checks still reject tampering before publication.
- Title review discloses each changed resolved property, including nested
  shadow/stroke/pill values, tracking, background, alignment and safe margins.
  Labels and enum values are localized in English, Traditional Chinese and
  Japanese. Values remain escaped text; the existing title owner resolves
  defaults and validates finishing.

The corrected regression fixtures reproduced **19 failing cases** against the
original product source (`/tmp/d8-finalfix-red-replay.log`). The final focused
run passed **152 tests / 24 files in 17.58 s**, with every prior assertion
retained. It includes real application/catalog transactions and history,
HTTP/CLI, UI rendering, actual strength/seek/negative-matrix media, full-original
Collect directory/ZIP relocation, immutable Named Versions and bilingual title
finishing on ambient/Bézier photos. The four Chromium journeys passed in
**11.9 s**, including a new finishing-only/spacing disclosure check before Accept;
4310/1420 were explicitly closed and released. New test setup errors (title
fixture typing, the install endpoint name and reading a review row before its
async appearance) were corrected without weakening assertions.

Final TypeScript/Vue and scoped ESLint passed. Localization validates **2,853
semantic keys**. Fresh actual synthetic sources, decoded/encoded media and
source/test hash proof are retained under `/tmp/openfilm-d8-final-fix/`; the
post-commit `receipt.json` and private `final-fix-report.md` identify the exact
candidate. The portability decoded SHA-256 remains
`880d355825a1c8f24c421da4e9ef695ca0c3883b7f4a69c53430d7c5873669e9`.
JSON/OTIO preserve recipes as metadata; third-party NLE recipe enforcement is
not established. Fresh scoped re-review, complete parent CI and subsequent
integration review remain open. No full Vitest, native benchmark, dependency
change, push, PR or merge was performed by this worker; version remains 0.4.0.

## 2026-10-30 — fixed preset owner on the latest finishing base

Merge `2c2ccc5` places reviewed fix `a51e12f` on clean B `9351b76`, including
A's start-admission guard and repaired documentation base `fab0a4c`. The three
reviewed domain fixes and title-change disclosure are byte-identical to the
reviewed fix in their owner files: the in-lock catalog fence, explicit scene
occurrence validation, detached ordinary-compose provenance and localized
before/after title leaves remain intact.

Current targeted checks pass: eight files / 77 tests covering StoryPlan/solver
assignments, catalog-CAS races, ordinary composition snapshots and budgets,
existing StoryPlan behavior, title disclosure, focal admission, documentation
links and actual bilingual ambient/Bézier/preset interoperability. Commands use
`pnpm exec vitest run` with `packages/story/tests/preset-story-plan.test.ts`,
`packages/application/tests/{preset-story-plan,preset-application,story-plan}.test.ts`,
`tests/unit/{preset-apply-review,photo-focal-overlay,docs-site-validation}.test.ts`
and `tests/integration/preset-title-finishing.test.ts`. TypeScript/Vue, scoped
ESLint, repository formatting, 2,853 localization keys and 131 documentation
mirrors pass. The prior four-browser receipt remains evidence for `a51e12f`;
this checkpoint ran no browser server or full suite. Fresh synthetic artifacts
and current byte receipts are under
`/tmp/openfilm-finishing-integration/D8-latest-base/`. Full exact-head hosted
gates remain coordinator-owned.
