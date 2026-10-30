# CI contract and media separation evidence

Date:2026-10-30. Base:`608377ae3877935db1f8c16616360008cf146801`
(D6B PR65); branch:`codex/ci-contract-media-gates`. Source implementation is
complete; independent review and full exact-head gates are pending.

## Gate ownership

| Job                    | Commands and evidence                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast-contract-check`  | Existing format, i18n, docs locales, lint, TypeScript/Vue; exact discovery partition; pure core/solver/story/metadata/events tests. No media tool installation or decode.                       |
| `heavy-media-qa`       | Every remaining root Vitest test, build, synthetic actual-FFmpeg artifact, official OTIO interchange and portable QA, built CLI smoke, unchanged complete Chromium suite and failure artifacts. |
| `typescript-and-media` | Existing required-check name, always evaluated after both new jobs. Only two literal success results pass; failure/cancellation/skips/missing results fail.                                     |
| `native-shell`         | Existing Linux Rust/Tauri/archive/build job unchanged. No new workstation claim.                                                                                                                |

Both lanes run for all pushes and pull requests. New/unclassified tests default
heavy. The two configs preserve root resolution aliases, include/exclude baseline,
timeouts, fixtures and worker bounds. Actual file discovery must partition root
coverage exactly, without omission/overlap/duplicate/empty lanes. Root
`pnpm test`, `pnpm verify`, `test:unit` and `test:integration` semantics remain
unchanged. Existing `test:unit` includes subprocess/native/source-adapter tests;
it is not mislabeled as a pure contract lane.

Media tests complete before browser server startup in the heavy job; local
native-benchmark tests and browser servers must also remain sequential across
worktrees. Separate hosted jobs use separate virtual machines. No path-based
bypass, continue-on-error, assertion retry, new test skip or tolerance change.

## Actual evidence

- Missing implementation RED:`/tmp/openfilm-ci-split-red.log`; after the partition
  owner existed, a separate meaningful workflow RED had13 passing/1 failing
  because the required two lanes were still absent.
- Initial partition/gate suite14/14 passed; final16/16 pass with additional nonempty omission/replacement cases. Gate process tests exercise
  all25 success/failure/cancelled/skipped/missing prerequisite combinations.
- Actual discovery initially322 root files =49 pure contracts +273 heavy, with
  exactly disjoint coverage; a new test file belongs to heavy automatically.
- Pure contract lane **49files/1124tests passed in5.64s**. This is local test
  duration, not a measured hosted-pipeline speedup.
- TypeScript/Vue, lint, build, format,2656i18n keys and10README/122doc mirrors
  pass. A deliberate denied `ffmpeg`/`ffprobe` command lookup also retains all
  1124 contract passes. Final discovery/regression counts, complete
  media/browser/native hosted evidence and exact final SHA are recorded after
  source freeze. No unrun gate is counted as passed.

No dependency, lockfile, project/catalog schema, runtime version, media source,
UI, editing command or licensing change. Stable release remainsv0.4.0. Linux
synthetic media and official parser roundtrip do not certify Windows/macOS native
installers, physical devices, audio/display quality, Resolve or4K/hardware QA.
