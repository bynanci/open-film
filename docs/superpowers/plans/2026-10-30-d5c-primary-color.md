# D5C Primary Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking. The coordinator may assign independent review;
> this plan does not authorize nested delegation or concurrent global servers.

**Goal:** Add bounded saved primary correction before Film Looks and measured,
explicitly reviewed Auto Match through the existing editing and output owners.

**Architecture:** Core owns a versioned recipe, inheritance and one affine
equation. Typed solver/application commands save it in the current Composition;
SVG and FFmpeg consume the same coefficients. A bounded application review
service owns private source-bound before/after evidence and validates explicit
Apply inside the existing editor serialization.

**Tech Stack:** Existing TypeScript, Vue 3, Node filesystem/SQLite, FFmpeg,
FFprobe, Vitest and Playwright. No dependency upgrades.

**Spec:** `docs/superpowers/specs/2026-10-30-d5c-primary-color-design.md`

Status: proposed plan, inspection base
`e1255b1a8a83260149211d909cca8c1a50948c6b`. Product implementation starts only
after coordinator approval of the concrete design calls. No tests or product
changes are represented as complete by unchecked tasks below.

## Global Constraints

- Project schema stays `1.0.0`, catalog stays v6, existing Compose remains the
  owner; optional fields only, no second timeline or media/source overwrite.
- Recipe v1: temperature finite -1..1, exposureEv finite -2..2, contrast finite
  0.5..1.5. Identity is 0/0/1; missing fields are inherited, not written on read.
- Slopes are `2**ev*c*[1+.1*t,1,1-.1*t]`; offset `.5*(1-c)`; derived coefficients
  rounded to 12 decimal places; clamp after primary and separately after Film
  Look; preserve alpha.
- Scope is clip → beat → film → identity. No global asset/source setting. Keep
  existing pins/locks/rejected-media semantics, child overrides and one-step
  history/save/revision fencing.
- Fixed order: existing source HDR conversion → D5A raw ambient/foreground
  preparation → primary correction → shared Film Look → normal compositing.
- Do not assume FilmLook v1; D8 may add a validated v2 matrix snapshot. Call the
  shared Film Look resolver and adapters.
- Auto Match is a local statistical proposal: explicit target/reference clips,
  actual decoded before/after, explicit Apply, no silent mutation/upload/provider.
- Reviews: max five, 30-minute expiry, at most 512 MiB/source, 8192×8192 source
  dimensions, three samples/clip, 320×320 comparison images and 4096 analysis
  pixels/frame. One active review/application, images at most 1 MiB and retained
  evidence at most 40 MiB. Reject unsupported analysis instead of guessing.
- No JS/HTML, arbitrary matrices/filter strings, remote URLs or caller paths in
  project/request fields. Reuse no-follow source snapshots/private cache guards.
- Follow existing English/Traditional Chinese/Japanese, pseudo-locale, CJK,
  keyboard accessibility and design tokens; preserve Monitor transport identity.
- Tests are requested. Run focused checks during implementation; all full unit,
  native, benchmark and browser gates use coordinator scheduling. Ports 4310 and
  1420 are global; do not start servers independently.
- Real calibrated display, real camera aesthetic quality, native platform
  presentation, real Resolve import/playback/color and sustained 4K remain manual.

## Review Focus

- Valid extrema can produce slope 6.6; FFmpeg must use the LUT adapter rather
  than silently clamp a colorchannelmixer coefficient to 2. Task 3 pins raw pixels.
- An identity child must stop inheritance and must not add an RGBA conversion;
  Task 1 and Task 3 compare omitted/identity output exactly.
- A primary edit behind a locked child override must be safe, while a changed
  effective recipe on a locked paired photo must reject atomically. Task 2 pins
  this distinction along with selection pins.
- Same-size/same-mtime source replacement and late project/selection changes
  must invalidate review/media/Apply. Tasks 4 and 5 exercise those races.
