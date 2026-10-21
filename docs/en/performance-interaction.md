# Performance and interaction refinement

## Measurement contract

Baseline: `34b6ff093294f97061dfb0ecb270413a52b6b7ee` (main, 2026-10-08).
This historical baseline predates convergence of PRs #8 (transcription
cancellation), #9 (analysis ownership/recovery) and #10 (composition captions).
Their application, catalog, job ownership, revision and recovery contracts remain
protected in the combined-source measurements below.

These are synthetic UI workloads, not real 4K, camera, transcription, GPU or
workstation benchmarks. Use the same Chromium, viewport, fixture and development
server for before/after comparisons. Record script/layout time, render work,
requests and DOM counts separately; elapsed time includes browser automation and
must not be described as input latency. Keep raw samples and identify warmup.

| Surface                | Scenario                           | Fixture size                       | Metric                                       | Baseline / bottleneck to verify                     | Candidate                                          | Acceptance                                                                 |
| ---------------------- | ---------------------------------- | ---------------------------------- | -------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Startup / Library      | Open existing project on Library   | 2,000 assets, 500 clips            | First usable, API, hidden DOM, script/layout | Hidden editor mounts before first visit             | Defer first mount, eagerly recover existing drafts | 60 visible cards; no hidden timeline load without draft; preserve recovery |
| Library                | Page, filter, selection            | 60/page                            | Requests, DOM, selected source decode        | Already paginated and lazy                          | Retain unless profile contradicts                  | Page work stays bounded; stale reads cannot replace acknowledged edits     |
| Story                  | Beat selection / duration feedback | 10 beats, 500 clips                | Render work, script time                     | Three complete clip scans per beat                  | Only aggregate if material                         | Preserve maximum of per-track duration sums                                |
| Timeline               | Select clip / idle jobs refresh    | 500 clips                          | Render count/time, child props, API          | Inline clip label array recreated on parent renders | Stable computed options                            | Labels refresh after relevant data changes; no extra editor loads          |
| Precision              | Hover paused waveform              | 100 segments, dense words, markers | Render count/time, long tasks, API           | Words share waveform render boundary                | Read-only transcript render boundary               | Same word/segment seeking and stale alignment; zero hover API calls        |
| Transcript             | Open / search / idle               | 10,000 segments, 100/page          | DOM, search requests, ancillary reads        | Existing debounced search and bounded pages         | Preserve; record ancillary polling separately      | Revision/query guards and opaque IDs unchanged                             |
| Timeline accessibility | Focus selected / locked clip       | Four clip states                   | Computed outline, bounds                     | Selected outline masks keyboard focus               | Explicit focus-visible rule                        | External visible ring; no layout shift                                     |

Choose a maximum of five independently proven improvements. Do not add a cache,
virtualization engine or new poller simply because a large fixture exists.
Milliseconds are diagnostic; stable request/render/DOM bounds are suitable CI
assertions. A common >50 ms long task warrants investigation rather than a
machine-dependent hard timing failure.

## Protected behavior

Keep composition/transcript command histories, request receipts, autosave,
project generation checks, revision conflict handling, source invalidation,
asset mutation guards and conservative owner recovery intact. Deferring an
editor mount must not bypass a persisted recovery draft. After the first visit,
leaving Edit must retain its current mounted history and pending-save barrier.

Real Resolve import, real speech/model quality, GPU, camera media, large 4K
sources, native installation and OS owner recovery remain workstation gates.

The delayed-read regression exposed an existing recovery defect: pending commands
were loaded before the editor snapshot, but `flush()` could skip its empty-state
loop and report success. Unload could then remove the original recovery bytes.
The composable now reports pending recovery immediately, refuses a flush before
its snapshot is ready, and preserves those bytes. A disposed loader also ignores
late successful/failed reads and receipt acknowledgements, so it cannot overwrite
a replacement editor's newer draft or start another project read. Receipt IDs,
command application, persistence schema and application job ownership are unchanged.

Actual-composable tests first failed for the delayed-read and late-disposal cases,
then passed with the guards. Browser cases cover pending Export/project navigation,
composition switching, malformed/unavailable storage, and retained selection/Undo
across repeated workspace visits. These regressions supplement, rather than
replace, the existing complete editing and transcript journeys.

