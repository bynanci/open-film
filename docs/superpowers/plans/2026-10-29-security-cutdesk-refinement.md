# Security and Professional Cut Desk Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement the approved design task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete the approved A → B → C → D sequence: patch and verify the Vue I18n advisory, review and selectively recover unmerged editing interactions, ship a focused architecture and UX improvement on the existing Professional Cut Desk path, then reconcile the seven-subsystem v0.5.0–v1.0.0 roadmap against current evidence.

**Architecture:** Keep Composition, typed edit commands, shared application logic, autosave/history and FFmpeg authoritative. Deliver each phase as an independently reviewable change; write a more detailed sub-plan for B after the branch comparison and for C after B identifies a real user-workflow gap.

**Tech Stack:** pnpm 11.11.0, Node 24, Vue 3, Vue I18n 11, TypeScript, Vitest, Playwright, FFmpeg.

**Spec:** `docs/superpowers/specs/2026-10-29-secure-cut-desk-refinement.md`

## Global Constraints

- Follow sequence A → B → C → D.
- Use the minimum patched stable Vue I18n version, 11.4.14, for A.
- Keep one saved Composition and the existing typed command/history/persistence path.
- Do not merge, delete or rewrite `codex/direct-manipulation-editing` during review.
- Keep Issue #7 open until its candidate-SHA-bound workstation evidence is complete and reviewed.
- Do not claim the advisory is a reachable OpenFilm XSS without an application input-to-HTML-sink path.
- Do not execute untrusted project HTML/JavaScript or add a second timeline.
- Preserve user-owned files in the original checkout; work only in the isolated latest-main worktree.
- Report unrun/failed checks and retain manual workstation gates as manual.

## Review Focus

- Package metadata and lockfile must resolve the same patched Vue I18n/Intlify versions from a frozen install.
- The advisory's HTML-rendering prerequisites must remain absent; inspect the full repo for translation HTML sinks and `escapeParameter` activation.
- No unrelated package, project schema, renderer or source-media behavior should change in A.
- A baseline NLE handoff integration failure must be compared before/after A, not hidden or attributed to the dependency update without evidence.
- B/C must preserve locked edits, stale-revision fencing, deterministic preview, CJK/i18n, keyboard/IME and responsive/accessibility behavior.

## Persistent Goal Ledger

- [x] **A — Dependency:** upgrade the vulnerable production dependency, verify audit and project gates, and record evidence.
- [ ] **B — Interaction recovery:** compare every old-branch behavior against latest main, classify it with evidence, and port only confirmed gaps through a fresh plan/branch.
- [ ] **C — Cut Desk refinement:** use the B findings and the approved Phase 1B/1C design to implement one coherent, testable architecture/UX journey.
- [ ] **D — Evidence-backed roadmap:** audit all seven proposed subsystems and v0.5.0–v1.0.0 capabilities against latest main, then queue only verified gaps.
- [ ] **Issue #7:** remains open until real workstation evidence exists; CI is not a substitute.
- [ ] **PR handoff:** create independent reviewable PRs for delivered changes; do not merge absent explicit authorization.

## Baseline on Approved Design Base

At `c1d582b9b5ec8daadeab88048ac73d70999c8c39`, before product-code changes:

- `format:check`, `test:i18n`, `lint`, and `typecheck` passed.
- `test` reported 4,242 passed and one `tests/integration/nle-handoff.test.ts`
  failure because the default Python lacked OpenTimelineIO. In an isolated
  temporary Python environment with OpenTimelineIO 0.18.1, the focused NLE
  handoff suite passed all 60 tests.
- `test:interchange` passed all 18 tests with OpenTimelineIO 0.18.1; real
  Resolve import remained unverified.
- `pnpm audit --prod` reported 3 High and 2 Low advisory findings for the
  production `vue-i18n@11.4.13` dependency graph.

## A — Dependency Patch

### Task 1: Upgrade only the direct Vue I18n patch version

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: existing `@openfilm/desktop` dependency graph and pnpm workspace lockfile.
- Produces: exact `vue-i18n@11.4.14` with matching patched `@intlify/core-base` and `@intlify/shared` resolutions; no major/minor upgrade.

- [x] **Step 1: Record current dependency resolution**

Run: `corepack pnpm --filter @openfilm/desktop list vue-i18n @intlify/core-base @intlify/shared`

Expected: `vue-i18n` and its Intlify dependency versions are recorded as 11.4.13.

- [x] **Step 2: Confirm the advisory baseline**

Run: `corepack pnpm audit --prod --json`

Expected before the patch: Vue I18n 11.4.13 and the two advisories documented in the approved spec.

- [x] **Step 3: Update the exact direct dependency**

Run: `corepack pnpm --filter @openfilm/desktop add vue-i18n@11.4.14 --save-exact`

Expected: only the desktop dependency declaration and necessary lockfile resolution/integrity entries change.

- [x] **Step 4: Verify the frozen install**

Run: `corepack pnpm install --frozen-lockfile`

Expected: install succeeds without rewriting the lockfile.

- [x] **Step 5: Verify the resolved dependency graph**

