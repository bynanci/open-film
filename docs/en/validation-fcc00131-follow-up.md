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

Verification on current main,
`e3f94f9cda161a3f955275a1a77f5f13d2bf7834`, supersedes that historical state:

- [Verify 41955949925](https://github.com/bynanci/open-film/actions/runs/41955949925): passed.
- [Windows media recovery 41955950276](https://github.com/bynanci/open-film/actions/runs/41955950276): passed.
- [Render QA 41955950019](https://github.com/bynanci/open-film/actions/runs/41955950019): Linux, Windows, Darwin ARM64 and aggregate checks passed.

No unrelated code change was made for the historical runner cancellation. The
new candidate PR must still complete all GitHub checks on its exact head.

## Follow-up implementation

The same Catalog review found deep offset pages still scaled with their position.
A chronological keyset page was added without removing the legacy API and is
used by Desktop library browsing, photo/video pickers, HTTP and CLI. Measurements,
query plans, limits and reproduction instructions are in the
[Catalog scale benchmark](validation-catalog-scale-benchmark.md).

Remaining work: index literal substring name/tag search without changing its
semantics; bound/lazily load full-catalog photo picker memory; and evaluate
lazy-loading less-used Desktop workspaces. The current production build reports
a 1.72 MB minified main JavaScript chunk (508 KB gzip); browser navigation and
native cold-start measurements are needed before setting a code-splitting goal.
Synthetic Catalog numbers do not guarantee Desktop support for 100k assets,
real media or workstations.
