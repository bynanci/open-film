# M7C validation — native and rendered NLE exchange

Base: `bb2c4521ad894478893485119442a00ffd9b34cc`.
Implementation candidate; exact final head, commands/times and hosted CI are
recorded in the M7C PR. The revalidation below records local evidence separately
from hosted CI and workstation approval.

## Automated regression coverage

- Pure HandoffPlan defaults, metadata/visual/audio dispositions, split coverage,
  rational 30000/1001 and fractional native positions, off-grid bake and unknown
  effect refusal, disabled alpha/stems.
- Real synthetic 5-second 160×90 8-fps H.264 source with embedded 660 Hz audio;
  source trim 1–5 seconds into a 4-second cut. Separate synthetic 440 Hz WAV,
  manual Traditional Chinese caption at 2–3 seconds, and red GraphicScene at 1–2.
- Explicit fidelity + mix produces one 1–3 second / 16-frame precomp, native
  0–1 and 3–4 second excerpts, 32-frame reference and 192,000-sample 48-kHz PCM mix.
  Actual decoded first/last precomp frames compare with reference frames 8/23 at
  mean absolute RGB error <3/255; overlay pixel checked independently. SRT timing,
  original Composition, source hashes, source bounds and native audio offsets
  are asserted. The official OTIO 0.18.1 parser read/write/read retains the entire
  normalized document and four-second duration.
- A separate fidelity-without-mix case verifies native embedded dialogue projection
  across the full cut and decodes its real audio. This closes the independent
  review's audio-loss finding; a silent visual precomp never replaces dialogue.
- Default native exports repeat with identical OTIO bytes and no absolute source
  paths. TAR inventory is read by the system tar parser. Sources and project state
  remain unchanged. HTTP/CLI use the same plan and project-scoped download rules.
- Stale input/disk revision, missing/changed sources, mid-render cancellation,
  HTTP disconnect, actual invalid FFmpeg codec, traversal and symlinked staging
  fail closed, releasing the owner and removing unpublished files.
- Browser verifies Traditional Chinese labels, review-before-export, option-change
  invalidation, keyboard activation, actual TAR download and unchanged project.

## Execution notes

The first complete browser attempt was interrupted: a development hot reload
navigated away during an editing assertion, and the new section initially pushed
the existing primary export action out of view. The section was moved after the
existing export/subtitle actions, without weakening viewport or save assertions.
A second run was interrupted to fix the independent review's embedded-audio loss.
Final full results must be recorded separately from those interrupted attempts.

The initial real precomp check found 15 decoded frames instead of 16. Explicit
rational output frame rate restores all frames; exact count assertions remain.
Official OTIO metadata is compared through its JSON serialization rather than
Python AnyDictionary object equality. Native validation was attempted with Rust
1.99.0 but the local host lacks GLib/GTK/WebKit development pkg-config files;
this is an environment failure, not native QA success. Interchange uses the
existing explicit OpenTimelineIO virtualenv; browser checks use the existing
Chromium cache. No runtime/provider download or personal fixture is required.

## Resolve workstation gate — NOT RUN

1. Record candidate SHA, OS/Resolve version, package TAR hash and all inventory
   hashes. Unpack on a clean workstation and open `timeline.otio`; do not call
   parser acceptance an application import result.
2. Confirm native video source-in 1 second, source-out 2 for the opening excerpt,
   then source-in 4, source-out 5 for the ending excerpt. Total cut stays 4 seconds.
   Opaque precomp covers record 1–3 seconds, with no gap, extra frame or doubled
   picture. Inspect first/last frame and GraphicScene/caption pixel placement.
3. For no-mix package, confirm separate Audio clip from the video's real stream,
   source-in 1/source-out 5 and record 0–4; no missing/doubled dialogue. Recreate
   any metadata-only gain/retime/envelope explicitly. For mix package, confirm one
   full mix and no additional native audio tracks, exact start/end and channel layout.
4. Import SRT/VTT separately where supported; compare 2–3-second caption timing,
   selected language and styling differences. Avoid duplicating burned captions.
5. Check relative-media relinking after moving the entire package. Reopen the NLE
   project, verify originals' hashes, color interpretation, audio and playback.
6. Confirm original recipes/source IDs remain in the retained OpenFilm package;
   NLE re-export may drop custom metadata. Save observations/screenshots and mark
   each capability individually. No actual Resolve evidence exists for this PR.

Windows/macOS native install, GPU, hardware capture, Resolve/Premiere/Final Cut
playback and 4K visual QA remain not-run. M7B stems and M8A depth are not integrated
on this independent base; they must not be marked complete by this work.

