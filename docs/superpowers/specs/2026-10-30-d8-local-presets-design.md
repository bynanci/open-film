# D8 — Strict local data-only preset registry

Status: proposed design for parent interface review; product implementation has
not started. Inspection base: `e1255b1a8a83260149211d909cca8c1a50948c6b`, branch
`codex/v1-d8-presets`, 2026-10-30. The authoritative work item remains D8 in
`TASKS.md`; this document adds no parallel roadmap queue.

## Intent and scope

An editor can import a small local preset package, inspect its authorship and
license, accept installation, apply an entry through existing film operations,
and remove the installed package. Film Look, Title, and Story entries share the
same registry and review contract. A saved film contains the recipe it accepted
and remains usable on another machine without the registry or original package.

This slice provides no executable plugin discovery, marketplace, archive
extraction, bundled fonts/media, provider integration, or network operation.
Package strings never select a module, executable, subprocess argument template,
stylesheet, HTML fragment, URL, or filesystem location. It is independent of the
optional D5 contracts: it consumes the current title validator and Film Look
resolver; primary correction remains a separate processing owner.

## Current owners and evidence

| Concern                 | Existing owner at the inspection base                                                           | Consequence for D8                                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension manifest      | `packages/plugin-sdk/src/manifest.ts`; ADR 004                                                  | Reuse identifier/version conventions, not executable ports. `validatePluginManifest` is not a closed data-package validator: it accepts an object containing extra fields and returns selected known fields. The proposal template's manifest even contains an executable `entry`. |
| Strict declarative data | `packages/core/src/graphic-scenes.ts`                                                           | Follow its descriptor-safe plain-object checks, closed fields, dense arrays, depth/resource budgets, and detached output. Do not accept a general GraphicScene or invent another graphics DSL.                                                                                     |
| Looks and inheritance   | `packages/core/src/models.ts`, `looks.ts`, `validation.ts`; `packages/solver/src/editing.ts`    | Preserve v1 built-ins, explicit none/zero, film → beat → clip precedence, and effective-matrix protection for locked clips.                                                                                                                                                        |
| Monitor/render color    | `FilmLookFilter.vue`, `RecordMonitor.vue`; `packages/render/src/look-filters.ts`, `manifest.ts` | Feed the same validated 4×5 coefficients into SVG and FFmpeg. Keep tone map → optional primary correction → Film Look order.                                                                                                                                                       |
| Titles                  | `TitleStyle`, `validateTitleStyle`, `resolveTitleStyle`; native title raster and preview        | Alias the owner's type and call its validator. D8 does not copy title field lists or author D5B's title version. Store provenance beside the clip's resolved style.                                                                                                                |
| Trusted story templates | `StoryTemplate` in plugin SDK, `packages/story/src/index.ts`, `templates/proposal-film`         | Existing adapters contain trusted functions. A data package cannot register or supply such a function. Existing built-ins remain registered as today.                                                                                                                              |
| Authored Story adoption | `StoryPlanService.previewPlan/acceptPlan`, `generateStoryPlanFromGraph`                         | Compile preset text and pacing onto an existing authored plan and use the current new-rough-cut acceptance transaction. Preserve its original film.                                                                                                                                |
| Story protection gap    | `story-plan.ts` and `story-planner.ts`                                                          | Current source signature covers IDs/options; accept checks graph/beat revision, but does not recompute full catalog state. New beats do not copy source beat constraints/min/max. D8's preset path must add explicit source fencing and protection propagation within this owner.  |
| Project writes/history  | `OpenFilmApplication.publishProject/saveSync`, `TimelineEditor.serialize/persist`               | Retain catalog write lock and saved-manifest CAS. Look/title apply is one existing editor transaction and one Undo unit.                                                                                                                                                           |
| User storage            | `resolveUserDataDirectory`, `GlobalGlossaryStore`, `review-owner.ts`                            | Use host-configured user data, bounded file reads, complete token-bearing lock publication and conservative owner recovery. No project or HTTP root override.                                                                                                                      |
| Transports              | CLI, loopback server, desktop API and settings                                                  | All delegate to the same application services. Keep loopback Host/Origin and native-session gates.                                                                                                                                                                                 |

## Approaches

1. **Aliases of built-ins only.** This requires little color work, but cannot
   express an independently authored look. It leaves the requested extension
   boundary mostly unused.
2. **Bounded data recipes with embedded snapshots — proposed.** A single JSON
   document carries a small fixed union of matrix, owner-validated title, and
   authored story-plan recipes. It adds useful local entries while retaining the
   existing evaluators and application transactions.
