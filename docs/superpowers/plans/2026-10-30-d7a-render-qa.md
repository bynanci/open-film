# D7A reproducible render QA implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Independent review is coordinated by the parent; do not spawn additional agents from this worktree.

**Goal:** Produce bounded Linux/Windows/macOS decoded render evidence using verified test fonts/tools, unchanged quantitative thresholds and deliberate failures.

**Architecture:** One text provenance record and setup helper replace duplicate Windows staging; an explicit four-face font root feeds test-only helpers. A pure metric policy serves existing assertions and a separate focused actual-media suite. A strict report aggregate supplements the unchanged full Verify/browser/native gates.

**Tech Stack:** Existing TypeScript, Node24.14+, pnpm11.11.0, Vitest5.0.3, FFmpeg/FFprobe, GitHub Actions; no new runtime dependency.

**Spec:** [D7A design](../specs/2026-10-30-d7a-render-qa-design.md).

## Global constraints

- Proposed plan only; parent reviews design before implementation. Keep stable0.4.0 and project schema1.0.0.
- Preserve every existing threshold, comparator, unit and full Verify/browser/native gate; no new skip, retries, assertion weakening or continue-on-error.
- Reuse existing Windows9/Noto pins through one setup implementation and text manifest. No executable, font, archive or media commits/uploads.
- Explicit hosts: ubuntu-24.04/x64; windows-2022/x64; macos-15/arm64. Check actual identity; no macos-14 or latest-label assumption.
- Use source/tool hashes for identity and decoded observations for correctness; no cross-OS encoded-byte equality.
- D7B remediation, product contracts, runtime sidecars, signing and physical workstation gates remain separate.
- Setup in this docs-only turn is unnecessary. Implementation installs frozen dependencies only when needed; no unrelated tooling upgrades.

## Review focus

- A changed root alias/symlink or substituted font must fail before rendering; no system-font fallback (Task1).
- Tool metadata can drift between fetch/install or omit an expected architecture; admission must reject it, not self-approve observed bytes (Task1).
- A refactor can accidentally turn < into <= or merge amplitude/ratio/precision rules; compare all boundary semantics (Task2).
- A shifted pulse or corrupt decoded frame must actually trip the valid control's metric, including AAC onset versus steady state (Task3).
- Missing/duplicated/stale/failing OS reports must not produce a green aggregate or replace existing full gates (Task4).

---

## Task1 — Shared provenance and explicit fixture fonts

**Files:** create `fixtures/render-qa/toolchain.json`, `scripts/ci/setup-render-qa.ts`,
`tests/helpers/render-qa-fonts.ts`, `tests/unit/render-qa-tools.test.ts`,
`tests/unit/render-qa-fonts.test.ts`; modify `.github/workflows/windows-media-recovery.yml`.

**Interfaces:**

- `setupRenderQa(options: {root: string; platform: NodeJS.Platform; architecture: string; mode: "fonts-only"|"hosted-tools"}): Promise<RenderQaToolReceipt>`; no manifest/hash/project URL override.
- `readPinnedTestFonts(root?: string): Promise<Readonly<Record<PinnedTestFontKey,PinnedTestFont>>>` exactly as the design. Requires an explicit argument or `OPENFILM_TEST_FONT_ROOT`.
- `RenderQaToolReceipt` contains admitted source/package hashes, actual executable versions/hashes, OS/arch and actual package dependency identities. Export env paths only after admission; paths stay local.
- Setup exports `OPENFILM_TEST_FONT_ROOT`, verified sansRegular `OPENFILM_TITLE_FONT`, and the selected tool bin on PATH. Windows recovery retains four fonts under WINDIR/Fonts for its existing path assertions.

- [ ] Write negative tests for missing/relative font root, symlinked root/file, changed font/OFL bytes, wrong host/arch, wrong archive hash, duplicate executable matches, unsafe archive paths and metadata drift. The Windows contract test asserts all four original hashes, OFL and FFmpeg9 SHA survive extraction into the manifest.
- [ ] Run only `pnpm exec vitest run tests/unit/render-qa-tools.test.ts tests/unit/render-qa-fonts.test.ts`; observe failures before helpers exist.
- [ ] Implement bounded trusted-origin acquisition and regular-file/hash admission. Move the Windows recipe into the helper and replace its inline download list with a single call. Preserve Git Perl setup, candidate identity, actual tool logs and existing recovery tests/browser commands.
- [ ] Add the exact Ubuntu package and Homebrew9.0.2_1 source/formula/bottle pins from the design. Check package metadata before/after installation; require both ffmpeg/ffprobe and actual architecture. Derive Homebrew paths from the tool; no hardcoded prefix.
- [ ] Exercise the Homebrew fetch/hash/install sequence on actual macos-15 ARM64 through the future focused job. Until this runs, retain a documented unresolved admission result; no successful Mac claim or silent fallback. Do not execute a fetched Ruby formula outside trusted Homebrew handling.
- [ ] Run the two unit files, existing Windows workflow contract regressions where present, lint/types/format for changed sources. Record exact commands/results.
- [ ] Commit this independently reviewable setup/helper change.

