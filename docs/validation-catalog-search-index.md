# Catalog Literal Search Index Validation

Measured on 2026-11-05 at `10:55:41Z`, from candidate worktree based on
`272af117c90384a2f79e50df39b0fb2f3185c31e`. The measurement compares the
previous escaped `LIKE` plus `json_each` scan with the public
`ProjectCatalog.listAssets` search after adding a schema v7 FTS5 trigram index.

## Scope and method

Run `pnpm exec tsx scripts/benchmark-catalog-scale.ts [output.json]`. The script
creates synthetic catalogs with 10,000 and 100,000 video descriptors, checks
that old and indexed paths return identical ordered result pages, and measures
one warm-up plus five repetitions for a unique name substring and a selective
tag substring. It records query plans and measures v6-to-v7 migration after
dropping the v7 search artifacts from a copy of the generated database and
compacting the resulting v6 database with `VACUUM`. No source media is created
or decoded.

Environment: Windows 10.0.19045 x64, Node.js 24.14.0, SQLite 3.51.2, AMD Ryzen 5
2400G, 8 logical CPUs, 7.46 GB RAM. The name query matches one generated asset;
the tag query matches one 1,000-asset batch, with both paths returning the first
60 results in the same chronological order.

## Search results

Median milliseconds with observed minimum and maximum in brackets:

|  Assets |               Name scan |             Name FTS | Speedup |                Tag scan |              Tag FTS | Speedup |
| ------: | ----------------------: | -------------------: | ------: | ----------------------: | -------------------: | ------: |
|  10,000 |    34.50 [29.92, 36.05] |   9.99 [9.88, 13.47] |    3.5× |    33.77 [29.39, 34.84] |  10.01 [8.80, 11.22] |    3.4× |
| 100,000 | 339.28 [337.19, 386.41] | 30.82 [28.32, 34.94] |   11.0× | 328.53 [323.16, 343.66] | 13.77 [12.02, 14.80] |   23.9× |

SQLite reports `SCAN assets`, a correlated `json_each` lookup and a temporary
sort for the previous scan. The indexed plan reports `MULTI-INDEX OR`, trigram
virtual-table index scans for name and tag text, and primary-key row lookups.
The query rechecks escaped `LIKE` against the asset name and individual JSON
tags after fetching candidates. This preserves SQLite `LIKE` behavior and keeps
a match from spanning two adjacent tags.

The indexed branch is used for literal searches with at least three Unicode
code points and no backslash, `%`, `_` or NUL. Shorter and escaped searches use
the existing escaped `LIKE` path. Regression tests cover `%`/`_`, backslash,
two-codepoint CJK terms, tag boundaries, name updates, tag updates and query
plans.

## Migration and storage cost

Schema v7 adds a materialized tag-search field, an external-content FTS5 table
with the trigram tokenizer, and insert/update/delete triggers. Migration
backfills existing tags and rebuilds the index inside the catalog migration
transaction. Snapshot restore rebuilds the derived FTS rows; portable snapshot
projection updates the derived tag text; logical revisions and source clocks
exclude derived index contents.

|  Assets | Compact v6 database | Migrated v7 database |       Added bytes | Migration |
| ------: | ------------------: | -------------------: | ----------------: | --------: |
|  10,000 |             6.82 MB |              8.39 MB |  1.56 MB (+22.9%) |    228 ms |
| 100,000 |            65.60 MB |             82.07 MB | 16.47 MB (+25.1%) |    3.71 s |

These sizes compare the same generated assets after `VACUUM` on the v6 side and
after index construction on the v7 side. The increased database size and one-time
migration work are the measured costs of the search improvement.

## Reproducibility and limits

The generated fixture SHA-256 values were
`1aee6a1f4ba747be349110b9a0983b00673f547c8479cc38a269ee24876eeccb` (10,000)
and `84eb8bdf90026c544b2e6e339f448a421bd22a364ec71b59b70880ea48e7563e`
(100,000). The benchmark output SHA-256 was
`c5864b7c5ff4ff95c2c6352660338821668653e4908887967c1dd98731e50d87`. Source
hashes: benchmark script `5353dd6b0f294fe9bb6e4420247a8ecba78ab3b75d469feb7b0e068c5844e981`,
Catalog source `2edc2920dcd0c3e22c5a3f263b18c2a8d44a0ad7de6e83c1b012139ccb0f6f1c`,
and MediaAsset validator
`d0a19ea43dff6558fd13d5722c8da364168d0a925f2b0437df69bf4b4068e048`.

This synthetic Catalog run does not measure filesystem discovery, media
inspection, application startup or Desktop responsiveness. Short and escaped
queries retain the scan path, and timings are specific to this machine. It is
not an end-to-end 100,000-asset support claim or a latency guarantee.