3. **Directories/archives and general template assets.** Font/image paths,
   extraction, resource discovery, and rendering capabilities materially enlarge
   this slice. They are deferred.

The second approach is the proposed builder choice, pending parent review of
this document. No product code is authorized by this documentation checkpoint.

## Closed package and version contracts

The import format is one UTF-8 `.openfilm-presets.json` file. The extension is a
picker hint; validation depends on bytes. ZIP, directories, JS, JSON5 and YAML
are unsupported. There are no optional asset, entrypoint, permission, URL, or
runtime-configuration fields.

```ts
type PresetKind = "film-look" | "title" | "story";

interface PresetPackageV1 {
  format: "openfilm-presets";
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  license: {
    spdxId:
      | "Apache-2.0"
      | "MIT"
      | "BSD-2-Clause"
      | "BSD-3-Clause"
      | "CC0-1.0"
      | "CC-BY-4.0";
    copyright: string;
    notice: string;
  };
  provenance: {
    author: string;
    origin: "original" | "adapted";
    source: string;
    modificationNotice?: string;
  };
  entries: PresetEntry[];
}

type TitlePresetRecipe = TitleStyle; // Imported owner alias; never copied.
interface FilmLookPresetRecipeV1 {
  version: 1;
  domain: "encoded-sdr-rgb";
  matrix: FilmLookMatrix;
  defaultStrength: number;
}
interface StoryPresetRecipeV1 {
  version: 1;
  defaultLocale: ProjectContentLocale;
  defaults: { targetDuration: number; maxDuration: number };
  beats: {
    key: string;
    weight: number;
    text: Partial<
      Record<
        ProjectContentLocale,
        {
          title: string;
          intent: string;
          visualDirection: string;
        }
      >
    >;
  }[];
}
type PresetRecipeByKind = {
  "film-look": FilmLookPresetRecipeV1;
  title: TitlePresetRecipe;
  story: StoryPresetRecipeV1;
};
type PresetEntry = {
  [K in PresetKind]: {
    kind: K;
    id: string;
    name: string;
    recipe: PresetRecipeByKind[K];
  };
}[PresetKind];
```

All objects are closed, including license, provenance, entries, locale tables,
and recipe records. All required fields must be present. Adapted provenance
requires a nonempty modification notice. License/provenance are declarations
shown for human review; hashes do not authenticate the author or certify rights.
An entry inherits its package's complete license/provenance.

Package IDs use the SDK's lowercase alphanumeric/separator grammar, maximum 96
ASCII characters. Entry IDs and story beat keys use the same grammar, maximum 64. Package IDs `openfilm`, `builtin`, and their dot-prefixed namespaces are
reserved. Entry IDs are unique across kinds inside a package. Package version
is stable `major.minor.patch`, each component 0–9999, no leading zeros except
`0`; prerelease/build/range syntax is rejected in v1. Recipe schema versions are
independent of package release versions. Unsupported package, registry, snapshot,
or nested recipe versions fail before any install or application write. Title
version acceptance is exactly the current `validateTitleStyle` owner's decision.

Canonical IDs are derived, never read as paths:

```text
local:<package-id>@<package-version>/<kind>/<entry-id>
```

Two releases can coexist. Reinstalling the same ID/version and canonical content
is idempotent. Different content at an installed ID/version is a collision; it
cannot silently replace the old entry. There is no implicit latest-version
selection or auto-update. UI selection pins a full canonical ID and package hash.
Built-ins keep their existing IDs, registration, recipes, and translations.

## Bounds and hostile-input handling

These values are part of v1, exported from a frozen `PRESET_LIMITS` constant.

