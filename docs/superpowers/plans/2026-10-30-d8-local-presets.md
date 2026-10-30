# D8 Local Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:executing-plans` task by task. The parent owns delegation and
> independent review; this design assignment does not spawn agents. Steps use
> checkbox syntax for tracking.

**Goal:** Import, review, install, apply and remove bounded local Film Look,
Title and authored Story presets while preserving saved-film portability.

**Architecture:** A closed single-JSON package and additive recipe snapshots
feed the existing core evaluators. A host-user-data registry owns atomic local
settings, TimelineEditor owns look/title transactions, and StoryPlanService owns
authored story review and new-cut acceptance. CLI/API/Desktop share the services.

**Tech Stack:** Existing TypeScript/Node, Vue 3, i18n, filesystem/SQLite,
FFmpeg/FFprobe, Vitest and Playwright; no added dependency or upgrade.

**Spec:** `docs/superpowers/specs/2026-10-30-d8-local-presets-design.md`

## Global Constraints

- Base is `e1255b1a8a83260149211d909cca8c1a50948c6b`; product work starts only after
  parent approves the D8 design/interfaces. Keep the independent D8 branch/PR.
- Preserve project schema `1.0.0`, catalog v6, v1 look coefficients, built-in
  registration, source bytes, locks, authored pins, and existing history owners.
- Local JSON only: no JS/HTML/URLs, archives, assets/fonts, path-bearing recipes,
  credentials, remote requests or provider calls.
- Package/registry/snapshot/project-snapshot bytes are respectively 262,144 /
  8,388,608 / 98,304 / 4,194,304. Depth 12; tokens 20,000; package entries 32;
  installed packages 32; installed entries 256; project snapshot occurrences 256.
- Names/description are 128/1,024 UTF-16 units; total package text 131,072;
  copyright/author/source/modification/notice are 256/256/512/2,048/4,096.
- IDs use the spec's SDK grammar, package 96/entry and beat key 64 ASCII
  characters; version is stable `0..9999.0..9999.0..9999`, canonical no leading
  zeros. Reserve `openfilm`, `builtin` and their dot namespaces.
- Story recipes contain 1–12 beats, integer weight 1–1,000; locale title/intent/
  direction limits 128/1,024/2,048; target ≤3,600/max ≤10,800 seconds.
- Title recipes alias `TitleStyle` and call `validateTitleStyle`; resource caps
  are family ≤128 and absolute dimensions ≤4,096. Do not duplicate title fields
  or add primary correction to the Film Look recipe.
- Matrix is the existing 20-value encoded-SDR form: RGB mixing [-2,2], alpha lift
  [-0.5,0.5], zero constant columns, unchanged alpha row; strength [0,1].
- Reopen/render never reads the registry. Unknown nested versions fail closed.
  A saved local snapshot survives uninstall, collection, relocation and restore.
- Registry mutations use complete token-bearing locks and atomic owned-file
  publication; applied edits use the existing saved-manifest CAS/history owners.
- Preserve at most one bounded corrupt-registry recovery copy; refuse another
  recovery until it is manually archived/removed, with no automatic deletion.
- Retain 200 durable application retry receipts. Exact retries acknowledge the
  original action; they do not replay an undone edit or create another cut.
- English, Traditional Chinese, Japanese, keyboard/focus and CJK wrapping are
  required. Reuse Quiet Studio tokens and existing StoryPlan review.
- All media evidence is synthetic. No full Vitest/browser/native benchmark or
  shared 4310/1420 server during the design assignment. Parent coordinates full
  gates and integration; do not push, open a PR, or merge from this assignment.

## Review Focus

- A direct library call containing an accessor, numeric overflow or deep/huge
  data must fail before code execution, unbounded recursion or any storage write
  (Task 1).
- A replaced root, lock owner, registry/backup file or read source between checks
  must preserve unowned files and the prior accepted registry (Task 2).
- A package removed/replaced after review, or a request retried after Undo/reopen,
  must not silently apply a new effect, split history or duplicate a cut (Tasks
  3–4).
- A source hash/locked/selected/required-media change without a graph revision
  change must make a Story preset stale or conflicted while preserving its
  original source film and pins (Task 4).
- A project switch, removed local entry or unsupported nested title version must
  not reset saved selectors or publish a delayed response into another film;
  uninstall/reopen must retain actual picture and text (Tasks 5–6).