## Task2 — Metric policy without semantic changes

**Files:** create `tests/helpers/render-qa-policy.ts`, `tests/unit/render-qa-policy.test.ts`;
modify metric call sites in `packages/render/tests/{photo-depth,film-looks,professional-cut-desk,native-title-controls,audio-quality,photo-quality}.test.ts`
and `scripts/photo-film-quality.ts` only where the design inventories a rule.

**Interfaces:**

- Immutable `renderQaPolicy` uses the design's metric IDs, units, exact op/limit or precision and policyVersion1.
- `assertRenderQaMetric(id: RenderQaMetricId, actual: number, expected?: number, context?: {frameRate?: number}): RenderQaMeasurement` throws for failed/invalid input and returns `{id,unit,rule,actual,expected?,passed:true}` for a pass. Only photoFilm.durationError requires the finite positive frameRate context and records its effective `1/frameRate+0.001` bound; no arbitrary threshold override.
- Dedicated `assertRenderQaIdentity(kind: "sourceHash"|"fontHash"|"decodedLossless"|"frameCount",actual: string|number|Uint8Array,expected: string|number|Uint8Array)` requires lowercase64-hex hashes, positive integer frame counts or nonempty equal byte arrays according to kind, and returns a path-free measurement; no coercion. Encoded MP4 hashes are excluded.
- A pure policy comparison has no subprocess/environment/network dependency. Preserve exact Vitest5.0.3 closeTo semantics by characterization against the pinned matcher.

- [ ] Add boundary tests for every rule: just inside, exact boundary and just outside; <=8 and <=3 accept their boundary, <12/<0.006/<0.004/<0.003 reject theirs, and >0.9 rejects 0.9.
- [ ] Characterize precision0/1/3/6 against existing Vitest closeTo; test missing expected, invalid/zero frameRate, NaN/Infinity and mistyped/empty identities fail rather than pass. Bounded measurement helpers reject empty samples, zero divisors and dimension mismatches before computing a metric. Pin photo.tightDuration separately from photo.duration.
- [ ] Run `pnpm exec vitest run tests/unit/render-qa-policy.test.ts` and observe initial missing-policy failure.
- [ ] Implement policy/identity helpers and replace only inventoried literal assertion calls. Keep hand-derived expected data, sampling, sample counts, image/audio decoding and every unlisted assertion unchanged. Retain strict photoDepth MAE<12 despite its old evidence label saying maximum12.
- [ ] Run the pure policy test, then the six affected existing render files with one worker using available documented tools. If real tools/fonts are unavailable, record that gate as not-run and use the hosted lane; do not skip cases or invent a positive result.
- [ ] Commit policy and unchanged-threshold migration, with a before/after assertion inventory in the validation record.

## Task3 — Focused real-output controls and receipts

**Files:** create `vitest.render-qa.config.ts`, `tests/render-qa/render-qa.spec.ts`,
`tests/helpers/render-qa-evidence.ts`, `tests/unit/render-qa-evidence.test.ts`;
reuse `tests/fixtures/professional-cut-desk.ts`; add explicit `test:render-qa` script.

**Interfaces:**

- Config includes exactly `tests/render-qa/**/*.spec.ts`, inherits root aliases/timeouts, maxWorkers1. Existing root Vitest/full media file ownership is unchanged.
- `RenderQaEvidence` v1 follows the design: candidate/current run/attempt, platform/arch/image, admitted tool and font hashes, policy hash/version, source/output hashes, decoded format/sample positions, required metric/control IDs, outcomes, workstationVerified:false.
- `writeRenderQaEvidence(root: string, evidence: RenderQaEvidence): Promise<void>` writes bounded path-free JSON/text atomically and never copies fonts/executables/media. Required environment names: `OPENFILM_TEST_FONT_ROOT`, `OPENFILM_RENDER_QA_OUTPUT`, source SHA/current run identity supplied by CI.
- D5B consumes `readPinnedTestFonts` and maps `fontPathForStyle` to the verified faces. Do not add a second title contract or resolver.