## Follow-up automated review

Imported/relinked portable-reference metadata now has explicit realistic fixture
coverage: originalUri/rootUri and other absolute references are replaced, and the
complete native OTIO is asserted path-free. Native fractional picture/audio edges
are accepted around aligned graphic precomps, while actual bake boundaries remain
strict. Real sparse-file streaming copy cancellation and destination exclusivity
are covered. An immediate retry is held behind controlled cancelled-render cleanup,
then succeeds with no staging left; the existing mutation queue already provided
that ordering, so no UI workaround or weakened assertion was introduced.

The source inspector also reuses the existing local media protocol/demuxer policy.
A real renamed ffconcat playlist regression confirms it is rejected by the
whitelist before following unhashed sibling sources.

Decimal configured rates (29.97 and 23.976) retain their exact decimal rational;
only an explicitly configured 30000/1001 uses that ratio. Handoff OTIO and decoded
precomps share that rate. A real two-interval 29.97-fps render compares both ends
of each precomp with reference frames, including an interval reached by input
seek. Interval extraction seeks near its start, retains source timestamps for
precise trim, and limits a plan to 128 disjoint precomps. Audio timing is classified
as baked for full mix; picture mappings exclude audio owners and unselected cues.
Already rendered precomps explicitly disable inherited looks while original
Composition recipes remain intact, preventing a second color application.

Final adapter regressions cover CLI `--no-captions`, a real 5,000-cue review larger
than 1 MiB consumed by CLI export, and fail-closed titles on audio/music tracks.
These address additional automated review findings without silently dropping
visible content. Earlier full-suite attempts during review edits are superseded
by the frozen final-candidate run recorded in the PR.

Static one-hour / 256-distinct-source limits are checked during review as well as
publication. Title-track clips with unresolved synthetic placeholder asset IDs
are rejected during review with a binding instruction; this slice requires a
catalog-backed source even when the renderer could draw a title without one.
Dedicated planner/application regressions cover these restrictions. The prior
04f4e37 browser run was deliberately interrupted after 156 passes to apply these
review findings; its remaining 13 cases are not claimed as executed. The final
candidate reruns the unchanged full browser suite.

Approval revisions also hash sorted referenced catalog records (including URI,
content hash and stream metadata). A same-ID source refresh or stream change
invalidates the review even if Composition is unchanged; the same binding is
checked before final publication. Source records are represented by the opaque
revision hash, not exposed as private metadata in receipts. Full-frame FFprobe
verification and derivative encoding/mixing use an explicit 30-minute deadline,
matching the existing renderer's budget; this is not a 4K performance claim.

Transition coverage is limited to its actual incoming duration. A real half-second
fade yields four baked frames at 8 fps, compares first/last pixels to the reference,
and preserves the remaining 3.5-second native cut with no repeated transition.
The 66e2da5 browser run was interrupted after 139 passes (one interrupted / 29 not
run) to fix these new correctness findings; final-head results supersede it.

Additional review findings have fail-first regressions for changed export options,
audio-only assets on visual tracks and oversized expanded plans. The token now
binds normalized plan/options and final publication rechecks it. This slice rejects
audio-only video/overlay sources during review with an Audio-track instruction.
A real 128-track × 128-caption-range plan is rejected by the 2 MiB review budget;
caption tracks are bounded to 128 so generated sidecars and inventory fit the
4 MiB receipt cap. Existing 5,000-cue CLI export still passes. The b274b8c browser
run was interrupted after 117 passes (one interrupted / 51 not run) to apply
these findings; it is not claimed as a complete browser pass.

Saved caption arrays need not be chronological. Sidecar generation now sorts a
copy by start/end while the original project and cue storage order remain unchanged.
The queued-disconnect concern was checked with both chunked and Content-Length
requests: a controlled real render holds the mutation queue, the second body is
fully received, its response closes before releasing the queue, and only the first
request reaches application export/render or publication. The existing body read
after queue acquisition rejects the destroyed unread request, so no server-flow
change was needed. The 2aa1d34 browser run was interrupted after 139 passes
(one interrupted / 29 not run) to apply the caption correction; it is not a pass.

## 2026-10-20 review audit

