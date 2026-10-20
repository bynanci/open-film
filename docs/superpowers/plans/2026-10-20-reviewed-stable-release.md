# Reviewed fixes and next stable release implementation plan

**Goal:** Fix the confirmed findings from the review audit and fresh independent/GitHub reviews, merge verified changes, and publish a truthful 0.4.0 source release.
**Architecture:** Keep Composition, the project schema, SQLite storage, locks and editing history intact. Use the existing named-version service for explicit snapshot deletion, and the existing renderer for stem channel normalization. Each feature retains its own reviewed candidate; one integration branch preserves all six PR heads and validates the combined result.
**Spec:** User-authorized remediation of PR34 review5579974422 and the confirmed review audit; user explicitly authorized merge and publication; later clarified all six PRs 35–40 must be integrated and the version is the next stable version, not necessarily1.0.0.
**Tools:** Vue3, TypeScript, SQLite, FFmpeg, Vitest, Playwright, pnpm11/Node24.

## Scope and invariants

- Do not silently prune snapshots, overwrite original media, or execute project code.
- Source changes must reject restore before modifying the working project.
- Deletion requires confirmation and a fresh revision; protect active recovery journals.
- Keep the 50-version / 2GiB storage limits and project schema 1.0.0.
- No dependency updates, unrelated feature merges outside PRs 35–40 or unverified native installer claims.

## Optimization ledger

| ID        | Evidence / priority                                                    | Intended change                                                                        | Acceptance                                                                                                    |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| V-CAP     | r4320774527 / P1; 50 versions makes restore return413                  | Explicit service/API/CLI/Desktop deletion; preserve current project and other versions | Capacity test frees one chosen version then restores with checkpoint; cancel/stale/journal/retry/reopen tests |
| V-SOURCE  | r4320922170 / P1; target-only bytes changed during checkpoint accepted | Reverify target dependencies after checkpoint                                          | Synthetic source mutation during checkpoint rejects, current project/hash preserved                           |
| V-SCALE   | r4320774538 / P1; 1000 full sorts for1000 references                   | Linear sorted-order validation                                                         | Equivalent baseline/candidate workload; no repeated sorts, maximum supported input valid and unsorted invalid |
| V-KEY     | r4320774540 / P2; colon tuple collision hides change                   | Encode all composite IDs as tuples                                                     | Adversarial legal IDs retain independent changes                                                              |
| V-ORDER   | r4320774552 / P2; reordered narratives show empty diff                 | Explicit order entities for all collected ordered lists                                | Story/beat/track/clip/cue/scene/node reorder regressions                                                      |
| E-CHANNEL | r4322173617 / P1; actual mono/stereo stems fails                       | Normalize audio-only output channels on PR36                                           | Real FFmpeg regression; aligned channels/rate/count, source hashes unchanged                                  |

## Tasks

- [x] Add failing core and application regressions; record RED output.
- [x] Fix tuple identity/order, sorted-order validation, and post-checkpoint source verification; prove GREEN.
- [x] Add explicit bounded version deletion across application/API/CLI/Desktop, including keyboard confirmation and i18n; prove unit/integration/browser behavior.
- [x] Update validation, TASKS, ROADMAP and 0.4.0 release metadata/notes; retain unfinished platform gates.
- [x] Independently repair/review all six feature heads; integrate them with ancestry preserved.
- [x] Run combined format/i18n/lint/typecheck/test/build/interchange, built CLI smoke and actual shared render regressions.
- [x] Reproduce and independently close final CLI/archive/native admission findings; preserve owned output and rerun full combined basic gates.

- [x] Reproduce the hosted FFmpeg 6.1.1 low-frame-rate output defect with the exact authenticated runtime; independently verify the minimal renderer correction on 6.1.1/7.1.5 and rerun complete final gates.

- [x] Reproduce and independently fix the late ZIP saved-revision publication race; verify precommit rejection and postcommit ownership, then rerun all final gates.

Final full browser/native CI, exact-head review, merge and publication are gated
and recorded by [PR #41](https://github.com/bynanci/open-film/pull/41) and the
[checksummed 0.4.0 release](https://github.com/bynanci/open-film/releases/tag/v0.4.0).
No merge/publication occurs while a correctness blocker or failed required gate remains.
Installer distribution, workstation QA and remote provider enablement stay open.

## Review focus

Source-only target dependencies; deleting the latest create receipt; active recovery checkpoint deletion; project switching while confirmation is open; semantic ordering with legal delimiter-bearing IDs. Each has a regression in its owning layer.