- Opaque NLE precomps already contain primary and Film Look; inherited primary
  must be stopped on replacement clips. Task 3 decodes actual handoff output.

## File and ownership map

| Path                                                                                                                             | Responsibility                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/core/src/primary-color.ts` (new)                                                                                       | Immutable v1 defaults, coefficient math, resolution and pixel reference function.           |
| `packages/core/src/models.ts`, `validation.ts`, `index.ts`                                                                       | Optional portable fields, strict validation and public exports.                             |
| `packages/solver/src/editing.ts`                                                                                                 | The three primary-color command variants and atomic protection/inheritance checks.          |
| `packages/application/src/editor.ts`                                                                                             | Request parsing, optional review-ID validation inside serialization, existing history/save. |
| `packages/render/src/primary-color-filters.ts` (new)                                                                             | Validated coefficient → FFmpeg LUT only.                                                    |
| `packages/render/src/index.ts`, `photo-filters.ts`, `manifest.ts`                                                                | Place correction once on every source path and record numerical/source evidence.            |
| `packages/render/src/primary-color-review.ts` (new)                                                                              | Bounded source sampling, deterministic stats/search, actual candidate decode.               |
| `packages/application/src/primary-color-review.ts` (new)                                                                         | Private report lifecycle, source/revision/context fences and acceptance.                    |
| `packages/exporters/src/index.ts`, `compatibility.ts`, `handoff.ts`; `packages/application/src/nle-handoff.ts`                   | Preserve/report/reject/bake primary and avoid repeated precomp correction.                  |
| `apps/desktop/src/components/PrimaryColorFilter.vue` (new), `source-color.ts` (new)                                              | Shared SVG filter and ordered media filter composition.                                     |
| `PrimaryColorInspector.vue`, `PrimaryColorReviewPanel.vue` (new), existing TimelineEditor/RecordMonitor/PhotoPresentationPreview | Scoped drafts, review, filters and ownership-safe transport integration.                    |
| `apps/server/src/server.ts`, `apps/cli/src/index.ts`, `apps/desktop/src/api.ts`                                                  | Thin project-bound adapters using shared service/edit requests.                             |
| `apps/desktop/src/i18n/modules/primary-color/{en-US,zh-TW,ja-JP}.ts` (new), locale imports, existing error modules               | Product labels, statistical warnings and typed failures.                                    |

## Task 1: Portable correction and immutable numerical contract

**Files:** Create `packages/core/src/primary-color.ts` and
`packages/core/tests/primary-color.test.ts`; modify core models, validation and
barrel exports.

**Interfaces:** Produce `PrimaryColorCorrection`,
`PRIMARY_COLOR_VERSION/DOMAIN/IDENTITY`, `PrimaryColorCoefficients`,
`ResolvedPrimaryColor`, `validatePrimaryColorCorrection(unknown)`,
`primaryColorCoefficients(recipe?)`, `isPrimaryColorActive(recipe?)`,
`resolvePrimaryColor(composition,clip)` and `applyPrimaryColorPixel(rgba,coeffs)`
with the exact signatures and formula in the spec.

- [ ] Add failing core tests for no-field legacy reopen, identity override,
      clip/beat/film priority, detached values, unknown fields/versions, missing
      parameters, nonfinite values, numeric strings, invalid prototypes and all
      exact boundary values. Invalid hidden overrides must still fail validation.
- [ ] Add a golden contract for v1 identity/extrema/representative matrices,
      12-decimal precision, warm/cool sign, exposure monotonicity on nonsaturated
      pixels, contrast pivot, final clamp and alpha 0/128/255. Assert min/max slope
      0.1125/6.6 and offset bounds. Avoid round-trip tests that mirror the helper.
- [ ] Run `pnpm exec vitest run --maxWorkers=1 packages/core/tests/primary-color.test.ts`
      and retain the intended failing assertion before implementation.
- [ ] Implement the focused module/validators and optional
      `defaultPrimaryColor`, `beatPrimaryColors`, `Clip.primaryColor` fields.
      Reject duplicate/unknown beat IDs and more than 1000 overrides. Preserve
      old schema/catalog and existing Film Look registry/checksum.
- [ ] Pass the focused test plus `packages/core/tests/looks.test.ts` and
      `packages/core/tests/project.test.ts`; review and commit the core contract.

## Task 2: Atomic saved commands, protection and history

**Files:** Modify `packages/solver/src/editing.ts`,
`packages/application/src/editor.ts`; create
`packages/solver/tests/primary-color.test.ts` and
`packages/application/tests/primary-color.test.ts`.

**Interfaces:** Consume Task 1. Add:

```ts
type PrimaryColorCommand =
  | {
      type: "primary-color";
      scope: "film";
      correction: PrimaryColorCorrection | null;
    }
  | {
      type: "primary-color";
      scope: "beat";
      beatId: string;
      correction: PrimaryColorCorrection | null;
    }
  | {
      type: "primary-color";
      scope: "clip";
      clipId: string;
      correction: PrimaryColorCorrection | null;
      primaryColorReviewId?: string;
    };