| Bound                                                                | Value                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Raw package UTF-8 bytes                                              | 262,144                                                                   |
| JSON nesting depth, container root depth = 1                         | 12                                                                        |
| JSON values/tokens visited                                           | 20,000                                                                    |
| Object key length                                                    | 64 UTF-16 code units                                                      |
| Entries per package                                                  | 32                                                                        |
| Name / description                                                   | 128 / 1,024 UTF-16 code units                                             |
| Copyright / author / source / modification notice                    | 256 / 256 / 512 / 2,048                                                   |
| License notice                                                       | 4,096                                                                     |
| Total package text                                                   | 131,072 UTF-16 code units                                                 |
| Installed packages / total installed entries                         | 32 / 256                                                                  |
| Registry file bytes                                                  | 8,388,608                                                                 |
| Preserved corrupt-registry recovery copies                           | 1; a second recovery requires manual archive/removal of the existing copy |
| One applied snapshot bytes                                           | 98,304                                                                    |
| Applied snapshot occurrences / serialized snapshot bytes per project | 256 / 4,194,304                                                           |
| Durable application receipts per project                             | 200                                                                       |
| Story recipe beats                                                   | 1–12                                                                      |
| Story beat title / intent / visual direction per locale              | 128 / 1,024 / 2,048                                                       |
| Story weight                                                         | Integer 1–1,000                                                           |
| Story default target / maximum duration                              | Positive ≤3,600 / ≤10,800 seconds; target ≤ maximum                       |
| Title package font-family / absolute dimension                       | ≤128 / ≤4,096 composition pixels, in addition to the owner validator      |
| HTTP request envelope bytes                                          | 1,048,576; embedded package still ≤262,144                                |

Read bytes before parse. Reject invalid UTF-8, BOM, duplicate object keys, depth
or token overflow in a bounded lexical preflight; then JSON.parse and closed
validation. The scanner must understand JSON strings/escapes and count containers
only outside strings. It is not a permissive alternate JSON parser. Numeric
overflow such as `1e999` is rejected as non-finite after parse.

The pure unknown-value validator first walks own data descriptors, rejecting
accessors without invoking them, symbols, inherited/custom prototypes, decorated
or sparse arrays, cycles, undefined, functions, BigInt and non-finite numbers.
Reject `__proto__`, `prototype`, and `constructor` keys at every level. Inputs
are copied only after that walk. It does not claim to sandbox hostile executable
JavaScript already running inside the host process.

All text must be well-formed Unicode, without control characters except LF in
notices and multiline story text. Reject `<`/`>` and URI-shaped tokens such as
`https:`, `http:`, `file:`, `data:`, `javascript:`, and `scheme://`; the format
has no link-bearing metadata or legal-document fetch facility. License notices
are bounded attribution text, not HTML or a remotely supplied license document.
Font families are names, not paths: reject separators, URI schemes and NUL.
No package field accepts an absolute/relative filesystem path, source asset ID,
credential, process command, filter expression, or external reference.

Film Look matrices have exactly 20 finite coefficients. The last row is
`[0, 0, 0, 1, 0]`; constant columns at indices 4, 9, 14 are zero; RGB mixing
coefficients are in [-2, 2], RGB alpha-lift coefficients at 3, 8, 13 in [-0.5,
0.5]. Strength is finite in [0, 1]. This is the existing encoded SDR affine
operation, with alpha preserved and RGB clamped after interpolation. No LUT,
spatial operator, camera profile, transfer function or primary correction enters
this contract.

Title recipes pass the descriptor-safe D8 data walk, then `validateTitleStyle`.
Additional import-resource caps apply to fields that the returned owner type
actually exposes; D8 does not maintain its own title field whitelist. For a
future owner version, the common depth/byte/text budgets still apply and the
owner must be able to validate and evaluate that version. Application also calls
`resolveTitleStyle` against the actual frame before accepting it. No font file
can be installed or selected by a preset.

## Snapshots, identity, and reopen

```ts
interface PresetSnapshot<K extends PresetKind> {
  version: 1;
  canonicalId: string;
  packageId: string;
  packageVersion: string;
  packageSha256: string;
  entryId: string;
  kind: K;
  name: string;
  license: PresetPackageV1["license"];
  provenance: PresetPackageV1["provenance"];
  recipe: PresetRecipeByKind[K];
  recipeSha256: string;
  snapshotSha256: string;
}
```

Canonical JSON sorts object keys by code-unit comparison, preserves array
order and Unicode text, normalizes negative zero to zero, and uses JSON number
serialization. Unknown fields never participate by being silently stripped.
`packageSha256` hashes canonical package bytes; `recipeSha256` hashes canonical
recipe bytes; `snapshotSha256` hashes the complete canonical snapshot excluding
that field. Changing even license/provenance changes the snapshot hash. A raw
file byte hash may be reported diagnostically, but whitespace-only differences
do not create a different recipe or installed release.

Snapshot validation re-derives `canonicalId` from package ID/version, kind and
entry ID and rejects a mismatch. The stored package hash identifies the reviewed
package; verifying a self-contained snapshot does not reconstruct an absent
package or turn that hash into an author signature.