Run: `corepack pnpm --filter @openfilm/desktop list vue-i18n @intlify/core-base @intlify/shared`

Expected: exact patched versions resolve; no frozen-lockfile mismatch or unrelated lockfile churn.

- [x] **Step 6: Verify the production advisory gate**

Run: `corepack pnpm audit --prod`

Expected: exit 0 with no production advisories. Preserve the output in the validation record; do not suppress low-severity findings.

### Task 2: Validate repository behavior and document the security boundary

**Files:**

- Create: `docs/validation-vue-i18n-security.md`
- Verify: `SECURITY.md`, `.github/workflows/security.yml`, current application translation/render paths.

**Interfaces:**

- Consumes: Task 1's exact lockfile graph and the static advisory/input-sink inventory in the approved design.
- Produces: a validation note with exact base/head, package resolutions, advisory IDs, commands/results and the honest exploitability boundary.

- [x] **Step 1: Re-run the static sink inventory**

Run: `rg -n -i 'v-html|srcdoc|innerHTML|outerHTML|escapeParameter' apps packages`

Expected: report any matches and inspect whether they create a reachable translation-to-HTML path; tests/docs are not production sinks.

- [x] **Step 2: Run formatting verification**

Run: `corepack pnpm format:check`

Expected: all tracked source and documentation files use repository formatting.

- [x] **Step 3: Run i18n verification**

Run: `corepack pnpm test:i18n`

Expected: all locale keys, placeholders, errors and literal UI references validate.

- [x] **Step 4: Run lint**

Run: `corepack pnpm lint`

Expected: ESLint exits 0 with no warnings.

- [x] **Step 5: Run typecheck**

Run: `corepack pnpm typecheck`

Expected: TypeScript and Vue type checks exit 0.

- [x] **Step 6: Run the complete unit/integration suite**

Run: `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-security/bin/python corepack pnpm test`

Expected: no new failures against the baseline; the 60-case NLE handoff suite uses the isolated OpenTimelineIO 0.18.1 environment.

- [x] **Step 7: Run the production build**

Run: `corepack pnpm build`

Expected: all workspace packages and Desktop/CLI outputs build successfully.

- [x] **Step 8: Run browser regressions**

Run: `corepack pnpm test:e2e`

Expected: all configured Playwright projects pass; report unavailable browser prerequisites as blockers, not passes.

- [x] **Step 9: Run interchange regressions**

Run: `OPENFILM_OTIO_PYTHON=/tmp/openfilm-otio-security/bin/python corepack pnpm test:interchange`

Expected: all 18 checks pass; real Resolve import remains a workstation gate.

- [x] **Step 10: Run native regressions when prerequisites exist**

Run: `corepack pnpm test:native`

Expected: run only when Cargo/Rust/native libraries are present; otherwise record the exact missing prerequisite.

- [x] **Step 11: Write validation evidence**

Record exact commands, pass/fail/not-run outcomes, workflow status, resolved versions and advisory counts in `docs/validation-vue-i18n-security.md`. State explicitly that removing the vulnerable dependency finding does not itself prove a security certification or an exploitable prior application path.

## B — Old Interaction Branch Review Gate

After A is reviewed, create a separate B review plan from the then-current `main`. Inspect both commits and all 19 changed paths in `codex/direct-manipulation-editing`. For each behavior—overlay transforms, proportional time tracks, snapping, pointer cancel/commit, keyboard, locks, history and stale revision—record `already covered`, `useful gap`, or `unsafe/stale`, with exact current-main and branch test/file evidence. Keep the source branch intact. If a useful gap is confirmed, write a bounded port plan and regression tests before implementation; do not cherry-pick wholesale.

## C — Cut Desk Architecture/UX Gate

After B's comparison, write a separate C implementation plan for one coherent user journey within approved Phase 1B/1C. The chosen journey must be tied to observed user friction and current roadmap criteria (monitor format, Ribbon/source-sequence context, compare lifecycle, pointer-centered gestures, responsive/accessibility). Define exact files and regression cases in that sub-plan. Extract modules only when the boundary reduces real coupling; file size alone is not an acceptance criterion.

## D — Seven-Subsystem Roadmap Reconciliation

After C, audit the current implementation of Story/solver, photo geometry/render,
Cut Desk/audio, transcript/captions, color/output, catalog/portable media and
cross-platform UI/CI. Create an evidence matrix that classifies each proposed
v0.5.0–v1.0.0 capability as `implemented`, `partial`, `missing`, or
`manual/workstation gate`, including exact code, test and validation references.
Correct stale release/schema/PR assumptions, check overlap before scheduling new
work, and update `TASKS.md`, `ROADMAP.md` plus a dedicated roadmap document with
only confirmed gaps and their dependencies. Future high-risk features receive
separate designs; D is an evidence and queue deliverable, not permission to
implement four releases in one branch.

## Handoff Conditions

- A/B/C/D changes remain separate and independently reviewable.
- GitHub CI and PR checks must report the exact branch head; no claim based on a stale workflow SHA.
- No Issue #7 gate is marked passed without the required candidate-bound workstation observations.
- Do not merge or publish unless separately authorized.
