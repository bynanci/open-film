# Composition-caption validation

The slice starts from OpenFilm main
`34b6ff093294f97061dfb0ecb270413a52b6b7ee` on branch
`codex/composition-aware-captions`. It does not include or modify the separate
open PR #8/#9 cancellation/owner-recovery branches. At inspection both were Ready,
exact-head checks green and unresolved review threads zero. Neither is merged by
this task. Main and workstation issue #7 were checked again before implementation.

The pinned OpenCut source review, actual-versus-announced capability distinction,
licensing boundary and eight-row gap matrix are in [the reference record](opencut-reference.md).
The application behavior and manual/headless steps are in [the workflow](composition-captions.md).

## Regression evidence before the full candidate gate

- HTTP/CLI tests first failed because the caption route returned 404 and `--track`
  was not accepted. Actual browser flow first failed at the missing caption UI.
- Domain/serializer tests cover source trims, fixed speed, split instances, gaps,
  repeated assets, alignment, rounding, malformed source metadata, limits and
  overlap preservation. Application tests cover revision/source races during
  preparation and staged publication, missing transcripts, cancellation, failures,
  retry, receipts, symlink rejection and 10,000-segment bounded reads.
- The export-only CLI lifecycle regression protects exact project bytes and live
  job records, including a newer project saved by another process before close.
- Independent review reproduced SRT entity corruption with FFmpeg's actual
  subtitle decoder. Format-specific output now preserves ampersands and rejects
  ambiguous HTML/ASS/timing-shaped text with a WebVTT fallback. Signed timestamp
  injection cases were added; matching the serializer to its own parser was not
  used as the format gate.
- Chromium's native TextTrack parser reads WebVTT timing and decoded Unicode/text;
  FFprobe reads SRT packets and FFmpeg decodes text to independently check content.
- Focused browser suite: 8 passed. Four locale layout checks cover en-US, zh-TW,
  ja-JP and en-XA at 1280×720, 1440×900 and 1920×1080. They check bounded lists,
  keyboard scroll/pagination, clipping, horizontal overflow and axe. An initial
  accessibility failure exposed unfocusable scroll regions; a RED→GREEN component
  regression and the final browser run verify the fix.
- Browser ownership tests hold a real response across project replacement and
  reject a stale transcript snapshot before publication. Downloaded subtitle and
  manifest bytes, source hashes, corrected revisions and unchanged film data are
  checked. The tests reuse persisted synthetic transcripts, without model calls.

These targeted results establish the implemented workflow, not a final SHA gate.
The full check logs for the published candidate are available from [PR #10](https://github.com/bynanci/open-film/pull/10/checks); match each run to its head SHA rather than treating an earlier run as current.

## Manual gates remain open

No actual Resolve import/playback/relink/save-reopen, real ASR/LLM quality, GPU
performance, representative camera/HDR/4K or Windows installer test was performed.
OS-specific process ownership remains its separate workstation contract. Subtitle
format/parser success does not verify a particular NLE's playback or overlap
presentation. No OpenCut runtime was built or executed, no code was copied, and
no speed or productivity percentage is claimed.

## Candidate and cross-version evidence

Implementation commit: `edc400bcacf8405106499bd6a8aad7e3546a0dde`.
The local gate at that commit passed format, i18n (1,091 keys), lint, typecheck,
1,119 unit/integration tests in 96 files, and build. Its focused caption tests
were 98 passed in six files. The final implementation also passed all eight
caption browser cases during the complete suite, including four locales at all
three desktop sizes after the full-width layout refinement and warning times.

Initial CI runs [37705917104](https://github.com/bynanci/open-film/actions/runs/37705917104)
and [37705945103](https://github.com/bynanci/open-film/actions/runs/37705945103)
failed the independent decoded-ASS text assertion: Ubuntu's FFmpeg emitted CRLF
record delimiters, while the test split only LF and compared the trailing CR as
cue text. This was a test-adapter defect, not a reason to weaken the content
assertion. Both integration and browser probes now split ASS records on CRLF or
LF; Unicode, spaces, escaped line breaks, ampersands and cue timing remain exact.
The subtitle serializer and application output are unchanged by this correction.
The failed runs remain historical evidence, not successful gates.

The complete local gate begins at the implementation commit; the subsequent
commit changes only these two test adapters and this validation record. The
local manifest records both file sets rather than claiming an unchanged tree.
Affected parser/browser checks are repeated on the published candidate, whose
independent CI additionally runs the complete repository gates. Native checks
exercise formatting/Clippy and the harness (zero Rust behavioral tests); they do
not validate a Windows installer. Interchange uses official OTIO 0.18.1 and the
existing Resolve preparation helper tests, not the Resolve application.

The subsequent candidate `b50b866ea629688a69caa301d2489bf14b29c39a`
passed its local parser/browser rerun, but PR CI
[37706405529](https://github.com/bynanci/open-film/actions/runs/37706405529)
reported 68 browser passes and one failure: the standalone native WebVTT probe's
`page.evaluate` lost its execution context to a navigation. That format-only
test unnecessarily opened the application before using Chromium's parser.
It now uses a blank browser document and asserts that no application document
navigation occurs. The separate real application workflow still downloads and
independently parses the actual WebVTT output. No retry, delay, content assertion
relaxation or production change was used; the CI annotation does not establish
the exact origin of the intervening navigation. This failed attempt is retained
separately from the next candidate's checks.

The Ready-triggered review also identified missing CLI warning pagination and
caption-request shutdown cancellation. Follow-up regressions exercise warning
pages beyond 200 and shutdown during preparation, snapshot validation and export.
The suggestion to admit raw `360-video` was checked against the full renderer:
`previewIssue` rejects these sources before `hasAudio` is reached, requiring a
reframed flat export. The caption boundary is retained and tested explicitly;
this does not claim raw-360 rendering support.

A further review identified inaccessible source/clip bindings beyond the first
200 entries and a slow project-switch request racing with caption status reads.
Source and clip-binding pages now have independent offsets and limits through
Application, HTTP and CLI, including snapshots blocked from publication. Project
switch guards cover asynchronous body reads and cleanup before closing the old
catalog. Regression coverage exercises the large binding collections and the
controlled interleaving, rather than relying on a successful small-file run.

The next review found six further contract gaps: explicit preview-blocked media,
metadata-only changes to source eligibility, amplified volume accepted by existing
projects, mismatched composition-end tolerance, and late clip/text resource guards.
Regression fixes align those decisions with the existing renderer/validator,
bind canonical source metadata, reject oversized tracks before source I/O, and
count UTF-8 text incrementally while discarding unused historical word arrays from
caption working data. Historical transcript evidence itself remains unchanged.

An independent audit also found that the renderer rounds the film's end down to
complete output frames. Core and renderer now share that existing calculation;
the application binds frame rate/output duration and omits unverifiable caption
tails. Actual FFmpeg regression checks cover 1.01 seconds at 30 fps producing
1.000 seconds and 1.02 seconds at 30000/1001 fps producing 1.001 seconds. These
checks establish the generated fixture's output clock, not NLE playback quality.