Core exposes canonicalization and structural validation with no Node imports.
Trusted application and render boundaries use `node:crypto` to recompute the
digests before using persisted snapshots. Browser/core validators check shape
and digest syntax; they do not pretend a hexadecimal string proves integrity.
Hash inputs come from the same core canonicalization functions in every owner.
No new crypto dependency or hand-written cryptographic primitive is needed.

Persistence is additive to project schema `1.0.0` and catalog v6:

- Rename the current look interface to exported `BuiltinFilmLook`, keeping its
  exact v1 fields. Export `FilmLook = BuiltinFilmLook | LocalFilmLook`.
- `LocalFilmLook` is `{ version: 2; preset: "local"; strength: number;
snapshot: PresetSnapshot<"film-look"> }`. `preset: "local"` is an explicit
  discriminator; the saved snapshot contains its full canonical selection.
- `Clip.titlePresetSnapshot?: PresetSnapshot<"title">` records the accepted
  origin beside `titleStyle: TitleStyle`. TitleStyle itself remains untouched.
- `Story.presetSnapshot?: PresetSnapshot<"story">` and the preset-plan mapping
  carry the resolved authored recipe, locale tables, and source beat bindings.
- `Story.presetPlanSource?` records version 1, source story/plan identity,
  source-guard hash and each recipe key's source/new beat mapping.
- `OpenFilmProject.presetApplicationReceipts?` stores the bounded retry receipts
  described below. Legacy projects omit all additions and are not rewritten
  merely to add an empty collection.

Look/title/style values used for rendering are copied into the saved document.
There is no runtime registry lookup. A removed, corrupt, unavailable, or newly
incompatible registry cannot change a saved film or prevent a legacy open.
Registry initialization is lazy; opening/rendering a project does not load it.
Malformed or unknown-version snapshots fail with a field-specific diagnostic;
they never become an unannounced built-in/default recipe. An older binary may
reject a film using look v2; this is forward feature compatibility, not a promise
that old software can render new recipes.

The title snapshot is immutable historical origin. An ordinary user style edit
may diverge from it; the UI compares the current style with the original recipe
and labels it modified. Snapshot recipes never refer back to another snapshot.
Splitting a clip copies its title provenance with the copied style; deleting
the clip removes that occurrence naturally. Normal owner edits keep their
existing lock/history rules.

For story locale changes, use the saved recipe text for template-owned titles
and intents only, following `localizeProjectContent` ownership rules. Prefer the
requested supported locale; otherwise use the recipe's declared default locale
and disclose that fallback. User-owned titles/intents and authored scripts are
preserved. Registry presence is irrelevant to later localization.

## Trusted storage and installation transaction

`LocalPresetRegistry` uses
`<resolveUserDataDirectory(hostConfiguration)>/presets/registry-v1.json`, plus
its owned backup and lock. The trusted host establishes/canonicalizes its user
root once; every owned descendant is a regular directory/file and is rechecked
for symlinks and identity before publication. Project fields, API bodies,
package data and UI preferences cannot choose that root. System path aliases
resolved while establishing the host root do not become package-controlled
exceptions.

The registry is one bounded closed document `{ version: 1, packages:
PresetPackageV1[] }`, sorted by package ID/version for serialization. A revision
is the SHA-256 of its canonical logical contents; an absent registry has the
same logical empty revision as a valid empty document. There are no extraction
directories or original package copies to clean up.

CLI file import is an explicit local read: use a bounded descriptor read with
non-following open where supported, verify lstat/fstat identity before and after,
reject symlinks in the selected path, nonregular files, traversal components,
UNC/network paths, device files, and changes during read. Reading never writes,
renames, or deletes the selected source. The browser reads a user-selected File
and sends the document bytes/text; HTTP accepts no import path at all.

Installation state is a small transaction:

```text
local bytes → bounded parse/validate → import review (no disk write)
          → explicit license acknowledgement + expected revision/hash
          → token-bearing registry lock → reload/CAS → owned temp + fsync
          → preserve last valid backup → atomic registry rename → accepted
```

Review returns normalized metadata, entry summaries, declared license/provenance,
package hash, registry revision and deterministic review digest. Acceptance
revalidates the complete document and those values; it never trusts a client
summary. The license checkbox/CLI flag is required for each new package hash.
This is local content adoption, with zero LLM/provider calls and no remote
consent dialog.

Use complete owner publication as in GlobalGlossaryStore, with a random token
and `createReviewOwner`/`reviewOwnerState` host scope. Active or unknown owners
produce a retryable busy error. Only a provably dead same-scope owner can be
recovered after rereading its token under an exclusive recovery lock. No stale
timestamp alone permits deletion. Release only the lock still owned by this
operation. Missing atomic locking/publication support fails closed.

