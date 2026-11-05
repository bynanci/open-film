# Catalog Scale Performance Validation

Measured on 2026-11-04 against `main` at `c068b8fdf2a09832443db892770b22ad3e5a36e6`.
The latest source revision was fetched before measurement. The benchmark compares
the previous chronological-page SQL with `ProjectCatalog.listAssets` on the same
generated databases and the same process.

## Scope and method

Run `pnpm exec tsx scripts/benchmark-catalog-scale.ts [output.json]`. The script
creates temporary SQLite catalogs with 10,000 and 100,000 generated video
descriptors. About 1% have no capture timestamp. It seeds each catalog in one
transaction, then measures a warm-up and five repetitions for the first, middle
and last chronological 60-row pages, name and tag search, ID lookup, row count,
and a full paged summary scan. Page results and scan counts are checked against
the generated records. The script records source hashes, SQLite query plans,
seed time, database size and unforced process-memory samples. It creates and
decodes no media files; temporary catalogs are removed when it exits.

Environment: Windows 10.0.19045 x64, Node.js 24.14.0, SQLite 3.51.2, AMD Ryzen 5
2400G, 8 logical CPUs, 7.46 GB RAM. The 100,000-row database was 67,235,840 bytes.

## Chronological page results

Median milliseconds, five measured repetitions per case. The previous and
optimized paths used the same fixture and asserted identical asset IDs.

|  Assets | Page   | Previous SQL | Indexed path | Approx. speedup |
| ------: | ------ | -----------: | -----------: | --------------: |
|  10,000 | First  |         6.77 |         0.32 |             21× |
|  10,000 | Middle |        19.52 |         0.87 |             23× |
|  10,000 | Last   |        34.79 |         0.38 |             91× |
| 100,000 | First  |        75.77 |         0.32 |            233× |
| 100,000 | Middle |       253.00 |        14.07 |             18× |
| 100,000 | Last   |       444.42 |         8.99 |             49× |

At 100,000 assets, the unchanged name search median was 326.57 ms, tag search
320.16 ms, point lookup 0.041 ms, full summary scan 1,170.51 ms, and transactional
seed 10,805.28 ms. At 10,000 assets, name and tag search medians were 32.23 ms and
30.85 ms. Search still scans the generated catalog; nonzero page offsets still
advance through indexed rows. These measurements identify follow-up work for
search indexing and cursor pagination.

## Query-plan evidence

The previous chronological query reported `SCAN assets` and `USE TEMP B-TREE FOR
ORDER BY`. The optimized path reads dated and undated ranges separately while
preserving the existing null-last chronological order. A read transaction keeps
the count and both ranges on one SQLite snapshot. SQLite reports `assets_capture`
index searches for the dated count, dated page and undated page. No catalog
schema migration was needed.

## Keyset cursor follow-up

Re-measured on the rebased candidate after the latest main changes, comparing
the indexed `OFFSET` path and chronological keyset path against the same
generated fixtures. Environment: Linux x64, Node.js 24.19.0, SQLite 3.53.3, AMD EPYC
9V45 (5 logical CPUs exposed to the process). Each case has one warm-up and five
measured runs; the table gives the median and observed range in milliseconds.
Both paths asserted the exact same 60 asset IDs. Cursor measurements start from
a known preceding-row cursor and measure one page request; they do not measure
the total time to traverse every page sequentially.

|  Assets | Page   | Indexed `OFFSET` median [min, max] | Keyset median [min, max] | Ratio |
| ------: | ------ | ---------------------------------: | -----------------------: | ----: |
|  10,000 | First  |               0.098 [0.085, 0.103] |     0.100 [0.087, 0.166] |  1.0× |
|  10,000 | Middle |               0.246 [0.214, 0.329] |     0.157 [0.096, 0.240] |  1.6× |
|  10,000 | Last   |               0.145 [0.139, 0.182] |     0.092 [0.091, 0.111] |  1.6× |
| 100,000 | First  |               0.114 [0.090, 0.148] |     0.108 [0.088, 0.126] |  1.1× |
| 100,000 | Middle |               2.389 [2.024, 2.589] |     0.135 [0.097, 0.187] | 17.7× |
| 100,000 | Last   |               1.322 [1.168, 1.594] |     0.098 [0.095, 0.156] | 13.5× |

