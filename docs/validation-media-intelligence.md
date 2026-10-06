# Media Intelligence foundation validation

This change is based on OpenFilm main
`b9273d6d369a3c4f6eb348c3a34f9ccbd7e76b1b`. That main revision's Verify run
[37409681132](https://github.com/bynanci/open-film/actions/runs/37409681132)
passed before this round. The candidate branch is
`codex/media-intelligence-foundation`; its PR checks are the evidence for the
final candidate SHA rather than a claim that baseline CI covers new code.

## Implemented scope

P0 adds optional local transcription, timed words, paged transcript revisions,
source-bound waveforms, scene detection, manual markers, snapping and a Precision
mode within Edit. Core, SDK, analysis, catalog, application, solver, media and
Desktop retain their existing boundaries. Analysis alone does not modify Story
or Composition. Split and trim use the same command history/autosave path as
Story editing; clip and library locks remain protected.

No transcript text editor, glossary, AI suggestion engine, face detector,
reframing, derived film or caption pipeline is included. The next vertical slice
is Transcript Editing + Glossary + Review Suggestions.

## Automated evidence

The existing regression gates also execute the new suites through CI:

| Gate                               | Evidence                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                | **Passed.** Repository formatting check.                                                                                                                                                                   |
| `pnpm test:i18n`                   | **Passed.** 867 matching semantic keys and placeholders in en-US, zh-TW and ja-JP.                                                                                                                         |
| `pnpm lint`, `pnpm typecheck`      | **Passed.** TypeScript, Vue and strict lint checks.                                                                                                                                                        |
| `pnpm test`                        | **Passed: 532 tests in 56 files.** Domain, provider, migration, paging, source invalidation, cancellation and real FFmpeg integration suites; the provider suite also executes eight Python sidecar cases. |
| `pnpm build`                       | **Passed.** CLI/server bundles, Python sidecar copies and Desktop production build.                                                                                                                        |
| `node scripts/smoke-built-cli.mjs` | **Passed.** Built CLI import/Story/Compose, real waveform/scenes, missing-model failure, protocol-fixture transcription, paged words, markers, reopen, MP4 and exports.                                    |
| `pnpm test:e2e`                    | **Passed: 34 tests, zero failures, skips or retries.** Existing localized/pseudo/Story workflows plus eleven Precision browser cases; the 500-clip regression remains green.                               |
| `pnpm test:interchange`            | **Passed.** Official OpenTimelineIO 0.18.1 serialization/source validation and 18 offline workstation-helper regressions. Actual Resolve is not run.                                                       |
| `pnpm test:native`                 | **Passed.** Rust formatting, Clippy and compile/test harness; the harness contains zero native behavior tests.                                                                                             |

The Proposal browser case imports generated photos, spoken video and music,
builds a story/composition, then runs real waveform and scene processing. It
checks on-demand transcription jobs, cancellation, returning to a source while
its job runs, word seeking, snapped and keyboard trims, very short positive
ranges, split/undo/redo, durable reopen and a real MP4 render. It compares original
source hashes and checks that analysis does not change Story or film duration.
Dense-marker, render-status, missing-duration and provider capability/readiness
browser response fixtures are explicitly identified UI stress/error inputs;
they do not certify 20,000 real scene detections, camera metadata extraction or
remote transcription. The language cases run the real job and persistence
pipeline with deterministic English/Japanese protocol results, including empty
capabilities, supported subsets and selection preservation.

One local full browser attempt passed 33 cases but failed the Proposal OTIO
parser check because it used system `python3` without `opentimelineio`. The
installed OTIO environment must be selected with `OPENFILM_OTIO_PYTHON`; the
final complete rerun with that interpreter passed all 34 cases, with no skipped
tests or retries. CI installs OTIO into its selected Python environment.

Transcript protocol tests explicitly return predetermined words. The optional
engine's CPU fallback is exercised with offline test doubles, including GPU
initialization and iteration failures. These checks establish control flow and
validation, not actual Whisper recognition or GPU performance.

## Correctness review and regressions

Independent reviews and browser execution identified and corrected:

- DELETE marker preflight missing from the HTTP CORS methods.
- A provider registration race assigning provenance from a different provider.
- Progress observers corrupting durable job state when they throw.
- Request enum arrays passing through string coercion.
- Malformed provider execution arrays entering completed job metadata.
- Delayed audio or internal packet gaps, including repeated 50 ms gaps, shifting
  word/waveform source timing. Both ingest paths share timestamp resampling with
  immediate hard compensation; actual PCM pulse diagnostics verify the source clock.
- Older/foreign waveform and scene caches being reused by the current pipeline.
- Frame-key trim sticking to its own snap candidate.
- Trim handle bounds becoming inverted for valid 5 ms selections.
- Running analysis/results being lost when switching away and back to a source.
- Story mute changes not reaching a retained source player.
- Hidden Story/Precision media elements using a second decoder.
- Activity labels missing dynamic translation keys.
- Invalidated source evidence remaining editable after a failed read/job/marker
  operation; Precision now waits for a verified read and can refresh after recovery.
- Waveform SVG stretching a partial final bucket; geometry uses actual peak
  sample rate at all zoom levels.
- Library-locked assets offering Split even though the command rejects them;
  split availability and its keyboard guard now respect the source lock while
  preserving valid trim controls on unlocked clips.
- Split points inside a retimed incoming crossfade being offered even though
  the solver rejects them; UI availability uses the same film-time boundary.
- Source-scoped job hydration enabling analysis while another source or project
  task is active; analysis uses project-wide readiness while job details remain scoped.
- Dense marker results creating up to 20,000 controls; the list is paged at 100
  rows while retaining full evidence for snapping.
- Missing duration metadata enabling operations that require a measured source;
  playback remains available but editing, marker creation and analysis wait for metadata.
- Generic plugin execution/fallback metadata entering durable jobs unchecked;
  result metadata is validated and snapshotted, including before reopen.
- Failed provider registration removing the prior working provider; replacement
  is atomic and retains consent protection.
- Retained provider progress callbacks changing terminal jobs or throwing after
  completion; invocation callbacks are retired on settlement and cancellation.
- Language choices ignoring a provider's supported subset; Precision selects a
  supported default, preserves valid choices and blocks empty capability lists.
- Unconsented remote providers being advertised as available; readiness follows
  registry authorization and the UI explains the disabled provider separately
  from local model setup.

Each correction has a protocol, integration, media or browser regression rather
than only an interface declaration.

## Desktop and accessibility

Precision browser coverage checks en-US, zh-TW and ja-JP at 1280×720, 1440×900 and
1920×1080. It asserts no horizontal page overflow and visible source preview and
analysis panel, captures screenshots, runs axe on core Precision controls and
fails on missing translation warnings. Existing pseudo-locale and large Story
timeline regressions remain part of the full browser suite.

Keyboard trim/seek/marker/split respects input focus. Source controls remain
scrollable on small desktop windows. Only the active Story or Precision player
mounts a media element; selecting an analysis panel does not decode the library.

## Real model and manual gates

The cloud has Python 3.12.14, faster-whisper 1.2.1 and CTranslate2 4.8.2 installed
in a separate optional environment. A real tiny model download
(`Systran/faster-whisper-tiny`) was rejected by the environment proxy with HTTP 403. No model weights were available, so **actual CPU speech recognition was not
run**. There is no CPU/GPU timing or accuracy benchmark to report.

The deterministic `fixture-protocol-not-asr` model name and provider version are
preserved in test data. Generated speech fixtures and successful workflow tests
do not certify speech accuracy or production readiness for real camera sources.

Remaining manual checks are real CPU speech quality with user-supplied local
weights, compatible GPU fallback/performance, microphone/Pixel/Insta360 audio,
large 4K sources and Windows installer/native-window behavior. Real DaVinci
Resolve import/playback/relink remains the workstation gate documented in
[resolve-qa-record.md](resolve-qa-record.md). Parser validation and portable QA
preparation do not close that application gate.