Under the lock, validate/reload the registry and check expected revision and
collision/budgets. Write a fresh exclusive mode-0600 temporary file in the same
owned directory, fsync and close it, then atomically replace the owned registry
file after final identity/CAS/abort checks. No-replace creation protects temp
files; the final registry is the single intentionally replaceable owned file.
Root/parent changes, symlink/hard-link surprises, read-only/full disks, failed
backup and failed publication leave the previous accepted registry intact.
Cleanup only unlinks a temp file whose identity/token this operation owns.

Cancellation is checked before parsing, after bounded validation, before taking
the lock, and immediately before commit. Rename is the commit point. After it,
report/acknowledge the installed result even if the caller disconnects; do not
erase a committed package to satisfy a late abort. Exact hash retries return the
existing installation without a second write. No background job, extracted
working tree, or resume queue is needed for a 256 KiB document.

Removal accepts exact package ID/version/hash and registry revision, then uses
the same transaction. It removes only registry data. Existing snapshots and
application receipts remain usable; original files/media/projects are untouched.
An entry removed after application review makes a new acceptance stale. An
already committed exact retry can still acknowledge its saved receipt.

Atomic rename means a process interruption exposes either the old or new valid
document. A valid last-known-good backup supports an explicit recovery review
and acceptance, bound to observed corrupt-primary and valid-backup hashes under
the same lock. Recovery never downgrades an unknown registry version, overwrites
an unverified file, or silently discards malformed data. Keep the corrupt owned
file in a uniquely named bounded recovery copy before restoring; no recursive
delete. Preserve at most one such copy; if one already exists, require manual
archive/removal before another recovery rather than deleting or accumulating it.
If identity/size cannot be verified, leave the files and show the error.
Built-ins and project reopen still work while registry management is blocked.

## Application review, protection, and history

`PresetApplicationService` is created by OpenFilmApplication with the same
trusted user-data configuration. It receives the adapter's existing
`TimelineEditor` instance for look/title review and acceptance. The server must
pass `editorFor(application)`; creating a second editor would split Undo state.

Review input contains project ID, full canonical selection/package hash/registry
revision, base revision, and a closed typed target. Film Look targets are the
existing film/beat/clip scopes; title targets one visual clip. No client-supplied
recipe or TimelineCommand is authoritative. Review resolves the selected
installed data, detaches its immutable snapshot, validates the target, and
simulates existing commands. It returns the exact before/after description,
warnings/conflicts and a deterministic SHA-256 review digest. Preview changes
neither saved film nor editor history; no package is reinstalled implicitly.

Accept resubmits the typed review input, review digest and request ID. Rebuild
and compare the review against current project/editor/catalog/registry state
before entering the existing save transaction. Race fences must also run at
publication, not just before an await. A mismatch, missing target, changed lock,
deleted package, foreign project, replaced recipe, or cancelled review leaves
the saved state and history unchanged.

Look adoption emits the existing `type: "look"` command with the local snapshot;
title adoption emits `type: "presentation"` with owner-validated `titleStyle`
and `titlePresetSnapshot`. Validate the latter as one matched pair when supplied
by preset application. Preserve existing film/beat locked-source effective-matrix
protection and clip/source lock checks. A preset cannot unpin assets, change
source selection, edit a secondary photo, or bypass a title owner's frame checks.
Each successful look/title acceptance has one Undo/Redo unit, with snapshot and
receipt publication in the same saved-project transaction. Existing non-preset
edit commands retain their current behavior.

A durable `PresetApplicationReceipt` records version 1, project/request ID,
canonical request hash, review digest, canonical preset ID, package/snapshot
hashes, result story/composition IDs, accepted editor/project revision and time.
Validate all fields and retain the newest 200 receipts. Reuse the existing
SceneDirection receipt pattern: `TimelineEditor.persist` can publish a preset
receipt with its document; the StoryPlan owner appends its receipt with its new
cut. Never publish a receipt in a second save after applying the edit.