Audited candidate: `2dc059635b80a403aac215810fa0cda36cb329c5` (PR #39).
All 22 open review threads were compared with this candidate's implementation
and regression coverage. Their unresolved GitHub state does not identify an
unfixed defect: the candidate already contains the relevant corrections or
fail-closed restrictions. That initial audit changed validation documentation
only and claimed no new production fix or red/green cycle. The later findings
and their separate remediation are recorded below.

The initially suspected cancellation races did not reproduce. Every handoff POST
acquires the mutation queue before reading its body and checking active jobs.
An immediate retry therefore waits for cancelled export cleanup rather than
receiving a running-job conflict. A queued request whose response has closed
fails its unread body stream before entering application export. Both chunked
and Content-Length regressions confirm that no second render or publication
starts. Keep these ordering assertions if request-body handling is refactored.

Thread numbers below refer to the discussion IDs in
[PR #39](https://github.com/bynanci/open-film/pull/39).
All dispositions are **addressed in the audited candidate**.

| Discussion   | Concern                           | Evidence checked                                                                                                                                                   |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `4324039134` | Native fractional boundaries      | Planner accepts fractional picture/audio edges around aligned visual ranges; only actual visual bake edges are strict.                                             |
| `4324039142` | Absolute portable references      | Packaged asset metadata is replaced with relative references; reproducible native OTIO contains neither the source root nor `file://`.                             |
| `4324039146` | Retry during cancellation cleanup | Controlled cancelled renderer holds cleanup; immediate review retry remains pending, then returns 200 with empty staging.                                          |
| `4324039155` | Abort source staging              | Real 64 MiB sparse-file copy aborts before completion, closes handles and preserves destination exclusivity.                                                       |
| `4324147661` | Decimal output grid               | 29.97, 23.976 and 30000/1001 planner cases retain the configured rate; real disjoint 29.97-fps precomps match reference endpoints.                                 |
| `4324147670` | Full-mix track timing             | Original audio/music layer timing is classified baked when a full mix replaces it.                                                                                 |
| `4324147677` | Repeated full-reference decoding  | Range extraction seeks before input, trims using source PTS, uses a 30-minute deadline and rejects more than 128 disjoint visual ranges.                           |
| `4324147683` | Visual mapping audio owners       | Visual owner set excludes audio/music tracks; rendered package regression excludes `audio` and `voice` from visual-precomp mappings.                               |
| `4324210802` | CLI review size                   | CLI consumes and publishes its generated 5,000-cue review, explicitly asserted larger than 1 MiB.                                                                  |
| `4324210816` | Full-mix provenance owners        | Supplemental real FFmpeg publication includes embedded-video and audio owners, and excludes silent-video, still and title owners.                                  |
| `4324210830` | Titles on audio/music tracks      | Planner rejects visible titles/title styles on those tracks before approval; standalone supplied review probe also rejects with the documented instruction.        |
| `4324210839` | CLI caption omission              | `--no-captions` produces `captionTrackId: null`; conflicting caption options are rejected.                                                                         |
| `4324343843` | Synthetic title source            | Application review rejects an unbound title placeholder with a source-binding instruction.                                                                         |
| `4324343854` | Static transport limits           | Planner rejects timelines beyond one hour and more than 256 distinct referenced assets before approval.                                                            |
| `4324462213` | Verification timeout              | Both reference and derivative frame-count probes use the explicit 1,800,000 ms deadline, asserted during a real render.                                            |
| `4324462219` | Reviewed source identities        | Revision hashes sorted referenced catalog records; changing a same-ID hash or stream metadata invalidates approval. Final publication rechecks the same binding.   |
| `4324462224` | Transition bake length            | Half-second transition produces four frames at 8 fps; decoded endpoints match the reference and the remaining 3.5 seconds stays native without another transition. |
| `4324564589` | Reviewed options                  | Revision includes the normalized plan; changed mode, full-mix choice or caption selection is rejected as stale.                                                    |
| `4324564597` | Audio asset on visual track       | Application review rejects audio-only sources on video/overlay tracks before picture baking can remove them.                                                       |
| `4324564604` | Downloadable receipt budget       | Review rejects the real 128-track × 128-range expanded plan above 2 MiB; caption track count is bounded so the receipt inventory fits the 4 MiB read limit.        |
| `4324669734` | Stored cue ordering               | Sidecars sort a copy by start/end; SRT and VTT place the early cue first and saved project order remains unchanged.                                                |
| `4324669740` | Queued disconnect                 | Fully sent chunked and Content-Length requests close while queued; only the first request reaches application export/render and only one package exists.           |

Validation commands activate `/workspace/.openfilm-env/activate.sh` first. The
frozen offline dependency install found a missing registry tarball; the frozen
online install then completed with no manifest or lockfile changes. Focused
handoff validation passed **3 files / 41 tests** in **19.22 seconds**:

```sh
pnpm exec vitest run tests/unit/handoff-plan.test.ts tests/unit/handoff-transport.test.ts tests/integration/nle-handoff.test.ts --maxWorkers=1
```

The focused real FFmpeg checks verify the 32-frame reference, 16-frame visual
precomp, source offsets, first/last decoded frame mean error below 3/255, native
embedded dialogue, and a 192,000-sample 48 kHz full mix. The official OTIO 0.18.1
parser completes read/write/read without losing the normalized document.
These are synthetic low-resolution checks; they do not establish 4K performance,
native application installation or actual Resolve/Premiere/Final Cut playback.
Browser validation is recorded separately by the release coordinator.

The supplemental owner probe publishes a two-second composition with silent video,
video containing audio, a still, a title backed by an audio catalog asset, and an
audio clip. Only the embedded-video and audio clips appear in the full-mix
mapping. This checks the distinction against real inspected streams and a
completed publication, beyond reading the mapping filter.

Additional local checks passed: `pnpm lint`, `pnpm typecheck`, `pnpm build`,
`pnpm test:i18n` (1,730 matching semantic keys in three locales), and
`pnpm test:interchange` (18 Python harness tests, official OTIO read/write/read,
missing-source rejection, and workstation relocation/source-hash gates). The
build retains its existing warning about a minified chunk larger than 500 kB.

The complete `pnpm test --maxWorkers=1` run passed **213 files / 2,960 tests**
in **387.13 seconds**, with no failed or skipped tests. This includes the existing
lock, stale-revision, source-hash, unsupported-input and cancellation regressions;
the benchmark suite's deliberately injected failure events are passing negative
cases, not failed tests. Documentation formatting and `git diff --check` also pass.

The retained synthetic package inventory independently verifies all 12 file
sizes and SHA-256 values, and the TAR has 12 unique entries. Its TAR SHA-256 is
`100d38f543ddd1b610f9eb49fcb556d0a119271d5c6c07c84f7dcded861ccc38`.
No native workstation or real NLE gate above is upgraded by these local results.

## Later review — static approval preflight and amplified full mix

Remediation base: `d436b5acfd3d45c22df0e9939c51c8c7ccb832b6`.
All four new findings reproduced in nine failing regressions before production
changes. The same nine cases then passed. Review and publication now share
native-exchange validation, while renderer capability checks stay in the
application layer using the existing `graphicFrameRanges` helper. Exporters and
core gain no renderer dependency or separate rendering planner.

| Discussion   | Disposition     | Behavior and evidence                                                                                                                                                                                                                                                          |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `4326536363` | Accepted, fixed | Review rejects any missing referenced catalog asset. Separate video, overlay, audio and music regressions reject approval before publication. Existing title-placeholder refusal stays specific.                                                                               |
| `4326536372` | Accepted, fixed | Fidelity or full-mix review applies the renderer's graphic budget, including aggregate scene-frames and the 60-fps limit. Three overlapping 30-second scenes at 30 fps and a 90-fps scene reject approval; metadata-only native exchange remains available.                    |
| `4326536381` | Accepted, fixed | Every nonempty saved caption track is checked through the same sorted SubRip serializer used for sidecars. Markup and timing-like text reject approval even when no caption language is selected, because the package always includes both SRT and VTT.                        |
| `4326536397` | Accepted, fixed | Native validation uses an exchange clone with already-baked volume removed when full mix is selected. The real renderer and original Composition provenance retain authored gain. Amplified native-only gain still fails review instead of becoming an unpublishable approval. |

The gain regression publishes real unamplified and gain-2 full mixes with the
same embedded-video and standalone audio sources. Decoded mono PCM RMS must
increase by a factor between 1.9 and 2.1. The final exchange has unity picture
gain and exactly one audio track, while original provenance retains gain 2.
Source hashes and the saved/in-memory project remain unchanged. Optional
`OPENFILM_HANDOFF_GAIN_QA_OUTPUT` retains both synthetic packages and numerical
`gain-proof.json` evidence for independent inspection.

Validation uses the complete three-file handoff target with one worker:

```sh
pnpm exec vitest run tests/unit/handoff-plan.test.ts tests/unit/handoff-transport.test.ts tests/integration/nle-handoff.test.ts --maxWorkers=1
```

The final complete run passed **3 files / 50 tests** in **23.23 seconds**,
including retained real-render evidence. Measured unamplified/amplified RMS was
0.1282692 / 0.2564879, a **1.999606×** increase. Both synthetic package inventories
and original source hashes verify.
Targeted ESLint, repository type checking and the production build also passed;
the existing bundle-size warning remains. No full repository suite, browser,
default-port service, native installation or real NLE check was run for this
follow-up. The earlier 2,960-test full-suite result belongs to its audited base;
the release coordinator owns combined validation after integration.
