# User-Pinned Overrides / Immutable Direct Edits

Date: 2026-10-30. Coordinator-approved implementation contract.
Inspected exact base: `e1255b1a8a83260149211d909cca8c1a50948c6b`.
The user authorized the feature and subagent-driven roadmap work. The decisions
below are engineering proposals within that scope, not claims of prior implementation.

## Intent and approaches

A direct edit is durable editorial intent. Automatic regeneration must preserve
its saved source range, timing and presentation, including authored absence of an
effect. It may move or replace eligible unpinned neighbors. Every failed attempt
leaves the saved cut, history and pins unchanged. Composition remains the only
render/edit timeline; StoryPlan remains a proposal.

Considered approaches:

1. Frontend flags or a sidecar pin map: rejected because CLI, pipeline, restores
   and repeated occurrences would bypass or detach the protection.
2. Reuse `Clip.locked`: rejected because existing locks prohibit direct edits but
   deliberately allow ripple placement. Pins must permit further direct edits.
3. **Proposed:** inline versioned override state on existing Clip/GraphicScene,
   a shared detached mutation policy, and bounded placement around exact anchors.
   This requires application integration and a project compatibility gate, but
   protects every writer without duplicating timeline or persistence ownership.

No dependency, external I/O, upload, original-media write, new database, parallel
manifest or second timeline is introduced. CI separation from PRs 70/71 is outside
this change. Existing source/clip/node locks and required selections keep their
current protections. Pin removal never removes those protections.

## Exact source audit and gap matrix

| Owner at inspected base                                                                  | Observed behavior                                                                                                                                                                                          | Required change                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/models.ts:337`                                                        | Clip has `locked`, trims, seconds timing and presentation; lock comment explicitly permits ripple. No UserOverrideState or pin fields.                                                                     | Add inline typed state; do not overload locks.                                                                                                        |
| `packages/core/src/graphic-scenes.ts:124`                                                | GraphicScene owns Composition-time start/duration, nodes and optional PhotoDepthRecipe. There is **no** PhotoDepthGraphicScene type.                                                                       | Add state to this owner; photo-depth edits pin the scene/recipe dependencies together.                                                                |
| `packages/core/src/validation.ts:1050`                                                   | Clip validator checks known fields but does not reject arbitrary unknown Clip keys; GraphicScene has a closed whitelist. Project supports exactly schema 1.0.0.                                            | Closed override validator and schema gate, both TypeScript and JSON Schema.                                                                           |
| `packages/solver/src/index.ts:80`                                                        | `compose(story, assets, {allowEchoAssetIds?})` creates a fresh UUID Composition and clip IDs, beginning at zero; no baseline argument.                                                                     | Keep fresh creation; add a separate explicit incremental entry in the same solver package.                                                            |
| `packages/solver/src/editing.ts:351,527,1726`                                            | Protected clip = clip/source/paired-source lock or required selection. Regenerate preserves those payloads but `resize`, `remove` and insertion ripple them. Editable slots get newly generated IDs.       | Add pins to retained identities and absolute anchors; replace unconstrained ripple when anchors exist.                                                |
| `packages/solver/src/scene-direction.ts:310`                                             | Existing presentation is skipped unless `replaceExisting`; paired layouts have extra protection. This is a local proposal rule, not global immutability.                                                   | Pin guard applies even with `replaceExisting`; ordinary review acceptance does not unpin.                                                             |
| `packages/application/src/editor.ts:1435,1599`                                           | Strict commands, serialized revision check, detached application, request replay and one history entry; project validation/save rollback. Undo/Redo is session memory.                                     | Apply server-owned mutation origin and pin policy here; include metadata in all snapshots/revision digests.                                           |
| `packages/application/src/index.ts:1861`                                                 | `compose` appends a new cut and saves; it does not regenerate the selected cut.                                                                                                                            | Preserve explicit new-cut behavior; selected-cut re-solve needs target and revision.                                                                  |
| `packages/application/src/pipeline-orchestrator.ts:1372`                                 | composition-adopt calls fresh `app.compose`, then attaches optional captions and saves again. Artifact contains composition ID/duration, not baseline/pin identity.                                        | One detached adoption publication, typed target mode, exact revision/pin evidence in consumed signature and receipt.                                  |
| `packages/application/src/story-plan.ts:151`                                             | acceptPlan creates new story/beat/clip identities and a new rough cut; idempotent receipt returns that cut. Echo assets may recur across beats.                                                            | Keep new-cut semantics. Never infer a baseline or copy pins by source ID; retries return the saved cut with its subsequent edits.                     |
| `packages/application/src/scene-plan.ts:380`                                             | Separate scene-plan acceptance solves a new cut and checks source signature; existing receipt returns saved cut.                                                                                           | Same explicit new-cut semantics and idempotency coverage.                                                                                             |
| `packages/application/src/creative-variants.ts:366`                                      | Copies clips with new IDs and provenance; film mode scales timings/sourceOut; section targeting uses selected asset membership; Composition spread carries scenes.                                         | Deep clone, identify section by beat/clip identity, preserve pins/scene IDs within derived scope, use constrained placement; no shared mutable state. |
| `packages/application/src/index.ts:855`                                                  | Canonical Composition is `project.json`; SQLite `withProjectWrite` protects manifest CAS/publication. No Composition table.                                                                                | Persist inline state through same transaction; no new table or catalog schema bump.                                                                   |
| `packages/application/src/project-versions.ts:1182`                                      | Immutable project+SQLite snapshots; Restore checks source locks and current clip locks, stages/recovers publication.                                                                                       | Snapshot pins exactly; explicit Restore may replace user pins but still enforces existing locks.                                                      |
| `packages/application/src/collect-derived-media.ts:457`                                  | Portable-copy source clock remapping rejects clip.locked; generic inline JSON otherwise survives.                                                                                                          | Pin ranges must force original media, with defensive rejection before any remap.                                                                      |
| `packages/core/src/timebase.ts`, `sequence.ts`; application `updateProjectTimebase:1589` | Existing rate changes with timed content fail; rational project clock; shared `resolveClipFrameRange` and `resolveClipSourceRange`; saved seconds may be off-grid. Editing still has local `sourceBounds`. | Reuse shared resolution; strict editing bounds remain stricter than renderer's 50ms tolerance. No silent frame rebasing.                              |

## Portable contract and compatibility gate

Create `packages/core/src/user-overrides.ts`, exported by core; import its type
into models and graphic-scenes. No `packages/contracts` or domain package.

```ts
export type UserLockedAttribute =
  "inOutRange" | "photoDepth" | "motionPreset" | "timing";