- [ ] Add report unit failures for private paths, invalid/missing measurements, duplicated IDs and a claimed successful negative control without observed assertion failure.
- [ ] Add the six-second actual renderer control using existing 30000/1001 hand-derived PTS, RGB samples and 48kHz integer-cycle pulse measurements. Assert unchanged <0.006/<0.004/<0.003 and onset>90% rules; retain exact180-frame count and source hashes.
- [ ] Add four explicit-font CJK/Latin raster/identity controls and a representative PhotoDepth decoded comparison using the strict<12 and <=8 rules. Reuse production rendering; expected samples are independently authored.
- [ ] Initially demonstrate failure from one-frame shifted pulse/PTS and re-encoded pixel corruption. Add gain/absent-tone contamination, substituted font/source bytes, missing/wrong frame count and changed lossless decoded bytes. Catch only the expected metric failure, recording its stable rule/control ID; unexpected process errors fail the suite.
- [ ] Run `pnpm exec vitest run tests/unit/render-qa-evidence.test.ts`; run `pnpm test:render-qa` after verified tool/font staging. A valid control must pass before each corresponding negative control is accepted as evidence.
- [ ] Inspect receipts for exact source/font/tool/output hashes and numeric decoded evidence. Confirm no encoded cross-OS comparison, local paths, media or binary files are uploaded. Remove ephemeral generated media in finally cleanup while retaining text failure receipts.
- [ ] Commit focused suite and receipts.

## Task4 — Three-OS evidence without weakening required coverage

**Files:** create `.github/workflows/render-qa.yml`, `scripts/ci/check-render-qa-results.ts`,
`tests/unit/ci-render-qa.test.ts`, `docs/validation-render-qa.md` and English mirror;
modify `package.json`, `TASKS.md` and `ROADMAP.md` only to report actual completed scope.

**Interfaces:**

- Matrix entries are exactly linux-x64/ubuntu-24.04, win32-x64/windows-2022, darwin-arm64/macos-15. All run on PR/push and manual dispatch with fail-fast false. Checkout and report PR head SHA or otherwise github.sha, and compare actual HEAD with that candidate.
- `validateRenderQaResults(reports: unknown[], expected: {candidateSha: string; runId: string; runAttempt: string; platforms: string[]}): void` requires one report for each expected platform, current identity, complete required metrics/controls and successful prerequisites. Missing/extra/duplicate/stale/failed/skipped reports throw.
- `render-qa-complete` is always evaluated and depends on every platform job. It cannot be satisfied by a subset or text receipts from another run. Existing Verify and Windows recovery checks remain independently required.

- [ ] Write failing workflow/validator tests for every missing/duplicate/stale/platform/attempt/control failure, any skipped/cancelled prerequisite, absent candidate binding and changed full Verify/browser commands.
- [ ] Run `pnpm exec vitest run tests/unit/ci-render-qa.test.ts` and observe failures before workflow/validator exist.
- [ ] Implement setup→frozen install→one-worker focused suite→bounded text-only artifacts in each job. Do not add automatic threshold refresh, retry-to-green or continue-on-error. Download reports only from the current run for the aggregate.
- [ ] Run changed-source lint/type/format and the focused unit files. Discover the existing full Vitest/browser inventory to show coverage unchanged; complete the normal full gates at final integration under parent coordination, not by deleting prior cases.
- [ ] Run actual hosted focused jobs after parent authorizes that implementation stage. Resolve any Mac admission or unchanged-threshold failure before claiming OS evidence. Keep failed/unfinished gates explicit.
- [ ] Obtain independent whole-branch review through parent, apply regression-backed findings and retain exact-head reports. Record observed automated results separately from physical workstation/native/Resolve/4K/GPU gates. No version bump or release action belongs to this task.
- [ ] Commit final docs and hand off for parent integration; no push/PR/merge is authorized by this plan-writing task.

## Current design blockers and implementation decisions

The published Homebrew bottle and Ubuntu archive metadata are verified source
facts; their installation/capability behavior on the selected hosted images is
not tested here. If either fixed package cannot be admitted, the affected job is
blocked until a reviewed pin/recipe update. Do not broaden this slice into a new
FFmpeg source-build system or substitute an unreviewed latest binary. No existing
Windows121+13, Linux23Rust+2archive or Pages result is counted as a D7A matrix run.
