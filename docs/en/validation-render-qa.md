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