export interface UserOverrideState {
  version: 1;
  isUserPinned: boolean;
  lockedAttributes: UserLockedAttribute[];
  /** Signed sequence-frame delta of the latest explicit move; informational. */
  manualOffset?: number;
}
// Clip.userOverrides?: UserOverrideState
// GraphicScene.userOverrides?: UserOverrideState
export type OverrideTarget =
  { kind: "clip"; clipId: string } | { kind: "graphic-scene"; sceneId: string };
```

`validateUserOverrideState(value: unknown, owner: "clip" | "graphic-scene")`
returns a detached value. Require plain enumerable own JSON data, exact known
keys, `version:1`, boolean, a dense array of at most four unique enum values and
safe integer offset. Reject symbols/accessors/prototype pollution, null, coercion,
unknown versions/keys, duplicate attributes and nonfinite numbers. Canonical
attribute order is inOutRange, photoDepth, motionPreset, timing. Unpinned state
is `{version:1,isUserPinned:false,lockedAttributes:[]}` with no offset. Absent
state is the legacy equivalent. Pinned state requires timing and at least one
attribute (timing alone is valid). Clip cannot claim photoDepth; GraphicScene
cannot claim inOutRange or motionPreset. A removed effect can stay pinned, so
absence of `motion`/`photoDepth` does not invalidate its attribute.

Every pin is a whole-instance automatic immutability boundary in this first
version. `lockedAttributes` names the user-facing supported categories, not a
permission to rewrite other fields. Automatic code must retain the complete
payload, identity, parent track, owning beat and effective inherited presentation.
There is no selective unlock in v1. This conservative rule also protects future
fields without expanding the four user-requested names prematurely.

`manualOffset` is optional diagnostic data, never an alternate start or a value
the solver adds. Set it only on an explicit move as new start-frame minus prior
start-frame at the current rational clock; later non-move edits retain it. A
newly created/split owner omits it unless it actually moved. The saved start is
authoritative. The existing `updateProjectTimebase` already rejects rate changes when any timed
content exists; preserve its `project.timebaseConflict` and revision/catalog CAS.
Unpinning does not grant rate conform. Equivalent rational rates or drop-frame
label changes do not move frames and retain their existing permitted behavior.
An incremental proposal carrying a different effective rate fails before solving. Reading old off-grid seconds preserves them
bit-for-bit; never snap them merely to create or read pin state.

**Forward compatibility:** base Clip validation would accept an unknown pin field
and old regeneration could erase it. Therefore additive metadata under 1.0.0 is
insufficient. Introduce `PINNED_PROJECT_SCHEMA_VERSION = "1.1.0"`; support reading
1.0.0 and 1.1.0, with 0.1.0's existing documented migration still producing 1.0.0.
Keep `PROJECT_SCHEMA_VERSION = "1.0.0"` as the new empty/legacy default and type
OpenFilmProject.schemaVersion as the two supported literals. The first commit
containing any userOverrides field promotes the project to 1.1.0 atomically.
1.0.0 validation rejects userOverrides anywhere. Clearing or undoing all pins
never silently downgrades the header. Legacy reads do not materialize defaults
or rewrite snapshots. Old binaries reject 1.1.0 before editing. Add a versioned
JSON Schema and explicit dispatch; update all hard-coded project-version readers.
A deliberate old Named Version Restore may restore its 1.0.0 header and content.
Unknown future project and override versions fail closed.

## Identity, operations and authority

Identity is `(compositionId, clipId)` or `(compositionId, sceneId)`; track ID is
also protected context. IDs are validated unique within their existing owner.
Repeated source assets, split halves, echo beats and paired sources are never
matched by asset ID. Retained instances keep IDs. New insertions get fresh IDs.
Split retains the left ID, creates the existing deterministic unique right ID,
and pins both resulting payloads in the same transaction. It preserves the
original incoming transition only on the left as today. Scene photoDepth retains
its scene/node/recipe IDs and original/mask/background references and hashes.
No synthesized scene-to-clip relationship is added when one does not exist.

| Operation                                                                                                | Pin state and permitted change                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Direct trim                                                                                              | Authorize target range/duration edit; add inOutRange+timing. Existing source/edit guards still run.                                                                                                                                                                            |
| Direct speed                                                                                             | Authorize speed/duration edit; add inOutRange+timing; retain exact resolved source window.                                                                                                                                                                                     |
| Split                                                                                                    | Authorize both halves; add inOutRange+timing to each, preserve other categories.                                                                                                                                                                                               |
| Photo duration / reorder / audio.move                                                                    | Pin timing on explicit target; neighbors may move only if unpinned. Reorder must not move a pinned neighbor to make room.                                                                                                                                                      |
| Direct motion or explicit removal                                                                        | Add motionPreset+timing. Full recipe including easing/endpoints/absence is preserved.                                                                                                                                                                                          |
| Direct photo-depth create/update/removal                                                                 | Pin GraphicScene with photoDepth+timing, including linked nodes and resources.                                                                                                                                                                                                 |
| Other direct Clip/GraphicScene presentation, transforms, look, title, node edits                         | Pin timing and retain complete payload against automation. UI describes the object as pinned, not just position.                                                                                                                                                               |
| Parent film/beat look or future color change                                                             | Direct scope is not permission to change pinned descendants through inheritance. Reject effective changes; a prior explicit per-clip edit can establish a local override.                                                                                                      |
| Delete / replace explicit target                                                                         | Permit target replacement/removal under existing lock/required-source rules; replacement pins its new payload. A pin is not a lock against its author.                                                                                                                         |
| Automatic server suggestions / direction acceptance / regenerate-beat shortening / regeneration          | Never clear pins; preserve pinned payload/effective rendering. Server-owned automatic writers retain automatic origin.                                                                                                                                                         |
| Explicit acceptance of selected existing Fit-to-target commands                                          | Existing Fit ingress submits exact reviewed trim/duration/delete commands through generic edit. These acknowledged user edits may pin newly edited unpinned targets; previews skip existing pinned owners and use the authoritative clock. No client origin field is accepted. |
| Pin command                                                                                              | Pin current full object at its exact saved coordinates; timing plus present supported categories.                                                                                                                                                                              |
| Unpin command                                                                                            | Clear only selected owner's pin state, retain payload and all source/clip/node locks. Does not re-solve.                                                                                                                                                                       |
| Unlock & Re-solve                                                                                        | Clear selected pins and solve selected Composition/beat in one detached transaction. Failure rolls back the unpin too. Label text explains it releases only user pins.                                                                                                         |
| Undo / Redo                                                                                              | Restore prior/pending document including pin metadata atomically. History stays session-local as today; reopen retains latest saved state, not old session undo stacks.                                                                                                        |
| Named Version Restore                                                                                    | Explicit snapshot replacement intentionally restores/removes pin state and values exactly. Existing source/clip Restore lock checks must not be weakened; do not invent                                                                                                        |
| an existing GraphicScene-node Restore lock gate absent from this base. No auto-unpin path is introduced. |

Mutation origin is server-owned context, never a client/provider field:
`"direct" | "automatic" | "history" | "restore"`. Coordinate with D2B using one
optional fourth `applyTimelineCommand` argument, exported from solver:

```ts
interface TimelineEditContext {
  timebase?: ProjectTimebaseV1;
  origin?: "direct" | "automatic" | "history" | "restore";
}
```

Legacy unpinned calls without frame-dependent recipes retain current behavior.
Pin writes, constrained placement and D2B frame-dependent transition recipes
require authoritative timebase in that context; never assume 30 fps. Omitted
origin means automatic. First-party application/UI callers pass the real clock
and explicit origin. Helpers may use `Required<TimelineEditContext>` after
validation; do not add a competing fourth-argument contract for D2B. Generic POST bodies cannot
claim history/restore to bypass constraints. Explicit reviewed operations that
should supersede a pin require the actual typed unpin action; preview approval
alone is insufficient. Batch direct edits authorize only their named targets across the complete explicit transaction; side effects on untouched pinned objects remain conflicts. Pins attach to the final acknowledged batch. Automatic commands inside a batch preserve earlier direct intent as provisional anchors.

## Bounded incremental constraints and unsatisfied results

New solver module `packages/solver/src/pinned-placement.ts` owns placement used
by regeneration and constrained ripple; it calls existing candidate scoring and
required-media planning. No scheduler or durable plan is introduced.

```ts
interface IncrementalSolveInput {
  baseline: EditorDocument;
  assets: readonly MediaAsset[];
  timebase: ProjectTimebaseV1;
  scope: { kind: "composition" } | { kind: "beat"; beatId: string };
  mode: Extract<TimelineCommand, { type: "regenerate-beat" }>["mode"];
}
interface PinConflict {
  code:
    | "overlap"
    | "capacity"
    | "required-media"
    | "missing-owner"
    | "unsupported-topology"
    | "timebase-change"
    | "search-limit";
  targets: OverrideTarget[];
  beatIds: string[];
  message: string;
}
type IncrementalSolveResult =
  | { ok: true; document: EditorDocument }
  | { ok: false; conflicts: PinConflict[] };
