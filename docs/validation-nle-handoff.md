# M7C validation — native and rendered NLE exchange

Base: `bb2c4521ad894478893485119442a00ffd9b34cc`.
Implementation candidate; exact final head, commands/times and hosted CI are
recorded in the M7C PR. No merge or public release is authorized for this phase.

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
