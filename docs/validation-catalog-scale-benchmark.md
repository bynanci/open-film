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