---

## File map and interface decisions

Create focused modules rather than putting registry IO or template code in the
SDK manifest. Existing owner files are extended in place where they publish
state. A path listed here is a proposed implementation path, not an existing
artifact in this documentation commit.

| Path                                                | Responsibility                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/presets.ts`                      | Package/snapshot/receipt/request/result types; bounds; descriptor-safe validation; canonical hash inputs; project snapshot enumeration/aggregate budgets. |
| `packages/core/src/preset-json.ts`                  | Bounded UTF-8/JSON lexical preflight and parse with duplicate/depth/token checks. No filesystem/Node imports.                                             |
| `packages/application/src/local-preset-registry.ts` | Lazy global registry, import/recovery review, install/remove/recover CAS, exact content identities.                                                       |
| `packages/application/src/local-preset-storage.ts`  | Bounded non-following file reads, owned-root/lock/temp identities, atomic registry and backup publication.                                                |
| `packages/application/src/preset-integrity.ts`      | Node SHA-256 over core canonical inputs, detached snapshot creation and project-integrity checks.                                                         |
| `packages/application/src/presets.ts`               | Project-bound review/application coordination and transport-safe results; no alternate editor/history.                                                    |
| `packages/story/src/preset-story-plan.ts`           | Pure explicit recipe-to-authored-plan mapping and protection/feasibility projection.                                                                      |
| `apps/desktop/src/components/LocalPresetsPanel.vue` | Settings import/acknowledge/install/list/remove/recovery.                                                                                                 |
| `apps/desktop/src/components/PresetApplyReview.vue` | Typed target/binding review; delegates Story presentation to existing StoryPlan review.                                                                   |
| `apps/desktop/src/local-presets.ts`                 | File/generation/abort handling and display helpers for saved local names/fallbacks.                                                                       |

Core interfaces are discriminated unions, not permissive records:

```ts
interface PresetSelection {
  canonicalId: string;
  packageSha256: string;
  registryRevision: string;
}
type PresetApplyTarget =
  | {
      kind: "film-look";
      compositionId: string;
      scope: "film";
      strength?: number;
    }
  | {
      kind: "film-look";
      compositionId: string;
      scope: "beat";
      beatId: string;
      strength?: number;
    }
  | {
      kind: "film-look";
      compositionId: string;
      scope: "clip";
      clipId: string;
      strength?: number;
    }
  | { kind: "title"; compositionId: string; clipId: string }
  | {
      kind: "story";
      storyId: string;
      bindings: { recipeBeatKey: string; beatId: string }[];
      options: Pick<
        StoryPlanOptions,
        "targetDuration" | "maxDuration" | "transition"
      >;
    };