```ts
interface PresetApplicationReceipt {
  version: 1;
  projectId: string;
  requestId: string; // Nonempty, well-formed, no controls, <=256 UTF-16 units.
  requestSha256: string;
  reviewSha256: string;
  kind: PresetKind;
  canonicalId: string;
  packageSha256: string;
  snapshotSha256: string;
  result: { storyId: string; compositionId: string };
  acceptedRevision: string;
  acceptedAt: string; // ISO timestamp.
}
interface PresetStoryPlanContext {
  version: 1;
  snapshot: PresetSnapshot<"story">;
  bindings: { recipeBeatKey: string; beatId: string }[];
  baseProjectRevision: string;
  sourceGuardSha256: string;
}
interface PresetPlanSource {
  version: 1;
  storyId: string;
  planId: string;
  sourceGuardSha256: string;
  bindings: { recipeBeatKey: string; sourceBeatId: string; beatId: string }[];
}
```

`StoryPlan.presetContext?: PresetStoryPlanContext` and
`Story.presetPlanSource?: PresetPlanSource` are closed optional fields. All source,
result and plan IDs use the existing well-formed nonempty 256-unit receipt ID
bound. Root receipts contain identity/hashes, not another embedded recipe copy.

The same request ID/body returns its acknowledged revision/result without another
edit, history step or rough cut, including after reopen or package removal.
Reusing that ID with a changed body conflicts. Undo followed by an exact request
retry acknowledges the earlier action and returns current state; it does not
silently apply the action again. An expired receipt does not allow a stale base
revision to replay. Registry installation/removal is settings state and does not
enter timeline Undo history.

### Story presets use the authored StoryPlan owner

A story package contains narrative prompts and relative pacing only. It cannot
contain asset IDs, graph edges, source ranges, generated evidence, arbitrary
constraints, or an authored `Story`/`Composition` payload. An editor first has an
authored story/graph with source assignments.

1. `StoryPlanService.previewPresetPlan` calls the existing `previewPlan` and
   receives a snapshot plus explicit `{ recipeBeatKey, beatId }` bindings. For
   this version, the current plan must contain 1–12 beat-backed scenes, the
   binding must be a bijection covering every scene/recipe beat, and binding
   order must match the already authored path. Missing/extra/idea-only scenes,
   unresolved alternatives, cycles, missing media or conflicts block acceptance.
   The UI can propose the existing order for equal counts, but shows every
   binding before review; it never guesses asset ownership.
2. Compile recipe title/intent/visual-direction and weight-based target durations
   onto those existing scenes. Keep their IDs, asset references, echo flags,
   evidence nature, narration and explicit order. Existing authored constraints,
   min/max bounds, selected/required media, rejected/locked state and graph
   protection are inputs to feasibility, not replaceable package data. A weight
   that violates protection or durations becomes a typed conflict.
3. A preset-plan context carries snapshot, exact bindings and a SHA-256 source
   guard over the source plan, project version revision, catalog source hashes,
   relevant states/durations and source protection. Recompute immediately before
   acceptance. Do not rely on the current generic sourceSignature's ID list.
4. The existing `StoryPlanReviewModal` presents the resulting authored plan.
   `StoryPlanService.acceptPresetPlan` shares `acceptPlan`'s internal new-cut
   transaction, deterministic cut identity and manifest CAS. It propagates each
   mapped source beat's selections, constraints and min/max to the new beat;
   validation and the existing solver must prove every protected source remains
   eligible/present. Missing protection is a conflict, not silent relaxation.
5. Persist new story/composition, snapshot, recipe-key mapping, text ownership and
   retry receipt together. Existing source Story/Composition, timings, locks and
   editor Undo stacks are identical. This follows the existing new-rough-cut
   adoption history model; it is not an in-place destructive replacement or a
   second timeline engine. Exact retries return the same cut after reopen.

No change to built-in `StoryTemplate` registration or `generateStory` is needed
for this initial application flow. A direct preset story-creation shortcut is
deferred until it can reuse this review/protection contract.

## Preview, render, interchange, and collection

`resolveFilmLook` retains its signature. `filmLookMatrix` validates either look
version and interpolates the same identity/matrix formula. `isFilmLookActive`
uses the effective matrix for v2; zero-strength or identity is a no-op while
still stopping inheritance at the saved scope. Built-in lists stay typed as
`BuiltinFilmLook["preset"]`; factories do not accidentally construct v1/local.

SVG attributes and FFmpeg filter strings are generated from finite validated
numbers only. Keep decoded source → required HDR tone map → separately owned
primary correction when available → look → compositing/title order. Audio,
letterboxes, diptych gaps and title colors retain their existing ownership.
Shuffled seeking must depend only on saved time/recipe, not selection order or
registry health. Existing approximate browser/HDR disclosure remains accurate.

