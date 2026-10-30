# Contract and media CI implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Report pure contract failures independently while preserving all existing media/browser/native gates.

**Architecture:** Two disjoint Vitest configurations share the root aliases and defaults; unclassified files remain heavy. Discovery verifies exact coverage. An always-evaluated legacy gate requires both jobs to succeed.

**Tech Stack:** Existing TypeScript, Vitest5, Node24.14+, pnpm11.11 and GitHub Actions.

**Spec:** [CI design](../specs/2026-10-30-ci-contract-media-design.md).

## Global constraints

- No dependencies, test skips, weaker assertions, filters on PR paths or media bypass.
- Preserve `pnpm test`/`pnpm verify`, native workflow and full browser/interchange commands.
- Media artifacts remain synthetic; no credentials/media/font binaries are committed.
- Keep stable0.4.0; manual workstation/release observations remain open.

## Review focus

- New or moved test files cannot fall between lanes: compare actual discovery union.
- Empty/duplicate/overlapping lane inventories fail rather than produce a green gate.
- Failed/cancelled/skipped prerequisite jobs cannot satisfy the legacy aggregate.
- Native-benchmark tests and browser servers remain sequential within the heavy job.
- Split jobs retain required tools, artifacts and the unchanged full browser assertions.

## Task1 — Test lanes and exact coverage

Files: `scripts/ci/test-lanes.ts`, `scripts/ci/check-test-partition.ts`,
`vitest.contract.config.ts`, `vitest.media.config.ts`, `package.json`, `tsconfig.json`,
`tests/unit/ci-test-partition.test.ts`.

Consumes root Vitest config; produces `test:contracts`, `test:media`,
`test:ci-partition` commands. Five pure-package patterns select fast tests; heavy
extends existing exclusions with precisely those same patterns.

- [x] Add failing coverage tests for overlap, omission, extras, duplicates and empty lanes.
- [x] Implement strict inventory validation and invoke actual Vitest file discovery.
- [x] Prove discovery partitions every root test file; execute the contract lane.
- [x] Commit passing source/config checks.

## Task2 — Independent gates and evidence

Files: `.github/workflows/ci.yml`, workflow regression tests, `TASKS.md`, `ROADMAP.md`,
`docs/validation-ci-contract-media.md` and its English mirror.

Consumes Task1 commands. Produces fast/heavy checks and existing aggregate identity.

- [x] Add failing workflow invariants: all former commands retained, both jobs mandatory,
      no condition bypass and all three predecessor outcomes must fail the aggregate.
- [x] Move format/locales/lint/types/contracts into fast; media/build/interchange/CLI/browser
      into heavy. Keep native identical. Run partition verification before heavy tests.
- [ ] Execute actual available gates, retain logs and compare inventories/counts.
- [ ] One fresh-context final whole-branch review; fix Important/Critical findings in one
      regression-backed pass, record Minor/declined boundaries and exact-head hosted evidence.
- [ ] Create focused PR; merge only after all exact-head checks succeed.
