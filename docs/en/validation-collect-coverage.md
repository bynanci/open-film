# D6B source coverage review — implementation checkpoint

Date:2026-10-30. Branch:`codex/d6b-collect-storage`.
Status:**read-only review implemented; actual derived delivery remains incomplete**.
This checkpoint extends the existing Collect owner. It does not enable trimmed
or offline Create, change project schema1/Catalogv6, or publish a release.

## Implemented contracts and workflow

Version1 delivery options recognize `originals`, `trimmed-originals` and
`offline-proxies`, with default2s handles bounded0–10s. The application projects
existing `resolveClipSourceRange` results, including speed/default source bounds,
unions overlapping/adjacent handles and preserves disjoint intervals. Results
are explicitly `review-only`, `executable:false`; no byte saving or finishing
quality is guessed from retained seconds.

`CollectMediaService.coverage` binds the result to the existing Collect baseline
plan ID, saved project/catalog revision and actually inspected original hashes.
Foreign/stale requests and unknown delivery fields fail before publication.
Changed/unavailable source bytes cannot become trim candidates. No job, source,
asset, Composition, project file or editing history is written.

The catalog adapter inspects a private validated snapshot for selected
asset-bearing portable semantic/provenance owners. Immutable transcript clocks
and related revisions remain on complete originals. Disposable caches and
operational jobs are excluded from this classification. Authentic v5 snapshot
bytes remain unchanged. Source/clip locks, unknown metadata extensions and opaque
graph/scene/layout dependencies conservatively retain originals.

API:`POST /api/collect/coverage` and passive CLI:

```sh
pnpm cli collect coverage --project ./film.openfilm --scope current-film \
  --composition <saved-id> --delivery-mode trimmed-originals --handles 2
```

The same owner serves the progressively disclosed Export → Collect review, with
three locales, native labels/keyboard, 50-source pages, cancellation/retry and
project/signature fencing. Full-original v1 package creation remains separate.
CLI delivery flags used on Create fail explicitly instead of silently producing
a different package.

## Actual evidence

- **138/138** focused new/existing regressions across10 files: closed options,
  source windows, shared Sequence/timebase behavior, saved capture, transcript
  preservation, v5/current snapshots, HTTP/CLI equality, passive CLI, cancellation,
  changed-source/stale scope, source/clip locks, opaque graph metadata and original
  Collect directory/ZIP/source-safety behavior.
- **3/3** actual Chromium workflows: English, Traditional Chinese and Japanese;
  source-window review and offline disclosure,375/720/1280px overflow checks,
  keyboard controls and scoped WCAG2/2.1AA axe. Synthetic screenshots were
  inspected. No Create request or original/project-file mutation occurs.
- TypeScript/Vue, ESLint and i18n2647 semantic keys pass at this checkpoint;
  final branch-wide gates and independent review remain Task4.
- Browser validation found nested-select label text prevented an exact native
  label lookup. The original failing browser trace and a failing unit assertion
  were retained; separate explicit labels now pass both without selector or
  assertion weakening.

The isolated browser harness uses a separate Vite port and ephemeral backend,
so it cannot interfere with D6A's full browser fixture. Its first launch had an
incorrect scratch-config working directory; that setup failure is not a passed
test. New production code does not change host/origin/native-session guards.

## Decisions and correctness gates

Unknown metadata/opaque graph clocks retain full originals until a typed mapping
exists. This may reduce consolidation opportunities, while avoiding timestamp
fiction or loss of immutable evidence. Cache rows follow the existing portability
policy; no second snapshot, scheduler or timeline is introduced.

**Not implemented:** derivative generation, piecewise original→derivative clock
receipts, manifest-v2 execution/publication, compacted package reopen and actual
original-baseline decoded picture/audio/time parity. Offline-quality acceptance
and finishing-output disclosure must also be complete before enabling that mode.
The D6B parent task and those execution checkboxes stay unchecked. This review
cannot authorize a package, certify render parity, or replace manual workstation
and large-drive/NLE evidence.