function solveIncremental(input: IncrementalSolveInput): IncrementalSolveResult;
```

1. Validate/clamp nothing. Capture exact baseline objects, source resolution,
   effective inherited looks and rational clock. Max 2,000 film clips and 1,000
   beats per incremental solve; existing graphics/captions/source bounds apply.
   Over-limit requests return a conflict before selection. Non-target media and
   all existing required/source-lock rules are part of the feasibility problem.
2. Build the existing sequential film spine from non-overlay video/audio/music
   clips. Titles, caption tracks, GraphicScenes and explicit overlay tracks stay
   on their existing Composition-time coordinates. Do not infer a primary track
   from array position or pretend arbitrary overlap is a sequential spine. A
   baseline with overlapping spine clips is `unsupported-topology` for re-solve;
   non-timing edits and pin/unpin still work. Crossfade display tails do not count
   as spine occupancy; transition handles still must validate.
3. Pinned spine objects are exact occupied intervals `[start,end)` using shared
   `resolveClipFrameRange`; retain their saved seconds and fields exactly.
   Existing authored gaps, beat boundaries, fixed outside-scope media and pinned
   anchors partition the mutable region. Beat scope never spills into other
   beats; Composition scope can allocate unpinned beat boundaries while keeping
   every anchor's beat membership and story order. Unpinned locked/required clips
   retain their payload/range but may shift, honoring existing semantics.
4. Solve only inside those intervals. Preserve candidate ordering and uniqueness
   rules, including explicit echo permission. Assign a retained occurrence by
   existing clip ID; new candidates receive fresh IDs. One source supplying two
   split pinned halves satisfies presence once but retains both occurrences.
   Contradictory must-exclude/required/order constraints fail; no silent filtering
   of a hard order edge when partitioning a beat. Account for secondary and depth
   source dependencies, not only primary assets.
5. Use integer frame budgets for **new** clips, converting via `sequenceTimeAt`.
   Derive available frame boundaries from fixed baseline anchors without changing
   their stored seconds. Reserve both resolved-frame and exact-seconds occupied
   intervals. If rounded frame fit and raw seconds fit disagree, return capacity
   conflict; do not snap an anchor or hide a one-frame overlap. Generated clips
   must meet source duration/speed bounds and beat hard minima/maxima. Soft targets
   may miss; report achieved duration separately from feasibility. No synthetic
   black clips, duplicated media or trimming pinned source windows to fill gaps.
6. Candidate-gap assignment uses deterministic bounded backtracking: at most
   10,000 expanded states, one expansion per attempted candidate/interval choice;
   abort immediately at the bound with `search-limit` (not a false impossibility
   proof). Stable order is baseline occurrence order, then existing score order,
   then stable asset ID. Memoize remaining interval/required/order state. Cap
   conflict output at 20 targets/messages. No brute-force float search.
7. Direct trim/duration/speed uses a narrower placement mode: the explicit target
   is replaced by its proposed payload; all other pinned objects are fixed and
   other clip durations/source ranges stay exact. Only unpinned neighbor starts
   may move until the next anchor. A shorter interval may leave a real gap; an
   overflow fails rather than silently shortening a neighbor. No automatic scene
   retiming or depth recipe rebuilding is an escape hatch.
8. Validate final Composition, all existing selection/order constraints, overlay
   ranges and inherited presentation; compare pinned baseline payloads and
   resolved frames exactly again. Preserve absolute caption/graphics intervals.
   A pinned overlay beyond a shortened film end is a capacity conflict; unpinned
   overlay reconciliation follows existing explicit rules. Publish only a fully
   valid candidate. Unsatisfied returns HTTP 409 `timeline.pinConflict` with local
   owner IDs and actionable text; no paths, media bytes, provider output or dumps.

Example at 30 fps: A=[0,90), pinned B=[90,150), C=[150,240).
Shortening direct A to 60 frames leaves [60,90) empty and keeps B exact.
Extending A to 100 frames fails unless unpinned material before B can absorb it;
B is never moved. In re-solve, eligible clips may fill [0,90) and [150,end) subject
to source/beat budgets. Off-grid pinned seconds are preserved alongside these
resolved-frame checks; no conversion is written back to B.

## Application, pipeline and proposal seams

Extend existing `TimelineCommand` with `user-pin.set {target,pinned:boolean}`
and `user-pin.resolve {targets:OverrideTarget[],scope,mode}`. Commands remain
inside current `baseRevision`/`requestId` transaction; bounds are 2,000 unique
release targets and existing batch limits. Extract a focused application helper
`applyOverridePolicy(before, after, commands, context)` to compute authorized
owners and validate all indirect effects. Solver receives validated timebase
from project settings; HTTP inputs cannot choose another clock.

`OpenFilmApplication.compose(storyId)` remains new-cut creation. A new explicit
`TimelineEditor.resolve(compositionId, {baseRevision,requestId?,scope,mode})`
uses the same history/persist owner. Do not choose “latest cut” by story ID if
multiple timelines exist. A selected-cut Compose UI action calls this resolve;
explicit “New rough cut” uses fresh compose.

Extend `PipelineInputSnapshot` with optional strict versioned target:
`compositionTarget?: {version:1,mode:"new-cut"} | {version:1,mode:"resolve",compositionId:string,baseRevision:string}`.
Old persisted runs without target retain historical new-cut behavior; newly
started runs must carry the UI-selected target explicitly. Include it in input
and consumed signatures. Resolve mode validates target story/Composition,
revision and canonical pin digest before adoption, after asynchronous work and
inside publication. Reject stale evidence. Do not copy inferred pins into a new
cut. Existing captions/graphics remain; generated subtitle replacement that
would change retained manual content needs its own explicit edit, not a blanket
pipeline overwrite. Assemble captions and solve result on one detached candidate
and publish once; only then produce rough-cut artifact/receipt with target mode,
compositionId, base/produced revision and pin digest. These are evidence fields
in the existing artifact, not a second portable timeline. Retries acknowledge a
matching committed result; never append an extra new cut after a save ambiguity.

StoryPlan acceptance and scene-plan acceptance remain explicitly “new rough cut”.
They preserve the original cut and pins by leaving it untouched. Their receipt
retry must return the saved cut even after subsequent direct pin edits; it must
not regenerate it. Future “apply plan to this cut” must route through resolve
with explicit occurrence mapping and revision, rather than add another algorithm.

## Persistence, portability and variants

- `project.json` holds state; existing SQLite manifest CAS lock, atomic JSON
  publication, request receipts and restore recovery remain authoritative.
  Catalog stays v6. Pin edit failure must not leave an advanced in-memory state,
  history entry, misleading acknowledged revision or stale artifact.
- Named Versions capture exact project and SQLite image bytes. Inspect/diff old
  v5/v6 snapshots read-only; no migration of immutable snapshots. Pin changes
  appear in diff summaries. Explicit Restore restores the chosen saved pins and
  may remove newer pins without a prior unpin; current source/clip locks still
  gate it. Its existing backup/recovery transaction covers the change.
- Full/current-film Collect and ZIP preserve inline state and owner IDs; retain
  1.1.0 even if a scoped export contains no pins. Pin-protected source identities
  include paired photos and depth mask/background. Any pinned source usage forces
  whole-original collection for that asset so source clocks cannot be rewritten,
  even if another unpinned usage is derivable. Add `source.user-pinned` to existing
  Collect reason enums and validation. `remapCollectProject` rejects pinned
  rewrites defensively. No automatic derivative bake or equivalent-looking
  substitution overrides this rule. Existing archive/path/size checks stay.
- Native project round-trip guarantees pins. JSON/OTIO handoff must retain them in
  OpenFilm metadata through existing exporters/importers, or explicitly report
  unsupported editability in the existing compatibility report. A foreign NLE
  without support cannot be promised to enforce pins. Never strip metadata while
  claiming lossless OpenFilm reimport; preserve sequence frames and source ranges.
- Variant creation deep-clones entire document, creates IDs through existing
  provenance mapping and carries pins independently. Clip pin state is copied to
  the mapped occurrence; scenes may retain their IDs within the new Composition
  namespace and must be deep cloned. Source identity is not an occurrence map.
  Section scope uses beatId, not selectedAssetIds membership. Scaling/replacement
  requests use incremental constraints; pinned spans/payloads stay exact or the
  variant creation fails atomically. No implicit unpin-on-branch. Explicit unpin
  in the derived cut affects only that cut. Variant adoption selects the saved
  derived Composition and retains its pins. New unbased StoryPlan cuts are a
  separate explicit operation, not a variant clone.

## UI and future-field integration

Visible compact pin marker in TimelineClip and selected Clip/GraphicScene
inspectors; screen-reader name “Pinned against automatic changes”. Distinguish
existing padlock. Show supported categories and clear explanation that direct
edits remain available. Localized actions: “Pin”, “Unpin”, “Unlock & Re-solve”.
The combined action releases selected user pins only; source locks remain
visible and unchanged. Conflict lists affected local objects and next steps
(reduce requested duration, edit another clip, unpin a selected anchor). Keep
selection/scroll position, no optimistic pin success before durable acknowledgement.

D5A/B/C are parallel **new** feature candidates, absent from this base:

| Candidate           | Known contract from its design                                                            | Pin integration after those fields land                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D5A photo finishing | PhotoLayoutV2 ambient fill; PhotoMotionV2 bounded Bézier easing; focal/protected geometry | Direct layout/focal/ambient edits pin full Clip; motion/easing adds motionPreset. Preserve versioned payload, no downgrade reconstruction.                                                                                                     |
| D5B title finishing | Clip.titleRuns, CaptionCue.textRuns, TitleStyle.finishing                                 | Full Clip pin covers attached bilingual text/style/runs. CaptionCue/CaptionTrack have no userOverrides in this feature: existing explicit caption preservation remains; independent caption pinning requires a later versioned owner contract. |
| D5C primary color   | Clip.primaryColor, Composition.defaultPrimaryColor and beatPrimaryColors                  | Direct per-clip correction pins full Clip. Effective inherited coefficient changes must respect pins, matching existing locked-look policy. Auto Match acceptance cannot clear pins.                                                           |

Do not invent these fields in this branch before their owners land. The initial
policy compares full payloads and existing resolved FilmLook; add resolved primary
color comparison when integrating D5C. For base transforms/layout/title, direct
edit coverage already applies through the full-instance rule. D2B transition easing/dips are also a parallel future candidate: preserve full
pinned transition payloads and share TimelineEditContext for authoritative frame
validation; do not invent those fields in this base. No renderer needs to consume
pins: it renders the persisted Composition unchanged.

## Threat and verification design

Untrusted JSON/API/provider proposals cannot inject override state or origin via
scene upsert, unknown Clip fields, prototype/accessor objects or `customParams`.
Only the pin policy writes metadata on edit paths; imports validate it. Automatic
scene upsert carrying changed/removed metadata is rejected, not adopted as user
intent. Validate exact revision after queues/async work; stale drags cannot rebase.
Digest includes full pin state and target identity. Repeated assets must remain
independent. Pins are editorial constraints, not an alternate source hash registry. Reuse
existing source/receipt validation and PhotoDepth hashes; automatic source
substitution under an unchanged asset ID cannot evade existing identity checks.
Source loss, invalid duration, inherited look changes, superseded
pipeline artifacts and conflicts fail before publication.

Focused contract tests cover parser abuse, legacy/forward schema fences, repeated
assets/splits, off-grid and fractional clocks, deterministic feasible and bounded
unsatisfied solves, every command's direct/automatic classification and exact
rollback. Application tests use synthetic local sources and ephemeral temp
projects; any test server binds port 0. Cover autosave/reopen, Undo/Redo, restore,
Collect ZIP/derived blocking, variants and pipeline retries. Inspect actual saved
objects after each transaction; do not assert UI flags alone. Browser verification
is a later coordinator-leased step; ports 4310/1420 and full Vitest/native benchmarks
are not used during design. No implementation or test completion claim follows
from this document.

## Coordinator rulings during implementation

- Fit-to-target retains its existing typed generic-edit ingress. Accepted selected
  commands are explicit acknowledged user edits and may create pins on formerly
  mutable targets. The cost is additional anchors on later re-solve. Preview or
  provider work cannot overwrite existing pins; no origin payload or invented
  acceptance receipt is introduced.
- Pin promotion only upgrades schema 1.0.0 to 1.1.0. It never rewrites a newer
  validated version; a future capability owner must extend schema dispatch.
- Current composition-scope incremental placement retains authored gaps and beat
  boundaries. Feasible redistributions requiring a moved beat boundary fail
  explicitly instead of moving a pin. Resolve cannot replace captions without
  explicit caption editing intent. Ambiguous resolve retries may require a fresh
  preparation; deterministic new-cut retry preserves the already accepted cut.
