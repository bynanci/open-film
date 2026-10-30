# Reproducible render QA (D7A)

Date: 2026-10-30. Base: `e1255b1a8a83260149211d909cca8c1a50948c6b`.
Branch: `codex/v1-d7a-render-qa`. Source implementation and focused local evidence
are recorded below; three-OS hosted admission, independent final review and
complete exact-head merge gates remain pending. Stable version remains 0.4.0.

## Implemented contract

One [text provenance manifest](https://github.com/bynanci/open-film/blob/main/fixtures/render-qa/toolchain.json)
owns the existing Windows FFmpeg9/Noto pins, immutable Noto source commit and
complete OFL hash, plus reviewed Ubuntu package and macOS bottle metadata.
`scripts/ci/setup-render-qa.ts` is the shared acquisition entry point. Windows
recovery reuses it; its complete existing regression/browser selection remains.
Downloaded bytes are bounded and checked before extraction/installation. ZIP
paths, special files, case collisions and duplicate entries are rejected.

`OPENFILM_TEST_FONT_ROOT` names an explicit canonical absolute directory containing
four exact CJK TC Sans/Serif Regular/Bold OTFs and the full OFL. The helper hashes
all five files, rejects aliases/symlinks/extra or substituted files and performs
no system-font fallback. D5B accepted the `readPinnedTestFonts()` interface.
The pinned fonts are local test inputs; no font or executable is committed or
uploaded. The existing first-party license/NOTICE and third-party terms remain.

`render-qa-policy.ts` preserves separate units and comparators: PhotoDepth mean
RGB error is **<12**, edge/alpha errors **<=8**, film-look decoded error **<=3**,
its stricter lossless/black samples **<=1**, cut-desk channel error **<=12**,
primary amplitude error **<0.006**, overlay **<0.004**, absent tone **<0.003**.
Precision0/1/3/6 matches the pinned Vitest5.0.3 matcher. Original legacy onset
multiplication and peak-offset arithmetic are retained while their limits come
from the policy. Impossible negative absolute errors and RGB errors above 255 are
invalid measurements, not successful negative controls. The high-detail glyph
rule **<=8/255** has its own ID and does not alter standard-quality assertions.

The dedicated focused suite owns explicit tool/font prerequisites and is outside
the root test include patterns. Existing full tests stay in their original lanes.
It generates a six-second rational-rate H.264/AAC composition, independent PTS/RGB/
tone expectations, a lossless PCM diagnostic, PhotoDepth source/mask/background
and four real title rasters. It observes **117 distinct required samples** and
**10 named deliberate failures**, binding **17 actual output hashes** to their
logical identities. It never compares encoded MP4 hashes between operating systems.
Every `source.<id>` measurement's actual and expected hashes must match that
source's inventory digest. Source/font substitution failures must match their
encoded output receipt, with the original output-inventory and expected-baseline
joins preserved. Decoded-lossless hashes remain in their separate decoded-byte
domain; they are never equated with encoded output hashes.

## Observed local evidence

The actual local host is Debian 13 x64, Node 24.19.0, pnpm 11.19.0 and system
FFmpeg/FFprobe 7.1.5-0+deb13u1, with GPL/shared configuration. These are local
observations, not the proposed hosted pins or a native distribution review.
The receipt records `scope: local-observation`, its actual candidate/dirty state,
tool/configuration hashes and `workstationVerified: false`; it cannot pass the
hosted admission validator.

- Offline frozen installation reused 201 packages and downloaded 0.
- The actual four immutable Noto font downloads and OFL passed admission.
  Local direct Node fetch was refused by the workspace network configuration;
  `NODE_USE_ENV_PROXY=1` admitted the same pinned bytes through the existing proxy.
- Before extraction, the six existing renderer files passed **39/39** in 55.91s.
  The same files after policy extraction plus policy boundary cases passed
  **68/68** in 44.87s. Existing fixtures, samples and thresholds were retained.
- The source/acquisition/font/ZIP/bin unit cases and later report/CI cases have
  separate RED→GREEN logs in the ignored execution ledger. No full Vitest suite,
  native benchmark or browser/server run was executed in this worktree.
- The first actual suite detected seven intended output failures, then failed
  because Serif Regular at 28px contained no opaque flat 2×2 sample. Diagnostics
  found flat samples for all four faces at 48px; that fixture size was selected
  before examining encoded errors. The unchanged high-detail limit then passed
  with observed maximum channel errors **0/2/4/0** for Sans Regular/Bold and
  Serif Regular/Bold respectively. No threshold or output-dependent sample
  selection was introduced.
- Final targeted verification passed **13 files / 127 tests** in 121.41s,
  followed by the actual-output suite **1/1** in 8.09s. Project lint,
  TypeScript/Vue and formatting passed. Documentation validation reported 10
  README locale sets and 125 English reference mirrors. Actual test discovery
  partitioned 335 root files into 49 contract + 286 media files with exact,
  disjoint coverage; the new dedicated render suite has its separate owner.
- The final review's evidence consistency mutations first reproduced 11 accepted
  contradictions, then failed closed after the joins were added. Final focused
  verification passed **7 files / 122 tests**, including all seven source
  identities, substitution/aggregate mutations and synthetic macOS dependency
  observations. TypeScript/Vue, changed-file ESLint and formatting also passed.
  macOS command fixtures are synthetic and do not represent a macOS execution.
- The complete actual suite passed, including a repeat through
  `pnpm test:render-qa` in 9.85s. It retains every failed measurement's actual value,
  unit and comparator, and verifies that a matching valid sample passed first.

Representative actual failed observations:

| Deliberate change                                     | Observed failed value                 | Preserved acceptance    |
| ----------------------------------------------------- | ------------------------------------- | ----------------------- |
| One frame of decoded audio delay                      | Old tone amplitude 0.012461           | <0.003                  |
| Re-encoded half primary gain                          | Absolute amplitude error 0.026121     | <0.006                  |
| Re-encoded half overlay gain                          | Absolute amplitude error 0.016588     | <0.004                  |
| Added previously absent tone                          | Amplitude0.124482                     | <0.003                  |
| Re-encoded black video                                | Channel error 255                     | <=12                    |
| Dropped decoded frame                                 | 179 frames                            | Exactly 180             |
| Re-encoded black PhotoDepth output                    | Mean RGB error 86.014132              | <12                     |
| Font substitution/source mutation/lossless PNG change | Different actual hashes/decoded bytes | Exact matching identity |

The negative timing/audio/pixel cases use genuinely decodeable changed output.
A failed decoder, missing data, invalid units or a perturbation that stayed within
the limit cannot be counted as an observed negative. Temporary media and font
copies are removed even on failure. Only bounded, path-free numerical JSON remains.

## Hosted workflow and remaining gates

`Render QA` adds `ubuntu-24.04` x64, `windows-2022` x64 and `macos-15` ARM64,
with fail-fast disabled and no PR/push path bypass. Node 24.14.0, pnpm 11.11.0 and
frozen dependencies are selected. Linux receives an isolated FFmpeg/FFprobe bin
so its selected Node cannot be shadowed by prepending all of `/usr/bin`.
macOS 14 is being retired; the new job checks actual macOS 15 ARM64 identity.

The Ubuntu 6.1.1 package and Homebrew 9.0.2_1 ARM64 Sequoia bottle have fixed source
metadata/digests. **Their installation and execution on the selected hosted
images are not validated by local schema tests.** macOS must actually admit and
execute the pinned bottle on ARM64. Unavailable/changed packages or unsupported
Homebrew admission fail; there is no alternate-version or source-build fallback.
Shared library versions are recorded, not claimed to be a portable runtime closure.
The macOS setup now requires `brew info --json=v2` for FFmpeg and its declared
installed formula dependencies, plus `otool -L` for both selected executables.
It retains raw metadata/library observations and their hashes only in the local
setup root. Published receipts contain validated dependency names/versions,
observation digests and library counts, without local paths. Each command has a
30-second/256 KiB bound, with at most 64 dependencies and 4 MiB total observations.
Missing commands, malformed or changing inventories, and absent installed
metadata fail admission. Actual hosted macOS observation remains pending.

The always-evaluated `render-qa-complete` rejects missing, duplicated, stale,
failed, cancelled or skipped prerequisites/reports. It requires all three reports
from one candidate, run and attempt, current manifest/policy hashes, admitted versus
executed tool identity, every required sample/output/control and four exact fonts.
It recomputes positive and negative comparisons rather than trusting passed flags.
Artifacts contain only JSON, retained 7 days. To retry hosted admission, rerun the
whole workflow: mixing successful reports from earlier attempts is rejected.

The full Verify/browser/native workflow is unchanged; its merge gate remains
mandatory. This additional check is included in the coordinator's merge decision;
repository protection settings are not changed by this source PR. Existing hosted
Windows 121+13 and Linux 23 Rust+2 archive results are prior automated evidence, not a
completed D7A three-OS matrix run. Actual hosted run IDs and final review belong
to the candidate PR once available.

Physical Windows 10/popopc/macOS, Resolve/NLE finishing, private-film aesthetics,
real listening, 4K/GPU, display and long-session measurements remain open.
[Native installer requirements](native-installer.md) also remain separate:
audited runtime/sidecars, complete notice/SBOM closure, signing/notarization and
clean-machine install/upgrade/manual rollback/uninstall observations. The GLib
backport proposal is a separate D7B direction and has not changed dependencies,
advisory results or installer admission here.

## 2026-10-30 — complete finishing stack and separate three-OS selection

Merge `690997a` integrates reviewed C `dc3f7ae` and its fixed D8/A/B/latest
repaired documentation parents into reviewed D7A `6c4fac3`. The shared four-font
helper remains byte-identical to `11595f33`; the shared metric implementation
retains D7's reviewed diagnostic payload/domain checks. Rule definitions,
operators, limits, all 117 representative samples, 10 controls, 17 output IDs,
strict source/output/identity joins and current macOS dependency observations
are unchanged. The root Verify/browser/native gates and new contribution,
locale/governance and research files are preserved.

The coordinator approved a separate finishing selection after tool/font
admission: `photo-easing.test.ts`, `photo-ambient.test.ts`,
`bilingual-title-finishing.test.ts`, `primary-color.test.ts`, and
`photo-primary-local-look.test.ts` under `packages/render/tests/`. It supplements
the existing representatives and does not invent receipt metrics or widen limits.
The runner invokes installed Vitest with one worker, `--retry=0`,
`--allowOnly=false` and a raw JSON report. It rejects missing/duplicate/foreign
files, empty result lists, failed/pending/skipped/todo cases, contradictory
counters, failure details, stale timing and changed checkout/font/tool identity.
All five reviewed files execute actual media assertions without capability-return
bypasses. Raw reports/logs are bounded and retained locally; only a bounded
path-free summary is uploaded under a separate `finishing-qa` artifact name.
The existing aggregate retains its original three-report inventory and requires
full matrix success, including this additional step. No stdout count is a gate.

Source checkpoint `d336c78` passed the eight-file / 144-test focused QA batch,
including 22 finishing selection/workflow/report regressions. A permissive report
scaffold first failed 20 of those boundaries; the complete implementation passes
all cases. Current TypeScript/Vue, scoped ESLint, repository formatting and 134
English documentation mirrors pass. An initial caught-error lint requirement was
corrected by preserving the underlying cause; bounded raw output stays local.

Actual clean local execution at `d336c78` passed `pnpm test:render-qa` with the
unchanged 117 measurements / 10 observed negative controls / 17 encoded hashes,
plus the new finishing runner with exactly five files / 19 passed cases, zero
failed/pending/todo results and all four verified faces. Both reports record
`workingTreeDirty=false`, `scope=local-observation` and
`workstationVerified=false`. Local tools remain Node24.19.0/pnpm11.19.0 and
FFmpeg/FFprobe7.1.5 on Linux x64. The new raw report SHA-256 is
`21653014fbdc2eaada997c023b37b27cc5423140ed08b17af9f0d8172c1c9666`.
Evidence is isolated under `/tmp/openfilm-finishing-integration/` in
`D7-core-clean-d336/` and `D7-finishing-clean-d336/`; earlier receipts retain
their original candidate identities. Actual Ubuntu/Windows/macOS admission,
execution and aggregation remain unrun until the parent publishes real CI.
No complete suite, native benchmark, hardware/NLE or release claim follows.

## 2026-10-30 — avoid duplicate feature-branch render matrices

The finishing integration retains every pull-request, main-push and explicit
manual Render QA run. A source regression reproduced one failure because the
new matrix also ran on every feature-branch push, duplicating the same PR's
three-OS work. Its push trigger now matches Verify's main-only push policy; no
file-path exclusions or required matrix jobs were introduced or removed.
The intended RED was 1 failed / 16 passed. Both changed gate suites then passed
39 tests / two files; scoped formatting and ESLint pass. Earlier exact-clean
2528118 media receipts remain identified by that checkpoint; this trigger-only
follow-up changes no renderer, metric, tool/font pin or media assertion. Actual
current-candidate hosted runs remain required before merge.

## 2026-10-30 — first actual macOS tool-admission result

PR78 head `29ac4010b37a057f705bc7adc0dd181a8f002b7d` started the actual
three-OS workflow41085354644. macOS job124164958496 failed before rendering:
Homebrew parsed the verified cache archive path passed to `brew install` as a
formula name. No macOS render, finishing or workstation result was produced.
The required missing-artifact failures remain visible; they are not ignored.

The install now names the already admitted `ffmpeg` formula with
`--force-bottle`. Formula/version/bottle metadata admission still occurs both
before and after installation; the cached bottle SHA is also checked again
after installation, and actual executable/configuration/dependency observations
remain mandatory. Auto-update remains disabled by the workflow. No version,
bottle/font hash or metric limit changed. A focused command regression failed
1/22 before the fix; the tool/aggregate/finishing suites then passed61tests in
three files. Scoped ESLint and formatting pass. Linux-only source tests do not
validate Homebrew execution: the next exact-head hosted macOS run must pass.

## 2026-10-30 — macOS observation fixtures on Windows

The first real Windows matrix job124164958041 failed one of123 acquisition
controls before rendering: the macOS observation helper used the host-native
path join on its explicitly macOS `/opt/homebrew` input, producing backslashes
inside the Windows-run fixture. The helper now joins this macOS-only executable
path with POSIX semantics. The existing exact otool argument assertions remain
unchanged, as do Linux staging and actual Windows tool paths. Both local tool
suites pass23tests; scoped ESLint and formatting pass. These Linux results do
not replace a fresh Windows matrix run or claim real macOS linkage execution.

## 2026-10-30 — actual matrix failure diagnostics

At head `5b1abaa1daf9d7a029ae40dac1e059149c61d849`, RenderQA41095794739
passes the actual pinned Linux core117measurements/10negative-controls/17outputs
and separate5files19finishing cases. Windows passes acquisition, unit controls
and its core output/decoded-negative-control step, but the independent finishing
child exits nonzero. Its raw JSON/log remain runner-local; the old runner threw
before writing a public summary, so the failed subcase cannot yet be identified.
The macOS runner is queued at this observation. No Windows finishing pass or
causal repair is inferred from the Linux result.

The diagnostic-only correction preserves the nonzero child/gate result and
original successful-report validator. A failed child now emits a separate
`openfilm.render-qa-finishing-failure` summary with `complete:false`, candidate/run/
platform identity, bounded raw-report hash, known repository test paths, assertion
indices, known failure categories and numeric comparisons/source coordinates.
Arbitrary names, messages, stacks and absolute/private paths stay local. Missing
or malformed JSON yields unavailable diagnostics and still fails. No failed
summary is accepted as all-passed evidence; no retry, assertion or metric changes.

Two missing-function RED cases became GREEN; current pure selection/CI tests
pass42cases/2files, root TypeScript, changed ESLint/format/diff checks pass.
ANSI Windows stack/private-text controls verify only fixed fields escape. Fresh
scoped review and a new actual matrix remain required. This correction improves
diagnosability; it does not fix the unidentified Windows finishing failure.