```

`applyTimelineCommand` remains the command owner. The application parser admits
review IDs only on a non-null clip recipe. Task 4 adds the service check; until
then reject a provided review ID explicitly, without touching media/history.

- [ ] Add failing solver tests for setting/removing all scopes, explicit identity,
      inherited protected no-op, protected effective change, locked primary and
      paired sources, pins/required IDs retained, rejected/unsupported media,
      audio/title exclusion, unknown scopes/extra IDs and duplicate beat entries.
- [ ] Add application tests for one history step per batch, Undo/Redo, autosave,
      reopen, Named Versions, exact request-ID retry, different-body conflict,
      stale base revision, rejected review ID, save failure rollback and a batch
      whose final command fails without saving the earlier commands. Assert IDs,
      timing, titles, audio, catalog and original source hashes unchanged.
- [ ] Run the two focused test files and confirm meaningful failures.
- [ ] Implement primary command validation/application following `applyLookCommand`
      while comparing rounded primary coefficients for inherited lock effects.
      Keep strict clip edit locking and the existing pins semantics.
- [ ] Pass those tests and existing solver/application Film Look tests; review and
      commit the saved-edit slice. No new endpoint/alternate persistence path.

## Task 3: FFmpeg, manifest and interchange fidelity

**Files:** Create `packages/render/src/primary-color-filters.ts`,
`packages/render/tests/primary-color.test.ts`,
`packages/exporters/tests/primary-color.test.ts`; modify render entry/photo/manifest
owners, exporters and handoff. Extend existing application NLE/Collect/Named
Version tests where the behavior is already exercised.

**Interfaces:** Consume Task 1/2. Produce
`primaryColorFilters(value?:PrimaryColorCorrection|null):string[]` and exported
`RenderPrimaryColorEvidence {clipId,assetIds,source,correction,coefficients}`.
Resolve once per clip, pass the resolved recipe explicitly into
`photoPresentationFilters`, and use the same adapter on both photo sources.
Add manifest `primaryColor:{version:1,domain,formula,precision,clamp,clips}`;
existing look registry evidence remains owned by Film Looks.

- [ ] Add failing direct FFmpeg RGBA ramps/patch tests including slope 6.6,
      negative/positive offsets and alpha 0/128/255. Assert the independent
      reference equation within 1 LSB before encoding. Identity returns `[]`.
- [ ] Generate test-owned synthetic SDR chart MP4 and tagged 10-bit PQ/HLG chart
      fixtures using the existing FFmpeg process helper, one thread and bounded
      short duration. Include temporal markers and a known audio track. Hash
      sources before/after; no binary fixture upload or private media.
- [ ] Add actual render tests for primary before Film Look with an order-sensitive
      saturated patch, neutral byte-identical decoded output, per-scope overrides,
      both diptych images, source alpha, overlay/crossfade and title/canvas colors.
      Decode first/middle/last/shuffled positions, compare frame count/duration and
      audio to the baseline. Keep existing HDR metadata errors and one tone map.
- [ ] Add exporter/handoff tests for authored/effective JSON/OTIO metadata,
      metadata-only compatibility report, identity-compatible FCPXML/EDL, active
      correction rejection, unknown-version rejection before I/O, strict allowlists
      and opaque precomp intervals. Render/reopen a fidelity precomp and prove it
      is not graded twice; assert explicit identity on replacement clips.
- [ ] Run focused new tests to see expected missing behavior; implement adapters
      and all existing render/photo/export branches, including video-only and
      preview snapshots. An output Film Look override retains saved primary.
- [ ] Add coverage for trimmed-original/offline Collect reopen and Named Version/
      creative variant retention. Do not color-bake collected originals or proxies.
- [ ] Pass focused new tests plus `packages/render/tests/film-looks.test.ts`,
      `packages/exporters/tests/film-look.test.ts` and relevant handoff/Collect
      regressions. Establish chart/H.264/HDR tolerances from measured output and
      document them; never loosen a tolerance to hide an unexplained order error.
- [ ] Review and commit the render/interchange slice. Coordinate D5A raw prepared
      picture and D8 FilmLook v2 seams before touching shared integration lines.

## Task 4: Bounded measured Auto Match proposals

**Files:** Create render/application review modules and
`packages/render/tests/primary-color-review.test.ts`,
`packages/application/tests/primary-color-review.test.ts`; modify application
construction/close and editor validation. No catalog/schema migration.

**Interfaces:** Export these render types/helpers:

```ts
interface PrimaryColorStatistics {
  pixelCount: number; p10Y: number; p50Y: number; p90Y: number;
  meanR: number; meanB: number; clippedFraction: number;
}
measurePrimaryColorPixels(pixels: Uint8Array): PrimaryColorStatistics;
primaryColorMatchScore(target: PrimaryColorStatistics,
  reference: PrimaryColorStatistics): number;