## Evidence

The measured final production candidate is
`5511145f021e39854d908cca811eca42c1f05d85` (2026-10-11). The baseline was
captured on 2026-10-08 at `34b6ff093294f97061dfb0ecb270413a52b6b7ee` with the
focus-only CSS correction already applied; performance behavior had not yet
changed. Test instrumentation was outside production code. All three baseline
runs share source fingerprint `99750cc7d0130048eb14c29bfc9cf71eb0544f4890e2df13b48ba90c8dd83387`;
all three final runs share `7167fb42c3057ab9f743a4d577ebdec7ff40b35950220407cc8a353cc2952c89`.
Each recorded before/after source fingerprint is identical within its run.

Chromium **151.0.7922.173**, viewport **1440×900**, Vite development server,
fresh browser context per repetition, one worker. The generated fixture contains
2,000 distinct hard-link locations for a tiny local video, 500 clips across ten
beats, and a deliberately dense 10,000-segment transcript with ten words per
segment. Precision displays 100 segments, 3,000 waveform bins and 200 scene
markers. This exercises UI scale, not realistic speech density or heavy decoding.
A separate warm-up is excluded; three retained baseline and three final samples
passed. Vite is shared within each three-repeat command, so the first repetition
can include cold transforms.

### Stable work counts

| Scenario                                              | Before         | After          | Confidence / interpretation                                     |
| ----------------------------------------------------- | -------------- | -------------- | --------------------------------------------------------------- |
| Library startup DOM                                   | 4,934 elements | 1,174 elements | Same count in all three samples                                 |
| Library startup hidden clips / premature editor reads | 500 / 1        | 0 / 0          | Enforced by browser work bounds; 60 cards remain visible        |
| Ten Story beat selections hidden Timeline renders     | 11             | 0              | Same count in all samples                                       |
| Three idle jobs polls: Precision renders              | 3              | 0              | Shared jobs polling retained; stable props remove child updates |
| Sixty paused hover steps: Precision renders           | 68             | 60             | Final word pane is instrumented and performs zero extra renders |
| Hover-specific API requests                           | 0              | 0              | All requests in that scenario are existing shared jobs polling  |
| Long transcript rows / search requests                | 100 / 1        | 100 / 1        | Preserve pagination and debounce; no virtualization added       |

A separate actual-SFC regression uses 100 segments × 40 words. Twenty hover
updates previously rebuilt 80,000 word labels; the read-only pane now requires
zero additional label evaluations. Segment/word seeking, overlapping timing,
stale alignment, page replacement and locale updates remain covered.

### Diagnostic times and tradeoffs

Values are median [minimum–maximum] milliseconds across three samples. These are
observations from a shared cloud runner on different dates, not guarantees of
input latency. Work-count evidence is stronger than elapsed-time comparisons.

| Scenario / metric                           | Before                 | After                  |
| ------------------------------------------- | ---------------------- | ---------------------- |
| Library startup automation elapsed          | 1473.0 [1440.2–1641.3] | 1519.2 [1062.2–1544.2] |
| Ten Story selections automation elapsed     | 2451.3 [2415.4–2542.9] | 1564.8 [1514.5–1565.9] |
| First Edit automation elapsed               | 615.9 [594.8–635.4]    | 638.7 [619.0–693.2]    |
| Twenty Timeline selections: render elapsed  | 465.3 [421.3–480.9]    | 517.0 [494.8–520.1]    |
| Sixty hover steps: Precision render elapsed | 503.3 [493.8–524.7]    | 51.4 [47.1–51.6]       |
| Transcript search automation elapsed        | 539.7 [513.3–690.7]    | 521.8 [497.7–567.6]    |

Startup no longer creates hidden editor work, but the final elapsed samples do
**not** demonstrate a faster startup. First Edit pays its mount cost on demand.
Story performs eight bounded candidate asset reads across ten first visits;
those assets were previously warmed by mounting the hidden editor. These are
on-demand reads, not duplicate requests. Twenty Timeline selections still render
the 500-clip parent repeatedly; no improvement is claimed for that workload.

