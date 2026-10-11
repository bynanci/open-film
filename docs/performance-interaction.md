# Performance and interaction refinement

## Measurement contract

Baseline: `34b6ff093294f97061dfb0ecb270413a52b6b7ee` (main, 2026-10-08).
PRs #8 (transcription cancellation), #9 (analysis ownership/recovery, stacked on
#8), and #10 (composition captions) remain separate. Their application, catalog,
job ownership, revision and recovery contracts are outside this change.

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

Baseline and candidate results, commands, visual/a11y coverage and exact SHA will
be recorded after the comparable browser runs. No performance improvement is
claimed by this measurement plan alone.
