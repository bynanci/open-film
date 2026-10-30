# D6B — Derived Collect Media implementation plan

Use `superpowers:executing-plans`; preserve a private execution ledger and
RED→GREEN evidence. Spec: `2026-10-30-collect-derivatives-design.md`.

## Task 1 — Read-only coverage contract and planner

- [ ] Add closed version-1 delivery/coverage request and result contracts; reject
      unknown versions/fields, invalid IDs, modes, ranges, handles and bounds.
- [ ] Project existing source ranges via `resolveClipSourceRange`; union uses
      with clamped handles, preserve disjoint windows and deterministic ordering.
- [ ] Expose typed copy-original/block reasons for opaque dependencies, locks,
      unsupported media and unavailable timing. Mark preview review-only and
      non-executable. Never mutate assets, Composition or edit history.
- [ ] Add unit/application regressions and checkpoint this independently useful
      inspection owner. Keep D6B unchecked in TASKS.

## Task 2 — Shared review and execution eligibility

- [ ] Bind application plan to baseline Collect ID, saved revision and hashes.
- [ ] Add project-fenced CLI/API and review UI over the same owner, with quality
      disclosure, explicit accept and stale handling. No speculative Create.
- [ ] Review source-clock/catalog conversion; keep opaque evidence on originals
      until a complete typed mapping preserves immutable provenance.

## Task 3 — Actual derivatives and portable v2 publication

- [ ] Generate bounded, hash/probe-verified synthetic derivatives with explicit
      interval/offset lineage; preserve original project and v1 behavior.
- [ ] Convert only the private captured package; preserve all Composition timing,
      locks, caption/transcript/source-map and reopen semantics.
- [ ] Publish manifest v2 through the current destination/ZIP safety boundary;
      handle cancellation, stale sources/revision and disk failure atomically.
- [ ] Compare decoded trimmed output to the original baseline; disclose offline
      quality and require explicit acceptance for review-only output.

## Task 4 — Review, full validation and PR

- [ ] One independent final review, regression-backed fixes and all available
      format/i18n/docs/lint/type/unit/build/CLI/interchange/browser/native gates.
- [ ] Real directory/ZIP relocation, long-GOP/handles/disjoint windows, frames,
      audio and timing/source hashes. Leave workstation evidence open honestly.
- [ ] Update TASKS/ROADMAP/validation and create a separate D6B PR; do not mark
      product completion while execution or parity acceptance remains absent.
