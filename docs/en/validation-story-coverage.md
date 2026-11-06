# Story Coverage and Media Balance — Validation

Date: 2026-11-06.
Scope: explicit per-beat event/person coverage, image/video source-count bounds,
solver enforcement, Story Graph authoring, and StoryPlan preservation.

## Contract and behavior

- `coverage-group` v1 stores an explicitly named `event` or `person` group,
  stable group ID, unique catalog asset IDs, and a positive minimum count.
  Group members are user-curated; OpenFilm does not identify people or infer
  event membership.
- `media-balance` v1 stores optional non-negative integer minimum and maximum
  counts for images and videos. Counts are unique visual source IDs per beat,
  not clip duration. A paired presentation counts each unique visual source.
  Audio is never counted as visual coverage; 360-degree video counts as video
  in the solver.
- Legacy Story JSON remains valid because constraints are optional and additive.
  Project JSON validation/reopen preserves both constraint types. Story PATCH
  rejects missing catalog references before saving.
- Story Graph Inspector lets the user name an event/person group from visual
  assets explicitly connected to the selected beat, and set per-beat image and
  video bounds. Membership is frozen when the group is created; to change it,
  remove and recreate the group after connecting the intended assets.
- StoryPlan preview uses its source beat's constraints, and an accepted rough
  cut retains those constraints. A constrained preview that cannot satisfy the
  selected/connected source pool fails visibly rather than dropping the rule.
- Solver selection treats selected media, library locks, clip locks, and user
  pins as hard constraints. When those conflict with a maximum, composition or
  regeneration fails with an explicit conflict; the original document and its
  pins are not changed. Protected paired-source IDs count toward coverage and
  media bounds.
- `replace-similar`, `remove-repetition`, and automatic shortening do not add
  new coverage or media-balance deficits. Full composition and regeneration
  satisfy all feasible minima and maxima; infeasible candidate pools fail.
- The new Inspector labels are localized in English, Traditional Chinese, and
  Japanese and use native keyboard-operable controls with explicit accessible
  names.

## Test evidence

Validation on 2026-11-06:

- `pnpm exec vitest run packages/core/tests packages/solver/tests packages/application/tests/story-plan.test.ts tests/integration/story-intent.test.ts` — **69 files, 1,418 tests passed**.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test:i18n` — passed; 3,179 semantic keys match across en-US, zh-TW, and ja-JP.
- `pnpm format:check` — passed.
- `tests/e2e/story-arc-authoring.spec.ts` — **1 test passed**. The run exercised freeform beat editing, Story Graph constraints authoring, and persistence through the existing Story API. An earlier run exposed a Vue reactive-proxy `structuredClone` failure in the Desktop save path; the save/hydrate paths now copy JSON contract values and the end-to-end flow passes.

The unit and integration suite covers schema validation, project JSON roundtrip,
missing asset rejection, event/person coverage, intersection with candidate
pools, locked source placement, selected/locked media maxima, user-pinned clips,
paired-photo counts, regeneration modes, protected clips, and StoryPlan
preview/acceptance.

## Limits and remaining verification

- Event and person groups require explicit user curation. There is no automatic
  face recognition, person matching, or event inference.
- Group membership authoring currently uses all connected visual assets for a
  beat. Fine-grained membership selection inside an existing group is not
  available; remove and recreate the group to change its members.
- Direct timeline edits remain explicit editorial actions. This implementation
  prevents automatic composition/regeneration from rewriting pinned choices;
  it does not block a user from intentionally editing a cut after a Story
  constraint was authored.
- Full monorepo unit, media, browser-shard, native-shell, and platform
  workstation verification are separate gates. CI and Linux E2E do not replace
  Windows/macOS installer evidence, Resolve handoff, or real-media/GPU review.
