# Runtime Stage Input Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Reviewed direct staging rejects the same unsafe primary inputs as the existing strict intake, before staging side effects.

**Architecture:** Reuse inspectRuntimeInputs in stageRuntime only when distributionReview is present. Preserve the deliberate test-only script flow and all later rights/linkage gates.

**Tech Stack:** TypeScript, Node filesystem, Vitest, existing native scripts.

**Spec:** docs/superpowers/specs/2026-11-12-runtime-stage-input-parity-design.md

## Global Constraints

- Base main81714e287a76aac1e46b6bea7e1806a408aa9a63; no application/schema/timeline/provider changes.
- Strict reviewed inspection precedes renamer/package loading and destination/staging/lock creation; no input execution.
- Preserve intentional test-only FFmpeg wrapper, source bytes, existing unlinked-path rules, hash bounds and later attribution/linkage/rights gates.
- No new distribution approval, actual target binary choice, installer, admin setting, credential or Release. Keep issue141 open.
- Use synthetic fixtures only; authorized author/sign-off NAN CHUN WANG <by.nanci.tw@gmail.com>.

## Review Focus

- Wrong-OS/same-CPU headers must be rejected in reviewed stage, not only cross-host intake.
- Both supplied tool and primary-notice hardlink/symlink parents must fail with no filesystem output.
- A script sentinel must remain absent; inspection never starts input code.
- Valid headers/pins must reach an existing later gate without claiming rights; Node version/hash checks must remain shared.
- The deliberate test-only fault-wrapper integration must still pass.

### Task 1: Reuse the existing reviewed intake boundary

**Files:** Modify scripts/native/stage.ts; Create tests/unit/native-stage-reviewed-inputs.test.ts; Modify tests/unit/native-support-files.test.ts fixture only; Modify paired docs/runtime-intake-141.md and docs/en/runtime-intake-141.md; coordinator owns TASKS/ROADMAP/validation updates.

**Interfaces:** Consumes inspectRuntimeInputs(inputs: RuntimeInputs) from scripts/native/inspect-runtime-inputs.ts; retains stageRuntime(inputs, output, repository?) and RuntimeManifest shape unchanged.

- [x] Step 1: Add real-filesystem failing cases for reviewed wrong-OS/script/hardlink/symlink-parent tools and hardlink/symlink-parent/empty/changed-hash primary notices. Check exact inspector error class/message, no output/parent/staging/lock, original bytes unchanged and sentinel absent. Use fixture-only review bytes, never a real rights assertion.
- [x] Step 2: Run new suite and retain RED proving current stage reaches the existing later missing repository/LICENSE sentinel or creates staging before rejection; errors must not merely be invalid fixture setup.
- [x] Step 3: Import and call inspectRuntimeInputs for distributionReview inputs immediately after the existing host/target guard. Keep shared architecture helper/test-only branch unchanged.
- [x] Step 4: Canonicalize the existing support-file fixture root and emit host-format header bytes so its reviewed positive path still reaches the original linkage assertion on each OS. Preserve every assertion. Then Run new suite GREEN, existing native-runtime-intake/native-support-files/native-runtime tests, lint/typecheck/format for changed code. Include a valid-host-header case showing later existing rejection, not fabricated complete approval.
- [x] Step 5: Update only the paired runtime-intake guide with direct reviewed-stage parity and test-only distinction. Commit exact task paths with authorized DCO; no push/PR/merge by implementer. Write task report with RED/GREEN commands/counts/limits and concerns.
