# Media intelligence candidate validation — 2026-11-04

## 結論 / Decision

本輪已完成來源綁定的低能量分析、持久審閱提案與明確套用，以及 11 個工具的
整合盤點。最終聚焦回歸 89/89、契約測試 1,479/1,479、lint、typecheck、build
及文件 build 通過。**整體媒體驗收仍未全綠，候選應維持草稿狀態。**
本文件不把既有主線 CI、局部測試或 Linux build 當成新候選的跨平台發行證據。

Base: `c068b8fdf2a09832443db892770b22ad3e5a36e6`.
Candidate branch: `codex/media-intelligence-20261104`.
Environment: Linux x86_64; Node.js 24.22.1; pnpm 11.25.0; FFmpeg/FFprobe
6.1.1-3ubuntu5. The repository declares pnpm 11.11.0; its frozen lockfiles were
not changed. No external model or optional Python/GPU runtime was installed.

See the [integration reference](media-intelligence-integrations.md) and
[ADR 012](adr/012-reviewed-media-intelligence.md) for the implemented contract,
upstream evidence, and deferred scope.

## What was verified

| Check                                                  | Result                                          | Meaning                                                                                                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused final regression, nine files                   | 89 passed                                       | New detector, core/solver, application review, CLI, original transcript ripple and the latest batch/rhythm fixes.                                                                      |
| `pnpm test:contracts`                                  | 76 files, 1,479 passed                          | Final portable contract/solver suite. Counts overlap the focused run; do not add them together.                                                                                        |
| `pnpm lint`                                            | Passed                                          | No warnings permitted.                                                                                                                                                                 |
| `pnpm typecheck`                                       | Passed                                          | Root TypeScript and desktop Vue type checking.                                                                                                                                         |
| `pnpm build`                                           | Passed                                          | Production CLI/server/desktop build; existing large-bundle warnings remain.                                                                                                            |
| `npm --prefix docs run build`                          | Passed                                          | Navigation, links, and static reference pages build.                                                                                                                                   |
| `pnpm test:docs-i18n`                                  | Passed                                          | Reference mirrors are byte-identical; translation policy was not weakened.                                                                                                             |
| Changed-file Prettier and `git diff --check`           | Passed                                          | Formatting and whitespace.                                                                                                                                                             |
| `node --import tsx scripts/ci/check-test-partition.ts` | Passed: 439 total, 76 contract, 363 media files | The normal `tsx` CLI wrapper could not create its temporary IPC socket in this environment; the same checker ran directly through the loader. No policy or test partition was changed. |
| `pnpm test:license`                                    | Passed                                          | Existing Apache-2.0 governance checks; this is not a blanket license approval for optional providers.                                                                                  |

The final focused command was:

```bash
pnpm exec vitest run \
  packages/media/tests/audio-activity.test.ts \
  packages/application/tests/silence-review.test.ts \
  tests/integration/silence-cli.test.ts \
  packages/core/tests/audio-activity.test.ts \
  packages/core/tests/transcript-ripple.test.ts \
  packages/solver/tests/silence-editing.test.ts \
  packages/application/tests/transcript-ripple-editor.test.ts \
  tests/integration/rhythm-integrity.test.ts \
  packages/application/tests/cut-desk-phase-2-3-persistence.test.ts \
  --maxWorkers=2
```

### Detector evidence

Generated fixtures exercise leading/internal/partial trailing silence, delayed
audio, source-clock packet gaps, threshold and minimum-duration changes,
opposite-phase stereo, one audible channel, and an audible 8 kHz tone. They also
exercise cancellation and explicit rejection of sources with no audio.
Original bytes are hashed before and after processing.

Independent review found that a three-second MKV with `-output_ts_offset 10`
can report `format.start_time=10` and `format.duration=13`. Treating the latter
as normalized source length invented ten seconds of silence. The final detector
rejects nonzero container starts with 422, and a generated regression covers
this case. It does not guess a universal `duration - start_time` correction.

### Review, editing, and persistence evidence

- Source snapshots and actual SHA-256 verification, including a source replaced
  after analysis starts, same-size replacement with restored modification time,
  and changes immediately before project publication.
- Immutable bounded review records, failed publication cleanup/retry, successful
  reopening of a review in a new application session, and unchanged project
  state after rejected/tampered/stale requests.
- Generic editor and flat-batch enforcement, rejection of mixed transactions,
  nested batches, and zero-cut proposals.
- Trim/speed/repeated-instance mapping, padding, locked/pinned source and clip
  protection, and explicit rejection of affected independent audio timing.
- Multiple cuts in one clip with unique split IDs, preservation of transcript
  no-op behavior, and the existing ripple path for supported dependent content.
- Session-local undo/redo and persisted final Composition after reopening.
- A real CLI round trip across separate processes: JSON preview, rejection
  without `--confirm`, tamper rejection, accepted application, stale replay
  rejection, and reopened result. A five-second fixture with two one-second
  pauses and 0.12-second padding becomes 3.48 seconds with three retained clips.

## Full-media run: not a passing gate

One broad `pnpm test:media` run reported **331 files passed / 32 failed**,
**4,149 tests passed / 95 failed / 44 skipped**, plus **3 unhandled errors**,
in 700.29 seconds. That run started before the final zero-cut editor guard was
added. Its zero-cut regression was subsequently fixed and is included in the
passing final focused run. Therefore these broad numbers do not certify the
final candidate, and no final full-media pass is claimed.

Many failures concern CJK/title rendering, missing font fixtures, or Linux
process observation. To avoid assuming that every failure is environmental,
only three representative cases were checked on a separate, unchanged detached
`c068b8f` worktree with the same frozen dependencies:

| Baseline case                                                         | Reproduced failure                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graphic-scenes.test.ts`, `fits long Latin`                           | `The title font returned invalid glyph measurements.` at `packages/render/src/titles.ts:545`.                                                                              |
| `native-runtime.test.ts`, `inventories the actual loaded host Koffi`  | Fixture fails at `realpath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')` with ENOENT before entering Koffi inventory. This is not evidence of a Koffi defect. |
| `native-benchmark-runner.test.ts`, `runs real child process protocol` | `An owned process was missing during memory sampling`; expected `app-exited`, received `failed`.                                                                           |

Those baseline files, their implementation dependencies, and the lockfile were
byte-identical to the candidate. Baseline git status remained clean.
`fc-list :lang=zh` found no Chinese font; the expected Noto fixture does not
exist. The deeper glyph-measurement and process-sampling causes were not proved
by this bounded comparison. The remaining broad failures were not individually
attributed. Do not describe all 95 failures as proven unrelated regressions.

Required follow-up: run the final candidate in the project's configured CI
environment with the required font fixtures and supported process observation.
Keep its results separate from the already-green baseline workflows.

## Scope still open

- Silence HTTP API, desktop review UI, durable background jobs, and restart/resume.
- A reliable normalized clock for containers with nonzero starts.
- Ripple support for independently authored audio sample ranges and a selectable
  multi-stream audio policy.
- Optional upstream tool adapters, model installation, quality comparisons, and
  artifact-specific code/weight rights checks.
- Windows/macOS execution, native installer verification, real-camera files,
  external NLE imports, GPU quality/performance, and physical workstation QA.

The source media remains immutable. This candidate makes no claim that all
eleven referenced projects are installed, integrated, or production validated.