Look controls display a saved local snapshot even after uninstall, with its
snapshot name/version and a local-source badge; they do not send `local` through
a built-in translation key or replace it with None. Editing strength preserves
the embedded recipe. Built-ins stay available in the normal selector; local
application starts from the review flow.

Render manifests retain the built-in recipe registry evidence with an explicit
built-in registry scope, and add deduplicated used local snapshots plus per-clip
canonical/hash provenance. A local recipe is never attributed to OpenFilm's
original Apache-2.0 matrices. Render/open/save/export validate snapshot hashes
without consulting installed packages. Native title preview and FFmpeg use the
existing measured raster/font resolution, including missing-font warnings and
actual font identities. No package font download is possible.

JSON and OTIO preserve full authored snapshots and effective look/style data as
metadata. FCPXML/EDL and native editable NLE effect limitations stay explicit;
metadata is not a recreated NLE color/title effect. Handoff's closed clip-key
audit recognizes title provenance without claiming it changes picture fidelity.
Existing baked handoff remains the visual-parity option. Collect Media and named
versions preserve the saved snapshots; no installed registry is copied or needed
after relocation. Unknown nested versions never receive a lossy fallback.

## Shared interfaces and user flows

The implementation plan defines exact type/module boundaries. Public operations
are the following, with host-only filesystem paths confined to CLI file reads:

```ts
LocalPresetRegistry.list(): PresetRegistryView;
LocalPresetRegistry.reviewImport(document: string): PresetImportReview;
LocalPresetRegistry.install(input: PresetInstallInput, signal?: AbortSignal):
  Promise<PresetRegistryView>;
LocalPresetRegistry.remove(input: PresetRemoveInput, signal?: AbortSignal):
  Promise<PresetRegistryView>;
LocalPresetRegistry.reviewRecovery(): PresetRecoveryReview;
LocalPresetRegistry.recover(input: PresetRecoveryInput, signal?: AbortSignal):
  Promise<PresetRegistryView>;

PresetApplicationService.review(input: PresetApplyInput, editor: TimelineEditor):
  PresetApplyReview;
PresetApplicationService.accept(input: PresetAcceptInput, editor: TimelineEditor):
  Promise<PresetAcceptance>;
```

| Surface | Initial flow                                                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI     | `presets list`; `presets review --file`; `presets install --file --package-sha --base-revision --review-sha --accept-license`; exact `presets remove`; `presets recovery review/accept`; `presets apply review/accept --project --request <bounded-json-file>`. Accept requires displayed review hash/request ID.       |
| HTTP    | Global `/api/presets`, `/api/presets/import/review`, `/api/presets/import/accept`, `/api/presets/remove`, `/api/presets/recovery/review`, `/api/presets/recovery/accept`; project-bound `/api/presets/apply/review` and `/api/presets/apply/accept`. All use the same services, strict bodies and existing error model. |
| Desktop | Settings → Local presets → Choose JSON → review license/provenance/entries → acknowledge license → Install. Installed rows expose Apply and Remove. Apply chooses the existing film/scene/clip or authored Story target, displays changes/conflicts, then accepts. Story opens the existing StoryPlan review.           |

CLI review and acceptance can be separate processes. They reread/revalidate the
same source and compare explicit canonical hashes/revisions; no process-local
pending token is required. CLI apply stores/reads a bounded typed request file,
not an executable expression or unvalidated serialized plan. Browser uses a
selected File, a bounded document string and typed targets; arbitrary server
filesystem paths never enter a route.

Use stable errors `presets.invalid`, `presets.unsupported`, `presets.conflict`,
`presets.stale`, `presets.storageBusy`, `presets.storageUnavailable` and
`presets.recoveryUnavailable`; existing protected-edit errors remain intact.
Invalid/unsupported is 400/422, stale/collision/busy 409, storage failure 500,
and byte overflow 413. Return field paths and actionable text, never file
contents, stack traces, private paths or credentials.

### Desktop direction and accessibility

The editor is extending a local collection before returning to the film. Keep
OpenFilm's Quiet Studio rhythm: source, cut, scene, title, recipe, proof and
provenance are the domain vocabulary. Use existing carbon/player-black surfaces,
pearl text, slate separators, focused blue action, and amber conflict tokens.
Keep the existing CJK body font, spacing and focus treatment.

The characteristic interaction is a readable recipe/provenance row beside the
specific saved-film change and its review action. Use a compact list/detail
flow; retain the film target and existing StoryPlan context. Do not introduce a
marketplace card grid, trust score, decorative gradient or new navigation mode.
Package identity/version and author/license are readable text; hashes are under
details for review/copy, not the primary task.

