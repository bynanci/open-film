# fcc00131 CI and Catalog Performance Follow-up

## GitHub check review

Reviewed commit: [`fcc00131c2f2d90d9dd20952dad192a65cceaa31`](https://github.com/bynanci/open-film/commit/fcc00131c2f2d90d9dd20952dad192a65cceaa31).

| Check                  | Result           | Evidence                                                                         |
| ---------------------- | ---------------- | -------------------------------------------------------------------------------- |
| Verify                 | Passed           | [Run 41862664516](https://github.com/bynanci/open-film/actions/runs/41862664516) |
| Deploy website         | Passed           | [Run 41862664514](https://github.com/bynanci/open-film/actions/runs/41862664514) |
| Windows media recovery | Passed           | [Run 41862664585](https://github.com/bynanci/open-film/actions/runs/41862664585) |
| Render QA              | Aggregate failed | [Run 41862664517](https://github.com/bynanci/open-film/actions/runs/41862664517) |

Linux x64 and Windows x64 Render QA jobs passed. The only missing report was
Darwin ARM64: that job was marked `cancelled` before a runner was assigned, ran
no steps and produced no report. The [aggregate job](https://github.com/bynanci/open-film/actions/runs/41862664517/job/126695954684)
failed because the three-platform report set was incomplete. This was not an
FFmpeg decode or rendered-frame assertion failure.

A full rerun regenerated all platform reports. [Attempt 3](https://github.com/bynanci/open-film/actions/runs/41862664517)
completed successfully at 2026-11-05 03:34 UTC: Linux x64, Windows x64,
Darwin ARM64, and the aggregate job all passed. This resolves the historical
cancellation check for that commit.

The PR was rebased onto its current main base,
`4de4ec5965f3c0bce01f074b2a354721e4fa771d`. That base's checks passed:

- [Verify 41996612357](https://github.com/bynanci/open-film/actions/runs/41996612357).
- [Windows media recovery 41996612234](https://github.com/bynanci/open-film/actions/runs/41996612234).
- [Render QA 41996612406](https://github.com/bynanci/open-film/actions/runs/41996612406): Linux, Windows, Darwin ARM64 and aggregate checks passed.
- [Website deploy check 41996612328](https://github.com/bynanci/open-film/actions/runs/41996612328).

No unrelated code change was made for the historical runner cancellation. The
new candidate PR must still complete all GitHub checks on its exact head.

## Follow-up implementation

The same Catalog review found deep offset pages still scaled with their position.
A chronological keyset page was added without removing the legacy API and is
used by Desktop library browsing, photo/video pickers, HTTP and CLI. Measurements,
query plans, limits and reproduction instructions are in the
[Catalog scale benchmark](validation-catalog-scale-benchmark.md).

## Lazy photo selector validation

The PhotoDepth and Photo Relationship pickers previously requested every
chronological page when opened. Their page size was 200, so a synthetic
10,000-image catalog required 50 sequential requests and materialized all 10,000
rows in each picker. Both now request one page on activation, expose previous /
next controls, and retain only the current page plus selected photo dependencies.
Changing pages preserves the selected mask, background and template photos.

The 10,000-image component regressions in `tests/unit/photo-depth-panel.test.ts`
and `tests/unit/graphic-scene-template-studio.test.ts` verify one initial request
and 200 returned rows (a 98% reduction in initial picker rows versus the full
scan). They also page forward and backward, verify that selections remain
available across pages, and cap rendered photo options at the current page plus
the selected entries. This is deterministic request/descriptor-count evidence,
not an RSS or real-workstation measurement. It does not make the existing
Editor document asset pool lazy; some story configurations still provide that
full pool to the parent workspace.

Remaining work: index literal substring name/tag search without changing its
semantics and measure lazy-loading less-used Desktop workspaces. The current
production build reports a 1.72 MB minified main JavaScript chunk (508 KB gzip);
browser navigation and native cold-start measurements are needed before setting
a code-splitting goal. Synthetic Catalog numbers do not guarantee Desktop
support at 100k assets, real media or across workstations.
