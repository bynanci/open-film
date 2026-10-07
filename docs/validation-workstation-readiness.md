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

## CLI confirmation flag

An independent review found that the documented `--confirm-stopped` option was
not registered in the CLI parser. A real CLI subprocess regression first fails
with the unknown-option error, then passes after registering the boolean flag.
The same test rejects omitted confirmation and checks durable batch recovery,
unchanged transcript revision and unchanged source bytes after reopening.

## Initial batch publication after recovery

Review of candidate `6fdd3b5422e9b6afdc0f0ade1912e90088f8147c` reproduced a
second ownership race on both the glossary and language review paths. An actual
Linux child process paused after publishing its queued job. After confirmed
recovery revoked that owner, the resumed child could still insert initial pending
batches. The job remained interrupted, leaving work that could not be retried or
skipped. Both regressions failed before the fix.

Initial batch publication now checks the exact queued job checkpoint and inserts
all batches in one SQLite transaction. A recovered owner cannot publish new
work. Invalid later batches roll back earlier inserts, and repeated initialization
cannot replace completed batch evidence. This uses the existing catalog and
ownership contract without a schema change.

The focused remediation run passed 87 tests across six files, including two
actual-child recovery tests and four portable catalog transaction regressions.
The child tests inject an unavailable process probe and use Linux SIGSTOP/SIGCONT;
they are skipped on other operating systems. This does not verify real Windows
or macOS process identity, liveness or recovery behavior.

The new Desktop browser scenario passed with one worker and zero retries:
confirmation and cancellation, Retry/Skip, close/reopen, and preservation of
completed evidence, transcript revisions, source bytes and film edits. Full
current-candidate regression gates remain pending. The browser uses generated
media, explicit transcript text and an unknown-owner fixture; it cannot certify
workstation hardware, ASR quality or actual owner liveness.

Initial browser runs exposed two incorrect assumptions in the new fixture: a
generic `review` job was never a supported producer or batch-mutation type, and
an ownerless `language-review` job still has a valid owner-status API. The fixture
now uses the historical supported type and verifies successful status responses,
unknown ownership and unavailable manual recovery for its terminal cancelled
batch. Retry, skip, confirmation, evidence preservation and reopen assertions
remain. Failed traces are retained; no production behavior was broadened to
accommodate unsupported fixture input.
