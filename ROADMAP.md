# OpenFilm roadmap

OpenFilm helps people turn a collection of photos, video and audio into a story
and an editable film. Development focuses on a reliable local workflow, clear
editing decisions and portable projects.

This page describes the project direction. See [TASKS.md](TASKS.md) for current
work, the [incremental release train](docs/roadmap/incremental-release-train.md)
for separate product/version tracks, and [v1.0 readiness](docs/roadmap/v1-readiness.md)
for long-range release criteria.
Suggestions and contributions are welcome through [GitHub Issues](https://github.com/bynanci/open-film/issues)
and the [contributing guide](CONTRIBUTING.md).

## Release status

| Channel                                                            | Status                          | What to expect                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [v0.4.0](https://github.com/bynanci/open-film/releases/tag/v0.4.0) | Latest published source release | A tagged source checkout; see its release notes for the included features.                                            |
| `main`                                                             | Active development              | Additional features and fixes that have not been published in a stable release.                                       |
| Native installers                                                  | In progress                     | Packaging tools exist, but distributable installers still require platform, dependency and installation verification. |
| v1.0                                                               | Release goal                    | Published when the documented readiness criteria are met; the package version alone does not establish a release.     |

The proposed OpenFilm sequence is `v0.5.0` → `v0.6.0` → `v0.7.0` → `v0.8.0`,
with `v1.0.0` reserved for native distribution readiness. These are staged
planning labels, not release tags or frozen candidates. Storytelling has its
own version track. See the [release train](docs/roadmap/incremental-release-train.md)
and [current release gate audit](docs/validation-release-gates.md).

The historical release-status baseline was reconciled against main
[`08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224`](https://github.com/bynanci/open-film/commit/08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224)
on 2026-11-11. The GLib source fix in PR #128 is merged after independent
technical review and all 19 final-head checks. Draft PR
[#129](https://github.com/bynanci/open-film/pull/129) remains on the dedicated
historical `release/v0.5.0` track at `54534d8cf985203e8b5abbd09a771436f8fe09e5`.
Its own full CI, native source admission, three-platform Render QA and independent
adaptation review pass. The [prepared source/asset packet](docs/release-owner-review-v050.md)
awaits the release-owner decision; no tag or publication is approved. Installer
and physical workstation acceptance remain open. Latest published source release
remains **v0.4.0**; historical feature records retain their original evidence.

Planning PR #147, CI/profiling PR #148 and SDK PR #149 are merged. The
[issue execution record](docs/validation/issue-execution-2026-11-11.md) separates
the reviewed #149–#151 implementation slices, final-head gate records and
outstanding owner/platform acceptance; it does not label every slice merged.

Durable Jobs and Desktop Review are merged in PRs #107/#108. Rendered audition
is merged in PR #111. Physical workstation and listening acceptance remain
separate gates.

## Current focus

Use the [2026-11-11 issue plan](docs/roadmap/next-issues-2026-11-11.md) for the
next execution order and the complete unfinished-task classification. Prioritize
a bounded read-only SDK compatibility proof, measured CI costs and native
post-build evidence binding. Source-release ownership and physical acceptance
remain separate workstreams; no new NLE expansion is selected by this plan.

The [fixed-source media profile](docs/validation/media-test-profile.md) now records
real tool costs without changing the workload or claiming a product speedup.
[PR #148](https://github.com/bynanci/open-film/pull/148) binds CI to the actual
checkout and runs Windows recovery for every PR. The owner approved the fixed
main-ruleset proposal for activation after this validated PR round. Authorized
administrator execution, safe control cases and role attestations remain open;
this approval does not authorize release or native signing.

The [Issue #138 compatibility capsule](docs/validation/storytelling-compatibility-138.md)
now exercises the existing exporter against a pinned Storytelling SDK finite
profile. Local exporter/unit and actual-SDK application/CLI tests pass; protected
or unsupported fields are rejected without stripping, and original project,
Catalog and source bytes remain unchanged. The [PR #149 gate
record](https://github.com/bynanci/open-film/pull/149) tracks final-head verification.
This read-only consumer proof grants no production adapter, FilmCraft, source
verification or execution authority. Production M3-03/M4 approval, quiescence,
ambiguous readback reconciliation and safe retry remain separate acceptance work.

### Bring the Tobi-ishi identity into everyday tasks

PR #119 merged the warm stone tokens and original angular surfaces, removed
duplicate General-mode progress controls, and added keyboard Inspector tabs with
essential controls first. Script/direction disclosure and Import/Fit/Preview/
Relink quick actions reuse existing save, review and ownership guards. This is
a presentation and workflow refinement over the same project, Composition and
processing services. Its exact-head CI passed; real workstation, display-scale
and NLE gates remain in [TASKS.md](TASKS.md). The
[design rationale](docs/adr/tobiishi-surfaces.md) records the shared
application/site boundary.

### Add reviewed local media-intelligence workflows

The 2026-11-04 CLI/application slice and 2026-11-05 durable Job/API PRs add
source-bound low-energy analysis, restart-safe review and explicit Apply.
They reuse FFmpeg, existing SQLite reservation and owner recovery, the
`SilenceService` and one TimelineEditor. Analysis never automatically edits the
Composition. The desktop Precision Review UI and read-only before/after audition
through the existing Record mix are merged. The Audio Automation Ripple
implementation in [PR #114](https://github.com/bynanci/open-film/pull/114) adds a
versioned 48 kHz clock map for gain/fade/ducking preservation through reviewed
ripple and direct split. Incompatible sample spans, J/L timing and mapped
source/tempo changes fail closed. Explicit envelope reset and original-source
Collect preserve reviewability; Record also bounds the retained DSP history.
Complex-graph deterministic rounding is validated through actual FFmpeg contexts
and unchanged Windows pixel probes. The PR records final review and CI results.
Actual-media listening and workstation gates remain
open. No Auto-Editor runtime or eleven upstream tools/models are installed.

The [#144 recorded-media proof](docs/validation-silence-real-media.md) now
exercises the existing Linux application workflow with permissioned CC0 human
dialogue and guitar, actual MP4 decode, exact PCM/WAV parity and cold reopen.
It preserves the existing frame-aligned export policy and explicitly records
the mixed case's 1,152-sample / 24 ms excluded tail as manual review; it does
not certify retained speech, seam quality or acceptable termination. Human
listening, Windows/macOS devices, recorded A/V synchronization, more than two
captured channels and native workstation lifecycle observations remain open.

**2026-11-12:** [objective Linux recorded-browser evidence](docs/validation/silence-recorded-browser-2026-11-12.md)
now records I2's actual Reconnect/reload, HTTP Cancel, one declared delayed retry
and native-buffer overlap at a trusted project switch: nine checks and ten
cleanup entries passed. Original run-01 stays FAILED; final PR exact-head
review/CI is evaluated independently. This completes one narrow #144 child,
with human/native acceptance,
the excluded tail, PR #129 ownership and administrator gates unchanged.

The automation-clock implementation and hosted validation are complete. Next
acceptance is real dialogue/music listening and candidate-bound workstation
observations. Additional providers remain a separate admission scope whose
quality, timing, runtime costs and artifact rights must first be verified.
Existing scene/rhythm analysis, primary-color adjustment, role-based stems and
GraphicScenes remain the foundation. See the
[eleven-project integration reference](docs/en/media-intelligence-integrations.md),
[繁體中文](docs/media-intelligence-integrations.md) and
[ADR 012](docs/adr/012-reviewed-media-intelligence.md).

The Multi-Source M6 review workflow now has a deterministic stale-search
cleanup regression: the delayed response is awaited, and route teardown waits
for in-flight handlers on both normal and assertion-failure paths. This is a
test-harness reliability fix; it does not change review or import behavior.
See [PR #133](https://github.com/bynanci/open-film/pull/133) and the
[validation record](docs/validation-multi-source-analysis.md). Physical
workstation and supported-browser gates remain open.

The first Verify on the merged `5536b1c` head failed the slow GraphicScene
preview case in browser shard 4. Its trace shows the last graphic image removed
while the monitor continued advancing and cancelling sampled-frame requests.
The preview pause path cleared its texture during a transient monitor hold. PR
[#134](https://github.com/bynanci/open-film/pull/134) retains the last decoded
texture while it requests the exact paused frame; ownership and explicit seek
changes still fence and clear prior images. PR #134 was based on main `d141b14` and merged as
`1522879b538d7145b1972d721dde78155179592e`. Its exact Verify passed 376 media
files / 4,421 tests and six browser shards (363 cases); Windows Recovery,
three-platform Render QA, native-shell, docs-site, and DCO passed. This sampled
preview validation does not represent realtime, GPU/4K or workstation
acceptance.

PR [#132](https://github.com/bynanci/open-film/pull/132) was rebased on
`d982117` and merged at `d141b14`. Its Verify run
[42473142555](https://github.com/bynanci/open-film/actions/runs/42473142555)
passed 376 media files / 4,421 tests and all six browser shards (362 cases).
Windows Recovery
[42473142585](https://github.com/bynanci/open-film/actions/runs/42473142585)
passed 140 tests and 14 browser cases; three-platform Render QA
[42473142563](https://github.com/bynanci/open-film/actions/runs/42473142563)
and DCO
[42473141332](https://github.com/bynanci/open-film/actions/runs/42473141332)
also passed. This verifies test-route cleanup and title recovery, not native
release, external-editor or physical workstation acceptance.

The post-merge Windows Recovery run for `1522879b` then received HTTP 503
from the pinned FFmpeg asset endpoint on both its initial attempt and one
targeted retry, before tests started. The exact PR head's Windows Recovery and
the post-merge three-platform Render QA passed. The follow-up Render QA change
uses five bounded requests with capped exponential backoff; hash, byte, URL and
licensing checks remain unchanged. This is CI acquisition resilience, not
installer or workstation acceptance.

### Make the everyday editing workflow dependable

Professional Cut Desk Phases 1A–1C, Phase 2 editing operations and Phase 3 track
controls have merged implementations. Phase 4A scopes/comparison and Phase 4C
shortcut profiles have also merged. Remaining Phase 4 work is split into
deterministic animation (4B), long-form workstation evidence (4D), contract-led
compound editing (4E) and evidence-led multicamera (4F). Preserve one saved
Composition across General and Expert modes, predictable selection, user pins,
history and recovery.

Source/Record transport, sequence waveforms, independent audio timing, precision
gestures, responsive monitor layouts, source scopes and shortcut profiles
already have implementations. Remaining work should extend those features
rather than introduce a second timeline. See the [Cut Desk guide](docs/professional-cut-desk.md),
[precision-gesture validation](docs/validation-cut-desk-phase-1b.md) and
[responsive-workspace validation](docs/validation-cut-desk-phase-1c.md).

Cut Desk 4B.1 shared frame-time contract merged in PR
[#125](https://github.com/bynanci/open-film/pull/125). 4B.2 visual keyframes
merged in PR [#126](https://github.com/bynanci/open-film/pull/126), feature head
`b4aba4c4bb70b8cb03edd54342f1b94cec649245`, with exact-head hosted checks
passed; main merge is
[`5f737a6c8f35dce48e213370ff27900962c9304c`](https://github.com/bynanci/open-film/commit/5f737a6c8f35dce48e213370ff27900962c9304c).
Speed ramps remain gated on source-mapped caption/audio/rhythm consumers and an
explicit audio policy. See the [4B contract evidence](docs/validation-cut-desk-phase-4b-time-contract.md)
and [visual-keyframe validation](docs/validation-cut-desk-phase-4b-visual-keyframes.md).

### Make story decisions easier to review

Build on the existing Story Graph, authored StoryPlan, Pipeline and creative
variants. Continuity diagnostics, adjacent-scene micro-previews, rhythm proposals,
A-roll/B-roll coverage and transcript ripple services now have merged
implementations. Their guides and validation records describe the delivered
scope; broader workstation and editorial verification still matters.

Explicit per-beat event/person coverage and photo/video balance constraints are
now available from the Story Graph Inspector and preserved through StoryPlan
preview and acceptance. Solver hard constraints protect selected media, locks,
and User Pins; infeasible plans fail without rewriting them. See the
[Story Coverage validation](docs/validation-story-coverage.md) and
[implemented foundations and open tasks](TASKS.md) for evidence and limits.
Further work should explain the evidence behind suggestions and continue
professional editorial review without inferring identity or overriding choices.

### Finish distribution and real-world verification

Complete the native runtime, dependency and license review, then validate
installation, first launch, updates, rollback and uninstall on the target
platforms. Confirm camera files, external drives, audio playback, display
behavior and supported NLE handoffs on actual workstations.

- **Native evidence tooling:** bounded [runtime intake and target staging](docs/runtime-intake-141.md)
  and [staged candidate receipt binding](docs/validation-native-candidate-receipt.md)
  are implemented. Issues [#140](https://github.com/bynanci/open-film/issues/140),
  [#141](https://github.com/bynanci/open-film/issues/141),
  [#142](https://github.com/bynanci/open-film/issues/142) and
  [#143](https://github.com/bynanci/open-film/issues/143) remain open for actual
  reviewed runtimes, rights/security closure, signed installers and target OS
  trust/lifecycle evidence. Synthetic checks and source intake hashes do not
  approve redistribution or replace those observations.

The [retained input provenance matrix](docs/validation/runtime-provenance-141.md)
and [source-bound synthetic benchmark preparation](docs/validation/native-benchmark-preparation-145.md)
close bounded offline engineering tasks. Actual runtime/source/rights closure and
native measurements retain their own gates. The opt-in hosted source replay
entry reuses the existing complete Python authority. After PR #152 merged, one
fresh authenticated original-path run completed and was independently verified:
[2026-11-12 source-replay and governance evidence](docs/validation/issue-followup-2026-11-12.md).
Its record-only outcome and explicit shallow database-history limitation do not
replace candidate-specific final receipts, runtime rights or OS observations.

Direct reviewed staging now reuses the existing read-only intake before any
output-side filesystem work. The [input-parity validation](docs/validation/runtime-stage-input-parity-2026-11-12.md)
records synthetic hostile-input checks and preserved test-only runtime controls.
This stricter entry point leaves target provenance, rights and installation
acceptance open.

The [audit-v2 snapshot contract](docs/validation/advisory-db-snapshot-v2-2026-11-12.md)
now retains the original shallow boundary and requires complete offline Git
object verification through the same admission authority. Historical captures
stay with their original policy and timestamps. One new-policy direct source
capture and actual original-path replay have now passed independent verification:
[exact v2 evidence and remaining gates](docs/validation/native-v2-replay-2026-11-12.md).
Future candidates retain their own freshness/identity gate, followed by the
existing native rights, signed-byte and workstation requirements.

The [installer guide](docs/native-installer.md),
[workstation checklist](docs/workstation-qa.md) and
[Issue #7](https://github.com/bynanci/open-film/issues/7) describe the outstanding
evidence. CI results do not replace those observations.

Workstation evidence schema 1.1 records Windows, macOS and Linux installer
acceptance in separate gates. The record tool still reads historical 1.0 records
without inferring observations for missing platforms. New installer gates start
`not-run`; a schema check does not approve a release or certify installation.

Acceptance fixtures now [cancel and drain their owned Pipeline actions](docs/validation/pipeline-fixture-drain-2026-11-12.md)
before closing Catalog/removing temporary media. Review/retry controller gaps and
late callbacks retain case ownership; real failure-path regression and all four
original journeys preserve output quality, assertions and test budgets. The
original local timeout cause remains unproven and no production speedup is claimed.

The E2E distribution follow-up keeps one worker per isolated runner and builds
deterministic per-test Playwright lists from full discovery. PR #131's original
exact-head run passed 358 browser cases and the full Verify aggregate; the
longest observed browser test step decreased from 8m05s to 6m35s, with the
Transcript Productivity tests split 4/4/4/5/5/4. After synchronizing the PR
branch with main `07016dac8c23148181f7d36a402a86d8d8bc0533`, local partition
validation covered 363 cases with shard sizes 61/61/61/60/60/60 and transcript
distribution 4/4/5/5/4/4. These are measured CI and local preflight results, not a
workstation guarantee. PR #131 is merged; main `08e38b6` subsequently passed the
363-case inventory. Earlier timings retain their original scope; see the
[E2E shard validation](docs/validation-ci-pages-e2e.md).

PR [#120](https://github.com/bynanci/open-film/pull/120) patches Tokio to 1.53.3.
PR [#128](https://github.com/bynanci/open-film/pull/128) now merges the exact GLib
upstream source repair with independent technical review, optimized controls and
fresh same-database audits. Candidate `54534d8` has its own reviewed adaptation.
The proc-macro-error maintenance warning remains an explicit owner decision.
See the [release gate audit](docs/validation-release-gates.md) and
[independent disposition](docs/security/glib-0429-independent-review.md).

## Foundations available on main

These are existing development-branch capabilities, not a list of new v0.4.0
features. Their guides describe supported behavior and remaining limits.

| Area       | Existing foundation                                                                            | Documentation                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Media      | Multi-source import, scoped analysis, source provenance, proxies and relinking                 | [Import and analysis](docs/roadmap/multi-source-analysis.md), [media portability](docs/en/media-portability.md)                             |
| Story      | Story Graph, authored outlines, reviewable proposals and rough-cut generation                  | [Story authoring](docs/story-arc-authoring.md), [story workflow](docs/en/product-workflow.md)                                               |
| Editing    | Non-destructive clip and layer editing, captions, photo presentation, color and audio controls | [Precision editing](docs/en/precision-editing.md), [Cut Desk](docs/professional-cut-desk.md)                                                |
| Iteration  | Named Versions, creative variants, A/B review and Pipeline artifact reuse                      | [Versions](docs/named-versions.md), [variants](docs/validation-creative-variants.md), [Pipeline](docs/validation-pipeline-orchestration.md) |
| Delivery   | MP4 and interchange output, output profiles, Visual QA and Collect Media                       | [Export profiles](docs/export-profiles.md), [NLE handoff](docs/nle-handoff.md), [Collect Media](docs/en/collect-media.md)                   |
| Extensions | Local declarative presets, provider ports and optional local/BYOK integrations                 | [Presets](docs/local-presets.md), [provider generation](docs/provider-generation.md)                                                        |

Existing functionality remains free and open source. The basic workflow runs
locally without a cloud account. Optional external providers have their own
requirements and charges, and require explicit consent.

## Longer-term work

These directions are outside the immediate release work and have no committed
release date:

- Broader source and provider integrations, including additional local analysis
  implementations.
- Archive-scale analysis and background scheduling, plus native cold-start
  measurements for the existing Desktop locale/workspace code splitting.
  Chronological cursor paging, literal substring
  search indexing, and lazy Story Template / PhotoDepth selectors are implemented;
  see the [Catalog scale validation](docs/validation-catalog-scale-benchmark.md)
  and [Catalog search validation](docs/validation-catalog-search-index.md).
- Executable extension discovery and loading beyond the current SDK and built-in
  registration. The local data-only preset registry already exists.
- Additional interchange fidelity where the target editor and format can support
  it, backed by actual import and playback checks.

Cloud collaboration, hosted generation and a plugin marketplace are not current
availability promises. Proposals should identify a user problem, explain how
existing capabilities fall short and state the maintenance cost.

## How priorities are chosen

Reliability, source-media safety and project compatibility come first. New work
should improve a blocked step in the filmmaking workflow, keep decisions
reviewable and reuse existing application services. Performance and compatibility
claims need reproducible evidence.

For a substantial change, start with an issue describing the workflow and the
expected result. Documentation fixes, translations, reproducible bug reports and
small focused fixes are useful contributions at every stage.

## Development history

Detailed feature guides and dated validation records remain in [docs](docs/index.md).
The previous chronological roadmap is preserved in the
[2026-10-31 source snapshot](https://github.com/bynanci/open-film/blob/a88470f65ac26ac59b962227440dc57d2a5b5169/ROADMAP.md).
Consult that snapshot for historical PR-by-PR notes; use this page and
[TASKS.md](TASKS.md) for current direction and work.
