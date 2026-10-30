# CI delivery reliability and isolated browser shards

## Problem and evidence

Main8de63ae passes Verify41041116586 but fails Pages41041116556: both
architecture pages link to an internal `superpowers/` design excluded from
VitePress. PR verification never built the website. Earlier main132cac1 failed
formatting; main5160's Verify was superseded, not a new product failure.

PR70's complete heavy jobs took45m35s/46m26s; its browser step took30.0m.
Media tests and browsers share fixed local ports, so increasing workers in one
runner would introduce shared-project races.

## Design

- Fix the two design links to the repository source. Keep VitePress dead-link
  checking enabled and build the real website on every PR and push.
- Move the unchanged complete Chromium suite into four independent CI VMs.
  Each retains one worker, its own services/SQLite/temp files, unchanged test
  timeouts and assertions. Disable matrix fail-fast so every shard reports.
- Check actual Playwright discovery: four nonempty, unique, disjoint inventories
  must exactly cover the full inventory. Verify real JSON results after execution
  against current discovery, shard identity and exact source candidate SHA.
  Missing/duplicate/failed/skipped/flaky cases or absent reports fail closed.
- Run browser VMs alongside heavy media, fast contracts, native and docs jobs.
  Pull requests verify every synchronization; push verifies main. This avoids
  running the same expensive feature candidate twice for push plus PR.
  Keep all existing gates/artifacts and the historical required aggregate name;
  it requires every lane and verified browser coverage. No conditional path skips.
- Record measured before/after timings; no speedup claim before actual evidence.
  Synthetic fixtures only. No new dependencies, release version or workstation claim.

## Acceptance

The real documentation build passes; deliberately broken pages still fail.
All current291 Chromium tests execute once across four VMs, with a verified
candidate-bound receipt. All unit/media/interchange/CLI/native gates remain.
Main's actual Pages deployment and Verify must pass after the reviewed PR merges.
