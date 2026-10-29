# Direct-manipulation branch recovery review

Status: reviewed for selective recovery
Source branch: `codex/direct-manipulation-editing`
Source head: `1440e95b7bd1bbf40883de49c007574f2354fac1`
Product comparison base: `c1d582b9b5ec8daadeab88048ac73d70999c8c39`
Dependency-only comparison head: `e9a531d499b1e3a6477ab1c06305e9b39b869247`

## Decision

Do not merge, rebase, or cherry-pick the old branch. Recover the clip-picture
move/resize interaction and its keyboard/cancel semantics as a small new
implementation on the current geometry and `commitTransaction` contracts.
Retain the old proportional time-track implementation only as design evidence.

The branch was reviewed as two commits and 19 changed paths. The later Vue I18n
patch does not change any editor behavior, so the product comparison remains
valid on the dependency-only head.

## Findings

### Important — the old time-track preview no longer matches the solver

`apps/desktop/src/timelineInteraction.ts` on the old branch previews a resize by
moving every clip on every track at or after the old end and derives Composition
duration from every track. Current `packages/solver/src/editing.ts` deliberately
excludes `timing: "overlay"` tracks from film ripple, adjusts an edited overlay
in place, and reconciles overlays separately when the primary film duration
changes. An audio overlay can therefore appear to move in the old draft preview
and stay fixed after acceptance.

Disposition: `REJECT/STALE` for the component and preview helper. A future
proportional view must consume the same application preflight/preview result as
the solver instead of reimplementing ripple semantics in Vue.

### Important — the old gesture queue predates atomic transaction fencing

The branch adds gesture offsets to the generic autosave queue. Current main has
an explicit `commitTransaction` path that flushes older edits, persists an exact
request before transport, uses one base revision and request ID, rolls back a
definitive rejection, fences disposal/project switches, and does not silently
rebase a stale professional edit. Replacing it with `commitGesture` would weaken
the current stale-revision and recovery contract.

Disposition: `REJECT/STALE`. Recovered pointer-up edits must call the current
transaction path; pointer previews remain ephemeral.

### Important — old hit targets do not meet the current coarse-pointer goal

The old picture handles are 24×24 CSS pixels and the time-track edges are 12
pixels wide. The approved Cut Desk design requires at least 44×44 CSS pixels for
coarse pointers. This is not a reason to discard the interaction, but the old
CSS cannot be copied unchanged.

Disposition: `ACCEPT` as a requirement on the recovered overlay. The visual
handle may stay compact while its coarse-pointer hit area expands to 44×44.

## Capability disposition

| Old behavior                                     | Current evidence                                                                                                         | Disposition                                                  | Recovery action                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Clip-picture move and proportional corner resize | Inspector numeric transform fields exist; direct manipulation currently exists only for GraphicScene layers              | `useful gap`                                                 | Reimplement the pure geometry and accessible overlay on current preview rounding     |
| Direct rotation                                  | The old overlay preserves rotation but has no rotation gesture; current Inspector has ±90° and numeric rotation          | `already covered` for old scope                              | Keep current controls; do not claim free-rotate recovery                             |
| Proportional multi-track view                    | Story cards are not time-proportional, but Precision already owns waveform, source trim, zoom and analysis               | `unsafe/stale implementation` with a real future product gap | Do not add a parallel timeline; evolve Precision/Cut Desk under Phase 1B/2 contracts |
| Snapping                                         | Old track edit only quantizes to frames; current Precision uses analysis candidates and GraphicScene has guides/snapping | `already covered`                                            | Keep current snap sources and operation-specific feedback                            |
| Pointer preview, Escape and pointer-cancel       | Current GraphicScene/Precision surfaces already use ephemeral preview/cancel patterns; clip-picture lacks them           | `useful gap`                                                 | Reuse the interaction pattern and cancel on owner/geometry/viewport changes          |
| Pointer-up history boundary                      | Current `commitTransaction` produces one acknowledged history entry                                                      | `already covered`                                            | Submit exactly one transform command per completed gesture                           |
| Keyboard editing                                 | Inspector fields and rotate buttons exist; direct picture arrow control is absent                                        | `useful gap`                                                 | Add arrow move/resize with Shift acceleration and accessible labels                  |
| Clip/source locks                                | Current solver and UI use operation-specific lock rules; library source lock is not a universal clip-local trim lock     | `already covered`                                            | Gate obvious UI states and rely on the typed command boundary for authority          |
| Autosave/reopen and retry                        | Current transaction recovery stores the exact request and non-optimistic base                                            | `already covered`                                            | Do not port gesture-offset persistence                                               |
| Stale revision/project switch                    | Current transaction owner/disposal rules are stricter than the old queue                                                 | `already covered`                                            | Fence the local overlay session and use `commitTransaction`                          |

## Optimization ledger

| ID   | Priority | Evidence                                                                                         | Intended change                                                  | Invariants                                                     | Acceptance proof                                        | Disposition    |
| ---- | -------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- | -------------- |
| B-01 | P0       | Old preview ripples all tracks; current solver excludes overlays                                 | Do not port old time-track preview                               | Composition and overlay timing remain authoritative            | Solver comparison plus existing editing regressions     | `REJECT/STALE` |
| B-02 | P1       | Old gesture queue predates current atomic transaction recovery                                   | Do not port queue; call `commitTransaction`                      | stale fencing, exact request, rollback, autosave and Undo/Redo | transaction unit/browser regressions                    | `ACCEPT`       |
| B-03 | P1       | No clip-level preview handles on current main                                                    | Add bounded move/resize overlay                                  | source immutability, geometry parity, one command per gesture  | pure geometry tests and browser move/cancel/reopen/Undo | `ACCEPT`       |
| B-04 | P2       | Old 24 px picture handles miss coarse-pointer requirement                                        | Expand coarse-pointer hit area without enlarging the visual mark | keyboard focus, CJK labels, desktop density                    | CSS/component assertion and responsive browser check    | `ACCEPT`       |
| B-05 | P2       | Time-proportional context is missing, but old view duplicates Precision and diverges from solver | Defer to current Cut Desk Phase 1B/2 design                      | no second timeline                                             | roadmap/task remains explicit                           | `DEFERRED`     |

## Scope boundary

This recovery does not add opacity, z-order, a free-rotation handle, new saved
fields, a second timeline, new ripple semantics, or project schema changes. It
does not delete the old branch. Expert Record-monitor direct manipulation and a
solver-backed proportional sequence view remain separate reviewed work.
