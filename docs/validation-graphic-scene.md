# GraphicScene validation record

Base main: `4d79c78b8e33f74efe322132561cd46e55a942fc`.
Branch: `codex/m3-f01-graphic-scene`. Scope and numeric limits are in
[the contract](graphic-scenes.md); [the threat model](security/graphic-scene-threat-model.md)
tracks the trust boundaries. Final published-head checks belong to the PR.

## Baseline

Before implementation, `pnpm test` passed all 183 files / 2,768 tests (75.85s).
The only open PR was M1 draft #27. M2 native captions are already merged.

## Execution ledger

The user requested direct implementation. This branch follows the written plan
inline, with tests observed failing before implementation and a fresh final review.
Task 1 exports the schema/evaluator consumed by Tasks 2 and 3. Task 2's PNG service
is the only raster path used by Task 3. No interface conflicts were found in this
pre-flight review.

Results below are added only after the corresponding commands complete.

Task 1 checkpoint: schema/evaluator and durable editing regressions were observed
failing before implementation. The corrected tree passes all 186 unit/integration
files / 2,807 tests, TypeScript/Vue type checks and 1,428 i18n keys. Full render
and browser work is pending. M3 is temporarily paused while the user-requested
M1 PR #27 integration is completed in a separate worktree.