Implement en-US, zh-TW and ja-JP messages, including structured errors, review,
fallback locale, modified local recipe, removal and recovery. Long CJK names and
unbroken IDs wrap at 360 px. Controls have visible focus, labels and coarse-touch
targets. Dialogs restore focus, trap keyboard focus and close on Escape before
commit. Status/errors use live regions. Remove explains that saved films keep
their recipes. Cancel discards review, and late responses are ignored after a
new file, project switch, close or component unmount using generation/request
identity and AbortController. Install acknowledgement is a concrete content
choice; there is no generic execution-permission prompt.

## Acceptance and evidence

Use synthetic, generated, redistributable source media and original example
recipes only. No private media, credentials, remote resources or model calls.

| Area               | Required fresh evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser/validation  | Exact boundaries and one beyond: bytes, depth, tokens, entries, Unicode, text, title caps; duplicate keys, sparse/decorated arrays, accessors never invoked, prototypes, cycles, symbols, functions, BigInt, NaN/Infinity, `1e999`, unknown fields/versions, bad canonical IDs, invalid license/provenance, URL/path/HTML/code fields, and matrix/alpha violations.                                                                                                                                                                                                 |
| Storage            | Same/different version collision; identical hash retry; installed quota; read-only/full write injection; cancellation each side of commit; temp/registry/root/backup symlink/hard-link/race; lstat/fstat swap; two independent store instances; alive/unknown/dead owner; replacement token; interruption/reopen; explicit bounded backup recovery; unknown registry version never downgraded.                                                                                                                                                                      |
| Application        | Review has no save/history; one-unit Undo/Redo; durable retry and changed-body ID rejection; stale project/source/registry/lock; missing target; removed package after review; protected inherited look; title frame/font findings; authored Story mapping/count/order; selected/required/rejected/locked media and constraints; same new cut on retry.                                                                                                                                                                                                             |
| Portability        | Legacy fixtures unchanged; copied project opens/renders without registry/package; named version restore; directory/ZIP Collect relocation; saved local selectors; snapshot/hash tamper and future versions fail clearly.                                                                                                                                                                                                                                                                                                                                            |
| Actual media       | A synthetic RGB chart, photo and video, CJK/Latin title, and authored 3-beat story produce real PNG/MP4 output. Capture source/package/recipe/snapshot/font/tool/output hashes and rational frame/time evidence. Decode first/middle/last and shuffled seek frames at strengths 0/0.5/1, scopes and crossfade/diptych/title exclusion; compare shared math and existing preview/output tolerances. Removal/reopen must have identical decoded-frame hashes on the same toolchain. Record encoded SHA; do not demand identical encoded bytes across OS/codec builds. |
| Browser/transports | Real import/review/acknowledge/install/apply/remove/reopen for all kinds; malformed files, stale responses/project switch, keyboard focus/Escape, CJK/360 px, exact error codes, and zero outbound resource requests caused by packages. HTTP/CLI must return matching recipe/review identities and preserve source bytes.                                                                                                                                                                                                                                          |

Arithmetic channel comparison uses the existing Film Look synthetic tolerance of
3 channel levels. Browser/render and title-raster checks must reuse their
existing fixture/metric tolerances, recorded before implementation; any change
requires independent evidence rather than weakening an assertion. Include a
deliberately wrong matrix/hash or shifted frame to prove the acceptance fails.

This documentation pass runs no product tests, browser/native server, benchmark,
or full suite. During implementation use focused pure/security/application
checks first; reserve shared 4310/1420 servers and whole-suite gates for parent
coordination. Record actual commands/results in `docs/validation-local-presets.md`
and update existing D8/TASKS/ROADMAP entries only after the named flows pass.
Independent review, exact-head CI and separate PR integration are required for
delivery. License authenticity and physical workstation/NLE/HDR judgment remain
manual evidence; synthetic passes cannot establish those outcomes.

## Parent review decisions and builder calls

Approve the bounded JSON format, stable package version policy, local look v2
union, clip/story snapshot additions, durable receipt integration, and explicit
StoryPlan mapping/protection path before product code. The proposed limits and
the SPDX allowlist above are builder calls, not claims of prior user selection.
The registry stays independent of pending D5 schemas through title owner aliases
and the unchanged look resolver interface. The plan contains implementation and
acceptance tasks for every behavior above; this design does not mark D8 done.