interface PresetApplyInput {
  projectId: string;
  selection: PresetSelection;
  baseRevision: string;
  target: PresetApplyTarget;
}
interface PresetAcceptInput {
  request: PresetApplyInput;
  reviewSha256: string;
  requestId: string;
}
```

Film/title base revision is `TimelineEditor.get(compositionId).revision`; story
base revision is `application.versions.currentRevision()`. All SHA values are
lowercase 64-hex. Request IDs use the existing bounded nonempty receipt ID policy.
Request IDs are nonempty well-formed text without controls, at most 256 UTF-16
units; source/result/plan IDs share that bound. Exact request hashing includes
the original base/selection/target, not current
mutable display labels. Receipt lookup precedes stale/registry checks for an
already accepted exact retry, and compares the canonical request hash first.

`PresetRegistryView` returns `version:1`, `revision`, and detached normalized
packages/entry summaries with canonical IDs and package hashes. It never returns
storage paths. `PresetImportReview` contains `version:1`, `packageSha256`,
`registryRevision`, `reviewSha256`, detached validated package, declared rights,
entry summaries, and `alreadyInstalled:boolean`. `PresetInstallInput` contains
exactly `document`, `packageSha256`, `baseRegistryRevision`, `reviewSha256`, and
`acknowledgeLicense:true`. `PresetRemoveInput` contains `packageId`,
`packageVersion`, `packageSha256`, and `baseRegistryRevision`.

`PresetRecoveryReview` contains `version:1`, observed corrupt-primary hash,
valid-backup hash, review hash and recovered package/entry counts.
`PresetRecoveryInput` contains those three hashes and `acknowledgeRecovery:true`.
Recovery is unavailable for oversized/unsafe/unverifiable files or an unknown
registry version. Do not confuse the absence of a file with verified corruption.

`PresetApplyReview` contains `version:1`, the validated request, immutable
snapshot, review hash, human-readable typed changes/warnings/conflicts, and
either detached simulated `EditorDocument` plus existing commands, or the
authored `StoryPlan` plus its mapped composition preview. Returned commands/plan
are review data; acceptance reconstructs authoritative effects from the request.
`PresetAcceptance` returns current state/result IDs, receipt and
`alreadyAccepted:boolean`. Error/conflict text uses locale keys/parameters with
diagnostic English detail; no raw private paths.

### Task 1: Strict package, snapshot and receipt contracts

**Files:** Create `packages/core/src/presets.ts`, `preset-json.ts`,
`packages/core/tests/presets.test.ts` and `preset-json.test.ts`; modify
`packages/core/src/index.ts`, `models.ts`, `validation.ts` and `errors.ts`.

**Interfaces:**

- `parsePresetPackage(document: string | Uint8Array): PresetPackageV1` enforces
  byte/preflight budgets before JSON parse and returns a detached validated copy.
- `validatePresetPackage(value: unknown): PresetPackageV1`,
  `validatePresetSnapshot(value: unknown, kind: PresetKind): PresetSnapshot<PresetKind>`
  and `validatePresetApplyInput(value: unknown): PresetApplyInput` are closed,
  descriptor-safe pure validators. Narrow overloads preserve the requested kind.
- `canonicalPresetJson(value: unknown): string`,
  `presetRecipeHashInput(recipe: PresetRecipeByKind[PresetKind]): string`,
  `presetSnapshotHashInput(snapshot: PresetSnapshot<PresetKind>): string` and
  `canonicalPresetId(packageId, version, kind, entryId): string` define stable
  identity input. They validate safe data before serialization.
- `projectPresetSnapshots(project: OpenFilmProject): PresetSnapshot<PresetKind>[]`
  validates aggregate occurrence/byte limits without loading any registry.
- `compositionPresetSnapshots(composition: Composition): PresetSnapshot<PresetKind>[]`
  enumerates local look/title snapshots for the renderer's equivalent integrity
  boundary when it has a Composition rather than a complete project.
- Add exact `BuiltinFilmLook | LocalFilmLook` models, optional clip/story
  snapshots, `StoryPlan.presetContext`, `Story.presetPlanSource`, and
  `PresetApplicationReceipt[]` as in the
  spec. Keep TitleStyle as its owner alias. Receipt validators are closed and
  bounded; look v1 unknown fields remain rejected.

- [x] **Step 1:** Add failing tests named `rejectsAllUntrustedDataDescriptors`,
      `preflightsDepthBytesTokensAndDuplicateKeys`, `enforcesClosedVersionsAndRights`,
      `capsMatrixAndKeepsAlpha`, `usesTitleOwnerValidation`,
      `preservesCanonicalIdentityAcrossKeyOrder`, and `boundsProjectSnapshots`.
      Assert 262,144 bytes/12 depth/20,000 tokens/32 entries succeed at the bound
      with an otherwise valid fixture and fail one beyond; getter invocation
      count stays zero; NaN/Infinity/1e999 and future nested versions fail.
- [x] **Step 2:** Run
      `pnpm exec vitest run packages/core/tests/presets.test.ts packages/core/tests/preset-json.test.ts`
      and retain the intended missing-export/behavior failures.
- [x] **Step 3:** Implement the signatures and exact spec bounds, closed union,
      safe scanner, Unicode/URL/path rules and detached snapshots. Import/call
      the existing `validateTitleStyle` owner from the preset validator; all
      cross-domain dispatch happens inside function calls after module
      initialization. Add import-order smoke coverage and avoid eager cyclic
      top-level reads. Never copy the title validator.
- [x] **Step 4:** Pass the new files and existing core validation/look/title
      contracts selected from actual test inventory. Do not run the root suite.
- [x] **Step 5:** Commit the independently reviewable pure contract slice.

### Task 2: Bounded atomic user-data registry

**Files:** Create `packages/application/src/local-preset-registry.ts`,
`local-preset-storage.ts`, `preset-integrity.ts`,
`packages/application/tests/local-preset-registry.test.ts` and
`local-preset-storage.test.ts`; modify application barrel exports. Read and reuse
patterns from `global-glossary.ts`, `user-data.ts`, `review-owner.ts`; avoid an
unrelated global-glossary refactor.

**Interfaces:**

- `new LocalPresetRegistry(userDataDirectory: string)` establishes lazy trusted
  configuration; construction/opening a project never reads registry contents.
- `list(): PresetRegistryView`, `reviewImport(document): PresetImportReview`,
  `install(input: PresetInstallInput, signal?: AbortSignal): Promise<PresetRegistryView>`,
  `remove(input: PresetRemoveInput, signal?: AbortSignal): Promise<PresetRegistryView>`,
  `reviewRecovery(): PresetRecoveryReview`,
  `recover(input: PresetRecoveryInput, signal?: AbortSignal): Promise<PresetRegistryView>`.
- `readLocalPresetDocument(path: string, signal?: AbortSignal): Promise<string>`
  is a host-only CLI helper. No transport accepts its filesystem path.
- `hashPresetData(canonical: string): string`,
  `createPresetSnapshot<K>(packageValue: PresetPackageV1, entry: PresetEntry & {kind:K}): PresetSnapshot<K>`,
  `assertPresetSnapshotIntegrity(snapshot): void`, and
  `assertProjectPresetIntegrity(project: OpenFilmProject): void` use Node crypto
  over Task 1's exact canonical inputs. They do not load a registry.

- [x] **Step 1:** Add failing `sameContentIsIdempotentDifferentContentCollides`,
      `coexistsAtAnotherVersionWithoutRetargeting`, `enforcesRegistryQuotas`,
      `neverReadsOutsideSelectedRegularFile`, `preservesUnknownAndAliveOwners`,
      `deadOwnerRecoveryCannotReleaseReplacementToken`,
      `atomicPublishPreservesOldRegistryOnEveryFailure`,
      `lateCancelAcknowledgesCommittedInstall`, and `recoveryNeverDowngradesFutureVersion`.
      Use separate store instances and injected fs failure/race boundaries;
      assert original package and unowned sentinel bytes are identical.
- [x] **Step 2:** Run the two new application test files; retain the intended
      failing assertions without native media/browser setup.
- [x] **Step 3:** Implement root/descendant identity checks, non-following bounded
      reads, complete token lock/recovery, lock-protected reload/CAS, fixed
      sorted registry format, mode-0600 exclusive temp/fsync and atomic replace.
      Define rename as commit; unlink only owned temp identity. Backup recovery
      requires reviewed hashes and preserves a bounded corrupt-file copy.
- [x] **Step 4:** Pass all new storage cases plus the focused existing
      `packages/application/tests/global-glossary.test.ts` regression owner if
      any shared helper changed. Confirm no constructor registry access.
- [x] **Step 5:** Commit the registry owner and its security evidence.

### Task 3: Portable look/title application with one editor history

**Files:** Create `packages/application/src/presets.ts` and
`packages/application/tests/preset-application.test.ts`; modify application
construction/open/save in `index.ts`, `editor.ts`, core `looks.ts` and
`validation.ts`, `packages/solver/src/editing.ts`, render `look-filters.ts` and
`manifest.ts`, exporter `index.ts`/`handoff.ts`; extend focused look/solver/
exporter tests from actual inventory. Add `packages/render/tests/preset-looks.test.ts`
for the actual-media part executed in Task 6.

**Interfaces:**

- `new PresetApplicationService(application, registry)`; `review(input:
PresetApplyInput, editor: TimelineEditor): PresetApplyReview`; `accept(input:
PresetAcceptInput, editor: TimelineEditor): Promise<PresetAcceptance>`.
- Preserve `resolveFilmLook(composition, clip, override?)`, `filmLookMatrix(value?)`
  and `isFilmLookActive(value?)`; accept both look versions through the owner.
- Extend the existing presentation command with optional
  `titlePresetSnapshot: PresetSnapshot<"title"> | null`; validate it and the
  supplied owner style as one application pair. Rendering reads `titleStyle`.
- Add `TimelineEditor.acceptPresetApplication(compositionId: string, input:
PresetAcceptInput): Promise<PresetAcceptance>` as a preset-specific entry into
  its existing serialized edit/persist internals. The service delegates film/
  title acceptance to that same adapter-supplied editor; receipt and document
  must commit together. Avoid a recursive service/editor call: only service
  review is called from inside the editor; persistence belongs to the editor.
- `PresetApplicationReceipt` exact request/body lookup runs before stale checks;
  `acceptedRevision` is the existing editor revision, with current state also
  returned for historical retries. Append receipts through the current
  `persist` transaction, analogously to the direction-receipt optional input.
- Render's Node integrity check uses Task 1 canonical inputs and `node:crypto`
  directly; do not import application into render. Tiny SHA calls share the
  canonical contract, not a new crypto implementation.

- [x] **Step 1:** Add failing `reviewIsDetachedAndDoesNotEnterHistory`,
      `localLookScopesPreserveInheritanceAndProtectedEffectiveMatrices`,
      `titleApplicationUsesOwnerFrameAndLockChecks`,
      `acceptsOneHistoryUnitWithSnapshotAndReceipt`,
      `retriesAfterReopenAndUndoAcknowledgeWithoutReapplying`,
      `changedBodyRequestIdConflicts`, and `removedRegistryEntryStalesNewAcceptance`.
      Assert no source/catalog/geometry/timing mutation and no partial receipt.
- [x] **Step 2:** Run focused new application/core/solver tests, retaining the
      expected failures; keep actual FFmpeg tests for Task 6's owned media run.
- [x] **Step 3:** Implement version dispatch and effective matrix, title metadata,
      authoritative review reconstruction, complete editor/catalog/registry
      fences and single-save receipt. Use the same TimelineEditor instance as
      ordinary edits. Add snapshot integrity at app open/save/export/restore
      and renderer entry before a persisted local recipe is consumed.
- [x] **Step 4:** Preserve JSON/OTIO authored/effective snapshot metadata, native
      handoff limitations, and accurate per-local-recipe license/origin in
      render manifests. Extend closed handoff clip-key validation for the new
      title provenance field without claiming native effect reconstruction.
- [x] **Step 5:** Pass focused look/title/history/exporter tests, including
      builtin factory type checks using `BuiltinFilmLook["preset"]`, identity
      v2/zero-strength and future-version/hash rejection. Commit this owner slice.

### Task 4: Authored StoryPlan preset review and protected new-cut adoption

**Files:** Create `packages/story/src/preset-story-plan.ts`,
`packages/story/tests/preset-story-plan.test.ts` and
`packages/application/tests/preset-story-plan.test.ts`; modify story barrel,
`packages/core/src/story-plan.ts`, `packages/application/src/story-plan.ts`,
application preset service, and `packages/story/src/content.ts`.

**Interfaces:**

- `compilePresetStoryPlan(basePlan: StoryPlan, sourceStory: Story,
snapshot: PresetSnapshot<"story">, bindings: {recipeBeatKey:string;beatId:string}[],
locale: ProjectContentLocale): StoryPlan` is pure, preserves exact source
  references/order/nature, carries strict preset context and typed conflicts.
- `StoryPlanService.previewPresetPlan(storyId: string, snapshot:
PresetSnapshot<"story">, bindings, options: StoryPlanOptions):
{plan: StoryPlan; compositionPreview: Composition}` first uses `previewPlan`.
- `StoryPlanService.acceptPresetPlan(storyId: string, plan: StoryPlan, receipt:
PresetApplicationReceipt): {story: Story; composition: Composition;
acceptanceMapping: StoryPlanAcceptanceMapping}` shares the existing internal
  accept transaction, final source/project guard, and deterministic cut ID.
  It validates/carries snapshot, bindings, protected selections/constraints/min/
  max and retry receipt into one manifest write.
- D8 source guard hashes current source plan plus project-version revision,
  relevant source content hashes/states/durations and protection. Do not treat
  generic `sourceSignature` as a full content/lock guard. The preset service
  materializes/rechecks this context; no package or client plan controls it.
- `localizeProjectContent` resolves template-owned title/intent text from saved
  local story snapshots before external template lookup; user text/scripts stay
  authored. Supported-locale fallback is explicit and deterministic.

- [x] **Step 1:** Add failing `requiresBijectiveBeatMappingInAuthoredOrder`,
      `cannotReplaceAssignedAssetsWithPackageData`,
      `retainsSourceNatureNarrationEchoAndProtectedSelections`,
      `rejectsWeightAgainstBeatBounds`, `sourceLockAndHashChangesStaleWithoutGraphEdit`,
      `acceptsExactlyOneNewCutWithAllConstraints`,
      `reopenRetryReturnsSameCutWithoutRegistry`, and
      `localizesOnlyTemplateOwnedTextFromSavedSnapshot`. Cover missing/extra/
      idea-only scenes, cycles, alternatives, rejected/locked sources, missing
      required IDs, protected selection order, and deep/forged context.
- [x] **Step 2:** Run the new pure and application files and existing
      `packages/application/tests/story-plan.test.ts`; capture intended failures.
- [x] **Step 3:** Implement explicit mapping and weight pacing using the current
      plan/solver; preserve all asset ownership and source protection. Refactor
      only enough of acceptPlan to share its transaction with the preset path.
      Recheck source/protection/CAS after any await and immediately at publish.
      Keep built-in adapters and `generateStory` unchanged.
- [x] **Step 4:** Persist new-cut source mapping, snapshot, text ownership and
      durable receipt atomically; verify old Story/Composition and editor history
      are byte/logically identical. Pass focused StoryPlan and localization
      regressions; commit the authored-story owner slice.

### Task 5: Shared CLI/API and accessible Desktop flows

**Files:** Modify `apps/cli/src/index.ts`, `apps/server/src/server.ts`, desktop
`api.ts`, `App.vue`, `AppSettings.vue`, `FilmLookSelect.vue`,
`FilmLookInspector.vue`, and existing StoryPlan review integration. Create
`LocalPresetsPanel.vue`, `PresetApplyReview.vue`, `local-presets.ts`, three
`i18n/modules/presets/{en-US,zh-TW,ja-JP}.ts` modules with required registration,
`tests/integration/local-presets-transports.test.ts`,
`tests/unit/local-presets-panel.test.ts`, `tests/unit/preset-apply-review.test.ts`
and `tests/e2e/local-presets.spec.ts`.

**Interfaces:**

- Register the global/project routes and CLI subcommands listed in the spec;
  return the exact Task 1/2/3 service result types. Installation API submits a
  document string, never a path. Apply requests are strict typed targets, never
  arbitrary client commands/recipes.
- Server global registry and app-bound service share the trusted
  `userDataDirectory` configuration. Registry instances reload under lock; no
  project-open dependency for installation. Preserve Host/Origin/native session
  guards, route mutation queue and disconnect/cancel handling.
- Server passes `editorFor(application)` to review/apply. Desktop routes project
  state changes through existing optimistic/editor acknowledgement handling;
  local look labels read snapshot name and keep saved value after removal.
- `local-presets.ts` owns file-byte cap, generation IDs and AbortController;
  cancel/unmount/project-switch discards results from an earlier generation.
  No new framework, UI component library or design-token layer.

- [x] **Step 1:** Add failing integration assertions for round-trip CLI
      review→separate-process accept, identical package/review hashes across API,
      strict file/path/root rejection, absent license acknowledgement, foreign
      project, native/Origin checks, changed request body and 413 overflow.
      Unit tests assert delayed file/review/install responses cannot change a
      new project or selected file and saved local values remain selectable.
- [x] **Step 2:** Run these focused transport/unit files on ephemeral server
      ports; do not use global 4310/1420 during an uncoordinated worker run.
- [x] **Step 3:** Implement settings list/detail import/review/install/remove and
      explicit backup recovery, then typed film/scene/clip/title targeting and
      authored-beat mapping into existing StoryPlan review. Keep primary actions
      and provenance readable; put hashes under details. Add modified/fallback
      labels, structured errors, busy/cancel/retry states and no delayed save.
- [x] **Step 4:** Add all three locales, 360 px/CJK wrapping, labels/live regions,
      focus restoration/trap/Escape and touch targets with existing tokens.
      Pass focused tests, `pnpm test:i18n`, and relevant Vue/TypeScript checks;
      record commands and commit the shared usable flow.
- [x] **Step 5:** Leave real browser/media assertions in Task 6 pending until
      parent allocates the shared servers. Do not report the flow fully accepted
      from source-string/unit tests alone.

### Task 6: Actual media, portability, browser acceptance and delivery record

**Files:** Complete new `packages/render/tests/preset-looks.test.ts`,
`tests/integration/local-presets-portability.test.ts`,
`tests/e2e/local-presets.spec.ts`; extend existing Collect/named-version/OTIO
owners with focused snapshot preservation assertions. Add an original synthetic
example package and its provenance under `tests/fixtures/local-presets/`.
Create `docs/local-presets.md`, `docs/validation-local-presets.md` and required
English mirrors; update existing D8 entries in `TASKS.md`, `ROADMAP.md` and the
reconciliation record without duplicating its queue.

**Interfaces:** Tests exercise the public Task 2/3 services and existing render,
Collect, named-version and exporter APIs. Capture evidence as bounded JSON/text
artifacts with exact candidate/tool/font/media/package/recipe/snapshot/output
hashes and decoded frame/time results. No new benchmark or test-server platform.

- [x] **Step 1:** Generate an original RGB chart, two local photos, short video,
      CJK/Latin title text and assigned 3-beat StoryPlan. Test strengths 0/0.5/1,
      inheritance, protected scopes, crossfade, diptych/title exclusion, actual
      PNG/MP4 decode and shuffled first/middle/last seek frames. Arithmetic uses
      ≤3 channel levels; reuse and record existing browser/raster tolerances.
- [x] **Step 2:** Record source bytes/hashes before any operation. Install/apply,
      render/seek, remove registry entry and original package, reopen in a
      different user-data root, and render again. Assert exact same-host decoded
      frame hashes, rational frame/time structure, title pixels and unchanged
      original source hashes. Persist encoded output SHA as evidence without an
      across-toolchain encoded-byte equality promise.
- [x] **Step 3:** Exercise legacy fixture reopen, named version restore,
      directory/ZIP Collect relocation, JSON/OTIO metadata and native/baked
      handoff disclosures. Tampered snapshot/hash, unknown recipe/title version,
      deliberately changed matrix and shifted-frame negative controls must fail.
- [x] **Step 4:** With parent coordination run real Chromium import/review/rights
      acknowledgement/install/application/removal/reopen for every kind, stale
      project/response, malformed package, focus/Escape and CJK/360 px. Assert no
      package-caused outbound requests and compare rendered frames. Use
      `OPENFILM_CHROMIUM=/usr/bin/chromium`; do not start competing 4310/1420
      servers. OTIO checks use `PATH=/tmp/openfilm-otio-venv/bin:$PATH`.
- [ ] **Step 5:** Parent runs required full lint/types/format/i18n/docs/build,
      contract/media partition, full Vitest, official interchange, built CLI,
      browser/native checks once against the integrated candidate. New tests
      must remain in discovery/partition coverage; no assertion removal, retry
      inflation or weakened tolerances to obtain green.
- [ ] **Step 6:** Request independent review of schema/path/parser races,
      provenance accuracy, owner-version composition, Story protection and
      transaction/retry semantics. Reproduce each blocking finding with a focused
      regression, fix it, and rerun the affected evidence. Keep licensing and
      physical workstation/NLE/HDR judgment clearly unverified when unavailable.
- [x] **Step 7:** Update docs with actual base/head, commands/results, media
      hashes, correctness blockers and remaining manual evidence. Record the
      implemented slices in the existing D8 item; final completion stays open.
- [ ] **Step 8:** Parent creates the independent PR, obtains exact-head hosted
      gates/review and merges within the user's existing authorization. This
      implementation worker never pushes or merges.

## Self-review and execution handoff

The design's closed schemas/budgets map to Task 1; filesystem/atomicity/recovery
to Task 2; portable looks/titles/history/receipts to Task 3; authored StoryPlan
protection/localization to Task 4; actual shared user flows to Task 5; and media,
portability/browser/interchange/final review evidence to Task 6. The five review
focus conditions each name their owning regression above. The parent approved
the package/version policy, bounds, FilmLook v2 union,
clip/story snapshot fields, persistent retry receipt owner and StoryPlan mapping/
protection interfaces before implementation. Product checkpoints and actual
focused/browser/media evidence are recorded in
[validation](../../validation-local-presets.md). No dependency changed.
Independent fresh review and parent-coordinated full/hosted gates remain open;
no PR publication or merge has been performed by this worker.