The render probe wraps components that exist before each scenario. The newly
mounted candidate editor is therefore **unmeasured during its initial mount**,
not zero work. DOM, requests and CDP metrics still cover first Edit. Inclusive
Vue render elapsed is separate from CDP ScriptDuration/TaskDuration accounting.
The hover scenario includes browser-driver waits and two animation frames per
step; it is not a 60 FPS benchmark. Some startup/first-visit tasks still exceed
50 ms. No universal frame-budget or long-task-elimination claim is made.

### Reproduce and locate evidence

Run from the repository with its provisioned Node/pnpm environment. Use a fresh
output directory for each candidate. Run a separate single-test warm-up first;
its output must not replace the three retained samples.

```sh
OPENFILM_CHROMIUM=/usr/bin/chromium \
OPENFILM_BENCHMARK_LABEL=final \
OPENFILM_BENCHMARK_OUTPUT=/tmp/openfilm-interaction-final \
pnpm exec playwright test tests/e2e/interaction-performance.spec.ts --repeat-each=3
```

The ordinary browser gate runs this scenario once with deterministic request,
render and DOM budgets; it has no machine-dependent millisecond assertions.
Playwright attaches `interaction-performance.json` under
`test-results/interaction-performance-*` and preserves failed-run traces.
The local evidence paths, relative to the workspace root, are:

- `.cloud-onboarding/artifacts/openfilm-interaction-baseline/`: three raw samples,
  baseline log, initial harness failure notes and the excluded warm-up.
- `.cloud-onboarding/artifacts/openfilm-interaction-candidate-5511145/`: three raw
  `interaction-performance-{0,1,2}.json` files, `comparison-summary.json`, final
  browser log and excluded `warmup/` output.

The intermediate `36e316c` run is retained separately and is superseded by the
final candidate. Raw JSON includes exact commit, source hashes, browser, fixture,
viewport, render counts/times, API URLs, long tasks, DOM, and CDP metrics.

### Validation status

All ten local gates passed on the frozen commit
`ef1de6e85057682f82ee1428797f9bbdb9d98693` on 2026-10-11. Tracked-file hashes
were identical before and after the complete run. Production sources match the
measured `5511145f021e39854d908cca811eca42c1f05d85` candidate.