First-page results are effectively equivalent within the observed ranges.
Deep middle and last pages were 17.7× and 13.5× faster than the current
indexed-offset path in this synthetic 100,000-row workload. `EXPLAIN QUERY PLAN` reports a composite
`assets_capture` range seek on `(captured_at,id)` for dated cursors, and an
`assets_capture` seek on `(captured_at,id)` for null-date cursors. The page API
reads each individual page in one SQLite read snapshot, preserves equal-time and
null-last ordering, validates cursor version/shape, and adds no schema
migration. Existing offset-based APIs remain available.

Desktop browsing, the lazily paged PhotoDepth and Photo Relationship pickers,
and the Motion video picker use the cursor path. The two photo pickers request
one page of at most 200 rows at a time and preserve only selected dependencies
when navigating. On a synthetic 10,000-image component fixture, opening each
picker requests 200 rows in one call instead of traversing 50 pages; focused
regressions verify selection retention and bounded options. These tests count
API rows and rendered options; they do not measure RSS, real media, or the
existing parent Editor document asset pool. The cursor does not pin a snapshot
across separate HTTP requests: catalog edits between pages can change later
results, as with ordinary live pagination. At 100,000 rows, substring name and
tag searches remain full-catalog scans; this run measured 62.71 ms and 61.84 ms
medians respectively. Search indexing remains explicit follow-up work.

The exact-source rerun was measured at `2026-11-05T09:30:46.267Z` on clean commit
`2dfb8298c1ddda027334c14275f3e4edbb255928`, after rebasing on main
`4de4ec5965f3c0bce01f074b2a354721e4fa771d`. Its 10,000-row fixture SHA-256 is
`1aee6a1f4ba747be349110b9a0983b00673f547c8479cc38a269ee24876eeccb`; the
100,000-row fixture SHA-256 is
`84eb8bdf90026c544b2e6e339f448a421bd22a364ec71b59b70880ea48e7563e`. The
benchmark script SHA-256 is
`42ad2add42aa453611a624ead6bc66b5184d4809355d367b5dd738873d34ccd0`, the
Catalog source SHA-256 is
`45e8ba4a09ad8a6f9d640eee7c18ef59e3b9df29c339646816867acac2af850f`, and the
MediaAsset validation source SHA-256 is
`d0a19ea43dff6558fd13d5722c8da364168d0a925f2b0437df69bf4b4068e048`. The
captured JSON output SHA-256 is
`5e71dc78c4c6c028e1c7b0b6d1fb0ca97e62974eed1679a273d7511bb190ae6a`.

This is a synthetic Catalog measurement, not end-to-end Desktop evidence at
100,000 assets or a latency guarantee. The browser regression uses 121 generated
assets to verify that the Desktop next-page action sends a cursor and loads a
different page.

## Reproducibility and limits

The output records five raw samples per read, fixture SHA-256 values and hashes
for the benchmark, Catalog implementation and MediaAsset validator. This run was
measured at 2026-11-04T15:44:56.818Z. Its 10,000-row fixture SHA-256 was
`1aee6a1f4ba747be349110b9a0983b00673f547c8479cc38a269ee24876eeccb` and its
100,000-row fixture SHA-256 was
`84eb8bdf90026c544b2e6e339f448a421bd22a364ec71b59b70880ea48e7563e`. The
benchmark script SHA-256 was
`469c8106aa1eb358fc608d52446165231137086726162328129aa8e2f637d55e`, the Catalog
source SHA-256 was
`a7e8ab9b8b4d8694414f1b91345949db841cf2ea9c85325d289c16bd62d37808`, and the
validator SHA-256 was
`1c0a5f4a868be0cf44299874a1eaec0d707f49f70559372400de7431173d3328`.

This is synthetic Catalog evidence for the operations listed above. It does not
measure filesystem discovery, media hashing or inspection, proxies, analysis,
rendering, desktop responsiveness, native installation, long-session memory or
real camera files. It does not establish end-to-end support at 10,000–100,000
assets or a latency guarantee. Do not infer those claims from these results.