suggestPrimaryColor(pixels: readonly Uint8Array[],
  reference: PrimaryColorStatistics, current: PrimaryColorCorrection):
  PrimaryColorCorrection;
samplePrimaryColorFrame(asset: MediaAsset, sourceTime: number,
  correction: PrimaryColorCorrection,
  options: { outputPath: string; signal?: AbortSignal }):
  Promise<{ pixels: Uint8Array; width: number; height: number; sha256: string }>;
```

The sampler receives a trusted source descriptor whose URI points to the private
verified snapshot; outputPath is service-generated. Its returned pixels are
bounded, uniformly selected opaque RGB8 samples, not a user path or arbitrary
raw source. Define the report and service explicitly:

```ts
interface PrimaryColorReviewReport {
  version: 1;
  id: string;
  projectId: string;
  compositionId: string;
  baseRevision: string;
  contextSha256: string;
  targetClipId: string;
  referenceClipId: string;
  algorithm: "encoded-sdr-statistics-v1";
  createdAt: string;
  expiresAt: string;
  sources: {
    assetId: string;
    sha256: string;
    color: RenderCatalogColorMetadata;
  }[];
  samples: {
    variant: "reference" | "before" | "after";
    index: number;
    sourceTime: number;
    sha256: string;
  }[];
  currentCorrection: PrimaryColorCorrection;
  suggestedCorrection: PrimaryColorCorrection | null;
  reference: PrimaryColorStatistics;
  before: PrimaryColorStatistics;
  after: PrimaryColorStatistics | null;
  warnings: string[];
  canApply: boolean;
}
class PrimaryColorReviewService {
  run(
    compositionId: string,
    input: {
      baseRevision: string;
      targetClipId: string;
      referenceClipId: string;
    },
    signal?: AbortSignal,
  ): Promise<PrimaryColorReviewReport>;
  media(
    id: string,
    variant: "reference" | "before" | "after",
    index: number,
  ): Promise<string>; // trusted private PNG path after fence/hash validation
  validateAcceptance(
    id: string,
    compositionId: string,
    baseRevision: string,
    clipId: string,
    correction: PrimaryColorCorrection,
  ): Promise<void>;
  discard(id: string): Promise<void>;
  dispose(): Promise<void>;
}
```

Export the existing `RenderCatalogColorMetadata` type from the render barrel;
copy only its known nullable color fields. Never pass arbitrary project metadata
to FFmpeg. Media access returns to the trusted HTTP adapter; JSON clients receive
only bounded IDs/statistics. Capture private neutral post-tone-map target pixels
for the search; do not apply a candidate a second time to the before image.

- [ ] Add failing stats/search tests with independent patch fixtures, tie order,
      deterministic replay, the 136-candidate bound plus initial score, bounds,
      dark/flat/clipped/manual outcomes and no-worse predicted candidate.
- [ ] Add actual decoded before/after samples for SDR/PQ/HLG; after metrics must
      satisfy the spec's ≥5% and ≥.005 improvement with ≤.02 extra clipping, or
      `canApply` stays false. Assert missing HDR metadata never yields a proposal.
- [ ] Add source replacement during copy/analysis/publication/image read/Apply,
      same-size/mtime mutation, symlink/cache artifact replacement, context/target/
      reference change, project switch, stale saved disk, expiry, five-report
      capacity, orphan cleanup, byte/dimension bounds, timeout and cancellation.
      Every failure leaves project, catalog, originals and history untouched.
- [ ] Add explicit acceptance tests: forged ID/recipe/other clip fails; current
      review saves exactly once through the existing command; locks still fail;
      exact in-session retry acknowledges; reopen keeps accepted numbers while
      old proposal ID cannot be applied again. No automatic remeasure on retry.
- [ ] Run focused tests for missing behavior; implement immutable source capture,
      statistics/search, actual candidate decode, private lifecycle and all fences.
      Check cancellation between passes and use process output/time bounds.
- [ ] Wire `application.primaryColorReview.validateAcceptance` inside editor
      serialization before current document/solver/persist, following Audio
      Quality's review-ID pattern. Resolve exact request replay before review
      lookup, then recheck the current revision after asynchronous validation.
- [ ] Pass new focused tests plus audio-review/editor save regressions; review and
      commit the evidence slice. No background Apply or media import is allowed.

## Task 5: Project-bound adapters and accessible editing/review UI

**Files:** Create `PrimaryColorFilter.vue`, `PrimaryColorInspector.vue`,
`PrimaryColorReviewPanel.vue`, `apps/desktop/src/source-color.ts`, focused unit
tests and `tests/e2e/primary-color.spec.ts`. Modify desktop API, TimelineEditor,
RecordMonitor, PhotoPresentationPreview, server, CLI, locale/error modules and
locale imports. Extend existing Record Monitor/render-boundary tests.

**Interfaces:** Produce
`sourceColorStyle(primary:PrimaryColorCorrection|undefined,
look:FilmLook|undefined, ids:{primary:string;look:string},
bypassLook?:boolean):{filter?:string}`. Use core active checks and return ordered
`url(#primary) url(#look)` CSS filters only when active. `PrimaryColorFilter`
props are `{id:string;correction:PrimaryColorCorrection}`; it emits the core SVG
matrix. Photo prepared-picture groups use one ordered filter chain. Review panel
emits an ordinary clip `primary-color` command with the report ID and exact recipe.

Use thin routes:

```text
POST   /api/compositions/:id/primary-color-review
GET    /api/primary-color-reviews/:id/media/:variant/:index
DELETE /api/primary-color-reviews/:id
```

The POST body is `{projectId,baseRevision,targetClipId,referenceClipId}`; reject
unknown keys, wrong project, missing target/reference and concurrent owner
changes. Register it with existing tracked-work/cancel/project-close ownership;
it is not an untracked detached task. Apply uses the existing composition editor
endpoint. Add a bounded CLI `primary-color edit --project ... --composition ...
--commands request.json` adapter that accepts primary-color commands only and
calls `TimelineEditor.edit`, using the same 1 MiB JSON-file pattern as transcript
edits. CLI `primary-color-review --project ... --composition ... --clip ...
--reference-clip ...` prints report JSON only; it cannot automatically apply or
persist a review across process exit. Its statistics/suggested numbers remain
reviewable in the report; old CLI report IDs cannot authorize a later Apply.
No render-only primary override flags.

- [ ] Add failing API/CLI tests for project binding/local trust/origin guards,
      request shape, media token/index bounds, discarded/stale report access,
      active close cancellation and ordinary editor revision/lock errors.
- [ ] Add unit tests for draft numeric invalidity/commit/reset/inherit, one
      command on drag release, scene/clip override changes, disabled protection,
      selection/project switch and late response/cancel focus recovery.
- [ ] Add Monitor tests showing primary → look, independent bypass-look semantics,
      both photo sources, no title/canvas filter, identity no filter and no media
      resource recreation, extra seek or transport/clock reset on color changes.
- [ ] Add real browser tests for chart screenshots/decoded MP4 comparison,
      arbitrary seek, actual before/after evidence, Apply/Undo/Redo/autosave/reopen,
      stale review and source-change refusal. Include keyboard-only workflow,
      English/Traditional Chinese/Japanese/pseudo locale and 768/1280/1920 sizes.
- [ ] Run new unit/adapter tests to establish intended failures; implement thin
      service adapters, scoped drafts and source filter integration using existing
      tokens/native controls. Update look comparison labels to “before Film Look”
      so saved primary is not mislabeled as original source color.
- [ ] Pass focused unit/integration tests and `pnpm test:i18n`. Run browser tests
      only in the coordinator's exclusive slot with
      `OPENFILM_CHROMIUM=/usr/bin/chromium pnpm exec playwright test tests/e2e/primary-color.spec.ts`.
- [ ] Review and commit the UI/adapters slice. Record any physical display or
      native browser uncertainty as manual evidence, not an automated pass.

## Task 6: Exact-head integration and durable validation

**Files:** Create `docs/primary-color.md`, `docs/validation-primary-color.md` and
their required English mirrors; modify only the authoritative D5C checkbox in
`TASKS.md`, existing `ROADMAP.md` section, NLE/color docs and contracts as needed.
Do not create another queue or mark future/manual items complete.

- [ ] Record exact base/head, changed paths, numerical recipe/precision,
      FFmpeg/build/proxy details, generated fixture hashes, decoded samples,
      measured tolerances and test results. Distinguish source coefficient parity
      from codec/browser/transfer/display differences.
- [ ] Independently review strict validators, all render/photo/Monitor branches,
      inherited locks, review fences, cache cleanup, no-overwrite and NLE precomp
      identity. Fix correctness findings with focused regression tests first.
- [ ] Under coordinator scheduling run formatting/lint/typecheck, full appropriate
      contract/media/unit/integration/browser/build/interchange gates, CI lane
      partition checks and docs/i18n checks. OTIO Python tools are in
      `/tmp/openfilm-otio-venv/bin`; set a task-specific PATH prefix when needed.
- [ ] Rebase onto the integrating branch only after D5A/D8 seams are settled;
      resolve shared file conflicts intentionally, rerun affected focused checks
      and record the final candidate. Do not treat an earlier green head as final.
- [ ] Hand the coordinator the reviewable commits, evidence, unresolved manual
      gates and readiness decision. Coordinator owns push/PR/merge after exact-head
      CI/review; this worker does not publish or merge.