| Command                            | Result                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm format:check`                | Passed                                                                                      |
| `pnpm test:i18n`                   | Passed                                                                                      |
| `pnpm lint`                        | Passed                                                                                      |
| `pnpm typecheck`                   | Passed                                                                                      |
| `pnpm test`                        | 1,030 tests / 92 files passed                                                               |
| `pnpm build`                       | Passed                                                                                      |
| `pnpm test:e2e`                    | 76 tests passed (12.4 minutes)                                                              |
| `pnpm test:interchange`            | 18 official OTIO parser tests, source references and relocation checks passed               |
| `pnpm test:native`                 | Rust formatting, Clippy and test harness passed; the harness contains zero behavioral tests |
| `node scripts/smoke-built-cli.mjs` | Passed                                                                                      |

The final candidate warm-up and all three comparable browser repetitions also
passed. Independent review found that the original Library next-page measurement
only waited for 60 cards, a count shared by both pages. Those raw pagination
samples are retained for audit but are **not evidence of completed-page latency**;
their elapsed values and render comparison are intentionally omitted above.
The immediately following `story-open` sample is likewise diagnostic only.
The benchmark now verifies the expected first and last new-page assets and
records the first visible asset. It also requires an active hover label and
positive Precision render count before accepting zero transcript-pane updates.
The strengthened benchmark passed separately after review (one test, 26.5 seconds); it does not change
production sources or replace the original three-run comparison.

Browser coverage includes delayed recovery, disposal, navigation/receipt guards,
undo/reopen, full Proposal Film and transcript workflows, and shared job polling.
Core Welcome/Library/Story/Edit/Export, Precision, and Transcript visual checks
cover `en-US`, `zh-TW`, `ja-JP`, `en-XA` at 1280×720, 1440×900, 1920×1080 and
1024×768. Settings, error/relink dialogs and automated axe checks run at 1280×720.
Six real-Tab focus cases cover selected/locked clip states in light/dark themes
at the three primary sizes. Existing theme and reduced-motion checks pass.

Representative screenshots were also inspected visually. No horizontal overflow
was observed. Small-window density remains:
Japanese Story button text and pseudo-locale toolbars wrap; Precision/Transcript
lower controls require panel scrolling, and the source preview becomes compact.
Some scrolled pseudo-locale Transcript captures partially obscure Search/Replace
under the sticky player, and one Japanese native-video capture still shows a
spinner despite the readiness checks. These are retained as browser presentation
limitations, not hidden behind a blanket no-clipping claim. Full-page PNGs and
automated axe checks are not a complete screen-reader or WCAG
certification. Long-session memory behavior and native-window/media performance
are not established by these synthetic scenarios.

Full logs, the immutable gate manifest and the visual inspection record are in
`.cloud-onboarding/artifacts/openfilm-interaction-ef1de6e85057/`. That directory's
`browser-results.tar.gz` preserves the frozen run's 217 primary screenshots and
attachments; subsequent targeted runs can replace `open-film/test-results/`.
The strengthened benchmark uses
`.cloud-onboarding/artifacts/openfilm-interaction-readiness/`; CI also attaches
its one-run work-budget report with browser results. CI repeats all applicable
gates for the published PR head.

The first published head (`6b26cae5c4642211cef0e767530529b0115dece7`) passed its
PR CI run, but its concurrent push run exposed an existing Precision fixture
teardown race (75 browser cases passed, one failed). The hook closed the backend
project while the page and its `/api/jobs` interception were still polling.
The next legitimate `409 project.required` response had no `jobs` array, so the
fixture threw while appending its synthetic render job. A diagnostic 1.5-second
post-close delay reproduced the same error and captured that response in a trace.
Draining route handlers, closing the page, then closing the backend passed the
same diagnostic. The delay was removed from the final change; functional
assertions and production job behavior remain unchanged. The final affected case
passed three consecutive repetitions (48.6 seconds); the complete Precision
file and published-head CI also exercise the cleanup. Reproduction and
verification logs are in `.cloud-onboarding/artifacts/openfilm-interaction-ci-teardown/`.

The following head (`939ca259a83e43e8efb5add94dfa3fd359b85524`) passed all 76
browser cases in PR CI, while its concurrent push run exposed a separate Proposal
fixture precondition race. The test clicked Reject before the preceding Always
include write finished; the existing busy guard could ignore that click. An
unrejected duplicate changes the template's candidate partition, legitimately
leaving the locked photo as its beat's only regeneration candidate. A held lock
acknowledgement reproduced the missing persisted rejection. Waiting for each
write's acknowledgement and visible state passed the same delayed-response
scenario and the complete Proposal flow. The final test also asserts the catalog's
rejected flag; regeneration, protected clips and drag-order assertions remain
unchanged. Diagnostic delays are excluded from the final test. The product-level
pending-mutation controls remain owned by PR #9, rather than being duplicated
here. Evidence is in `.cloud-onboarding/artifacts/openfilm-interaction-proposal-fixture/`
and `.cloud-onboarding/artifacts/openfilm-interaction-ci-proposal/`.

### Integration with analysis ownership and captions

PR convergence retains the three-sample measurements above as historical evidence
for their stated source hashes. The combined source is validated separately;
those times do not establish performance for the added ownership and caption code.
Merging ownership-aware jobs introduced a new empty recovery map on every poll,
which reintroduced three idle Precision updates. The unchanged browser budget
failed, then passed after normalizing only empty maps to a shared frozen value.
Nonempty checkpoint/token evidence remains freshly published and project/read
generation guards remain intact. Actual App-function regressions cover unchanged
empty props, changed ownership, removal and delayed cross-project responses.

An added real-browser integration case begins with the editor unmounted in
Library, then holds a successful Precision marker acknowledgement. It proves
history and navigation cannot cross the pending barrier, and verifies persisted
markers and retained Undo/Redo after workspace changes. Proposal keeps the
held-lock disabled-control checks together with the response and catalog rejection
assertions. The combined-source work-budget report and RED/GREEN traces are in
`.cloud-onboarding/artifacts/openfilm-pr-convergence/`; workstation gates remain open.

Independent correctness review identified the disposed-loader draft overwrite
and the measurement readiness issue; both have targeted regression coverage.
Real Resolve import and actual model/GPU/camera/4K/Windows installation remain
manual gates. The following round targets the 500-clip Timeline rail's repeated presentation
work during selection.

## 500-clip Timeline selection boundary (2026-10-12)

This round follows the merged ownership, captions and interaction work. Base is `75b2617e5b0bbb4806c0a201d2013b903699b1e5`; measured production candidate is `62e48e397d6346e551b0678a183529ba48ea699b`. The only production change extracts the existing clip button into `TimelineClip.vue`. Stable clip/display props and a per-clip selection boolean isolate presentation; selection, commands, drag ownership, history, pending-save guards, recovery and keyboard scrolling stay in `TimelineEditor.vue`. No cache, schema change, new poller or timeline engine was added.

The identical benchmark runs on Chromium 151.0.7922.173 at 1440×900 against Vite development mode, with 2,000 assets, 500 clips, ten beats and a synthetic 10,000-segment transcript. One warm-up per version is excluded. Three retained baseline and three candidate repetitions passed, with desktop hashes identical before/after each run. Baseline fingerprint is `9b97d88da64900aec2ea04c29ca9248a1bc65e7cfe678c3aa124b3eff1b6962f`; candidate fingerprint is `855061c06dc3e8c5e67fe84567c411af5e53edc10f1eafe2c0ddb238d4edd593`. Frozen benchmark SHA256 is `941683b439105e8ac0af8d8b85a0989a9b377b8652ae4b8aed8f6cf82e286ea3`.

### Work and correctness

| Observation                                           | Before                     | After                                   |
| ----------------------------------------------------- | -------------------------- | --------------------------------------- |
| Actual-SFC clip-label evaluations for one selection   | 500                        | 2                                       |
| Actual-SFC labels after unchanged jobs/recovery props | 500                        | 0                                       |
| Already-selected clip click                           | 0                          | 0                                       |
| Real browser leaf renders for 19 same-beat changes    | Inline parent presentation | 38 in each sample                       |
| Real browser leaf renders for 19 cross-beat changes   | Inline parent presentation | 38 in each sample                       |
| Clip-body renders during three unchanged jobs polls   | Inline parent presentation | 0                                       |
| First Edit visible clips / selected-source videos     | 500 / 1                    | 500 / 1                                 |
| Additional presentation component instances           | 0                          | 500, retained across all three revisits |
| Selection editor/catalog reloads or command writes    | 0                          | 0                                       |

Each selection scenario attempts 20 clicks with one initial no-op, verifies 19 actual changes, exactly one selected/ARIA-pressed button and the correct inspector. Composition, Story, revision, history and local recovery bytes remain unchanged. Necessary source/media reads and shared job polls remain. Returning to Edit preserves instance IDs and history while performing the existing one snapshot refresh; this refresh is necessary to show acknowledged Library changes.

### Diagnostic timings and tradeoffs

Values are median [minimum–maximum] milliseconds across three samples.

| Metric                                          | Before              | After               |
| ----------------------------------------------- | ------------------- | ------------------- |
| First Edit automation elapsed                   | 837.3 [837.2–873.9] | 897.2 [838.0–938.3] |
| First Edit parent render elapsed                | 93.5 [88.4–95.3]    | 42.3 [41.2–44.9]    |
| 19 same-beat selections: parent render elapsed  | 568.1 [564.3–579.7] | 287.7 [275.0–288.5] |
| 19 cross-beat selections: parent render elapsed | 486.3 [457.3–493.6] | 280.1 [263.3–286.3] |
| Same-beat selections: CDP ScriptDuration        | 46.5 [43.6–46.7]    | 45.9 [43.3–53.9]    |
| Cross-beat selections: CDP ScriptDuration       | 43.6 [42.0–50.3]    | 44.2 [42.1–45.8]    |
| Third Library/Edit revisit automation elapsed   | 837.4 [763.0–864.4] | 805.9 [771.8–809.5] |

The bounded clip work reduction is established. First Edit automation elapsed increased by about 60 ms at its median, so no faster-startup claim is made. First mount now includes 500 leaf setups and test-only render wrappers. Candidate leaf render time is recorded separately from its parent. CDP ScriptDuration is essentially unchanged; parent render timings do not establish input latency or a general speedup. Heap samples use no forced GC and vary with garbage collection: they do not prove lower memory usage or leak freedom. Stable component IDs show retention over three short revisits, not long-session or native-window performance.

The new regression coverage verifies repeated asset IDs as separate clip instances, locked/offline selection, source-status/thumbnail/name repair, locale invalidation, trim/speed/transition/lock/replacement snapshots, invalid cross-beat/cross-track drag, and a successful later reorder. Visible Story timing follows acknowledged Precision trim/Undo/Redo; real relink clears missing badges without replacing the clip button. Native drag diagnostics revealed a test coordinate issue during target scrolling; the final case keeps both beats visible and requires the actual source/target events. The request monitor uses the real `/edit` endpoint. No production correctness fix was required for those fixture defects.

Fresh independent whole-branch review found no P1/P2 issue. Actual-SFC tests passed 8/8; focused boundary units passed 40/40 and focused real-browser suites passed 34/34. Full regression results follow below.

Real en-US, zh-TW, ja-JP and en-XA Edit screens were inspected at 1280×720, 1440×900 and 1920×1080. No extraction-specific overflow or text collision was observed. Small windows still require rail/panel scrolling; pseudo-locale wrapping can move selected content below the visible rail. The inspected fixtures collapse Inspector and contain no locked clip, so screenshots alone do not certify those states; functional browser tests cover them. Prior main screenshots use a different generated Story state, so no pixel parity or causal comparison of selected visibility is claimed. Automated layout/focus/axe checks do not establish complete WCAG or screen-reader compliance.

### Reproduction and evidence

Retain separate warm-up and comparison directories. Baseline runs use `OPENFILM_RAIL_BASELINE=1` only to exempt the absent new leaf budget; all selection/read-only and previous work budgets remain. Candidate and ordinary CI have no exemption and require positive leaf coverage, 38–40 renders per 19 changes and zero idle clip updates. Use the same actions and instrumentation for both.

```sh
OPENFILM_CHROMIUM=/usr/bin/chromium \
OPENFILM_BENCHMARK_LABEL=rail-candidate \
OPENFILM_BENCHMARK_OUTPUT=/tmp/openfilm-rail-candidate \
pnpm test:e2e tests/e2e/interaction-performance.spec.ts --repeat-each=3
```

Evidence is stored relative to the workspace root in `.cloud-onboarding/artifacts/openfilm-timeline-selection/`: separate baseline/candidate warm-ups, three JSON reports per version, runner manifests, `comparison-summary.json`, source/instrumentation hashes, actual-SFC RED/GREEN logs, drag diagnostic trace, focused browser logs and visual inspection record. Reports are written even on failure; runner exit codes, complete samples and unchanged fingerprints are required before accepting them. Failed preflight measurements are retained under `harness-preflight/` and excluded from comparisons. Real Resolve, speech/model/GPU/camera/4K and installer/native-window QA remain workstation gates.

### Final local regression

All ten gates passed on frozen production commit `62e48e397d6346e551b0678a183529ba48ea699b`; tracked-file hashes were unchanged before/after. Later documentation-only commits retain its measured desktop fingerprint.

| Command                            | Result                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `pnpm format:check`                | Passed                                                                 |
| `pnpm test:i18n`                   | Passed, 1,102 keys                                                     |
| `pnpm lint`                        | Passed                                                                 |
| `pnpm typecheck`                   | Passed                                                                 |
| `pnpm test`                        | 1,535 tests / 112 files passed                                         |
| `pnpm build`                       | Passed                                                                 |
| `pnpm test:e2e`                    | 96 passed                                                              |
| `pnpm test:interchange`            | 18 official OTIO parser tests and relocation/source checks passed      |
| `pnpm test:native`                 | Rust formatting, Clippy and harness passed; zero behavioral Rust tests |
| `node scripts/smoke-built-cli.mjs` | Passed                                                                 |

Complete gate logs, immutable manifest and browser screenshots are under `.cloud-onboarding/artifacts/openfilm-timeline-selection-regression-62e48e397d63/`. Published exact-head CI is authoritative for the later documentation commit and is linked from the pull request.
