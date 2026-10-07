# Workstation readiness correctness validation

## 2026-10-07 QA-record remediation

Baseline PR #6 candidate: `48ded79e40b80e89fb57f1cdeb3a7dca5a7862b8`.
Its Verify #176 failed at TypeScript TS2352 in `scripts/workstation-qa.ts`.
Format and i18n had passed; later media/browser gates had not run.

A dependency-free regression harness exercised the actual script under Node
22.16.0. Eight tests initially produced two passes and six failures: malformed
observation handling, info/unavailable-only pass claims, missing evidence,
invalid nested records, invalid dates and evidence overwrite. The same harness
passes all eight after the fix. Local strict TypeScript 5.8.3 checking also
passes. These scoped results do not replace the repository's pinned Node
24.14.0 / TypeScript 5.9.3 CI, Vitest, browser or native gates.

The factory now constructs all named gates with typed independent arrays instead
of asserting an incomplete `Object.fromEntries` type. Validation rejects malformed
objects, unknown keys, invalid hashes, naive/impossible timestamps and reversed
intervals. A passed gate requires at least one positive observation and cannot
contain failed or unavailable observations. Positive observations require an
actual result and nonblank evidence references.

`init` uses exclusive creation and refuses to overwrite an existing evidence
record. `validate` reports `verification: record-only`: valid structure is not
proof that referenced files exist, that observations are truthful, or that all
workstation acceptance procedures were performed. A human reviewer must still
check the candidate, required coverage, source identities and attached evidence.

Real Resolve, real ASR/LLM quality, GPU, camera material, sustained 4K and Windows
installer validation remain unverified. This change does not implement automatic
Windows/macOS execution-owner recovery.

## Manual recovery fencing

Confirmed recovery rotates execution ownership in the same catalog transaction
that cancels unfinished batches. An obsolete writer cannot revive the job before
a retry. Desktop confirmation retains the inspected owner token and timestamp;
it cannot silently switch to a newer execution during polling. The action shares
the existing mutation/disposal barrier and respects uncertain acceptance.

Schema conditionals mirror positive-evidence and terminal-status rules. Runtime
validation additionally checks calendar timestamps and interval ordering. Record
validation is never a certificate of real hardware/model/NLE success.
